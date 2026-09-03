export type PresenterCommand = 'next' | 'previous'

export interface PresenterKeyBinding {
  id: string
  command: PresenterCommand
  /** KeyboardEvent.key is the portable matching authority; `code` is diagnostic only. */
  key: string
  altKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  metaKey: boolean
}

export interface ProjectPresenterSettings {
  enabled: boolean
  strategy: 'scene-navigation' | 'authored-command'
  additionalBindings: PresenterKeyBinding[]
}

export interface ProjectPlaybackSettings {
  /** `canvas` uses authorable controller nodes; V8 removed the legacy outer footer. */
  controls: 'canvas' | 'none'
  keyboardNavigation: boolean
  presenter: ProjectPresenterSettings
}
