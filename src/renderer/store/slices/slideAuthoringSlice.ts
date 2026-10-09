import { type ComponentAuthorSpot, type ComponentContainer, type ComponentEdit, type ComponentFrame, type ComponentImplementation, type CourseProjectV10, type JsonValue } from '../../../shared/contracts/component-platform'
import { coursePresentationEdits, type CoursePresentationInput } from '../../../core/tools/coursePresentationEdits'
import { componentDataEdits } from '../../../core/course/componentDataEdits'
import type { TextRun } from '../../../shared/contracts/native-v1'
import type { NativeLineGeometry } from '../../../shared/contracts/native-v1/types'
import { textComponentDataSchema } from '../../../components/text'
import { insertCourseElement, ensureCourseTeacherController, type CourseElementKind, type CourseInsertionOptions } from '../../media/commitCourseMediaAuthoring'
import type { CapturedCourseTarget } from '../../documents/CourseV10DocumentBridge'
import type { EditorStoreKernel } from '../editorStoreKernel'
import { createSlideOwnedCommands } from './slideOwnedCommands'
import { componentIsLocked } from '../../composition/crossSurfaceCommands'
import { insertComponentDefinitionAtTarget } from '../../components/insertComponentPackages'
import { authorSpotEdits, dataWithSpotEdit } from '../../componentPlatform/surfaces/slide/authorSpots'
import { registerCourseDraftProvider } from '../../authoring/courseDraftLifecycle'
import { equalComponentValue } from '../../../core/drivers/courseV10Operations'
import { resolveComponentPresentation } from '../../../shared/contracts/component-platform'
import { flushPropertiesDrafts } from '../../ui/properties/PropertyControls'

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
  /** Restored unfinished input must receive a real input event before applying. */
  resumeRequired?: boolean
  recoveryBlocked?: string
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
  const insertElement = async (kind: CourseElementKind, options: CourseInsertionOptions = {}, target = kernel.captureTarget()) => {
    const result = await insertCourseElement(kernel, target, kind, { ...options, origin: 'slide-authoring', container: insertionContainer(target) })
    return result.instanceIds[0]
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
    const resumed = composing === true || !equalComponentValue(nextData, edit.data)
    if (edit && (resumed && edit.resumeRequired || JSON.stringify(nextData) !== JSON.stringify(edit.data) || (composing ?? edit.composing) !== edit.composing || JSON.stringify(frame) !== JSON.stringify(edit.frame)))
      ports.patch({ slideContentEdit: { ...edit, data: nextData, composing: composing ?? edit.composing, frame,
        resumeRequired: resumed ? false : edit.resumeRequired } })
  }
  const updateSlideFrameDraft = (frame: ComponentFrame | null) => {
    const edit = ports.read().slideContentEdit
    if (!edit) return
    const original = edit.target.editingProject.instances[edit.instanceId]?.frame ?? null
    const value = JSON.stringify(frame) === JSON.stringify(original) ? undefined : structuredClone(frame)
    if (JSON.stringify(value) !== JSON.stringify(edit.frame)) ports.patch({ slideContentEdit: { ...edit, frame: value } })
  }
  const beginSlideSpotEdit = async (spot: ComponentAuthorSpot, captured = kernel.captureTarget(), readCurrentSpot?: () => ComponentAuthorSpot | undefined) => {
    if (typeof spot.initialValue !== 'string') { report('请使用此对象的专业内容编辑器'); return null }
    const previous = ports.read().slideContentEdit
    if (previous) { report('请先完成当前文字编辑'); return null }
    if (!await flushPropertiesDrafts(captured.documentId)) { report('属性编辑尚未完成，当前输入已保留'); return null }
    if (ports.read().slideContentEdit) { report('请先完成当前文字编辑'); return null }
    const target = kernel.captureTarget(captured.documentId)
    if (kernel.readView().activeDocumentId !== captured.documentId || target.epoch !== captured.epoch
      || target.surfaceId !== captured.surfaceId || target.activeStateId !== captured.activeStateId) {
      report('原编辑目标已变化，请重新选择'); return null
    }
    if (readCurrentSpot) {
      const current = readCurrentSpot()
      if (!current) { report('原画面字段已更新，请重新选择'); return null }
      spot = current
    }
    if (typeof spot.initialValue !== 'string') { report('请使用此对象的专业内容编辑器'); return null }
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
    const resumeRequired = composing === true || value !== edit.spotText ? false : edit.resumeRequired
    if (edit.recoveryBlocked) {
      ports.patch({ slideContentEdit: { ...edit, spotText: value, composing: composing ?? edit.composing, resumeRequired } })
      return
    }
    const operations = authorSpotEdits(edit.target.editingProject, edit.authorSpot, value, edit.target.resources)
    const operation = operations.find(operation => operation.type === 'data.set' || operation.type === 'implementation.set')
    const instance = edit.target.editingProject.instances[edit.instanceId]
    const originalImplementation = instance.implementationOverride ?? edit.target.editingProject.definitions[instance.definitionId]?.implementation
    ports.patch({ slideContentEdit: { ...edit, spotText: value, composing: composing ?? edit.composing, resumeRequired,
      ...(operation?.type === 'data.set' ? { data: dataWithSpotEdit(edit.data, operation) }
        : operation?.type === 'implementation.set' && operation.implementation && !operations.some(value => value.type === 'component.files.set')
          ? { implementation: JSON.stringify(operation.implementation) === JSON.stringify(originalImplementation) ? undefined : operation.implementation } : {}) } })
  }
  const pendingCommits = new WeakMap<SlideContentEdit, Promise<void>>()
  const draftIssue = (edit: SlideContentEdit): string | undefined => edit.recoveryBlocked
    ?? (edit.resumeRequired ? '恢复的文字输入尚未完成，请继续编辑后再保存'
      : edit.composing ? '请先完成正在输入的文字' : undefined)
  const sourceSpotText = (target: CapturedCourseTarget, spot?: ComponentAuthorSpot): string | undefined => {
    const instance = spot && target.editingProject.instances[spot.instanceId]
    const implementation = instance && (instance.implementationOverride ?? target.editingProject.definitions[instance.definitionId]?.implementation)
    if (spot?.sourceRegion?.kind !== 'implementation' || implementation?.kind !== 'source' || !implementation.workspace) return undefined
    const { ownerId, entry } = implementation.workspace
    const bytes = target.resources.components[ownerId]?.[spot.sourceRegion.path?.join('/') || entry]
    return bytes ? new TextDecoder('utf-8', { fatal: true }).decode(bytes) : undefined
  }
  const commitTextEdit = (): Promise<void> => {
    const edit = ports.read().slideContentEdit
    if (!edit) return Promise.resolve()
    const existing = pendingCommits.get(edit)
    if (existing) return existing
    const issue = draftIssue(edit)
    if (issue) return Promise.reject(new Error(issue))
    const pending = (async () => {
      if (hasSlideContentDraftChanges(edit)) {
        const edits: ComponentEdit[] = edit.authorSpot && edit.spotText !== undefined
          ? authorSpotEdits(edit.target.editingProject, edit.authorSpot, edit.spotText, edit.target.resources) : []
        if (!edit.authorSpot && JSON.stringify(edit.originalData) !== JSON.stringify(edit.data)) edits.push(...componentDataEdits(edit.target.project,
          { instanceId: edit.instanceId, surfaceId: edit.target.surfaceId, stateId: edit.target.activeStateId }, { kind: 'replace', data: edit.data }))
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
  registerCourseDraftProvider(kernel.bridge, 'surface-content', {
    hasDirty(documentId) {
      const edit = ports.read().slideContentEdit
      return Boolean(edit && (!documentId || edit.target.documentId === documentId)
        && (hasSlideContentDraftChanges(edit) || draftIssue(edit)))
    },
    async prepare(documentId) {
      // Store follows this readiness check with the existing surface commit,
      // after the property-input gate. This provider adds no transaction path.
      const edit = ports.read().slideContentEdit
      const message = edit?.target.documentId === documentId ? draftIssue(edit) : undefined
      return message && edit ? [{ documentId, epoch: edit.target.epoch, message }] : []
    },
    preserve(documentId) {
      const edit = ports.read().slideContentEdit
      if (!edit || edit.target.documentId !== documentId || !hasSlideContentDraftChanges(edit) && !draftIssue(edit)) return []
      const original = edit.target.editingProject.instances[edit.instanceId]
      return [{ kind: 'surface-content', projectId: edit.target.project.id, documentId, epoch: edit.target.epoch,
        key: JSON.stringify([edit.instanceId, edit.target.surfaceId, edit.target.activeStateId]),
        payload: json({ projectId: edit.target.project.id, instanceId: edit.instanceId, definitionId: edit.definitionId,
          surfaceId: edit.target.surfaceId, activeStateId: edit.target.activeStateId, source: edit.source,
          data: edit.data, originalData: edit.originalData, frame: edit.frame,
          originalFrame: original?.frame ?? null,
          originalImplementation: original?.implementationOverride ?? edit.target.editingProject.definitions[edit.definitionId]?.implementation,
          originalSourceText: sourceSpotText(edit.target, edit.authorSpot),
          implementation: edit.implementation, authorSpot: edit.authorSpot, spotText: edit.spotText,
          composing: edit.composing || Boolean(edit.resumeRequired), recoveryBlocked: edit.recoveryBlocked }) }]
    },
    restore(documentId, record) {
      const saved = record.payload as unknown as Pick<SlideContentEdit, 'instanceId' | 'definitionId' | 'data' | 'originalData' | 'frame' | 'implementation' | 'authorSpot' | 'spotText' | 'source' | 'composing' | 'recoveryBlocked'>
        & { projectId: string; surfaceId: string | null; activeStateId: string | null; originalFrame: ComponentFrame | null; originalImplementation: ComponentImplementation; originalSourceText?: string }
      const current = kernel.captureTarget(documentId)
      if (saved.projectId !== current.project.id || !current.project.surfaces.some(surface => surface.id === saved.surfaceId))
        throw new Error('原文字恢复位置已不存在，原稿仍保留')
      const surface = current.project.surfaces.find(value => value.id === saved.surfaceId)!
      if (saved.activeStateId && !surface.presentation?.states.some(state => state.id === saved.activeStateId))
        throw new Error('原文字命名态已不存在，原稿仍保留')
      const target = { ...current, surfaceId: saved.surfaceId, activeStateId: saved.activeStateId,
        editingProject: resolveComponentPresentation(current.project, saved.surfaceId, saved.activeStateId) }
      const instance = target.editingProject.instances[saved.instanceId]
      if (!instance || instance.definitionId !== saved.definitionId) throw new Error('原文字对象已不存在，原稿仍保留')
      const previous = ports.read().slideContentEdit
      if (previous && (hasSlideContentDraftChanges(previous) || draftIssue(previous)))
        throw new Error('已有新的文字输入，恢复原稿仍保留')
      const implementation = instance.implementationOverride ?? target.editingProject.definitions[instance.definitionId]?.implementation
      const changed = !equalComponentValue(instance.data, saved.originalData)
        || saved.frame !== undefined && !equalComponentValue(instance.frame ?? null, saved.originalFrame)
        || Boolean(saved.implementation || saved.authorSpot?.sourceRegion?.kind === 'implementation') && !equalComponentValue(implementation, saved.originalImplementation)
        || saved.originalSourceText !== undefined && sourceSpotText(target, saved.authorSpot) !== saved.originalSourceText
      ports.patch({ slideContentEdit: { instanceId: saved.instanceId, definitionId: saved.definitionId, target,
        data: structuredClone(saved.data), originalData: structuredClone(saved.originalData),
        ...(saved.frame !== undefined ? { frame: structuredClone(saved.frame) } : {}),
        ...(saved.implementation ? { implementation: structuredClone(saved.implementation) } : {}),
        ...(saved.authorSpot ? { authorSpot: structuredClone(saved.authorSpot), spotText: saved.spotText } : {}),
        source: saved.source, composing: false, resumeRequired: saved.composing,
        recoveryBlocked: changed ? '原文字基线已改变，恢复原稿已保留；请核对当前对象后继续编辑' : saved.recoveryBlocked } })
    },
    release(documentId) { if (ports.read().slideContentEdit?.target.documentId === documentId) ports.patch({ slideContentEdit: null }) },
  })
  const addShapeNode = (type: string, x?: number, y?: number) =>
    insertElement('shape', { shapeType: type as CourseInsertionOptions['shapeType'], x, y })
  const mutatePresentation = (input: Omit<CoursePresentationInput, 'target'>, captured = kernel.captureTarget(), id?: string) => {
    if (!captured.surfaceId) throw new Error('请先选择一个演示页面')
    const edits = coursePresentationEdits(captured.project, { kind: 'course-surface', surfaceId: captured.surfaceId }, input,
      id ? () => id : undefined)
    return kernel.editCaptured(kernel.capture(edits, captured))
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
      await mutatePresentation({ action: 'add', title: name }, captured, id)
      kernel.bridge.selectPresentationState(captured.documentId, id, captured.surfaceId ?? undefined)
      return id
    },
    async duplicatePresentationState(stateId: string, captured = kernel.captureTarget()) {
      const id = crypto.randomUUID()
      await mutatePresentation({ action: 'duplicate', state: stateId }, captured, id)
      kernel.bridge.selectPresentationState(captured.documentId, id, captured.surfaceId ?? undefined)
      return id
    },
    renamePresentationState(stateId: string, title: string, captured?: CapturedCourseTarget) {
      return mutatePresentation({ action: 'rename', state: stateId, title }, captured)
    },
    async deletePresentationState(stateId: string, captured = kernel.captureTarget()) {
      await mutatePresentation({ action: 'delete', state: stateId }, captured)
      return true
    },
    setInitialPresentationState(stateId: string | null, captured?: CapturedCourseTarget) {
      return mutatePresentation({ action: 'set-initial', state: stateId }, captured)
    },
    setThumbnailPresentationState(stateId: string | null, captured?: CapturedCourseTarget) {
      return mutatePresentation({ action: 'set-thumbnail', state: stateId }, captured)
    },
    clearPresentationStateOverrides(stateId: string, captured?: CapturedCourseTarget) {
      return mutatePresentation({ action: 'clear-overrides', state: stateId }, captured)
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
      if (edit) ports.patch({ slideContentEdit: { ...edit, composing, resumeRequired: composing ? false : edit.resumeRequired } })
    },
    commitTextEdit,
    commitSlideContentEdit: commitTextEdit,
    cancelTextEdit() { ports.patch({ slideContentEdit: null }) },
    async commitDraftForPersistence(documentId?: string): Promise<{ ok: true } | { ok: false; reason: string }> {
      if (documentId && ports.read().slideContentEdit?.target.documentId !== documentId) return { ok: true }
      try { await commitTextEdit(); return { ok: true } } catch (error) { return { ok: false, reason: error instanceof Error ? error.message : String(error) } }
    },
    addTextNode: (x?: number, y?: number) => insertElement('text', { x, y }),
    addFormulaNode: (x?: number, y?: number) => insertElement('formula', { x, y }),
    addRectangleNode: (x?: number, y?: number) => addShapeNode('rectangle', x, y),
    addShapeNode,
    drawSlideShapeNode(input: { shapeType: 'line' | 'elbow-arrow'; frame: { x: number; y: number; width: number; height: number }; lineGeometry: NativeLineGeometry }, target?: CapturedCourseTarget) {
      return insertElement('shape', { shapeType: input.shapeType, lineGeometry: input.lineGeometry,
        width: Math.max(1, input.frame.width), height: Math.max(1, input.frame.height), x: input.frame.x, y: input.frame.y }, target)
    },
    addTableNode: (x?: number, y?: number) => insertElement('table', { x, y }),
    addChartNode(type: 'bar' | 'line' | 'area' | 'pie' | 'donut' = 'bar', x?: number, y?: number) {
      return insertElement('chart', { chartType: type, x, y })
    },
    async addExternalComponentNode(packageId: string, x?: number, y?: number, presetId?: string) {
      const target = kernel.captureTarget(), container = insertionContainer(target)
      const result = await insertComponentDefinitionAtTarget(kernel, target, packageId, presetId, { x, y, container })
      if (!result.ok) kernel.setFeedback({ errorMessage: result.reason ?? '组件未插入当前工程' })
      return result
    },
    async ensureTeacherController() {
      await ensureCourseTeacherController(kernel, kernel.captureTarget(), 'slide-authoring')
    },
  }
}
