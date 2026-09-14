import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCourseChatObservation } from '@/renderer/ui/chat/courseChatObservation'
import { selectActiveCourseProjectDocument, selectSlideAuthoringBackend, useEditorStore } from '@/renderer/store/editorStore'
import { panSpatialSessionCamera } from '@/renderer/course/spatialEditorCommands'
import { beginFlowTextEdit, updateFlowTextDraft } from '@/renderer/authoring/flowTextEdit'
import { openCourseProjectArchive } from '@/renderer/project/courseProjectArchive'
import { locateCourseLayer } from '@/renderer/course/effectiveLayerCommands'
import { listCourseProjectV9Fixtures } from '../fixtures/course-project-v9/sources'
import type { AuthoringObservationPorts } from '@/renderer/authoring/generation/authoringObservation'
import type { DesktopAPI } from '@/shared/ipcTypes'

// Only the screen capture carrier is a unit port. Target freezing, canonical
// snapshot, preparation, apply, resources, active backend and history are real.
vi.mock('@/renderer/authoring/generation/authoringObservation', async importOriginal => ({
  ...(await importOriginal<typeof import('@/renderer/authoring/generation/authoringObservation')>()),
  createAuthoringObservationController: (ports: AuthoringObservationPorts) => ({
    dispose() {}, prepareForEdit: () => { const result = ports.prepareForEdit(); if (!result.ok) throw new Error(result.reason) },
    async capture() {
      const state = ports.read()!
      return { document: state.document, resourceFiles: [], observation: { documentRevision: state.document.revision,
        sessionGeneration: state.sessionGeneration, draftEpoch: 0, viewEpoch: 0, runtime: null,
        surfaceId: state.surfaceId, locationId: state.locationId, stateId: state.stateId, source: 'authoring', capturedAt: 1,
        files: [{ fileId: 'fixture-screen', relativePath: 'fixture-screen.png', mediaType: 'image/png', byteLength: 1, role: 'image' }] } }
    },
  }),
}))

const disposers: Array<() => void> = []
const projectPath = 'C:/fixtures/background-edit.h5lesson'
function document() { return selectActiveCourseProjectDocument(useEditorStore.getState())! }
function history() {
  const state = useEditorStore.getState()
  return state.flowSession?.history ?? state.spatialSession?.history ?? selectSlideAuthoringBackend(state)!.getSession().history
}
const pages = { slide: ['location-slide', 'slide-title'], flow: ['location-flow', 'flow-paragraph'], spatial: ['location-spatial', 'spatial-label'] } as const
function browse(surface: keyof typeof pages) {
  const [location, item] = pages[surface]
  useEditorStore.getState().activateCourseLocation(location)
  useEditorStore.getState().selectNode(item)
  if (surface === 'spatial') useEditorStore.getState().runSpatialCommand(session => panSpatialSessionCamera(session, { x: 70, y: -35 }))
}
async function task(surface: keyof typeof pages) {
  browse(surface)
  const project = document(), owner = { projectId: project.id, projectPath }
  const api = { localAgent: vi.fn(async () => ({ enabled: true, fileStatus: { status: 'current' } })) } as unknown as DesktopAPI
  const bridge = createCourseChatObservation(api, owner)
  disposers.push(bridge.dispose)
  const request = await bridge.capture({ workspace: { version: 1, projectId: project.id, normalizedPath: projectPath.toLowerCase() },
    instruction: '将原目标文字改成后台修改已完成', scope: 'page', purpose: 'local-edit', intent: 'edit' })
  const destination = request.destinations.find(value => value.kind === 'update' && value.target.itemId === pages[surface][1])!
  const candidate = { version: 1, requestId: request.requestId, candidateId: crypto.randomUUID(), summary: '修改原目标',
    afterCommit: { version: 1, action: 'finish' },
    steps: [{ id: 'text', tool: surface === 'flow' ? 'flow.content' : 'native.content', carrier: 'native', destination,
      input: { operation: 'edit', text: '后台修改已完成' } }] }
  return { bridge, request, candidate }
}
beforeEach(() => {
  const fixture = listCourseProjectV9Fixtures().find(entry => entry.id === 'mixed')!
  useEditorStore.getState().loadCourseProject(structuredClone(fixture.data.project), projectPath)
})
afterEach(() => { disposers.splice(0).reverse().forEach(dispose => dispose()); vi.restoreAllMocks() })

describe('anchored AI background commit through the actual Store', () => {
  it.each([null, 'state-example'])('selects the replacement image at unchanged target in state %s, but preserves an active same-page selection change', async stateId => {
    for (const changeSelection of [false, true]) {
      const fixture = listCourseProjectV9Fixtures().find(entry => entry.id === 'slide-native')!
      const project = structuredClone(fixture.data.project), surface = project.surfaces[0]!
      if (surface.type !== 'slide') throw new Error('Expected Slide fixture')
      if (stateId) surface.scenes[0]!.presentation = { initialStateId: stateId, states: [{ id: stateId, name: '示例', layerItemOverrides: {} }] }
      useEditorStore.getState().loadCourseProject(project, projectPath, fixture.data.assetFiles)
      if (stateId) useEditorStore.getState().setActivePresentationState(stateId)
      useEditorStore.getState().selectNode('slide-card')
      const api = { localAgent: vi.fn(async () => ({ enabled: true, fileStatus: { status: 'current' } })) } as unknown as DesktopAPI
      const bridge = createCourseChatObservation(api, { projectId: project.id, projectPath })
      disposers.push(bridge.dispose)
      const request = await bridge.capture({ workspace: { version: 1, projectId: project.id, normalizedPath: projectPath.toLowerCase() },
        instruction: '将选中形状换成现有图片', scope: 'selection', purpose: 'local-edit', intent: 'edit' })
      const destination = request.destinations.find(value => value.kind === 'update' && value.target.itemId === 'slide-card')!
      const create = request.destinations.find(value => value.kind === 'create' && value.scope.owner === 'scene')!
      const prepared = await useEditorStore.getState().prepareGenerationCandidate(request, {
        version: 1, requestId: request.requestId, candidateId: crypto.randomUUID(), summary: '把形状换为图片', afterCommit: { version: 1, action: 'finish' },
        steps: [
          { id: 'image', tool: 'native.content', carrier: 'native', destination: create, input: { operation: 'insert', template: { nativeType: 'image', assetId: 'badge' } } },
          { id: 'replace', tool: 'selection.replace', carrier: 'native', destination, input: { replacementItemId: { $result: { stepId: 'image', kind: 'item-id', index: 0 } } } },
        ],
      })
      if (changeSelection) useEditorStore.getState().selectNode('slide-title')
      expect(bridge.isCurrent(request)).toBe(true)
      const applied = useEditorStore.getState().applyGenerationCandidate(prepared.previewId)
      expect(applied.status).toBe('committed')
      if (applied.status === 'stale') throw new Error('Expected actual receipt')
      const createdId = applied.receipt.affected.find(effect => effect.operation === 'created' && locateCourseLayer(document(), effect.id))!.id
      expect(locateCourseLayer(document(), createdId)!.item).toMatchObject({ content: { nativeType: 'image', data: { assetId: 'badge' } } })
      const expectedIds = [changeSelection ? 'slide-title' : createdId]
      expect(useEditorStore.getState().courseAuthoringSession!.itemIds).toEqual(expectedIds)
      expect(selectSlideAuthoringBackend(useEditorStore.getState())!.getSnapshot().selection.selectionIds).toEqual(expectedIds)
      const next = await bridge.capture({ workspace: request.workspace, instruction: '放大所选对象', scope: 'selection', purpose: 'local-edit', intent: 'edit' })
      expect(next.destinations.filter(value => value.kind === 'update').map(value => value.target.itemId)).toEqual(expectedIds)
      bridge.dispose()
    }
  })

  it.each([['slide', 'flow'], ['flow', 'spatial'], ['spatial', 'slide']] as const)('updates original %s while preserving %s browsing, saves and restores one history entry', async (source, destination) => {
    const f = await task(source), before = document(), previousHistory = history()
    browse(destination)
    const browsing = useEditorStore.getState(), selection = browsing.courseAuthoringSession!
    const flowSelection = browsing.flowSession?.selection, spatialSelection = browsing.spatialSession?.selection
    const camera = browsing.spatialSession?.sessionCamera, slideSelection = browsing.slideCandidateSnapshot?.selection
    expect(f.bridge.isCurrent(f.request)).toBe(true)
    const prepared = await useEditorStore.getState().prepareGenerationCandidate(f.request, f.candidate)
    const applied = useEditorStore.getState().applyGenerationCandidate(prepared.previewId)
    expect(applied.status).toBe('committed')
    expect(JSON.stringify(document())).toContain('后台修改已完成')
    const after = useEditorStore.getState()
    expect(after.courseAuthoringSession).toEqual({ ...selection, token: { ...selection.token, revision: document().revision } })
    expect(after.flowSession?.selection).toEqual(flowSelection)
    expect(after.spatialSession?.selection).toEqual(spatialSelection)
    expect(after.spatialSession?.sessionCamera).toEqual(camera)
    expect(after.slideCandidateSnapshot?.selection).toEqual(slideSelection)
    expect([after.flowSession, after.spatialSession, selectSlideAuthoringBackend(after)].filter(Boolean)).toHaveLength(1)
    expect(history().past).toHaveLength(previousHistory.past.length + 1)
    const saved = openCourseProjectArchive(after.exportV9SlideCandidateArchive()!).project
    expect(saved).toEqual(document())
    expect(f.bridge.isCurrent(f.request)).toBe(false)
    if (applied.status === 'stale') throw new Error('Expected actual receipt')
    const next = await f.bridge.captureNext(f.request, applied.receipt)
    expect(next.documentRevision).toBe(applied.receipt.afterRevision)
    expect(next.observation?.locationId).toBe(pages[source][0])
    expect(f.bridge.isCurrent(next)).toBe(true)
    useEditorStore.getState().undo()
    expect(document()).toEqual(before)
    expect(f.bridge.isCurrent(next)).toBe(false)
    useEditorStore.getState().redo()
    expect(document()).toEqual(saved)
    expect(f.bridge.isCurrent(next)).toBe(false)
  })

  it('preserves a teacher Flow text range change when the selected block IDs remain identical', async () => {
    const f = await task('flow')
    const destination = f.request.destinations.find(value => value.kind === 'update' && value.target.itemId === 'flow-paragraph')!
    if (destination.kind !== 'update') throw new Error('Expected Flow target')
    const prepared = await useEditorStore.getState().prepareGenerationCandidate(f.request, f.candidate)
    const itemIds = useEditorStore.getState().courseAuthoringSession!.itemIds
    useEditorStore.getState().runFlowAuthoringIntent(destination.target, { kind: 'select-blocks', blockIds: ['flow-paragraph'], focus: 'text',
      textRange: { blockId: 'flow-paragraph', start: 1, end: 3 } })
    const selection = useEditorStore.getState().flowSession!.selection
    expect(selection.textRange).toEqual({ blockId: 'flow-paragraph', start: 1, end: 3 })
    expect(useEditorStore.getState().courseAuthoringSession!.itemIds).toEqual(itemIds)
    expect(f.bridge.isCurrent(f.request)).toBe(true)
    expect(useEditorStore.getState().applyGenerationCandidate(prepared.previewId).status).toBe('committed')
    expect(useEditorStore.getState().flowSession!.selection).toEqual(selection)
  })

  it('rejects an already prepared background candidate when the teacher starts a Flow draft and keeps that draft untouched', async () => {
    const f = await task('slide'), before = document()
    const prepared = await useEditorStore.getState().prepareGenerationCandidate(f.request, f.candidate)
    browse('flow')
    const session = useEditorStore.getState().flowSession!
    const begun = beginFlowTextEdit({ project: document(), selection: session.selection, blockId: 'flow-paragraph' })
    if (!begun.ok) throw new Error(begun.reason)
    useEditorStore.getState().setFlowTextEdit(updateFlowTextDraft(begun.edit, { text: '教师尚未提交的讲义草稿' }))
    const draft = useEditorStore.getState().flowTextEdit
    expect(draft).not.toBeNull()
    expect(f.bridge.currentReason(f.request)).toContain('当前草稿已保留')
    expect(useEditorStore.getState().applyGenerationCandidate(prepared.previewId).status).toBe('stale')
    expect(useEditorStore.getState().flowTextEdit).toBe(draft)
    expect(document()).toBe(before)
  })
})
