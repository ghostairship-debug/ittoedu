import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addPptxTextNode } from '@/renderer/export/pptxTextAndShape'
import { createTextNode, type TextNodeOptions } from '@/renderer/project/nativeNodeFactories'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import {
  createCourseProjectArchive,
  openCourseProjectArchive,
} from '@/renderer/project/courseProjectArchive'
import {
  selectActiveScene,
  useEditorStore,
  selectActiveCourseProjectDocument,
  selectActivePresentationStateId,
} from '@/renderer/store/editorStore'
import { materializeScene } from '@/shared/presentation'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import type { CourseProjectDocument, NativeLayerItem } from '@/shared/courseProjectTypes'

function activeHistory() {
  const state = useEditorStore.getState()
  const backend = state.slideBackend
  if (!backend) throw new Error('expected active slideBackend')
  return backend.getSession().history
}

function materialized(
  scene: object,
  stateId?: string | null,
) {
  return materializeScene(scene as Parameters<typeof materializeScene>[0], stateId)
}

function canvasContext(): CanvasRenderingContext2D {
  return {
    arc: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    clip: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    lineTo: vi.fn(),
    measureText: vi.fn(() => ({ width: 20 })),
    moveTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    restore: vi.fn(),
    save: vi.fn(),
    scale: vi.fn(),
    stroke: vi.fn(),
  } as unknown as CanvasRenderingContext2D
}

function blankSlideProject(): CourseProjectDocument {
  return createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
}

function slideScene(project: CourseProjectDocument) {
  const surface = project.surfaces[0]
  if (!surface || surface.type !== 'slide') throw new Error('expected slide surface')
  const scene = surface.scenes[0]
  if (!scene) throw new Error('expected slide scene')
  return scene
}

type TextLayerItem = NativeLayerItem & {
  kind: 'native'
  content: Extract<NativeLayerItem['content'], { nativeType: 'text' }>
}

function addTextLayer(
  project: CourseProjectDocument,
  options: TextNodeOptions,
): TextLayerItem {
  const item = sceneNodeToCourseLayerItem(
    createTextNode(options),
    slideScene(project).layerItems.length,
  )
  if (item.kind !== 'native' || item.content.nativeType !== 'text') {
    throw new Error('expected text layer item')
  }
  slideScene(project).layerItems.push(item)
  return item as TextLayerItem
}

beforeEach(() => {
  useEditorStore.getState().createNewProject()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Course Project V9 native text emphasis', () => {
  it('normalizes a missing node default and preserves run-level semantics', () => {
    const project = blankSlideProject()
    const item = addTextLayer(project, {
      text: '春风',
      runs: [{ start: 0, end: 1, style: { emphasis: true } }],
    })
    Reflect.deleteProperty(item.content.data.style, 'emphasis')

    const parsed = courseProjectDocumentSchema.parse(project)
    const restored = slideScene(parsed).layerItems[0]
    expect(restored).toMatchObject({
      kind: 'native',
      content: {
        nativeType: 'text',
        data: {
          style: { emphasis: false },
          runs: [{ start: 0, end: 1, style: { emphasis: true } }],
        },
      },
    })
  })

  it('stores node and run emphasis through a .h5lesson save/open round trip', () => {
    const project = blankSlideProject()
    addTextLayer(project, {
      text: '重点内容',
      runs: [{ start: 2, end: 4, style: { emphasis: false } }],
      style: { emphasis: true },
    })

    const archive = createCourseProjectArchive({
      project,
      assetFiles: {},
      componentFiles: {},
    })
    const restored = slideScene(openCourseProjectArchive(archive).project).layerItems[0]

    expect(restored).toMatchObject({
      kind: 'native',
      content: {
        nativeType: 'text',
        data: {
          style: { emphasis: true },
          runs: [{ start: 2, end: 4, style: { emphasis: false } }],
        },
      },
    })
  })

  it('writes named-state emphasis through the same update and undo path', () => {
    const store = useEditorStore.getState()
    store.addTextNode()
    const nodeId = selectActiveScene(useEditorStore.getState()).nodes[0]!.id
    store.addPresentationState('着重状态')
    const stateId = selectActivePresentationStateId(useEditorStore.getState())!
    const historyBefore = activeHistory().past.length

    useEditorStore.getState().updateNode(nodeId, {
      runs: [{ start: 0, end: 2, style: { emphasis: false } }],
      style: { emphasis: true },
    })

    const scene = selectActiveScene(useEditorStore.getState())
    expect(scene.nodes[0]).toMatchObject({ style: { emphasis: false }, runs: [] })
    expect(materialized(scene, stateId).nodes[0]).toMatchObject({
      style: { emphasis: true },
      runs: [{ start: 0, end: 2, style: { emphasis: false } }],
    })
    expect(courseProjectDocumentSchema.safeParse(selectActiveCourseProjectDocument(useEditorStore.getState())!).success)
      .toBe(true)
    expect(activeHistory().past).toHaveLength(historyBefore + 1)

    useEditorStore.getState().undo()
    expect(materialized(
      selectActiveScene(useEditorStore.getState()),
      stateId,
    ).nodes[0]).toMatchObject({ style: { emphasis: false }, runs: [] })
  })

  it('commits a local emphasis command as one undoable and redoable text edit', () => {
    const store = useEditorStore.getState()
    store.addTextNode()
    const node = selectActiveScene(useEditorStore.getState()).nodes[0]!
    if (node.type !== 'text') throw new Error('Expected text node')
    const historyBefore = activeHistory().past.length

    store.beginTextEdit(node.id, 'canvas')
    store.updateTextEditDraft(
      node.id,
      node.text ?? '',
      [{ start: 0, end: 2, style: { emphasis: true } }],
      node.height,
      node.width,
    )
    store.commitTextEdit()

    expect(selectActiveScene(useEditorStore.getState()).nodes[0]).toMatchObject({
      runs: [{ start: 0, end: 2, style: { emphasis: true } }],
    })
    expect(activeHistory().past).toHaveLength(historyBefore + 1)

    useEditorStore.getState().undo()
    expect(selectActiveScene(useEditorStore.getState()).nodes[0])
      .toMatchObject({ runs: [] })
    useEditorStore.getState().redo()
    expect(selectActiveScene(useEditorStore.getState()).nodes[0]).toMatchObject({
      runs: [{ start: 0, end: 2, style: { emphasis: true } }],
    })
  })

  it('keeps node and run emphasis when copying and pasting text', () => {
    const store = useEditorStore.getState()
    store.addTextNode()
    const nodeId = selectActiveScene(useEditorStore.getState()).nodes[0]!.id
    store.updateNode(nodeId, {
      runs: [{ start: 0, end: 2, style: { emphasis: false } }],
      style: { emphasis: true },
    })

    useEditorStore.getState().copySelectedNodes()
    useEditorStore.getState().pasteNodes()

    const pasted = selectActiveScene(useEditorStore.getState()).nodes[1]
    expect(pasted).toMatchObject({
      type: 'text',
      style: { emphasis: true },
      runs: [{ start: 0, end: 2, style: { emphasis: false } }],
    })
    expect(pasted?.id).not.toBe(nodeId)
  })

  it('rasterizes only visibly emphasized PPTX text nodes', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      canvasContext(),
    )
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
      'data:image/png;base64,AA==',
    )
    const slide = {
      addImage: vi.fn(),
      addText: vi.fn(),
    }
    const scale = { x: 13.333 / 1280, y: 7.5 / 720 }

    addPptxTextNode(
      slide as never,
      createTextNode({ text: '着重', style: { emphasis: true } }),
      scale,
    )
    addPptxTextNode(
      slide as never,
      createTextNode({ text: '普通', style: { emphasis: false } }),
      scale,
    )
    addPptxTextNode(
      slide as never,
      createTextNode({
        text: '显式取消',
        runs: [{ start: 0, end: 4, style: { emphasis: false } }],
        style: { emphasis: true },
      }),
      scale,
    )

    expect(slide.addImage).toHaveBeenCalledTimes(1)
    expect(slide.addText).toHaveBeenCalledTimes(2)
  })
})
