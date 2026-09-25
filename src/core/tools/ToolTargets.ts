import { sha256 } from '@noble/hashes/sha256'
import { listCourseSoundReferences } from './courseAudio'
import { spatialSurfaceIn } from './spatialInsertion'
import { spatialPathIn } from './spatialPath'
import { spatialRelationIn } from './spatialRelation'
import { stateToolContext, stateChildren } from './presentationStateTools'
import { layerToolContext } from './layerEditing'
import { locateRule, locateSceneInteractions } from './slideInteractions'
import { composeCourseProjectLocation } from '../../shared/courseLayerComposition'
import type { DocumentModel } from '../../shared/workbench/document'
import type { ToolTarget } from '../../shared/workbench/tools'
import { locateCourseLayer } from '../drivers/course/layerProperties'
import { resolveNativeOwner } from './nativeOwner'
import { documentDigest } from '../documents/documentDigest'
import { resolveEffectiveBackground } from '../../shared/effectiveBackground'
import { flowSurfaceIn, resolveFlowBlock, sliceFlowRichText, flowBlockLabel } from './flowDocumentModel'
import { flowBlocksAtParent, validateFlowInsertIndex } from './flowContent'
import { flowTextSlot } from './flowTextSlot'
import { documentTextLength } from '../../shared/document/content'

export function containsTarget(allowed: ToolTarget, target: ToolTarget): boolean {
  if (allowed.kind === 'document') return true
  if (allowed.kind === 'course-audio' && target.kind === 'course-sound') return true
  if (allowed.kind === 'course-surface' && target.kind === 'course-background') return target.owner !== 'course' && allowed.surfaceId === target.surfaceId
  if (allowed.kind === 'course-owner' && allowed.owner === 'scene' && !allowed.stateId && target.kind === 'course-state') return allowed.locationId === target.locationId
  if (allowed.kind === 'course-owner' && allowed.owner === 'scene' && target.kind === 'course-interaction') return allowed.locationId === target.locationId && allowed.stateId === target.stateId
  if (allowed.kind === 'course-location' && (target.kind === 'course-object' || target.kind === 'course-interaction')) return allowed.locationId === target.locationId
  if (allowed.kind === 'markdown-range' && target.kind === 'markdown-range') return target.from >= allowed.from && target.to <= allowed.to
  if (allowed.kind === 'flow-container' && allowed.index !== undefined) return documentDigest(allowed) === documentDigest(target)
  if (allowed.kind === 'flow-container' && (target.kind === 'flow-block' || target.kind === 'flow-range' || target.kind === 'flow-container')) return allowed.surfaceId === target.surfaceId && (allowed.parentId === null || allowed.parentId === target.parentId)
  if (allowed.kind === 'flow-block' && target.kind === 'flow-range') return allowed.surfaceId === target.surfaceId && allowed.blockId === target.blockId && allowed.parentId === target.parentId
  if (allowed.kind === 'flow-range' && target.kind === 'flow-range') return allowed.surfaceId === target.surfaceId && allowed.blockId === target.blockId && allowed.parentId === target.parentId && documentDigest(allowed.slot) === documentDigest(target.slot) && target.from >= allowed.from && target.to <= allowed.to
  return documentDigest(allowed) === documentDigest(target)
}

export function backgroundOwner(model: DocumentModel, target: Extract<ToolTarget, { kind: 'course-background' }>) {
  if (model.kind !== 'course-v9') throw new Error('背景目标需要 V9 文档')
  const course = model.project
  if (target.owner === 'course') {
    if (target.surfaceId || target.sceneId || target.stateId) throw new Error('课程背景不能包含页面坐标')
    return { fields: course, effective: resolveEffectiveBackground({ owner: 'course', course }) }
  }
  const surface = course.surfaces.find(value => value.id === target.surfaceId)
  if (!surface) throw new Error('背景 Surface 不存在')
  if (surface.type !== 'slide') {
    if (target.owner !== 'surface' || target.sceneId || target.stateId) throw new Error('Flow/Spatial 背景必须属于 Surface')
    return { fields: surface, effective: resolveEffectiveBackground({ owner: surface.type === 'flow' ? 'flow-surface' : 'spatial-surface', course, surface }) }
  }
  if (target.owner === 'surface') {
    if (target.sceneId || target.stateId) throw new Error('Surface 背景不能包含场景坐标')
    return { fields: surface, effective: resolveEffectiveBackground({ owner: 'slide-surface', course, surface }) }
  }
  const scene = surface.scenes.find(value => value.id === target.sceneId)
  if (!scene) throw new Error('背景场景不存在')
  if (target.stateId) {
    const state = scene.presentation?.states.find(value => value.id === target.stateId)
    if (!state) throw new Error('背景命名态不存在')
    return { fields: state, effective: resolveEffectiveBackground({ owner: 'slide-state', course, surface, scene, state }) }
  }
  return { fields: scene, effective: resolveEffectiveBackground({ owner: 'slide-scene', course, surface, scene }) }
}

export function readTarget(model: DocumentModel, target: ToolTarget): unknown {
  if (target.kind === 'document') return model.kind === 'markdown' ? model.source : { title: model.project.title, locations: model.project.locations.map(value => ({ id: value.id, kind: value.kind })) }
  if (target.kind === 'markdown-range') {
    if (model.kind !== 'markdown' || !Number.isSafeInteger(target.from) || !Number.isSafeInteger(target.to) || target.from < 0 || target.to < target.from || target.to > model.source.length) throw new Error('正文范围无效')
    return model.source.slice(target.from, target.to)
  }
  if (model.kind !== 'course-v9') throw new Error('目标需要 V9 文档')
  if (target.kind === 'flow-container') {
    const blocks = flowBlocksAtParent(flowSurfaceIn(model.project, target.surfaceId).blocks, target.parentId)
    validateFlowInsertIndex(target.index ?? blocks.length, blocks.length)
    return { surfaceId: target.surfaceId, parentId: target.parentId, index: target.index, children: blocks.map(block => block.id) }
  }
  if (target.kind === 'flow-block' || target.kind === 'flow-range') {
    const { block, parentId } = resolveFlowBlock(model.project, target)
    if (target.kind === 'flow-block') return { block, parentId }
    const content = flowTextSlot(block, target.slot).get()
    if (!Number.isSafeInteger(target.from) || !Number.isSafeInteger(target.to) || target.from < 0 || target.from > target.to || target.to > documentTextLength(content)) throw new Error('正文范围已失效')
    return { content: sliceFlowRichText(content, target.from, target.to), parentId }
  }
  if (target.kind === 'course-state') {
    const { surface, scene, state } = stateToolContext(model.project, target)
    return { surfaceId: surface.id, sceneId: scene.id, locationId: target.locationId, state }
  }
  if (target.kind === 'course-owner') {
    const { location, surface, items, center } = resolveNativeOwner(model.project, target)
    const scene = surface.type === 'slide' && location.kind === 'slide-scene' ? surface.scenes.find(scene => scene.id === location.sceneId) : undefined
    return { location, owner: target.owner, stateId: target.stateId, center, children: items.map(item => item.layerItemId), ...(target.owner === 'scene' ? { interactions: scene?.interactions } : {}) }
  }
  if (target.kind === 'course-audio') return model.project.media.audio
  if (target.kind === 'course-sound') {
    const sound = model.project.media.audio.sounds[target.soundId]
    if (!sound) throw new Error('声音不存在')
    return { sound, asset: model.project.assets[sound.assetId], references: listCourseSoundReferences(model.project, target.soundId) }
  }
  if (target.kind === 'course-asset') {
    const asset = model.project.assets[target.assetId]
    if (!asset) throw new Error('素材不存在')
    return asset
  }
  if (target.kind === 'spatial-graph') {
    const surface = spatialSurfaceIn(model.project, target.surfaceId)
    return { surfaceId: surface.id, graph: target.graph, entity: target.graph === 'path' ? spatialPathIn(surface, target.graphId) : spatialRelationIn(surface, target.graphId) }
  }
  if (target.kind === 'course-surface') {
    const surface = model.project.surfaces.find(surface => surface.id === target.surfaceId)
    if (!surface) throw new Error('表面不存在')
    return { surface, locations: model.project.locations.filter(location => location.surfaceId === surface.id) }
  }
  if (target.kind === 'course-location') {
    const location = model.project.locations.find(value => value.id === target.locationId)
    if (!location) throw new Error('页面不存在')
    return location
  }
  if (target.kind === 'course-interaction') {
    const rule = locateRule(model.project, { scope: 'scene', locationId: target.locationId }, target.ruleId)
    if (!rule) throw new Error('互动规则不存在或已移出指定场景')
    resolveNativeOwner(model.project, { kind: 'course-owner', owner: 'scene', locationId: target.locationId, stateId: target.stateId })
    return { locationId: target.locationId, rule }
  }
  if (target.kind === 'course-object') {
    const location = model.project.locations.find(value => value.id === target.locationId)
    const layer = locateCourseLayer(model.project, target.itemId)
    if (!location || !layer || layer.source !== 'global' && (layer.surfaceId !== location.surfaceId || layer.source === 'scene' && (location.kind !== 'slide-scene' || layer.sceneId !== location.sceneId))) throw new Error('对象不属于指定页面')
    // Include owner and location, not merely the item's content: a move cannot silently rebind a handle.
    const context = target.stateId ? layerToolContext(model.project, target) : null
    return { item: context?.entry.item ?? layer.item, ...(context ? { base: layer.item, stateId: target.stateId } : {}), owner: { source: layer.source, surfaceId: layer.surfaceId, sceneId: layer.sceneId, scoped: layer.scoped }, location }
  }
  const { fields, effective } = backgroundOwner(model, target)
  return { backgroundColor: fields.backgroundColor, backgroundAssetId: fields.backgroundAssetId, ...('backgroundMode' in fields ? { backgroundMode: fields.backgroundMode } : {}), effective }
}

export function targetFootprint(model: DocumentModel, target: ToolTarget): string {
  if (target.kind === 'course-asset' && model.kind === 'course-v9') return documentDigest({ asset: readTarget(model, target), bytesDigest: model.resources.assets[target.assetId] ? sha256(model.resources.assets[target.assetId]) : undefined })
  if (target.kind === 'course-location' && model.kind === 'course-v9') {
    const location = model.project.locations.find(location => location.id === target.locationId)
    if (!location) throw new Error('页面不存在')
    const surface = model.project.surfaces.find(surface => surface.id === location.surfaceId)!
    const siblings = model.project.locations.filter(entry => entry.surfaceId === surface.id)
    const content = surface.type === 'slide' && location.kind === 'slide-scene' && siblings.length > 1 ? surface.scenes.find(scene => scene.id === location.sceneId) : surface
    return documentDigest({ location, content })
  }
  if (target.kind === 'course-state' && model.kind === 'course-v9') {
    const { scene } = stateToolContext(model.project, target)
    return documentDigest({ target: readTarget(model, target), scene })
  }
  if (model.kind === 'course-v9' && (target.kind === 'course-interaction' || target.kind === 'course-owner' && target.owner === 'scene')) {
    const composition = composeCourseProjectLocation({ project: model.project, locationId: target.locationId, stateId: target.stateId ?? null })
    const surface = model.project.surfaces.find(surface => surface.id === composition.surfaceId)
    const location = model.project.locations.find(location => location.id === target.locationId)
    const scene = surface?.type === 'slide' && location?.kind === 'slide-scene' ? surface.scenes.find(scene => scene.id === location.sceneId) : undefined
    return documentDigest({ target: readTarget(model, target), presentation: scene?.presentation, items: composition.entries.filter(entry => entry.applicable), courseState: model.project.courseState })
  }
  if (model.kind === 'course-v9' && target.kind === 'course-object') {
    const layer = locateCourseLayer(model.project, target.itemId)
    if (layer?.item.kind === 'native' && layer.item.content.nativeType === 'input') {
      const data = layer.item.content.data
      const rules = model.project.surfaces.flatMap(surface => surface.type === 'slide' ? surface.scenes.flatMap(scene => scene.interactions) : [])
      return documentDigest({ target: readTarget(model, target), rules: rules.filter(rule => data.ruleFamilyRuleIds.includes(rule.id) || rule.trigger.type === 'input.submit' && rule.trigger.nodeId === target.itemId), declarations: model.project.courseState.filter(entry => entry.key === data.stateKey || entry.key === data.validityKey) })
    }
  }
  if (target.kind === 'flow-range' && model.kind === 'course-v9') {
    const { block, parentId } = resolveFlowBlock(model.project, target)
    // A whole-slot read dependency refuses unproven offset shifts while allowing other slots/blocks to change.
    return documentDigest({ type: block.type, parentId, slot: flowTextSlot(block, target.slot).get() })
  }
  return documentDigest(readTarget(model, target))
}

/** Conservative verified mapping for a single disjoint source edit; ambiguous/overlapping edits conflict. */
export function mapMarkdownRange(before: string, after: string, range: Extract<ToolTarget, { kind: 'markdown-range' }>): typeof range {
  if (before === after) return { ...range }
  let from = 0
  while (from < before.length && from < after.length && before[from] === after[from]) from += 1
  let oldTo = before.length, newTo = after.length
  while (oldTo > from && newTo > from && before[oldTo - 1] === after[newTo - 1]) { oldTo -= 1; newTo -= 1 }
  if (oldTo === from) {
    const added = after.length - before.length
    // Equal surrounding text can make several insertion points explain the same
    // snapshots. A frozen range remains usable only if every point maps it alike.
    let earliest = before.length
    while (earliest > 0 && before[earliest - 1] === after[earliest - 1 + added]) earliest -= 1
    if (from < range.from) return { ...range, from: range.from + added, to: range.to + added }
    if (earliest >= range.to && earliest > range.from) return { ...range }
    throw new Error(earliest < from ? '重复文字导致范围映射不唯一，请重新读取目标' : '正文目标已发生重叠修改，请重新读取目标')
  }
  if (newTo === from) {
    const removed = before.length - after.length
    let earliest = after.length
    while (earliest > 0 && before[earliest - 1 + removed] === after[earliest - 1]) earliest -= 1
    if (from + removed <= range.from) return { ...range, from: range.from - removed, to: range.to - removed }
    if (earliest >= range.to && earliest > range.from) return { ...range }
    throw new Error(earliest < from ? '重复文字导致范围映射不唯一，请重新读取目标' : '正文目标已发生重叠修改，请重新读取目标')
  }
  if (oldTo <= range.from && from < range.from) {
    const shift = newTo - oldTo
    return { ...range, from: range.from + shift, to: range.to + shift }
  }
  if (from >= range.to && from > range.from) return { ...range }
  throw new Error('正文目标已发生重叠修改，请重新读取目标')
}

export function childTargets(model: DocumentModel, target: ToolTarget): { target: ToolTarget; label: string }[] {
  if (target.kind === 'document') {
    if (model.kind === 'markdown') return [{ target: { kind: 'markdown-range', from: 0, to: model.source.length }, label: '正文' }]
    const locations = model.project.locations.map(location => ({ target: { kind: 'course-location' as const, locationId: location.id }, label: location.label }))
    return [...locations.slice(0, 1), { target: { kind: 'course-background', owner: 'course' }, label: '课程背景' }, ...locations.slice(1), ...model.project.surfaces.map(surface => ({ target: { kind: 'course-surface' as const, surfaceId: surface.id }, label: surface.title })), { target: { kind: 'course-audio' }, label: '音频设置与声音库' }, ...Object.values(model.project.assets).map(asset => ({ target: { kind: 'course-asset' as const, assetId: asset.id }, label: asset.filename }))]
  }
  if (target.kind === 'course-audio' && model.kind === 'course-v9') return Object.values(model.project.media.audio.sounds).map(sound => ({ target: { kind: 'course-sound', soundId: sound.id }, label: sound.name }))
  if (target.kind === 'course-surface' && model.kind === 'course-v9') {
    readTarget(model, target)
    const surface = model.project.surfaces.find(surface => surface.id === target.surfaceId)!
    return [{ target: { kind: 'course-background', owner: 'surface', surfaceId: surface.id }, label: '表面背景' }, ...model.project.locations.filter(location => location.surfaceId === target.surfaceId).map(location => ({ target: { kind: 'course-location' as const, locationId: location.id }, label: location.label })), ...(surface.type === 'spatial-2d' ? [...(surface.world.paths ?? []).map(path => ({ target: { kind: 'spatial-graph' as const, graph: 'path' as const, surfaceId: surface.id, graphId: path.id }, label: path.name })), ...(surface.world.relations ?? []).map(relation => ({ target: { kind: 'spatial-graph' as const, graph: 'relation' as const, surfaceId: surface.id, graphId: relation.id }, label: relation.label ?? '关系连线' }))] : [])]
  }
  if (target.kind === 'course-state' && model.kind === 'course-v9') {
    const { surface, scene } = stateToolContext(model.project, target)
    return [{ target: { kind: 'course-background', owner: 'scene', surfaceId: surface.id, sceneId: scene.id, stateId: target.stateId }, label: '命名态背景' }]
  }
  if (model.kind === 'course-v9' && (target.kind === 'flow-container' || target.kind === 'flow-block')) {
    const parentId = target.kind === 'flow-container' ? target.parentId : target.blockId
    const blocks = flowBlocksAtParent(flowSurfaceIn(model.project, target.surfaceId).blocks, parentId)
    return blocks.map(block => ({ target: { kind: 'flow-block', surfaceId: target.surfaceId, parentId, blockId: block.id }, label: flowBlockLabel(block) }))
  }
  if (target.kind === 'course-owner' && model.kind === 'course-v9') {
    const { location, surface, items } = resolveNativeOwner(model.project, target)
    const background = target.owner === 'global' ? [] : target.owner === 'scene' && location.kind === 'slide-scene'
      ? [{ target: { kind: 'course-background' as const, owner: 'scene' as const, surfaceId: surface.id, sceneId: location.sceneId, ...(target.stateId ? { stateId: target.stateId } : {}) }, label: target.stateId ? '命名态背景' : '场景背景' }]
      : [{ target: { kind: 'course-background' as const, owner: 'surface' as const, surfaceId: surface.id }, label: '表面背景' }]
    return [...background, ...(target.owner === 'scene' ? stateChildren(model.project, target.locationId).filter(child => !target.stateId || child.target.kind === 'course-state' && child.target.stateId === target.stateId) : []), ...items.map(item => ({ target: { kind: 'course-object' as const, locationId: target.locationId, itemId: item.layerItemId, ...(target.stateId ? { stateId: target.stateId } : {}) }, label: item.label })), ...(target.owner === 'scene' ? locateSceneInteractions(model.project, target.locationId).map(rule => ({ target: { kind: 'course-interaction' as const, locationId: target.locationId, ruleId: rule.id, ...(target.stateId ? { stateId: target.stateId } : {}) }, label: rule.name ?? '互动规则' })) : [])]
  }
  if (target.kind !== 'course-location' || model.kind !== 'course-v9') throw new Error('当前目标没有可列出的子项')
  readTarget(model, target)
  const location = model.project.locations.find(value => value.id === target.locationId)!
  const surface = model.project.surfaces.find(value => value.id === location.surfaceId)!
  const ids = [...model.project.globalLayerItems.map(value => value.item.layerItemId), ...surface.surfaceLayerItems.map(value => value.item.layerItemId)]
  if (surface.type === 'slide' && location.kind === 'slide-scene') ids.push(...(surface.scenes.find(value => value.id === location.sceneId)?.layerItems.map(value => value.layerItemId) ?? []))
  if (surface.type === 'spatial-2d') ids.push(...surface.world.layerItems.map(value => value.layerItemId))
  const background = surface.type === 'slide' && location.kind === 'slide-scene'
    ? { target: { kind: 'course-background' as const, owner: 'scene' as const, surfaceId: surface.id, sceneId: location.sceneId }, label: '场景背景' }
    : { target: { kind: 'course-background' as const, owner: 'surface' as const, surfaceId: surface.id }, label: '表面背景' }
  return [background, ...[{ target: { kind: 'course-owner' as const, locationId: location.id, owner: surface.type === 'slide' ? 'scene' as const : surface.type === 'flow' ? 'surface' as const : 'world' as const }, label: surface.type === 'spatial-2d' ? '世界内容创建位置' : '页面图层创建位置' }], ...(surface.type === 'flow' ? [{ target: { kind: 'flow-container' as const, surfaceId: surface.id, parentId: null }, label: '正文' }] : []),
    ...stateChildren(model.project, location.id), ...ids.map(itemId => ({ target: { kind: 'course-object' as const, locationId: target.locationId, itemId }, label: locateCourseLayer(model.project, itemId)?.item.label ?? itemId }))]
}
