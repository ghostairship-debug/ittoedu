import type { ComponentEdit, ComponentFrame, CourseProjectV10, TeacherControllerPort } from './contracts/component-platform'
import { componentDefinitionBuiltinKey } from './contracts/component-platform'
import { invertMatrix, multiplyMatrices, type AffineMatrix } from '../core/components/geometry'
import type { FlowSize } from './flowViewportGeometry'
import { readTeacherControllerConfig } from './teacherControllerConfig'

export type TeacherControllerDisplayPort = Pick<TeacherControllerPort, 'read' | 'subscribe' | 'setCollapsed'> & {
  placement?(): { x: number; y: number }
}
const identity: AffineMatrix = [1, 0, 0, 1, 0, 0]

function collapsedTranslation(frame: ComponentFrame, collapsed: boolean) {
  const x = collapsed ? Math.max(0, frame.width - 52) : 0, y = collapsed ? Math.max(0, frame.height - 52) : 0
  return { x: frame.transform[0] * x + frame.transform[2] * y, y: frame.transform[1] * x + frame.transform[3] * y }
}

export function teacherControllerFrameOrigin(frame: ComponentFrame, collapsed = false) {
  const shift = collapsedTranslation(frame, collapsed)
  return { x: frame.transform[4] + shift.x, y: frame.transform[5] + shift.y }
}

export function teacherControllerViewportFrame(frame: ComponentFrame, viewport: FlowSize, offset = { x: 0, y: 0 }, collapsed = false): ComponentFrame {
  const [a, b, c, d, x, y] = frame.transform, shift = collapsedTranslation(frame, collapsed)
  let width = collapsed ? Math.min(52, frame.width) : frame.width, height = collapsed ? Math.min(52, frame.height) : frame.height
  const bounds = () => {
    const xs = [0, a * width, c * height, a * width + c * height], ys = [0, b * width, d * height, b * width + d * height]
    return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) }
  }
  if (b === 0 && c === 0) {
    width = Math.min(width, viewport.width / Math.max(0.000001, Math.abs(a)))
    height = Math.min(height, viewport.height / Math.max(0.000001, Math.abs(d)))
  } else {
    const initial = bounds(), fit = Math.min(1, viewport.width / Math.max(1, initial.right - initial.left), viewport.height / Math.max(1, initial.bottom - initial.top))
    width *= fit; height *= fit
  }
  const box = bounds()
  return { width, height, transform: [a, b, c, d,
    Math.max(-box.left, Math.min(x + offset.x + shift.x, viewport.width - box.right)),
    Math.max(-box.top, Math.min(y + offset.y + shift.y, viewport.height - box.bottom))] }
}

export function isGlobalTeacherController(project: CourseProjectV10, id: string): boolean {
  const instance = project.instances[id]
  return Boolean(instance && (project.global.overlay.includes(id) || project.global.underlay.includes(id))
    && componentDefinitionBuiltinKey(project.definitions[instance.definitionId]) === 'guoling.navigation')
}

function controllerConfigAt(project: CourseProjectV10, id: string, locationId: string) {
  const instance = project.instances[id]
  const data = instance.data && typeof instance.data === 'object' && !Array.isArray(instance.data) ? instance.data : {}
  const variants = data.sceneStyles
  const variant = variants && typeof variants === 'object' && !Array.isArray(variants) ? variants[locationId] : null
  return readTeacherControllerConfig({ ...data, ...(variant && typeof variant === 'object' && !Array.isArray(variant) ? variant : {}) })
}

export function teacherControllerAuthoredCollapsed(project: CourseProjectV10, id: string, locationId: string): boolean {
  const config = controllerConfigAt(project, id, locationId)
  return Boolean(config.collapsible && config.defaultCollapsed)
}

export function teacherControllerIsCollapsed(project: CourseProjectV10, id: string, port?: TeacherControllerDisplayPort): boolean {
  const instance = project.instances[id], definition = instance && project.definitions[instance.definitionId]
  const implementation = instance?.implementationOverride ?? definition?.implementation
  if (implementation?.kind !== 'builtin' || implementation.key !== 'guoling.navigation') return false
  const config = controllerConfigAt(project, id, port?.read().locationId ?? '')
  return Boolean(config.collapsible && (port?.read().collapsed ?? config.defaultCollapsed))
}

/** Author frames remain unchanged; only the controller's viewport display cancels its parent's fit. */
export function projectTeacherControllerInstances(project: CourseProjectV10, viewport: FlowSize,
  parentToViewport: AffineMatrix = identity, port?: TeacherControllerDisplayPort): CourseProjectV10 {
  if (viewport.width <= 0 || viewport.height <= 0) return project
  const offset = port?.placement?.() ?? { x: 0, y: 0 }, inverse = invertMatrix(parentToViewport)
  let instances = project.instances
  for (const id of [...project.global.underlay, ...project.global.overlay]) {
    const instance = project.instances[id], frame = instance?.frame
    if (!frame || !isGlobalTeacherController(project, id)) continue
    const shown = teacherControllerViewportFrame(frame, viewport, offset, teacherControllerIsCollapsed(project, id, port))
    const transform = multiplyMatrices(inverse, shown.transform)
    if (instances === project.instances) instances = { ...instances }
    instances[id] = { ...instance, frame: { width: shown.width, height: shown.height, transform: [...transform] } }
  }
  return instances === project.instances ? project : { ...project, instances }
}

/** A real gesture may move a clamped frame; unchanged axes keep their authored placement. */
export function restoreTeacherControllerFrameEdits(edits: ComponentEdit[], original: CourseProjectV10, display: CourseProjectV10,
  viewport: FlowSize, parentToViewport: AffineMatrix = identity, offset = { x: 0, y: 0 }, port?: TeacherControllerDisplayPort): ComponentEdit[] {
  return edits.map(edit => {
    if (edit.type !== 'frame.set' || !edit.frame || !isGlobalTeacherController(original, edit.instanceId)) return edit
    const source = original.instances[edit.instanceId]?.frame, before = display.instances[edit.instanceId]?.frame
    if (!source || !before) return edit
    const start = multiplyMatrices(parentToViewport, before.transform), next = multiplyMatrices(parentToViewport, edit.frame.transform)
    const transform = [...source.transform] as ComponentFrame['transform']
    const collapsed = teacherControllerIsCollapsed(original, edit.instanceId, port)
    const firstColumnChanged = Math.abs(next[0] - start[0]) > 0.000001 || Math.abs(next[1] - start[1]) > 0.000001
    const secondColumnChanged = Math.abs(next[2] - start[2]) > 0.000001 || Math.abs(next[3] - start[3]) > 0.000001
    if (firstColumnChanged) { const ratio = collapsed ? 1 : before.width / source.width; transform[0] = next[0] * ratio; transform[1] = next[1] * ratio }
    if (secondColumnChanged) { const ratio = collapsed ? 1 : before.height / source.height; transform[2] = next[2] * ratio; transform[3] = next[3] * ratio }
    const shift = collapsedTranslation({ ...source, transform }, collapsed)
    const changesX = Math.abs(next[0] - start[0]) > 0.000001 || Math.abs(next[2] - start[2]) > 0.000001
    const changesY = Math.abs(next[1] - start[1]) > 0.000001 || Math.abs(next[3] - start[3]) > 0.000001
    if (Math.abs(next[4] - start[4]) > 0.000001 || changesX) transform[4] = next[4] - offset.x - shift.x
    if (Math.abs(next[5] - start[5]) > 0.000001 || changesY) transform[5] = next[5] - offset.y - shift.y
    return { ...edit, frame: { width: Math.abs(edit.frame.width - before.width) > 0.000001 ? edit.frame.width : source.width,
      height: Math.abs(edit.frame.height - before.height) > 0.000001 ? edit.frame.height : source.height, transform } }
  })
}
