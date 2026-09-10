import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import { createImageNode } from '@/renderer/project/nativeNodeFactories'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import { createCourseAuthoringSession } from '@/renderer/authoring/courseAuthoringSession'
import { createCourseChatObservation } from '@/renderer/ui/chat/courseChatObservation'
import type { DesktopAPI } from '@/shared/ipcTypes'

const h = vi.hoisted(() => ({ state: undefined as any, capture: vi.fn(), inspect: vi.fn() }))
vi.mock('@/renderer/store/editorStore', () => ({
  useEditorStore: { getState: () => h.state },
  selectActiveCourseProjectDocument: (state: any) => state.document,
  selectEffectiveLayerProjection: () => null,
  selectMediaAssetFiles: (state: any) => state.assetFiles,
}))
vi.mock('@/renderer/authoring/generation/authoringObservation', () => ({
  createAuthoringObservationController: () => ({ capture: h.capture, dispose() {} }),
}))
vi.mock('@/renderer/project/imageTransform', async importOriginal => ({
  ...await importOriginal<object>(), inspectImageTransformSource: h.inspect,
}))
beforeEach(() => { vi.clearAllMocks(); h.inspect.mockResolvedValue({ status: 'ready', width: 1, height: 1 }) })

function fixture() {
  const document = createBlankCourseProject({ includeDefaultController: false, controls: 'none' }), surface = document.surfaces[0]!
  if (surface.type !== 'slide') throw new Error('Slide required')
  surface.scenes[0]!.layerItems.push(sceneNodeToCourseLayerItem(createImageNode({ id: 'image', assetId: 'red' }), 0))
  document.assets.red = { id: 'red', kind: 'image', filename: 'red.png', mimeType: 'image/png', path: 'assets/red.png', byteLength: 1, width: 1, height: 1 }
  const owner = { projectId: document.id, projectPath: 'C:/preflight.h5lesson' }
  h.state = { document, projectPath: owner.projectPath, componentPackages: {}, assetFiles: { red: new Uint8Array([1]) },
    courseAuthoringSession: createCourseAuthoringSession({ locationId: document.startLocationId, surfaceType: 'slide', revision: 0, itemIds: ['image'] }) }
  h.capture.mockImplementation(async () => ({ document, resourceFiles: [], observation: { documentRevision: document.revision,
    sessionGeneration: h.state.courseAuthoringSession.token.generation, draftEpoch: 0, viewEpoch: 0, runtime: null,
    surfaceId: surface.id, locationId: document.startLocationId, stateId: null, source: 'authoring', capturedAt: 1,
    files: [{ fileId: 'current-frame', relativePath: 'observation/current-frame.png', mediaType: 'image/png', byteLength: 1, role: 'image' }] } }))
  const api = { localAgent: vi.fn(async () => ({ enabled: true, fileStatus: { status: 'current' } })) } as unknown as DesktopAPI
  const bridge = createCourseChatObservation(api, owner)
  const input = { workspace: { version: 1 as const, projectId: document.id, normalizedPath: 'c:/preflight.h5lesson' },
    scope: 'selection' as const, instruction: '把图片改绿', purpose: 'local-edit' as const, intent: 'edit' as const }
  return { bridge, input }
}

describe('generation snapshot source-preflight lifecycle', () => {
  it.each(['initial-revision', 'next-session', 'disposed'] as const)('rejects %s changes while source inspection is pending', async phase => {
    const { bridge, input } = fixture()
    const previous = phase === 'next-session' ? await bridge.capture(input) : undefined
    // A replaced immutable sidecar requires a new inspection on feedback capture.
    h.state.assetFiles = { red: new Uint8Array([2]) }
    let finish!: (value: { status: 'ready'; width: number; height: number }) => void
    h.inspect.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const pending = previous ? bridge.captureNext(previous) : bridge.capture(input)
    const result = pending.then(() => null, error => error)
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    if (phase === 'initial-revision') h.state.document.revision += 1
    else if (phase === 'disposed') bridge.dispose()
    else h.state.courseAuthoringSession = { ...h.state.courseAuthoringSession,
      token: { ...h.state.courseAuthoringSession.token, generation: h.state.courseAuthoringSession.token.generation + 1 } }
    finish({ status: 'ready', width: 1, height: 1 })
    expect(await result).toBeInstanceOf(Error)
    expect((await result).message).toContain(phase === 'disposed' ? 'stale：任务已停止或重新开始' : 'stale：图片源预检期间')
    bridge.dispose()
  })
})
