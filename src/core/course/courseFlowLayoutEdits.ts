import { componentDefinitionBuiltinKey, componentIsLocked, containerChildIds, owningContainer,
  type ComponentContainer, type ComponentInstance, type CourseProjectV10 } from '../../shared/contracts/component-platform/project'
import type { ComponentEdit } from '../../shared/contracts/component-platform/operations'
import { isNativeFlowLayoutGroup } from '../../shared/flowNativeLayout'
import { TEXT_DEFINITION } from '../../components/text/adapters'
import { createTextComponentData } from '../../components/text/data'

export interface CourseFlowColumnsInput {
  surfaceId: string
  instanceIds: readonly string[]
  /** Explicit column membership and reading order; every selected instance occurs once. */
  columns?: readonly (readonly string[])[]
  ratios?: readonly number[]
  gap?: number
}

/** Prepare ordinary reading columns in the one author tree; the caller owns the transaction. */
export function prepareCourseFlowColumns(project: CourseProjectV10, input: CourseFlowColumnsInput,
  createId: () => string = () => crypto.randomUUID()): { edits: ComponentEdit[]; groupId: string; columnIds: string[] } {
  const surface = project.instances[input.surfaceId]
  if (surface?.container?.kind !== 'flow') throw new Error('请先选择讲义正文')
  const selected = new Set(input.instanceIds)
  if (!selected.size || selected.size !== input.instanceIds.length) throw new Error('请选择不同的正文对象')
  const first = project.instances[input.instanceIds[0]], owner = first && owningContainer(project, first.id)
  const ownerId = owner?.kind === 'instance' ? owner.instanceId : owner?.kind === 'surface' ? owner.surfaceId : null
  if (!ownerId) throw new Error('请选择同一阅读范围内的正文对象')
  let ancestor: ComponentInstance | undefined = project.instances[ownerId]
  while (ancestor && ancestor.id !== input.surfaceId) {
    const definition = project.definitions[ancestor.definitionId]
    const section = !ancestor.implementationOverride && componentDefinitionBuiltinKey(definition) === 'guoling.document-block'
      && (ancestor.data as Record<string, unknown>)?.type === 'section'
    if (ancestor.container || ancestor.flowPlacement || !section && !isNativeFlowLayoutGroup(ancestor, definition))
      throw new Error('程序或自由区域的内部对象请在其编辑范围内修改')
    const parent = owningContainer(project, ancestor.id)
    ancestor = parent?.kind === 'instance' ? project.instances[parent.instanceId] : undefined
  }
  if (!ancestor || ancestor.id !== input.surfaceId) throw new Error('所选对象不在当前讲义正文')
  const siblings = containerChildIds(project, owner as ComponentContainer)
  for (const id of selected) {
    const instance = project.instances[id]
    if (!instance || !siblings.includes(id) || instance.flowPlacement || project.definitions[instance.definitionId]?.role === 'behavior')
      throw new Error('请选择同一阅读范围内的正文对象')
    if (componentIsLocked(project, id)) throw new Error('对象已锁定，请先解锁')
  }
  if (componentIsLocked(project, ownerId)) throw new Error('对象已锁定，请先解锁')
  const ordered = siblings.filter(id => selected.has(id))
  const columns = input.columns?.map(ids => [...ids]) ?? (ordered.length === 2 ? [[ordered[0]], [ordered[1]]] : [ordered, []])
  if (columns.length < 2) throw new Error('阅读分栏至少需要两列')
  const assigned = columns.flat()
  if (assigned.length !== selected.size || new Set(assigned).size !== selected.size || assigned.some(id => !selected.has(id)))
    throw new Error('每个所选对象必须且只能分配到一列')
  const ratios = input.ratios ?? columns.map(() => 1)
  if (ratios.length !== columns.length || ratios.some(value => !Number.isFinite(value) || value <= 0)) throw new Error('每列比例必须为正数')
  const gap = input.gap ?? 24
  if (!Number.isFinite(gap) || gap < 0) throw new Error('列间距不能为负数')
  const definition = Object.values(project.definitions).find(value => value.implementation.kind === 'builtin' && value.implementation.key === 'guoling.group')
    ?? { id: project.definitions['guoling.group'] ? createId() : 'guoling.group', role: 'mixed' as const, title: '组合', implementation: { kind: 'builtin' as const, key: 'guoling.group' } }
  const textDefinition = Object.values(project.definitions).find(value => value.implementation.kind === 'builtin' && value.implementation.key === 'guoling.text')
    ?? { ...TEXT_DEFINITION, id: project.definitions[TEXT_DEFINITION.id] ? createId() : TEXT_DEFINITION.id }
  const edits: ComponentEdit[] = []
  if (!project.definitions[definition.id]) edits.push({ type: 'definition.set', definition })
  const groupId = createId(), columnIds = columns.map(() => createId()), instances: ComponentInstance[] = [
    { id: groupId, definitionId: definition.id, name: '阅读分栏', data: {}, childIds: columnIds,
      style: { display: 'grid', gridTemplateColumns: ratios.map(value => `minmax(0, ${value}fr)`).join(' '), gap, alignItems: 'start' } },
  ]
  columns.forEach((members, index) => {
    const emptyId = members.length ? null : createId()
    instances.push({ id: columnIds[index], definitionId: definition.id, name: `第${index + 1}列`, data: {}, childIds: emptyId ? [emptyId] : [],
      style: { display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0, minHeight: 28 } })
    if (emptyId) instances.push({ id: emptyId, definitionId: textDefinition.id, data: JSON.parse(JSON.stringify(createTextComponentData())) })
  })
  if (instances.some(value => value.definitionId === textDefinition.id) && !project.definitions[textDefinition.id]) edits.push({ type: 'definition.set', definition: textDefinition })
  edits.push({ type: 'instance.insert', container: owner as ComponentContainer, index: siblings.indexOf(ordered[0]), instances, rootIds: [groupId] })
  columns.forEach((members, index) => members.forEach((id, position) => edits.push({ type: 'instance.move', instanceId: id,
    container: { kind: 'instance', instanceId: columnIds[index] }, index: position,
    ...(project.instances[id].frame ? { frame: project.instances[id].frame } : {}) })))
  return { edits, groupId, columnIds }
}
