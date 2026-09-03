import { UserFacingError } from '@/shared/errors'
import type { ComponentPackageData } from '@/shared/componentTypes'
import type { EmbeddedComponentPackageMeta } from '@/shared/contracts/component-v4/types'
import type { AssetKind, AssetMeta, RuntimeAssetMap } from '@/shared/contracts/media-v1/types'
import type { BlobUrlRegistry } from '@/renderer/project/blobUrlRegistry'
import { componentPackageKey } from '@/renderer/project/archivePath'
import {
  importComponentPackage,
  parseComponentPackageFiles,
  type ImportedComponentPackage,
} from './importComponentPackage'

function clonePackage(pkg: ImportedComponentPackage): ImportedComponentPackage {
  const files: Record<string, Uint8Array> = Object.create(null) as Record<
    string,
    Uint8Array
  >
  for (const [path, bytes] of Object.entries(pkg.files)) {
    files[path] = Uint8Array.from(bytes)
  }
  return {
    ...pkg,
    manifest: structuredClone(pkg.manifest),
    metadata: { ...pkg.metadata },
    files,
    ...(pkg.provenance === undefined
      ? {}
      : { provenance: { ...pkg.provenance } }),
  }
}

export class ComponentPackageStore {
  private readonly packages = new Map<string, ImportedComponentPackage>()

  constructor(private readonly blobUrlRegistry?: BlobUrlRegistry) {}

  import(bytes: Uint8Array, options: { replace?: boolean } = {}): ImportedComponentPackage {
    const pkg = importComponentPackage(bytes)
    return this.add(pkg, options)
  }

  loadFiles(
    files: Readonly<Record<string, Uint8Array>>,
    expected: { id: string; version: string },
    options: { replace?: boolean } = {},
  ): ImportedComponentPackage {
    const pkg = parseComponentPackageFiles(files, {
      expectedId: expected.id,
      expectedVersion: expected.version,
    })
    return this.add(pkg, options)
  }

  add(
    pkg: ImportedComponentPackage,
    options: { replace?: boolean } = {},
  ): ImportedComponentPackage {
    if (this.packages.has(pkg.key) && options.replace !== true) {
      throw new UserFacingError(
        '组件导入失败',
        `组件“${pkg.manifest.name}” ${pkg.manifest.version} 已经导入。`,
        '请直接从“工程组件”区域使用，或先移除旧版本。',
      )
    }
    const stored = clonePackage(pkg)
    if (this.blobUrlRegistry !== undefined && stored.manifest.thumbnail !== undefined) {
      const thumbnailBytes = stored.files[stored.manifest.thumbnail]
      if (thumbnailBytes !== undefined) {
        const extension = stored.manifest.thumbnail.toLowerCase().split('.').pop()
        const mimeType =
          extension === 'jpg' || extension === 'jpeg'
            ? 'image/jpeg'
            : extension === 'svg'
              ? 'image/svg+xml'
              : `image/${extension ?? 'png'}`
        stored.thumbnailUrl = this.blobUrlRegistry.create(
          `component:${stored.key}:thumbnail`,
          thumbnailBytes,
          mimeType,
        )
      }
    }
    this.packages.set(pkg.key, stored)
    return clonePackage(stored)
  }

  get(key: string): ImportedComponentPackage | undefined {
    const pkg = this.packages.get(key)
    return pkg === undefined ? undefined : clonePackage(pkg)
  }

  getByIdentity(id: string, version: string): ImportedComponentPackage | undefined {
    return this.get(`${id}@${version}`)
  }

  list(): ImportedComponentPackage[] {
    return [...this.packages.values()].map(clonePackage)
  }

  remove(key: string): boolean {
    const pkg = this.packages.get(key)
    if (pkg === undefined) return false
    this.packages.delete(key)
    this.blobUrlRegistry?.revoke(`component:${key}:thumbnail`)
    return true
  }

  clear(): void {
    for (const key of this.packages.keys()) {
      this.blobUrlRegistry?.revoke(`component:${key}:thumbnail`)
    }
    this.packages.clear()
  }

  toArchiveFiles(): Record<string, Record<string, Uint8Array>> {
    const result: Record<string, Record<string, Uint8Array>> = Object.create(null) as Record<
      string,
      Record<string, Uint8Array>
    >
    for (const [key, pkg] of this.packages) {
      const files: Record<string, Uint8Array> = Object.create(null) as Record<
        string,
        Uint8Array
      >
      for (const [path, bytes] of Object.entries(pkg.files)) {
        files[path] = Uint8Array.from(bytes)
      }
      result[key] = files
    }
    return result
  }

  toMetadataRecord(): Record<string, EmbeddedComponentPackageMeta> {
    const result: Record<string, EmbeddedComponentPackageMeta> = Object.create(null) as Record<
      string,
      EmbeddedComponentPackageMeta
    >
    for (const [key, pkg] of this.packages) {
      result[key] = { ...pkg.metadata }
    }
    return result
  }

  get size(): number {
    return this.packages.size
  }
}

export function componentPackagesFromArchive(
  project: { componentPackages: Record<string, EmbeddedComponentPackageMeta> },
  componentFiles: Readonly<
    Record<string, Readonly<Record<string, Uint8Array>>>
  >,
  blobUrlRegistry?: BlobUrlRegistry,
): Record<string, ComponentPackageData> {
  const packages: Record<string, ComponentPackageData> = Object.create(null) as Record<
    string,
    ComponentPackageData
  >
  for (const meta of Object.values(project.componentPackages)) {
    if (packages[meta.packageId] !== undefined) {
      throw new UserFacingError(
        '工程文件损坏',
        `工程包含多个同 ID 的组件“${meta.packageId}”。`,
        'Project V8 工程只能同时使用一个组件 ID 的一个版本，请移除重复版本。',
      )
    }
    const key = componentPackageKey(meta.packageId, meta.version)
    const files = componentFiles[key] ?? componentFiles[meta.packageId]
    if (files === undefined) {
      throw new UserFacingError(
        '工程文件损坏',
        `工程缺少组件“${key}”的包文件。`,
        '请从备份恢复工程，或重新导入该组件。',
      )
    }
    const parsed = parseComponentPackageFiles(files, {
      expectedId: meta.packageId,
      expectedVersion: meta.version,
      blobUrlRegistry,
      ...(meta.sha256 && meta.importedAt && meta.sourceLabel
        ? {
            provenance: {
              sha256: meta.sha256,
              importedAt: meta.importedAt,
              sourceLabel: meta.sourceLabel,
            },
          }
        : {}),
    })
    if (parsed.contentSha256 !== meta.contentSha256) {
      throw new UserFacingError(
        '工程文件损坏',
        `组件“${key}”的内容 SHA-256 与工程锁定值不一致。`,
        '该组件的执行文件可能已被修改；请从可信备份恢复工程。',
      )
    }
    packages[meta.packageId] = parsed
  }
  return packages
}

export function componentPackagesToArchiveFiles(
  packages: Readonly<Record<string, ComponentPackageData>>,
): Record<string, Record<string, Uint8Array>> {
  const componentFiles: Record<string, Record<string, Uint8Array>> = Object.create(
    null,
  ) as Record<string, Record<string, Uint8Array>>
  for (const pkg of Object.values(packages)) {
    const key = componentPackageKey(pkg.manifest.id, pkg.manifest.version)
    if (componentFiles[key] !== undefined) {
      throw new UserFacingError(
        '工程保存失败',
        `组件“${key}”重复，无法保存。`,
        '请移除重复组件后重试。',
      )
    }
    const files: Record<string, Uint8Array> = Object.create(null) as Record<
      string,
      Uint8Array
    >
    for (const [path, bytes] of Object.entries(pkg.files)) {
      files[path] = Uint8Array.from(bytes)
    }
    componentFiles[key] = files
  }
  return componentFiles
}
