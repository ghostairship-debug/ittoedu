import type { ComponentLibraryEntry } from '../../shared/contracts/component-platform/library'
import type { ComponentEdit } from '../../shared/contracts/component-platform/operations'
import { extractComponentLibraryEntry } from '../../core/components/library'
import { exportComponentLibraryArchive } from '../../core/components/library/archive'
import type { CapturedCourseTarget } from '../documents/CourseV10DocumentBridge'
import type { EditorStoreKernel } from '../store/editorStoreKernel'
import { collectCourseComponentPackageUsage, planCourseComponentPackageReplacement } from './courseComponentPackageTransactions'
import { captureComponentInsertionTarget, insertComponentDefinitionAtTarget, insertComponentPackagesAtTarget } from './insertComponentPackages'

export type ComponentAuthoringPorts = EditorStoreKernel
export interface ComponentPackageReplacementTarget { captured: CapturedCourseTarget; packageId: string }
export type ComponentPackageSourceTarget = ComponentPackageReplacementTarget
export type ComponentPackageReplacementCommitResult = { ok: boolean; reason?: string }
export type ComponentLightEditCommitResult = { ok: boolean; reason?: string }
export function captureComponentPackageReplacementTarget(kernel: EditorStoreKernel, packageId: string): ComponentPackageReplacementTarget | null {
  const captured = kernel.captureTarget()
  return captured.project.definitions[packageId] ? { captured, packageId } : null
}
export async function commitComponentReplacementAtTarget(kernel: EditorStoreKernel, target: ComponentPackageReplacementTarget,
  entry: ComponentLibraryEntry): Promise<ComponentPackageReplacementCommitResult> {
  try {
    const edits = planCourseComponentPackageReplacement(target.captured.project, target.packageId, entry)
    await kernel.editCaptured(kernel.capture(edits, target.captured))
    kernel.setFeedback({ statusMessage: `已替换“${entry.title}”，实例内容与位置保留`, errorMessage: null })
    return { ok: true }
  } catch (error) { return { ok: false, reason: error instanceof Error ? error.message : String(error) } }
}
export function createComponentAuthoringActions(kernel: EditorStoreKernel) {
  const commit = async (edits: ComponentEdit[], message: string) => {
    try { await kernel.edit(edits); kernel.setFeedback({ statusMessage: message, errorMessage: null }); return true }
    catch (error) { kernel.setFeedback({ errorMessage: error instanceof Error ? error.message : String(error) }); return false }
  }
  return {
    captureComponentInsertionTarget: () => captureComponentInsertionTarget(kernel),
    insertComponentPackagesAtTarget: (target: CapturedCourseTarget, entries: readonly ComponentLibraryEntry[]) => insertComponentPackagesAtTarget(kernel, target, entries),
    addExternalComponentNode: (definitionId: string) => insertComponentDefinitionAtTarget(kernel, kernel.captureTarget(), definitionId),
    captureComponentPackageReplacementTarget: (id: string) => captureComponentPackageReplacementTarget(kernel, id),
    replaceComponentPackageAtTarget: (target: ComponentPackageReplacementTarget, entry: ComponentLibraryEntry) => commitComponentReplacementAtTarget(kernel, target, entry),
    async deleteComponentPackage(id: string) {
      if (collectCourseComponentPackageUsage(kernel.readDocument(), id).totalInstanceCount) { kernel.setFeedback({ errorMessage: '仍有实例使用此组件，请先移除实例。' }); return false }
      return commit([{ type: 'definition.remove', definitionId: id }], '已从工程移除组件')
    },
    async extractCompositionFragment(itemId: string, name: string) {
      const target = kernel.captureTarget()
      const result = extractComponentLibraryEntry(target.project, target.resources, { id: `library_${crypto.randomUUID()}`, title: name, rootIds: [itemId] })
      const install = window.desktopAPI?.installComponentLibraryEntry
      if (!install) throw new Error('组件库保存入口尚未连接；工程原件保留。')
      await install({ bytes: exportComponentLibraryArchive(result.entry) })
      kernel.setFeedback({ statusMessage: `已将“${name}”提炼到我的资产库`, errorMessage: result.diagnostics.length ? result.diagnostics.map(item => item.message).join('\n') : null })
      return result.entry.id
    },
  }
}
