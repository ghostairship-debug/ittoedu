import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { courseProjectDocumentSchema } from '../../src/shared/courseProjectSchema'
import type { CourseProjectDocument } from '../../src/shared/courseProjectTypes'
import {
  PLAYER_AUTHORING_MESSAGE_TYPES,
  PLAYER_AUTHORING_PROTOCOL_VERSION,
} from '../../src/shared/playerAuthoringProtocol'
import type { PlayerAuthoringHostMessage } from '../../src/shared/playerAuthoringProtocol'
import type { RuntimeAuthoringTarget } from '../../src/shared/runtimeTypes'
import type { DesktopAPI } from '../../src/shared/ipcTypes'
import { componentPackagesFromArchive } from '../../src/renderer/components/componentPackageStore'
import { openCourseProjectArchive } from '../../src/renderer/project/courseProjectArchive'
import type { ImportedImageAsset } from '../../src/renderer/project/assetManager'
import {
  selectActiveCourseProjectDocument,
  selectMediaAssetFiles,
  useEditorStore,
} from '../../src/renderer/store/editorStore'
import { readCourseProjectV9FixtureArchive } from '../fixtures/course-project-v9'

const publishedAuthoringHarness = vi.hoisted(() => ({
  latestRevision: -1,
  onMessage: null as ((message: PlayerAuthoringHostMessage) => void) | null,
}))

vi.mock('../../src/renderer/ui/coursePlayerTryRun', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../../src/renderer/ui/coursePlayerTryRun')
  >()
  return {
    ...actual,
    mountPublishedCourseAuthoring: (
      input: Parameters<typeof actual.mountPublishedCourseAuthoring>[0],
    ) => {
      publishedAuthoringHarness.onMessage = input.onMessage
        ? (message: PlayerAuthoringHostMessage) => {
            if ('revision' in message && typeof message.revision === 'number') {
              publishedAuthoringHarness.latestRevision = Math.max(
                publishedAuthoringHarness.latestRevision,
                message.revision,
              )
            }
            input.onMessage?.(message)
          }
        : null
      return actual.mountPublishedCourseAuthoring(input)
    },
  }
})

vi.mock('../../src/renderer/export/loadPlayerBundle', () => ({
  loadPlayerBundle: () => '/* Runtime asset replacement race Player bundle */',
}))

vi.mock('../../src/renderer/authoring/authoringReadiness', () => ({
  isAuthoringCanvasInteractive: () => true,
}))

vi.mock('../../src/renderer/phaser/createEditorGame', () => ({
  createEditorGame: () => {
    const methods = new Map<PropertyKey, (...args: unknown[]) => unknown>()
    const bridge = new Proxy<Record<PropertyKey, unknown>>({}, {
      get: (_target, property) => {
        let method = methods.get(property)
        if (!method) {
          method = String(property).startsWith('on')
            ? () => () => undefined
            : () => undefined
          methods.set(property, method)
        }
        return method
      },
    })
    return {
      bridge,
      game: { scale: { refresh: () => undefined } },
      destroy: () => undefined,
    }
  },
}))

import { Workspace } from '../../src/renderer/ui/Workspace'

const PREVIEW_TOKEN = '00000000-0000-4000-8000-000000000002'
const FIRST_LOCATION_ID = 'location-scene-1'
const SECOND_LOCATION_ID = 'location-scene-2'
const FIRST_SCENE_ID = 'scene-1'
const SECOND_SCENE_ID = 'scene-2'
const RUNTIME_ITEM_ID = 'slide-canvas-runtime'
const BINDING_KEY = 'sprite'
const REPLACEMENT_ASSET_ID = 'runtime-race-replacement'
const REPLACEMENT_BYTES = Uint8Array.from([9, 4, 2, 7, 1])

const REPLACEMENT: ImportedImageAsset = {
  meta: {
    id: REPLACEMENT_ASSET_ID,
    filename: 'runtime-race-replacement.png',
    mimeType: 'image/png',
    kind: 'image',
    path: `assets/${REPLACEMENT_ASSET_ID}.png`,
    byteLength: REPLACEMENT_BYTES.byteLength,
    width: 8,
    height: 8,
  },
  bytes: REPLACEMENT_BYTES,
}

interface Deferred<T> {
  readonly promise: Promise<T>
  resolve(value: T): void
}

interface PersistentSnapshot {
  readonly project: CourseProjectDocument
  readonly assetFiles: Readonly<Record<string, readonly number[]>>
  readonly activeHistoryDepth: number
  readonly sidecarPastDepth: number
  readonly sidecarFutureDepth: number
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

function fixture(): {
  project: CourseProjectDocument
  assetFiles: Record<string, Uint8Array>
} {
  const source = openCourseProjectArchive(
    readCourseProjectV9FixtureArchive('canvas-runtime'),
  )
  const project = structuredClone(source.project)
  const surface = project.surfaces.find((candidate) => candidate.type === 'slide')
  if (!surface || surface.type !== 'slide') throw new Error('missing Slide surface')
  const firstScene = surface.scenes.find((candidate) => candidate.id === FIRST_SCENE_ID)
  if (!firstScene) throw new Error('missing first Slide scene')
  surface.scenes.push({
    ...structuredClone(firstScene),
    id: SECOND_SCENE_ID,
    name: '竞态期间第二场景',
    layerItems: [],
  })
  project.locations.push({
    id: SECOND_LOCATION_ID,
    label: '竞态期间第二场景',
    kind: 'slide-scene',
    surfaceId: surface.id,
    sceneId: SECOND_SCENE_ID,
  })
  return {
    project: courseProjectDocumentSchema.parse(project),
    assetFiles: Object.fromEntries(
      Object.entries(source.assetFiles).map(([assetId, bytes]) => [
        assetId,
        Uint8Array.from(bytes),
      ]),
    ),
  }
}

function loadFixture(): void {
  const source = fixture()
  useEditorStore.getState().loadCourseProject(
    source.project,
    null,
    source.assetFiles,
    componentPackagesFromArchive(source.project, {}),
  )
  useEditorStore.getState().activateCourseLocation(FIRST_LOCATION_ID)
}

function activeProject(): CourseProjectDocument {
  const project = selectActiveCourseProjectDocument(useEditorStore.getState())
  if (!project) throw new Error('missing active Course Project V9')
  return project
}

function runtimeBindingAssetId(
  project: CourseProjectDocument,
  sceneId = FIRST_SCENE_ID,
): string | null {
  for (const surface of project.surfaces) {
    if (surface.type !== 'slide') continue
    const scene = surface.scenes.find((candidate) => candidate.id === sceneId)
    const item = scene?.layerItems.find(
      (candidate) => candidate.layerItemId === RUNTIME_ITEM_ID,
    )
    if (item?.kind === 'runtime') {
      return item.runtime.assets[BINDING_KEY]?.assetId ?? null
    }
  }
  return null
}

function persistentSnapshot(): PersistentSnapshot {
  const state = useEditorStore.getState()
  if (state.slideBackend?.kind !== 'slide-authoring') {
    throw new Error('expected Slide authoring backend')
  }
  return structuredClone({
    project: activeProject(),
    assetFiles: Object.fromEntries(
      Object.entries(selectMediaAssetFiles(state)).map(([assetId, bytes]) => [
        assetId,
        [...bytes],
      ]),
    ),
    activeHistoryDepth: state.slideBackend.getSession().history.past.length,
    sidecarPastDepth: state.courseAssetSidecarPast.length,
    sidecarFutureDepth: state.courseAssetSidecarFuture.length,
  })
}

const originalCapture =
  useEditorStore.getState().captureRuntimeAssetReplacementTarget
const originalReplace = useEditorStore.getState().replaceRuntimeAssetAtTarget
const originalImportAsset = useEditorStore.getState().importAsset

function installWriteSpies() {
  const capture = vi.fn(originalCapture)
  const replace = vi.fn(originalReplace)
  const importAsset = vi.fn(originalImportAsset)
  useEditorStore.setState({
    captureRuntimeAssetReplacementTarget: capture,
    replaceRuntimeAssetAtTarget: replace,
    importAsset,
  })
  return {
    capture,
    replace,
    importAsset,
  }
}

let targetMessageRevision = 0

async function publishRuntimeAssetTarget(
  sceneId = FIRST_SCENE_ID,
): Promise<HTMLButtonElement> {
  await screen.findByTestId('published-authoring-host')
  await waitFor(() => expect(publishedAuthoringHarness.onMessage).not.toBeNull())
  targetMessageRevision = Math.max(
    targetMessageRevision + 1,
    publishedAuthoringHarness.latestRevision + 1,
  )
  const target: RuntimeAuthoringTarget = {
    targetId: 'runtime-race-hero',
    nodeId: RUNTIME_ITEM_ID,
    scope: 'scene',
    sceneId,
    kind: 'asset',
    key: BINDING_KEY,
    label: '场景主视觉',
    layer: 'overlay',
    source: 'registered',
    bounds: { x: 900, y: 460, width: 160, height: 160 },
  }
  await act(async () => {
    publishedAuthoringHarness.onMessage?.({
      type: PLAYER_AUTHORING_MESSAGE_TYPES.runtimeTargets,
      protocolVersion: PLAYER_AUTHORING_PROTOCOL_VERSION,
      sessionId: PREVIEW_TOKEN,
      revision: targetMessageRevision,
      update: {
        revision: targetMessageRevision,
        scope: 'scene',
        sceneId,
        targets: [target],
      },
    })
  })
  return screen.findByRole('button', {
    name: '场景主视觉，双击替换图片',
  }) as Promise<HTMLButtonElement>
}

async function renderPendingReplacement() {
  const selection = deferred<ImportedImageAsset | null>()
  const onSelectImageAsset = vi.fn(() => selection.promise)
  const spies = installWriteSpies()
  render(
    <Workspace
      onAddImage={() => undefined}
      onAddVideo={() => undefined}
      onSelectImageAsset={onSelectImageAsset}
    />,
  )
  const targetButton = await publishRuntimeAssetTarget()
  fireEvent.click(targetButton)
  await waitFor(() => expect(onSelectImageAsset).toHaveBeenCalledOnce())
  expect(spies.capture).toHaveBeenCalledOnce()
  expect(spies.capture.mock.invocationCallOrder[0])
    .toBeLessThan(onSelectImageAsset.mock.invocationCallOrder[0]!)
  expect(targetButton).toBeDisabled()
  return { selection, onSelectImageAsset, spies, targetButton }
}

async function resolveSelection(
  result: Deferred<ImportedImageAsset | null>,
  value: ImportedImageAsset | null,
): Promise<void> {
  await act(async () => {
    result.resolve(value)
    await result.promise
    await Promise.resolve()
  })
}

function expectBypassImportUnused(spies: ReturnType<typeof installWriteSpies>) {
  expect(spies.importAsset).not.toHaveBeenCalled()
}

beforeEach(() => {
  targetMessageRevision = 0
  publishedAuthoringHarness.latestRevision = -1
  publishedAuthoringHarness.onMessage = null
  vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(PREVIEW_TOKEN)
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:runtime-race-preview')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  })
  window.desktopAPI = {
    setPreviewNetworkPolicy: vi.fn(async () => undefined),
    releasePreviewNetworkPolicy: vi.fn(async () => undefined),
  } as unknown as DesktopAPI
  loadFixture()
})

afterEach(() => {
  cleanup()
  useEditorStore.setState({
    captureRuntimeAssetReplacementTarget: originalCapture,
    replaceRuntimeAssetAtTarget: originalReplace,
    importAsset: originalImportAsset,
  })
  useEditorStore.getState().clearV9SlideCandidateBackend()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete (window as Partial<Window>).desktopAPI
})

describe('ARCH-2 Workspace Runtime asset replacement race', () => {
  it('captures the stable Store target before the deferred picker and rejects an intervening revision without orphan writes', async () => {
    const { selection, spies } = await renderPendingReplacement()

    act(() => {
      useEditorStore.getState().renameProject('Runtime revision changed while picker is open')
    })
    await publishRuntimeAssetTarget()
    const afterIntervention = persistentSnapshot()
    await resolveSelection(selection, REPLACEMENT)

    await waitFor(() => {
      expect(useEditorStore.getState().statusMessage).toMatch(/工程内容已改变|失效|过期/)
    })
    expect(spies.replace).toHaveBeenCalledOnce()
    expect(persistentSnapshot()).toEqual(afterIntervention)
    expect(activeProject().assets).not.toHaveProperty(REPLACEMENT_ASSET_ID)
    expect(selectMediaAssetFiles(useEditorStore.getState()))
      .not.toHaveProperty(REPLACEMENT_ASSET_ID)
    expectBypassImportUnused(spies)
    const liveButton = await screen.findByRole('button', {
      name: '场景主视觉，双击替换图片',
    })
    expect(liveButton).not.toBeDisabled()
  })

  it('drops a deferred callback after location change with no metadata, bytes, or history beyond that intervention', async () => {
    const { selection, spies } = await renderPendingReplacement()

    act(() => {
      useEditorStore.getState().activateCourseLocation(SECOND_LOCATION_ID)
    })
    const afterIntervention = persistentSnapshot()
    await resolveSelection(selection, REPLACEMENT)

    await waitFor(() => {
      expect(useEditorStore.getState().statusMessage).toMatch(/上下文已切换|目标已失效/)
    })
    expect(spies.replace).not.toHaveBeenCalled()
    expect(persistentSnapshot()).toEqual(afterIntervention)
    expect(activeProject().assets).not.toHaveProperty(REPLACEMENT_ASSET_ID)
    expect(selectMediaAssetFiles(useEditorStore.getState()))
      .not.toHaveProperty(REPLACEMENT_ASSET_ID)
    expectBypassImportUnused(spies)
  })

  it('drops a deferred callback after the Runtime item is deleted with no orphan resource or extra history frame', async () => {
    const { selection, spies } = await renderPendingReplacement()

    act(() => {
      useEditorStore.getState().deleteNode(RUNTIME_ITEM_ID)
    })
    const afterIntervention = persistentSnapshot()
    expect(runtimeBindingAssetId(afterIntervention.project)).toBeNull()
    await resolveSelection(selection, REPLACEMENT)

    await waitFor(() => {
      expect(useEditorStore.getState().statusMessage).toMatch(/目标已失效|上下文已切换/)
    })
    expect(spies.replace).not.toHaveBeenCalled()
    expect(persistentSnapshot()).toEqual(afterIntervention)
    expect(activeProject().assets).not.toHaveProperty(REPLACEMENT_ASSET_ID)
    expect(selectMediaAssetFiles(useEditorStore.getState()))
      .not.toHaveProperty(REPLACEMENT_ASSET_ID)
    expectBypassImportUnused(spies)
  })

  it('uses only replaceRuntimeAssetAtTarget once for a normal replacement, creates one history frame, and clears target busy state', async () => {
    const before = persistentSnapshot()
    const originalAssetId = runtimeBindingAssetId(before.project)
    const { selection, spies } = await renderPendingReplacement()
    await resolveSelection(selection, REPLACEMENT)

    await waitFor(() => {
      expect(runtimeBindingAssetId(activeProject())).toBe(REPLACEMENT_ASSET_ID)
    })
    const after = persistentSnapshot()
    expect(spies.replace).toHaveBeenCalledOnce()
    expect(spies.replace.mock.calls[0]?.[0]).toEqual(
      spies.capture.mock.results[0]?.value,
    )
    expect(after.project.revision).toBe(before.project.revision + 1)
    expect(after.activeHistoryDepth).toBe(before.activeHistoryDepth + 1)
    expect(after.sidecarPastDepth).toBe(before.sidecarPastDepth)
    expect(after.sidecarFutureDepth).toBe(before.sidecarFutureDepth)
    expect(after.project.assets[REPLACEMENT_ASSET_ID]).toEqual(REPLACEMENT.meta)
    expect(after.assetFiles[REPLACEMENT_ASSET_ID]).toEqual([...REPLACEMENT_BYTES])
    expect(originalAssetId).not.toBe(REPLACEMENT_ASSET_ID)
    expectBypassImportUnused(spies)

    const liveButton = await publishRuntimeAssetTarget()
    expect(liveButton).not.toBeDisabled()
  })
})
