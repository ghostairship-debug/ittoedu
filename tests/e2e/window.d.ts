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
    }
    __e2eRunFrameSentinel?: string
    __e2eSceneAuthoringProbe?: SceneAuthoringProbe
    __renderHostActiveRafCount?: () => number
  }
}

export {}
