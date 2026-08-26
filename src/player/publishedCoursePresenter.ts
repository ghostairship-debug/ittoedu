import type { PublishedCourseV2Payload } from '../shared/publishedCourseTypes'
import { PlayerApp } from './PlayerApp'
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
 * Delivery Presenter for Published Course V2: expose the existing Player
 * scene-index bridge and keyboard navigation
 * without switching the package back to Project V8 `__H5_LESSON_PAYLOAD__`.
 */
export function attachPublishedCoursePresenter(
  root: HTMLElement,
  session: PublishedCourseSession,
  payload: PublishedCourseV2Payload,
): void {
  const totalScenes = Math.max(1, session.listCatalog().length)
  const presenter = payload.playback.presenter

  const readIndex = () => readPublishedIndex(session)
  let presenterInput: PlayerPresenterInput | null = null
  let destroyed = false
  let replayPending = false

  const goToIndex = (index: number): boolean => {
    if (index < 0 || index >= totalScenes) return false
    void session.goToIndex(index).then(() => {
      presenterInput?.setIndex(index)
    }).catch((error) => {
      console.error('课程翻页失败', error)
    })
    return true
  }

  const replayScene = (): boolean => {
    if (destroyed || replayPending || !session.canReplayScene()) return false
    replayPending = true
    void session.replayScene().then((replayed) => {
      if (!replayed || destroyed) return
      presenterInput?.setIndex(readIndex())
    }).catch((error) => {
      console.error('课程重播失败', error)
    }).finally(() => {
      replayPending = false
    })
    return true
  }

  if (payload.playback.keyboardNavigation || presenter.enabled) {
    presenterInput = new PlayerPresenterInput({
      totalPages: totalScenes,
      keyboardNavigation: payload.playback.keyboardNavigation,
      presenter,
      onNavigate: (targetIndex) => goToIndex(targetIndex),
      onAuthoredCommand: (command) => {
        const currentIndex = readIndex()
        const targetIndex = command === 'previous' ? currentIndex - 1 : currentIndex + 1
        return goToIndex(targetIndex)
      },
    })
    presenterInput.setIndex(readIndex())
  }

  const scenes = payload.locations.map((location) => ({
    id: location.id,
    name: location.label,
  }))
  const bridge = {
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
    payload: {
      project: { scenes },
    },
    get playerScene() {
      const renderedNodes = [...root.querySelectorAll<HTMLElement>('[data-native-type]')].map(
        (element) => ({ type: element.dataset.nativeType }),
      )
      return { renderedNodes }
    },
    destroy: () => {
      if (destroyed) return
      destroyed = true
      presenterInput?.destroy()
      void session.destroy()
    },
  }
  window.__H5_LESSON_PLAYER__ = bridge as unknown as PlayerApp
}
