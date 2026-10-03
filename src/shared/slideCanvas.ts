import { z } from 'zod'

/** Logical size of a finite Slide canvas. Scenes may override the course default. */
export interface SlideCanvasSize {
  width: number
  height: number
}

/** Legacy default and the size of every project created before M19. */
export const DEFAULT_SLIDE_CANVAS: Readonly<SlideCanvasSize> = Object.freeze({ width: 1280, height: 720 })
export const SLIDE_CANVAS_MIN = 320
export const SLIDE_CANVAS_MAX = 8192

export const SLIDE_CANVAS_PRESETS: readonly Readonly<SlideCanvasSize & { id: string; label: string }>[] = Object.freeze([
  { id: 'wide', label: '宽屏 16:9', width: 1280, height: 720 },
  { id: 'standard', label: '标准 4:3', width: 1024, height: 768 },
  { id: 'portrait', label: '竖屏 9:16', width: 720, height: 1280 },
  { id: 'long', label: '长页', width: 720, height: 2560 },
])

const dimension = z.number().int().min(SLIDE_CANVAS_MIN).max(SLIDE_CANVAS_MAX)
export const slideCanvasSchema = z.object({ width: dimension, height: dimension }).strict()

export function isValidSlideCanvas(value: unknown): value is SlideCanvasSize {
  return slideCanvasSchema.safeParse(value).success
}

export function sameSlideCanvas(a: Readonly<SlideCanvasSize>, b: Readonly<SlideCanvasSize>): boolean {
  return a.width === b.width && a.height === b.height
}

/** The authored scene size, falling back to the course's shared Slide reference size. */
export function effectiveSceneCanvas(
  surface: { readonly canvas: Readonly<SlideCanvasSize> },
  scene?: { readonly canvas?: Readonly<SlideCanvasSize> } | null,
): SlideCanvasSize {
  const canvas = scene?.canvas ?? surface.canvas
  return { width: canvas.width, height: canvas.height }
}

export interface SharedSlideFrameMapping {
  readonly scale: number
  readonly offsetX: number
  readonly offsetY: number
}

/** Shared layers keep one reference frame and are fitted, centered, to the current scene. */
export function sharedSlideFrameMapping(
  reference: Readonly<SlideCanvasSize>,
  target: Readonly<SlideCanvasSize>,
): SharedSlideFrameMapping {
  const scale = Math.min(target.width / reference.width, target.height / reference.height)
  return {
    scale,
    offsetX: (target.width - reference.width * scale) / 2,
    offsetY: (target.height - reference.height * scale) / 2,
  }
}

type SlideFrameGeometry = Partial<{ x: number; y: number; width: number; height: number }>

/** Derives displayed geometry without adding omitted fields or changing the source frame. */
export function mapSlideFrame<T extends SlideFrameGeometry>(frame: T, mapping: SharedSlideFrameMapping): T {
  return {
    ...frame,
    ...(frame.x === undefined ? {} : { x: frame.x * mapping.scale + mapping.offsetX }),
    ...(frame.y === undefined ? {} : { y: frame.y * mapping.scale + mapping.offsetY }),
    ...(frame.width === undefined ? {} : { width: frame.width * mapping.scale }),
    ...(frame.height === undefined ? {} : { height: frame.height * mapping.scale }),
  }
}

/** Converts a displayed geometry edit back into the shared owner's one authored frame. */
export function unmapSlideFrame<T extends SlideFrameGeometry>(frame: T, mapping: SharedSlideFrameMapping): T {
  return {
    ...frame,
    ...(frame.x === undefined ? {} : { x: (frame.x - mapping.offsetX) / mapping.scale }),
    ...(frame.y === undefined ? {} : { y: (frame.y - mapping.offsetY) / mapping.scale }),
    ...(frame.width === undefined ? {} : { width: frame.width / mapping.scale }),
    ...(frame.height === undefined ? {} : { height: frame.height / mapping.scale }),
  }
}

/** The course's default Slide reference size, independent of per-scene overrides. */
export function courseSlideCanvas(course: { readonly surfaces: readonly { readonly type: string; readonly canvas?: Readonly<SlideCanvasSize> }[] }): SlideCanvasSize {
  const surface = course.surfaces.find(value => value.type === 'slide' && value.canvas)
  return surface?.canvas ? { width: surface.canvas.width, height: surface.canvas.height } : { ...DEFAULT_SLIDE_CANVAS }
}

/** The shared reference size is course-wide; scene overrides are independently authored. */
export function mismatchedSlideCanvasIndexes(surfaces: readonly { readonly type: string; readonly canvas?: Readonly<SlideCanvasSize> }[]): number[] {
  const first = surfaces.find(value => value.type === 'slide' && value.canvas)?.canvas
  if (!first) return []
  return surfaces.flatMap((surface, index) => surface.type === 'slide' && surface.canvas && !sameSlideCanvas(surface.canvas, first) ? [index] : [])
}
