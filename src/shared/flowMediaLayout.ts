export type FlowMediaLayoutValue = 'content-width' | 'wide' | 'full-width'

export interface FlowMediaLayoutWidths {
  readonly readingWidth: number
  readonly wideContentWidth: number
}

export type FlowMediaLayoutTier = 'reading' | 'wide' | 'container'

export interface FlowMediaLayoutProjection {
  readonly layout: FlowMediaLayoutValue
  readonly tier: FlowMediaLayoutTier
  readonly className: string
  /** CSS inline-size evaluated against the nearest inline-size query container. */
  readonly inlineSize: string
  /** Matching physical/logical cap so neither axis declaration can override the tier. */
  readonly maxInlineSize: string
  /** Player applies this to the media figure; Editor applies it to the block frame. */
  readonly wrappedOuterInlineSize: '48%'
  /** Editor media figures already live inside the wrapped block frame. */
  readonly wrappedInnerInlineSize: '100%'
}

export const FLOW_MEDIA_QUERY_CONTAINER_TYPE = 'inline-size'
export const FLOW_MEDIA_INLINE_SIZE_CUSTOM_PROPERTY = '--flow-media-inline-size'
export const FLOW_MEDIA_INLINE_SIZE_REFERENCE = `var(${FLOW_MEDIA_INLINE_SIZE_CUSTOM_PROPERTY})`
export const FLOW_MEDIA_CONTENT_SIDE_GUTTER_PX = 64
export const FLOW_MEDIA_CONTAINER_SIDE_GUTTER_PX = 32
export const FLOW_MEDIA_WIDE_SIDE_GUTTER_PX = 48

const FLOW_MEDIA_LAYOUT_CLASS: Readonly<Record<FlowMediaLayoutValue, string>> = {
  'content-width': 'flow-media-layout--content',
  wide: 'flow-media-layout--wide',
  'full-width': 'flow-media-layout--full',
}

const FLOW_MEDIA_LAYOUT_TIER: Readonly<Record<FlowMediaLayoutValue, FlowMediaLayoutTier>> = {
  'content-width': 'reading',
  wide: 'wide',
  'full-width': 'container',
}

function safeWidth(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

function px(value: number): string {
  return `${safeWidth(value)}px`
}

function containerInlineSize(sideGutter: number): string {
  return `max(0px, calc(100cqi - ${sideGutter * 2}px))`
}

/**
 * One pure mapping shared by Editor and Player. Unwrapped media can break out
 * from the reading lane while remaining bounded by its query container.
 * Wrapped media deliberately bypasses breakout and keeps the existing 48% lane.
 */
export function resolveFlowMediaLayoutProjection(
  layout: FlowMediaLayoutValue,
  widths: FlowMediaLayoutWidths,
): FlowMediaLayoutProjection {
  const readingWidth = safeWidth(widths.readingWidth)
  const wideContentWidth = Math.max(readingWidth, safeWidth(widths.wideContentWidth))
  const content = `min(${px(readingWidth)}, ${containerInlineSize(FLOW_MEDIA_CONTENT_SIDE_GUTTER_PX)})`
  const wide = `min(${px(wideContentWidth)}, ${containerInlineSize(FLOW_MEDIA_WIDE_SIDE_GUTTER_PX)})`
  const full = containerInlineSize(FLOW_MEDIA_CONTAINER_SIDE_GUTTER_PX)
  const inlineSize = layout === 'content-width'
    ? content
    : layout === 'wide'
      ? wide
      : full

  return {
    layout,
    tier: FLOW_MEDIA_LAYOUT_TIER[layout],
    className: FLOW_MEDIA_LAYOUT_CLASS[layout],
    inlineSize,
    maxInlineSize: inlineSize,
    wrappedOuterInlineSize: '48%',
    wrappedInnerInlineSize: '100%',
  }
}

/** Numeric counterpart used by static parity checks and the Wave C rect gate. */
export function resolveFlowMediaLayoutInlineSize(
  layout: FlowMediaLayoutValue,
  widths: FlowMediaLayoutWidths,
  containerWidth: number,
): number {
  const readingWidth = safeWidth(widths.readingWidth)
  const wideContentWidth = Math.max(readingWidth, safeWidth(widths.wideContentWidth))
  const container = safeWidth(containerWidth)
  const full = Math.max(0, container - FLOW_MEDIA_CONTAINER_SIDE_GUTTER_PX * 2)
  const content = Math.min(
    readingWidth,
    Math.max(0, container - FLOW_MEDIA_CONTENT_SIDE_GUTTER_PX * 2),
  )
  const wide = Math.min(
    wideContentWidth,
    Math.max(0, container - FLOW_MEDIA_WIDE_SIDE_GUTTER_PX * 2),
  )
  if (layout === 'content-width') return content
  if (layout === 'wide') return wide
  return full
}
