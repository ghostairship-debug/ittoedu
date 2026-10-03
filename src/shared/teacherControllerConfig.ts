export type TeacherControllerAction =
  | { type: 'step.previous' }
  | { type: 'step.next' }
  | { type: 'scene.previous' }
  | { type: 'scene.next' }
  | { type: 'scene.replay' }
  | { type: 'course.restart' }
  | { type: 'scene.open-picker' }
  | {
      type: 'scene.go'
      sceneId: string
      targetStateId?: string
    }
  | { type: 'audio.toggle-mute' }
  | { type: 'player.fullscreen.toggle' }

export interface TeacherControllerButton {
  id: string
  action: TeacherControllerAction
  label: string
  visible: boolean
}

export interface TeacherControllerConfig {
  title: string
  showSceneProgress: boolean
  compact: boolean
  collapsible: boolean
  defaultCollapsed: boolean
  buttons: TeacherControllerButton[]
  /** Colours left unset follow the course theme (`--color-background`, `--color-text`, `--color-accent`). */
  style: {
    backgroundColor?: string
    backgroundOpacity: number
    accentColor?: string
    textColor?: string
    cornerRadius: number
  }
  includeInStaticExports: boolean
}


export function defaultTeacherControllerConfig(): TeacherControllerConfig {
  return {
    title: '教师控制台', showSceneProgress: true, compact: false, collapsible: true, defaultCollapsed: true,
    buttons: [
      ['previous', '上一步', 'step.previous'], ['next', '下一步', 'step.next'],
      ['previous-scene', '上一场景', 'scene.previous'], ['next-scene', '下一场景', 'scene.next'],
      ['directory', '场景目录', 'scene.open-picker'], ['replay', '重播', 'scene.replay'],
      ['restart', '重新开始', 'course.restart'], ['audio', '声音', 'audio.toggle-mute'],
      ['fullscreen', '全屏', 'player.fullscreen.toggle'],
    ].map(([id, label, type]) => ({ id: id!, label: label!, visible: id !== 'restart', action: { type } as TeacherControllerAction })),
    style: { backgroundOpacity: .94, cornerRadius: 16 },
    includeInStaticExports: false,
  }
}

const STYLE_KEYS = [
  ['backgroundColor', 'string'], ['backgroundOpacity', 'number'], ['accentColor', 'string'], ['textColor', 'string'], ['cornerRadius', 'number'],
] as const satisfies ReadonlyArray<readonly [keyof TeacherControllerConfig['style'], 'string' | 'number']>

/** Host reads only valid presentation hints; custom component props remain unrestricted. */
export function readTeacherControllerConfig(props: Record<string, unknown>): TeacherControllerConfig {
  const defaults = defaultTeacherControllerConfig()
  const result = { ...defaults }
  for (const key of ['title', 'showSceneProgress', 'compact', 'collapsible', 'defaultCollapsed', 'includeInStaticExports'] as const) {
    if (typeof props[key] === typeof defaults[key]) Object.assign(result, { [key]: props[key] })
  }
  const style = props.style
  if (style && typeof style === 'object') {
    result.style = { ...defaults.style }
    for (const [key, type] of STYLE_KEYS) {
      const value = Reflect.get(style, key)
      if (typeof value === type && (typeof value !== 'number' || Number.isFinite(value))) Object.assign(result.style, { [key]: value })
    }
  }
  if (Array.isArray(props.buttons)) result.buttons = props.buttons.filter((button): button is TeacherControllerButton =>
    !!button && typeof button.id === 'string' && typeof button.label === 'string' && typeof button.visible === 'boolean' &&
    !!button.action && typeof button.action.type === 'string' && (button.action.type !== 'scene.go' || typeof button.action.sceneId === 'string'))
  return result
}
