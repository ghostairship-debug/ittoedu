import type { CompositionNode, WebComposition } from '../../shared/composition/content'
import {
  assetReferencePath,
  componentReferenceName,
  courseComponentNameKey,
  cssUrlReferences,
} from '../../shared/composition/projectReferences'
import { sceneFragmentNodes } from '../../shared/composition/stateNodes'
import { createDefaultSlidePresentation } from '../../shared/contracts/course-project-v9/presentation'
import type {
  CompositionLayerItem,
  CourseComponentDefinition,
  CourseProjectDocument,
  CourseRuntimeDefinition,
  FlowBlock,
  LayerItem,
  SlidePresentationState,
  SlideSceneDocument,
} from '../../shared/courseProjectTypes'

type Node = CompositionNode<CourseRuntimeDefinition>

/** Every composition item of the course, whatever its owner. */
function compositionItems(project: CourseProjectDocument): CompositionLayerItem[] {
  const items: LayerItem[] = project.globalLayerItems.map(entry => entry.item)
  for (const surface of project.surfaces) {
    items.push(...surface.surfaceLayerItems.map(entry => entry.item))
    if (surface.type === 'slide') surface.scenes.forEach(scene => items.push(...scene.layerItems))
    else if (surface.type === 'spatial-2d') items.push(...surface.world.layerItems)
  }
  return items.filter((item): item is CompositionLayerItem => item.kind === 'composition')
}

function walk(node: Node, visit: (node: Node) => void): void {
  visit(node)
  if (node.kind === 'element') node.children.forEach(child => walk(child, visit))
}

/** Attributes that load a file, and inline style texts. */
const URL_ATTRIBUTES = new Set(['src', 'href', 'poster', 'xlink:href', 'data'])

function compositionAssetSlots(content: WebComposition<CourseRuntimeDefinition>): Set<string> {
  const slots = new Set<string>()
  const add = (value: string) => { const path = assetReferencePath(value); if (path) slots.add(path) }
  const css = (text: string) => cssUrlReferences(text).forEach(reference => add(reference.reference))
  walk(content.root, node => {
    if (node.kind === 'element') {
      for (const [name, value] of Object.entries(node.attributes)) {
        if (URL_ATTRIBUTES.has(name.toLowerCase())) add(value)
        else if (name.toLowerCase() === 'srcset') value.split(',').forEach(part => add(part.trim().split(/\s+/)[0] ?? ''))
        else if (name.toLowerCase() === 'style') css(value)
      }
      if (node.tagName.toLowerCase() === 'style') node.children.forEach(child => { if (child.kind === 'text') css(child.text) })
    }
  })
  return slots
}

/** `assets/<x>` names the asset stored at that path, or the only asset whose file is `<x>`. */
function assetSlotIndex(project: CourseProjectDocument): Map<string, string> {
  const index = new Map<string, string>()
  const byFilename = new Map<string, string | null>()
  for (const asset of Object.values(project.assets)) {
    index.set(asset.path.replace(/\\/g, '/').replace(/^\.\//, ''), asset.id)
    const slot = `assets/${asset.filename}`
    byFilename.set(slot, byFilename.has(slot) ? null : asset.id)
  }
  for (const [slot, id] of byFilename) if (id && !index.has(slot)) index.set(slot, id)
  return index
}

/** Binds written asset slots to the assets now present; the references themselves are never rewritten. */
function bindAssetSlots(
  bindings: Record<string, { assetId: string }>,
  slots: ReadonlySet<string>,
  index: ReadonlyMap<string, string>,
): void {
  for (const key of Object.keys(bindings)) {
    if (key.startsWith('assets/') && (!slots.has(key) || !index.has(key))) delete bindings[key]
  }
  for (const slot of slots) {
    const assetId = index.get(slot)
    if (assetId) bindings[slot] = { assetId }
  }
}

/** Media blocks written as `assets/...` show the asset now at that path when its kind fits, and wait otherwise. */
function bindMediaSources(blocks: FlowBlock[], index: ReadonlyMap<string, string>, kinds: ReadonlyMap<string, string>): void {
  for (const block of blocks) {
    if (block.type === 'section') bindMediaSources(block.blocks, index, kinds)
    else if (block.type === 'media' && block.source !== undefined) {
      const path = assetReferencePath(block.source)
      const assetId = path ? index.get(path) : undefined
      if (assetId && kinds.get(assetId) === block.mediaKind) block.assetId = assetId
      else delete block.assetId
    }
  }
}

function themeAssetSlots(css: string): Set<string> {
  const slots = new Set<string>()
  for (const reference of cssUrlReferences(css)) {
    const path = assetReferencePath(reference.reference)
    if (path) slots.add(path)
  }
  return slots
}

/** The Runtime that a page iframe derives from a component; its own instance fields are kept. */
export function componentRuntimeCopy(
  definition: CourseComponentDefinition,
  instance?: Pick<CourseRuntimeDefinition, 'staticFallback' | 'nodeBindings' | 'content'>,
): CourseRuntimeDefinition {
  const { content, ...fields } = structuredClone(definition)
  return {
    ...fields,
    content: { ...content, ...(instance?.content.overrides ? { overrides: structuredClone(instance.content.overrides) } : {}) },
    ...(instance?.nodeBindings ? { nodeBindings: structuredClone(instance.nodeBindings) } : {}),
    ...(instance?.staticFallback ? { staticFallback: structuredClone(instance.staticFallback) } : {}),
  }
}

/** One-way: each page copy is rewritten from the named definition; a missing name leaves a placeholder. */
function syncComponentCopies(content: WebComposition<CourseRuntimeDefinition>, components: Readonly<Record<string, CourseComponentDefinition>>): void {
  const byKey = new Map(Object.entries(components).map(([name, definition]) => [courseComponentNameKey(name), definition]))
  const ids = new Set<string>()
  walk(content.root, node => ids.add(node.id))
  walk(content.root, node => {
    if (node.kind !== 'element' || node.tagName.toLowerCase() !== 'iframe' || node.attributes.src === undefined) return
    const name = componentReferenceName(node.attributes.src)
    if (!name) return
    const definition = byKey.get(courseComponentNameKey(name))
    const existing = node.children.length === 1 && node.children[0]!.kind === 'runtime' ? node.children[0]! as Extract<Node, { kind: 'runtime' }> : undefined
    if (!definition) {
      node.children = node.children.filter(child => child.kind !== 'runtime')
      return
    }
    let id = existing?.id ?? `${node.id}:component`
    for (let suffix = 2; !existing && ids.has(id); suffix++) id = `${node.id}:component-${suffix}`
    ids.add(id)
    node.children = [{ id, kind: 'runtime', runtime: componentRuntimeCopy(definition, existing?.runtime) }]
  })
}

function uniqueStateId(states: readonly SlidePresentationState[], wanted: string): string {
  const ids = new Set(states.map(state => state.id))
  let id = wanted
  for (let suffix = 2; ids.has(id); suffix++) id = `${wanted}_${suffix}`
  return id
}

/**
 * In-page steps: the initial state shows none of the scene's fragments and one
 * generated state per fragment shows one more. Generated states repeat the
 * initial state's own overrides; authored states stay as they are.
 */
function syncFragmentStates(project: CourseProjectDocument, surfaceId: string, scene: SlideSceneDocument): void {
  const count = sceneFragmentNodes(scene.layerItems).length
  if (!count && !scene.presentation?.states.some(state => state.fragmentStep !== undefined)) return
  const presentation = scene.presentation ??= createDefaultSlidePresentation()
  const initial = presentation.states.find(state => state.id === presentation.initialStateId) ?? presentation.states[0]!
  presentation.initialStateId = initial.id
  const generated = new Map<number, SlidePresentationState>()
  for (const state of presentation.states) {
    if (state !== initial && state.fragmentStep !== undefined && state.fragmentStep >= 1 && !generated.has(state.fragmentStep)) generated.set(state.fragmentStep, state)
  }
  const authored = presentation.states.filter(state => state !== initial && state.fragmentStep === undefined)
  const steps: SlidePresentationState[] = []
  if (count) {
    initial.fragmentStep = 0
    for (let step = 1; step <= count; step++) {
      const previous = generated.get(step)
      const state: SlidePresentationState = {
        id: previous?.id ?? uniqueStateId([...presentation.states, ...steps], `fragment_step_${step}`),
        name: previous?.name ?? `步骤 ${step}`,
        ...(initial.backgroundColor !== undefined ? { backgroundColor: initial.backgroundColor } : {}),
        ...(initial.backgroundAssetId !== undefined ? { backgroundAssetId: initial.backgroundAssetId } : {}),
        layerItemOverrides: structuredClone(initial.layerItemOverrides),
        ...(initial.layerItemOrder ? { layerItemOrder: [...initial.layerItemOrder] } : {}),
        fragmentStep: step,
      }
      steps.push(state)
    }
  } else delete initial.fragmentStep
  presentation.states = [initial, ...steps, ...authored]
  const ids = new Set(presentation.states.map(state => state.id))
  if (presentation.thumbnailStateId && !ids.has(presentation.thumbnailStateId)) presentation.thumbnailStateId = initial.id
  for (const location of project.locations) {
    if (location.kind === 'slide-scene' && location.surfaceId === surfaceId && location.sceneId === scene.id
      && location.stateId && !ids.has(location.stateId)) delete location.stateId
  }
}

/**
 * Software-maintained facts derived from authored content. Runs after every
 * change of a course and on new candidates; idempotent. Mutates `project`.
 * - binds `assets/...` references of compositions, the theme and Flow media blocks to assets now present;
 * - rewrites page copies of named components from `project.components`;
 * - keeps the in-page step states of every Slide scene in step with its fragments.
 */
export function normalizeCourseProjectInPlace(project: CourseProjectDocument): void {
  const index = assetSlotIndex(project)
  const kinds = new Map(Object.values(project.assets).map(asset => [asset.id, asset.kind]))
  const components = project.components ?? {}
  for (const item of compositionItems(project)) {
    syncComponentCopies(item.content, components)
    bindAssetSlots(item.content.assets, compositionAssetSlots(item.content), index)
    walk(item.content.root, node => { if (node.kind === 'document') bindMediaSources(node.content.blocks, index, kinds) })
  }
  if (project.theme) {
    const assets = { ...project.theme.assets }
    bindAssetSlots(assets, themeAssetSlots(project.theme.css), index)
    if (Object.keys(assets).length) project.theme.assets = assets
    else delete project.theme.assets
  }
  if (project.components && !Object.keys(project.components).length) delete project.components
  for (const surface of project.surfaces) {
    if (surface.type === 'slide') surface.scenes.forEach(scene => syncFragmentStates(project, surface.id, scene))
    else if (surface.type === 'flow') bindMediaSources(surface.blocks, index, kinds)
  }
}

export function normalizeCourseProject(project: CourseProjectDocument): CourseProjectDocument {
  const next = structuredClone(project)
  normalizeCourseProjectInPlace(next)
  return next
}
