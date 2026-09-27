import { createHash } from 'node:crypto'
import sharp from 'sharp'
import type { DocumentModel, DocumentSnapshot } from '../../../shared/workbench/document'
import { courseProjectDocumentSchema } from '../../../shared/courseProjectSchema'
import { createHtmlDocumentRuntimeSource } from '../../../shared/runtime/htmlDocumentSource'
import { validateRuntimeSource } from '../../../shared/runtimeSourceValidation'
import { validateCourseProjectArchiveData } from '../../../core/drivers/codecs/courseProjectArchive'
import { prepareImageResource } from '../admittedImageResource'
import { readHtmlClosure } from './readHtmlClosure'
import { validateHtmlImport } from './validateHtmlImport'
import type { ExtractedResource, ImportDiagnostic } from './types'

type CourseModel = Extract<DocumentModel, { kind: 'course-v9' }>
export interface HtmlImportTarget { documentId: string; epoch: string; baseRevision: number; projectId: string; locationId: string }
export interface HtmlCourseCandidate {
  target: HtmlImportTarget
  sourcePath: string
  model: CourseModel
  instanceId: string
  diagnostics: ImportDiagnostic[]
}

function assetKind(resource: ExtractedResource): 'image' | 'audio' | 'video' | 'font' {
  const type = resource.mediaType.split('/')[0]
  if (type === 'image' || type === 'audio' || type === 'video' || type === 'font') return type
  if (resource.mediaType.includes('font') || resource.mediaType.includes('woff')) return 'font'
  throw new Error(`HTML 资源类型暂不能作为受管素材导入：${resource.mediaType}`)
}

function extension(resource: ExtractedResource): string {
  const known: Record<string, string> = { 'image/jpeg': 'jpg', 'image/svg+xml': 'svg', 'audio/mpeg': 'mp3', 'font/woff': 'woff', 'font/woff2': 'woff2' }
  return known[resource.mediaType] ?? resource.mediaType.split('/')[1]?.replace(/[^a-z0-9]/gi, '') ?? 'bin'
}

/** Pure preparation except for the confined source-closure read. No document write occurs here. */
export async function prepareHtmlCourseCandidate(input: {
  snapshot: DocumentSnapshot; sourcePath: string; locationId: string; rootDir?: string; signal?: AbortSignal
}): Promise<HtmlCourseCandidate> {
  const { snapshot, signal } = input
  signal?.throwIfAborted()
  if (snapshot.model.kind !== 'course-v9') throw new Error('HTML 页面只能导入 Course V9 文档')
  const location = snapshot.model.project.locations.find(item => item.id === input.locationId)
  const surface = snapshot.model.project.surfaces.find(item => item.id === location?.surfaceId)
  if (!location || location.kind !== 'slide-scene' || surface?.type !== 'slide') {
    throw new Error('当前受控导入仅支持明确指定的 Slide 场景；Flow 页面 Runtime 待正文载体接入')
  }
  const closure = await readHtmlClosure({ htmlPath: input.sourcePath, ...(input.rootDir ? { rootDir: input.rootDir } : {}) })
  signal?.throwIfAborted()
  const errors = validateHtmlImport(closure)
  if (errors.length) throw new Error(errors.map(item => item.message).join('\n'))
  const project = structuredClone(snapshot.model.project)
  const resources = structuredClone(snapshot.model.resources)
  const assets: Record<string, { assetId: string }> = {}
  for (const resource of closure.resources) {
    const kind = assetKind(resource)
    const id = `html_${resource.key}`
    const filename = `${resource.key}.${extension(resource)}`
    const previous = project.assets[id]
    if (previous && (previous.mimeType !== resource.mediaType || previous.byteLength !== resource.bytes.byteLength)) throw new Error('HTML 素材身份冲突')
    project.assets[id] ??= { id, filename, mimeType: resource.mediaType, kind, path: `assets/${filename}`, byteLength: resource.bytes.byteLength }
    resources.assets[id] = Uint8Array.from(resource.bytes)
    assets[resource.key] = { assetId: id }
  }
  const source = createHtmlDocumentRuntimeSource({ html: closure.html, resourceKeys: closure.resources.map(item => item.key) })
  validateRuntimeSource(source)
  const instanceId = `html_${createHash('sha256').update(`${snapshot.documentId}:${input.locationId}:${input.sourcePath}:${source}`).digest('hex').slice(0, 24)}`
  // The existing capture projection requires a declared image fallback before admission.
  // Its temporary capture ID is replaced and garbage-collected after the real host capture.
  const fallbackId = `runtime-capture-${instanceId}`
  const fallbackBytes = await sharp({ create: { width: 1, height: 1, channels: 4, background: '#ffffff' } }).png().toBuffer()
  const fallback = await prepareImageResource({ bytes: fallbackBytes, mimeType: 'image/png', filename: `${fallbackId}.png` }, () => fallbackId)
  project.assets[fallbackId] = { ...fallback.meta, id: fallbackId, path: `assets/${fallbackId}.png` }
  resources.assets[fallbackId] = fallback.bytes
  const targetSurface = project.surfaces.find(item => item.id === location.surfaceId)
  if (targetSurface?.type !== 'slide') throw new Error('目标 Slide Surface 已不存在')
  const scene = targetSurface.scenes.find(item => item.id === location.sceneId)
  if (!scene) throw new Error('目标 Slide 场景已不存在')
  if (scene.layerItems.some(item => item.layerItemId === instanceId)) throw new Error('HTML 页面已在目标场景中，不能重复追加')
  scene.layerItems.push({
    layerItemId: instanceId, label: 'HTML 页面', kind: 'runtime', frame: { mode: 'absolute', x: 0, y: 0, width: targetSurface.canvas.width, height: targetSurface.canvas.height },
    order: scene.layerItems.length, visible: true, locked: false, rotation: 0, opacity: 1, hitPolicy: 'auto', playbackInitialVisibility: 'inherit',
    runtime: { protocol: 'surface-runtime', runtimeApiVersion: 3, enabled: true, renderMode: 'dom', source, content: { values: {} }, assets,
      staticFallback: { assetId: fallbackId, coverage: 'scene' } },
  })
  const model: CourseModel = { kind: 'course-v9', project: courseProjectDocumentSchema.parse(project), resources }
  validateCourseProjectArchiveData({ project: model.project, assetFiles: model.resources.assets, componentFiles: model.resources.components })
  signal?.throwIfAborted()
  return { target: { documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision, projectId: project.id, locationId: location.id },
    sourcePath: input.sourcePath, model, instanceId, diagnostics: closure.diagnostics }
}
