import { PlayerPresenterInput, type PlaybackKeyCommand, type PresenterInputFeedback, type PresenterInputResult } from '../../PlayerPresenterInput'
import type { ProjectPresenterSettings, PresenterCommand } from '../../../shared/contracts/playback-v1'
import type { NavigationTasks } from './NavigationTasks'

/** Reuses the existing single handler, including input/IME/frame priority and pen deduplication. */
export function attachComponentPlatformNavigationKeys<Target>(options: {
  root: HTMLElement
  navigation: NavigationTasks<PlaybackKeyCommand, Target>
  keyboardNavigation: boolean
  presenter: Readonly<ProjectPresenterSettings>
  onAuthoredCommand(command: PresenterCommand): boolean | PresenterInputResult
  onFeedback?(feedback: PresenterInputFeedback): void
  onError?(error: unknown): void
}): PlayerPresenterInput {
  return new PlayerPresenterInput({
    ...options,
    navigate: request => {
      const task = options.navigation.request(request)
      if (!task) return false
      void task.finished.then(result => {
        if (result.status === 'failed') options.onError?.(result.error)
      })
      return true
    },
  })
}
