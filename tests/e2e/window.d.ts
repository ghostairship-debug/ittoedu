import type { PublishedCourseV2Payload } from '../../src/shared/publishedCourseTypes'

interface SceneAuthoringProbe {
  mode: string
  authoring: boolean
  replayAccepted?: boolean
  stateAfterWrite?: unknown
}

declare global {
  interface Window {
    __H5_LESSON_PLAYER__?: {
      getCurrentSceneIndex(): number
      goToScene(index: number): boolean
      replayScene(): boolean
      waitForCaptureReady(): Promise<void>
      destroy(): void
      readonly session?: { destroy(): Promise<void> }
      /** Read-only E2E introspection of the published course on this page. */
      readonly payload?: PublishedCourseV2Payload & {
        readonly project?: { readonly scenes?: readonly unknown[] }
      }
      /** Read-only E2E introspection; production interaction never uses this shape. */
      readonly playerScene?: {
        readonly renderedNodes: readonly { type: string }[]
      }
    }
    __e2eRunFrameSentinel?: string
    __e2eSceneAuthoringProbe?: SceneAuthoringProbe
    __renderHostActiveRafCount?: () => number
  }
}

export {}
