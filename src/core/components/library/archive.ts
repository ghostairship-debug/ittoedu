import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { z } from 'zod'
import type { ComponentLibraryEntry } from '../../../shared/contracts/component-platform/library'
import { componentAssetSchema, componentDefinitionSchema, componentInstanceSchema } from '../../../shared/contracts/component-platform/schema'
import { assertSafeArchivePath } from '../../drivers/codecs/archivePath'
import type { LibraryDiagnostic } from './types'

export const COMPONENT_LIBRARY_ARCHIVE_FORMAT = 'guoling-component-library'
const entrySchema = z.object({
  schemaVersion: z.literal(1), id: z.string().min(1), title: z.string(),
  definitions: z.record(z.string(), componentDefinitionSchema),
  example: z.object({ instances: z.record(z.string(), componentInstanceSchema), rootIds: z.array(z.string().min(1)) }),
  assets: z.record(z.string(), componentAssetSchema),
  inputs: z.array(z.object({ instanceId: z.string(), path: z.array(z.string()), role: z.string() })).optional(),
})
const manifestSchema = z.object({
  format: z.literal(COMPONENT_LIBRARY_ARCHIVE_FORMAT), version: z.string().min(1), entry: entrySchema,
  resources: z.object({ assets: z.record(z.string(), z.string()), components: z.record(z.string(), z.record(z.string(), z.string())) }),
})
const metadataSchema = z.object({ description: z.string().optional(), subject: z.array(z.string()).optional(), schoolStage: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(), sourceCourse: z.string().optional() })
export interface ComponentLibraryArchiveMetadata { description?: string; subject?: readonly string[]; schoolStage?: readonly string[]; tags?: readonly string[]; sourceCourse?: string }
export interface ComponentLibraryArchive { entry: ComponentLibraryEntry; version: string; metadata?: ComponentLibraryArchiveMetadata; diagnostics?: LibraryDiagnostic[] }

/** The existing package file service transports this archive; author identities remain software-owned. */
export function exportComponentLibraryArchive(entry: ComponentLibraryEntry, version = Object.values(entry.definitions)[0]?.version ?? '1.0.0', metadata?: ComponentLibraryArchiveMetadata): Uint8Array {
  const files: Record<string, Uint8Array> = {}
  const paths = { assets: {} as Record<string, string>, components: {} as Record<string, Record<string, string>> }
  for (const [id, bytes] of Object.entries(entry.resources.assets)) {
    const name = `assets/${encodeURIComponent(id)}`; files[name] = bytes; paths.assets[id] = name
  }
  for (const [id, resources] of Object.entries(entry.resources.components)) {
    paths.components[id] = {}
    for (const [file, bytes] of Object.entries(resources)) {
      const name = `components/${encodeURIComponent(id)}/${encodeURIComponent(file)}`
      files[name] = bytes; paths.components[id][file] = name
    }
  }
  const { resources: _resources, ...author } = entry
  files['manifest.json'] = strToU8(JSON.stringify({ format: COMPONENT_LIBRARY_ARCHIVE_FORMAT, version, entry: author, resources: paths, ...(metadata ? { metadata } : {}) }))
  return zipSync(files)
}

export function importComponentLibraryArchive(bytes: Uint8Array): ComponentLibraryArchive {
  const files = unzipSync(bytes, { filter(file) { assertSafeArchivePath(file.name, 'component', { allowDirectory: true }); return !file.name.endsWith('/') } })
  if (!files['manifest.json']) throw new Error('组件条目缺少 manifest.json；原文件已保留。')
  const raw = JSON.parse(strFromU8(files['manifest.json'])) as { format?: string; metadata?: unknown }
  if (raw.format !== COMPONENT_LIBRARY_ARCHIVE_FORMAT) throw new Error('此文件不是 V10 组件库条目；旧组件格式不兼容，原文件已保留。')
  const manifest = manifestSchema.parse(raw)
  const diagnostics: LibraryDiagnostic[] = []
  let metadata: ComponentLibraryArchiveMetadata | undefined
  if (raw.metadata !== undefined) {
    if (raw.metadata && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata)) {
      const values: Record<string, unknown> = {}
      for (const [field, schema] of Object.entries(metadataSchema.shape)) {
        const result = schema.safeParse((raw.metadata as Record<string, unknown>)[field])
        if (result.success) { if (result.data !== undefined) values[field] = result.data }
        else diagnostics.push({ code: 'metadata-invalid', message: `metadata.${field} 格式不可用，已忽略；组件内容仍可使用。` })
      }
      metadata = values
    } else diagnostics.push({ code: 'metadata-invalid', message: 'metadata 不是元数据记录，已忽略；组件内容仍可使用。' })
  }
  const read = (file: string) => {
    assertSafeArchivePath(file, 'component')
    const value = files[file]
    if (!value) throw new Error(`组件资源缺失：${file}`)
    return Uint8Array.from(value)
  }
  const resources = {
    assets: Object.fromEntries(Object.entries(manifest.resources.assets).map(([id, file]) => [id, read(file)])),
    components: Object.fromEntries(Object.entries(manifest.resources.components).map(([id, values]) => [id,
      Object.fromEntries(Object.entries(values).map(([name, file]) => [name, read(file)]))])),
  }
  const entry: ComponentLibraryEntry = { ...manifest.entry, resources }
  for (const [id, definition] of Object.entries(entry.definitions)) if (id !== definition.id) throw new Error('条目定义索引与身份不一致')
  for (const [id, instance] of Object.entries(entry.example.instances)) {
    if (id !== instance.id || !entry.definitions[instance.definitionId]) throw new Error(`条目实例定义缺失：${id}`)
    if (instance.childIds?.some(child => !entry.example.instances[child])) throw new Error(`条目子对象缺失：${id}`)
  }
  if (entry.example.rootIds.some(id => !entry.example.instances[id])) throw new Error('条目根对象不存在')
  return { entry, version: manifest.version, ...(metadata ? { metadata } : {}), ...(diagnostics.length ? { diagnostics } : {}) }
}
