import { courseProjectDocumentSchema } from '../../shared/courseProjectSchema'
import type {
  CourseProjectDocument,
  GlobalLayerEntry,
  LayerFrame,
  LayerItem,
  LayerItemOverride,
  NativeElementContent,
  SlideSceneDocument,
  SlideSurfaceDocument,
} from '../../shared/courseProjectTypes'
import {
  courseSlideCanvas,
  isValidSlideCanvas,
  sameSlideCanvas,
  type SlideCanvasSize,
} from '../../shared/slideCanvas'

/**
 * Uniformly refits every Slide surface onto `next`.
 * `s` is the largest scale that fits the old canvas inside the new one;
 * leftover space is centered. Flow pages and Spatial worlds are left untouched.
 * Line endpoints stay in their 0–1 frame space: scaling the frame already
 * moves their canvas positions. Multiplying those fractions would distort the
 * stroke and can leave the unit interval required by the native schema.
 */
export function resizeCourseSlideCanvas(
  project: CourseProjectDocument,
  next: SlideCanvasSize,
): CourseProjectDocument {
  if (!isValidSlideCanvas(next)) throw new RangeError('画布尺寸无效')
  const slides = project.surfaces.filter((surface): surface is SlideSurfaceDocument => surface.type === 'slide')
  const old = courseSlideCanvas(project)
  if (slides.length === 0 || sameSlideCanvas(old, next)) return project
  const s = Math.min(next.width / old.width, next.height / old.height)
  const dx = (next.width - old.width * s) / 2
  const dy = (next.height - old.height * s) / 2
  const draft = structuredClone(project)
  const slideLocationIds = draft.locations
    .filter((location) => location.kind === 'slide-scene')
    .map((location) => location.id)
  for (const entry of draft.globalLayerItems) {
    if (displaysOnSlide(entry, slideLocationIds)) scaleLayerItem(entry.item, s, dx, dy)
  }
  for (const surface of draft.surfaces) {
    if (surface.type !== 'slide') continue
    surface.canvas = { width: next.width, height: next.height }
    for (const entry of surface.surfaceLayerItems) scaleLayerItem(entry.item, s, dx, dy)
    for (const scene of surface.scenes) scaleScene(scene, s, dx, dy)
  }
  return courseProjectDocumentSchema.parse(draft)
}

function displaysOnSlide(entry: GlobalLayerEntry, slideLocationIds: readonly string[]): boolean {
  if (slideLocationIds.length === 0) return false
  const { mode, locationIds } = entry.visibility
  if (mode === 'all') return true
  if (mode === 'include') return locationIds.some((id) => slideLocationIds.includes(id))
  return slideLocationIds.some((id) => !locationIds.includes(id))
}

function scaleScene(scene: SlideSceneDocument, s: number, dx: number, dy: number): void {
  for (const item of scene.layerItems) scaleLayerItem(item, s, dx, dy)
  for (const state of scene.presentation?.states ?? []) {
    for (const [itemId, override] of Object.entries(state.layerItemOverrides)) {
      state.layerItemOverrides[itemId] = scaleOverride(override, scene.layerItems.find((item) => item.layerItemId === itemId), s, dx, dy)
    }
  }
}

function scaleLayerItem(item: LayerItem, s: number, dx: number, dy: number): void {
  item.frame = scaleFrame(item.frame, s, dx, dy)
  if (item.kind === 'native') scaleNativeContent(item.content, s)
}

function scaleFrame(frame: LayerFrame, s: number, dx: number, dy: number): LayerFrame {
  return {
    ...frame,
    x: frame.x * s + dx,
    y: frame.y * s + dy,
    width: frame.width * s,
    height: frame.height * s,
  }
}

function scaleOverride(
  override: LayerItemOverride,
  item: LayerItem | undefined,
  s: number,
  dx: number,
  dy: number,
): LayerItemOverride {
  const next: LayerItemOverride = { ...override }
  if (override.frame) next.frame = scalePartialFrame(override.frame, s, dx, dy)
  if (override.nativeData && item?.kind === 'native') {
    next.nativeData = scaleNativeRecord(override.nativeData, item.content.nativeType, s)
  }
  return next
}

function scalePartialFrame(
  frame: NonNullable<LayerItemOverride['frame']>,
  s: number,
  dx: number,
  dy: number,
): NonNullable<LayerItemOverride['frame']> {
  return {
    ...frame,
    ...(typeof frame.x === 'number' ? { x: frame.x * s + dx } : {}),
    ...(typeof frame.y === 'number' ? { y: frame.y * s + dy } : {}),
    ...(typeof frame.width === 'number' ? { width: frame.width * s } : {}),
    ...(typeof frame.height === 'number' ? { height: frame.height * s } : {}),
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function scaleNativeContent(content: NativeElementContent, s: number): void {
  const data = content.data as unknown as Record<string, unknown>
  scaleNativeFields(data, content.nativeType, s)
}

function scaleNativeRecord(
  data: Record<string, unknown>,
  nativeType: NativeElementContent['nativeType'],
  s: number,
): Record<string, unknown> {
  const next = structuredClone(data)
  scaleNativeFields(next, nativeType, s)
  return next
}

function scaleNativeFields(
  data: Record<string, unknown>,
  nativeType: NativeElementContent['nativeType'],
  s: number,
): void {
  const style = isRecord(data.style) ? data.style : undefined
  if (nativeType === 'text') {
    scaleNumber(style, 'fontSize', s, 8, 400)
    scaleNumber(style, 'letterSpacing', s, -20, 100)
    scaleNumber(style, 'padding', s, 0, 200)
    scaleNumber(style, 'lineSpacing', s, 0, 200)
    scaleNumber(style, 'cornerRadius', s, 0, 500)
    if (Array.isArray(data.runs)) {
      for (const run of data.runs) {
        if (isRecord(run) && isRecord(run.style)) scaleNumber(run.style, 'fontSize', s, 8, 400)
      }
    }
  } else if (nativeType === 'formula') {
    scaleNumber(style, 'fontSize', s, 12, 200)
  } else if (nativeType === 'shape') {
    scaleNumber(style, 'borderWidth', s, 0, 100)
    scaleNumber(style, 'cornerRadius', s, 0, 500)
  } else if (nativeType === 'table') {
    scaleNumber(style, 'fontSize', s, 6, 144)
    scaleNumber(style, 'borderWidth', s, 0, 32)
    scaleNumber(style, 'cellPadding', s, 0, 64)
    if (Array.isArray(data.rows)) {
      for (const row of data.rows) {
        if (!isRecord(row) || !Array.isArray(row.cells)) continue
        for (const cell of row.cells) {
          if (isRecord(cell) && isRecord(cell.style)) scaleNumber(cell.style, 'fontSize', s, 6, 144)
        }
      }
    }
  } else if (nativeType === 'chart') {
    scaleNumber(style, 'fontSize', s, 6, 144)
  } else if (nativeType === 'input') {
    scaleNumber(style, 'fontSize', s, 6, 144)
    scaleNumber(style, 'borderWidth', s, 0, 32)
    scaleNumber(style, 'padding', s, 0, 64)
    scaleNumber(style, 'cornerRadius', s, 0, 200)
  }
}

function scaleNumber(
  record: Record<string, unknown> | undefined,
  key: string,
  s: number,
  min: number,
  max: number,
): void {
  if (!record || typeof record[key] !== 'number') return
  record[key] = clamp(record[key] * s, min, max)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
