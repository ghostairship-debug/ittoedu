import { type ComponentAuthorSpot, type ComponentContainer, type ComponentDefinition, type ComponentEdit, type ComponentFrame, type ComponentImplementation, type ComponentPresentation, type CourseProjectV10, type JsonValue } from '../../../shared/contracts/component-platform'
import type { TextRun } from '../../../shared/contracts/native-v1'
import type { NativeLineGeometry } from '../../../shared/contracts/native-v1/types'
import { createTextData, createFormulaData, TEXT_DEFINITION, FORMULA_DEFINITION, textComponentDataSchema } from '../../../components/text'
import { defaultShapeData, SHAPE_DEFINITION, shapeDataSchema } from '../../../components/shape'
import { createTableData, TABLE_DEFINITION } from '../../../components/table'
import { createChartData, CHART_DEFINITION, chartDataSchema } from '../../../components/chart'
import { createTeacherControllerData, TEACHER_CONTROLLER_DEFINITION } from '../../../components/teacher-controller'
import type { CapturedCourseTarget } from '../../documents/CourseV10DocumentBridge'
import type { EditorStoreKernel } from '../editorStoreKernel'
import { createSlideOwnedCommands } from './slideOwnedCommands'
import { componentIsLocked } from '../../composition/crossSurfaceCommands'
import { insertComponentDefinitionAtTarget } from '../../components/insertComponentPackages'
import { authorSpotEdits, dataWithSpotEdit } from '../../componentPlatform/surfaces/slide/authorSpots'

export interface SlideContentEdit {
  instanceId: string
  definitionId: string
  target: CapturedCourseTarget
  data: JsonValue
  originalData: JsonValue
  frame?: ComponentFrame | null
  composing: boolean
  source: 'canvas' | 'properties'
  authorSpot?: ComponentAuthorSpot
  spotText?: string
  implementation?: ComponentImplementation
}
export function hasSlideContentDraftChanges(edit: SlideContentEdit): boolean {
  return JSON.stringify(edit.data) !== JSON.stringify(edit.originalData) || edit.frame !== undefined || Boolean(edit.implementation)
    || Boolean(edit.authorSpot && edit.spotText !== edit.authorSpot.initialValue)
}
/** The one private draft is projected only into its captured document, surface and named state. */
export function projectWithSlideContentDraft(project: CourseProjectV10,
  edit: SlideContentEdit | null, context: { documentId: string; epoch?: string; surfaceId: string | null; activeStateId: string | null }): CourseProjectV10 {
  if (!edit || edit.target.documentId !== context.documentId || edit.target.epoch !== context.epoch
    || edit.target.surfaceId !== context.surfaceId || edit.target.activeStateId !== context.activeStateId
    || edit.target.project.id !== project.id || project.instances[edit.instanceId]?.definitionId !== edit.definitionId) return project
  const instance = { ...project.instances[edit.instanceId], data: structuredClone(edit.data),
    ...(edit.implementation ? { implementationOverride: structuredClone(edit.implementation) } : {}) }
  if (edit.frame !== undefined) { if (edit.frame) instance.frame = structuredClone(edit.frame); else delete instance.frame }
  return { ...project, instances: { ...project.instances, [edit.instanceId]: instance } }
}
/** UI drafts only. Bridge remains the sole selection/document owner. */
export interface SlideOwnedState {
  slideContentEdit: SlideContentEdit | null
  slideDrawTool: 'line' | 'elbow-arrow' | null
}
export function createInitialSlideOwnedState(): SlideOwnedState {
  return { slideContentEdit: null, slideDrawTool: null }
}
export interface SlideAuthoringPorts {
  read(): SlideOwnedState
  patch(patch: Partial<SlideOwnedState>): void
  readEditingScope?(): 'scene' | 'global'
}
export type SlidePersistExtra = { statusMessage?: string | null }
const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue

export function createSlideAuthoringSlice(kernel: EditorStoreKernel, ports: SlideAuthoringPorts) {
  const report = (error: unknown) => kernel.setFeedback({ errorMessage: error instanceof Error ? error.message : String(error) })
  const submit = (edits: ComponentEdit[], group?: string) => kernel.edit(edits, group).catch(error => { report(error); throw error })
  const insertionContainer = (target: CapturedCourseTarget): ComponentContainer => ports.readEditingScope?.() === 'global'
    ? { kind: 'global', plane: 'overlay' }
    : { kind: 'surface', surfaceId: target.surfaceId! }
  const insert = async (definition: ComponentDefinition, data: unknown, width: number, height: number, x = 80, y = 80, target = kernel.captureTarget()) => {
    const surface = target.project.surfaces.find(value => value.id === target.surfaceId)
    if (!surface) throw new Error('请先选择一个内容页面')
    const id = crypto.randomUUID(), container = insertionContainer(target)
    const edits: ComponentEdit[] = []
    if (!target.project.definitions[definition.id]) edits.push({ type: 'definition.set', definition })
    edits.push({ type: 'instance.insert', container, index: container.kind === 'global' ? target.project.global[container.plane].length : surface.childIds.length,
      rootIds: [id], instances: [{ id, definitionId: definition.id, data: json(data), frame: { width, height, transform: [1, 0, 0, 1, x, y] } }] })
    await kernel.editCaptured(kernel.capture(edits, target))
    kernel.selectInstances([id], surface.id, target.documentId)
    return id
  }
  const beginSlideDataEdit = (instanceId: string, source: 'canvas' | 'properties' = 'canvas') => {
    const previous = ports.read().slideContentEdit
    if (previous?.instanceId === instanceId && previous.target.documentId === kernel.readView().activeDocumentId) return previous
    if (previous) { kernel.setFeedback({ statusMessage: '请先完成当前文字编辑' }); return null }
    const target = kernel.captureTarget(), instance = target.project.instances[instanceId]
    if (!instance || componentIsLocked(target.editingProject, instanceId)) return null
    const effective = target.editingProject.instances[instanceId]
    const edit: SlideContentEdit = { instanceId, definitionId: instance.definitionId, target, data: structuredClone(effective.data), originalData: structuredClone(effective.data), composing: false, source }
    ports.patch({ slideContentEdit: edit })
    return edit
  }
  const updateSlideDataDraft = (data: unknown, composing?: boolean, height?: number) => {
    const edit = ports.read().slideContentEdit
    if (!edit) return
    const originalFrame = edit.target.editingProject.instances[edit.instanceId]?.frame
    const frameBase = edit.frame === undefined ? originalFrame : edit.frame
    const frame = frameBase && height !== undefined && Number.isFinite(height) && height > frameBase.height + 0.5 ? { ...frameBase, height } : edit.frame
    const nextData = json(data)
    if (edit && (JSON.stringify(nextData) !== JSON.stringify(edit.data) || (composing ?? edit.composing) !== edit.composing || JSON.stringify(frame) !== JSON.stringify(edit.frame)))
      ports.patch({ slideContentEdit: { ...edit, data: nextData, composing: composing ?? edit.composing, frame } })
  }
  const updateSlideFrameDraft = (frame: ComponentFrame | null) => {
    const edit = ports.read().slideContentEdit
    if (!edit) return
    const original = edit.target.editingProject.instances[edit.instanceId]?.frame ?? null
    const value = JSON.stringify(frame) === JSON.stringify(original) ? undefined : structuredClone(frame)
    if (JSON.stringify(value) !== JSON.stringify(edit.frame)) ports.patch({ slideContentEdit: { ...edit, frame: value } })
  }
  const beginSlideSpotEdit = (spot: ComponentAuthorSpot, target = kernel.captureTarget()) => {
    if (typeof spot.initialValue !== 'string') { report('请使用此对象的专业内容编辑器'); return null }
    const previous = ports.read().slideContentEdit
    if (previous) { report('请先完成当前文字编辑'); return null }
    const instance = target.editingProject.instances[spot.instanceId]
    if (!instance || componentIsLocked(target.editingProject, spot.instanceId)) return null
    try { authorSpotEdits(target.editingProject, spot, spot.initialValue, target.resources) } catch (error) { report(error); return null }
    const edit: SlideContentEdit = { instanceId: instance.id, definitionId: instance.definitionId, target,
      data: structuredClone(instance.data), originalData: structuredClone(instance.data), composing: false, source: 'canvas', authorSpot: structuredClone(spot), spotText: spot.initialValue }
    ports.patch({ slideContentEdit: edit }); return edit
  }
  const updateSlideSpotDraft = (value: string, composing?: boolean) => {
    const edit = ports.read().slideContentEdit
    if (!edit?.authorSpot) return
    const operations = authorSpotEdits(edit.target.editingProject, edit.authorSpot, value, edit.target.resources)
    const operation = operations.find(operation => operation.type === 'data.set' || operation.type === 'implementation.set')
    const instance = edit.target.editingProject.instances[edit.instanceId]
    const originalImplementation = instance.implementationOverride ?? edit.target.editingProject.definitions[instance.definitionId]?.implementation
    ports.patch({ slideContentEdit: { ...edit, spotText: value, composing: composing ?? edit.composing,
      ...(operation?.type === 'data.set' ? { data: dataWithSpotEdit(edit.data, operation) }
        : operation?.type === 'implementation.set' && operation.implementation && !operations.some(value => value.type === 'component.files.set')
          ? { implementation: JSON.stringify(operation.implementation) === JSON.stringify(originalImplementation) ? undefined : operation.implementation } : {}) } })
  }
  const pendingCommits = new WeakMap<SlideContentEdit, Promise<void>>()
  const commitTextEdit = (): Promise<void> => {
    const edit = ports.read().slideContentEdit
    if (!edit) return Promise.resolve()
    const existing = pendingCommits.get(edit)
    if (existing) return existing
    if (edit.composing) return Promise.reject(new Error('请先完成正在输入的文字'))
    const pending = (async () => {
      if (hasSlideContentDraftChanges(edit)) {
        const edits: ComponentEdit[] = edit.authorSpot && edit.spotText !== undefined
          ? authorSpotEdits(edit.target.editingProject, edit.authorSpot, edit.spotText, edit.target.resources) : []
        if (!edit.authorSpot && JSON.stringify(edit.originalData) !== JSON.stringify(edit.data)) edits.push({ type: 'data.set', instanceId: edit.instanceId, path: [], value: edit.data })
        if (edit.frame !== undefined) edits.push({ type: 'frame.set', instanceId: edit.instanceId, frame: edit.frame })
        if (!edit.authorSpot && edit.implementation) edits.push({ type: 'implementation.set', instanceId: edit.instanceId, implementation: edit.implementation })
        const command = kernel.capture(edits, edit.target)
        try { await kernel.editCaptured(command) } catch (error) { report(error); throw error }
        if (edit.implementation || edit.authorSpot?.sourceRegion?.encoding)
          kernel.setFeedback({ statusMessage: '组件源码已更新并重新加载内容，程序内部运行现场可能重置。' })
      }
      if (ports.read().slideContentEdit === edit) ports.patch({ slideContentEdit: null })
    })()
    pendingCommits.set(edit, pending)
    const clear = () => { pendingCommits.delete(edit) }
    void pending.then(clear, clear)
    return pending
  }
  const addShapeNode = (type: string, x?: number, y?: number) =>
    insert(SHAPE_DEFINITION, shapeDataSchema.parse(defaultShapeData(type as Parameters<typeof defaultShapeData>[0])), 200, 140, x, y)
  const mutatePresentation = async (recipe: (presentation: ComponentPresentation) => void, captured = kernel.captureTarget()) => {
    const surface = captured.project.surfaces.find(value => value.id === captured.surfaceId)
    if (!surface || surface.kind !== 'slide') throw new Error('请先选择一个演示页面')
    const presentation = structuredClone(surface.presentation ?? { states: [] })
    recipe(presentation)
    return kernel.editCaptured(kernel.capture([{ type: 'surface.presentation.set', surfaceId: surface.id, presentation }], captured))
  }
  const requireState = (presentation: ComponentPresentation, id: string) => {
    const state = presentation.states.find(value => value.id === id)
    if (!state) throw new Error('演示状态已不存在')
    return state
  }
  return {
    ...createSlideOwnedCommands(kernel, { ...ports, submit }),
    beginSlideDataEdit, updateSlideDataDraft, updateSlideFrameDraft, beginSlideSpotEdit, updateSlideSpotDraft, beginTextEdit: beginSlideDataEdit,
    async setActivePresentationState(stateId: string | null, captured = kernel.captureTarget()) {
      if (ports.read().slideContentEdit?.target.documentId === captured.documentId) await commitTextEdit()
      kernel.bridge.selectPresentationState(captured.documentId, stateId, captured.surfaceId ?? undefined)
    },
    async addPresentationState(name = '新状态', captured = kernel.captureTarget()) {
      const id = crypto.randomUUID()
      await mutatePresentation(presentation => { presentation.states.push({ id, title: name, overrides: {} }) }, captured)
      kernel.bridge.selectPresentationState(captured.documentId, id, captured.surfaceId ?? undefined)
      return id
    },
    async duplicatePresentationState(stateId: string, captured = kernel.captureTarget()) {
      const id = crypto.randomUUID()
      await mutatePresentation(presentation => {
        const source = requireState(presentation, stateId), index = presentation.states.indexOf(source)
        presentation.states.splice(index + 1, 0, { ...structuredClone(source), id, title: source.title + ' 副本' })
      }, captured)
      kernel.bridge.selectPresentationState(captured.documentId, id, captured.surfaceId ?? undefined)
      return id
    },
    renamePresentationState(stateId: string, title: string, captured?: CapturedCourseTarget) {
      return mutatePresentation(presentation => { requireState(presentation, stateId).title = title }, captured)
    },
    async deletePresentationState(stateId: string, captured = kernel.captureTarget()) {
      await mutatePresentation(presentation => {
        requireState(presentation, stateId)
        presentation.states = presentation.states.filter(state => state.id !== stateId)
        if (presentation.initialStateId === stateId) presentation.initialStateId = null
        if (presentation.thumbnailStateId === stateId) presentation.thumbnailStateId = null
      }, captured)
      return true
    },
    setInitialPresentationState(stateId: string | null, captured?: CapturedCourseTarget) {
      return mutatePresentation(presentation => { if (stateId) requireState(presentation, stateId); presentation.initialStateId = stateId }, captured)
    },
    setThumbnailPresentationState(stateId: string | null, captured?: CapturedCourseTarget) {
      return mutatePresentation(presentation => { if (stateId) requireState(presentation, stateId); presentation.thumbnailStateId = stateId }, captured)
    },
    clearPresentationStateOverrides(stateId: string, captured?: CapturedCourseTarget) {
      return mutatePresentation(presentation => {
        const state = requireState(presentation, stateId)
        state.overrides = {}; delete state.order; delete state.background
      }, captured)
    },
    updateTextEditDraft(instanceId: string, text: string, runs: TextRun[], _height?: number, _width?: number) {
      const edit = ports.read().slideContentEdit
      if (!edit || edit.instanceId !== instanceId) return
      const data = textComponentDataSchema.parse(edit.data)
      if (data.content.inlines.some(inline => inline.type === 'math')) throw new Error('请在专业文字编辑器中编辑行内公式')
      const chars = Array.from(text), inlines: { type: 'text'; text: string; style?: TextRun['style'] }[] = []
      for (let index = 0; index < chars.length; index++) {
        const style = Object.assign({}, ...runs.filter(run => index >= run.start && index < run.end).map(run => run.style))
        const previous = inlines.at(-1)
        if (previous && JSON.stringify(previous.style) === JSON.stringify(style)) previous.text += chars[index]
        else inlines.push({ type: 'text', text: chars[index]!, style })
      }
      updateSlideDataDraft({ ...data, content: { inlines } })
    },
    setSlideTextEditComposing(composing: boolean) {
      const edit = ports.read().slideContentEdit
      if (edit) ports.patch({ slideContentEdit: { ...edit, composing } })
    },
    commitTextEdit,
    commitSlideContentEdit: commitTextEdit,
    cancelTextEdit() { ports.patch({ slideContentEdit: null }) },
    async commitDraftForPersistence(documentId?: string): Promise<{ ok: true } | { ok: false; reason: string }> {
      if (documentId && ports.read().slideContentEdit?.target.documentId !== documentId) return { ok: true }
      try { await commitTextEdit(); return { ok: true } } catch (error) { return { ok: false, reason: error instanceof Error ? error.message : String(error) } }
    },
    addTextNode: (x?: number, y?: number) => insert(TEXT_DEFINITION, createTextData('双击编辑文字'), 320, 80, x, y),
    addFormulaNode: (x?: number, y?: number) => insert(FORMULA_DEFINITION, createFormulaData(crypto.randomUUID(), 'x^2'), 240, 100, x, y),
    addRectangleNode: (x?: number, y?: number) => addShapeNode('rectangle', x, y),
    addShapeNode,
    drawSlideShapeNode(input: { shapeType: 'line' | 'elbow-arrow'; frame: { x: number; y: number; width: number; height: number }; lineGeometry: NativeLineGeometry }, target?: CapturedCourseTarget) {
      return insert(SHAPE_DEFINITION, shapeDataSchema.parse({ ...defaultShapeData(input.shapeType), lineGeometry: input.lineGeometry }),
        Math.max(1, input.frame.width), Math.max(1, input.frame.height), input.frame.x, input.frame.y, target)
    },
    addTableNode: (x?: number, y?: number) => insert(TABLE_DEFINITION, createTableData(), 600, 120, x, y),
    addChartNode(type: 'bar' | 'line' | 'area' | 'pie' | 'donut' = 'bar', x?: number, y?: number) {
      const initial = createChartData()
      const style = type === 'pie' || type === 'donut'
        ? { backgroundColor: initial.style.backgroundColor, backgroundOpacity: initial.style.backgroundOpacity,
            fontFamily: initial.style.fontFamily, fontSize: initial.style.fontSize, textColor: initial.style.textColor,
            showLegend: initial.style.showLegend, legendPosition: initial.style.legendPosition, showDataLabels: initial.style.showDataLabels,
            ...(type === 'donut' ? { holeSize: 50 } : {}) } : initial.style
      return insert(CHART_DEFINITION, chartDataSchema.parse({ ...initial, chartType: type, style }), 560, 360, x, y)
    },
    async addExternalComponentNode(packageId: string, x?: number, y?: number, presetId?: string) {
      const target = kernel.captureTarget(), container = insertionContainer(target)
      const result = await insertComponentDefinitionAtTarget(kernel, target, packageId, presetId, { x, y, container })
      if (!result.ok) kernel.setFeedback({ errorMessage: result.reason ?? '组件未插入当前工程' })
      return result
    },
    async ensureTeacherController() {
      const target = kernel.captureTarget()
      const existing = Object.values(target.project.instances).find(instance => instance.definitionId === TEACHER_CONTROLLER_DEFINITION.id)
      if (existing) { kernel.selectInstances([existing.id], target.surfaceId, target.documentId); return }
      const id = crypto.randomUUID(), edits: ComponentEdit[] = []
      if (!target.project.definitions[TEACHER_CONTROLLER_DEFINITION.id]) edits.push({ type: 'definition.set', definition: TEACHER_CONTROLLER_DEFINITION })
      edits.push({ type: 'instance.insert', container: { kind: 'global', plane: 'overlay' }, index: target.project.global.overlay.length, rootIds: [id],
        instances: [{ id, definitionId: TEACHER_CONTROLLER_DEFINITION.id, data: json(createTeacherControllerData()), frame: { width: 360, height: 72, transform: [1, 0, 0, 1, 24, 24] } }] })
      await kernel.editCaptured(kernel.capture(edits, target))
      kernel.selectInstances([id], target.surfaceId, target.documentId)
    },
  }
}
