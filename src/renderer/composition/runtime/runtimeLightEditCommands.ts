import { useSyncExternalStore } from 'react'
import { resolveComponentPresentation, type ComponentAuthorSpot } from '../../../shared/contracts/component-platform'
import { documentTextContentSchema, plainDocumentText } from '../../../shared/document/content'
import { replaceCourseInstanceText } from '../../../core/tools/ToolTargets'
import type { ComponentPlatformRuntime } from '../../../player/components/ComponentPlatformRuntime'
import type { CapturedCourseTarget, CourseV10DocumentBridge } from '../../documents/CourseV10DocumentBridge'
import { componentIsLocked } from '../crossSurfaceCommands'
import { authorSpotEdits } from '../../componentPlatform/surfaces/slide/authorSpots'
import { useEditorStore } from '../../store/editorStore'
import { webDataSchema } from '../../../components/web/data'
import { scanPageText } from '../../../shared/runtimeText/scanPageText'
import { normalizeLightEditText, type LightEditTextOverride } from '../../../shared/contracts/runtime/lightEdit'
import type { JsonValue } from '../../../shared/contracts/component-platform'

interface DocumentRuntime { world: ComponentPlatformRuntime; bridge: CourseV10DocumentBridge }
const documents = new Map<string, DocumentRuntime>()
const listeners = new Set<() => void>()
let version = 0
const changed = () => { version++; for (const listener of listeners) listener() }
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }

/** An index of mounted worlds, never another runtime or a content owner. */
export function registerRuntimeLightEditDocument(documentId: string, world: ComponentPlatformRuntime, bridge: CourseV10DocumentBridge): () => void {
  const entry = { world, bridge }
  documents.set(documentId, entry)
  const stop = world.subscribeAuthorSpots(changed)
  changed()
  return () => { stop(); if (documents.get(documentId) === entry) { documents.delete(documentId); changed() } }
}

export interface RuntimePageTextEntry { spot: ComponentAuthorSpot; text: string }
export interface RuntimeLightEditView { documentId: string; entries: readonly RuntimePageTextEntry[]; locked: boolean;
  pageCopy: readonly string[]; overrides: readonly LightEditTextOverride[] }
export interface CapturedRuntimePageText { target: CapturedCourseTarget; spot: ComponentAuthorSpot; bridge: CourseV10DocumentBridge }
export interface CapturedRuntimePageCopy { target: CapturedCourseTarget; bridge: CourseV10DocumentBridge;
  instanceId: string; original: string; previous: string }
export type RuntimePageTextResult = { readonly ok: true; readonly changed: boolean } | { readonly ok: false; readonly reason: string }

function pageCopy(target: CapturedCourseTarget, itemId: string) {
  const instance = target.editingProject.instances[itemId]
  const implementation = instance?.implementationOverride ?? target.editingProject.definitions[instance?.definitionId]?.implementation
  if (implementation?.kind !== 'builtin' || !['guoling.web', 'guoling.html-program'].includes(implementation.key)) return null
  const parsed = webDataSchema.safeParse(instance.data)
  if (!parsed.success) return null
  const data = parsed.data
  const texts = scanPageText([{ path: 'content.html', kind: 'html', text: data.html },
    ...Object.entries(data.modules ?? {}).map(([path, text]) => ({ path, kind: 'js' as const, text }))]).entries.map(entry => entry.text)
  return { texts, overrides: data.textOverrides ?? [] }
}

function read(itemId: string, documentId = useEditorStore.getState().courseView.activeDocumentId): RuntimeLightEditView | null {
  if (!documentId) return null
  const entry = documents.get(documentId), project = entry?.bridge.read().views.find(view => view.documentId === documentId)?.model.project
  if (!entry || !project?.instances[itemId]) return null
  const entries = entry.world.authorSpots().flatMap(spot => {
    if (spot.instanceId !== itemId || spot.kind !== 'text') return []
    const rich = documentTextContentSchema.safeParse(spot.initialValue)
    const text = typeof spot.initialValue === 'string' ? spot.initialValue : rich.success ? plainDocumentText(rich.data) : null
    return text === null ? [] : [{ spot, text }]
  })
  const copy = pageCopy(entry.bridge.captureTarget(documentId), itemId)
  return { documentId, entries, locked: componentIsLocked(project, itemId), pageCopy: copy?.texts ?? [], overrides: copy?.overrides ?? [] }
}

export function useRuntimeLightEditView(itemId: string): RuntimeLightEditView | null {
  const view = useEditorStore(state => state.courseView)
  useSyncExternalStore(subscribe, () => version)
  return read(itemId, view.activeDocumentId)
}

export const runtimeLightEditCommands = {
  read,
  capturePageCopy(documentId: string, instanceId: string, original: string): CapturedRuntimePageCopy {
    const entry = documents.get(documentId)
    if (!entry) throw new Error('此文档的运行内容尚未就绪')
    const target = entry.bridge.captureTarget(documentId), copy = pageCopy(target, instanceId)
    const normalized = normalizeLightEditText(original)
    if (componentIsLocked(target.editingProject, instanceId)) throw new Error('这个对象已锁定，请先解锁')
    if (!copy?.texts.includes(normalized)) throw new Error('此处原文已更换，请重新打开页面文字')
    return { target, bridge: entry.bridge, instanceId, original: normalized,
      previous: copy.overrides.find(rule => rule.original === normalized && !rule.region)?.text ?? normalized }
  },
  async setPageCopy(captured: CapturedRuntimePageCopy, text: string): Promise<RuntimePageTextResult> {
    try {
      const { target, bridge, instanceId, original, previous } = captured
      if (documents.get(target.documentId)?.bridge !== bridge) throw new Error('原文档会话已更换，文字草稿已保留')
      const latest = bridge.captureTarget(target.documentId)
      if (latest.epoch !== target.epoch || latest.project.id !== target.project.id) throw new Error('原文档会话已更换，文字草稿已保留')
      const current = { ...target, project: latest.project, resources: latest.resources,
        editingProject: resolveComponentPresentation(latest.project, target.surfaceId, target.activeStateId) }
      if (componentIsLocked(current.editingProject, instanceId)) throw new Error('这个对象已锁定，文字草稿已保留')
      const copy = pageCopy(current, instanceId)
      if (!copy?.texts.includes(original) || current.editingProject.instances[instanceId]?.definitionId !== target.editingProject.instances[instanceId]?.definitionId)
        throw new Error('此处原文或对象已更换，文字草稿已保留')
      if ((copy.overrides.find(rule => rule.original === original && !rule.region)?.text ?? original) !== previous)
        throw new Error('此处内容已变化，文字草稿已保留，请重新比较')
      if (text === previous) return { ok: true, changed: false }
      const rules = copy.overrides.filter(rule => rule.original !== original || rule.region)
      if (text !== original) rules.push({ original, text })
      await bridge.editCaptured(bridge.capture([{ type: 'data.set', instanceId, path: ['textOverrides'], value: rules as unknown as JsonValue }], current))
      return { ok: true, changed: true }
    } catch (error) { return { ok: false, reason: error instanceof Error ? error.message : '页面文字提交失败，草稿已保留' } }
  },
  capturePageText(documentId: string, spot: ComponentAuthorSpot): CapturedRuntimePageText {
    const entry = documents.get(documentId)
    if (!entry) throw new Error('此文档的运行内容尚未就绪')
    const target = entry.bridge.captureTarget(documentId)
    if (componentIsLocked(target.editingProject, spot.instanceId)) throw new Error('这个对象已锁定，请先解锁')
    const current = entry.world.authorSpots().find(value => value.id === spot.id && value.mountGeneration === spot.mountGeneration)
    if (!current) throw new Error('此处运行内容已更换，请重新打开文字编辑')
    return { target, spot: structuredClone(current), bridge: entry.bridge }
  },
  async setPageText(captured: CapturedRuntimePageText, text: string): Promise<RuntimePageTextResult> {
    try {
      const { target, spot, bridge } = captured
      const entry = documents.get(target.documentId)
      const stableBinding = spot.authorKey && spot.binding && spot.bindingStatus !== 'unresolved' && spot.bindingStatus !== 'source-required'
      if (entry?.bridge !== bridge || !stableBinding && !entry.world.authorSpots().some(value => value.id === spot.id && value.mountGeneration === spot.mountGeneration))
        throw new Error('原运行内容已更换，文字草稿已保留')
      const latest = bridge.captureTarget(target.documentId)
      if (latest.epoch !== target.epoch || latest.project.id !== target.project.id) throw new Error('原文档会话已更换，文字草稿已保留')
      const current: CapturedCourseTarget = { ...target, project: latest.project, resources: latest.resources,
        editingProject: resolveComponentPresentation(latest.project, target.surfaceId, target.activeStateId) }
      if (componentIsLocked(current.editingProject, spot.instanceId)) throw new Error('这个对象已锁定，文字草稿已保留')
      const rich = documentTextContentSchema.safeParse(spot.initialValue)
      const edits = rich.success && spot.dataPath && !spot.sourceRegion
        ? [replaceCourseInstanceText({ kind: 'course-v10', project: current.editingProject, resources: current.resources },
          { kind: 'course-instance', surfaceId: target.surfaceId ?? '', instanceId: spot.instanceId, dataPath: spot.dataPath }, text)]
        : authorSpotEdits(current.editingProject, spot, text, current.resources)
      const previous = rich.success ? plainDocumentText(rich.data) : spot.initialValue
      if (text === previous) return { ok: true, changed: false }
      await bridge.editCaptured(bridge.capture(edits, current))
      return { ok: true, changed: true }
    } catch (error) { return { ok: false, reason: error instanceof Error ? error.message : '页面文字提交失败，草稿已保留' } }
  },
}
