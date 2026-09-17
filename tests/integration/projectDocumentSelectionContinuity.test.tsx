import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCourseChatObservation } from '@/renderer/ui/chat/courseChatObservation'
import {
  selectActiveCourseProjectDocument,
  selectSlideAuthoringBackend,
  useEditorStore,
} from '@/renderer/store/editorStore'
import { componentPackagesFromArchive } from '@/renderer/components/componentPackageStore'
import { listCourseProjectV9Fixtures } from '../fixtures/course-project-v9/sources'
import type { AuthoringObservationPorts } from '@/renderer/authoring/generation/authoringObservation'
import type { CourseProjectDocument } from '@/shared/courseProjectTypes'
import type { DesktopAPI } from '@/shared/ipcTypes'
import { captureBackgroundTargets } from '@/renderer/authoring/tools/backgroundTool'

vi.mock('@/renderer/authoring/generation/authoringObservation', async importOriginal => ({
  ...(await importOriginal<typeof import('@/renderer/authoring/generation/authoringObservation')>()),
  createAuthoringObservationController: (ports: AuthoringObservationPorts) => ({
    dispose() {},
    prepareForEdit() {
      const result = ports.prepareForEdit()
      if (!result.ok) throw new Error(result.reason)
    },
    async capture() {
      const state = ports.read()!
      return {
        document: state.document,
        resourceFiles: [],
        observation: {
          documentRevision: state.document.revision,
          sessionGeneration: state.sessionGeneration,
          draftEpoch: 0,
          viewEpoch: 0,
          runtime: null,
          surfaceId: state.surfaceId,
          locationId: state.locationId,
          stateId: state.stateId,
          source: 'authoring',
          capturedAt: 1,
          files: [{ fileId: 'fixture-screen', relativePath: 'fixture-screen.png', mediaType: 'image/png', byteLength: 1, role: 'image' }],
        },
      }
    },
  }),
}))

const projectPath = 'C:/fixtures/project-document-selection.h5lesson'
const disposers: Array<() => void> = []

function document() {
  return selectActiveCourseProjectDocument(useEditorStore.getState())!
}

function activeLocationId() {
  return useEditorStore.getState().courseAuthoringSession!.token.locationId
}

function history() {
  const state = useEditorStore.getState()
  return state.flowSession?.history ?? state.spatialSession?.history
    ?? selectSlideAuthoringBackend(state)!.getSession().history
}

function fixture() {
  return listCourseProjectV9Fixtures().find(entry => entry.id === 'mixed')!.data
}

function withoutSlide(project: CourseProjectDocument): CourseProjectDocument {
  const next = structuredClone(project)
  next.locations = next.locations.filter(location => location.kind !== 'slide-scene')
  next.surfaces = next.surfaces.filter(surface => surface.type !== 'slide')
  next.startLocationId = 'location-flow'
  if (next.mixedPrintPlan) {
    next.mixedPrintPlan.entries = next.mixedPrintPlan.entries.filter(entry => entry.kind !== 'slide-scenes')
  }
  next.title = '完整文档移除演示面'
  return next
}

beforeEach(() => {
  const data = fixture()
  useEditorStore.getState().loadCourseProject(
    structuredClone(data.project),
    projectPath,
    data.assetFiles,
    componentPackagesFromArchive(data.project, data.componentFiles),
  )
  useEditorStore.getState().activateCourseLocation('location-slide')
})

afterEach(() => {
  disposers.splice(0).reverse().forEach(dispose => dispose())
  vi.restoreAllMocks()
})

describe('project.document selection continuity', () => {
  it('uses the live selection instead of an arbitrary version anchor and follows a renamed physical carrier', async () => {
    useEditorStore.getState().selectNode('slide-title')
    const before = structuredClone(document())
    const previousHistoryEntries = history().past.length
    const api = { localAgent: vi.fn(async () => ({ enabled: true, fileStatus: { status: 'current' } })) } as unknown as DesktopAPI
    const bridge = createCourseChatObservation(api, { projectId: before.id, projectPath })
    disposers.push(bridge.dispose)
    const request = await bridge.capture({
      workspace: { version: 1, projectId: before.id, normalizedPath: projectPath.toLowerCase() },
      instruction: '重写完整课件并保留当前浏览位置',
      scope: 'course',
      purpose: 'local-edit',
      intent: 'edit',
    })
    const anchor = request.destinations.find(destination =>
      (destination.kind === 'update' ? destination.target : destination.scope).locationId === 'location-flow')!
    expect(anchor).toBeTruthy()
    const next = structuredClone(before)
    const location = next.locations.find(entry => entry.id === 'location-slide')!
    location.id = 'location-slide-renamed'
    next.startLocationId = 'location-slide-renamed'
    next.title = '完整文档重命名位置'

    const prepared = await useEditorStore.getState().prepareGenerationCandidate(request, {
      version: 1,
      requestId: request.requestId,
      candidateId: crypto.randomUUID(),
      summary: '完整文档重命名位置',
      afterCommit: { version: 1, action: 'finish' },
      steps: [{
        id: 'document',
        tool: 'project.document',
        carrier: 'native',
        destination: anchor,
        input: { artifact: { document: next } },
      }],
    })
    expect(document()).toEqual(before)

    const applied = useEditorStore.getState().applyGenerationCandidate(prepared.previewId)
    expect(applied.status).toBe('committed')
    expect(activeLocationId()).toBe('location-slide-renamed')
    expect(useEditorStore.getState().courseAuthoringSession!.itemIds).toEqual(['slide-title'])
    expect(selectSlideAuthoringBackend(useEditorStore.getState())!.getSnapshot().selection.selectionIds).toEqual(['slide-title'])
    expect(document().revision).toBe(before.revision + 1)
    expect(history().past).toHaveLength(previousHistoryEntries + 1)

    useEditorStore.getState().undo()
    expect(document()).toEqual(before)
    expect(activeLocationId()).toBe('location-slide')
    useEditorStore.getState().redo()
    expect(activeLocationId()).toBe('location-slide-renamed')
    expect(document().locations.some(entry => entry.id === 'location-slide')).toBe(false)
  })

  it('falls back to the next start location when direct project.document removes the active Surface', async () => {
    const before = structuredClone(document())
    const previousHistoryEntries = history().past.length
    const session = useEditorStore.getState().courseAuthoringSession!
    const target = captureBackgroundTargets({
      document: before,
      sessionToken: session.token,
      stateId: null,
      reference: 'page',
    })[0]!.target
    const receipt = await useEditorStore.getState().runAuthoringTool({
      version: 1,
      requestId: crypto.randomUUID(),
      tool: 'project.document',
      destination: { kind: 'update', target },
      input: { artifact: { document: withoutSlide(before) } },
    })

    expect(receipt.status).toBe('committed')
    expect(activeLocationId()).toBe('location-flow')
    expect(document().surfaces.some(surface => surface.type === 'slide')).toBe(false)
    expect(document().revision).toBe(before.revision + 1)
    expect(history().past).toHaveLength(previousHistoryEntries + 1)

    useEditorStore.getState().undo()
    expect(document()).toEqual(before)
    expect(document().locations.some(location => location.id === activeLocationId())).toBe(true)
    useEditorStore.getState().redo()
    expect(activeLocationId()).toBe('location-flow')
    expect(document().surfaces.some(surface => surface.type === 'slide')).toBe(false)
  })
})
