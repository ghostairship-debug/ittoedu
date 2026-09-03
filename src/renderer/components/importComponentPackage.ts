import { strFromU8, unzip, unzipSync } from 'fflate'
import { componentManifestSchema } from '@/shared/componentSchema'
import { COMPONENT_RUNTIME_API_VERSION, COMPONENT_SCHEMA_VERSION } from '@/shared/constants'
import { UserFacingError } from '@/shared/errors'
import type { ComponentManifest, ComponentPackageData } from '@/shared/componentTypes'
import type { EmbeddedComponentPackageMeta } from '@/shared/contracts/component-v4/types'
import {
  assertSafeArchivePath,
  componentArchiveRoot,
  componentPackageKey,
  isArchiveDirectory,
} from '@/renderer/project/archivePath'
import type { BlobUrlRegistry } from '@/renderer/project/blobUrlRegistry'
import { componentContentSha256 } from '@/shared/componentContentIntegrity'

const MAX_COMPONENT_UNCOMPRESSED_BYTES = 50 * 1024 * 1024

export interface ImportedComponentPackage extends ComponentPackageData {
  key: string
  metadata: EmbeddedComponentPackageMeta
}

export interface ParseComponentPackageOptions {
  expectedId?: string
  expectedVersion?: string
  blobUrlRegistry?: BlobUrlRegistry
  provenance?: NonNullable<ComponentPackageData['provenance']>
}

function componentArchiveFilter(): {
  filter(file: { name: string; originalSize: number }): boolean
} {
  let totalUncompressedBytes = 0
  return {
    filter(file) {
      assertSafeArchivePath(file.name, 'component', { allowDirectory: true })
      totalUncompressedBytes += file.originalSize
      if (totalUncompressedBytes > MAX_COMPONENT_UNCOMPRESSED_BYTES) {
        throw componentError(
          '组件包解压后超过 50MB 限制。',
          '请压缩组件素材，或移除不需要的文件后重试。',
        )
      }
      return !isArchiveDirectory(file.name)
    },
  }
}

function componentError(
  message: string,
  suggestion = '请检查组件包内容是否完整，并重新导出 .h5component 文件。',
  cause?: unknown,
): UserFacingError {
  return new UserFacingError('组件导入失败', message, suggestion, { cause })
}

function decodeUtf8(bytes: Uint8Array, filename: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (error) {
    throw componentError(`组件中的 ${filename} 不是有效的 UTF-8 文本。`, undefined, error)
  }
}

function readManifest(bytes: Uint8Array): ComponentManifest {
  let value: unknown
  try {
    value = JSON.parse(decodeUtf8(bytes, 'manifest.json')) as unknown
  } catch (error) {
    if (error instanceof UserFacingError) throw error
    throw componentError('组件 manifest.json 不是有效的 JSON。', undefined, error)
  }

  if (typeof value === 'object' && value !== null) {
    const schemaVersion = Reflect.get(value, 'schemaVersion')
    if (typeof schemaVersion === 'number' && schemaVersion < COMPONENT_SCHEMA_VERSION) {
      throw new UserFacingError(
        '旧组件格式不受支持',
        `该组件使用格式版本 ${schemaVersion}，当前编辑器只接受版本 ${COMPONENT_SCHEMA_VERSION}。`,
        '请让组件作者迁移到 Component API 4；历史包仅能使用归档版编辑器打开。',
      )
    }
    if (typeof schemaVersion === 'number' && schemaVersion > COMPONENT_SCHEMA_VERSION) {
      throw new UserFacingError(
        '组件格式版本不支持',
        `该组件使用格式版本 ${schemaVersion}，当前编辑器仅支持版本 ${COMPONENT_SCHEMA_VERSION}。`,
        '请升级编辑器，或让组件作者导出兼容版本。',
      )
    }
    const runtimeApiVersion = Reflect.get(value, 'runtimeApiVersion')
    if (
      typeof runtimeApiVersion === 'number' &&
      runtimeApiVersion < COMPONENT_RUNTIME_API_VERSION
    ) {
      throw new UserFacingError(
        '旧组件运行时不受支持',
        `该组件使用运行时 API ${runtimeApiVersion}，当前编辑器只接受 API ${COMPONENT_RUNTIME_API_VERSION}。`,
        '请让组件作者迁移渲染能力、生命周期与捕获逻辑后重新打包。',
      )
    }
    if (
      typeof runtimeApiVersion === 'number' &&
      runtimeApiVersion > COMPONENT_RUNTIME_API_VERSION
    ) {
      throw new UserFacingError(
        '组件运行时版本不支持',
        `该组件需要运行时 API ${runtimeApiVersion}，当前编辑器仅支持 API ${COMPONENT_RUNTIME_API_VERSION}。`,
        '请升级编辑器，或让组件作者导出兼容版本。',
      )
    }
  }

  const result = componentManifestSchema.safeParse(value)
  if (!result.success) {
    const firstIssue = result.error.issues[0]
    const location = firstIssue?.path.join('.') || 'manifest'
    throw componentError(
      `组件 manifest 校验失败：${location} ${firstIssue?.message ?? '字段无效'}。`,
      '请让组件作者按照组件开发文档修正 manifest.json。',
      result.error,
    )
  }
  return result.data
}

function cloneFiles(files: Readonly<Record<string, Uint8Array>>): Record<string, Uint8Array> {
  const clone: Record<string, Uint8Array> = Object.create(null) as Record<
    string,
    Uint8Array
  >
  for (const [path, bytes] of Object.entries(files)) {
    clone[path] = Uint8Array.from(bytes)
  }
  return clone
}

function thumbnailMimeType(path: string): string {
  const extension = path.toLowerCase().split('.').pop()
  switch (extension) {
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'webp':
      return 'image/webp'
    case 'gif':
      return 'image/gif'
    case 'svg':
      return 'image/svg+xml'
    default:
      throw componentError(
        `组件缩略图“${path}”的格式不受支持。`,
        '请使用 PNG、JPG、WebP、GIF 或 SVG 缩略图。',
      )
  }
}

/**
 * Reject the module features that cannot work in the offline single-file
 * runtime. This is a compatibility check, not a security sandbox.
 */
export function validateComponentRuntimeSource(source: string): void {
  if (source.trim().length === 0) {
    throw componentError('组件 runtime 文件为空。')
  }
  if (/(^|[;\n\r])\s*import\s*(?:[(\s{*]|["'])/m.test(source)) {
    throw componentError(
      '组件 runtime 不能使用 import。',
      '请将组件打包为不含外部依赖的单个普通 JavaScript 文件。',
    )
  }
  if (/(^|[;\n\r])\s*export\s+(?:default|const|let|var|function|class|\{|\*)/m.test(source)) {
    throw componentError(
      '组件 runtime 不能使用 export。',
      '请将组件打包为通过 window.CoursewareComponent.define 注册的普通 JavaScript 文件。',
    )
  }
  if (/\brequire\s*\(/.test(source)) {
    throw componentError(
      '组件 runtime 不能使用 require。',
      '请将全部依赖打入一个普通 JavaScript 文件。',
    )
  }
}

export function parseComponentPackageFiles(
  inputFiles: Readonly<Record<string, Uint8Array>>,
  options: ParseComponentPackageOptions = {},
): ImportedComponentPackage {
  const files = cloneFiles(inputFiles)
  let totalBytes = 0
  for (const path of Object.keys(files)) {
    assertSafeArchivePath(path, 'component')
    totalBytes += files[path]!.byteLength
    if (totalBytes > MAX_COMPONENT_UNCOMPRESSED_BYTES) {
      throw componentError(
        '组件包解压后超过 50MB 限制。',
        '请压缩组件素材，或移除不需要的文件后重试。',
      )
    }
  }

  const manifestBytes = files['manifest.json']
  if (manifestBytes === undefined) {
    throw componentError('组件包缺少根目录下的 manifest.json。')
  }
  const manifest = readManifest(manifestBytes)

  if (options.expectedId !== undefined && manifest.id !== options.expectedId) {
    throw componentError(
      `组件 ID 不匹配：工程需要“${options.expectedId}”，包内声明为“${manifest.id}”。`,
      '请重新导入与工程节点匹配的组件包。',
    )
  }
  if (options.expectedVersion !== undefined && manifest.version !== options.expectedVersion) {
    throw componentError(
      `组件版本不匹配：工程需要“${options.expectedVersion}”，包内声明为“${manifest.version}”。`,
      '请重新导入正确版本的组件包。',
    )
  }
  if (
    manifest.minSize.width > manifest.defaultSize.width ||
    manifest.minSize.height > manifest.defaultSize.height
  ) {
    throw componentError('组件 minSize 不能大于 defaultSize。')
  }

  assertSafeArchivePath(manifest.entry, 'component')
  if (!manifest.entry.toLowerCase().endsWith('.js')) {
    throw componentError('组件 entry 必须指向一个 JavaScript 文件。')
  }
  const runtimeBytes = files[manifest.entry]
  if (runtimeBytes === undefined) {
    throw componentError(`组件包缺少 runtime 文件“${manifest.entry}”。`)
  }
  const runtimeSource = decodeUtf8(runtimeBytes, manifest.entry)
  validateComponentRuntimeSource(runtimeSource)

  let thumbnailUrl: string | undefined
  if (manifest.thumbnail !== undefined) {
    assertSafeArchivePath(manifest.thumbnail, 'component')
    const thumbnailBytes = files[manifest.thumbnail]
    if (thumbnailBytes === undefined) {
      throw componentError(`组件包缺少缩略图“${manifest.thumbnail}”。`)
    }
    const mimeType = thumbnailMimeType(manifest.thumbnail)
    thumbnailUrl = options.blobUrlRegistry?.create(
      `component:${componentPackageKey(manifest.id, manifest.version)}:thumbnail`,
      thumbnailBytes,
      mimeType,
    )
  }

  for (const [assetKey, assetPath] of Object.entries(manifest.assets)) {
    if (assetKey.trim().length === 0) {
      throw componentError('组件素材键不能为空。')
    }
    assertSafeArchivePath(assetPath, 'component')
    if (files[assetPath] === undefined) {
      throw componentError(`组件素材“${assetKey}”缺少文件“${assetPath}”。`)
    }
  }

  const key = componentPackageKey(manifest.id, manifest.version)
  const archiveRoot = componentArchiveRoot(manifest.id, manifest.version)
  const contentSha256 = componentContentSha256(files)
  const metadata: EmbeddedComponentPackageMeta = {
    packageId: manifest.id,
    version: manifest.version,
    name: manifest.name,
    manifestPath: `${archiveRoot}/manifest.json`,
    runtimePath: `${archiveRoot}/${manifest.entry}`,
    contentSha256,
    ...(manifest.thumbnail === undefined
      ? {}
      : { thumbnailPath: `${archiveRoot}/${manifest.thumbnail}` }),
    ...(options.provenance === undefined ? {} : options.provenance),
  }

  return {
    key,
    metadata,
    manifest,
    runtimeSource,
    files,
    contentSha256,
    ...(thumbnailUrl === undefined ? {} : { thumbnailUrl }),
    ...(options.provenance === undefined
      ? {}
      : { provenance: { ...options.provenance } }),
  }
}

export function importComponentPackage(
  bytes: Uint8Array,
  options: ParseComponentPackageOptions = {},
): ImportedComponentPackage {
  if (bytes.byteLength === 0) {
    throw componentError('所选组件包为空。')
  }

  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes, componentArchiveFilter())
  } catch (error) {
    if (error instanceof UserFacingError) throw error
    throw componentError('无法解压组件包，文件可能已损坏。', undefined, error)
  }

  return parseComponentPackageFiles(files, options)
}

export async function importComponentPackageAsync(
  bytes: Uint8Array,
  options: ParseComponentPackageOptions = {},
): Promise<ImportedComponentPackage> {
  if (bytes.byteLength === 0) {
    throw componentError('所选组件包为空。')
  }
  const files = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    try {
      unzip(bytes, componentArchiveFilter(), (error, output) => {
        if (error) {
          reject(
            error instanceof UserFacingError
              ? error
              : componentError('无法解压组件包，文件可能已损坏。', undefined, error),
          )
          return
        }
        resolve(output)
      })
    } catch (error) {
      reject(
        error instanceof UserFacingError
          ? error
          : componentError('无法解压组件包，文件可能已损坏。', undefined, error),
      )
    }
  })
  return parseComponentPackageFiles(files, options)
}

export async function componentPackageSha256(bytes: Uint8Array): Promise<string> {
  const stableBytes = Uint8Array.from(bytes)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', stableBytes.buffer)
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}
