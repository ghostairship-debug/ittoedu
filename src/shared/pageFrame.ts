import type { SlideCanvasSize } from './slideCanvas'

/**
 * One page frame for editing, try-run, the whole-course preview and exported HTML (M19): around the page is the
 * workspace colour in a window and black in fullscreen, content outside the page is clipped, and the page carries
 * the same edge and shadow everywhere.
 */
export const PAGE_FRAME_BACKDROP = '#ece9e1'
export const PAGE_FRAME_FULLSCREEN_BACKDROP = '#000000'
export const PAGE_FRAME_SHADOW = '0 18px 42px rgba(0, 0, 0, 0.34)'
export const PAGE_FRAME_OUTLINE = '1px solid rgba(23, 34, 29, 0.066)'
export const PAGE_FRAME_RADIUS = 4

/**
 * Edge, corner and shadow for a page element drawn at `scale` (its CSS transform), in its own units, so the
 * screen shows the same frame as the editor's page at any fit.
 */
export function pageFrameStyle(scale: number, windowed: boolean): { boxShadow: string; outline: string; borderRadius: string } {
  const px = (value: number) => `${Math.round(value / Math.max(scale, 0.01) * 1000) / 1000}px`
  return {
    boxShadow: windowed ? `0 ${px(18)} ${px(42)} rgba(0, 0, 0, 0.34)` : 'none',
    outline: windowed ? `${px(1)} solid rgba(23, 34, 29, 0.066)` : 'none',
    borderRadius: px(PAGE_FRAME_RADIUS),
  }
}

export interface PageFrameInsets {
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly left: number
}
export const NO_PAGE_INSETS: PageFrameInsets = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 })
/** Space the editor leaves around its page; a try-run in its place keeps the page where it was. */
export const EDITOR_PAGE_INSETS: PageFrameInsets = Object.freeze({ top: 42, right: 22, bottom: 22, left: 22 })
/** Space around the page of the whole-course preview and exported HTML in a window. */
export const WINDOW_PAGE_INSETS: PageFrameInsets = Object.freeze({ top: 16, right: 16, bottom: 16, left: 16 })

/** `"42 22 22 22"`, `"16"` or `"16 24"`, as in CSS margins. Anything else means no insets. */
export function parsePageInsets(value: string | undefined | null): PageFrameInsets {
  const parts = (value ?? '').trim().split(/\s+/).filter(Boolean).map(Number)
  if (!parts.length || parts.length > 4 || !parts.every(part => Number.isFinite(part) && part >= 0)) return NO_PAGE_INSETS
  const [top, right = top, bottom = top, left = right] = parts as [number, number?, number?, number?]
  return { top, right, bottom, left }
}

export function formatPageInsets(insets: PageFrameInsets): string {
  return `${insets.top} ${insets.right} ${insets.bottom} ${insets.left}`
}

/** Portrait pages (竖屏、长页) fill the available width and scroll down; landscape pages are shown whole. */
export function pageFillsWidth(canvas: Readonly<SlideCanvasSize>): boolean {
  return canvas.height > canvas.width
}

export interface PageFit {
  /** CSS pixels per canvas unit. */
  readonly scale: number
  /** Page origin inside the viewport, in CSS pixels. */
  readonly left: number
  readonly top: number
}

/**
 * Where a page sits in a viewport at 100%: the same rule for the editor and every playback view. `contain` always
 * shows the whole frame (a Spatial camera frame).
 */
export function fitPage(
  viewport: { readonly width: number; readonly height: number },
  canvas: Readonly<SlideCanvasSize>,
  insets: PageFrameInsets = NO_PAGE_INSETS,
  mode: 'page' | 'contain' = 'page',
): PageFit {
  const width = Math.max(1, viewport.width - insets.left - insets.right)
  const height = Math.max(1, viewport.height - insets.top - insets.bottom)
  if (mode === 'page' && pageFillsWidth(canvas)) {
    const scale = width / canvas.width
    const pageHeight = canvas.height * scale
    // A portrait page that still fits (a wide window) stays centred instead of hugging the top.
    return { scale, left: insets.left, top: insets.top + Math.max(0, (height - pageHeight) / 2) }
  }
  const scale = Math.min(width / canvas.width, height / canvas.height)
  return { scale, left: insets.left + (width - canvas.width * scale) / 2, top: insets.top + (height - canvas.height * scale) / 2 }
}
