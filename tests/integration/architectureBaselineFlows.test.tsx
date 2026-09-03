import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { componentPackagesFromArchive } from '../../src/renderer/components/componentPackageStore'
import {
  createCourseProjectArchive,
  openCourseProjectArchive,
} from '../../src/renderer/project/courseProjectArchive'
import {
  openSlideAuthoringSession,
  redoSlideAuthoring,
  selectSlideLayers,
  transformSlideNativeLayers,
  undoSlideAuthoring,
  type SlideAuthoringSession,
} from '../../src/renderer/course/slideAuthoringBackend'
import {
  buildFlowEditorView,
} from '../../src/renderer/course/flowEditorView'
import {
  commitFlowEditorHistory,
  createFlowEditorHistory,
  redoFlowEditorHistory,
  selectFlowEditorBlocks,
  undoFlowEditorHistory,
} from '../../src/renderer/course/flowEditorSlice'
import {
  updateFlowEditorBlock,
  type FlowCommandResult,
} from '../../src/renderer/course/flowEditorCommands'
import { buildPublishedCourseV2Payload } from '../../src/renderer/export/course/buildPublishedCourse'
import {
  MixedCourseNavigator,
  mixedCourseDefinitionFromPublished,
  type MixedCoursePlayerPort,
} from '../../src/player/surfaces/mixed/MixedCourseNavigator'
import { mountFlowLocationTryRun } from '../../src/renderer/ui/flowLocationTryRun'
import { FlowWorkspaceTestHarness as FlowWorkspace } from '../helpers/FlowWorkspaceTestHarness'
import { validateCourseProjectArchiveBytes } from '../../scripts/validate-project'
import type { FlowBlock } from '../../src/shared/courseProjectTypes'
import {
  PLAYER_V2_ENTRY_UNSUPPORTED_ERROR,
  startPlayer,
} from '../../src/player/index'
import { CoursePlayer } from '../../src/player/surfaces/CoursePlayer'

const FIXTURE_ROOT = join(process.cwd(), 'tests', 'fixtures', 'architecture-baseline')
const FIXED_TIME = '2026-08-24T00:00:00.000Z'

function fixture(id: 'slide-heavy' | 'flow-heavy' | 'mixed-spatial') {
  const filename = `${id}.h5lesson`
  const bytes = new Uint8Array(readFileSync(join(FIXTURE_ROOT, filename)))
  return {
    filename,
    bytes,
    archive: openCourseProjectArchive(bytes),
  }
}

function requireSlideSession(result: {
  ok: boolean
  nextSession?: SlideAuthoringSession
  reason?: string
}): SlideAuthoringSession {
  if (!result.ok || !result.nextSession) {
    throw new Error(result.reason ?? 'Slide command did not return a session')
  }
  return result.nextSession
}

function flowBlock(
  blocks: readonly FlowBlock[],
  id: string,
): FlowBlock | undefined {
  for (const block of blocks) {
    if (block.id === id) return block
    if (block.type === 'section') {
      const nested = flowBlock(block.blocks, id)
      if (nested) return nested
    }
  }
  return undefined
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockImplementation(() => null)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('ARCH-0 representative functional baseline', () => {
  it('opens, validates, saves and reopens all three fixed V9 archives', () => {
    for (const id of ['slide-heavy', 'flow-heavy', 'mixed-spatial'] as const) {
      const input = fixture(id)
      const report = validateCourseProjectArchiveBytes(input.bytes, input.filename)
      const expectedHealthWarningCodes = id === 'slide-heavy'
        ? new Set([
            'published-interaction-action-unsupported',
            'published-interaction-trigger-unsupported',
          ])
        : new Set<string>()
      expect(report.status).toBe('valid')
      expect(report.summary).toMatchObject({ error: 0, canExport: true })
      expect(report.projectHealth?.summary).toMatchObject({
        error: 0,
        warning: expectedHealthWarningCodes.size,
      })
      expect(new Set(report.projectHealth?.items
        .filter(({ severity }) => severity === 'warning')
        .map(({ code }) => code))).toEqual(expectedHealthWarningCodes)

      const saved = createCourseProjectArchive(input.archive, { mtime: FIXED_TIME })
      const reopened = openCourseProjectArchive(saved)
      expect(reopened.project).toEqual(input.archive.project)
      expect(reopened.assetFiles).toEqual(input.archive.assetFiles)
      expect(reopened.componentFiles).toEqual(input.archive.componentFiles)
    }
  })

  it('commits one Slide transform and preserves one-step undo/redo', () => {
    const { project } = fixture('slide-heavy').archive
    let session = openSlideAuthoringSession(project, {
      locationId: 'slide-location-practice',
      sessionId: 'arch-0-slide-history',
    })
    session = requireSlideSession(selectSlideLayers(session, {
      nodeIds: ['slide-practice-title'],
    }))
    const beforeRevision = session.history.present.revision
    session = requireSlideSession(transformSlideNativeLayers(session, {
      nodes: [{
        nodeId: 'slide-practice-title',
        x: 88,
        y: 64,
        width: 720,
        height: 80,
        rotation: 0,
      }],
    }, { now: FIXED_TIME }))
    expect(session.history.present.revision).toBe(beforeRevision + 1)
    expect(session.history.past).toHaveLength(1)

    session = requireSlideSession(undoSlideAuthoring(session))
    expect(session.history.present.revision).toBe(beforeRevision)
    expect(session.history.future).toHaveLength(1)
    session = requireSlideSession(redoSlideAuthoring(session))
    expect(session.history.present.revision).toBe(beforeRevision + 1)
    expect(session.history.future).toHaveLength(0)
  })

  it('holds Flow composition as a draft, then commits it through the document command and history', async () => {
    const { project } = fixture('flow-heavy').archive
    const selection = selectFlowEditorBlocks(
      project,
      'flow-location-start',
      ['flow-ime-paragraph'],
      {
        focus: 'text',
        textRange: { blockId: 'flow-ime-paragraph', start: 0, end: 0 },
      },
    )
    const view = buildFlowEditorView({
      project,
      locationId: 'flow-location-start',
    })
    const onProjectChange = vi.fn<(result: FlowCommandResult) => void>()
    render(
      <div style={{ width: 900, height: 640 }}>
        <FlowWorkspace
          project={project}
          view={view}
          selection={selection}
          onProjectChange={onProjectChange}
          onSelectionChange={() => undefined}
        />
      </div>,
    )
    const editor = screen.getByTestId('flow-inline-editor')
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    const composed = '中文输入法（IME）基线：春风又绿江南岸。'
    fireEvent.compositionStart(editor, { data: '中' })
    editor.textContent = composed
    fireEvent.input(editor)
    fireEvent.keyDown(editor, {
      key: 'Enter',
      ctrlKey: true,
      isComposing: true,
    })
    fireEvent.blur(editor)
    expect(onProjectChange).not.toHaveBeenCalled()
    fireEvent.compositionEnd(editor, { data: composed })
    fireEvent.blur(editor)

    await waitFor(() => expect(onProjectChange).toHaveBeenCalledTimes(1))
    const committed = onProjectChange.mock.calls[0]?.[0]
    expect(committed).toMatchObject({ ok: true, historyEntry: true })
    const next = committed?.nextDocument
    if (!next) throw new Error('Flow composition did not produce a document')
    const surface = next.surfaces.find((candidate) => candidate.id === 'flow-surface')
    if (!surface || surface.type !== 'flow') throw new Error('Missing Flow surface')
    expect(flowBlock(surface.blocks, 'flow-ime-paragraph')).toMatchObject({
      type: 'paragraph',
      text: composed,
    })

    let history = createFlowEditorHistory(project)
    history = commitFlowEditorHistory(history, next)
    expect(history.past).toHaveLength(1)
    history = undoFlowEditorHistory(history)
    expect(history.present.revision).toBe(project.revision)
    history = redoFlowEditorHistory(history)
    expect(history.present.revision).toBe(project.revision + 1)
  })

  it('switches every Mixed location through the Published V2 navigator', async () => {
    const archive = fixture('mixed-spatial').archive
    const components = componentPackagesFromArchive(
      archive.project,
      archive.componentFiles,
    )
    const published = buildPublishedCourseV2Payload({
      project: archive.project,
      assetFiles: archive.assetFiles,
      components,
    })
    const activations: string[] = []
    const releases: string[] = []
    const locations: string[] = []
    let activeSurfaceId: string | null = null
    const player: MixedCoursePlayerPort = {
      get activeSurfaceId() { return activeSurfaceId },
      async activateSurface(surfaceId) {
        activeSurfaceId = surfaceId
        activations.push(surfaceId)
        return { ok: true }
      },
      async releaseSurfaceSession(surfaceId) {
        releases.push(surfaceId)
        if (activeSurfaceId === surfaceId) activeSurfaceId = null
        return { ok: true }
      },
      async setSurfaceLocation(_surfaceId, locationId) {
        locations.push(locationId)
        return { ok: true }
      },
      async resetSurface() { return { ok: true } },
      async resetCourse() { return [] },
    }
    const navigator = new MixedCourseNavigator(
      mixedCourseDefinitionFromPublished(published),
      player,
    )
    expect((await navigator.start()).locationId).toBe('mixed-location-slide')
    expect((await navigator.next())?.locationId).toBe('mixed-location-flow')
    expect((await navigator.next())?.locationId).toBe('mixed-location-spatial-home')
    expect((await navigator.next())?.locationId).toBe('mixed-location-spatial-detail')
    expect(navigator.getProgress()).toMatchObject({ index: 3, total: 4, atEnd: true })
    expect(locations).toEqual([
      'mixed-location-slide',
      'mixed-location-flow',
      'mixed-location-spatial-home',
      'mixed-location-spatial-detail',
    ])
    expect(releases).toEqual(['mixed-slide-surface', 'mixed-flow-surface'])
    expect(activations).toHaveLength(4)
  })

  it('mounts and destroys the representative Flow Player host without page errors', async () => {
    const archive = fixture('flow-heavy').archive
    const components = componentPackagesFromArchive(
      archive.project,
      archive.componentFiles,
    )
    const container = document.createElement('div')
    Object.defineProperties(container, {
      clientWidth: { configurable: true, value: 1_280 },
      clientHeight: { configurable: true, value: 720 },
    })
    document.body.append(container)
    const host = await mountFlowLocationTryRun({
      container,
      project: archive.project,
      assetFiles: archive.assetFiles,
      components,
      locationId: 'flow-location-start',
    })
    expect(container.querySelector('[data-flow-block-id="flow-ime-paragraph"]'))
      .not.toBeNull()
    expect(container.querySelector('[data-flow-block-id="flow-component"]'))
      .not.toBeNull()
    await host.destroy()
    expect(container.childElementCount).toBe(0)
  })

  it('starts Mixed Published V2 through the Player entry and fail-louds Legacy payload', async () => {
    const source = readFileSync(join(process.cwd(), 'src/player/index.ts'), 'utf8')
    expect(source).not.toContain(['new Player', 'App'].join(''))
    expect(source).not.toContain('decodeExportPayload')
    expect(source).toContain('publishedCourseV2Schema')
    expect(source).toContain('createPublishedCourseSession')

    expect(() => startPlayer({
      project: { schemaVersion: 8, scenes: [] },
      assets: {},
      components: {},
    })).toThrow(PLAYER_V2_ENTRY_UNSUPPORTED_ERROR)

    const archive = fixture('mixed-spatial').archive
    const components = componentPackagesFromArchive(
      archive.project,
      archive.componentFiles,
    )
    const published = buildPublishedCourseV2Payload({
      project: archive.project,
      assetFiles: archive.assetFiles,
      components,
    })
    const root = document.createElement('div')
    root.id = 'course-root'
    Object.defineProperties(root, {
      clientWidth: { configurable: true, value: 1_280 },
      clientHeight: { configurable: true, value: 720 },
    })
    document.body.append(root)
    const session = startPlayer(published, root)
    expect(session.player).toBeInstanceOf(CoursePlayer)
    expect(session.listCatalog()).toHaveLength(published.locations.length)
    window.__H5_LESSON_PLAYER__?.destroy()
    await session.destroy()
    root.remove()
  })
})
