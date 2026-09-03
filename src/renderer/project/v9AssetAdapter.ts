import { collectPublishedCourseAssetIds } from '@/renderer/export/course/buildPublishedCourse'
import {
  assetBytesSha256,
  buildAssetContentHashIndex,
  cloneCourseAssetBytes,
  courseAssetMetaConflicts,
} from '@/renderer/project/assetManager'
import {
  collectCourseProjectReferences,
  type CourseProjectReference,
} from '@/shared/contracts/course-project-v9/references'
import {
  analyzeCourseAssetReferences,
  type CourseAssetReference,
  type CourseAssetReferenceOptions,
} from '@/shared/contracts/course-project-v9/assetReferences'
import type { CourseProjectDocument } from '@/shared/courseProjectTypes'
import type { AssetKind, AssetMeta } from '@/shared/contracts/media-v1/types'

/**
 * V9 asset sidecar: binary files keyed by stable AssetMeta.id, kept beside
 * CourseProjectDocument. This is not a plugin/service framework.
 */
export interface CourseAssetSidecar {
  readonly files: Readonly<Record<string, Uint8Array>>
}

export interface CourseImportedAsset {
  readonly meta: AssetMeta
  readonly bytes: Uint8Array
}

export interface CourseAssetImportApplyResult {
  importedAssetIds: string[]
  reusedAssetIds: string[]
}

function cloneSidecarFiles(
  files: Readonly<Record<string, Uint8Array>>,
): Record<string, Uint8Array> {
  return Object.fromEntries(
    Object.entries(files).map(([assetId, bytes]) => [
      assetId,
      cloneCourseAssetBytes(bytes),
    ]),
  )
}

export function freezeCourseAssetSidecar(
  files: Readonly<Record<string, Uint8Array>>,
): CourseAssetSidecar {
  return Object.freeze({
    files: Object.freeze(cloneSidecarFiles(files)),
  })
}

export function emptyCourseAssetSidecar(): CourseAssetSidecar {
  return freezeCourseAssetSidecar({})
}

export function putCourseAssetBytes(
  sidecar: CourseAssetSidecar,
  assetId: string,
  bytes: Uint8Array,
): CourseAssetSidecar {
  return freezeCourseAssetSidecar({
    ...sidecar.files,
    [assetId]: bytes,
  })
}

export function removeCourseAssetBytes(
  sidecar: CourseAssetSidecar,
  assetId: string,
): CourseAssetSidecar {
  const files = cloneSidecarFiles(sidecar.files)
  delete files[assetId]
  return freezeCourseAssetSidecar(files)
}

/** Drop sidecar bytes that are no longer listed in project.assets. */
export function pruneCourseAssetSidecar(
  project: CourseProjectDocument,
  sidecar: CourseAssetSidecar,
): CourseAssetSidecar {
  const files = cloneSidecarFiles(sidecar.files)
  for (const assetId of Object.keys(files)) {
    if (!project.assets[assetId]) delete files[assetId]
  }
  return freezeCourseAssetSidecar(files)
}

export function mutableCourseAssetSidecar(
  sidecar: CourseAssetSidecar,
): Record<string, Uint8Array> {
  return cloneSidecarFiles(sidecar.files)
}

export function courseAssetSidecarGaps(
  project: CourseProjectDocument,
  sidecar: CourseAssetSidecar,
): string[] {
  return Object.keys(project.assets).filter((assetId) => {
    const bytes = sidecar.files[assetId]
    const meta = project.assets[assetId]
    return !bytes || !meta || bytes.byteLength !== meta.byteLength
  })
}

export function applyCourseAssetImports(
  assets: Record<string, AssetMeta>,
  sidecarFiles: Record<string, Uint8Array>,
  items: ReadonlyArray<CourseImportedAsset>,
): CourseAssetImportApplyResult {
  const importedAssetIds: string[] = []
  const reusedAssetIds: string[] = []
  for (const item of items) {
    const existing = assets[item.meta.id]
    if (existing) {
      if (courseAssetMetaConflicts(existing, item.meta)) {
        throw new Error('素材 ID 冲突：所选文件与工程中的既有素材不一致')
      }
      reusedAssetIds.push(existing.id)
      if (!sidecarFiles[existing.id]) {
        sidecarFiles[existing.id] = cloneCourseAssetBytes(item.bytes)
      }
      continue
    }
    assets[item.meta.id] = structuredClone(item.meta)
    sidecarFiles[item.meta.id] = cloneCourseAssetBytes(item.bytes)
    importedAssetIds.push(item.meta.id)
  }
  return { importedAssetIds, reusedAssetIds }
}

/**
 * Same content-hash reuse as V8 `prepareAssetBatch`. R3-Z should call this
 * before import commands; commands themselves stay sync.
 */
export async function dedupeCourseMediaImports(
  kind: AssetKind,
  assets: Readonly<Record<string, AssetMeta>>,
  sidecar: CourseAssetSidecar,
  items: ReadonlyArray<CourseImportedAsset>,
): Promise<{
  placements: CourseImportedAsset[]
  additions: CourseImportedAsset[]
  duplicateCount: number
}> {
  const hashes = await buildAssetContentHashIndex(kind, assets, sidecar.files)
  const placements: CourseImportedAsset[] = []
  const additions: CourseImportedAsset[] = []
  let duplicateCount = 0
  for (const item of items) {
    const hash = await assetBytesSha256(item.bytes)
    const existing = hashes.get(hash)
    if (existing) {
      duplicateCount += 1
      placements.push({ meta: existing.meta, bytes: existing.bytes })
      continue
    }
    hashes.set(hash, { meta: item.meta, bytes: item.bytes })
    additions.push(item)
    placements.push(item)
  }
  return { placements, additions, duplicateCount }
}

export interface PreparedHashedMediaBatch {
  readonly placements: CourseImportedAsset[]
  readonly additions: CourseImportedAsset[]
  readonly duplicateCount: number
  readonly decodeFailures: ReadonlyArray<{ name: string; message: string }>
}

/**
 * Selection-side hash reuse before decode. Uses the existing content-hash
 * index; callers supply the captured asset snapshot and a decode factory.
 */
export async function prepareHashedMediaBatch<T extends {
  name: string
  bytes: Uint8Array
  sha256: string
}>(
  files: readonly T[],
  kind: AssetKind,
  assets: Readonly<Record<string, AssetMeta>>,
  assetFiles: Readonly<Record<string, Uint8Array>>,
  decode: (file: T) => Promise<CourseImportedAsset>,
  describeDecodeError: (error: unknown, file: T) => string,
): Promise<PreparedHashedMediaBatch> {
  const hashes = await buildAssetContentHashIndex(kind, assets, assetFiles)
  const placements: CourseImportedAsset[] = []
  const additions: CourseImportedAsset[] = []
  const decodeFailures: Array<{ name: string; message: string }> = []
  let duplicateCount = 0

  for (const file of files) {
    const existing = hashes.get(file.sha256)
    if (existing) {
      duplicateCount += 1
      placements.push({ meta: existing.meta, bytes: existing.bytes })
      continue
    }
    try {
      const imported = await decode(file)
      hashes.set(file.sha256, { meta: imported.meta, bytes: imported.bytes })
      additions.push(imported)
      placements.push(imported)
    } catch (error) {
      decodeFailures.push({
        name: file.name,
        message: describeDecodeError(error, file),
      })
    }
  }

  return { placements, additions, duplicateCount, decodeFailures }
}

export function listCourseAssetReferences(
  project: CourseProjectDocument,
  assetId: string,
  options: CourseAssetReferenceOptions = {},
): readonly CourseAssetReference[] {
  return analyzeCourseAssetReferences(project, options).graph.get(assetId) ?? []
}

export function listCourseSoundReferences(
  project: CourseProjectDocument,
  soundId: string,
): CourseProjectReference[] {
  return collectCourseProjectReferences(project).filter(
    (reference) => reference.kind === 'sound' && reference.id === soundId,
  )
}

export function describeCourseAssetReference(
  reference: CourseAssetReference | CourseProjectReference,
): string {
  const label = reference.kind === 'sound' ? '声音' : '素材'
  return `工程在 ${reference.path.join('.')} 引用该${label}`
}

export function collectCoursePublishedAssetIds(
  project: CourseProjectDocument,
): ReadonlySet<string> {
  return collectPublishedCourseAssetIds({ project, components: {} })
}

export function publishedCourseAssetsAreCovered(
  project: CourseProjectDocument,
  sidecar: CourseAssetSidecar,
): boolean {
  for (const assetId of collectCoursePublishedAssetIds(project)) {
    const meta = project.assets[assetId]
    const bytes = sidecar.files[assetId]
    if (!meta || !bytes || bytes.byteLength !== meta.byteLength) return false
  }
  return true
}
