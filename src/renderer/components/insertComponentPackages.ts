import type { ComponentLibraryEntry } from '../../shared/contracts/component-platform/library'
import type { CourseProjectV10 } from '../../shared/contracts/component-platform/project'
import { extractComponentLibraryEntry, prepareComponentLibraryInsertion, type InsertLibraryOptions, type LibraryDiagnostic } from '../../core/components/library'
import { applyComponentOperation } from '../../core/drivers/courseV10Operations'
import type { ComponentEdit } from '../../shared/contracts/component-platform/operations'
import type { EditorStoreKernel } from '../store/editorStoreKernel'
import type { CapturedCourseTarget } from '../documents/CourseV10DocumentBridge'
import { frameCorners } from '../../core/components/geometry'

import { resolveCourseInsertionPlacement, type CourseInsertionOptions } from '../media/commitCourseMediaAuthoring'

export type ComponentInsertionTarget = CapturedCourseTarget
export type ComponentPackageInsertionOptions = CourseInsertionOptions & Pick<InsertLibraryOptions, 'targetBindings' | 'surfaceBindings'>
export const captureComponentInsertionTarget = (kernel: EditorStoreKernel) => kernel.captureTarget()

export function componentDefinitionEntry(kernel: EditorStoreKernel, definitionId: string, target?: CapturedCourseTarget): ComponentLibraryEntry {
  const project = target?.project ?? kernel.readDocument(), definition = project.definitions[definitionId]
  if (!definition) throw new Error('组件定义已不存在。')
  const example = Object.values(project.instances).find(instance => instance.definitionId === definitionId)
  if (!example) throw new Error('此定义没有示例，请从组件库选择一个完整条目。')
  const resources = target?.resources ?? kernel.readResources()
  return extractComponentLibraryEntry(project, resources, { id: definitionId, title: definition.title ?? definitionId, rootIds: [example.id] }).entry
}

/** Prepare all library entries against one captured author snapshot and dispatch one C1 history operation. */
export async function insertComponentPackagesAtTarget(kernel: EditorStoreKernel, target: ComponentInsertionTarget,
  entries: readonly ComponentLibraryEntry[], options: ComponentPackageInsertionOptions = {}): Promise<{ ok: boolean; reason?: string; layerItemIds?: string[]; diagnostics?: LibraryDiagnostic[] }> {
  try {
    if (!entries.length) throw new Error('未选择组件。')
    const placement = resolveCourseInsertionPlacement(target, options), owner = placement.container
    let nextIndex = placement.index
    let working: CourseProjectV10 = structuredClone(target.project)
    const edits: ComponentEdit[] = [], rootIds: string[] = [], diagnostics: LibraryDiagnostic[] = []
    for (const entry of entries) {
      const children = owner.kind === 'global' ? working.global[owner.plane] : owner.kind === 'surface'
        ? working.surfaces.find(surface => surface.id === owner.surfaceId)?.childIds : working.instances[owner.instanceId]?.childIds
      if (!children) throw new Error('组件放置目标已不存在。')
      const insertion = prepareComponentLibraryInsertion(working, entry, { container: owner, index: nextIndex,
        targetBindings: options.targetBindings, surfaceBindings: options.surfaceBindings })
      diagnostics.push(...insertion.diagnostics)
      const roots = new Set(insertion.rootIds)
      const inserted = insertion.command.edits.find(edit => edit.type === 'instance.insert')
      if (inserted?.type === 'instance.insert') {
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
      nextIndex += insertion.rootIds.length
      working = applyComponentOperation(working, insertion.command)
    }
    edits.push(...resolveCourseInsertionPlacement(target, options, rootIds).edits)
    await kernel.editCaptured(kernel.capture(edits, target))
    if (kernel.readView().activeDocumentId === target.documentId) kernel.selectInstances(rootIds, target.surfaceId, target.documentId)
    if (diagnostics.length) kernel.setFeedback({ errorMessage: [...new Set(diagnostics.map(item => item.message))].join('\n') })
    return { ok: true, layerItemIds: rootIds, diagnostics }
  } catch (error) { return { ok: false, reason: error instanceof Error ? error.message : String(error) } }
}
export async function insertComponentDefinitionAtTarget(kernel: EditorStoreKernel, target: ComponentInsertionTarget, definitionId: string, presetId?: string, options: CourseInsertionOptions = {}) {
  if (presetId) return { ok: false, reason: '此 V10 定义没有该预设；请选择库中的完整示例。' }
  try { return await insertComponentPackagesAtTarget(kernel, target, [componentDefinitionEntry(kernel, definitionId, target)], options) }
  catch (error) { return { ok: false, reason: error instanceof Error ? error.message : String(error) } }
}
