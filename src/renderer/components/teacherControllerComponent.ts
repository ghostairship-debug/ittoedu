import type { CourseProjectDocument } from '../../shared/courseProjectTypes'
import type { ComponentPackageData } from '../../shared/componentTypes'
import { createDefaultTeacherControllerPackage } from '../../shared/defaultTeacherControllerComponent'
import { componentPackageMeta } from '../../shared/componentPackageMeta'
import { courseProjectDocumentSchema } from '../../shared/courseProjectSchema'
import type { EditorTransactionPlan } from '../authoring/editorTransaction'
import { rewriteComponentDefinitionId } from './editableComponentPackage'
import { componentContentSha256 } from '../../shared/componentContentIntegrity'
import { createEditorTransactionStep } from '../authoring/editorTransaction'

/** A fresh editable template, optionally assigned a free package identity. */
export function createTeacherControllerTemplate(packageId?: string, version?: string): ComponentPackageData {
  const pkg = createDefaultTeacherControllerPackage()
  if (packageId && packageId !== pkg.manifest.id) {
    pkg.runtimeSource = rewriteComponentDefinitionId(pkg.runtimeSource, pkg.manifest.id, packageId)
    pkg.manifest.id = packageId
  }
  if (version) pkg.manifest.version = version
  pkg.files['runtime.js'] = new TextEncoder().encode(pkg.runtimeSource)
  pkg.files['manifest.json'] = new TextEncoder().encode(JSON.stringify(pkg.manifest, null, 2))
  return { ...pkg, contentSha256: componentContentSha256(pkg.files) }
}

/** Bundle the built-in resource referenced by a new document. */
export function withDefaultComponentController(project: CourseProjectDocument): {
  project: CourseProjectDocument; componentPackages: Record<string, ComponentPackageData>
} {
  const item = project.globalLayerItems.find(e => e.item.kind === 'component' && e.item.role === 'teacher-controller')?.item
  if (!item || item.kind !== 'component') return { project, componentPackages: {} }
  const pkg = createTeacherControllerTemplate(item.component.packageId, item.component.version)
  return { project, componentPackages: { [pkg.manifest.id]: pkg } }

}

export function planTeacherControllerComponentEdit(project: CourseProjectDocument, packages: Readonly<Record<string, ComponentPackageData>>, itemId: string, operation: 'restore'): EditorTransactionPlan {
  if (project.globalLayerItems.find(e => e.item.layerItemId === itemId)?.item.locked) throw new Error('控制台已锁定，请先解锁')
  const entry = project.globalLayerItems.find(e => e.item.layerItemId === itemId)
  if (!entry || entry.item.kind !== 'component' || entry.item.role !== 'teacher-controller') throw new Error('请选择组件教师控制台')
  const id = entry.item.component.packageId, before = packages[id]
  if (!before) throw new Error('控制台组件源码缺失')
  const restored = createTeacherControllerTemplate(id, before.manifest.version)
  const next = structuredClone(project)
  next.revision++
  next.componentPackages[id] = componentPackageMeta(restored, { editableCopy: true })
  const target = next.globalLayerItems.find(e => e.item.layerItemId === itemId)!
  target.item.visible = true; target.item.playbackInitialVisibility = 'inherit'; target.item.opacity = 1
  target.visibility = { mode: 'all', locationIds: [] }
  next.playback.controls = 'canvas'
  return { projectId: project.id, baseRevision: project.revision, nextDocument: courseProjectDocumentSchema.parse(next),
    resourceChanges: { componentPackageChanges: [{ packageId: id, before, after: restored }] } }
}

/** Recovery commits the new component and its source in one history step. */
export function missingTeacherControllerTransaction(before: CourseProjectDocument, recovered: CourseProjectDocument, itemId: string) {
  const bundle = withDefaultComponentController(recovered)
  return createEditorTransactionStep(before, {
    projectId: before.id, baseRevision: before.revision, nextDocument: { ...bundle.project, revision: before.revision + 1 },
    resourceChanges: { componentPackageChanges: Object.values(bundle.componentPackages).map(after => ({ packageId: after.manifest.id, after })) },
  })
}
