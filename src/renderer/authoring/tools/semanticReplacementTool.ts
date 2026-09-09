import { z } from 'zod'
import type { AuthoringToolDestinationV1, AuthoringToolTargetWireV1 } from '../../../shared/authoringToolContract'
import type { CourseProjectDocument, LayerItem, LayerItemOverride } from '../../../shared/courseProjectTypes'
import type { InteractionRule } from '../../../shared/interactionTypes'
import { commitCourseProjectMutation } from '../../course/courseProjectMutation'
import { locateCourseLayer, resolveEffectiveLayerTarget } from '../../course/effectiveLayerCommands'
import { projectEffectiveLayers } from '../../course/effectiveLayerProjection'
import { carrierForFlowBlock, findFlowBlockRecursive, makeFlowBlockAuthoringAddress, syncFlowCourseLocations } from '../../course/flowDocumentModel'
import { makeLayerItemAuthoringAddress } from '../courseAuthoringScope'
import { resolveAuthoringToolScope } from './authoringToolScope'
import { AuthoringToolFailure, type AuthoringToolDefinition } from './executeAuthoringTool'

const schema = z.object({ replacementItemId: z.string().min(1) }).strict()
const incompatible = (message: string, path: (string | number)[] = []) => { throw new AuthoringToolFailure([{ code: 'replacement-unmappable', message, path }]) }

/** Additional scopes belong only to the selected target's replacement dependency chain. */
export function captureSelectionReplacementScopes(document: CourseProjectDocument, targets: readonly AuthoringToolTargetWireV1[]): AuthoringToolDestinationV1[] {
  const result: AuthoringToolDestinationV1[] = []
  for (const target of targets) {
    const surface = document.surfaces.find(value => value.id === target.surfaceId)
    const body = surface?.type === 'flow' && target.owner === 'surface' ? findFlowBlockRecursive(surface.blocks, target.itemId) : null
    if (!body && !locateCourseLayer(document, target.itemId)) continue
    const { itemId: _itemId, authoringAddress: _address, ...scope } = target
    result.push({ kind: 'create', scope: { ...scope, parent: body ? { kind: 'flow-body', parentBlockId: body.parentId } : { kind: 'owner' }, insertion: { kind: 'append' } } })
    const global = projectEffectiveLayers({ project: document, locationId: target.locationId, owner: 'global' }).scope
    result.push({ kind: 'create', scope: { ...scope, stateId: null, owner: 'global', ownerKey: global.ownerKey, parent: { kind: 'owner' }, insertion: { kind: 'append' } } })
  }
  return [...new Map(result.map(destination => [JSON.stringify(destination), destination])).values()]
}

function migrateOverride(override: LayerItemOverride, before: LayerItem, after: LayerItem, path: (string | number)[]) {
  if (override.nativeData && (before.kind !== 'native' || after.kind !== 'native' || before.content.nativeType !== after.content.nativeType)) incompatible('呈现状态的 Native 内容覆盖不能映射到新载体', [...path, 'nativeData'])
  if (override.componentProps && (before.kind !== 'component' || after.kind !== 'component' || before.component.packageId !== after.component.packageId)) incompatible('呈现状态的组件参数不能映射到不同组件包', [...path, 'componentProps'])
}

function migrateRules(rules: InteractionRule[], before: LayerItem, after: LayerItem, path: (string | number)[], runtimeScope?: 'scene' | 'global') {
  const oldId = before.layerItemId, newId = after.layerItemId
  const nodeReference = (value: { type: string; nodeId?: string }, entryPath: (string | number)[]) => {
    if (value.nodeId !== oldId) return
    if (value.type === 'component.event' && (before.kind !== 'component' || after.kind !== 'component' || before.component.packageId !== after.component.packageId)) incompatible('组件事件需要相同组件包，无法保留该引用', entryPath)
    if (value.type === 'input.submit' && (after.kind !== 'native' || after.content.nativeType !== 'input')) incompatible('输入提交事件不能映射到非输入对象', entryPath)
    if (value.type.startsWith('video.') && (after.kind !== 'native' || after.content.nativeType !== 'video')) incompatible('视频交互不能映射到非视频对象', entryPath)
    value.nodeId = newId
  }
  rules.forEach((rule, index) => {
    if (before.kind === 'runtime' && after.kind !== 'runtime' && rule.trigger.type === 'runtime.event' && rule.trigger.scope === runtimeScope) incompatible('Runtime 事件依赖不能映射到新载体', [...path, index, 'trigger'])
    nodeReference(rule.trigger, [...path, index, 'trigger'])
    rule.actions.forEach((step, actionIndex) => nodeReference(step.action, [...path, index, 'actions', actionIndex]))
  })
}

function migrateLayerReferences(document: CourseProjectDocument, before: LayerItem, after: LayerItem) {
  const oldId = before.layerItemId, newId = after.layerItemId
  const source = locateCourseLayer(document, oldId)!
  const replace = (ids: string[]) => ids.map(id => id === oldId ? newId : id)
  const runtimeBindings = (item: LayerItem) => {
    if (item.kind === 'runtime' && item.runtime.nodeBindings) for (const [key, value] of Object.entries(item.runtime.nodeBindings)) if (value === oldId) item.runtime.nodeBindings[key] = newId
  }
  document.globalLayerItems.forEach(entry => runtimeBindings(entry.item))
  migrateRules(document.globalInteractions, before, after, ['globalInteractions'], source.source === 'global' ? 'global' : undefined)
  document.surfaces.forEach((surface, surfaceIndex) => {
    surface.surfaceLayerItems.forEach(entry => runtimeBindings(entry.item))
    if (surface.type === 'slide') surface.scenes.forEach((scene, sceneIndex) => {
      scene.layerItems.forEach(runtimeBindings)
      migrateRules(scene.interactions, before, after, ['surfaces', surfaceIndex, 'scenes', sceneIndex, 'interactions'], source.source === 'global' ? 'global' : source.sceneId === scene.id ? 'scene' : undefined)
      scene.presentation?.states.forEach((state, stateIndex) => {
        const override = state.layerItemOverrides[oldId]
        if (override) {
          migrateOverride(override, before, after, ['surfaces', surfaceIndex, 'scenes', sceneIndex, 'presentation', 'states', stateIndex])
          state.layerItemOverrides[newId] = { ...state.layerItemOverrides[newId], ...override }
          delete state.layerItemOverrides[oldId]
        }
        if (state.layerItemOrder) state.layerItemOrder = [...new Set(replace(state.layerItemOrder))]
      })
    })
    if (surface.type === 'spatial-2d') {
      surface.world.layerItems.forEach(runtimeBindings)
      surface.world.paths?.forEach(entry => { entry.layerItemIds = replace(entry.layerItemIds) })
      surface.world.relations?.forEach(entry => { if (entry.sourceLayerItemId === oldId) entry.sourceLayerItemId = newId; if (entry.targetLayerItemId === oldId) entry.targetLayerItemId = newId })
      surface.semanticZoom.forEach(entry => { entry.layerItemIds = replace(entry.layerItemIds) })
    }
  })
}

export const semanticReplacementTool: AuthoringToolDefinition<z.infer<typeof schema>> = {
  name: 'selection.replace', inputSchema: schema,
  description: '完整替换精确选中对象。先在附带 create scope 创建新对象和所需资源，再以 replacementItemId 引用前序创建步骤的 item-id。宿主保留原位置、层级、可见性、旋转和可映射引用；不兼容引用明确失败。所有步骤先私有准备，最终一次提交。修改文字、字号或参数优先使用 edit/component.configure。',
  plan({ document, destination, value }) {
    if (destination.kind !== 'update') throw new Error('完整替换需要原对象的精确 update target')
    const { target, surface, scope } = resolveAuthoringToolScope(document, destination)
    if (value.replacementItemId === destination.target.itemId) throw new Error('替换对象必须来自新的创建回执')
    const body = surface.type === 'flow' && target.owner === 'surface' ? findFlowBlockRecursive(surface.blocks, destination.target.itemId) : null
    let address: string
    const nextDocument = commitCourseProjectMutation(document, draft => {
      if (body && surface.type === 'flow') {
        if (destination.target.authoringAddress !== makeFlowBlockAuthoringAddress({ projectId: document.id, surfaceId: surface.id, blockId: body.block.id, carrier: carrierForFlowBlock(body.block) })) throw new Error('正文替换目标身份不匹配')
        const draftSurface = draft.surfaces.find(entry => entry.id === surface.id)!
        if (draftSurface.type !== 'flow') throw new Error('正文表面已失效')
        const old = findFlowBlockRecursive(draftSurface.blocks, body.block.id)!, replacement = findFlowBlockRecursive(draftSurface.blocks, value.replacementItemId)
        if (!replacement || replacement.parentId !== old.parentId) throw new Error('替换正文必须来自同一父分节')
        if (old.block.type === 'section' && old.block.blocks.length) incompatible('含子块的分节替换需要逐项明确迁移，不能静默丢弃子块')
        const locations = draft.locations.filter(entry => entry.kind === 'flow-block' && entry.blockId === old.block.id)
        if (locations.length && replacement.block.type !== 'heading' && replacement.block.type !== 'section') incompatible('正文导航锚点只能替换为标题或分节，无法映射到普通正文块')
        for (const key of ['wrap', 'textAlign', 'lineSpacing'] as const) {
          const compatible = key === 'wrap' ? replacement.block.type === 'media' || replacement.block.type === 'component' : ['heading', 'paragraph', 'quote'].includes(replacement.block.type)
          if (key in old.block && compatible) Object.assign(replacement.block, { [key]: Reflect.get(old.block, key) })
        }
        const newBlock = replacement.block
        old.blocks.splice(replacement.index, 1)
        const index = old.blocks.findIndex(entry => entry.id === old.block.id)
        old.blocks.splice(index, 1, newBlock)
        // Location identity remains stable; only its typed anchor is remapped.
        if (locations.length) draft.locations = draft.locations.filter(entry => !(entry.kind === 'flow-block' && entry.blockId === newBlock.id && !locations.includes(entry)))
        for (const entry of locations) if (entry.kind === 'flow-block') entry.blockId = newBlock.id
        syncFlowCourseLocations(draft, surface.id)
        address = makeFlowBlockAuthoringAddress({ projectId: draft.id, surfaceId: surface.id, blockId: newBlock.id, carrier: carrierForFlowBlock(newBlock) })
        return
      }
      const old = resolveEffectiveLayerTarget(draft, destination.target), replacement = locateCourseLayer(draft, value.replacementItemId)
      if (old.source !== scope.owner || old.item.layerItemId !== destination.target.itemId || !replacement || replacement.source !== old.source || replacement.surfaceId !== old.surfaceId || replacement.sceneId !== old.sceneId) throw new Error('替换对象必须来自原对象同一 owner、表面和场景')
      if (old.item.locked) throw new Error('图层已锁定，不能替换')
      if (old.item.kind === 'native' && old.item.content.nativeType === 'teacher-controller') incompatible('教师控制器具有独立宿主身份，不能通过普通对象替换')
      if (target.stateId !== null) {
        const scene = surface.type === 'slide' ? surface.scenes.find(entry => entry.id === old.sceneId) : null
        const selected = scene?.presentation?.states.find(entry => entry.id === target.stateId)
        const exclusivelyStateOwned = old.item.visible === false && selected?.layerItemOverrides[old.item.layerItemId]?.visible === true
          && scene?.presentation?.states.every(state => state.id === target.stateId || state.layerItemOverrides[old.item.layerItemId]?.visible !== true)
        if (!exclusivelyStateOwned) incompatible('此对象继承自基础状态或被其他状态使用；局部替换无法无损迁移跨状态引用，请窄编辑或显式选择基础状态进行完整替换')
      }
      const { kind: _kind, layerItemId: _id, ...base } = old.item
      const wrapper = Object.fromEntries(Object.entries(base).filter(([key]) => ['label', 'frame', 'order', 'visible', 'locked', 'rotation', 'opacity', 'hitPolicy', 'playbackInitialVisibility', 'paperSpace'].includes(key)))
      Object.assign(replacement.item, structuredClone(wrapper))
      if (!('paperSpace' in old.item)) delete replacement.item.paperSpace
      migrateLayerReferences(draft, old.item, replacement.item)
      const replaceScoped = (entries: typeof draft.globalLayerItems) => {
        const oldIndex = entries.findIndex(entry => entry.item.layerItemId === old.item.layerItemId)
        const replacementIndex = entries.findIndex(entry => entry.item.layerItemId === replacement.item.layerItemId)
        const oldEntry = entries[oldIndex]!, newItem = replacement.item
        entries.splice(replacementIndex, 1)
        entries.splice(entries.indexOf(oldEntry), 1, { ...oldEntry, item: newItem })
      }
      if (old.source === 'global') replaceScoped(draft.globalLayerItems)
      else {
        const ownerSurface = draft.surfaces.find(entry => entry.id === old.surfaceId)!
        if (old.source === 'surface') replaceScoped(ownerSurface.surfaceLayerItems)
        else {
          const items = ownerSurface.type === 'slide' ? ownerSurface.scenes.find(scene => scene.id === old.sceneId)!.layerItems : ownerSurface.type === 'spatial-2d' ? ownerSurface.world.layerItems : null
          if (!items) throw new Error('替换 owner 已失效')
          items.splice(items.indexOf(replacement.item), 1)
          items.splice(items.indexOf(old.item), 1, replacement.item)
        }
      }
      address = makeLayerItemAuthoringAddress({ projectId: draft.id, owner: old.source, surfaceId: surface.id, sceneId: old.sceneId, kind: replacement.item.kind, layerItemId: replacement.item.layerItemId })
    })
    return { transaction: { projectId: document.id, baseRevision: document.revision, nextDocument, resourceChanges: {},
      selectionHint: { kind: 'authoring-tool-selection', locationId: target.locationId, stateId: target.stateId, owner: target.owner, itemIds: [value.replacementItemId], ...(surface.type === 'flow' ? { flowCarrier: body ? 'block' : 'overlay' } : {}) } },
      affected: [{ id: destination.target.itemId, operation: 'deleted', ownerKey: target.ownerKey, authoringAddress: destination.target.authoringAddress },
        { id: value.replacementItemId, operation: 'updated', ownerKey: target.ownerKey, authoringAddress: address! }] }
  },
}
