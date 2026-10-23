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
}
