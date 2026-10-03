import type { CompositionNode } from '../../shared/composition/content'
import {
  componentReferenceName,
  courseComponentNameIssue,
  courseComponentNameKey,
} from '../../shared/composition/projectReferences'
import type {
  CourseComponentDefinition,
  CourseProjectDocument,
  CourseRuntimeDefinition,
  LayerItem,
} from '../../shared/courseProjectTypes'

/**
 * Named components (`components/<name>.html`). `project.components` is their
 * only owner; page iframes refer to them by name and the Runtime node under such
 * an iframe is a copy that normalization rewrites from the definition.
 * All helpers are pure and return a new project.
 */

export interface CourseComponentReference {
  layerItemId: string
  /** The iframe node that refers to the component. */
  nodeId: string
}

function compositionRoots(project: CourseProjectDocument): Array<{ item: LayerItem; root: CompositionNode<CourseRuntimeDefinition> }> {
  const items: LayerItem[] = project.globalLayerItems.map(entry => entry.item)
  for (const surface of project.surfaces) {
    items.push(...surface.surfaceLayerItems.map(entry => entry.item))
    if (surface.type === 'slide') surface.scenes.forEach(scene => items.push(...scene.layerItems))
    else if (surface.type === 'spatial-2d') items.push(...surface.world.layerItems)
  }
  return items.flatMap(item => item.kind === 'composition' ? [{ item, root: item.content.root }] : [])
}

function visitIframes(project: CourseProjectDocument, visit: (layerItemId: string, node: Extract<CompositionNode<CourseRuntimeDefinition>, { kind: 'element' }>, name: string) => void): void {
  for (const { item, root } of compositionRoots(project)) {
    const walk = (node: CompositionNode<CourseRuntimeDefinition>): void => {
      if (node.kind !== 'element') return
      const src = node.tagName.toLowerCase() === 'iframe' ? node.attributes.src : undefined
      const name = src === undefined ? null : componentReferenceName(src)
      if (name) visit(item.layerItemId, node, name)
      node.children.forEach(walk)
    }
    walk(root)
  }
}

export function courseComponentNames(project: CourseProjectDocument): string[] {
  return Object.keys(project.components ?? {})
}

/** The stored spelling of a name; names match ignoring case, as file names do. */
export function findCourseComponentName(project: CourseProjectDocument, name: string): string | undefined {
  const key = courseComponentNameKey(name)
  return courseComponentNames(project).find(candidate => courseComponentNameKey(candidate) === key)
}

/** A valid, unused name close to `wanted`: `公转模拟`, `公转模拟 2`, … */
export function uniqueCourseComponentName(project: CourseProjectDocument, wanted: string): string {
  // eslint-disable-next-line no-control-regex
  let base = wanted.replace(/[\\/:*?"<>|#%\u0000-\u001f\u007f]+/g, '-').trim().replace(/^\.+|\.+$/g, '').trim().slice(0, 72).trim()
  if (!base || courseComponentNameIssue(base)) base = '组件'
  let name = base
  for (let suffix = 2; findCourseComponentName(project, name) !== undefined; suffix++) name = `${base} ${suffix}`
  return name
}

/** Pages that use a component, in course order. */
export function courseComponentReferences(project: CourseProjectDocument, name: string): CourseComponentReference[] {
  const key = courseComponentNameKey(name)
  const result: CourseComponentReference[] = []
  visitIframes(project, (layerItemId, node, referenced) => {
    if (courseComponentNameKey(referenced) === key) result.push({ layerItemId, nodeId: node.id })
  })
  return result
}

/** Creates or replaces the definition of `name`; every page that refers to it follows on commit. */
export function setCourseComponent(project: CourseProjectDocument, name: string, definition: CourseComponentDefinition): CourseProjectDocument {
  const issue = courseComponentNameIssue(name)
  if (issue) throw new TypeError(issue)
  const next = structuredClone(project)
  const components = next.components ??= {}
  const stored = findCourseComponentName(next, name)
  if (stored !== undefined && stored !== name) delete components[stored]
  components[name] = structuredClone(definition)
  return next
}

/** Renames a component and rewrites every iframe reference to it. */
export function renameCourseComponent(project: CourseProjectDocument, from: string, to: string): CourseProjectDocument {
  const issue = courseComponentNameIssue(to)
  if (issue) throw new TypeError(issue)
  const stored = findCourseComponentName(project, from)
  if (stored === undefined) throw new TypeError(`组件不存在：${from}`)
  const occupied = findCourseComponentName(project, to)
  if (occupied !== undefined && occupied !== stored) throw new TypeError(`组件名称已被使用：${to}`)
  const next = structuredClone(project)
  const components = next.components!
  const definition = components[stored]!
  delete components[stored]
  components[to] = definition
  const key = courseComponentNameKey(stored)
  visitIframes(next, (_layerItemId, node, referenced) => {
    if (courseComponentNameKey(referenced) !== key) return
    const src = node.attributes.src!
    const end = src.search(/[?#]/)
    const path = end < 0 ? src : src.slice(0, end)
    const slash = path.lastIndexOf('/')
    const extension = /\.html?$/i.exec(path)?.[0] ?? '.html'
    node.attributes.src = `${path.slice(0, slash + 1)}${encodeURI(to)}${extension}${end < 0 ? '' : src.slice(end)}`
  })
  return next
}

/** Removes a definition; pages that still refer to it show a placeholder until it is written again. */
export function deleteCourseComponent(project: CourseProjectDocument, name: string): CourseProjectDocument {
  const stored = findCourseComponentName(project, name)
  if (stored === undefined) return project
  const next = structuredClone(project)
  delete next.components![stored]
  if (!Object.keys(next.components!).length) delete next.components
  return next
}
