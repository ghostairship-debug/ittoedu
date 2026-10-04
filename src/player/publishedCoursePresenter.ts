import type { PublishedCourseV2Payload } from '../shared/publishedCourseTypes'
import { PlayerPresenterInput } from './PlayerPresenterInput'
import type { PublishedCourseSession } from './surfaces/publishedDynamicHosts'

function readPublishedIndex(session: PublishedCourseSession): number {
  try {
    return session.getProgress().index
  } catch {
    return 0
  }
}

/**
 * Course keys of one mounted interactive Published session. The exported
 * player, the editor's whole-course preview and its try-runs all attach here,
 * so ←/→, Shift+←/→, Home/End and the presenter keys behave the same in each.
 */
export function attachPublishedCourseKeys(
  root: HTMLElement,
  session: PublishedCourseSession,
  playback: Pick<PublishedCourseV2Payload['playback'], 'keyboardNavigation' | 'presenter'>,
): PlayerPresenterInput {
  return new PlayerPresenterInput({
    root,
    keyboardNavigation: playback.keyboardNavigation,
    presenter: playback.presenter,
    navigate: command => command.kind === 'edge'
      ? session.requestPlaybackEdge(command.edge)
      : session.requestPlaybackNavigation(command.kind, command.direction),
    onAuthoredCommand: command => session.dispatchPresenterCommand(command),
    onFeedback: feedback => session.reportPresenterFeedback(feedback.message),
  })
}

/**
 * Delivery presenter for a Published Course V2 session: keyboard navigation
 * and a location-index bridge. This is not PlayerApp and does not wrap a
 * V8 Project/Scene payload.
 */
export interface PublishedCoursePresenter {
  readonly session: PublishedCourseSession
  getCurrentSceneIndex(): number
  goToScene(index: number): boolean
  replayScene(): boolean
  waitForCaptureReady(): Promise<void>
  destroy(): void
}

export function attachPublishedCoursePresenter(
  root: HTMLElement,
  session: PublishedCourseSession,
  payload: PublishedCourseV2Payload,
): PublishedCoursePresenter {
  const totalScenes = Math.max(1, session.listCatalog().length)

  const readIndex = () => readPublishedIndex(session)
  const presenterInput = attachPublishedCourseKeys(root, session, payload.playback)
  let destroyed = false
  let replayPending = false

  const goToIndex = (index: number): boolean => {
    if (index < 0 || index >= totalScenes) return false
    void session.goToIndex(index).catch((error) => {
      console.error('课程翻页失败', error)
    })
    return true
  }

  const replayScene = (): boolean => {
    if (destroyed || replayPending || !session.canReplayScene()) return false
    replayPending = true
    void session.replayScene().catch((error) => {
      console.error('课程重播失败', error)
    }).finally(() => {
      replayPending = false
    })
    return true
  }

  const publishedPresenter: PublishedCoursePresenter = {
    session,
    getCurrentSceneIndex: readIndex,
    goToScene: (index: number) => goToIndex(index),
    replayScene,
    waitForCaptureReady: async () => {
      const deadline = Date.now() + 8_000
      while (Date.now() < deadline) {
        if (root.querySelector('[data-native-type="text"]')) return
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, 50)
        })
      }
    },
    destroy: () => {
      if (destroyed) return
      destroyed = true
      presenterInput.destroy()
      if (window.__H5_LESSON_PLAYER__ === publishedPresenter) {
        delete window.__H5_LESSON_PLAYER__
      }
      void session.destroy()
    },
  }
  window.__H5_LESSON_PLAYER__ = publishedPresenter
  return publishedPresenter
}
