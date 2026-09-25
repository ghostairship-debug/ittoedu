import { z } from 'zod'

/** Logical size of a finite Slide canvas. One size applies to the whole course (Owner 2026-09-25). */
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

/** The course's Slide canvas: the first Slide surface's size, or the legacy default when there is none. */
export function courseSlideCanvas(course: { readonly surfaces: readonly { readonly type: string; readonly canvas?: Readonly<SlideCanvasSize> }[] }): SlideCanvasSize {
  const surface = course.surfaces.find(value => value.type === 'slide' && value.canvas)
  return surface?.canvas ? { width: surface.canvas.width, height: surface.canvas.height } : { ...DEFAULT_SLIDE_CANVAS }
}

/** Index of every Slide surface whose size differs from the first one; a course keeps one Slide size. */
export function mismatchedSlideCanvasIndexes(surfaces: readonly { readonly type: string; readonly canvas?: Readonly<SlideCanvasSize> }[]): number[] {
  const first = surfaces.find(value => value.type === 'slide' && value.canvas)?.canvas
  if (!first) return []
  return surfaces.flatMap((surface, index) => surface.type === 'slide' && surface.canvas && !sameSlideCanvas(surface.canvas, first) ? [index] : [])
}
