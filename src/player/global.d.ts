import type { ComponentDefinitionV4 } from '../shared/componentTypes'
import type { PublishedCourseV2Payload } from '../shared/publishedCourseTypes'

declare global {
  interface Window {
    __H5_COURSE_PAYLOAD__?: PublishedCourseV2Payload
    /** Legacy Player entry only. Product bootstrap fail-louds; it does not mount PlayerApp. */
    __H5_LESSON_PAYLOAD__?: unknown
    __H5_LESSON_PAYLOAD_URL__?: string
    __H5_LESSON_PAYLOAD_FALLBACK__?: unknown
    __H5_LESSON_PLAYER__?: {
      getCurrentSceneIndex(): number
      goToScene(index: number): boolean
      replayScene(): boolean
      waitForCaptureReady(): Promise<void>
      destroy(): void
      readonly session?: { destroy(): Promise<void> }
    }
    CoursewareComponent?: {
      define(definition: ComponentDefinitionV4): void
    }
  }
}

export {}
