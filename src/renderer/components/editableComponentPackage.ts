import type { ComponentManifest, ComponentPackageData } from '../../shared/componentTypes'
import { componentManifestSchema } from '../../shared/componentSchema'
import { componentSupportsScope } from '../../shared/componentCapabilities'
import { componentContentSha256 } from '../../shared/componentContentIntegrity'
import { UserFacingError } from '../../shared/errors'
import type { EmbeddedComponentPackageMeta } from '../../shared/projectTypes'
import type { CourseProjectDocument, LayerItem } from '../../shared/courseProjectTypes'
import {
  parseComponentPackageFiles,
  validateComponentRuntimeSource,
} from './importComponentPackage'

export function editableComponentPackageId(
  sourceId: string,
  suffix: string,
): string {
  return `${sourceId}.editable.${suffix.toLowerCase().replace(/[^a-z0-9]/g, 'x')}`
}

export function componentPackageMeta(
  data: ComponentPackageData,
  authoring?: Pick<
    EmbeddedComponentPackageMeta,
    'editableCopy' | 'sourcePackageId'
  >,
): EmbeddedComponentPackageMeta {
  const base = `components/${data.manifest.id}@${data.manifest.version}`
  return {
    packageId: data.manifest.id,
    version: data.manifest.version,
    name: data.manifest.name,
    manifestPath: `${base}/manifest.json`,
    runtimePath: `${base}/${data.manifest.entry}`,
    contentSha256: data.contentSha256 ?? componentContentSha256(data.files),
    thumbnailPath: data.manifest.thumbnail
      ? `${base}/${data.manifest.thumbnail}`
      : undefined,
    ...(data.provenance === undefined ? {} : data.provenance),
    ...(authoring?.editableCopy ? { editableCopy: true } : {}),
    ...(authoring?.sourcePackageId
      ? { sourcePackageId: authoring.sourcePackageId }
      : {}),
  }
}

export function rewriteComponentDefinitionId(
  source: string,
  previousId: string,
  nextId: string,
): string {
  const rewritten = source.replaceAll(previousId, nextId)
  if (rewritten === source) {
    throw new UserFacingError(
      '无法创建可编辑副本',
      '组件运行时中没有找到可安全替换的组件 ID。',
      '该组件可能使用了动态 ID；请由组件作者提供允许编辑的源码版本。',
    )
  }
  return rewritten
}

export function componentFilesWithAuthoredCode(
  packageData: ComponentPackageData,
  manifest: ComponentManifest,
  runtimeSource: string,
): Record<string, Uint8Array> {
  const files = Object.fromEntries(
    Object.entries(packageData.files).map(([path, bytes]) => [
      path,
      Uint8Array.from(bytes),
    ]),
  )
  const encoder = new TextEncoder()
  files['manifest.json'] = encoder.encode(JSON.stringify(manifest, null, 2))
  files[manifest.entry] = encoder.encode(runtimeSource)
  return files
}

export function assertEditableComponentPackage(
  packageId: string,
  packageData: ComponentPackageData | undefined,
  packageMeta: EmbeddedComponentPackageMeta | undefined,
): asserts packageData is ComponentPackageData {
  if (!packageData || packageMeta?.editableCopy !== true) {
    throw new UserFacingError(
      '组件代码不可修改',
      '第三方组件包默认只读。',
      '请先创建工程内可编辑副本，再修改其 Manifest 或 Runtime。',
    )
  }
}

function collectComponentInstanceScopes(
  project: CourseProjectDocument,
  packageId: string,
): Set<'scene' | 'global'> {
  const scopes = new Set<'scene' | 'global'>()
  const visit = (item: LayerItem, scope: 'scene' | 'global') => {
    if (item.kind === 'component' && item.component.packageId === packageId) {
      scopes.add(scope)
    }
  }
  for (const entry of project.globalLayerItems) visit(entry.item, 'global')
  for (const surface of project.surfaces) {
    for (const entry of surface.surfaceLayerItems) visit(entry.item, 'scene')
    if (surface.type === 'slide') {
      for (const scene of surface.scenes) {
        for (const item of scene.layerItems) visit(item, 'scene')
      }
    } else if (surface.type === 'spatial-2d') {
      for (const item of surface.world.layerItems) visit(item, 'scene')
    }
  }
  return scopes
}

export function validateEditableComponentPackage(
  packageData: ComponentPackageData,
  project: CourseProjectDocument | null,
  additionalScopes: ReadonlyArray<'scene' | 'global'> = [],
): void {
  const parsed = componentManifestSchema.safeParse(packageData.manifest)
  if (!parsed.success) {
    throw new UserFacingError(
      '组件 Manifest 校验失败',
      parsed.error.issues[0]?.message ?? 'Manifest 无效。',
      '请修正字段后重试，当前工程未发生变化。',
    )
  }
  validateComponentRuntimeSource(packageData.runtimeSource)
  const id = packageData.manifest.id
  if (
    !packageData.runtimeSource.includes(JSON.stringify(id)) &&
    !packageData.runtimeSource.includes(`'${id}'`) &&
    !packageData.runtimeSource.includes(`\`${id}\``)
  ) {
    throw new UserFacingError(
      '组件 Runtime 校验失败',
      `运行时源码没有登记可编辑副本 ID“${id}”。`,
      '请确保 CoursewareComponent.define 的 id 与 Manifest 完全一致。',
    )
  }
  if (
    !new RegExp(
      `["']?runtimeApiVersion["']?\\s*:\\s*${packageData.manifest.runtimeApiVersion}\\b`,
    ).test(packageData.runtimeSource)
  ) {
    throw new UserFacingError(
      '组件 Runtime 校验失败',
      `运行时源码没有静态登记 API ${packageData.manifest.runtimeApiVersion}。`,
      '请确保 CoursewareComponent.define 的 runtimeApiVersion 与 Manifest 完全一致。',
    )
  }

  const reparsed = parseComponentPackageFiles(packageData.files, {
    expectedId: id,
    expectedVersion: packageData.manifest.version,
  })
  if (reparsed.runtimeSource !== packageData.runtimeSource) {
    throw new UserFacingError(
      '组件 Runtime 校验失败',
      '组件入口文件与当前代码框内容不一致。',
      '请重新应用 Runtime 后再修改 Manifest。',
    )
  }

  const requiredScopes = new Set<'scene' | 'global'>(additionalScopes)
  if (project) {
    for (const scope of collectComponentInstanceScopes(project, id)) {
      requiredScopes.add(scope)
    }
  }
  for (const scope of requiredScopes) {
    if (!componentSupportsScope(packageData.manifest, scope)) {
      throw new UserFacingError(
        '组件作用域校验失败',
        `当前组件仍有${scope === 'scene' ? '场景' : '全局'}实例，但 Manifest 已不支持该作用域。`,
        '请保留现有实例所需作用域，或先删除/替换这些实例。',
      )
    }
  }
}

export function removeCourseComponentPackage(
  draft: CourseProjectDocument,
  packageId: string,
): void {
  for (const [key, meta] of Object.entries(draft.componentPackages)) {
    if (meta.packageId === packageId) delete draft.componentPackages[key]
  }
}

export function locateDocumentComponentMeta(
  project: CourseProjectDocument,
  packageId: string,
  version?: string,
): EmbeddedComponentPackageMeta | undefined {
  return Object.values(project.componentPackages).find((meta) => (
    meta.packageId === packageId
    && (version === undefined || meta.version === version)
  ))
}
