import { locateCourseLayer } from '../drivers/course/layerProperties'
import { componentPackageKey } from '../drivers/codecs/archivePath'
import { validateCourseProjectArchiveData } from '../drivers/codecs/courseProjectArchive'
import { courseProjectDocumentSchema } from '../../shared/courseProjectSchema'
import { isCourseLayerVisibleAtLocation } from '../../shared/courseProjectModel'
import { assetMetaSchema } from '../../shared/contracts/media-v1/schema'
import type { AssetMeta } from '../../shared/contracts/media-v1/types'
import {
  lightEditOverrideKey,
  lightEditTextOverrideSchema,
  type LightEditTextOverride,
} from '../../shared/contracts/runtime/lightEdit'
import type { ComponentLayerItem, CourseProjectDocument, RuntimeLayerItem } from '../../shared/courseProjectTypes'
import type { DocumentModel, DocumentSnapshot } from '../../shared/workbench/document'
import type { ToolTarget } from '../../shared/workbench/tools'
import type { DynamicContentObservedTarget } from '../../shared/workbench/dynamicContentTargets'

type CourseModel = Extract<DocumentModel, { kind: 'course-v9' }>
type CourseObjectTarget = Extract<ToolTarget, { kind: 'course-object' }>
type LayerOwner = 'global' | 'surface' | 'scene' | 'world'

/** Main owns these facts. A provider sees only a short handle mapped to this value. */
export interface DynamicContentHostTarget {
  readonly documentId: string
  readonly epoch: string
  readonly revision: number
  readonly projectId: string
  readonly locationId: string
  readonly surfaceId: string
  readonly stateId: string | null
  readonly owner: LayerOwner
  readonly itemId: string
  readonly field:
    | { readonly kind: 'runtime.value'; readonly key: string; readonly expectedText: string }
    | { readonly kind: 'runtime.text'; readonly original: string; readonly region?: string; readonly expectedText: string }
    | { readonly kind: 'runtime.image'; readonly key: string; readonly expectedAssetId: string }
    | { readonly kind: 'component.text'; readonly original: string; readonly region?: string; readonly expectedText: string }
    | { readonly kind: 'component.image'; readonly key: string; readonly expectedAssetId: string | null }
}

export type { DynamicContentObservedTarget }

export interface DynamicContentDiscoveryInput {
  readonly target: CourseObjectTarget
  /** Fresh hits from the M15 actual host. Omit when it is not mounted; no synthetic source scanning occurs. */
  readonly observed?: readonly DynamicContentObservedTarget[]
}

export type DynamicContentChange =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'image'; readonly asset: AssetMeta; readonly bytes: Uint8Array }

export interface DynamicContentFallbackCapture {
  /** PNG captured from the planned candidate by the actual preview host. */
  readonly asset: AssetMeta
  readonly bytes: Uint8Array
}

export type DynamicContentPlanResult =
  | { readonly ok: true; readonly status: 'planned'; readonly model: CourseModel; readonly hasFallback: boolean }
  | { readonly ok: true; readonly status: 'no-op' }
  | { readonly ok: true; readonly status: 'needs-fallback'; readonly candidate: CourseModel }
  | { readonly ok: false; readonly code: 'target-conflict' | 'invalid-input' | 'invalid-resource' | 'invalid-document'; readonly reason: string }

function reject(code: Extract<DynamicContentPlanResult, { ok: false }>['code'], reason: string): DynamicContentPlanResult {
  return { ok: false, code, reason }
}

function currentText(overrides: readonly LightEditTextOverride[] | undefined, original: string, region?: string): string {
  const key = lightEditOverrideKey({ original, ...(region ? { region } : {}) })
  return overrides?.find(rule => lightEditOverrideKey(rule) === key)?.text ?? original
}

function safeKey(value: unknown, limit = 256): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= limit
    && !['__proto__', 'prototype', 'constructor'].includes(value)
}

function componentManifestAssets(model: CourseModel, item: ComponentLayerItem): Record<string, string> | null {
  const key = componentPackageKey(item.component.packageId, item.component.version)
  const bytes = model.resources.components[key]?.['manifest.json']
  if (!bytes) return null
  try {
    const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as Record<string, unknown>
    if (manifest.id !== item.component.packageId || manifest.version !== item.component.version
      || !manifest.assets || typeof manifest.assets !== 'object' || Array.isArray(manifest.assets)) return null
    return manifest.assets as Record<string, string>
  } catch { return null }
}

function resolveObject(snapshot: DocumentSnapshot, object: CourseObjectTarget): {
  model: CourseModel; locationId: string; surfaceId: string; stateId: string | null;
  owner: LayerOwner; item: RuntimeLayerItem | ComponentLayerItem
} | null {
  if (snapshot.model.kind !== 'course-v9') return null
  const model = snapshot.model
  const location = model.project.locations.find(candidate => candidate.id === object.locationId)
  const surface = location && model.project.surfaces.find(candidate => candidate.id === location.surfaceId)
  const located = locateCourseLayer(model.project, object.itemId)
  if (!location || !surface || !located || (located.item.kind !== 'runtime' && located.item.kind !== 'component')
    || located.source !== 'global' && located.surfaceId !== surface.id
    || located.source === 'scene' && (location.kind !== 'slide-scene' || located.sceneId !== location.sceneId)
    || located.scoped && !isCourseLayerVisibleAtLocation(located.scoped, location.id)) return null
  const stateId = object.stateId ?? null
  let locked = located.item.locked
  if (stateId !== null) {
    if (surface.type !== 'slide' || location.kind !== 'slide-scene') return null
    const state = surface.scenes.find(scene => scene.id === location.sceneId)?.presentation?.states.find(state => state.id === stateId)
    if (!state) return null
    locked = state.layerItemOverrides[located.item.layerItemId]?.locked ?? locked
  }
  if (locked) return null
  const item = located.item
  if (item.kind !== 'runtime' && item.kind !== 'component') return null
  return { model, locationId: location.id, surfaceId: surface.id, stateId, owner: located.source, item }
}

/** Discover V9 declared fields and only actual M15 rendered hits supplied by the host. */
export function discoverDynamicContentTargets(snapshot: DocumentSnapshot, input: DynamicContentDiscoveryInput): DynamicContentHostTarget[] {
  const resolved = resolveObject(snapshot, input.target)
  if (!resolved) return []
  const { model, item, locationId, surfaceId, stateId, owner } = resolved
  const base = { documentId: snapshot.documentId, epoch: snapshot.epoch, revision: snapshot.revision,
    projectId: model.project.id, locationId, surfaceId, stateId, owner, itemId: item.layerItemId }
  const result: DynamicContentHostTarget[] = []
  if (item.kind === 'runtime') {
    for (const [key, value] of Object.entries(item.runtime.content.values)) {
      if (safeKey(key) && typeof value === 'string') result.push({ ...base, field: { kind: 'runtime.value', key, expectedText: value } })
    }
    for (const [key, binding] of Object.entries(item.runtime.assets)) {
      const meta = model.project.assets[binding?.assetId]
      if (safeKey(key) && safeKey(binding?.assetId) && meta?.kind === 'image' && meta.mimeType.startsWith('image/'))
        result.push({ ...base, field: { kind: 'runtime.image', key, expectedAssetId: binding.assetId } })
    }
  }
  const manifestAssets = item.kind === 'component' ? componentManifestAssets(model, item) : null
  for (const hit of input.observed ?? []) {
    if (hit.source !== 'auto' || hit.revision !== snapshot.revision || hit.locationId !== locationId || hit.itemId !== item.layerItemId) continue
    if (item.kind === 'runtime' && hit.kind === 'runtime.text') {
      const address = { original: hit.original, ...(hit.region ? { region: hit.region } : {}), text: hit.text }
      if (!lightEditTextOverrideSchema.safeParse(address).success
        || currentText(item.runtime.content.overrides, hit.original, hit.region) !== hit.text) continue
      result.push({ ...base, field: { kind: 'runtime.text', original: hit.original,
        ...(hit.region ? { region: hit.region } : {}), expectedText: hit.text } })
    } else if (item.kind === 'component' && hit.kind === 'component.text') {
      const address = { original: hit.original, ...(hit.region ? { region: hit.region } : {}), text: hit.text }
      if (!lightEditTextOverrideSchema.safeParse(address).success
        || currentText(item.textOverrides, hit.original, hit.region) !== hit.text) continue
      result.push({ ...base, field: { kind: 'component.text', original: hit.original,
        ...(hit.region ? { region: hit.region } : {}), expectedText: hit.text } })
    } else if (item.kind === 'component' && hit.kind === 'component.image') {
      if (!safeKey(hit.assetKey, 200) || !Object.hasOwn(manifestAssets ?? {}, hit.assetKey)) continue
      result.push({ ...base, field: { kind: 'component.image', key: hit.assetKey,
        expectedAssetId: item.assetOverrides?.[hit.assetKey]?.assetId ?? null } })
    }
  }
  return result
}

function writeImage(model: CourseModel, asset: AssetMeta, bytes: Uint8Array, fresh: boolean): boolean {
  if (!assetMetaSchema.safeParse(asset).success || asset.kind !== 'image' || !asset.mimeType.startsWith('image/')
    || !(bytes instanceof Uint8Array) || asset.byteLength !== bytes.byteLength || !safeKey(asset.id, 240)) return false
  const existingMeta = model.project.assets[asset.id]
  const existingBytes = model.resources.assets[asset.id]
  if (fresh ? existingMeta !== undefined || existingBytes !== undefined
    : existingMeta !== undefined && JSON.stringify(existingMeta) !== JSON.stringify(asset)
      || existingBytes !== undefined && (existingBytes.byteLength !== bytes.byteLength
        || existingBytes.some((value, index) => value !== bytes[index]))) return false
  if (existingMeta === undefined) model.project.assets[asset.id] = structuredClone(asset)
  if (existingBytes === undefined) model.resources.assets[asset.id] = Uint8Array.from(bytes)
  return true
}

function isCapturedPng(asset: AssetMeta, bytes: Uint8Array): boolean {
  if (asset.mimeType !== 'image/png' || !(bytes instanceof Uint8Array) || bytes.byteLength < 24) return false
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  if (!signature.every((value, index) => bytes[index] === value)
    || String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR') return false
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const width = view.getUint32(16), height = view.getUint32(20)
  return width > 0 && height > 0 && asset.width === width && asset.height === height
}

function writeTextRule(item: RuntimeLayerItem | ComponentLayerItem, original: string, region: string | undefined, value: string): void {
  const rule: LightEditTextOverride = { original, ...(region ? { region } : {}), text: value }
  const key = lightEditOverrideKey(rule)
  const current = item.kind === 'runtime' ? item.runtime.content.overrides : item.textOverrides
  const next = (current ?? []).filter(entry => lightEditOverrideKey(entry) !== key)
  if (value !== original) next.push(rule)
  if (item.kind === 'runtime') {
    if (next.length) item.runtime.content.overrides = next
    else delete item.runtime.content.overrides
  } else if (next.length) item.textOverrides = next
  else delete item.textOverrides
}

/** Pure candidate planner; caller owns host hit authority, screenshot, stop barrier and final Session CAS. */
export function planDynamicContentEdit(input: {
  readonly snapshot: DocumentSnapshot
  readonly target: DynamicContentHostTarget
  readonly change: DynamicContentChange
  readonly now: string
  readonly fallback?: DynamicContentFallbackCapture
}): DynamicContentPlanResult {
  const { snapshot, target, change } = input
  if (snapshot.documentId !== target.documentId || snapshot.epoch !== target.epoch || snapshot.revision !== target.revision
    || snapshot.model.kind !== 'course-v9' || snapshot.model.project.id !== target.projectId
    || snapshot.model.project.revision !== snapshot.revision) {
    return reject('target-conflict', '文档身份或版本已改变，请重新发现图文目标')
  }
  if (!Number.isFinite(Date.parse(input.now))) return reject('invalid-input', '提交时间无效')
  const object: CourseObjectTarget = { kind: 'course-object', locationId: target.locationId,
    itemId: target.itemId, ...(target.stateId ? { stateId: target.stateId } : {}) }
  const resolved = resolveObject(snapshot, object)
  if (!resolved || resolved.surfaceId !== target.surfaceId || resolved.owner !== target.owner) {
    return reject('target-conflict', '目标已移动、隐藏、锁定或所在状态已改变')
  }
  const field = target.field
  if (field.kind.startsWith('runtime.') && resolved.item.kind !== 'runtime'
    || field.kind.startsWith('component.') && resolved.item.kind !== 'component') {
    return reject('target-conflict', '图文目标类型已改变')
  }
  if ((field.kind.endsWith('image')) !== (change.kind === 'image')) return reject('invalid-input', '文字或图片修改与目标不匹配')
  const item = resolved.item
  let current: string | null
  if (field.kind === 'runtime.value') {
    if (!safeKey(field.key) || item.kind !== 'runtime' || !Object.hasOwn(item.runtime.content.values, field.key))
      return reject('target-conflict', 'Runtime 文字字段已不存在')
    current = item.runtime.content.values[field.key]!
  } else if (field.kind === 'runtime.text' || field.kind === 'component.text') {
    if (!lightEditTextOverrideSchema.safeParse({ original: field.original, ...(field.region ? { region: field.region } : {}), text: field.expectedText }).success)
      return reject('invalid-input', '宿主文字目标无效')
    current = currentText(item.kind === 'runtime' ? item.runtime.content.overrides : item.kind === 'component' ? item.textOverrides : undefined,
      field.original, field.region)
  } else if (field.kind === 'runtime.image') {
    if (!safeKey(field.key) || item.kind !== 'runtime' || !Object.hasOwn(item.runtime.assets, field.key))
      return reject('target-conflict', 'Runtime 图片绑定已不存在')
    current = item.runtime.assets[field.key]!.assetId
    const meta = snapshot.model.project.assets[current]
    if (meta?.kind !== 'image' || !meta.mimeType.startsWith('image/'))
      return reject('target-conflict', 'Runtime 绑定不再是图片')
  } else {
    if (!safeKey(field.key, 200) || item.kind !== 'component'
      || !Object.hasOwn(componentManifestAssets(snapshot.model as CourseModel, item) ?? {}, field.key))
      return reject('target-conflict', '组件图片不属于当前包清单')
    current = item.assetOverrides?.[field.key]?.assetId ?? null
  }
  const expected = field.kind === 'runtime.image' || field.kind === 'component.image'
    ? field.expectedAssetId : field.expectedText
  if (current !== expected) return reject('target-conflict', '图文目标已改变，请重新观察')
  if (change.kind === 'text') {
    if (typeof change.value !== 'string') return reject('invalid-input', '文字必须是字符串')
    if ((field.kind === 'runtime.text' || field.kind === 'component.text')
      && !lightEditTextOverrideSchema.safeParse({ original: field.original,
        ...(field.region ? { region: field.region } : {}), text: change.value }).success)
      return reject('invalid-input', '轻编辑文字超出正式合同')
    if (change.value === current) return { ok: true, status: 'no-op' }
  } else if (change.asset.id === current && snapshot.model.project.assets[change.asset.id]
    && snapshot.model.resources.assets[change.asset.id]) {
    const existingMeta = snapshot.model.project.assets[change.asset.id]!
    const existingBytes = snapshot.model.resources.assets[change.asset.id]!
    if (!assetMetaSchema.safeParse(change.asset).success || change.asset.kind !== 'image'
      || !change.asset.mimeType.startsWith('image/')
      || !(change.bytes instanceof Uint8Array) || JSON.stringify(existingMeta) !== JSON.stringify(change.asset)
      || existingBytes.byteLength !== change.bytes.byteLength
      || existingBytes.some((value, index) => value !== change.bytes[index])) {
      return reject('invalid-resource', '图片素材与已有素材编号冲突')
    }
    return { ok: true, status: 'no-op' }
  }

  const next = structuredClone(snapshot.model)
  const nextItem = locateCourseLayer(next.project, target.itemId)?.item
  if (!nextItem || (nextItem.kind !== 'runtime' && nextItem.kind !== 'component')) return reject('target-conflict', '图文目标已不存在')
  if (change.kind === 'text') {
    if (field.kind === 'runtime.value' && nextItem.kind === 'runtime') nextItem.runtime.content.values[field.key] = change.value
    else if ((field.kind === 'runtime.text' || field.kind === 'component.text')) writeTextRule(nextItem, field.original, field.region, change.value)
    else return reject('target-conflict', '目标类型已改变')
  } else {
    if (!writeImage(next, change.asset, change.bytes, false)) return reject('invalid-resource', '图片素材无效或与已有素材冲突')
    if (field.kind === 'runtime.image' && nextItem.kind === 'runtime') nextItem.runtime.assets[field.key] = { assetId: change.asset.id }
    else if (field.kind === 'component.image' && nextItem.kind === 'component') {
      nextItem.assetOverrides = { ...nextItem.assetOverrides, [field.key]: { assetId: change.asset.id } }
    } else return reject('target-conflict', '目标类型已改变')
  }
  const hasFallback = nextItem.kind === 'runtime' ? Boolean(nextItem.runtime.staticFallback) : Boolean(nextItem.staticFallbackAssetId)
  if (hasFallback && !input.fallback) {
    try {
      next.project.updatedAt = input.now
      next.project = courseProjectDocumentSchema.parse(next.project)
      validateCourseProjectArchiveData({ project: next.project, assetFiles: next.resources.assets, componentFiles: next.resources.components })
      return { ok: true, status: 'needs-fallback', candidate: next }
    } catch (error) { return reject('invalid-document', error instanceof Error ? error.message : '候选课件无效') }
  }
  if (input.fallback) {
    if (!hasFallback || !isCapturedPng(input.fallback.asset, input.fallback.bytes)
      || !writeImage(next, input.fallback.asset, input.fallback.bytes, true))
      return reject('invalid-resource', '静态后备图无效或素材编号已占用')
    if (nextItem.kind === 'runtime') nextItem.runtime.staticFallback!.assetId = input.fallback.asset.id
    else nextItem.staticFallbackAssetId = input.fallback.asset.id
  }
  try {
    // course.replace carries the exact base revision. DocumentSession advances it after its final CAS.
    next.project.updatedAt = input.now
    next.project = courseProjectDocumentSchema.parse(next.project)
    validateCourseProjectArchiveData({ project: next.project, assetFiles: next.resources.assets, componentFiles: next.resources.components })
    return { ok: true, status: 'planned', model: next, hasFallback }
  } catch (error) { return reject('invalid-document', error instanceof Error ? error.message : '修改后的课件无效') }
}
