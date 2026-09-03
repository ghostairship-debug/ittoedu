import type {
  PublishedCourseV2Payload,
  PublishedLayerItem,
  PublishedNativeLayerItem,
  PublishedSpatialSurface,
} from '../../../shared/publishedCourseTypes'
import {
  collectSpatialPlaybackEntries,
  publishedSpatialInputFromCourse,
  spatialRuntimeCameraFromPose,
  worldItemWithinRuntimeCamera,
  type SpatialCoordinateSpace,
} from './spatialModel'

/** Transitional PPTX viewport; PDF uses the actual Published Surface capture. */
export const SPATIAL_EXPORT_VIEWPORT = { width: 1120, height: 760 } as const

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function shouldOmitPublishedItemFromStaticExport(item: PublishedLayerItem): boolean {
  return item.kind === 'native'
    && item.content.nativeType === 'teacher-controller'
    && !item.content.data.includeInStaticExports
}

function publishedDynamicFallbackAssetId(item: PublishedLayerItem): string | undefined {
  if (item.kind === 'component') return item.staticFallbackAssetId
  if (item.kind === 'runtime') return item.runtime.staticFallback?.assetId
  return undefined
}

function spatialImagePreserveAspectRatio(fit: 'contain' | 'cover' | 'stretch'): string {
  if (fit === 'stretch') return 'none'
  return fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet'
}

function spatialItemRotation(item: PublishedLayerItem): string {
  if (item.rotation === 0) return ''
  return ` transform="rotate(${item.rotation} ${item.frame.x + item.frame.width / 2} ${item.frame.y + item.frame.height / 2})"`
}

function spatialShapeMarkup(item: PublishedNativeLayerItem): string {
  if (item.content.nativeType !== 'shape') return ''
  const { x, y, width, height } = item.frame
  const { shapeType, style } = item.content.data
  const fill = escapeXml(style.fillColor)
  const stroke = escapeXml(style.borderColor)
  const dash = style.lineStyle === 'dashed'
    ? ' stroke-dasharray="8 5"'
    : style.lineStyle === 'dotted'
      ? ' stroke-dasharray="2 4"'
      : ''
  const common = `fill="${fill}" fill-opacity="${style.fillOpacity}" stroke="${stroke}" stroke-opacity="${style.borderOpacity}" stroke-width="${style.borderWidth}"${dash}`
  if (shapeType === 'ellipse' || shapeType === 'emphasis-dot') {
    return `<ellipse cx="${x + width / 2}" cy="${y + height / 2}" rx="${width / 2}" ry="${height / 2}" ${common}/>`
  }
  if (shapeType === 'triangle' || shapeType === 'emphasis-triangle') {
    return `<polygon points="${x + width / 2},${y} ${x + width},${y + height} ${x},${y + height}" ${common}/>`
  }
  if (shapeType === 'diamond') {
    return `<polygon points="${x + width / 2},${y} ${x + width},${y + height / 2} ${x + width / 2},${y + height} ${x},${y + height / 2}" ${common}/>`
  }
  if (shapeType === 'rectangle' || shapeType === 'rounded-rectangle') {
    const radius = shapeType === 'rounded-rectangle'
      ? Math.max(0, Math.min(style.cornerRadius, width / 2, height / 2))
      : 0
    return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" ${common}/>`
  }
  if (shapeType.startsWith('brace') || shapeType.startsWith('bracket')) {
    const label = shapeType.startsWith('brace') ? '{ }' : '[ ]'
    return `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="none" stroke="none"/><text x="${x + width / 2}" y="${y + height / 2}" text-anchor="middle" dominant-baseline="middle" font-size="${Math.max(12, Math.min(width, height) * 0.7)}" fill="${stroke}">${label}</text>`
  }
  const horizontal = !shapeType.endsWith('-up') && !shapeType.endsWith('-down')
  const x1 = horizontal
    ? shapeType === 'arrow-left' ? x + width : x
    : x + width / 2
  const y1 = horizontal ? y + height / 2 : shapeType === 'arrow-up' ? y + height : y
  const x2 = horizontal
    ? shapeType === 'arrow-left' ? x : x + width
    : x + width / 2
  const y2 = horizontal ? y + height / 2 : shapeType === 'arrow-up' ? y : y + height
  const markerStart = shapeType === 'arrow-left-right' || style.startArrow !== 'none'
    ? ' marker-start="url(#pdf-spatial-arrow-start)"'
    : ''
  const markerEnd = shapeType.startsWith('arrow-') || shapeType === 'elbow-arrow' || style.endArrow !== 'none'
    ? ' marker-end="url(#pdf-spatial-arrow-end)"'
    : ''
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" fill="none" stroke="${stroke}" stroke-opacity="${style.borderOpacity}" stroke-width="${Math.max(1, style.borderWidth)}"${dash}${markerStart}${markerEnd}/>`
}

function renderSpatialItemMarkup(
  item: PublishedLayerItem,
  resolveAsset: (assetId: string) => string | undefined,
  coordinateSpace: SpatialCoordinateSpace,
): string {
  if (!item.visible || shouldOmitPublishedItemFromStaticExport(item)) return ''
  const rotation = spatialItemRotation(item)
  const prefix = `<g data-layer-item-id="${escapeXml(item.layerItemId)}" data-coordinate-space="${coordinateSpace}" opacity="${item.opacity}"${rotation}>`
  if (item.kind === 'native' && item.content.nativeType === 'text') {
    const { x, y, width, height } = item.frame
    const style = item.content.data.style
    const lines = item.content.data.text.split(/\r?\n/u)
    const text = lines.map((line, index) => (
      `<tspan x="${x + Math.max(0, style.padding)}" dy="${index === 0 ? 0 : style.fontSize * style.lineSpacing}">${escapeXml(line)}</tspan>`
    )).join('')
    return `${prefix}<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${Math.max(0, style.cornerRadius)}" fill="${escapeXml(style.backgroundColor)}" fill-opacity="${style.backgroundOpacity}"/><text x="${x + Math.max(0, style.padding)}" y="${y + Math.max(style.fontSize, style.padding + style.fontSize)}" font-family="${escapeXml(style.fontFamily)}" font-size="${style.fontSize}" font-weight="${style.bold ? '700' : '400'}" font-style="${style.italic ? 'italic' : 'normal'}" fill="${escapeXml(style.color)}">${text}</text></g>`
  }
  if (item.kind === 'native' && item.content.nativeType === 'image') {
    const href = resolveAsset(item.content.data.assetId)
    const { x, y, width, height } = item.frame
    if (href) {
      const clipId = `pdf-spatial-clip-${escapeXml(item.layerItemId)}`
      const flip = item.content.data.flipX || item.content.data.flipY
        ? ` transform="translate(${item.content.data.flipX ? 2 * x + width : 0} ${item.content.data.flipY ? 2 * y + height : 0}) scale(${item.content.data.flipX ? -1 : 1} ${item.content.data.flipY ? -1 : 1})"`
        : ''
      return `${prefix}<defs><clipPath id="${clipId}"><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${Math.max(0, item.content.data.cornerRadius)}"/></clipPath></defs><image href="${escapeXml(href)}" x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="${spatialImagePreserveAspectRatio(item.content.data.fit)}" clip-path="url(#${clipId})"${flip}/></g>`
    }
    return `${prefix}<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#f8fafc" stroke="#94a3b8" stroke-dasharray="4 3"/><text x="${x + 8}" y="${y + 20}" font-size="12" fill="#64748b">图片素材缺失</text></g>`
  }
  if (item.kind === 'native' && item.content.nativeType === 'shape') {
    return `${prefix}${spatialShapeMarkup(item)}</g>`
  }
  if (item.kind === 'native' && item.content.nativeType === 'formula') {
    const { x, y, width, height } = item.frame
    const style = item.content.data.style
    return `${prefix}<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#ffffff" fill-opacity="0.01"/><text x="${x + width / 2}" y="${y + height / 2}" text-anchor="middle" dominant-baseline="middle" font-size="${style.fontSize}" fill="${escapeXml(style.color)}">${escapeXml(item.content.data.accessibleText)}</text></g>`
  }
  if (item.kind === 'native' && item.content.nativeType === 'video') {
    const { x, y, width, height } = item.frame
    const posterId = item.content.data.poster.mode === 'image'
      ? item.content.data.poster.assetId
      : undefined
    const poster = posterId ? resolveAsset(posterId) : undefined
    if (poster) {
      return `${prefix}<image href="${escapeXml(poster)}" x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="${spatialImagePreserveAspectRatio(item.content.data.fit)}"/><text x="${x + width / 2}" y="${y + height / 2}" text-anchor="middle" dominant-baseline="middle" font-size="32" fill="#ffffff">▶</text></g>`
    }
    return `${prefix}<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#0f172a"/><text x="${x + width / 2}" y="${y + height / 2}" text-anchor="middle" dominant-baseline="middle" font-size="16" fill="#f8fafc">视频静态封面</text></g>`
  }
  if (item.kind === 'native' && item.content.nativeType === 'teacher-controller') {
    const { x, y, width, height } = item.frame
    return `${prefix}<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${item.content.data.style.cornerRadius}" fill="${escapeXml(item.content.data.style.backgroundColor)}" fill-opacity="${item.content.data.style.backgroundOpacity}"/><text x="${x + width / 2}" y="${y + height / 2}" text-anchor="middle" dominant-baseline="middle" font-size="14" fill="${escapeXml(item.content.data.style.textColor)}">${escapeXml(item.content.data.title)}</text></g>`
  }
  if (item.kind === 'component' || item.kind === 'runtime') {
    const { x, y, width, height } = item.frame
    const fallbackId = publishedDynamicFallbackAssetId(item)
    const href = fallbackId ? resolveAsset(fallbackId) : undefined
    if (href) {
      return `${prefix}<image href="${escapeXml(href)}" x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet"/></g>`
    }
    return `${prefix}<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#eff6ff" stroke="#2563eb" stroke-dasharray="4 3"/><text x="${x + 8}" y="${y + 20}" font-size="12" fill="#1d4ed8">${item.kind === 'component' ? '组件静态后备缺失' : '运行时静态后备缺失'}</text></g>`
  }
  return ''
}

function spatialPathDashArray(dash: 'solid' | 'dashed' | 'dotted' | undefined): string {
  if (dash === 'dashed') return '8 5'
  if (dash === 'dotted') return '2 4'
  return ''
}

function spatialWorldDecorationsMarkup(surface: PublishedSpatialSurface): string {
  const byId = new Map(surface.world.layerItems.map((item) => [item.layerItemId, item]))
  const center = (item: PublishedLayerItem) => ({
    x: item.frame.x + item.frame.width / 2,
    y: item.frame.y + item.frame.height / 2,
  })
  const paths = (surface.world.paths ?? []).map((path) => {
    const points = path.layerItemIds
      .map((id) => byId.get(id))
      .filter((item): item is PublishedLayerItem => Boolean(item))
      .map(center)
    if (points.length === 0) return ''
    const dash = spatialPathDashArray(path.style?.dash)
    return `<polyline data-spatial-path-id="${escapeXml(path.id)}" data-spatial-path-name="${escapeXml(path.name)}" points="${points.map((point) => `${point.x},${point.y}`).join(' ')}" fill="none" stroke="${escapeXml(path.style?.color ?? '#64748b')}" stroke-width="${Math.max(0.5, path.style?.width ?? 2)}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`
  }).join('')
  const relations = (surface.world.relations ?? []).map((relation) => {
    const source = byId.get(relation.sourceLayerItemId)
    const target = byId.get(relation.targetLayerItemId)
    if (!source || !target) return ''
    const from = center(source)
    const to = center(target)
    const markerStart = relation.kind === 'bidirectional'
      ? ' marker-start="url(#pdf-spatial-arrow-start)"'
      : ''
    const markerEnd = relation.kind === 'arrow' || relation.kind === 'bidirectional'
      ? ' marker-end="url(#pdf-spatial-arrow-end)"'
      : ''
    const label = relation.label
      ? `<text data-spatial-relation-label="${escapeXml(relation.id)}" x="${(from.x + to.x) / 2}" y="${(from.y + to.y) / 2}" text-anchor="middle" font-size="12" fill="#334155">${escapeXml(relation.label)}</text>`
      : ''
    return `<line data-spatial-relation-id="${escapeXml(relation.id)}" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="#64748b" stroke-width="2"${markerStart}${markerEnd}/>${label}`
  }).join('')
  return `${paths}${relations}`
}

export interface RenderPublishedSpatialFrameOptions {
  published?: PublishedCourseV2Payload
  locationId?: string
  includeGlobalLayerItems?: boolean
}

/**
 * Transitional PPTX-only static renderer. PDF captures the actual V2 host.
 * Kept in the Spatial owner so export modules do not own Spatial paint rules.
 */
export function renderPublishedSpatialFrameSvg(
  surface: PublishedSpatialSurface,
  frameId: string | undefined,
  resolveAsset: (assetId: string) => string | undefined,
  options: RenderPublishedSpatialFrameOptions = {},
): { svg: string; viewport: { width: number; height: number } } {
  const frame = frameId
    ? surface.camera.frames.find((candidate) => candidate.id === frameId)
    : undefined
  const pose = frame ?? surface.camera.home
  const camera = spatialRuntimeCameraFromPose(pose, SPATIAL_EXPORT_VIEWPORT)
  const entries = options.published && options.locationId
    ? collectSpatialPlaybackEntries(
        publishedSpatialInputFromCourse(options.published, { surfaceId: surface.id }),
        options.locationId,
      )
    : surface.world.layerItems.map((item, stackOrder) => ({
        item,
        source: 'world' as const,
        coordinateSpace: 'world' as const,
        globalPlane: null,
        stackOrder,
      }))
  const applicable = entries.filter((entry) => (
    (options.includeGlobalLayerItems || entry.source !== 'global')
    && !shouldOmitPublishedItemFromStaticExport(entry.item)
    && (entry.coordinateSpace === 'viewport'
      || worldItemWithinRuntimeCamera(entry.item, camera, surface.semanticZoom))
  ))
  const worldItems = applicable
    .filter((entry) => entry.coordinateSpace === 'world')
    .map((entry) => renderSpatialItemMarkup(entry.item, resolveAsset, entry.coordinateSpace))
    .join('')
  const viewportItems = applicable
    .filter((entry) => entry.coordinateSpace === 'viewport')
    .map((entry) => renderSpatialItemMarkup(entry.item, resolveAsset, entry.coordinateSpace))
    .join('')
  const transform = `translate(${camera.viewportWidth / 2} ${camera.viewportHeight / 2}) scale(${camera.zoom}) translate(${-camera.x} ${-camera.y})`
  const background = surface.backgroundColor?.trim() || '#ffffff'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${camera.viewportWidth}" height="${camera.viewportHeight}" viewBox="0 0 ${camera.viewportWidth} ${camera.viewportHeight}" preserveAspectRatio="xMidYMid meet" data-spatial-frame="${escapeXml(frameId ?? 'home')}" data-spatial-viewport="${camera.viewportWidth}x${camera.viewportHeight}"><defs><marker id="pdf-spatial-arrow-end" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#64748b"/></marker><marker id="pdf-spatial-arrow-start" viewBox="0 0 10 10" refX="1" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 10 0 L 0 5 L 10 10 z" fill="#64748b"/></marker></defs><rect width="100%" height="100%" fill="${escapeXml(background)}"/><g transform="${transform}">${spatialWorldDecorationsMarkup(surface)}${worldItems}</g>${viewportItems}</svg>`
  return { svg, viewport: SPATIAL_EXPORT_VIEWPORT }
}
