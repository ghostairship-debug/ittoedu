import type { TeacherControllerButton, TeacherControllerConfig } from './teacherControllerConfig'

/** Allocated control slots are shared by the panel and its HUD footprint. */
export function teacherControllerButtonWidth(button: TeacherControllerButton): number {
  const type = button.action.type
  if (type === 'scene.open-picker') return 76
  if (['scene.previous', 'scene.next', 'scene.replay', 'course.restart', 'audio.toggle-mute', 'player.fullscreen.toggle'].includes(type)) return 40
  const text = Array.from(button.label).reduce((width, character) => width + (/[^\x00-\xff]/.test(character) ? 13 : 8), 0)
  return type.startsWith('step.') ? Math.max(type === 'step.next' ? 114 : 100, text + 48) : Math.max(40, text + 22)
}

export function teacherControllerLayout(config: TeacherControllerConfig) {
  const steps = config.buttons.filter(button => button.visible && button.action.type.startsWith('step.'))
  const tools = config.buttons.filter(button => button.visible && !button.action.type.startsWith('step.'))
  const group = (values: TeacherControllerButton[]) => values.reduce((width, button) => width + teacherControllerButtonWidth(button), 0) + Math.max(0, values.length - 1) * 4
  const identityWidth = config.compact ? 0 : 180
  const stepWidth = steps.length ? group(steps) + 17 : 0
  // Zoom remains an existing independent tool; the launcher is optional.
  const toolWidth = group(tools) + (tools.length ? 4 : 0) + 80
  const launcherWidth = config.collapsible ? 46 : 0
  const groups = [identityWidth, stepWidth, toolWidth, launcherWidth].filter(Boolean)
  return { identityWidth, width: 18 + groups.reduce((sum, width) => sum + width, 0) + Math.max(0, groups.length - 1) * 12 }
}
