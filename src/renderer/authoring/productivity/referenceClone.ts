import { nanoid } from 'nanoid'
import type { CourseProjectDocument, SlideSceneDocument } from '../../../shared/courseProjectTypes'
import { commitCourseProjectMutation } from '../../../core/tools/courseProjectMutation'
import { createEditorTransactionStep } from '../editorTransaction'
import type { ProductivityContext, ProductivityApplyResult } from './index'
import { isSingleChoiceStateKey, SINGLE_CHOICE_STATE_KEY_PREFIX, SINGLE_CHOICE_STATE_KEY_SUFFIX } from '../../../shared/singleChoiceRuleFamily'

type JsonRecord = Record<string, unknown>
const scalarReferences = new Set(['id', 'layerItemId', 'nodeId', 'sceneId', 'stateId', 'targetStateId', 'initialStateId', 'thumbnailStateId', 'actionId', 'columnId', 'categoryId', 'assetId', 'backgroundAssetId', 'staticFallbackAssetId', 'stateKey', 'validityKey', 'key'])
const arrayReferences = new Set(['layerItemOrder', 'layerItemIds', 'nodeIds', 'sceneIds', 'stateIds', 'ruleFamilyRuleIds'])
function visit(value: unknown, callback: (record: JsonRecord) => void) {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) { value.forEach(v => visit(v, callback)); return }
  const record = value as JsonRecord
  callback(record)
  Object.entries(record).forEach(([key, child]) => {
    // Extension source/props are opaque, not a second JSON rewrite language.
    if (key !== 'props' && key !== 'componentProps' && key !== 'source' && key !== 'content' && key !== 'metadata') visit(child, callback)
    else if (key === 'content' && child && typeof child === 'object' && 'nativeType' in child) visit(child, callback)
  })
}
function remap(scene: SlideSceneDocument, ids: Map<string, string>, sourceSceneId: string) {
  visit(scene, record => {
    // Presentation state IDs are scoped to their scene. Capture the owner before
    // rewriting sceneId; an external destination can legally reuse a local ID.
    const externalNavigation = record.type === 'scene.go' && record.sceneId !== sourceSceneId
    Object.entries(record).forEach(([key, value]) => {
      if (key === 'targetStateId' && externalNavigation) return
      if (key === 'sceneId') record[key] = value === sourceSceneId ? ids.get(sourceSceneId)! : value
      else if (key === 'sceneIds' && Array.isArray(value)) record[key] = value.map(id => id === sourceSceneId ? ids.get(sourceSceneId)! : id)
      else if (scalarReferences.has(key) && typeof value === 'string') record[key] = ids.get(value) ?? value
      else if (arrayReferences.has(key) && Array.isArray(value)) record[key] = value.map(v => typeof v === 'string' ? ids.get(v) ?? v : v)
      else if ((key === 'layerItemOverrides' || key === 'nodeBindings') && value && typeof value === 'object') record[key] = Object.fromEntries(Object.entries(value).map(([id, child]) => [key === 'layerItemOverrides' ? ids.get(id) ?? id : id, key === 'nodeBindings' && typeof child === 'string' ? ids.get(child) ?? child : child]))
    })
  })
}

/** Same-project Slide reference. Scene-local identities and directly owned assets are copied. */
export function cloneReferencePage(
  context: ProductivityContext,
  sourceSceneId: string,
  assetFiles: Readonly<Record<string, Uint8Array>>,
): ProductivityApplyResult {
  try {
    const project = context.document
    const surface = project.surfaces.find(s => s.type === 'slide' && s.scenes.some(scene => scene.id === sourceSceneId))
    if (!surface || surface.type !== 'slide') throw new Error('参考页不存在，请重新选择')
    const source = surface.scenes.find(s => s.id === sourceSceneId)!
    const scene = structuredClone(source)
    const ids = new Map<string, string>()
    const newId = (id: string) => { if (!ids.has(id)) ids.set(id, `copy_${nanoid(12)}`) }
    visit(scene, record => { for (const key of ['id', 'layerItemId']) if (typeof record[key] === 'string') newId(record[key] as string) })
    const stateKeys = new Set<string>()
    visit(scene, record => {
      for (const key of ['stateKey', 'validityKey']) if (typeof record[key] === 'string') stateKeys.add(record[key] as string)
      if ((record.type === 'course-state.set' || record.type === 'course-state.toggle' || record.type === 'course-state.compare' || record.type === 'course-state.exists') && typeof record.key === 'string') stateKeys.add(record.key)
    })
    stateKeys.forEach(key => ids.set(key, isSingleChoiceStateKey(key) ? `${SINGLE_CHOICE_STATE_KEY_PREFIX}${nanoid(12)}${SINGLE_CHOICE_STATE_KEY_SUFFIX}` : `${key.slice(0, 64)}_${nanoid(12)}`))
    const copiedAssets: CourseProjectDocument['assets'] = {}
    const assetFileChanges: Array<{ assetId: string; after: Uint8Array }> = []
    visit(scene, record => {
      for (const key of ['assetId', 'backgroundAssetId', 'staticFallbackAssetId']) {
        const id = record[key]
        if (typeof id !== 'string' || !id || copiedAssets[ids.get(id) ?? '']) continue
        const asset = project.assets[id]
        if (!asset || !assetFiles[id]) throw new Error(`参考页素材缺失：${id}`)
        newId(id)
        const nextId = ids.get(id)!
        copiedAssets[nextId] = { ...structuredClone(asset), id: nextId, path: `assets/${nextId}/${asset.filename}` }
        assetFileChanges.push({ assetId: nextId, after: Uint8Array.from(assetFiles[id]!) })
      }
    })
    remap(scene, ids, source.id)
    scene.name = `${source.name} 副本`
    const locationIds = new Map<string, string>()
    const nextDocument = commitCourseProjectMutation(project, draft => {
      const target = draft.surfaces.find(s => s.id === surface.id)
      if (!target || target.type !== 'slide') throw new Error('目标幻灯片集已失效')
      target.scenes.splice(target.scenes.findIndex(s => s.id === source.id) + 1, 0, scene)
      draft.mixedPrintPlan?.entries.forEach(entry => {
        if (entry.kind === 'slide-scenes' && entry.surfaceId === surface.id && entry.sceneIds.includes(source.id)) entry.sceneIds.splice(entry.sceneIds.indexOf(source.id) + 1, 0, scene.id)
      })
      Object.assign(draft.assets, copiedAssets)
      stateKeys.forEach(key => {
        const declaration = project.courseState.find(s => s.key === key)
        if (!declaration) throw new Error(`参考页状态声明缺失：${key}`)
        draft.courseState.push({ ...structuredClone(declaration), key: ids.get(key)! })
      })
      project.locations.filter(l => l.kind === 'slide-scene' && l.sceneId === source.id).forEach(location => {
        if (location.kind !== 'slide-scene') return
        const id = `location_${nanoid(12)}`
        locationIds.set(location.id, id)
        draft.locations.splice(draft.locations.findIndex(l => l.id === location.id) + 1, 0, { ...location, id, sceneId: scene.id, label: `${surface.title} · ${scene.name}`, ...(location.stateId ? { stateId: ids.get(location.stateId)! } : {}) })
      })
      scene.interactions.forEach(rule => rule.actions.forEach(({ action }) => {
        if (action.type === 'location.go') action.locationId = locationIds.get(action.locationId) ?? action.locationId
      }))
      // Preserve explicit shared-layer visibility without copying a global controller.
      for (const entry of [...draft.globalLayerItems, ...target.surfaceLayerItems]) {
        if (entry.visibility.mode === 'all') continue
        entry.visibility.locationIds.push(...entry.visibility.locationIds.flatMap(id => locationIds.has(id) ? [locationIds.get(id)!] : []))
      }
    })
    return { ok: true, step: createEditorTransactionStep(project, { projectId: project.id, baseRevision: project.revision, nextDocument, resourceChanges: { assetFileChanges }, selectionHint: { sceneId: scene.id, locationId: [...locationIds.values()][0] } }) }
  } catch (error) { return { ok: false, reason: error instanceof Error ? error.message : '参考页克隆失败' } }
}
