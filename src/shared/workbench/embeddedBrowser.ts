/** Bounds are relative to the application's content area, in CSS pixels at renderer zoom 1. */
export interface EmbeddedBrowserBounds { x: number; y: number; width: number; height: number }

export interface EmbeddedBrowserViewport {
  visible: boolean
  bounds?: EmbeddedBrowserBounds
}

export interface EmbeddedBrowserViewportRequest extends EmbeddedBrowserViewport {
  workspaceId: string
  conversationId: string
  runId: string
}

export interface EmbeddedBrowserViewportState {
  embedded: boolean
  visible: boolean
  pageUrl?: string
}
