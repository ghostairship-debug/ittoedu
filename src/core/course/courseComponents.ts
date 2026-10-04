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
  FlowBlock,
  LayerItem,
} from '../../shared/courseProjectTypes'

/**
 * Named components (`components/<name>.html`). `project.components` is their
 * only owner; page iframes refer to them by name and the Runtime node under such
 * an iframe is a copy that normalization rewrites from the definition. Flow
 * `course-component` blocks refer to them by name and hold no copy.
 * All helpers are pure and return a new project.
 */

export type CourseComponentReference =
  /** A page iframe (`nodeId`) of a composition. */
  | { layerItemId: string; nodeId: string }
  /** A `course-component` block of a handout. */
  | { surfaceId: string; blockId: string }
  /** A `course-component` block in a page's document leaf (`nodeId`). */
  | { layerItemId: string; nodeId: string; blockId: string }

type ComponentBlock = Extract<FlowBlock, { type: 'course-component' }>

function visitBlocks(blocks: FlowBlock[], visit: (block: ComponentBlock) => void): void {
  for (const block of blocks) {
    if (block.type === 'course-component') visit(block)
    else if (block.type === 'section') visitBlocks(block.blocks, visit)
  }
}

/** Every `course-component` block, in handouts and in page documents. */
function visitComponentBlocks(project: CourseProjectDocument, visit: (reference: CourseComponentReference, block: ComponentBlock) => void): void {
  for (const { item, root } of compositionRoots(project)) {
    const walk = (node: CompositionNode<CourseRuntimeDefinition>): void => {
      if (node.kind === 'document') visitBlocks(node.content.blocks, block => visit({ layerItemId: item.layerItemId, nodeId: node.id, blockId: block.id }, block))
      else if (node.kind === 'element') node.children.forEach(walk)
    }
    walk(root)
  }
  for (const surface of project.surfaces) {
    if (surface.type === 'flow') visitBlocks(surface.blocks, block => visit({ surfaceId: surface.id, blockId: block.id }, block))
  }
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

/** Page iframes, then blocks, that use a component, in course order. */
export function courseComponentReferences(project: CourseProjectDocument, name: string): CourseComponentReference[] {
  const key = courseComponentNameKey(name)
  const result: CourseComponentReference[] = []
  visitIframes(project, (layerItemId, node, referenced) => {
    if (courseComponentNameKey(referenced) === key) result.push({ layerItemId, nodeId: node.id })
  })
  visitComponentBlocks(project, (reference, block) => {
    if (courseComponentNameKey(block.name) === key) result.push(reference)
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

/** Renames a component and rewrites every iframe and block reference to it. */
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
    if (courseComponentNameKey(referenced) === key) node.attributes.src = componentReferenceSrc(node.attributes.src!, to)
  })
  visitComponentBlocks(next, (_reference, block) => {
    if (courseComponentNameKey(block.name) === key) block.name = to
  })
  return next
}

/** The same written reference pointing at another component name. */
function componentReferenceSrc(src: string, name: string): string {
  const end = src.search(/[?#]/)
  const path = end < 0 ? src : src.slice(0, end)
  const slash = path.lastIndexOf('/')
  const extension = /\.html?$/i.exec(path)?.[0] ?? '.html'
  return `${path.slice(0, slash + 1)}${name}${extension}${end < 0 ? '' : src.slice(end)}`
}

/** Removes a definition; pages and blocks that still refer to it show a placeholder until it is written again. */
export function deleteCourseComponent(project: CourseProjectDocument, name: string): CourseProjectDocument {
  const stored = findCourseComponentName(project, name)
  if (stored === undefined) return project
  const next = structuredClone(project)
  delete next.components![stored]
  if (!Object.keys(next.components!).length) delete next.components
  return next
}

const DEFINITION_FIELDS = ['protocol', 'runtimeApiVersion', 'enabled', 'renderMode', 'source', 'assets', 'draft', 'content'] as const
type DefinitionField = typeof DEFINITION_FIELDS[number]

function definitionValue(runtime: CourseRuntimeDefinition | CourseComponentDefinition, field: DefinitionField): unknown {
  if (field !== 'content') return runtime[field]
  return { values: runtime.content.values, ...(runtime.content.metadata ? { metadata: runtime.content.metadata } : {}) }
}

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)

function newDefinition(runtime: CourseRuntimeDefinition): CourseComponentDefinition {
  return Object.fromEntries(DEFINITION_FIELDS.flatMap(field => {
    const value = definitionValue(runtime, field)
    return value === undefined ? [] : [[field, structuredClone(value)]]
  })) as unknown as CourseComponentDefinition
}

type IframeNode = Extract<CompositionNode<CourseRuntimeDefinition>, { kind: 'element' }>

function componentCopies(project: CourseProjectDocument): Map<string, { name: string; runtime: CourseRuntimeDefinition; node: IframeNode }> {
  const copies = new Map<string, { name: string; runtime: CourseRuntimeDefinition; node: IframeNode }>()
  visitIframes(project, (layerItemId, node, name) => {
    const child = node.children.length === 1 ? node.children[0]! : undefined
    if (child?.kind === 'runtime') copies.set(JSON.stringify([layerItemId, node.id]), { name, runtime: child.runtime, node })
  })
  return copies
}

/**
 * A commit that changed definition fields of a page copy (a generic edit, the
 * Runtime source editor, an imported build artifact) changes the component
 * itself: exactly the changed fields are written to `project.components`, which
 * then rewrites every copy. Conflicting edits of one component are rejected.
 * A page the commit brings in with its own component (paste, saved fragment)
 * defines it; under a taken name with other content it gets a free name, as an
 * HTML import would. Mutates `next`; `previous` is the committed state the change was made from.
 */
export function applyComponentCopyEdits(previous: CourseProjectDocument, next: CourseProjectDocument): void {
  const before = componentCopies(previous)
  const written = new Map<string, unknown>()
  /** Names this commit's own new copies defined, and the free names their other contents got. */
  const introduced = new Set<string>()
  const renamed = new Map<string, string>()
  for (const [key, copy] of componentCopies(next)) {
    const stored = findCourseComponentName(next, copy.name)
    const prior = before.get(key)
    if (!prior) {
      const definition = newDefinition(copy.runtime)
      if (stored === undefined) {
        ;(next.components ??= {})[copy.name] = definition
        introduced.add(courseComponentNameKey(copy.name))
        continue
      }
      if (same(next.components![stored], definition)) continue
      const original = findCourseComponentName(previous, stored)
      // A definition the commit itself wrote decides what its new pages show.
      const authored = original === undefined
        ? !introduced.has(courseComponentNameKey(stored))
        : !same(previous.components![original], next.components![stored])
      if (authored) continue
      const id = JSON.stringify([courseComponentNameKey(stored), definition])
      let name = renamed.get(id)
      if (name === undefined) {
        name = uniqueCourseComponentName(next, stored)
        next.components![name] = definition
        introduced.add(courseComponentNameKey(name))
        renamed.set(id, name)
      }
      copy.node.attributes.src = componentReferenceSrc(copy.node.attributes.src!, name)
      continue
    }
    // The frame now names another component: its copy is stale and the name decides.
    if (courseComponentNameKey(prior.name) !== courseComponentNameKey(copy.name)) continue
    if (stored === undefined) {
      if (!same(prior.runtime, copy.runtime)) {
        throw new TypeError(`组件“${copy.name}”没有定义：页面中的组件内容由软件按 components/${copy.name}.html 维护，请先写入组件定义`)
      }
      continue
    }
    const definition = next.components![stored]!
    const original = findCourseComponentName(previous, stored)
    const originalDefinition = original === undefined ? undefined : previous.components![original]
    for (const field of DEFINITION_FIELDS) {
      const value = definitionValue(copy.runtime, field)
      if (same(definitionValue(prior.runtime, field), value)) continue
      const id = JSON.stringify([courseComponentNameKey(stored), field])
      if (written.has(id) && !same(written.get(id), value)) throw new TypeError(`组件“${stored}”的多个页面副本被改成了不同内容，未提交修改`)
      if (originalDefinition && !same(definitionValue(originalDefinition, field), definitionValue(definition, field)) && !same(definitionValue(definition, field), value)) {
        throw new TypeError(`组件“${stored}”的定义与页面副本同时被修改且内容不同，未提交修改`)
      }
      written.set(id, value)
      if (field === 'content') definition.content = structuredClone(value) as CourseComponentDefinition['content']
      else if (value === undefined) delete definition[field]
      else Object.assign(definition, { [field]: structuredClone(value) })
    }
  }
}
