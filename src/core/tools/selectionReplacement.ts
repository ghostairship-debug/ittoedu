import { z } from 'zod'
import type { AuthoringToolTargetWireV1 } from '../../shared/authoringToolContract'
import type { CourseProjectDocument, LayerItem, LayerItemOverride } from '../../shared/courseProjectTypes'
import type { InteractionRule } from '../../shared/interactionTypes'
import { commitCourseProjectMutation } from './courseProjectMutation'
import { resolveEffectiveLayerTarget, makeEffectiveLayerAuthoringAddress } from './layerCommands'
import { locateCourseLayer } from '../drivers/course/layerProperties'
import { carrierForFlowBlock, findFlowBlockRecursive, makeFlowBlockAuthoringAddress, syncFlowCourseLocations } from './flowDocumentModel'
import { AuthoringToolFailure } from './AuthoringToolFailure'
import { collectCourseProjectReferences } from '../../shared/contracts/course-project-v9/references'
import { materializeCourseSlideLayerItems } from '../../shared/courseLayerComposition'
export const selectionReplacementSchema = z.object({ replacementItemId: z.string().min(1) }).strict()
const incompatible = (message: string, path: (string | number)[] = []) => { throw new AuthoringToolFailure([{ code: 'replacement-unmappable', message, path }]) }

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

/** A named-state shape can change carrier without changing its inherited base
 * or the other states. The existing two carriers and overrides express this;
 * only references whose state domain is explicit may be redirected. */
function replaceInheritedShapeInState(document: CourseProjectDocument, target: AuthoringToolTargetWireV1, before: LayerItem, after: LayerItem) {
  if (before.kind !== 'native' || before.content.nativeType !== 'shape' || after.kind !== 'native' || after.content.nativeType !== 'image') {
    incompatible('此对象继承自基础状态或被其他状态使用；该载体转换无法仅修改当前状态，请窄编辑或显式选择基础状态进行完整替换')
  }
  const surfaceIndex = document.surfaces.findIndex(surface => surface.id === target.surfaceId), surface = document.surfaces[surfaceIndex]!
  if (surface.type !== 'slide' || target.owner !== 'scene') incompatible('命名状态局部换图只适用于 Slide scene 对象')
  if (surface.type !== 'slide') throw new Error('Slide target')
  const sceneIndex = surface.scenes.findIndex(scene => scene.layerItems.some(item => item.layerItemId === before.layerItemId)), scene = surface.scenes[sceneIndex]!
  const state = scene.presentation?.states.find(state => state.id === target.stateId)
  if (!state) incompatible('当前呈现状态已失效')
  const currentState = state!
  const relevantRules = new Set<number>()
  for (const reference of collectCourseProjectReferences(document)) {
    if (reference.kind !== 'layer-item' || reference.id !== before.layerItemId) continue
    const path = reference.path
    if (path[0] === 'surfaces' && path[1] === surfaceIndex && path[2] === 'scenes' && path[3] === sceneIndex) {
      if (path[4] === 'presentation') continue // Other state overrides continue to address the old carrier.
      if (path[4] === 'interactions' && typeof path[5] === 'number') { relevantRules.add(path[5]); continue }
    }
    incompatible('此引用没有当前呈现状态的独立绑定，局部换图无法保留其他状态行为', [...path])
  }
  const additions: InteractionRule[] = []
  for (const index of relevantRules) {
    const rule = scene.interactions[index]!, conditions = rule.conditions.filter(condition => condition.type === 'presentation.in')
    if (!conditions.length) incompatible('无呈现状态范围的交互引用无法只重绑当前状态', ['interactions', index, 'conditions'])
    if (conditions.some(condition => !condition.stateIds.includes(currentState.id))) continue
    if (conditions.some(condition => condition.stateIds.length === 1)) {
      migrateRules([rule], before, after, ['interactions', index]); continue
    }
    const actionIds = new Set(rule.actions.map(action => action.id))
    if ([...scene.interactions, ...document.globalInteractions].some(entry => entry.trigger.type === 'animation.completed' && actionIds.has(entry.trigger.actionId))) {
      incompatible('动画完成引用跨越多个呈现状态，局部换图需要先拆分这条状态链', ['interactions', index])
    }
    const copy = structuredClone(rule)
    copy.id = `replacement-${crypto.randomUUID()}`
    copy.actions.forEach(action => { action.id = `replacement-${crypto.randomUUID()}` })
    copy.conditions = [...copy.conditions.filter(condition => condition.type !== 'presentation.in'), { type: 'presentation.in', stateIds: [currentState.id] }]
    migrateRules([copy], before, after, ['interactions', index])
    // Each state condition included the current state and at least one other;
    // removing it from one ANDed condition preserves their original intersection.
    conditions[0]!.stateIds = conditions[0]!.stateIds.filter(id => id !== currentState.id)
    additions.push(copy)
  }
  scene.interactions.push(...additions)
  const effective = materializeCourseSlideLayerItems(scene.layerItems, currentState).find(item => item.layerItemId === before.layerItemId)!
  if (effective.locked) incompatible('当前呈现状态中的对象已锁定')
  const fields = ['label', 'frame', 'rotation', 'opacity', 'locked', 'hitPolicy', 'playbackInitialVisibility', 'paperSpace'] as const
  for (const key of fields) {
    if (Object.hasOwn(effective, key)) Object.assign(after, { [key]: structuredClone(Reflect.get(effective, key)) })
    else Reflect.deleteProperty(after, key)
  }
  after.visible = false
  currentState.layerItemOverrides[before.layerItemId] = { ...currentState.layerItemOverrides[before.layerItemId], visible: false }
  currentState.layerItemOverrides[after.layerItemId] = { ...currentState.layerItemOverrides[after.layerItemId], visible: effective.visible }
  const ids = materializeCourseSlideLayerItems(scene.layerItems, currentState).filter(item => item.layerItemId !== after.layerItemId).map(item => item.layerItemId)
  ids.splice(ids.indexOf(before.layerItemId), 0, after.layerItemId)
  currentState.layerItemOrder = ids
}

/** Shared replacement planner. The caller freezes and validates the canonical target authority. */
export function planSelectionReplacement(document: CourseProjectDocument, target: AuthoringToolTargetWireV1, replacementItemId: string) {
  const surface = document.surfaces.find(surface => surface.id === target.surfaceId)
  if (!surface || document.id !== target.projectId || document.revision !== target.documentRevision) throw new Error('替换目标工程、表面或 revision 已失效')
    if (replacementItemId === target.itemId) throw new Error('替换对象必须来自新的创建回执')
    const body = surface.type === 'flow' && target.owner === 'surface' ? findFlowBlockRecursive(surface.blocks, target.itemId) : null
    let address: string
    let retainedOriginal = false
    const nextDocument = commitCourseProjectMutation(document, draft => {
      if (body && surface.type === 'flow') {
        if (target.authoringAddress !== makeFlowBlockAuthoringAddress({ projectId: document.id, surfaceId: surface.id, blockId: body.block.id, carrier: carrierForFlowBlock(body.block) })) throw new Error('正文替换目标身份不匹配')
        const draftSurface = draft.surfaces.find(entry => entry.id === surface.id)!
        if (draftSurface.type !== 'flow') throw new Error('正文表面已失效')
        const old = findFlowBlockRecursive(draftSurface.blocks, body.block.id)!, replacement = findFlowBlockRecursive(draftSurface.blocks, replacementItemId)
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
      const old = resolveEffectiveLayerTarget(draft, target), replacement = locateCourseLayer(draft, replacementItemId)
      if (old.source !== target.owner || old.item.layerItemId !== target.itemId || !replacement || replacement.source !== old.source || replacement.surfaceId !== old.surfaceId || replacement.sceneId !== old.sceneId) throw new Error('替换对象必须来自原对象同一 owner、表面和场景')
      if (old.item.locked) throw new Error('图层已锁定，不能替换')

      if (target.stateId !== null && old.source === 'scene') {
        const scene = surface.type === 'slide' ? surface.scenes.find(entry => entry.id === old.sceneId) : null
        const selected = scene?.presentation?.states.find(entry => entry.id === target.stateId)
        const exclusivelyStateOwned = old.item.visible === false && selected?.layerItemOverrides[old.item.layerItemId]?.visible === true
          && scene?.presentation?.states.every(state => state.id === target.stateId || state.layerItemOverrides[old.item.layerItemId]?.visible !== true)
        if (!exclusivelyStateOwned) {
          replaceInheritedShapeInState(draft, target, old.item, replacement.item)
          retainedOriginal = true
          address = makeEffectiveLayerAuthoringAddress(draft.id, { ...old, item: replacement.item })
          return
        }
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
      address = makeEffectiveLayerAuthoringAddress(draft.id, { ...old, item: replacement.item })
    })
  return { nextDocument, address: address!, retainedOriginal, flowBody: Boolean(body) }
}
