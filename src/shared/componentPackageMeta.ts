import { componentContentSha256 } from './componentContentIntegrity'
import type { ComponentPackageData } from './componentTypes'
import type { EmbeddedComponentPackageMeta } from './contracts/component-v4'

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
