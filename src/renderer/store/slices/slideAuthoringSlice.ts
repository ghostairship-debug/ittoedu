import { componentContainers } from '../../../shared/contracts/component-platform/project'
import { type ComponentAuthorSpot, type ComponentAuthoring, type ComponentContainer, type ComponentEdit, type ComponentFrame, type ComponentImplementation, type CourseProjectV10, type JsonValue } from '../../../shared/contracts/component-platform'
import { coursePresentationEdits, type CoursePresentationInput } from '../../../core/tools/coursePresentationEdits'
import { componentDataEdits } from '../../../core/course/componentDataEdits'
import type { TextRangeProjection } from '../../../shared/document/textInteraction'
import type { TextRun } from '../../../shared/contracts/native-v1'
import type { NativeLineGeometry } from '../../../shared/contracts/native-v1/types'
import { textComponentDataSchema } from '../../../components/text'
import { insertCourseElement, ensureCourseTeacherController, insertionContainer as resolveInsertionContainer, type CourseElementKind, type CourseInsertionOptions } from '../../media/commitCourseMediaAuthoring'
import type { CapturedCourseTarget } from '../../documents/CourseV10DocumentBridge'
import type { EditorStoreKernel } from '../editorStoreKernel'
import { createSlideOwnedCommands } from './slideOwnedCommands'
import { componentIsLocked } from '../../composition/crossSurfaceCommands'
import { insertComponentDefinitionAtTarget } from '../../components/insertComponentPackages'
import { authorSpotEdits, authorSpotValue, dataWithSpotEdit } from '../../componentPlatform/surfaces/slide/authorSpots'
import { registerCourseDraftProvider } from '../../authoring/courseDraftLifecycle'
import { applyValidatedComponentOperation, equalComponentValue } from '../../../core/drivers/courseV10Operations'
import { resolveComponentPresentation } from '../../../shared/contracts/component-platform'
import { flushPropertiesDrafts } from '../../ui/properties/PropertyControls'
import { authorFieldRichContent } from '../../authoring/professionalContentFields'
import { authorFieldIdentity } from '../../documents/interactionSelection'

export interface SlideContentLayout { readonly width: number; readonly height: number }
export type SlideContentLayoutReady = Promise<SlideContentLayout | undefined>

export interface SlideContentEdit {
  rangeProjection?: TextRangeProjection[]
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
  /** Rich fields keep their original content value; no synthetic text-component data enters the author model. */
  spotValue?: JsonValue
  historyGroup?: string
  implementation?: ComponentImplementation
  authoring?: ComponentAuthoring
  /** Restored unfinished input must receive a real input event before applying. */
  resumeRequired?: boolean
  recoveryBlocked?: string
}
export function hasSlideContentDraftChanges(edit: SlideContentEdit): boolean {
  return edit.data !== edit.originalData && !equalComponentValue(edit.data, edit.originalData) || edit.frame !== undefined || Boolean(edit.implementation)
    || Boolean(edit.authorSpot && !equalComponentValue(edit.spotValue ?? edit.spotText, edit.authorSpot.initialValue))
}
/** The one private draft is projected only into its captured document, surface and named state. */
export function projectWithSlideContentDraft(project: CourseProjectV10,
  edit: SlideContentEdit | null, context: { documentId: string; epoch?: string; surfaceId: string | null; activeStateId: string | null }): CourseProjectV10 {
  if (!edit || edit.target.documentId !== context.documentId || edit.target.epoch !== context.epoch
    || edit.target.surfaceId !== context.surfaceId || edit.target.activeStateId !== context.activeStateId
    || edit.target.project.id !== project.id || project.instances[edit.instanceId]?.definitionId !== edit.definitionId) return project
  if (edit.data === edit.originalData && edit.frame === undefined && !edit.implementation && !edit.authoring) return project
  const instance = { ...project.instances[edit.instanceId], data: structuredClone(edit.data),
    ...(edit.authoring ? { authoring: structuredClone(edit.authoring) } : {}),
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
  const captureInputTarget = (documentId?: string) => kernel.captureOwnedTarget?.(documentId) ?? kernel.captureTarget(documentId)
  const insertionContainer = (target: CapturedCourseTarget): ComponentContainer => ports.readEditingScope?.() === 'global'
    ? { kind: 'global', plane: 'overlay' }
    : resolveInsertionContainer(target)
  const insertElement = async (kind: CourseElementKind, options: CourseInsertionOptions = {}, target = kernel.captureTarget()) => {
    const result = await insertCourseElement(kernel, target, kind, { ...options, origin: 'slide-authoring', container: insertionContainer(target) })
    return result.instanceIds[0]
  }
  // Font/layout readiness belongs to the current immutable private draft, never serialized author data.
  let contentSession = {}
  const layoutPreparations = new WeakMap<SlideContentEdit, SlideContentLayoutReady>()
  const publishContentDraft = (previous: SlideContentEdit, next: SlideContentEdit, preparation?: SlideContentLayoutReady) => {
    const ready = preparation ?? (next.data === previous.data || equalComponentValue(next.data, previous.data) ? layoutPreparations.get(previous) : undefined)
    if (ready) layoutPreparations.set(next, ready)
    ports.patch({ slideContentEdit: next })
  }
  const beginSlideDataEdit = (instanceId: string, source: 'canvas' | 'properties' = 'canvas') => {
    const previous = ports.read().slideContentEdit
    const view = kernel.readView()
    if (previous?.instanceId === instanceId && previous.target.documentId === view.activeDocumentId
      && previous.target.epoch === view.snapshot?.epoch && previous.target.surfaceId === view.surfaceId
      && previous.target.activeStateId === view.activeStateId) return previous
    if (previous) { kernel.setFeedback({ statusMessage: '请先完成当前文字编辑' }); return null }
    const target = captureInputTarget(), instance = target.project.instances[instanceId]
    if (!instance || componentIsLocked(target.editingProject, instanceId)) return null
    const effective = target.editingProject.instances[instanceId]
    plainGroup = undefined
    const data = structuredClone(effective.data)
    const edit: SlideContentEdit = { instanceId, definitionId: instance.definitionId, target, data, originalData: data, composing: false, source }
    contentSession = {}
    ports.patch({ slideContentEdit: edit })
    return edit
  }
  const updateSlideDataDraft = (data: unknown, composing?: boolean, height?: number, width?: number, rangeProjection?: TextRangeProjection[], historyGroup?: string, layoutReady?: SlideContentLayoutReady) => {
    const edit = ports.read().slideContentEdit
    if (!edit) return
    if (edit.authorSpot && authorFieldRichContent(edit.authorSpot.initialValue)) {
      updateSlideSpotValue(json(textComponentDataSchema.parse(data).content), composing, historyGroup)
      return
    }
    const originalFrame = edit.target.editingProject.instances[edit.instanceId]?.frame
    const frameBase = edit.frame === undefined ? originalFrame : edit.frame
    const growHeight = frameBase && height !== undefined && Number.isFinite(height) && height > frameBase.height + 0.5
    const growWidth = frameBase && width !== undefined && Number.isFinite(width) && width > frameBase.width + 0.5
    const frame = frameBase && (growHeight || growWidth) ? { ...frameBase,
      ...(growHeight ? { height } : {}), ...(growWidth ? { width } : {}) } : edit.frame
    const nextData = json(data)
    const resumed = composing === true || !equalComponentValue(nextData, edit.data)
    if (edit && (resumed && edit.resumeRequired || JSON.stringify(nextData) !== JSON.stringify(edit.data) || (composing ?? edit.composing) !== edit.composing || JSON.stringify(frame) !== JSON.stringify(edit.frame) || layoutReady && layoutPreparations.get(edit) !== layoutReady))
      publishContentDraft(edit, { ...edit, data: nextData, rangeProjection: rangeProjection ?? (equalComponentValue(nextData, edit.data) ? edit.rangeProjection : undefined), composing: composing ?? edit.composing, frame,
        historyGroup: historyGroup ?? edit.historyGroup, resumeRequired: resumed ? false : edit.resumeRequired }, layoutReady)
  }
  const updateSlideFrameDraft = (frame: ComponentFrame | null) => {
    const edit = ports.read().slideContentEdit
    if (!edit) return
    const original = edit.target.editingProject.instances[edit.instanceId]?.frame ?? null
    const value = JSON.stringify(frame) === JSON.stringify(original) ? undefined : structuredClone(frame)
    if (JSON.stringify(value) !== JSON.stringify(edit.frame)) {
      layoutPreparations.delete(edit) // An explicit frame owns its dimensions; retire the measurement for the old frame.
      publishContentDraft(edit, { ...edit, frame: value })
    }
  }
  const beginSlideSpotEdit = async (spot: ComponentAuthorSpot, captured = captureInputTarget(), readCurrentSpot?: () => ComponentAuthorSpot | undefined) => {
    if (typeof spot.initialValue !== 'string' && !authorFieldRichContent(spot.initialValue)) { report('请使用此对象的专业内容编辑器'); return null }
    const previous = ports.read().slideContentEdit
    if (previous?.authorSpot && previous.target.documentId === captured.documentId && previous.target.epoch === captured.epoch
      && authorFieldIdentity(previous.instanceId, previous.authorSpot) === authorFieldIdentity(spot.instanceId, spot)) return previous
    if (previous) { report('请先完成当前文字编辑'); return null }
    if (!await flushPropertiesDrafts(captured.documentId)) { report('属性编辑尚未完成，当前输入已保留'); return null }
    if (ports.read().slideContentEdit) { report('请先完成当前文字编辑'); return null }
    const target = captureInputTarget(captured.documentId)
    if (kernel.readView().activeDocumentId !== captured.documentId || target.epoch !== captured.epoch
      || target.surfaceId !== captured.surfaceId || target.activeStateId !== captured.activeStateId) {
      report('原编辑目标已变化，请重新选择'); return null
    }
    if (readCurrentSpot) {
      const current = readCurrentSpot()
      if (!current) { report('原画面字段已更新，请重新选择'); return null }
      spot = current
    }
    if (typeof spot.initialValue !== 'string' && !authorFieldRichContent(spot.initialValue)) { report('请使用此对象的专业内容编辑器'); return null }
    const instance = target.editingProject.instances[spot.instanceId]
    if (!instance || componentIsLocked(target.editingProject, spot.instanceId)) return null
    try { authorSpotEdits(target.editingProject, spot, spot.initialValue, target.resources) } catch (error) { report(error); return null }
    plainGroup = undefined
    const data = structuredClone(instance.data)
    const edit: SlideContentEdit = { instanceId: instance.id, definitionId: instance.definitionId, target,
      data, originalData: data, composing: false, source: 'canvas', authorSpot: structuredClone(spot),
      spotValue: structuredClone(spot.initialValue), ...(typeof spot.initialValue === 'string' ? { spotText: spot.initialValue } : {}) }
    contentSession = {}
    ports.patch({ slideContentEdit: edit }); return edit
  }
  let plainGroup: { key: string; at: number; id: string } | undefined
  const updateSlideSpotValue = (value: JsonValue, composing?: boolean, suppliedGroup?: string) => {
    const edit = ports.read().slideContentEdit
    if (!edit?.authorSpot) return
    const resumed = composing === true || !equalComponentValue(value, edit.spotValue ?? edit.spotText)
    const resumeRequired = resumed ? false : edit.resumeRequired
    const now = Date.now(), key = authorFieldIdentity(edit.instanceId, edit.authorSpot)
    if (!suppliedGroup && resumed && !composing) {
      if (!plainGroup || plainGroup.key !== key || now - plainGroup.at > 800) plainGroup = { key, at: now, id: `field-input:${crypto.randomUUID()}` }
      else plainGroup.at = now
    }
    const historyGroup = suppliedGroup ?? plainGroup?.id ?? edit.historyGroup
    const input = { spotValue: value, ...(typeof value === 'string' ? { spotText: value } : {}), composing: composing ?? edit.composing, resumeRequired, historyGroup }
    // Source-backed input stays in its existing draft/overlay. Compile it once at a reliable completion boundary.
    if (edit.recoveryBlocked || edit.authorSpot.sourceRegion) {
      ports.patch({ slideContentEdit: { ...edit, ...input } })
      return
    }
    const operations = authorSpotEdits(edit.target.editingProject, edit.authorSpot, value, edit.target.resources)
    const operation = operations.find(operation => operation.type === 'data.set' || operation.type === 'implementation.set')
    const instance = edit.target.editingProject.instances[edit.instanceId]
    let authoring = structuredClone(instance.authoring ?? {})
    for (const change of operations) if (change.type === 'authoring.set') {
      authoring = dataWithSpotEdit(authoring as unknown as JsonValue, { ...change, type: 'data.set' }) as unknown as ComponentAuthoring
    }
    const originalImplementation = instance.implementationOverride ?? edit.target.editingProject.definitions[instance.definitionId]?.implementation
    ports.patch({ slideContentEdit: { ...edit, ...input,
      ...(operations.some(value => value.type === 'authoring.set') ? { authoring } : {}),
      ...(operation?.type === 'data.set' ? { data: dataWithSpotEdit(edit.data, operation) }
        : operation?.type === 'implementation.set' && operation.implementation && !operations.some(value => value.type === 'component.files.set')
          ? { implementation: JSON.stringify(operation.implementation) === JSON.stringify(originalImplementation) ? undefined : operation.implementation } : {}) } })
  }
  const updateSlideSpotDraft = (value: string, composing?: boolean) => updateSlideSpotValue(value, composing)
  const pendingCommits = new WeakMap<SlideContentEdit, Promise<void>>()
  const draftIssue = (edit: SlideContentEdit): string | undefined => edit.recoveryBlocked
    ?? (edit.resumeRequired ? '恢复的文字输入尚未完成，请继续编辑后再保存'
      : edit.composing ? '请先完成正在输入的文字' : undefined)
  const sourceSpotText = (target: CapturedCourseTarget, spot?: ComponentAuthorSpot): string | undefined => {
    const instance = spot && target.editingProject.instances[spot.instanceId]
    const implementation = instance && (instance.implementationOverride ?? target.editingProject.definitions[instance.definitionId]?.implementation)
    if (spot?.sourceRegion?.kind === 'data') {
      const value = authorSpotValue(instance?.data, spot.sourceRegion.path ?? [])
      return typeof value === 'string' ? value : undefined
    }
    if (spot?.sourceRegion?.kind !== 'implementation' || implementation?.kind !== 'source') return undefined
    if (!implementation.workspace) return implementation.source
    const { ownerId, entry } = implementation.workspace
    const bytes = target.resources.components[ownerId]?.[spot.sourceRegion.path?.join('/') || entry]
    return bytes ? new TextDecoder('utf-8', { fatal: true }).decode(bytes) : undefined
  }
  const applyContentDraft = (keepOpen = false): Promise<void> => {
    const edit = ports.read().slideContentEdit
    if (!edit) return Promise.resolve()
    const session = contentSession
    const existing = pendingCommits.get(edit)
    if (existing) return existing
    const issue = draftIssue(edit)
    if (issue) return Promise.reject(new Error(issue))
    const pending = (async () => {
      const preparation = layoutPreparations.get(edit)
      if (preparation) {
        let layout: SlideContentLayout | undefined, fontFailure: unknown, failed = false
        try { layout = await preparation } catch (failure) { fontFailure = failure; failed = true }
        const current = ports.read().slideContentEdit
        // A previous font batch must never size another draft, even at the same instance ID.
        if (contentSession !== session || !current || current.target !== edit.target || current.instanceId !== edit.instanceId || current.definitionId !== edit.definitionId) return
        if (keepOpen && current.composing) return
        if (layoutPreparations.get(current) !== preparation) return applyContentDraft(keepOpen)
        layoutPreparations.delete(current)
        // All waiters continue through a new draft, even when the measured frame does not grow.
        publishContentDraft(current, { ...current })
        if (failed) kernel.setFeedback({ statusMessage: `字体准备失败，已保留原尺寸；文字仍可保存。${fontFailure instanceof Error ? fontFailure.message : String(fontFailure)}` })
        if (layout) updateSlideDataDraft(current.data, undefined, layout.height, layout.width, current.rangeProjection, current.historyGroup)
        // Composition, newer content and its preparation are checked again through the same writer.
        if (ports.read().slideContentEdit !== edit) return applyContentDraft(keepOpen)
      }
      if (hasSlideContentDraftChanges(edit)) {
        const spotValue = edit.spotValue ?? edit.spotText
        const edits: ComponentEdit[] = edit.authorSpot && spotValue !== undefined
          ? authorSpotEdits(edit.target.editingProject, edit.authorSpot, spotValue, edit.target.resources) : []
        if (!edit.authorSpot && JSON.stringify(edit.originalData) !== JSON.stringify(edit.data)) edits.push(...componentDataEdits(edit.target.project,
          { instanceId: edit.instanceId, surfaceId: edit.target.surfaceId, stateId: edit.target.activeStateId }, { kind: 'replace', data: edit.data, rangeProjection: edit.rangeProjection }))
        if (edit.frame !== undefined) edits.push({ type: 'frame.set', instanceId: edit.instanceId, frame: edit.frame })
        if (!edit.authorSpot && edit.implementation) edits.push({ type: 'implementation.set', instanceId: edit.instanceId, implementation: edit.implementation })
        const command = kernel.capture(edits, edit.target)
        try { await kernel.editCaptured(command, edit.historyGroup) } catch (error) { report(error); throw error }
        const successor = ports.read().slideContentEdit
        if (successor && (keepOpen || successor !== edit) && successor.instanceId === edit.instanceId && successor.target === edit.target) {
          // Advance only through our accepted operation. Capturing the latest project here would
          // erase a real intervening external conflict.
          const { documentId: _documentId, epoch: _epoch, ...operation } = command
          const project = applyValidatedComponentOperation(edit.target.project, operation, edit.target.resources)
          const editingProject = resolveComponentPresentation(project, edit.target.surfaceId, edit.target.activeStateId)
          const fileEdits = command.edits.filter(change => change.type === 'component.files.set')
          const components = fileEdits.length ? { ...edit.target.resources.components } : edit.target.resources.components
          for (const change of fileEdits) {
            if (change.files === null) delete components[change.ownerId]
            else components[change.ownerId] = change.files
          }
          const target = { ...edit.target, project, editingProject,
            resources: fileEdits.length ? { ...edit.target.resources, components } : edit.target.resources }
          const acceptedData = editingProject.instances[edit.instanceId].data
          let authorSpot = successor.authorSpot
          if (authorSpot) {
            const before = sourceSpotText(edit.target, edit.authorSpot), after = sourceSpotText(target, edit.authorSpot)
            const record = authorSpot.authorKey && editingProject.instances[edit.instanceId].authoring?.records?.[authorSpot.authorKey]
            authorSpot = { ...authorSpot, initialValue: spotValue ?? authorSpot.initialValue,
              ...(record ? { binding: structuredClone(record.binding) } : {}),
              ...(authorSpot.sourceRegion && before !== undefined && after !== undefined
                ? { sourceRegion: { ...authorSpot.sourceRegion, end: authorSpot.sourceRegion.end + after.length - before.length } } : {}) }
          }
          publishContentDraft(successor, { ...successor, target,
            data: successor.data === edit.data ? acceptedData : successor.data, originalData: acceptedData,
            ...(equalComponentValue(successor.frame, edit.frame) ? { frame: undefined } : {}),
            ...(successor.implementation === edit.implementation ? { implementation: undefined } : {}),
            ...(successor.authoring === edit.authoring ? { authoring: undefined } : {}),
            ...(authorSpot ? { authorSpot } : {}) })
        }
        if (edit.implementation || edit.authorSpot?.sourceRegion?.encoding)
          kernel.setFeedback({ statusMessage: '组件源码已更新并重新加载内容，程序内部运行现场可能重置。' })
      }
      if (!keepOpen && ports.read().slideContentEdit === edit) ports.patch({ slideContentEdit: null })
    })()
    pendingCommits.set(edit, pending)
    const clear = () => { pendingCommits.delete(edit) }
    void pending.then(clear, clear)
    return pending
  }
  let inputCommit: { session: object; pending: Promise<void> } | undefined
  const commitSlideContentInput = (): Promise<void> => {
    const session = contentSession
    if (inputCommit?.session === session) return inputCommit.pending
    const current = ports.read().slideContentEdit
    if (!current || current.composing || current.authorSpot?.sourceRegion) return Promise.resolve()
    const pending = (async () => {
      while (contentSession === session) {
        const edit = ports.read().slideContentEdit
        if (!edit || edit.composing || edit.authorSpot?.sourceRegion || !hasSlideContentDraftChanges(edit) && !layoutPreparations.has(edit)) return
        await applyContentDraft(true)
      }
    })()
    const entry = { session, pending }
    inputCommit = entry
    const clear = () => { if (inputCommit === entry) inputCommit = undefined }
    void pending.then(clear, clear)
    return pending
  }
  const commitTextEdit = async (): Promise<void> => {
    const first = ports.read().slideContentEdit, session = contentSession
    if (inputCommit?.session === session) await inputCommit.pending
    while (first && contentSession === session) {
      const current = ports.read().slideContentEdit
      if (!current || current.instanceId !== first.instanceId || current.target.documentId !== first.target.documentId
        || current.target.epoch !== first.target.epoch || current.authorSpot?.id !== first.authorSpot?.id) break
      await applyContentDraft()
    }
    if (contentSession === session) plainGroup = undefined
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
      const implementation = original?.implementationOverride ?? edit.target.editingProject.definitions[edit.definitionId]?.implementation
      return [{ kind: 'surface-content', projectId: edit.target.project.id, documentId, epoch: edit.target.epoch,
        key: JSON.stringify([edit.instanceId, edit.target.surfaceId, edit.target.activeStateId]),
        payload: json({ projectId: edit.target.project.id, instanceId: edit.instanceId, definitionId: edit.definitionId,
          surfaceId: edit.target.surfaceId, activeStateId: edit.target.activeStateId, source: edit.source,
          data: edit.data, originalData: edit.originalData, frame: edit.frame,
          originalFrame: original?.frame ?? null,
          originalImplementation: implementation,
          originalSourceText: implementation?.kind === 'source' && implementation.workspace ? sourceSpotText(edit.target, edit.authorSpot) : undefined,
          implementation: edit.implementation, authoring: edit.authoring, originalAuthoring: original?.authoring,
          authorSpot: edit.authorSpot, spotText: edit.spotText, spotValue: edit.spotValue, historyGroup: edit.historyGroup,
          composing: edit.composing || Boolean(edit.resumeRequired), recoveryBlocked: edit.recoveryBlocked }) }]
    },
    restore(documentId, record) {
      const saved = record.payload as unknown as Pick<SlideContentEdit, 'instanceId' | 'definitionId' | 'data' | 'originalData' | 'frame' | 'implementation' | 'authoring' | 'authorSpot' | 'spotText' | 'spotValue' | 'historyGroup' | 'source' | 'composing' | 'recoveryBlocked'>
        & { projectId: string; surfaceId: string | null; activeStateId: string | null; originalFrame: ComponentFrame | null; originalImplementation: ComponentImplementation; originalSourceText?: string; originalAuthoring?: ComponentAuthoring }
      const current = kernel.captureTarget(documentId)
      if (saved.projectId !== current.project.id || saved.surfaceId !== null && !componentContainers(current.project).some(surface => surface.id === saved.surfaceId))
        throw new Error('原文字恢复位置已不存在，原稿仍保留')
      const surface = componentContainers(current.project).find(value => value.id === saved.surfaceId)
      if (saved.activeStateId && !surface?.presentation?.states.some(state => state.id === saved.activeStateId))
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
        || saved.authoring !== undefined && !equalComponentValue(instance.authoring, saved.originalAuthoring)
        || saved.frame !== undefined && !equalComponentValue(instance.frame ?? null, saved.originalFrame)
        || Boolean(saved.implementation || saved.authorSpot?.sourceRegion?.kind === 'implementation') && !equalComponentValue(implementation, saved.originalImplementation)
        || saved.originalSourceText !== undefined && sourceSpotText(target, saved.authorSpot) !== saved.originalSourceText
      contentSession = {}
      ports.patch({ slideContentEdit: { instanceId: saved.instanceId, definitionId: saved.definitionId, target,
        data: structuredClone(saved.data), originalData: structuredClone(saved.originalData),
        ...(saved.frame !== undefined ? { frame: structuredClone(saved.frame) } : {}),
        ...(saved.implementation ? { implementation: structuredClone(saved.implementation) } : {}),
        ...(saved.authoring ? { authoring: structuredClone(saved.authoring) } : {}),
        ...(saved.authorSpot ? { authorSpot: structuredClone(saved.authorSpot), spotText: saved.spotText, spotValue: saved.spotValue, historyGroup: saved.historyGroup } : {}),
        source: saved.source, composing: false, resumeRequired: saved.composing,
        recoveryBlocked: changed ? '原文字基线已改变，恢复原稿已保留；请核对当前对象后继续编辑' : saved.recoveryBlocked } })
    },
    release(documentId) { if (ports.read().slideContentEdit?.target.documentId === documentId) { contentSession = {}; ports.patch({ slideContentEdit: null }) } },
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
    beginSlideDataEdit, updateSlideDataDraft, updateSlideFrameDraft, beginSlideSpotEdit, updateSlideSpotDraft, commitSlideContentInput, beginTextEdit: beginSlideDataEdit,
    async setActivePresentationState(stateId: string | null, captured = kernel.captureTarget()) {
      while (ports.read().slideContentEdit?.target.documentId === captured.documentId) await commitTextEdit()
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
      if (edit) publishContentDraft(edit, { ...edit, composing, resumeRequired: composing ? false : edit.resumeRequired })
    },
    commitTextEdit,
    commitSlideContentEdit: commitTextEdit,
    cancelTextEdit() { contentSession = {}; ports.patch({ slideContentEdit: null }) },
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
