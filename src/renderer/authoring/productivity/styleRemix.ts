import type { SlideSceneDocument } from '../../../shared/courseProjectTypes'
import { analyzeTextNodeLayout } from '../../../shared/textLayout'
import { remapTextRuns } from '../../../shared/textRuns'
import { commitCourseProjectMutation } from '../../course/courseProjectMutation'
import { createEditorTransactionStep } from '../editorTransaction'
import type { ProductivityApplyResult, ProductivityContext } from './index'
import { cloneReferencePage } from './referenceClone'

export interface RemixSlot { id: string; label: string; original: string; replacement: string; capacity: string; issue?: string }
export interface StyleRemixPreview {
  projectId: string
  revision: number
  sessionToken: ProductivityContext['sessionToken']
  sourceSceneId: string
  sourceLabel: string
  slots: RemixSlot[]
  issues: string[]
}

function reference(context: ProductivityContext, sceneId: string): SlideSceneDocument {
  const surface = context.document.surfaces.find(s => s.type === 'slide' && s.scenes.some(scene => scene.id === sceneId))
  if (!surface || surface.type !== 'slide') throw new Error('参考页不存在，请重新选择')
  return surface.scenes.find(s => s.id === sceneId)!
}

/** Explicit transient slots, never persisted as a Recipe or private project state. */
export function previewStyleRemix(context: ProductivityContext, sceneId: string, replacements: Readonly<Record<string, string>>): StyleRemixPreview {
  const scene = reference(context, sceneId)
  const issues: string[] = []
  if (scene.interactions.length || (scene.presentation?.states.length ?? 0) > 1 || scene.presentation?.states.some(s => Object.keys(s.layerItemOverrides).length)) issues.push(`${scene.name}：暂不支持带交互或状态覆盖的参考页`)
  const slots: RemixSlot[] = []
  for (const item of scene.layerItems) {
    if (item.kind !== 'native') { issues.push(`${scene.name} / ${item.label}：暂不支持动态载体`); continue }
    if (item.content.nativeType !== 'text') continue
    const data = item.content.data
    const replacement = replacements[item.layerItemId]
    let issue = replacement === undefined || !replacement.trim() ? '请填写此槽位' : undefined
    const layout = analyzeTextNodeLayout({ ...data, text: replacement ?? data.text, runs: remapTextRuns(data.text, replacement ?? data.text, data.runs), type: 'text', id: item.layerItemId, name: item.label, ...item.frame, rotation: item.rotation, opacity: item.opacity, visible: item.visible, locked: item.locked, playbackInitialVisibility: item.playbackInitialVisibility })
    // A skeleton keeps its geometry. Even auto-height must fit the original box.
    if (!issue && (layout.overflowsWidth || layout.overflowsHeight)) issue = '文字超出参考文本框，请缩短内容或先扩大参考页文本框'
    slots.push({ id: item.layerItemId, label: item.label, original: data.text, replacement: replacement ?? '', capacity: `${item.frame.width} × ${item.frame.height}，${Number(layout.fontSize.toFixed(2))}px；${layout.measurementMode === 'deterministic-fallback' ? '估算排版' : '字体实测'}，保持原框`, ...(issue ? { issue } : {}) })
  }
  if (!slots.length) issues.push(`${scene.name}：没有可替换的原生文字槽位`)
  for (const id of Object.keys(replacements)) if (!slots.some(slot => slot.id === id)) issues.push(`槽位 ${id} 已不存在`)
  return { projectId: context.document.id, revision: context.document.revision, sessionToken: { ...context.sessionToken }, sourceSceneId: sceneId, sourceLabel: scene.name, slots, issues }
}

export function applyStyleRemix(context: ProductivityContext, preview: StyleRemixPreview, assetFiles: Readonly<Record<string, Uint8Array>>): ProductivityApplyResult {
  try {
    const token = context.sessionToken, before = preview.sessionToken
    if (context.document.id !== preview.projectId || context.document.revision !== preview.revision || token.generation !== before.generation || token.locationId !== before.locationId || token.surfaceType !== before.surfaceType) throw new Error('预览已过期，请重新预览')
    const checked = previewStyleRemix(context, preview.sourceSceneId, Object.fromEntries(preview.slots.map(slot => [slot.id, slot.replacement])))
    const failures = [...checked.issues, ...checked.slots.filter(slot => slot.issue).map(slot => `${slot.label}：${slot.issue}`)]
    if (failures.length) throw new Error(failures.join('\n'))
    const source = reference(context, preview.sourceSceneId)
    const cloned = cloneReferencePage(context, source.id, assetFiles)
    if (!cloned.ok || !cloned.step) return cloned
    const step = cloned.step
    const newSceneId = (step.selectionHint as { sceneId: string }).sceneId
    const nextDocument = commitCourseProjectMutation(context.document, draft => {
      // Clone already prepared the complete identity/resource closure without writes.
      Object.assign(draft, structuredClone(step.nextDocument))
      const copy = reference({ ...context, document: draft }, newSceneId)
      copy.name = `${source.name} 改写`
      checked.slots.forEach(slot => {
        const index = source.layerItems.findIndex(item => item.layerItemId === slot.id)
        const item = copy.layerItems[index]!
        if (item.kind !== 'native' || item.content.nativeType !== 'text') throw new Error(`槽位 ${slot.label} 已失效`)
        item.content.data.runs = remapTextRuns(item.content.data.text, slot.replacement, item.content.data.runs)
        item.content.data.text = slot.replacement
      })
      draft.locations.forEach(location => { if (location.kind === 'slide-scene' && location.sceneId === copy.id) location.label = copy.name })
    })
    return { ok: true, step: createEditorTransactionStep(context.document, { ...step, nextDocument }) }
  } catch (error) { return { ok: false, reason: error instanceof Error ? error.message : '样板改写失败' } }
}
