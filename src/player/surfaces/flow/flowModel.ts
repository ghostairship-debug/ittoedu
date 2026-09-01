import type { CourseLocation, FlowBlock, FlowTableCell } from '../../../shared/courseProjectTypes'
import type { TextRun, TextRunStyle } from '../../../shared/projectTypes'
import type {
  PublishedCourseAsset,
  PublishedCourseSurface,
  PublishedCourseV2Payload,
  PublishedFlowSurface,
  PublishedGlobalLayerEntry,
} from '../../../shared/publishedCourseTypes'

export type {
  FlowBlock,
  FlowTableCell,
} from '../../../shared/courseProjectTypes'
export type { PublishedFlowSurface } from '../../../shared/publishedCourseTypes'

export const FLOW_BLANK_HEADING_FALLBACK = '无标题'
export const FLOW_BLANK_SECTION_FALLBACK = '分节'
export const FLOW_LOGICAL_CANVAS = { width: 1280, height: 720 } as const

export interface FlowPublishedPlaybackDocument {
  readonly courseId: string
  readonly title: string
  readonly assets: Record<string, PublishedCourseAsset>
  readonly media?: PublishedCourseV2Payload['media']
  readonly playback?: PublishedCourseV2Payload['playback']
  readonly locations: readonly CourseLocation[]
  readonly startLocationId: string
  readonly globalLayerItems: readonly PublishedGlobalLayerEntry[]
  readonly surfaces: readonly PublishedFlowSurface[]
}

export type FlowPublishedPlaybackSource =
  | PublishedCourseV2Payload
  | FlowPublishedPlaybackDocument

export interface FlowRichTextSegment {
  readonly text: string
  readonly style: TextRunStyle
}

export interface FlowBlockWalk {
  readonly block: FlowBlock
  readonly parentId: string | null
  readonly index: number
  readonly depth: number
}

export function isPublishedCourseV2(
  source: FlowPublishedPlaybackSource,
): source is PublishedCourseV2Payload {
  return 'format' in source
    && source.format === 'h5course-published'
    && source.formatVersion === 2
}

export function isPublishedFlowSurface(
  surface: PublishedCourseSurface | PublishedFlowSurface,
): surface is PublishedFlowSurface {
  return surface.type === 'flow'
}

export function cloneJson<T>(value: T): T {
  return structuredClone(value)
}

export function walkFlowBlocks(
  blocks: readonly FlowBlock[],
  visit: (walk: FlowBlockWalk) => void,
  parentId: string | null = null,
  depth = 0,
): void {
  blocks.forEach((block, index) => {
    visit({ block, parentId, index, depth })
    if (block.type === 'section') walkFlowBlocks(block.blocks, visit, block.id, depth + 1)
  })
}

export function isFlowRuntimeTocAnchor(
  block: FlowBlock,
): block is Extract<FlowBlock, { type: 'heading' | 'section' }> {
  return block.type === 'heading' || block.type === 'section'
}

export function flowAnchorTitle(block: FlowBlock): string {
  if (block.type === 'heading') return block.text.trim() || FLOW_BLANK_HEADING_FALLBACK
  if (block.type === 'section') return block.title.trim() || FLOW_BLANK_SECTION_FALLBACK
  return ''
}

export function flowTableCellText(cell: FlowTableCell | undefined): string {
  if (cell === undefined) return ''
  return typeof cell === 'string' ? cell : cell.text
}

export function flowRichTextSegments(text: string, runs?: readonly TextRun[]): FlowRichTextSegment[] {
  if (!text) return []
  if (!runs?.length) return [{ text, style: {} }]
  const characters = Array.from(text)
  const styles = characters.map((): TextRunStyle => ({}))
  for (const run of runs) {
    const start = Math.max(0, Math.min(characters.length, run.start))
    const end = Math.max(start, Math.min(characters.length, run.end))
    for (let index = start; index < end; index += 1) {
      Object.assign(styles[index]!, run.style)
    }
  }
  const segments: FlowRichTextSegment[] = []
  let cursor = 0
  while (cursor < characters.length) {
    const style = { ...styles[cursor]! }
    let end = cursor + 1
    while (end < characters.length && sameRunStyle(style, styles[end]!)) end += 1
    segments.push({ text: characters.slice(cursor, end).join(''), style })
    cursor = end
  }
  return segments
}

export function publishedFlowSurfaces(
  source: FlowPublishedPlaybackSource,
): PublishedFlowSurface[] {
  return source.surfaces.filter(isPublishedFlowSurface)
}

export function toFlowPublishedPlayback(
  source: FlowPublishedPlaybackSource,
): FlowPublishedPlaybackDocument {
  const surfaces = publishedFlowSurfaces(source)
  if (surfaces.length === 0) {
    throw new Error('课件没有 Flow 页面')
  }
  return {
    courseId: source.courseId,
    title: source.title,
    assets: cloneJson(source.assets ?? {}),
    ...(source.media ? { media: cloneJson(source.media) } : {}),
    ...(source.playback ? { playback: cloneJson(source.playback) } : {}),
    locations: cloneJson([...source.locations]),
    startLocationId: source.startLocationId,
    globalLayerItems: cloneJson([...source.globalLayerItems]),
    surfaces: cloneJson(surfaces),
  }
}

export function flowPlaybackFromSurface(
  surface: PublishedFlowSurface,
  options: {
    courseId?: string
    title?: string
    assets?: Record<string, PublishedCourseAsset>
    globalLayerItems?: readonly PublishedGlobalLayerEntry[]
    startBlockId?: string
  } = {},
): FlowPublishedPlaybackDocument {
  const heading = firstFlowHeadingId(surface.blocks) ?? surface.blocks[0]?.id ?? surface.id
  const startBlockId = options.startBlockId ?? heading
  return {
    courseId: options.courseId ?? surface.id,
    title: options.title ?? surface.title,
    assets: cloneJson(options.assets ?? {}),
    locations: [{
      id: startBlockId,
      label: surface.title,
      kind: 'flow-block',
      surfaceId: surface.id,
      blockId: startBlockId,
    }],
    startLocationId: startBlockId,
    globalLayerItems: cloneJson([...(options.globalLayerItems ?? [])]),
    surfaces: [cloneJson(surface)],
  }
}

export function findPublishedFlowSurface(
  playback: FlowPublishedPlaybackDocument,
  surfaceId: string,
): PublishedFlowSurface {
  const surface = playback.surfaces.find((candidate) => candidate.id === surfaceId)
  if (!surface) throw new Error(`找不到 Flow 表面：${surfaceId}`)
  return surface
}

export function flowSurfaceOrder(playback: FlowPublishedPlaybackDocument): string[] {
  const ordered: string[] = []
  const seen = new Set<string>()
  for (const location of playback.locations) {
    if (location.kind !== 'flow-block' || seen.has(location.surfaceId)) continue
    if (!playback.surfaces.some((surface) => surface.id === location.surfaceId)) continue
    seen.add(location.surfaceId)
    ordered.push(location.surfaceId)
  }
  for (const surface of playback.surfaces) {
    if (seen.has(surface.id)) continue
    seen.add(surface.id)
    ordered.push(surface.id)
  }
  return ordered
}

export function flowPageStartLocationId(
  playback: FlowPublishedPlaybackDocument,
  surfaceId: string,
): string {
  const match = playback.locations.find(
    (location) => location.kind === 'flow-block' && location.surfaceId === surfaceId,
  )
  if (match) return match.id
  const surface = findPublishedFlowSurface(playback, surfaceId)
  const headingId = firstFlowHeadingId(surface.blocks)
  return headingId ?? surface.id
}

export function resolveFlowLocation(
  playback: FlowPublishedPlaybackDocument,
  locationId: string,
): Extract<CourseLocation, { kind: 'flow-block' }> {
  const location = playback.locations.find((candidate) => candidate.id === locationId)
  if (location?.kind === 'flow-block') return location
  const surface = playback.surfaces.find((candidate) => candidate.id === locationId)
  if (surface) {
    return {
      id: locationId,
      label: surface.title,
      kind: 'flow-block',
      surfaceId: surface.id,
      blockId: firstFlowHeadingId(surface.blocks) ?? surface.id,
    }
  }
  throw new Error(`找不到 Flow 位置：${locationId}`)
}

export function resolvePlaybackAssetUrl(
  playback: FlowPublishedPlaybackDocument,
  assetId: string,
  resolveAsset?: (assetId: string) => string | undefined,
): string | undefined {
  return resolveAsset?.(assetId) ?? playback.assets[assetId]?.url
}

function firstFlowHeadingId(blocks: readonly FlowBlock[]): string | undefined {
  let headingId: string | undefined
  walkFlowBlocks(blocks, ({ block }) => {
    if (!headingId && block.type === 'heading') headingId = block.id
  })
  return headingId
}

function sameRunStyle(left: TextRunStyle, right: TextRunStyle): boolean {
  return left.bold === right.bold
    && left.italic === right.italic
    && left.underline === right.underline
    && left.strike === right.strike
    && left.emphasis === right.emphasis
    && left.color === right.color
    && left.highlightColor === right.highlightColor
}
