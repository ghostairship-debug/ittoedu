/** Floating observation chrome never changes the document's layout viewport. */
export const PLAYBACK_VIEW_CHROME_GUTTER = 18
/** Ignore subpixel measurement noise, not meaningful overflow. */
export const PLAYBACK_VIEW_OVERFLOW_EPSILON = 0.5
export const PLAYBACK_VIEW_MAX_ZOOM = 4
export interface PlaybackChromeInsets { right: number; bottom: number }
export interface PlaybackChromeGeometry {
  x: boolean
  y: boolean
  native: PlaybackChromeInsets
  insets: PlaybackChromeInsets
  /** Controller width budget stays stable while observation chrome changes. */
  controllerInsets: PlaybackChromeInsets
}
export function playbackControllerInsets(native: PlaybackChromeInsets): PlaybackChromeInsets {
  return { right: native.right * PLAYBACK_VIEW_MAX_ZOOM + PLAYBACK_VIEW_CHROME_GUTTER,
    bottom: native.bottom * PLAYBACK_VIEW_MAX_ZOOM + PLAYBACK_VIEW_CHROME_GUTTER }
}
