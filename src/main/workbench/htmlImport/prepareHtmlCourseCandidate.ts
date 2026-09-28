import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { UserFacingError } from '../../../shared/errors'
import type { DocumentModel, DocumentSnapshot } from '../../../shared/workbench/document'
import { courseProjectDocumentSchema } from '../../../shared/courseProjectSchema'
import { createHtmlDocumentRuntimeSource } from '../../../shared/runtime/htmlDocumentSource'
import { validateRuntimeSource } from '../../../shared/runtimeSourceValidation'
import { validateCourseProjectArchiveData } from '../../../core/drivers/codecs/courseProjectArchive'
import { allocateCourseLayerOrder } from '../../../core/tools/layerOrder'
import { mutateAddSlideScene } from '../../../core/tools/slideStructure'
import { insertHtmlImportEmptyParagraph, resolveHtmlImportDestination, resolveHtmlImportTarget } from './resolveHtmlImportTarget'
import { prepareImageResource } from '../admittedImageResource'
import { readHtmlClosure } from './readHtmlClosure'
import { validateHtmlImport } from './validateHtmlImport'
import { collectRemoteMediaOrigins } from './remoteHtmlReferences'
import type { ExtractedResource, ImportDiagnostic } from './types'
import type { HtmlImportDestination } from '../../../shared/workbench/toolPorts'
import { splitHtmlSections, type HtmlSectionPage } from './splitHtmlSections'

type CourseModel = Extract<DocumentModel, { kind: 'course-v9' }>
export interface HtmlImportTarget { documentId: string; epoch: string; baseRevision: number; projectId: string; locationId: string; surfaceId: string; anchorBlockId?: string }
export interface HtmlCourseCandidate {
  target: HtmlImportTarget
  sourcePath: string
  model: CourseModel
  instanceId: string
  diagnostics: ImportDiagnostic[]
  networkOrigins: string[]
  pages?: readonly { order: number; location: string; runtimeId: string }[]
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
  snapshot: DocumentSnapshot
  sourcePath: string
  locationId?: string
  anchorBlockId?: string
  rootDir?: string
  sourceHtml?: string
  sections?: readonly HtmlSectionPage[]
  destinations?: readonly HtmlImportDestination[]
  mode?: 'whole' | 'sections'
  operationId?: string
  signal?: AbortSignal
}): Promise<HtmlCourseCandidate> {
  const { snapshot, signal } = input
  signal?.throwIfAborted()
  if (snapshot.model.kind !== 'course-v9') throw new Error('HTML 页面只能导入 Course V9 文档')

  const closure = await readHtmlClosure({
    htmlPath: input.sourcePath,
    ...(input.rootDir ? { rootDir: input.rootDir } : {}),
    ...(input.sourceHtml !== undefined ? { sourceHtml: input.sourceHtml } : {}),
  })
  signal?.throwIfAborted()
  const diagnostics = validateHtmlImport(closure)
  const errors = diagnostics.filter(item => item.level === 'error')
  if (errors.length) throw new UserFacingError('HTML 导入失败', errors.map(item => item.message).join('\n'), '请修正列出的不受支持或不安全资源后重试。')
  const networkOrigins = collectRemoteMediaOrigins(closure)
  const project = structuredClone(snapshot.model.project)
  if (networkOrigins.length) project.network = {
    ...project.network,
    connectOrigins: [...new Set([...(project.network?.connectOrigins ?? []), ...networkOrigins])].sort(),
  }
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

  // Multi-page mode
  if (input.sections && input.destinations) {
    const { destinations } = input
    const sections = splitHtmlSections(closure.html, input.mode ?? 'sections').sections
    if (sections.length !== input.sections.length) throw new Error('HTML 资源替换后分页结构改变；候选未建立')
    if (destinations.length !== 1 && destinations.length !== sections.length) {
      throw new Error(`显式逐页映射的目标数量 (${destinations.length}) 必须等于源页数 (${sections.length})，或仅提供一个 slide-new 目标按页序连续新建`)
    }
    if (sections.length > 1 && destinations.length === 1 && destinations[0]?.kind === 'slide-existing') {
      resolveHtmlImportDestination(project, destinations[0], 0, input.operationId ?? input.sourcePath)
      throw new Error('多个 HTML 页面不能叠在同一个已有 Slide 场景')
    }
    const existingSlideTargets = destinations.filter(item => item.kind === 'slide-existing').map(item => item.location)
    if (new Set(existingSlideTargets).size !== existingSlideTargets.length) throw new Error('多个 HTML 页面不能叠在同一个已有 Slide 场景')
    const pages: { order: number; location: string; runtimeId: string }[] = []
    let previousCreatedSceneId: string | undefined

    for (let i = 0; i < sections.length; i += 1) {
      const section = sections[i]!
      const destination = destinations.length === 1 ? destinations[0]! : destinations[i]!
      const resolved = resolveHtmlImportDestination(project, destination, i, input.operationId ?? input.sourcePath)
      signal?.throwIfAborted()

      let targetSurfaceId: string
      let targetLocationId: string
      let targetSceneId: string | undefined

      if (resolved.kind === 'slide-new') {
        const added = mutateAddSlideScene(project, resolved.surfaceId, { name: section.title ?? `第 ${i + 1} 幕` })
        project.surfaces = added.surfaces
        project.locations = added.locations
        project.mixedPrintPlan = added.mixedPrintPlan
        const targetSurface = project.surfaces.find(s => s.id === resolved.surfaceId)
        if (!targetSurface || targetSurface.type !== 'slide') throw new Error('创建 Slide 场景失败')
        const scene = targetSurface.scenes[targetSurface.scenes.length - 1]!
        const after = destinations.length === 1 && previousCreatedSceneId ? previousCreatedSceneId : resolved.after
        if (after) {
          const index = targetSurface.scenes.findIndex(item => item.id === after)
          if (index < 0 || after === scene.id) throw new Error('新页插入位置不属于目标 Slide 表面')
          targetSurface.scenes.splice(targetSurface.scenes.length - 1, 1)
          targetSurface.scenes.splice(index + 1, 0, scene)
          const createdIndex = project.locations.findIndex(item => item.kind === 'slide-scene' && item.surfaceId === targetSurface.id && item.sceneId === scene.id)
          const [created] = project.locations.splice(createdIndex, 1)
          const afterIndex = project.locations.findIndex(item => item.kind === 'slide-scene' && item.surfaceId === targetSurface.id && item.sceneId === after)
          project.locations.splice(afterIndex + 1, 0, created!)
          const print = project.mixedPrintPlan?.entries.find(item => item.kind === 'slide-scenes' && item.surfaceId === targetSurface.id)
          if (print?.kind === 'slide-scenes') print.sceneIds = targetSurface.scenes.map(item => item.id)
        }
        previousCreatedSceneId = scene.id
        targetSurfaceId = targetSurface.id
        targetSceneId = scene.id
        targetLocationId = scene.id
      } else if (resolved.kind === 'slide') {
        targetSurfaceId = resolved.surfaceId
        targetSceneId = resolved.sceneId
        targetLocationId = resolved.locationId
      } else {
        targetSurfaceId = resolved.surfaceId
        targetLocationId = resolved.locationId
        const flowSurface = project.surfaces.find(s => s.id === targetSurfaceId)
        if (!flowSurface || flowSurface.type !== 'flow') throw new Error('目标不是 Flow 表面')
        insertHtmlImportEmptyParagraph(flowSurface, resolved)
      }

      const targetSurface = project.surfaces.find(s => s.id === targetSurfaceId)!
      const layerItems = targetSurface.type === 'slide'
        ? targetSurface.scenes.find(s => s.id === targetSceneId)?.layerItems
        : targetSurface.surfaceLayerItems.map(entry => entry.item)
      if (!layerItems) throw new Error('HTML 导入目标场景已不存在')

      const resourceKeys = closure.resources.map(item => item.key).filter(key => section.html.includes('cw-resource:' + key))
      const source = createHtmlDocumentRuntimeSource({ html: section.html, resourceKeys })
      validateRuntimeSource(source)

      const instanceId = `html_${createHash('sha256').update(`${snapshot.documentId}:${targetLocationId}:${i}:${input.sourcePath}:${source}`).digest('hex').slice(0, 24)}`
      const fallbackId = `runtime-capture-${instanceId}`
      const fallbackBytes = await sharp({ create: { width: 1, height: 1, channels: 4, background: '#ffffff' } }).png().toBuffer()
      const fallback = await prepareImageResource({ bytes: fallbackBytes, mimeType: 'image/png', filename: `${fallbackId}.png` }, () => fallbackId)
      project.assets[fallbackId] = { ...fallback.meta, id: fallbackId, path: `assets/${fallbackId}.png` }
      resources.assets[fallbackId] = fallback.bytes

      const frame = targetSurface.type === 'slide'
        ? { mode: 'absolute' as const, x: 0, y: 0, width: targetSurface.canvas.width, height: targetSurface.canvas.height }
        : { mode: 'absolute' as const, x: 0, y: 0, width: 760, height: 480 }

      const item = {
        layerItemId: instanceId, label: section.title ?? 'HTML 页面', kind: 'runtime' as const, frame,
        order: allocateCourseLayerOrder(project, Math.max(0, ...layerItems.map(value => value.order + 1))),
        visible: true, locked: false, rotation: 0, opacity: 1, hitPolicy: 'auto' as const, playbackInitialVisibility: 'inherit' as const,
        runtime: { protocol: 'surface-runtime' as const, runtimeApiVersion: 3 as const, enabled: true, renderMode: 'dom' as const,
          source, content: { values: {} }, assets: Object.fromEntries(resourceKeys.map(key => [key, assets[key]!])), staticFallback: { assetId: fallbackId, coverage: 'scene' as const } },
      }

      if (targetSurface.type === 'slide') {
        targetSurface.scenes.find(s => s.id === targetSceneId)!.layerItems.push(item)
      } else {
        targetSurface.surfaceLayerItems.push({
          item: { ...item, paperSpace: 'paper' },
          visibility: { mode: 'all', locationIds: [] },
          bodyPlane: 'overlay',
          paragraphAnchor: { blockId: (resolved as Extract<typeof resolved, { kind: 'flow' }>).anchorBlockId, offsetY: 0, xRatio: 0 },
        })
      }

      pages.push({ order: i, location: targetLocationId, runtimeId: instanceId })
    }

    const model: CourseModel = { kind: 'course-v9', project: courseProjectDocumentSchema.parse(project), resources }
    validateCourseProjectArchiveData({ project: model.project, assetFiles: model.resources.assets, componentFiles: model.resources.components })
    signal?.throwIfAborted()
    return {
      target: {
        documentId: snapshot.documentId,
        epoch: snapshot.epoch,
        baseRevision: snapshot.revision,
        projectId: project.id,
        locationId: pages[0]?.location ?? '',
        surfaceId: destinations[0]?.kind === 'slide-new' ? destinations[0].surface : '',
      },
      sourcePath: input.sourcePath,
      model,
      instanceId: pages[0]?.runtimeId ?? '',
      diagnostics,
      networkOrigins,
      pages,
    }
  }

  // Single-target mode (legacy)
  if (!input.locationId) throw new Error('HTML 导入缺少目标位置')
  const destination = resolveHtmlImportTarget(project, input.locationId, input.anchorBlockId)
  const source = createHtmlDocumentRuntimeSource({ html: closure.html, resourceKeys: closure.resources.map(item => item.key) })
  validateRuntimeSource(source)
  const instanceId = `html_${createHash('sha256').update(`${snapshot.documentId}:${input.locationId}:${destination.kind === 'flow' ? destination.anchorBlockId : 'slide'}:${input.sourcePath}:${source}`).digest('hex').slice(0, 24)}`
  const fallbackId = `runtime-capture-${instanceId}`
  const fallbackBytes = await sharp({ create: { width: 1, height: 1, channels: 4, background: '#ffffff' } }).png().toBuffer()
  const fallback = await prepareImageResource({ bytes: fallbackBytes, mimeType: 'image/png', filename: `${fallbackId}.png` }, () => fallbackId)
  project.assets[fallbackId] = { ...fallback.meta, id: fallbackId, path: `assets/${fallbackId}.png` }
  resources.assets[fallbackId] = fallback.bytes
  const targetSurface = project.surfaces.find(item => item.id === destination.surfaceId)
  if (!targetSurface || targetSurface.type !== destination.kind) throw new Error('HTML 导入目标 Surface 已不存在')
  const layerItems = destination.kind === 'slide'
    ? targetSurface.type === 'slide' ? targetSurface.scenes.find(item => item.id === destination.sceneId)?.layerItems : undefined
    : targetSurface.type === 'flow' ? targetSurface.surfaceLayerItems.map(entry => entry.item) : undefined
  if (!layerItems) throw new Error('HTML 导入目标场景已不存在')
  if (layerItems.some(item => item.layerItemId === instanceId)) throw new Error('HTML 页面已在目标位置中，不能重复追加')
  const frame = destination.kind === 'slide' && targetSurface.type === 'slide'
    ? { mode: 'absolute' as const, x: 0, y: 0, width: targetSurface.canvas.width, height: targetSurface.canvas.height }
    : { mode: 'absolute' as const, x: 0, y: 0, width: 760, height: 480 }
  const item = {
    layerItemId: instanceId, label: 'HTML 页面', kind: 'runtime' as const, frame,
    order: allocateCourseLayerOrder(project, Math.max(0, ...layerItems.map(value => value.order + 1))),
    visible: true, locked: false, rotation: 0, opacity: 1, hitPolicy: 'auto' as const, playbackInitialVisibility: 'inherit' as const,
    runtime: { protocol: 'surface-runtime' as const, runtimeApiVersion: 3 as const, enabled: true, renderMode: 'dom' as const,
      source, content: { values: {} }, assets, staticFallback: { assetId: fallbackId, coverage: 'scene' as const } },
  }
  if (destination.kind === 'slide' && targetSurface.type === 'slide') {
    targetSurface.scenes.find(scene => scene.id === destination.sceneId)!.layerItems.push(item)
  } else if (destination.kind === 'flow' && targetSurface.type === 'flow') {
    insertHtmlImportEmptyParagraph(targetSurface, destination)
    targetSurface.surfaceLayerItems.push({ item: { ...item, paperSpace: 'paper' }, visibility: { mode: 'all', locationIds: [] },
      bodyPlane: 'overlay', paragraphAnchor: { blockId: destination.anchorBlockId, offsetY: 0, xRatio: 0 } })
  }
  const model: CourseModel = { kind: 'course-v9', project: courseProjectDocumentSchema.parse(project), resources }
  validateCourseProjectArchiveData({ project: model.project, assetFiles: model.resources.assets, componentFiles: model.resources.components })
  signal?.throwIfAborted()
  return { target: { documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision, projectId: project.id, locationId: destination.locationId, surfaceId: destination.surfaceId, ...(destination.kind === 'flow' ? { anchorBlockId: destination.anchorBlockId } : {}) },
    sourcePath: input.sourcePath, model, instanceId, diagnostics, networkOrigins, pages: [{ order: 0, location: destination.locationId, runtimeId: instanceId }] }
}
