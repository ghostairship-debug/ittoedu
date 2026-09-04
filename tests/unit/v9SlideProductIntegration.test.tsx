import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import { COURSE_PROJECT_SCHEMA_VERSION } from '@/shared/courseProjectTypes'
import { stageResizeHandleWorldPoint } from '@/renderer/authoring/stageViewportTransform'
import {
  addSlideImageLayer,
  addSlideRuntimeLayer,
} from '@/renderer/course/v9SlideContentCommands'
import {
  createSlideAuthoringBackend,
  openSlideAuthoringSession,
} from '@/renderer/course/slideAuthoringBackend'
import { onElementAnimationPreviewRequested } from '@/renderer/phaser/elementAnimationPreviewBus'
import {
  selectEditingNodes,
  selectSelectedNodeId,
  selectSlideAuthoringSnapshot,
  selectSlideBackendKind,
  selectSlideAuthoringBackend,
  selectSlideAuthoringDocument,
  useEditorStore,
} from '@/renderer/store/editorStore'
import { ElementsTab } from '@/renderer/ui/ElementsTab'
import { NodesTab } from '@/renderer/ui/NodesTab'
import { PropertiesTab } from '@/renderer/ui/PropertiesTab'
import { usePropertiesContext } from '@/renderer/ui/properties/PropertiesContextAdapter'
import type { SlideNativeTextCommands } from '@/renderer/ui/properties/SlideNativePropertiesPanel'
import { ScenePanel } from '@/renderer/ui/ScenePanel'
import {
  createSlideWorkspaceAuthoringController,
  listSlideWorkspaceHitTargets,
  type SlideWorkspaceAuthoringPorts,
} from '@/renderer/ui/workspaceSlideAuthoring'
import { hitTestV9SlideLayerItems } from '@/renderer/phaser/v9SlideHitAdapter'

/**
 * Proves R2-Z wiring: same V8 UI components against the R3-CUT default V9 Slide candidate.
 * Does not prove MediaTab, global/controller, Player, or a live Electron window.
 */
const NOW = '2026-08-17T14:30:00.000Z'
const VIEW = {
  viewport: { x: 0, y: 0, width: 1280, height: 720 },
  zoom: 1,
  pan: { x: 0, y: 0 },
}

let observedTextCommands: SlideNativeTextCommands | null = null

function TextCommandsProbe() {
  const context = usePropertiesContext({ onReplaceImage: () => undefined })
  observedTextCommands = context.kind === 'slide-native'
    ? context.commands.text
    : null
  return null
}

function v9EmptySlideFixture() {
  return courseProjectDocumentSchema.parse({
    schemaVersion: COURSE_PROJECT_SCHEMA_VERSION,
    id: 'r2z-slide-product',
    revision: 1,
    title: 'R2-Z candidate',
    createdAt: NOW,
    updatedAt: NOW,
    assets: {
      'asset-photo': {
        id: 'asset-photo',
        filename: 'photo.png',
        mimeType: 'image/png',
        kind: 'image',
        path: 'assets/photo.png',
        byteLength: 8,
        width: 800,
        height: 600,
      },
    },
    componentPackages: {},
    designTokens: {
      fonts: [{
        id: 'body',
        label: '正文',
        fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      }],
      colors: [
        { id: 'background', label: '背景', color: '#ffffff' },
        { id: 'text', label: '正文', color: '#1f2937' },
      ],
    },
    media: {
      audio: {
        defaultMuted: false,
        masterVolume: 1,
        channelVolumes: { music: 1, narration: 1, sfx: 1, ui: 1, video: 1 },
        sounds: {},
        narrationDucking: { enabled: true, musicVolume: 0.3, fadeMs: 250 },
      },
    },
    playback: {
      controls: 'none',
      keyboardNavigation: true,
      presenter: { enabled: true, strategy: 'scene-navigation', additionalBindings: [] },
    },
    courseState: [],
    navigationGuards: [],
    globalLayerItems: [],
    globalInteractions: [],
    locations: [{
      id: 'location-scene-1',
      label: '场景 1',
      kind: 'slide-scene',
      surfaceId: 'surface-slide',
      sceneId: 'scene-1',
    }],
    startLocationId: 'location-scene-1',
    surfaces: [{
      id: 'surface-slide',
      title: '演示',
      type: 'slide',
      canvas: { width: 1280, height: 720 },
      surfaceLayerItems: [],
      scenes: [{
        id: 'scene-1',
        name: '场景 1',
        backgroundColor: '#ffffff',
        layerItems: [],
        interactions: [],
      }],
    }],
  })
}

function injectCandidate() {
  const backend = createSlideAuthoringBackend(
    openSlideAuthoringSession(v9EmptySlideFixture()),
  )
  useEditorStore.getState().injectV9SlideCandidateBackend(backend)
  return backend
}

function storeAuthoringPorts(): SlideWorkspaceAuthoringPorts {
  return {
    getBackend: () => selectSlideAuthoringBackend(useEditorStore.getState()),
    commandPort: {
      run: (command) => (
        useEditorStore.getState().runSlideCandidateCommand(command)
      ),
    },
  }
}

function drawingContext(): CanvasRenderingContext2D {
  return {
    arc: vi.fn(),
    bezierCurveTo: vi.fn(),
    beginPath: vi.fn(),
    clearRect: vi.fn(),
    clip: vi.fn(),
    closePath: vi.fn(),
    drawImage: vi.fn(),
    ellipse: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    lineTo: vi.fn(),
    measureText: vi.fn((value: string) => ({
      width: Math.max(8, Array.from(value).length * 12),
    })),
    moveTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    rect: vi.fn(),
    restore: vi.fn(),
    rotate: vi.fn(),
    roundRect: vi.fn(),
    save: vi.fn(),
    scale: vi.fn(),
    setLineDash: vi.fn(),
    stroke: vi.fn(),
    strokeRect: vi.fn(),
    translate: vi.fn(),
  } as unknown as CanvasRenderingContext2D
}

function nativeFrame(layerItemId: string) {
  const document = selectSlideAuthoringDocument(useEditorStore.getState())
  const surface = document?.surfaces.find((candidate) => candidate.type === 'slide')
  if (!surface || surface.type !== 'slide') throw new Error('expected slide surface')
  const item = surface.scenes[0]?.layerItems.find((candidate) => candidate.layerItemId === layerItemId)
  if (!item || item.kind !== 'native') throw new Error(`expected native ${layerItemId}`)
  return item.frame
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    drawingContext(),
  )
  useEditorStore.getState().clearV9SlideCandidateBackend()
  useEditorStore.getState().createNewProject()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  useEditorStore.getState().clearV9SlideCandidateBackend()
})

function slideSceneLayerItems() {
  const document = selectSlideAuthoringDocument(useEditorStore.getState())
  const surface = document?.surfaces.find((candidate) => candidate.type === 'slide')
  if (!surface || surface.type !== 'slide') return []
  return surface.scenes[0]?.layerItems ?? []
}

describe('V9 slide product integration on the real V8 UI', () => {
  it('defaults to the V9 slide authoring backend and writes inserted text into the candidate document', () => {
    expect(selectSlideBackendKind(useEditorStore.getState())).toBe('slide-authoring')
    expect(selectSlideAuthoringBackend(useEditorStore.getState())).not.toBeNull()
    expect(selectSlideAuthoringSnapshot(useEditorStore.getState())).not.toBeNull()
    expect(selectSlideAuthoringDocument(useEditorStore.getState())?.schemaVersion).toBe(
      COURSE_PROJECT_SCHEMA_VERSION,
    )

    const revisionBefore = selectSlideAuthoringSnapshot(useEditorStore.getState())?.revision ?? 0
    const nodesBefore = selectEditingNodes(useEditorStore.getState()).length
    render(<ElementsTab onAddImage={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: '文本' }))
    expect(selectEditingNodes(useEditorStore.getState())).toHaveLength(nodesBefore + 1)
    expect(selectEditingNodes(useEditorStore.getState()).at(-1)?.type).toBe('text')
    expect(selectSlideAuthoringSnapshot(useEditorStore.getState())?.revision).toBe(revisionBefore + 1)
    expect(slideSceneLayerItems().some((item) => (
      item.kind === 'native' && item.content.nativeType === 'text'
    ))).toBe(true)
  })

  it('notifies Zustand after a successful candidate command', () => {
    injectCandidate()
    let notifications = 0
    const unsubscribe = useEditorStore.subscribe(() => {
      notifications += 1
    })
    render(<ElementsTab onAddImage={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: '文本' }))
    unsubscribe()
    expect(notifications).toBeGreaterThan(0)
    expect(selectSlideAuthoringSnapshot(useEditorStore.getState())?.revision).toBe(2)
    expect(selectSlideAuthoringDocument(useEditorStore.getState())?.schemaVersion).toBe(9)
    expect(slideSceneLayerItems().some((item) => (
      item.kind === 'native' && item.content.nativeType === 'text'
    ))).toBe(true)
  })

  it('inserts two staggered texts, west-resizes, applies selection bold, then undoes', () => {
    injectCandidate()
    render(<ScenePanel />)
    render(<ElementsTab onAddImage={() => undefined} />)

    fireEvent.click(screen.getByTestId('add-text'))
    fireEvent.click(screen.getByTestId('add-text'))

    const nodes = selectEditingNodes(useEditorStore.getState())
    expect(nodes).toHaveLength(2)
    expect(nodes.every((node) => node.type === 'text')).toBe(true)
    const ordered = [...nodes].sort((left, right) => left.x - right.x || left.y - right.y)
    expect(ordered[1]?.x).toBe((ordered[0]?.x ?? 0) + 20)
    expect(ordered[1]?.y).toBe(ordered[0]?.y)
    expect(selectSlideAuthoringDocument(useEditorStore.getState())?.schemaVersion).toBe(9)
    expect(slideSceneLayerItems().filter((item) => (
      item.kind === 'native' && item.content.nativeType === 'text'
    ))).toHaveLength(2)

    const firstId = ordered[0]!.id
    const secondId = ordered[1]!.id
    const startFrame = nativeFrame(firstId)

    useEditorStore.getState().setActiveTab('layers')
    render(<NodesTab />)
    const firstRow = screen.getByTestId(`node-item-${firstId}`).querySelector('.node-name')
    expect(firstRow).toBeTruthy()
    fireEvent.click(firstRow!, { detail: 0 })

    expect(selectSelectedNodeId(useEditorStore.getState())).toBe(firstId)

    const controller = createSlideWorkspaceAuthoringController(storeAuthoringPorts())
    controller.selectFromLayerIds([firstId], VIEW)
    const west = stageResizeHandleWorldPoint(
      {
        x: startFrame.x,
        y: startFrame.y,
        width: startFrame.width,
        height: startFrame.height,
      },
      'w',
    )
    const down = controller.pointerDown({ x: west.x, y: west.y }, VIEW)
    expect(down.kind).toBe('slide-authoring')
    const revisionAfterDown = selectSlideAuthoringSnapshot(useEditorStore.getState())?.revision
    controller.pointerMove({ x: west.x - 40, y: west.y }, VIEW)
    expect(selectSlideAuthoringSnapshot(useEditorStore.getState())?.revision).toBe(revisionAfterDown)
    const up = controller.pointerUp({ x: west.x - 40, y: west.y }, VIEW)
    expect(up.kind).toBe('slide-authoring')
    if (up.kind !== 'slide-authoring') throw new Error('expected slide-authoring')
    expect(up.command?.ok).toBe(true)
    expect(up.command?.historyEntry).toBe(true)
    expect(nativeFrame(firstId)).toMatchObject({
      x: startFrame.x - 40,
      width: startFrame.width + 40,
      y: startFrame.y,
      height: startFrame.height,
    })

    render(<PropertiesTab onReplaceImage={() => undefined} />)
    const textarea = screen.getByRole('textbox', { name: '文字内容' }) as HTMLTextAreaElement
    act(() => textarea.focus())
    textarea.setSelectionRange(0, 2)
    fireEvent.mouseDown(screen.getByRole('button', { name: '加粗' }))
    fireEvent.click(screen.getByRole('button', { name: '加粗' }))

    const textNode = selectEditingNodes(useEditorStore.getState()).find((node) => node.id === firstId)
    expect(textNode?.type).toBe('text')
    if (textNode?.type !== 'text') throw new Error('expected text')
    expect(textNode.runs?.some((run) => run.start === 0 && run.end === 2 && run.style.bold === true)).toBe(true)

    const revisionAfterBold = selectSlideAuthoringSnapshot(useEditorStore.getState())?.revision
    useEditorStore.getState().undo()
    expect(selectSlideAuthoringSnapshot(useEditorStore.getState())?.revision).toBe((revisionAfterBold ?? 1) - 1)
    const undone = selectEditingNodes(useEditorStore.getState()).find((node) => node.id === firstId)
    expect(undone?.type).toBe('text')
    if (undone?.type !== 'text') throw new Error('expected text')
    expect(undone.runs?.some((run) => run.style.bold === true)).toBe(false)
    expect(selectEditingNodes(useEditorStore.getState()).map((node) => node.id)).toEqual(
      expect.arrayContaining([firstId, secondId]),
    )
    expect(selectSlideAuthoringDocument(useEditorStore.getState())?.schemaVersion).toBe(9)
    expect(slideSceneLayerItems().map((item) => item.layerItemId)).toEqual(
      expect.arrayContaining([firstId, secondId]),
    )
  })

  it('writes inserted image/runtime into the candidate session and hits them with the existing adapter', () => {
    injectCandidate()
    const image = useEditorStore.getState().applySlideCandidateCommand((session) =>
      addSlideImageLayer(session, { assetId: 'asset-photo' }, {
        expectedRevision: session.history.present.revision,
      }),
    )
    expect(image.ok).toBe(true)
    const imageId = image.selection?.selectionIds[0]
    expect(imageId).toBeTruthy()

    const runtime = useEditorStore.getState().applySlideCandidateCommand((session) =>
      addSlideRuntimeLayer(session, {}, {
        expectedRevision: session.history.present.revision,
      }),
    )
    expect(runtime.ok).toBe(true)
    const runtimeId = runtime.selection?.selectionIds[0]
    expect(runtimeId).toBeTruthy()

    const targets = listSlideWorkspaceHitTargets(
      selectSlideAuthoringBackend(useEditorStore.getState()),
    )
    expect(targets.map((target) => target.layerItemId)).toEqual(
      expect.arrayContaining([imageId, runtimeId]),
    )
    const imageTarget = targets.find((target) => target.layerItemId === imageId)!
    const runtimeTarget = targets.find((target) => target.layerItemId === runtimeId)!
    expect(hitTestV9SlideLayerItems(targets, {
      x: imageTarget.bounds.x + 8,
      y: imageTarget.bounds.y + 8,
    })?.layerItemId).toBe(imageId)
    expect(hitTestV9SlideLayerItems(targets, {
      x: runtimeTarget.bounds.x + 8,
      y: runtimeTarget.bounds.y + 8,
    })?.layerItemId).toBe(runtimeId)

    const controller = createSlideWorkspaceAuthoringController(storeAuthoringPorts())
    const selected = controller.selectFromLayerIds([imageId!], VIEW)
    expect(selected.kind).toBe('slide-authoring')
    if (selected.kind !== 'slide-authoring') throw new Error('expected slide-authoring')
    expect(selected.targets?.[0]?.layerItemId).toBe(imageId)
    expect(JSON.stringify(selected.targets?.[0])).not.toMatch(/hitId/)
  })

  it('previews simple entrance animation through the existing motion bus and ignores Delete while editing text', () => {
    injectCandidate()
    render(<ElementsTab onAddImage={() => undefined} />)
    fireEvent.click(screen.getByTestId('add-text'))
    const nodeId = selectEditingNodes(useEditorStore.getState())[0]!.id
    useEditorStore.getState().selectNode(nodeId)
    useEditorStore.getState().setEditorMode('simple')

    const previews: Array<{ actionType: string }> = []
    const stop = onElementAnimationPreviewRequested((request) => {
      previews.push({ actionType: request.action.type })
    })
    useEditorStore.getState().setSimpleEntranceAnimation(nodeId, {
      effect: 'slide',
      direction: 'left',
      durationMs: 420,
      delayMs: 80,
    })
    expect(previews).toEqual([])
    render(<PropertiesTab onReplaceImage={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: '预览' }))
    stop()
    expect(previews).toEqual([{ actionType: 'node.enter' }])

    useEditorStore.getState().beginTextEdit(nodeId, 'canvas')
    const layerCount = selectEditingNodes(useEditorStore.getState()).length
    useEditorStore.getState().deleteSelectedNodes()
    expect(selectEditingNodes(useEditorStore.getState())).toHaveLength(layerCount)
    expect(useEditorStore.getState().errorMessage).toMatch(/文字|Delete|文本/)
  })

  it('projects a live canvas text draft into Properties and transfers focus as one new edit', async () => {
    injectCandidate()
    act(() => useEditorStore.getState().addTextNode())
    const nodeId = selectSelectedNodeId(useEditorStore.getState())
    const backend = selectSlideAuthoringBackend(useEditorStore.getState())
    if (!nodeId || !backend) throw new Error('expected selected Slide text')
    const historyBefore = backend.getSession().history.past.length
    render(<PropertiesTab onReplaceImage={() => undefined} />)

    act(() => {
      useEditorStore.getState().beginTextEdit(nodeId, 'canvas')
      useEditorStore.getState().updateTextEditDraft(
        nodeId,
        '画布编辑中的草稿',
        [],
        80,
      )
    })

    const textarea = screen.getByRole('textbox', { name: '文字内容' })
    expect(textarea).toHaveValue('画布编辑中的草稿')
    expect(selectSlideAuthoringBackend(useEditorStore.getState())
      ?.getSession().history.past).toHaveLength(historyBefore)

    fireEvent.focus(textarea)
    await act(async () => Promise.resolve())
    expect(useEditorStore.getState().v9ContentEdit?.source).toBe('properties')
    expect(selectSlideAuthoringBackend(useEditorStore.getState())
      ?.getSession().history.past).toHaveLength(historyBefore + 1)

    fireEvent.change(textarea, { target: { value: '属性栏最终文字' } })
    fireEvent.blur(textarea)
    expect(selectEditingNodes(useEditorStore.getState())[0]).toMatchObject({
      id: nodeId,
      text: '属性栏最终文字',
    })
    expect(selectSlideAuthoringBackend(useEditorStore.getState())
      ?.getSession().history.past).toHaveLength(historyBefore + 2)
  })

  it('属性输入在 IME 组合期间不提交，并在目标切换后拒绝迟到草稿', () => {
    injectCandidate()
    act(() => useEditorStore.getState().addTextNode())
    const firstId = selectEditingNodes(useEditorStore.getState())[0]!.id
    render(<PropertiesTab onReplaceImage={() => undefined} />)
    const nameInput = screen.getByRole('textbox', { name: '名称' })
    const beforeCompositionRevision = selectSlideAuthoringDocument(
      useEditorStore.getState(),
    )!.revision

    fireEvent.compositionStart(nameInput)
    fireEvent.change(nameInput, { target: { value: '组合中的名称' } })
    fireEvent.keyDown(nameInput, { key: 'Enter', isComposing: true })
    expect(selectSlideAuthoringDocument(useEditorStore.getState())!.revision)
      .toBe(beforeCompositionRevision)
    expect(slideSceneLayerItems().find((item) => item.layerItemId === firstId)?.label)
      .not.toBe('组合中的名称')

    fireEvent.compositionEnd(nameInput)
    fireEvent.change(nameInput, { target: { value: '不得迟到写入' } })
    act(() => useEditorStore.getState().addTextNode())
    const secondId = selectSelectedNodeId(useEditorStore.getState())
    expect(secondId).not.toBe(firstId)
    expect(nameInput).toHaveValue('不得迟到写入')
    expect(nameInput).toHaveAttribute('aria-invalid', 'true')

    fireEvent.blur(nameInput)
    expect(useEditorStore.getState().errorMessage).toMatch(/目标已经改变|草稿/)
    expect(slideSceneLayerItems().map((item) => item.label)).not.toContain('不得迟到写入')
  })

  it('同值图层切换后拒绝滑杆的迟到 pointerup，不写入新目标', () => {
    injectCandidate()
    act(() => useEditorStore.getState().addRectangleNode())
    const firstId = selectSelectedNodeId(useEditorStore.getState())
    act(() => useEditorStore.getState().addRectangleNode())
    const secondId = selectSelectedNodeId(useEditorStore.getState())
    if (!firstId || !secondId || firstId === secondId) throw new Error('expected two shapes')
    act(() => useEditorStore.getState().selectNode(firstId))
    render(<PropertiesTab onReplaceImage={() => undefined} />)
    const slider = screen.getByRole('slider', { name: '填充透明度' })
    const firstShape = selectEditingNodes(useEditorStore.getState()).find(
      (node) => node.id === firstId,
    )
    if (!firstShape || firstShape.type !== 'shape' || !firstShape.style) {
      throw new Error('expected first shape')
    }
    const originalOpacity = firstShape.style.fillOpacity

    fireEvent.pointerDown(slider)
    fireEvent.change(slider, { target: { value: '37' } })
    const beforeSwitch = selectSlideAuthoringBackend(useEditorStore.getState())!.getSession()
    expect(beforeSwitch.history.present.revision)
      .toBe(selectSlideAuthoringDocument(useEditorStore.getState())!.revision)
    act(() => useEditorStore.getState().selectNode(secondId))
    const beforeLate = selectSlideAuthoringBackend(useEditorStore.getState())!.getSession()
    fireEvent.pointerUp(slider)
    const afterLate = selectSlideAuthoringBackend(useEditorStore.getState())!.getSession()

    expect(afterLate).toBe(beforeLate)
    expect(afterLate.history).toBe(beforeLate.history)
    expect(afterLate.selection).toBe(beforeLate.selection)
    expect(selectSelectedNodeId(useEditorStore.getState())).toBe(secondId)
    for (const id of [firstId, secondId]) {
      const shape = selectEditingNodes(useEditorStore.getState()).find((node) => node.id === id)
      if (!shape || shape.type !== 'shape' || !shape.style) throw new Error('expected shape')
      expect(shape.style.fillOpacity).toBe(originalOpacity)
    }
    expect(useEditorStore.getState().errorMessage).toMatch(/目标已经改变|草稿/)
  })

  it.each(['blur', 'escape', 'commit'] as const)(
    '文字属性目标切换后拒绝迟到的 %s 终止事件且不触碰新编辑租约',
    (terminal) => {
      injectCandidate()
      act(() => {
        useEditorStore.getState().addTextNode()
        useEditorStore.getState().addTextNode()
      })
      const [firstId, secondId] = selectEditingNodes(useEditorStore.getState())
        .map((node) => node.id)
      act(() => useEditorStore.getState().selectNode(firstId!))
      render(<PropertiesTab onReplaceImage={() => undefined} />)
      const textarea = screen.getByRole('textbox', { name: '文字内容' })
      fireEvent.focus(textarea)
      fireEvent.change(textarea, { target: { value: 'A draft' } })

      act(() => {
        const store = useEditorStore.getState()
        store.selectNode(secondId!)
        store.beginTextEdit(secondId!, 'properties')
        store.updateTextEditDraft(secondId!, 'B live draft', [])
      })
      const beforeLate = useEditorStore.getState()
      const beforeBackend = selectSlideAuthoringBackend(beforeLate)!
      const beforeSession = beforeBackend.getSession()
      const beforeEdit = beforeLate.v9ContentEdit
      if (!beforeEdit || beforeEdit.kind !== 'text' || !('text' in beforeEdit.draft)) {
        throw new Error('expected B text edit')
      }
      expect(beforeEdit.target.layerItemId).toBe(secondId)
      expect(beforeEdit.draft.text).toBe('B live draft')

      if (terminal === 'blur') fireEvent.blur(textarea)
      else if (terminal === 'escape') fireEvent.keyDown(textarea, { key: 'Escape' })
      else fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true })

      const afterLate = useEditorStore.getState()
      const afterBackend = selectSlideAuthoringBackend(afterLate)!
      expect(afterBackend).toBe(beforeBackend)
      expect(afterBackend.getSession()).toBe(beforeSession)
      expect(afterBackend.getSession().history).toBe(beforeSession.history)
      expect(afterBackend.getSession().selection).toBe(beforeSession.selection)
      expect(afterLate.v9ContentEdit).toBe(beforeEdit)
      expect(afterLate.dirty).toBe(beforeLate.dirty)
      expect(selectSelectedNodeId(afterLate)).toBe(secondId)
      expect(selectEditingNodes(afterLate).find((node) => node.id === secondId)?.type).toBe('text')
      expect(afterLate.errorMessage).toMatch(/目标已经改变|草稿/)
    },
  )

  it('同一批次内旧文字命令不能提交、取消或格式化新目标的精确编辑租约', () => {
    injectCandidate()
    act(() => {
      useEditorStore.getState().addTextNode()
      useEditorStore.getState().addTextNode()
    })
    const [firstId, secondId] = selectEditingNodes(useEditorStore.getState())
      .map((node) => node.id)
    act(() => useEditorStore.getState().selectNode(firstId!))
    observedTextCommands = null
    render(<TextCommandsProbe />)
    act(() => observedTextCommands?.beginEdit('properties'))
    act(() => observedTextCommands?.updateDraft('A draft'))
    const staleACommands = observedTextCommands as SlideNativeTextCommands | null
    if (!staleACommands) throw new Error('expected A text commands')

    let beforeLate = useEditorStore.getState()
    act(() => {
      const store = useEditorStore.getState()
      store.selectNode(secondId!)
      store.beginTextEdit(secondId!, 'properties')
      store.updateTextEditDraft(secondId!, 'B exact live draft', [])
      beforeLate = useEditorStore.getState()
      staleACommands.commitEdit()
      staleACommands.cancelEdit()
      staleACommands.toggleStyle('bold', { start: 0, end: 1 })
    })

    const afterLate = useEditorStore.getState()
    const beforeLateEdit = beforeLate.v9ContentEdit
    if (!beforeLateEdit || beforeLateEdit.kind !== 'text' || !('text' in beforeLateEdit.draft)) {
      throw new Error('expected exact B edit')
    }
    expect(beforeLateEdit.target.layerItemId).toBe(secondId)
    expect(beforeLateEdit.draft.text).toBe('B exact live draft')
    expect(afterLate.v9ContentEdit).toBe(beforeLate.v9ContentEdit)
    expect(selectSlideAuthoringBackend(afterLate)).toBe(selectSlideAuthoringBackend(beforeLate))
    expect(selectSlideAuthoringBackend(afterLate)!.getSession())
      .toBe(selectSlideAuthoringBackend(beforeLate)!.getSession())
    expect(afterLate.assetFiles).toBe(beforeLate.assetFiles)
    expect(afterLate.componentPackages).toBe(beforeLate.componentPackages)
    expect(afterLate.courseAuthoringSession).toBe(beforeLate.courseAuthoringSession)
  })

  it('字体草稿不会在目标切换后写入新元素，并可在重置后正常提交', () => {
    injectCandidate()
    act(() => {
      useEditorStore.getState().addTextNode()
      useEditorStore.getState().addTextNode()
    })
    const [firstId, secondId] = selectEditingNodes(useEditorStore.getState())
      .map((node) => node.id)
    act(() => useEditorStore.getState().selectNode(firstId!))
    render(<PropertiesTab onReplaceImage={() => undefined} />)
    const font = screen.getByRole('combobox', { name: '字体' })
    fireEvent.focus(font)
    fireEvent.change(font, { target: { value: 'Stale Custom Font' } })

    act(() => useEditorStore.getState().selectNode(secondId!))
    const beforeLate = selectSlideAuthoringBackend(useEditorStore.getState())!.getSession()
    fireEvent.blur(font)
    const afterLate = selectSlideAuthoringBackend(useEditorStore.getState())!.getSession()
    expect(afterLate).toBe(beforeLate)
    expect(afterLate.history).toBe(beforeLate.history)
    expect(afterLate.selection).toBe(beforeLate.selection)
    const secondBeforeCommit = selectEditingNodes(useEditorStore.getState())
      .find((node) => node.id === secondId)
    expect(secondBeforeCommit?.type).toBe('text')
    if (secondBeforeCommit?.type !== 'text') throw new Error('expected text')
    expect(secondBeforeCommit.style?.fontFamily).not.toBe('Stale Custom Font')
    const firstBeforeCommit = selectEditingNodes(useEditorStore.getState())
      .find((node) => node.id === firstId)
    expect(firstBeforeCommit?.type).toBe('text')
    if (firstBeforeCommit?.type !== 'text') throw new Error('expected text')
    expect(firstBeforeCommit.style?.fontFamily).not.toBe('Stale Custom Font')

    fireEvent.focus(font)
    fireEvent.change(font, { target: { value: 'KaiTi' } })
    fireEvent.blur(font)
    const secondAfterCommit = selectEditingNodes(useEditorStore.getState())
      .find((node) => node.id === secondId)
    expect(secondAfterCommit?.type).toBe('text')
    if (secondAfterCommit?.type !== 'text') throw new Error('expected text')
    expect(secondAfterCommit.style?.fontFamily).toBe('KaiTi')
    expect(selectSlideAuthoringBackend(useEditorStore.getState())!.getSession().history.past)
      .toHaveLength(beforeLate.history.past.length + 1)
  })
})
