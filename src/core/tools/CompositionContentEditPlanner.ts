import { locateCourseLayer, type LayerOwnerSource } from '../drivers/course/layerProperties'
import { isCourseLayerVisibleAtLocation } from '../../shared/courseProjectModel'
import { findCompositionNode } from '../../shared/composition/content'
import type { CompositionLayerItem, CourseProjectDocument } from '../../shared/courseProjectTypes'
import type { DocumentCommand, DocumentModel, DocumentSnapshot } from '../../shared/workbench/document'
import type { ToolTarget } from '../../shared/workbench/tools'
import { applyCompositionContentEdit, type CompositionContentEdit, type CompositionContentNode } from './compositionContent'

type ObjectTarget = Extract<ToolTarget, { kind: 'course-object' }>
type CourseModel = Extract<DocumentModel, { kind: 'course-v9' }>

/** Software-owned addresses; the model receives only a run-scoped short handle. */
export interface CompositionContentHostTarget {
  readonly documentId: string
  readonly epoch: string
  readonly revision: number
  readonly projectId: string
  readonly locationId: string
  readonly surfaceId: string
  readonly stateId: string | null
  readonly owner: LayerOwnerSource
  readonly itemId: string
  readonly compositionNodeId?: string
  readonly nodeId: string
  readonly label: string
  readonly field:
    | { kind: 'text'; expectedText: string }
    | { kind: 'style'; expectedStyle: string }
    | { kind: 'image'; source: 'element'; key: string; expectedSource: string; expectedAssetId: string }
    | { kind: 'image'; source: 'native'; expectedAssetId: string }
}

export type CompositionContentChange =
  | { kind: 'text'; value: string }
  | { kind: 'style'; patch: Record<string, string | null> }
  /** The existing host resource importer has already admitted this asset into the candidate model. */
  | { kind: 'image'; assetId: string }
export type CompositionContentPlan =
  | { ok: true; command: Extract<DocumentCommand, { type: 'composition.edit' | 'course.replace' }>; model: CourseModel }
  | { ok: false; code: 'target-conflict' | 'invalid-input'; reason: string }

function resolve(snapshot: DocumentSnapshot, target: ObjectTarget): {
  model: CourseModel; item: CompositionLayerItem; scope: CompositionContentNode; pictureSource: boolean; surfaceId: string; owner: LayerOwnerSource
} | null {
  if (snapshot.model.kind !== 'course-v9') return null
  const model = snapshot.model, location = model.project.locations.find(value => value.id === target.locationId)
  const surface = location && model.project.surfaces.find(value => value.id === location.surfaceId)
  const layer = locateCourseLayer(model.project, target.itemId)
  if (!location || !surface || !layer || layer.item.kind !== 'composition'
    || layer.source !== 'global' && layer.surfaceId !== surface.id
    || layer.source === 'scene' && (location.kind !== 'slide-scene' || layer.sceneId !== location.sceneId)
    || layer.scoped && !isCourseLayerVisibleAtLocation(layer.scoped, location.id)) return null
  let locked = layer.item.locked
  if (target.stateId) {
    if (surface.type !== 'slide' || location.kind !== 'slide-scene') return null
    const state = surface.scenes.find(value => value.id === location.sceneId)?.presentation?.states.find(value => value.id === target.stateId)
    if (!state) return null
    locked = state.layerItemOverrides[layer.item.layerItemId]?.locked ?? locked
  }
  const scoped = editableScope(layer.item.content.root, target.compositionNodeId)
  return locked || !scoped ? null : { model, item: layer.item, ...scoped, surfaceId: surface.id, owner: layer.source }
}

const sourceOnly = new Set(['head', 'script', 'style', 'template', 'noscript'])

/** A selected descendant retains its enclosing source/picture boundary. */
function editableScope(root: CompositionContentNode, nodeId?: string): { scope: CompositionContentNode; pictureSource: boolean } | undefined {
  if (!nodeId) return { scope: root, pictureSource: false }
  const visit = (node: CompositionContentNode, pictureSource = false): ReturnType<typeof editableScope> => {
    if (node.kind === 'element' && sourceOnly.has(node.tagName.toLowerCase())) return
    if (node.id === nodeId) return { scope: node, pictureSource }
    if (node.kind !== 'element') return
    const alternative = node.tagName.toLowerCase() === 'picture' && node.children.some(child =>
      child.kind === 'element' && child.tagName.toLowerCase() === 'source')
    for (const child of node.children) {
      const found = visit(child, alternative)
      if (found) return found
    }
  }
  return visit(root)
}

function imageField(node: CompositionContentNode, item: CompositionLayerItem, project: CourseProjectDocument):
  Extract<CompositionContentHostTarget['field'], { kind: 'image' }> | undefined {
  if (node.kind === 'native' && node.content.nativeType === 'image'
    && project.assets[node.content.data.assetId]?.kind === 'image')
    return { kind: 'image', source: 'native', expectedAssetId: node.content.data.assetId }
  if (node.kind !== 'element' || node.tagName.toLowerCase() !== 'img' || node.attributes.srcset?.trim()) return
  const key = /^cw-resource:([a-zA-Z0-9_.-]+)$/.exec(node.attributes.src?.trim() ?? '')?.[1]
  const assetId = key && item.content.assets[key]?.assetId
  if (key && assetId && project.assets[assetId]?.kind === 'image')
    return { kind: 'image', source: 'element', key, expectedSource: node.attributes.src, expectedAssetId: assetId }
}

/** Reads formal author content, never infers a JS-created display node. */
export function discoverCompositionContentTargets(snapshot: DocumentSnapshot, input: { target: ObjectTarget }): CompositionContentHostTarget[] {
  const found = resolve(snapshot, input.target)
  if (!found) return []
  const base = { documentId: snapshot.documentId, epoch: snapshot.epoch, revision: snapshot.revision,
    projectId: found.model.project.id, locationId: input.target.locationId, surfaceId: found.surfaceId,
    stateId: input.target.stateId ?? null, owner: found.owner, itemId: found.item.layerItemId,
    ...(input.target.compositionNodeId ? { compositionNodeId: input.target.compositionNodeId } : {}) }
  const targets: CompositionContentHostTarget[] = []
  const visit = (node: CompositionContentNode, parentLabel: string, pictureSource = false) => {
    const image = !pictureSource && imageField(node, found.item, found.model.project)
    if (image) targets.push({ ...base, nodeId: node.id, label: node.kind === 'element'
      ? `图片 · ${node.attributes.alt || parentLabel}` : `原生图片 · ${parentLabel}`, field: image })
    if (node.kind === 'text') {
      if (node.text.trim()) targets.push({ ...base, nodeId: node.id, label: `${parentLabel} · ${node.text.slice(0, 100)}`,
        field: { kind: 'text', expectedText: node.text } })
    } else if (node.kind === 'element') {
      if (sourceOnly.has(node.tagName.toLowerCase())) return
      const label = `${node.tagName}${node.attributes.class ? ` .${node.attributes.class}` : ''}`
      targets.push({ ...base, nodeId: node.id, label, field: { kind: 'style', expectedStyle: node.attributes.style ?? '' } })
      const alternative = node.tagName.toLowerCase() === 'picture' && node.children.some(child =>
        child.kind === 'element' && child.tagName.toLowerCase() === 'source')
      node.children.forEach(child => visit(child, label, alternative))
    }
  }
  visit(found.scope, found.item.label, found.pictureSource)
  return targets
}

/** Plans the existing canonical command; Session owns the final CAS and history. */
export function planCompositionContentEdit(input: {
  snapshot: DocumentSnapshot; target: CompositionContentHostTarget; change: CompositionContentChange
}): CompositionContentPlan {
  const { snapshot, target, change } = input
  const reject = (reason: string): CompositionContentPlan => ({ ok: false, code: 'target-conflict', reason })
  if (snapshot.documentId !== target.documentId || snapshot.epoch !== target.epoch || snapshot.revision !== target.revision
    || snapshot.model.kind !== 'course-v9' || snapshot.model.project.id !== target.projectId)
    return reject('文档身份或版本已改变，请重新发现组合内容目标')
  const found = resolve(snapshot, { kind: 'course-object', locationId: target.locationId, itemId: target.itemId,
    ...(target.stateId ? { stateId: target.stateId } : {}), ...(target.compositionNodeId ? { compositionNodeId: target.compositionNodeId } : {}) })
  if (!found || found.surfaceId !== target.surfaceId || found.owner !== target.owner)
    return reject('组合内容已移动、隐藏、锁定或所在状态已改变')
  const node = findCompositionNode(found.scope, target.nodeId)
  const field = target.field
  const unchanged = field.kind === 'text' ? node?.kind === 'text' && node.text === field.expectedText
    : field.kind === 'style' ? node?.kind === 'element' && (node.attributes.style ?? '') === field.expectedStyle
    : field.source === 'native' ? node?.kind === 'native' && node.content.nativeType === 'image'
      && node.content.data.assetId === field.expectedAssetId
    : node?.kind === 'element' && node.tagName.toLowerCase() === 'img'
      && node.attributes.src === field.expectedSource && !node.attributes.srcset?.trim()
      && found.item.content.assets[field.key]?.assetId === field.expectedAssetId
  if (!unchanged) return reject('组合内容字段已改变，请重新发现目标')
  if (field.kind !== change.kind) return { ok: false, code: 'invalid-input', reason: '正文、样式和图片修改必须使用对应的内容目标' }

  const model = structuredClone(found.model)
  const item = locateCourseLayer(model.project, target.itemId)!.item as CompositionLayerItem
  let edit: CompositionContentEdit
  if (change.kind === 'image') {
    if (field.kind !== 'image' || model.project.assets[change.assetId]?.kind !== 'image')
      return { ok: false, code: 'invalid-input', reason: '换图需要当前课件已接收的图片资源' }
    if (change.assetId === field.expectedAssetId)
      return { ok: true, command: { type: 'course.replace', project: model.project, resources: model.resources }, model }
    if (field.source === 'native') edit = { type: 'native', nodeId: target.nodeId, patch: { assetId: change.assetId } }
    else {
      // A shared resource alias may serve other images or CSS. Fork only the selected image binding.
      const prefix = 'image-' + change.assetId
      let key = prefix, index = 1
      while (Object.prototype.hasOwnProperty.call(item.content.assets, key)) key = prefix + '-' + index++
      item.content.assets = { ...item.content.assets, [key]: { assetId: change.assetId } }
      edit = { type: 'attributes', nodeId: target.nodeId, patch: { src: 'cw-resource:' + key } }
    }
  } else edit = change.kind === 'text' ? { type: 'text', nodeId: target.nodeId, text: change.value }
    : { type: 'style', nodeId: target.nodeId, patch: change.patch }
  const applied = applyCompositionContentEdit(item.content, edit)
  if (!applied.ok) return { ok: false, code: 'invalid-input', reason: applied.diagnostic.message }
  item.content = applied.content
  return { ok: true, command: change.kind === 'image'
    ? { type: 'course.replace', project: model.project, resources: model.resources }
    : { type: 'composition.edit', layerItemId: target.itemId, edit }, model }
}
