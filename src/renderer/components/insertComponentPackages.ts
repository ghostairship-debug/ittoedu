import type { ComponentLibraryEntry } from '../../shared/contracts/component-platform/library'
import { containerChildIds, type CourseProjectV10 } from '../../shared/contracts/component-platform/project'
import { extractComponentLibraryEntry, prepareComponentLibraryInsertion, type InsertLibraryOptions, type LibraryDiagnostic } from '../../core/components/library'
import { applyComponentOperation } from '../../core/drivers/courseV10Operations'
import type { ComponentEdit } from '../../shared/contracts/component-platform/operations'
import type { EditorStoreKernel } from '../store/editorStoreKernel'
import type { CapturedCourseTarget } from '../documents/CourseV10DocumentBridge'
import { capturedCourseViewIsCurrent, isCourseComponentInputFailure } from '../documents/CourseV10DocumentBridge'
import { frameCorners } from '../../core/components/geometry'
import { DocumentInsertionTargetError } from '../../shared/document/blockInsertion'
import { importComponentLibraryArchive } from '../../core/components/library/archive'
import { selectCurrentCatalogPackages } from './componentLibraryModel'
import type { AvailableComponentCatalogPackage } from '../../shared/componentCatalog'
import { prepareCourseTeacherControllerEdits } from '../../core/course/courseElementInsertion'

import { prepareCourseInsertion, resolveCourseInsertionPlacement, type CourseInsertionOptions } from '../media/commitCourseMediaAuthoring'

export type ComponentInsertionTarget = CapturedCourseTarget
export type ComponentPackageInsertionOptions = CourseInsertionOptions & Pick<InsertLibraryOptions, 'targetBindings' | 'surfaceBindings' | 'placement'> & { includeTeacherController?: boolean }
export interface ComponentLibraryAddOptions {
  builtInAssetIds?: readonly string[]; placement?: 'local'; includeTeacherController?: boolean
  /** Transient UI submission identity; retries keep it, a new choice creates another. Never persisted. */
  attemptId?: string
}
export const captureComponentInsertionTarget = (kernel: EditorStoreKernel) => kernel.captureTarget()

export function componentDefinitionEntry(kernel: EditorStoreKernel, definitionId: string, target?: CapturedCourseTarget, sourceInstanceId?: string): ComponentLibraryEntry {
  const project = target?.editingProject ?? target?.project ?? kernel.readDocument(), definition = project.definitions[definitionId]
  if (!definition) throw new Error('组件定义已不存在。')
  const selected = target?.instanceIds.filter(id => project.instances[id]?.definitionId === definitionId) ?? []
  const id = sourceInstanceId ?? (selected.length === 1 ? selected[0] : undefined)
  const example = id ? project.instances[id] : undefined
  if (!example || example.definitionId !== definitionId) throw new Error(Object.values(project.instances).some(instance => instance.definitionId === definitionId)
    ? '请选择要复制的现有实例；工程定义没有独立的新建默认值。' : '此定义没有可复制的实例，请从组件库选择一个完整条目。')
  const resources = target?.resources ?? kernel.readResources()
  return extractComponentLibraryEntry(project, resources, { id: definition.library?.packageId ?? definitionId, title: definition.title ?? definitionId, rootIds: [example.id] }).entry
}

/** Prepare all library entries against one captured author snapshot and dispatch one C1 history operation. */
export async function insertComponentPackagesAtTarget(kernel: EditorStoreKernel, target: ComponentInsertionTarget,
  entries: readonly ComponentLibraryEntry[], options: ComponentPackageInsertionOptions = {}): Promise<{ ok: boolean; reason?: string; inputFailure?: unknown; targetInvalid?: boolean; layerItemIds?: string[]; diagnostics?: LibraryDiagnostic[] }> {
  try {
    if (!entries.length && !options.includeTeacherController) throw new Error('未选择组件。')
    const prepared = entries.length ? prepareCourseInsertion(target, options) : { target, options, edits: [] }, workingTarget = prepared.target
    const includeTeacherController = options.includeTeacherController
    options = prepared.options
    const placement = resolveCourseInsertionPlacement(workingTarget, options), owner = placement.container
    let nextIndex = placement.index
    let working: CourseProjectV10 = structuredClone(workingTarget.project)
    const edits: ComponentEdit[] = [...prepared.edits], rootIds: string[] = [], diagnostics: LibraryDiagnostic[] = []
    for (const entry of entries) {
      const children = containerChildIds(working, owner)
      if (!children) throw new Error('组件放置目标已不存在。')
      const insertion = prepareComponentLibraryInsertion(working, entry, { container: owner, index: nextIndex,
        targetBindings: options.targetBindings, surfaceBindings: options.surfaceBindings, placement: options.placement })
      diagnostics.push(...insertion.diagnostics)
      const roots = new Set(insertion.rootIds)
      const inserted = insertion.command.edits.find(edit => edit.type === 'instance.insert')
      const insertsRoots = insertion.command.edits.some(edit => edit.type === 'instance.insert' && edit.container.kind === 'project')
      if (!insertsRoots && inserted?.type === 'instance.insert') {
        const frames = inserted.instances.filter(instance => roots.has(instance.id) && instance.frame).map(instance => instance.frame!)
        const originX = frames.length ? Math.min(...frames.map(frame => frame.transform[4])) : 0
        const originY = frames.length ? Math.min(...frames.map(frame => frame.transform[5])) : 0
        const corners = frames.flatMap(frame => [...frameCorners(frames.length === 1
          ? { ...frame, width: options.width ?? frame.width, height: options.height ?? frame.height } : frame)])
        const centerX = corners.length ? (Math.min(...corners.map(point => point.x)) + Math.max(...corners.map(point => point.x))) / 2 : 0
        const centerY = corners.length ? (Math.min(...corners.map(point => point.y)) + Math.max(...corners.map(point => point.y))) / 2 : 0
        const dx = options.x !== undefined ? options.x - originX : options.center ? options.center.x - centerX : 0
        const dy = options.y !== undefined ? options.y - originY : options.center ? options.center.y - centerY : 0
        inserted.instances = inserted.instances.map(instance => {
          if (!roots.has(instance.id) || !instance.frame) return instance
          const frame = structuredClone(instance.frame)
          frame.transform[4] += dx
          frame.transform[5] += dy
          if (frames.length === 1) { frame.width = options.width ?? frame.width; frame.height = options.height ?? frame.height }
          return { ...instance, frame }
        })
      }
      edits.push(...insertion.command.edits); rootIds.push(...insertion.rootIds)
      if (!insertsRoots) nextIndex += insertion.rootIds.length
      working = applyComponentOperation(working, insertion.command)
    }
    if (rootIds.length) edits.push(...resolveCourseInsertionPlacement(workingTarget, options, rootIds).edits)
    const teacherIds = includeTeacherController
      ? (() => {
        const teacher = prepareCourseTeacherControllerEdits(working, target.surfaceId, 'slide-authoring', target.instanceId)
        edits.push(...teacher.edits)
        return teacher.instanceIds
      })() : []
    await kernel.editCaptured(kernel.capture(edits, target))
    const selectedIds = [...rootIds, ...teacherIds]
    if (capturedCourseViewIsCurrent(kernel.readView(), target)) kernel.selectInstances(selectedIds, target.surfaceId, target.documentId)
    if (diagnostics.length) kernel.setFeedback({ errorMessage: [...new Set(diagnostics.map(item => item.message))].join('\n') })
    return { ok: true, layerItemIds: selectedIds, diagnostics }
  } catch (error) { return { ok: false, reason: error instanceof Error ? error.message : String(error),
    ...(isCourseComponentInputFailure(error) ? { inputFailure: error } : {}), ...(error instanceof DocumentInsertionTargetError ? { targetInvalid: true } : {}) } }
}
/** Resource preparation has no document effect; UI may refresh its captured insertion lease after awaiting it. */
export async function prepareComponentDefinitionEntryAtTarget(kernel: EditorStoreKernel, target: ComponentInsertionTarget, definitionId: string, options: { sourceInstanceId?: string; catalogEntry?: AvailableComponentCatalogPackage } = {}): Promise<ComponentLibraryEntry> {
    const definition = target.project.definitions[definitionId]
    if (!definition) throw new Error('组件定义已不存在。')
    const desktop = typeof window !== 'undefined' ? window.desktopAPI : undefined
    if (!options.sourceInstanceId && definition.library?.packageId && desktop?.loadComponentCatalog && desktop.readComponentCatalogPackage) {
      const packages = options.catalogEntry ? [options.catalogEntry] : (await desktop.loadComponentCatalog()).packages
      const selected = selectCurrentCatalogPackages(packages.filter(entry => entry.packageId === definition.library!.packageId
        && entry.sourceTrust !== 'prompt' && entry.quality !== 'deprecated'))[0]
      if (selected) {
        const file = await desktop.readComponentCatalogPackage({ sourceId: selected.sourceId, packageId: selected.packageId, version: selected.version })
        const archive = importComponentLibraryArchive(file.bytes)
        if (archive.entry.id !== selected.packageId || archive.version !== selected.version) throw new Error('目录条目身份已改变，请刷新后重试。')
        return archive.entry
      }
    }
    return componentDefinitionEntry(kernel, definitionId, target, options.sourceInstanceId)
}
export async function insertComponentDefinitionAtTarget(kernel: EditorStoreKernel, target: ComponentInsertionTarget, definitionId: string, presetId?: string, options: CourseInsertionOptions & { sourceInstanceId?: string; catalogEntry?: AvailableComponentCatalogPackage } = {}) {
  if (presetId) return { ok: false, reason: '此 V10 定义没有该预设；请选择库中的完整示例。' }
  try { return await insertComponentPackagesAtTarget(kernel, target, [await prepareComponentDefinitionEntryAtTarget(kernel, target, definitionId, options)], options) }
  catch (error) { return { ok: false, reason: error instanceof Error ? error.message : String(error) } }
}
