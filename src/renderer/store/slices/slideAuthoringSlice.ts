import { componentContainers } from '../../../shared/contracts/component-platform/project'
import { type ComponentAuthorSpot, type ComponentAuthoring, type ComponentContainer, type ComponentEdit, type ComponentFrame, type ComponentImplementation, type CourseProjectV10, type JsonValue } from '../../../shared/contracts/component-platform'
import { coursePresentationEdits, type CoursePresentationInput } from '../../../core/tools/coursePresentationEdits'
import { componentDataEdits, componentDataPropertyFields } from '../../../core/course/componentDataEdits'
import { remapDocumentData, type TextRangeProjection } from '../../../shared/document/textInteraction'
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
import { notifyCourseDrafts, registerCourseDraftProvider, type AdvancedDraftRecovery } from '../../authoring/courseDraftLifecycle'
import { equalComponentValue } from '../../../shared/componentValue'
import { resolveComponentPresentation } from '../../../shared/contracts/component-platform'
import { authorFieldRichContent } from '../../authoring/professionalContentFields'
import { authorFieldIdentity } from '../../documents/interactionSelection'
import { componentDefinitionBuiltinKey } from '../../../shared/contracts/component-platform/project'
import { settleCourseComponentInput } from '../../documents/CourseV10DocumentBridge'
import { acceptedContentInputTarget, settleRetainedContentInput, type RetainedContentInput } from '../../authoring/acceptedContentInput'

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
  /** Current local completion failure; raw input remains owned here. */
  commitError?: string
}
export function hasSlideContentDraftChanges(edit: SlideContentEdit): boolean {
  return edit.data !== edit.originalData && !equalComponentValue(edit.data, edit.originalData) || edit.frame !== undefined || Boolean(edit.implementation)
    || Boolean(edit.authorSpot && !equalComponentValue(edit.spotValue ?? edit.spotText, edit.authorSpot.initialValue))
}
export function slideContentEditInScope(edit: SlideContentEdit | null | undefined,
  context: { documentId: string | null; epoch?: string; surfaceId: string | null; activeStateId: string | null }): SlideContentEdit | null {
  return edit && edit.target.documentId === context.documentId && edit.target.epoch === context.epoch
    && edit.target.surfaceId === context.surfaceId && edit.target.activeStateId === context.activeStateId ? edit : null
}
/** Reapply only the professional fields changed by this input, keeping unrelated current properties. */
export function rebaseSlideContentData(original: JsonValue, draft: JsonValue, current: JsonValue, builtinKey?: string): JsonValue {
  if (equalComponentValue(original, draft) || equalComponentValue(current, draft)) return structuredClone(current)
  if (equalComponentValue(original, current)) return structuredClone(draft)
  const fields = componentDataPropertyFields(original, draft, builtinKey)
  let next = structuredClone(current)
  for (const field of fields) {
    const before = authorSpotValue(original, field.path), present = authorSpotValue(current, field.path)
    if (!equalComponentValue(present, before) && !equalComponentValue(present, field.value))
      throw new Error('这处内容同时有其他修改，原输入已保留')
    next = dataWithSpotEdit(next, { type: 'data.set', instanceId: '', path: field.path, value: field.value })
  }
  return next
}
/** The one private draft is projected only into its captured document, surface and named state. */
export function projectWithSlideContentDraft(project: CourseProjectV10,
  edit: SlideContentEdit | null, context: { documentId: string; epoch?: string; surfaceId: string | null; activeStateId: string | null }): CourseProjectV10 {
  if (!edit || edit.target.documentId !== context.documentId || edit.target.epoch !== context.epoch
    || edit.target.surfaceId !== context.surfaceId || edit.target.activeStateId !== context.activeStateId
    || edit.target.project.id !== project.id || project.instances[edit.instanceId]?.definitionId !== edit.definitionId) return project
  if (edit.data === edit.originalData && edit.frame === undefined && !edit.implementation && !edit.authoring) return project
  let data: JsonValue
  try { data = rebaseSlideContentData(edit.originalData, edit.data, project.instances[edit.instanceId].data,
    componentDefinitionBuiltinKey(project.definitions[edit.definitionId])) }
  catch { return project }
  const instance = { ...project.instances[edit.instanceId], data,
    ...(edit.authoring ? { authoring: structuredClone(edit.authoring) } : {}),
    ...(edit.implementation ? { implementationOverride: structuredClone(edit.implementation) } : {}) }
  if (edit.frame !== undefined) { if (edit.frame) instance.frame = structuredClone(edit.frame); else delete instance.frame }
  return { ...project, instances: { ...project.instances, [edit.instanceId]: instance } }
}
/** UI drafts only. Bridge remains the sole selection/document owner. */
export interface SlideOwnedState {
  slideContentEdit: SlideContentEdit | null
  retainedSlideContentEdits?: AdvancedDraftRecovery[]
  slideDrawTool: 'line' | 'elbow-arrow' | null
}
export function createInitialSlideOwnedState(): SlideOwnedState {
  return { slideContentEdit: null, retainedSlideContentEdits: [], slideDrawTool: null }
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
    const failure = failedInputs.get(previous)
    if (failure) failedInputs.set(next, failure)
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
      const parsed = textComponentDataSchema.parse(data)
      const projected = rangeProjection ? remapDocumentData({ content: edit.authorSpot.initialValue }, json(parsed), { rangeProjection }) as { content: JsonValue } : parsed
      updateSlideSpotValue(json(projected.content), composing, historyGroup, rangeProjection)
      return
    }
    const originalFrame = edit.target.editingProject.instances[edit.instanceId]?.frame
    const frameBase = edit.frame === undefined ? originalFrame : edit.frame
    const growHeight = frameBase && height !== undefined && Number.isFinite(height) && height > frameBase.height + 0.5
    const growWidth = frameBase && width !== undefined && Number.isFinite(width) && width > frameBase.width + 0.5
    const frame = frameBase && (growHeight || growWidth) ? { ...frameBase,
      ...(growHeight ? { height } : {}), ...(growWidth ? { width } : {}) } : edit.frame
    const nextData = json(rangeProjection ? remapDocumentData(edit.originalData, json(data), { rangeProjection }) : data)
    const resumed = composing === true || !equalComponentValue(nextData, edit.data)
    if (edit && (resumed && edit.resumeRequired || JSON.stringify(nextData) !== JSON.stringify(edit.data) || (composing ?? edit.composing) !== edit.composing || JSON.stringify(frame) !== JSON.stringify(edit.frame) || layoutReady && layoutPreparations.get(edit) !== layoutReady))
      publishContentDraft(edit, { ...edit, data: nextData, rangeProjection: rangeProjection ?? (equalComponentValue(nextData, edit.data) ? edit.rangeProjection : undefined), composing: composing ?? edit.composing, frame,
        historyGroup: historyGroup ?? edit.historyGroup, resumeRequired: resumed ? false : edit.resumeRequired, commitError: resumed ? undefined : edit.commitError }, layoutReady)
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
  const updateSlideSpotValue = (value: JsonValue, composing?: boolean, suppliedGroup?: string, rangeProjection?: TextRangeProjection[]) => {
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
    const input = { spotValue: value, ...(typeof value === 'string' ? { spotText: value } : {}), composing: composing ?? edit.composing, resumeRequired, historyGroup,
      rangeProjection: rangeProjection ?? (equalComponentValue(value, edit.spotValue ?? edit.spotText) ? edit.rangeProjection : undefined), commitError: resumed ? undefined : edit.commitError }
    // Source-backed input stays in its existing draft/overlay. Compile it once at a reliable completion boundary.
    if (edit.recoveryBlocked || edit.authorSpot.sourceRegion) {
      publishContentDraft(edit, { ...edit, ...input })
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
    publishContentDraft(edit, { ...edit, ...input,
      ...(operations.some(value => value.type === 'authoring.set') ? { authoring } : {}),
      ...(operation?.type === 'data.set' ? { data: dataWithSpotEdit(edit.data, operation) }
        : operation?.type === 'implementation.set' && operation.implementation && !operations.some(value => value.type === 'component.files.set')
          ? { implementation: JSON.stringify(operation.implementation) === JSON.stringify(originalImplementation) ? undefined : operation.implementation } : {}) })
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
  const preserveContentEdit = (edit: SlideContentEdit): AdvancedDraftRecovery => {
    const original = edit.target.editingProject.instances[edit.instanceId]
    const implementation = original?.implementationOverride ?? edit.target.editingProject.definitions[edit.definitionId]?.implementation
    return { kind: 'surface-content', projectId: edit.target.project.id, documentId: edit.target.documentId, epoch: edit.target.epoch,
      key: JSON.stringify([edit.instanceId, edit.target.surfaceId, edit.target.activeStateId]),
      payload: json({ projectId: edit.target.project.id, instanceId: edit.instanceId, definitionId: edit.definitionId,
        surfaceId: edit.target.surfaceId, activeStateId: edit.target.activeStateId, source: edit.source,
        data: edit.data, originalData: edit.originalData, frame: edit.frame,
        originalFrame: original?.frame ?? null, originalImplementation: implementation,
        originalSourceText: implementation?.kind === 'source' && implementation.workspace ? sourceSpotText(edit.target, edit.authorSpot) : undefined,
        implementation: edit.implementation, authoring: edit.authoring, originalAuthoring: original?.authoring,
        authorSpot: edit.authorSpot, spotText: edit.spotText, spotValue: edit.spotValue, historyGroup: edit.historyGroup,
        rangeProjection: edit.rangeProjection,
        composing: edit.composing || Boolean(edit.resumeRequired), recoveryBlocked: edit.recoveryBlocked }) }
  }
  const retainRecord = (record: AdvancedDraftRecovery) => {
    const records = ports.read().retainedSlideContentEdits ?? []
    if (!records.some(value => value.documentId === record.documentId && value.key === record.key && equalComponentValue(value.payload, record.payload)))
      ports.patch({ retainedSlideContentEdits: [...records, record] })
    notifyCourseDrafts(kernel.bridge)
  }
  /** Called only after the document input owner acknowledged durable preservation. */
  const parkSlideContentEdit = (documentId: string) => {
    const edit = ports.read().slideContentEdit
    if (!edit || edit.target.documentId !== documentId) return
    if (edit.composing) throw new Error('请先完成正在输入的文字')
    if (hasSlideContentDraftChanges(edit) || draftIssue(edit)) retainRecord(preserveContentEdit(edit))
    contentSession = {}; plainGroup = undefined
    ports.patch({ slideContentEdit: null })
  }
  const failedInputs = new WeakMap<SlideContentEdit, RetainedContentInput<SlideContentEdit>>()
  const advanceContentDraft = (accepted: SlideContentEdit, successor: SlideContentEdit, target: CapturedCourseTarget) => {
    const acceptedData = target.editingProject.instances[accepted.instanceId].data
    const data = successor.data === accepted.data ? acceptedData : rebaseSlideContentData(accepted.data, successor.data, acceptedData,
      componentDefinitionBuiltinKey(target.editingProject.definitions[accepted.definitionId]))
    let authorSpot = successor.authorSpot
    if (authorSpot) {
      const before = sourceSpotText(accepted.target, accepted.authorSpot), after = sourceSpotText(target, accepted.authorSpot)
      const record = authorSpot.authorKey && target.editingProject.instances[accepted.instanceId].authoring?.records?.[authorSpot.authorKey]
      const acceptedValue = accepted.spotValue ?? accepted.spotText ?? authorSpot.initialValue
      authorSpot = { ...authorSpot, initialValue: acceptedValue,
        ...(record ? { binding: structuredClone(record.binding) } : authorSpot.sourceRegion && authorSpot.binding && typeof acceptedValue === 'string'
          ? { binding: { ...authorSpot.binding, baseline: acceptedValue } } : {}),
        ...(authorSpot.sourceRegion && before !== undefined && after !== undefined
          ? { sourceRegion: { ...authorSpot.sourceRegion, end: authorSpot.sourceRegion.end + after.length - before.length } } : {}) }
    }
    // Publishing normally carries failures forward. This original proposal is now definitely accepted.
    failedInputs.delete(accepted); failedInputs.delete(successor)
    publishContentDraft(successor, { ...successor, target, data, originalData: acceptedData, commitError: undefined,
      ...(equalComponentValue(successor.frame, accepted.frame) ? { frame: undefined } : {}),
      ...(successor.implementation === accepted.implementation ? { implementation: undefined } : {}),
      ...(successor.authoring === accepted.authoring ? { authoring: undefined } : {}), ...(authorSpot ? { authorSpot } : {}) })
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
      const failed = failedInputs.get(edit)
      if (failed) {
        const resolution = await settleRetainedContentInput(failed, edit, kernel.bridge)
        if (resolution.outcome === 'pending') throw failed.error
        failedInputs.delete(edit)
        if (resolution.outcome === 'applied') {
          const successor = ports.read().slideContentEdit
          if (successor && contentSession === session && successor.target === edit.target) {
            advanceContentDraft(failed.value, successor, resolution.target)
            return applyContentDraft(keepOpen)
          }
          return
        }
      }
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
          { instanceId: edit.instanceId, surfaceId: edit.target.surfaceId, stateId: edit.target.activeStateId },
          { kind: 'fields', fields: componentDataPropertyFields(edit.originalData, edit.data,
            componentDefinitionBuiltinKey(edit.target.editingProject.definitions[edit.definitionId])), rangeProjection: edit.rangeProjection }))
        if (edit.frame !== undefined) edits.push({ type: 'frame.set', instanceId: edit.instanceId, frame: edit.frame })
        if (!edit.authorSpot && edit.implementation) edits.push({ type: 'implementation.set', instanceId: edit.instanceId, implementation: edit.implementation })
        const acceptedCommand = kernel.capture(edits, edit.target)
        const currentTarget = kernel.bridge.captureOwnedTarget(edit.target.documentId, true)
        const current = { ...currentTarget, editingProject: resolveComponentPresentation(currentTarget.project, edit.target.surfaceId, edit.target.activeStateId) }
        const currentValueMatches = (change: ComponentEdit): boolean => {
          if (current.epoch !== edit.target.epoch) return false
          if (change.type === 'component.files.set') return equalComponentValue(current.resources.components[change.ownerId] ?? null, change.files)
          if (!('instanceId' in change)) return false
          const instance = current.editingProject.instances[change.instanceId]
          if (!instance) return false
          if (change.type === 'data.set') return equalComponentValue(authorSpotValue(instance.data, change.path), change.value)
          if (change.type === 'authoring.set') return equalComponentValue(authorSpotValue(instance.authoring as JsonValue, change.path), change.value)
          if (change.type === 'frame.set') return equalComponentValue(instance.frame ?? null, change.frame)
          if (change.type === 'implementation.set') return equalComponentValue(instance.implementationOverride ?? null, change.implementation)
          return false
        }
        // A field already at the requested value needs no CAS/write. Other fields keep their original baseline.
        const remaining = edits.filter(change => !currentValueMatches(change))
        const command = remaining.length === edits.length ? acceptedCommand : kernel.capture(remaining, edit.target)
        try { if (remaining.length) await kernel.editCaptured(command, edit.historyGroup) }
        catch (error) {
          // Raw remains in this input owner before its definite failed proposal is released.
          const retained = { error, target: edit.target, command: acceptedCommand, value: edit }
          failedInputs.set(edit, retained)
          const result = await settleRetainedContentInput(retained, ports.read().slideContentEdit ?? edit, kernel.bridge)
          if (result.outcome === 'applied') {
            const successor = ports.read().slideContentEdit
            if (successor && contentSession === session && successor.target === edit.target) {
              advanceContentDraft(edit, successor, result.target)
              return applyContentDraft(keepOpen)
            }
            return
          }
          if (result.outcome === 'pending') failedInputs.set(edit, retained)
          else failedInputs.delete(edit)
          const current = ports.read().slideContentEdit
          if (current?.target === edit.target) {
            const next = { ...current, commitError: error instanceof Error ? error.message : String(error) }
            if (result.outcome === 'pending') failedInputs.set(next, retained)
            publishContentDraft(current, next)
          }
          report(error); throw error
        }
        const successor = ports.read().slideContentEdit
        if (successor && (keepOpen || successor !== edit) && successor.instanceId === edit.instanceId && successor.target === edit.target) {
          advanceContentDraft(edit, successor, acceptedContentInputTarget({ target: edit.target, command: acceptedCommand }))
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
  const commitTextEdit = async (documentId = kernel.readView().activeDocumentId ?? undefined,
    afterAccepted?: (spot: ComponentAuthorSpot | undefined) => void): Promise<void> => {
    const first = ports.read().slideContentEdit, session = contentSession
    if (first && documentId && first.target.documentId !== documentId) return
    if (inputCommit?.session === session) await inputCommit.pending
    while (first && contentSession === session) {
      const current = ports.read().slideContentEdit
      if (!current || current.instanceId !== first.instanceId || current.target.documentId !== first.target.documentId
        || current.target.epoch !== first.target.epoch || current.authorSpot?.id !== first.authorSpot?.id) break
      if (afterAccepted && (hasSlideContentDraftChanges(current) || layoutPreparations.has(current))) {
        // A following field action needs the input owner's accepted address,
        // including a source range rebased by the actual text commit. Advance
        // through the existing writer before closing this same input below.
        await applyContentDraft(true)
        continue
      }
      const acceptedSpot = afterAccepted && current.authorSpot ? structuredClone(current.authorSpot) : undefined
      await applyContentDraft()
      if (afterAccepted && contentSession === session && !ports.read().slideContentEdit) { afterAccepted(acceptedSpot); break }
    }
    if (contentSession === session) plainGroup = undefined
  }
  registerCourseDraftProvider(kernel.bridge, 'surface-content', {
    hasDirty(documentId) {
      const edit = ports.read().slideContentEdit
      return Boolean(edit && (!documentId || edit.target.documentId === documentId)
        && (hasSlideContentDraftChanges(edit) || draftIssue(edit)))
        || Boolean(ports.read().retainedSlideContentEdits?.some(record => !documentId || record.documentId === documentId))
    },
    async prepare(documentId, mode = 'apply') {
      // Store follows this readiness check with the existing surface commit,
      // after the property-input gate. This provider adds no transaction path.
      const edit = ports.read().slideContentEdit
      if (mode === 'preserve' && edit?.target.documentId === documentId && !edit.composing) return []
      const message = edit?.target.documentId === documentId ? draftIssue(edit) : undefined
      return message && edit ? [{ documentId, epoch: edit.target.epoch, message }] : []
    },
    preserve(documentId) {
      const edit = ports.read().slideContentEdit
      const retained = (ports.read().retainedSlideContentEdits ?? []).filter(record => record.documentId === documentId)
      return !edit || edit.target.documentId !== documentId || !hasSlideContentDraftChanges(edit) && !draftIssue(edit)
        ? retained : [...retained, preserveContentEdit(edit)]
    },
    restore(documentId, record) {
      const saved = record.payload as unknown as Pick<SlideContentEdit, 'instanceId' | 'definitionId' | 'data' | 'originalData' | 'frame' | 'implementation' | 'authoring' | 'authorSpot' | 'spotText' | 'spotValue' | 'historyGroup' | 'source' | 'composing' | 'recoveryBlocked' | 'rangeProjection'>
        & { projectId: string; surfaceId: string | null; activeStateId: string | null; originalFrame: ComponentFrame | null; originalImplementation: ComponentImplementation; originalSourceText?: string; originalAuthoring?: ComponentAuthoring }
      const current = kernel.bridge.captureOwnedTarget(documentId, true)
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
      const implementation = instance.implementationOverride ?? target.editingProject.definitions[instance.definitionId]?.implementation
      let data = structuredClone(instance.data), authorSpot = saved.authorSpot && structuredClone(saved.authorSpot)
      let frame = saved.frame, desiredImplementation = saved.implementation, authoring = saved.authoring
      try {
        if (authorSpot) {
          const value = saved.spotValue ?? saved.spotText ?? authorSpot.initialValue
          const field = authorSpot.dataPath && authorSpotValue((authorSpot.fieldScope === 'authoring' ? instance.authoring : instance.data) as JsonValue, authorSpot.dataPath)
          if (authorSpot.dataPath && equalComponentValue(field, value) && !saved.composing && frame === undefined && !desiredImplementation) return 'consumed'
          if (authorSpot.sourceRegion && !saved.composing && frame === undefined && !desiredImplementation) {
            // Reconstruct this input's own source result, rather than comparing unrelated instance data.
            const baseline = { ...target.editingProject, instances: { ...target.editingProject.instances,
              [instance.id]: { ...instance, data: saved.originalData, authoring: saved.originalAuthoring,
                implementationOverride: saved.originalImplementation } } }
            let resources = target.resources
            const workspace = saved.originalImplementation?.kind === 'source' ? saved.originalImplementation.workspace : undefined
            if (workspace && saved.originalSourceText !== undefined) {
              const name = authorSpot.sourceRegion.path?.join('/') || workspace.entry
              resources = { ...resources, components: { ...resources.components, [workspace.ownerId]: {
                ...resources.components[workspace.ownerId], [name]: new TextEncoder().encode(saved.originalSourceText) } } }
            }
            const expected = authorSpotEdits(baseline, authorSpot, value, resources)
            let intendedData = saved.originalData, intendedSource: string | undefined
            for (const operation of expected) {
              if (operation.type === 'data.set') intendedData = dataWithSpotEdit(intendedData, operation)
              if (operation.type === 'implementation.set' && operation.implementation?.kind === 'source') intendedSource = operation.implementation.source
              if (operation.type === 'component.files.set' && workspace && operation.files) {
                const bytes = operation.files[authorSpot.sourceRegion.path?.join('/') || workspace.entry]
                if (bytes) intendedSource = new TextDecoder().decode(bytes)
              }
            }
            if (authorSpot.sourceRegion.kind === 'data') {
              const text = authorSpotValue(intendedData, authorSpot.sourceRegion.path ?? [])
              if (typeof text === 'string') intendedSource = text
            }
            if (intendedSource !== undefined && sourceSpotText(target, authorSpot) === intendedSource) return 'consumed'
          }
          const operations = authorSpotEdits(target.editingProject, authorSpot, value, target.resources)
          for (const operation of operations) if (operation.type === 'data.set') data = dataWithSpotEdit(data, operation)
        } else data = rebaseSlideContentData(saved.originalData, saved.rangeProjection
          ? json(remapDocumentData(saved.originalData, saved.data, { rangeProjection: saved.rangeProjection })) : saved.data, instance.data,
          componentDefinitionBuiltinKey(target.editingProject.definitions[instance.definitionId]))
        if (frame !== undefined) {
          if (equalComponentValue(instance.frame ?? null, frame)) frame = undefined
          else if (!equalComponentValue(instance.frame ?? null, saved.originalFrame)) throw new Error('此对象的位置同时有其他修改，原输入已保留')
        }
        if (desiredImplementation) {
          if (equalComponentValue(implementation, desiredImplementation)) desiredImplementation = undefined
          else if (!equalComponentValue(implementation, saved.originalImplementation)) throw new Error('此对象的源码同时有其他修改，原输入已保留')
        }
        if (authoring !== undefined) {
          if (equalComponentValue(instance.authoring, authoring)) authoring = undefined
          else if (!equalComponentValue(instance.authoring, saved.originalAuthoring)) throw new Error('此对象的编辑记录同时有其他修改，原输入已保留')
        }
      } catch {
        // Retain the exact raw input without occupying another target's active editor.
        retainRecord(record)
        return
      }
      if (!authorSpot && equalComponentValue(data, instance.data) && frame === undefined && !desiredImplementation && !authoring && !saved.composing) return 'consumed'
      if (previous && (hasSlideContentDraftChanges(previous) || draftIssue(previous))
        || target.documentId !== kernel.readView().activeDocumentId || target.surfaceId !== kernel.readView().surfaceId || target.activeStateId !== kernel.readView().activeStateId) {
        retainRecord(record)
        return
      }
      contentSession = {}
      ports.patch({ slideContentEdit: { instanceId: saved.instanceId, definitionId: saved.definitionId, target,
        data, originalData: structuredClone(instance.data), ...(frame !== undefined ? { frame: structuredClone(frame) } : {}),
        ...(desiredImplementation ? { implementation: structuredClone(desiredImplementation) } : {}),
        ...(authoring ? { authoring: structuredClone(authoring) } : {}),
        ...(saved.rangeProjection ? { rangeProjection: structuredClone(saved.rangeProjection) } : {}),
        ...(authorSpot ? { authorSpot, spotText: saved.spotText, spotValue: saved.spotValue, historyGroup: saved.historyGroup } : {}),
        source: saved.source, composing: false, resumeRequired: saved.composing } })
      return 'adopted'
    },
    release(documentId) {
      const retained = ports.read().retainedSlideContentEdits ?? []
      const active = ports.read().slideContentEdit?.target.documentId === documentId
      ports.patch({ retainedSlideContentEdits: retained.filter(record => record.documentId !== documentId),
        ...(active ? { slideContentEdit: null } : {}) })
      if (active) contentSession = {}
    },
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
    parkSlideContentEdit,
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
    cancelTextEdit() {
      const edit = ports.read().slideContentEdit, failure = edit && failedInputs.get(edit)
      if (failure) {
        void settleCourseComponentInput(failure.error).then(outcome => {
          if (outcome === 'pending') { kernel.setFeedback({ statusMessage: '这次修改的结果尚未确认，原输入继续保留。' }); return }
          if (ports.read().slideContentEdit === edit) { contentSession = {}; ports.patch({ slideContentEdit: null }) }
        }).catch(report)
        return
      }
      contentSession = {}; ports.patch({ slideContentEdit: null })
    },
    async commitDraftForPersistence(documentId?: string, mode: 'save' | 'preserve' = 'save'): Promise<{ ok: true } | { ok: false; reason: string }> {
      if (documentId && ports.read().slideContentEdit?.target.documentId !== documentId) return { ok: true }
      try { await commitTextEdit(documentId); return { ok: true } }
      catch (error) {
        const current = ports.read().slideContentEdit
        if (mode === 'preserve' && current && (!documentId || current.target.documentId === documentId) && !current.composing) {
          try {
            if (await settleCourseComponentInput(failedInputs.get(current)?.error ?? error) !== 'pending') {
              preserveContentEdit(current) // This exact owner must still be able to capture its raw.
              return { ok: true }
            }
          } catch { /* Unknown/read failures remain genuine completion failures. */ }
        }
        return { ok: false, reason: error instanceof Error ? error.message : String(error) }
      }
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
    async addExternalComponentNode(packageId: string, x?: number, y?: number, presetId?: string, sourceInstanceId?: string) {
      const target = kernel.captureTarget(), container = insertionContainer(target)
      const result = await insertComponentDefinitionAtTarget(kernel, target, packageId, presetId, { x, y, container, sourceInstanceId })
      if (!result.ok) kernel.setFeedback({ errorMessage: result.reason ?? '组件未插入当前工程' })
      return result
    },
    async ensureTeacherController() {
      await ensureCourseTeacherController(kernel, kernel.captureTarget(), 'slide-authoring')
    },
  }
}
