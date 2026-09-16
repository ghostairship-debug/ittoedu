import { buildPublishedCourseV2Payload as buildPublished } from '../../src/renderer/export/course/buildPublishedCourse'
import { createBlankCourseProject } from '../../src/renderer/project/createCourseProject'
import type { ComponentLayerItem } from '../../src/shared/courseProjectTypes'
import type { TeacherControllerConfig } from '../../src/shared/teacherControllerConfig'
import { createTeacherControllerComponentItem } from '../../src/renderer/components/teacherControllerComponent'
import { createDefaultTeacherControllerPackage } from '../../src/shared/defaultTeacherControllerComponent'
import { componentPackageMeta } from '../../src/renderer/components/editableComponentPackage'
import { withDefaultComponentController } from '../../src/renderer/components/teacherControllerComponent'
import { createCourseProjectArchive } from '../../src/renderer/project/courseProjectArchive'
export const controllerPackage = createDefaultTeacherControllerPackage()
export const controllerPackages = { [controllerPackage.manifest.id]: controllerPackage }
export const controllerMetadata = { [controllerPackage.manifest.id]: componentPackageMeta(controllerPackage, { editableCopy: true }) }
export function createControllerFixture(options: Partial<Omit<TeacherControllerConfig, 'style'>> & { id?: string; name?: string; x?: number; y?: number; width?: number; height?: number; rotation?: number; opacity?: number; visible?: boolean; locked?: boolean; playbackInitialVisibility?: 'inherit' | 'hidden'; style?: Partial<TeacherControllerConfig['style']> } = {}, order = 1) {
  const item = createTeacherControllerComponentItem(options.id ?? 'controller')
  const { id, name, x, y, width, height, rotation, opacity, visible, locked, playbackInitialVisibility, ...props } = options
  item.order = order
  if (name) item.label = name
  for (const key of ['x','y','width','height'] as const) if (options[key] !== undefined) item.frame[key] = options[key]!
  for (const key of ['rotation','opacity','visible','locked','playbackInitialVisibility'] as const) if (options[key] !== undefined) Object.assign(item, { [key]: options[key] })
  item.props = { ...item.props, ...props, style: { ...(item.props.style as object), ...props.style } }
  return item
}

export type ControllerFixture = ComponentLayerItem & { role: 'teacher-controller'; props: TeacherControllerConfig & Record<string, unknown> }
export function isControllerFixture(item: unknown): item is ControllerFixture {
  return !!item && typeof item === 'object' && Reflect.get(item, 'kind') === 'component' && Reflect.get(item, 'role') === 'teacher-controller'
}
export function controllerConfig(item: { props: Record<string, unknown> }): TeacherControllerConfig { return item.props as unknown as TeacherControllerConfig }

export function buildPublishedFixture(sources: Parameters<typeof buildPublished>[0], options?: Parameters<typeof buildPublished>[1]) {
  return buildPublished({ ...sources, components: { ...controllerPackages, ...sources.components } }, options)
}
/** Fixtures that start from a document factory must carry its referenced built-in files. */
export function createArchiveFixture(input: Parameters<typeof createCourseProjectArchive>[0], options?: Parameters<typeof createCourseProjectArchive>[1]) {
  const packages = withDefaultComponentController(input.project).componentPackages
  const componentFiles = Object.fromEntries(Object.values(packages).map(pkg => [`${pkg.manifest.id}@${pkg.manifest.version}`, pkg.files]))
  return createCourseProjectArchive({ ...input, componentFiles: { ...componentFiles, ...input.componentFiles } }, options)
}
export const publishedControllerPackages = buildPublishedFixture({ project: createBlankCourseProject(), assetFiles: {}, components: controllerPackages }).components

export function queryDeep<K extends keyof HTMLElementTagNameMap>(root: ParentNode | null | undefined, selector: K): HTMLElementTagNameMap[K] | null
export function queryDeep<T extends Element = HTMLElement>(root: ParentNode | null | undefined, selector: string): T | null
export function queryDeep<T extends Element = HTMLElement>(root: ParentNode | null | undefined, selector: string): T | null {
  if (!root) return null
  const found = root.querySelector<T>(selector)
  if (found) return found
  for (const child of root.querySelectorAll('*')) if (child.shadowRoot) {
    const nested = queryDeep<T>(child.shadowRoot, selector)
    if (nested) return nested
  }
  return null
}
export function dragController(panel: HTMLElement, dx: number, dy = 0) {
  panel.setPointerCapture = () => undefined
  panel.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 100, clientY: 100 }))
  panel.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, button: 0, clientX: 100 + dx, clientY: 100 + dy }))
  panel.ownerDocument.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))
}
