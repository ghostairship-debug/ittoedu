import type { ComponentDefinition, ComponentInstance, CourseProjectV10 } from '../../../shared/contracts/component-platform'
import { componentDefinitionBuiltinKey, owningContainer } from '../../../shared/contracts/component-platform/project'
import type { DocumentBlock } from '../../../shared/document/content'
import { documentBlockChildren } from '../../../shared/document/content'
import { allDocumentTextSlots, documentComponentDataVersions, inlineComponentIds } from '../../../shared/document/textInteraction'
import { equalComponentValue } from '../../../core/drivers/courseV10Operations'
import { resolveComponentOuterPresentation } from '../../../shared/componentPresentation'
import { componentPaintStyle } from '../../../player/components/componentPlacementStyle'
import type { FlowMediaLayoutWidths } from '../../../shared/flowMediaLayout'
import { isNativeFlowLayoutGroup } from '../../../shared/flowNativeLayout'

interface Entry { token: number; input: unknown; output: unknown }
export interface FlowObjectVersions {
  revision: ReadonlyMap<string, number>
  changedSince(previous: unknown): ReadonlySet<string>
  forBlock(block: DocumentBlock): unknown
}
function definitionPresentation(definition: ComponentDefinition | undefined) {
  const implementation = definition?.implementation
  return definition && { role: definition.role, professionalBuiltinKey: definition.professionalBuiltinKey, dataSchema: definition.dataSchema,
    implementation: implementation?.kind === 'builtin' ? implementation : { kind: implementation?.kind } }
}
function instancePresentation(instance: ComponentInstance, definition: ComponentDefinition | undefined, group: boolean) {
  return { id: instance.id, definition: definitionPresentation(definition), frame: instance.frame, style: instance.style,
    flowLayout: instance.flowLayout, flowPlacement: instance.flowPlacement, childIds: instance.childIds, container: instance.container,
    visible: instance.visible, visibility: instance.visibility, locked: instance.locked, viewportPinned: instance.viewportPinned,
    implementation: instance.implementationOverride ? { kind: instance.implementationOverride.kind,
      key: instance.implementationOverride.kind === 'builtin' ? instance.implementationOverride.key : undefined } : undefined,
    resourceBindings: instance.authoring?.resourceBindings, ...(group ? {} : { data: instance.data }) }
}

/** PM's disposable presentation versions; executable Source and resource contents stay with World. */
export function createFlowObjectVersions() {
  const entries = new Map<string, Entry>()
  let token = 0
  const snapshot = (): FlowObjectVersions => {
    const revision = new Map([...entries].map(([id, entry]) => [id, entry.token]))
    return { revision, forBlock: block => revision.get(block.id), changedSince(previous) {
      const before = previous instanceof Map ? previous as ReadonlyMap<string, number> : new Map<string, number>()
      return new Set([...new Set([...before.keys(), ...revision.keys()])].filter(id => before.get(id) !== revision.get(id)))
    } }
  }
  let result = snapshot()
  return (project: CourseProjectV10, blocks: readonly DocumentBlock[], layout: FlowMediaLayoutWidths, width: number, surfaceId: string): FlowObjectVersions => {
    const objects = new Map<string, { parentId: string | null; group: boolean }>()
    const visit = (values: readonly DocumentBlock[], parentId: string | null) => {
      for (const block of values) {
        const group = block.type === 'course-instance' && block.blocks !== undefined
        if (project.instances[block.id] && (group || ['media', 'chart', 'component', 'course-component', 'course-instance'].includes(block.type)))
          objects.set(block.id, { parentId, group })
        const children = documentBlockChildren(block)
        if (children) visit(children, block.id)
      }
    }
    visit(blocks, surfaceId)
    // All projected document objects share this formal container ancestry.
    // Resolve it once, without comparing ancestor data or executable bodies.
    let scopeId = surfaceId, inGlobal = false
    const scopeIds = new Set<string>()
    while (!scopeIds.has(scopeId)) {
      scopeIds.add(scopeId)
      const owner = owningContainer(project, scopeId)
      if (owner?.kind === 'global') { inGlobal = true; break }
      if (owner?.kind !== 'instance') break
      scopeId = owner.instanceId
    }
    let changed = false
    for (const id of entries.keys()) if (!objects.has(id)) { entries.delete(id); changed = true }
    for (const [id, { parentId, group }] of objects) {
      const previous = entries.get(id), nodes: ComponentInstance[] = [], visited = new Set<string>(), parents = new Map<string, ComponentInstance>()
      const own = (value: string, children: boolean, parent?: ComponentInstance) => {
        const instance = project.instances[value]
        if (!instance || visited.has(value)) return
        visited.add(value); nodes.push(instance)
        if (parent) parents.set(value, parent)
        if (children) instance.childIds?.forEach(id => own(id, true, instance))
      }
      own(id, !group)
      const inlineVersions = nodes.map(instance => instance.childIds?.length && !instance.container
        ? documentComponentDataVersions(project, instance.id) : [])
      const parent = parentId ? project.instances[parentId] : undefined
      const input = { nodes: nodes.map(instance => instancePresentation(instance, project.definitions[instance.definitionId], group)), inlineVersions,
        nativeParent: Boolean(parent && isNativeFlowLayoutGroup(parent, project.definitions[parent.definitionId])),
        roots: nodes.map(instance => project.rootIds.includes(instance.id)), inGlobal, group, layout, width }
      if (previous && equalComponentValue(previous.input, input)) {
        previous.input = input
        continue
      }
      const presentations = new Map<string, ReturnType<typeof resolveComponentOuterPresentation>>()
      const output = project.instances[id]?.container ? {
        // Its retained projection and FlowWorkspace shell update in place. A PM
        // presentation refresh would dispose the live camera and observation.
        container: project.instances[id]!.container!.kind, caption: project.instances[id]!.flowLayout?.caption,
      } : { group, nodes: nodes.map((instance, index) => {
        const definition = project.definitions[instance.definitionId]
        const parent = parents.get(instance.id), parentPresentation = parent && presentations.get(parent.id)
        const placement = index === 0 || parent?.container?.kind === 'flow' ? 'flow'
          : parent?.container ? 'free' : parentPresentation?.childrenPlacement ?? 'free'
        const presentation = resolveComponentOuterPresentation(project, instance, { placement, purpose: 'author', inlineSize: width,
          flowLayout: parent?.container?.flow?.layout ?? layout })
        presentations.set(instance.id, presentation)
        const inlineIds = new Set(allDocumentTextSlots(instance.data).flatMap(slot => inlineComponentIds(slot.content)))
        for (const data of inlineVersions[index] || []) for (const slot of allDocumentTextSlots(data))
          for (const childId of inlineComponentIds(slot.content)) if (!project.instances[childId]?.frame && !project.instances[childId]?.flowPlacement) inlineIds.add(childId)
        return { id: instance.id, role: definition?.role, visible: instance.visible, visibility: instance.visibility, locked: instance.locked,
          presentation, caption: index === 0 && !group ? instance.flowLayout?.caption : undefined,
          paint: componentPaintStyle(instance, definition), children: instance.childIds?.filter(id => !inlineIds.has(id)), container: instance.container,
          ...(componentDefinitionBuiltinKey(definition) === 'guoling.image' ? { imageGuides: instance.data } : {}) }
      }) }
      const same = previous && equalComponentValue(previous.output, output)
      entries.set(id, { token: same ? previous.token : ++token, input, output })
      if (!same) changed = true
    }
    if (changed) result = snapshot()
    return result
  }
}
