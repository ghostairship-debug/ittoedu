import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { ImagePlus } from 'lucide-react'
import type { AssetMeta } from '../../../shared/contracts/media-v1'
import type { ComponentAuthoringImageTarget, ComponentAuthoringTargetUpdate, ComponentAuthoringTextTarget, ComponentPackageData } from '../../../shared/componentTypes'
import type { ComponentLayerItem, RuntimeLayerItem } from '../../../shared/courseProjectTypes'
import type { RuntimeAuthoringTarget, RuntimeAuthoringTargetUpdate } from '../../../shared/runtimeTypes'
import type { StageRect } from '../../authoring/stageViewportTransform'
import type { DeepReadonly } from '../../course/flowEditorView'
import { beginRuntimeTargetEditSession, validateRuntimeTargetEditSession, type RuntimeTargetEditSession } from '../../authoring/runtimeTargetEditSession'
import { flowComponentLightEditCommands, type FlowComponentLightEditTarget } from '../../composition/runtime/flowDynamicLightEditCommands'
import type { DynamicFallbackIntent } from '../../composition/runtime/precommitDynamicFallback'
import type { CourseRuntimeContentTextTarget } from '../../runtime/runtimeContentTextAuthoringCommands'
import { selectActiveCourseProjectDocument, useEditorStore } from '../../store/editorStore'
import { CanvasPlainTextEditor } from '../CanvasPlainTextEditor'
import { FlowDynamicAuthoringOverlay } from './FlowDynamicAuthoringOverlay'
import { FlowPageComponent } from './FlowPageComponent'
import { FlowPageRuntime } from './FlowPageRuntime'

export interface FlowPaperDynamicLightEditProps {
  readonly documentId: string
  readonly projectId: string
  readonly surfaceId: string
  readonly locationId: string
  readonly generation: number
  readonly item: DeepReadonly<RuntimeLayerItem | ComponentLayerItem>
  /** Resolved paper frame. Its x/y belong to the outer card; targets are local. */
  readonly frame: Readonly<StageRect>
  readonly assetUrls: Readonly<Record<string, string>>
  readonly componentPackages?: Readonly<Record<string, ComponentPackageData>>
  readonly readOnly?: boolean
  readonly onHeightChange?: (height: number) => void
  readonly onRuntimeTargetsChanged?: (update: Readonly<RuntimeAuthoringTargetUpdate>) => void
  readonly onSelectImageAsset: () => Promise<{ meta: AssetMeta; bytes: Uint8Array } | null>
  readonly onStatus?: (message: string, kind?: 'success' | 'error') => void
}

type LocalTextEdit = {
  readonly owner: string
  readonly target: Readonly<RuntimeAuthoringTarget | ComponentAuthoringTextTarget>
  readonly value: string
  readonly runtime?: { readonly session: Readonly<RuntimeTargetEditSession>; readonly course: CourseRuntimeContentTextTarget }
  readonly component?: Readonly<FlowComponentLightEditTarget>
}
type TargetSnapshot = {
  readonly owner: string
  readonly runtime: ReadonlyArray<Readonly<RuntimeAuthoringTarget>>
  readonly componentText: ReadonlyArray<Readonly<ComponentAuthoringTextTarget>>
  readonly componentImage: ReadonlyArray<Readonly<ComponentAuthoringImageTarget>>
}

function localBounds(bounds: Readonly<{ x: number; y: number; width: number; height: number }>, width: number, height: number) {
  if (![bounds.x, bounds.y, bounds.width, bounds.height, width, height].every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0 || width <= 0 || height <= 0) return null
  const left = Math.max(0, bounds.x)
  const top = Math.max(0, bounds.y)
  const right = Math.min(width, bounds.x + bounds.width)
  const bottom = Math.min(height, bounds.y + bounds.height)
  return right > left && bottom > top ? { x: left, y: top, width: right - left, height: bottom - top } : null
}

/** Content and edit controls inside one already-positioned Flow paper card. */
export function FlowPaperDynamicLightEdit({ documentId, projectId, surfaceId, locationId, generation, item, frame, assetUrls, componentPackages, readOnly = false, onHeightChange, onRuntimeTargetsChanged, onSelectImageAsset, onStatus }: FlowPaperDynamicLightEditProps) {
  const owner = JSON.stringify([documentId, projectId, surfaceId, locationId, generation, item.layerItemId,
    item.kind === 'runtime' ? item.runtime.source : `${item.component.packageId}@${item.component.version}`])
  const ownerRef = useRef(owner)
  ownerRef.current = owner
  const [snapshot, setSnapshot] = useState<TargetSnapshot>({ owner, runtime: [], componentText: [], componentImage: [] })
  const snapshotRef = useRef(snapshot)
  const shown = snapshot.owner === owner ? snapshot : { owner, runtime: [], componentText: [], componentImage: [] }
  snapshotRef.current = shown
  const [mode, setMode] = useState<{ owner: string; editing: boolean }>({ owner, editing: false })
  const [active, setActive] = useState<LocalTextEdit | null>(null)
  const [busy, setBusy] = useState<{ owner: string; targetId: string } | null>(null)
  const [failedTask, setFailedTask] = useState<{ owner: string; taskId: string; status: string; reason: string } | null>(null)
  const request = useRef(0)
  const selecting = useRef(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current++ } }, [])
  useEffect(() => {
    selecting.current = false; request.current++; setBusy(null)
    const failed = useEditorStore.getState().dynamicFallbackState(documentId).find(task =>
      task.itemId === item.layerItemId && ['failed', 'conflict', 'blocked', 'unknown'].includes(task.status))
    setFailedTask(failed ? { owner, taskId: failed.taskId, status: failed.status, reason: failed.reason ?? '修改尚未确认' } : null)
  }, [owner, documentId, item.layerItemId])
  const runtimeTargets = shown.runtime
  const componentTextTargets = shown.componentText
  const componentImageTargets = shown.componentImage
  const liveActive = active?.owner === owner ? active : null
  const liveBusy = busy?.owner === owner ? busy.targetId : null
  const report = (message: string, kind: 'success' | 'error' = 'error') => onStatus?.(message, kind)
  const commonIntent = { documentId, projectId, locationId, itemId: item.layerItemId }
  const submitFallback = async (intent: DynamicFallbackIntent): Promise<boolean> => {
    try {
      const handle = useEditorStore.getState().submitDynamicFallbackIntent(intent)
      if (!handle) { report('当前文档已切换，修改未写入'); return false }
      const result = await handle.settled
      if (result.status === 'applied' || result.status === 'unchanged') {
        if (mounted.current && ownerRef.current === owner) {
          setFailedTask(null)
          report(result.status === 'unchanged' ? '内容没有变化' : '修改已确认', 'success')
        }
        return true
      }
      if (mounted.current && ownerRef.current === owner) {
        setFailedTask({ owner, taskId: result.taskId, status: result.status, reason: result.reason })
        report(`${result.reason} 修改未确认，草稿已保留`)
      }
      return false
    } catch (error) {
      if (mounted.current && ownerRef.current === owner) report(error instanceof Error ? error.message : '修改未确认，草稿已保留')
      return false
    }
  }
  const retryFailed = async (): Promise<void> => {
    if (!failedTask || failedTask.owner !== owner) return
    setBusy({ owner, targetId: 'fallback-retry' })
    try {
      const result = await useEditorStore.getState().retryDynamicFallback(failedTask.taskId)
      if (!mounted.current || ownerRef.current !== owner) return
      if (result.status === 'applied' || result.status === 'unchanged') {
        setFailedTask(null); setActive(null); report('修改已确认', 'success')
      } else {
        setFailedTask({ owner, taskId: result.taskId, status: result.status, reason: result.reason })
        report(result.reason)
      }
    } catch (error) { report(error instanceof Error ? error.message : '重试失败，草稿仍保留') }
    finally { if (mounted.current && ownerRef.current === owner) setBusy(null) }
  }
  const discardFailed = (): void => {
    if (!failedTask || failedTask.owner !== owner || failedTask.status === 'unknown') return
    try {
      useEditorStore.getState().discardDynamicFallback(failedTask.taskId)
      setFailedTask(null); setActive(null); report('未确认的修改已取消', 'success')
    } catch (error) { report(error instanceof Error ? error.message : '未能取消修改') }
  }
  const editable = !readOnly && !item.locked
  const runtimeEditing = editable && item.kind === 'runtime' && mode.owner === owner && mode.editing
  const editableRef = useRef(editable)
  editableRef.current = editable

  const acceptRuntime = (update: Readonly<RuntimeAuthoringTargetUpdate>) => {
    if (ownerRef.current !== owner || update.scope !== 'scene' || update.sceneId !== surfaceId) return
    const targets = update.targets.flatMap(target => {
      const bounds = localBounds(target.bounds, frame.width, frame.height)
      return bounds && target.scope === 'scene' ? [{ ...target, nodeId: item.layerItemId, sceneId: locationId, bounds }] : []
    })
    const next = { owner, runtime: targets, componentText: [], componentImage: [] }
    snapshotRef.current = next
    setSnapshot(next)
    onRuntimeTargetsChanged?.(update)
  }
  const acceptComponent = (update: Readonly<ComponentAuthoringTargetUpdate>) => {
    if (ownerRef.current !== owner || update.scope !== 'scene' || update.sceneId !== surfaceId || update.nodeId !== item.layerItemId) return
    const text: ComponentAuthoringTextTarget[] = []
    const image: ComponentAuthoringImageTarget[] = []
    for (const target of update.targets) {
      const bounds = localBounds(target.bounds, frame.width, frame.height)
      if (!bounds || target.nodeId !== item.layerItemId || target.source !== 'auto') continue
      if (target.kind === 'component-text' && target.lightEdit) text.push({ ...target, bounds })
      if (target.kind === 'component-image') image.push({ ...target, bounds })
    }
    const next = { owner, runtime: [], componentText: text, componentImage: image }
    snapshotRef.current = next
    setSnapshot(next)
  }
  const runtimeContext = () => ({ projectId, scope: 'scene' as const, sceneId: locationId, targets: snapshotRef.current.owner === owner ? snapshotRef.current.runtime : [] })
  const sameTarget = (target: Readonly<{ targetId: string; nodeId: string }>) => ownerRef.current === owner
    && snapshotRef.current.owner === owner && [...snapshotRef.current.componentText, ...snapshotRef.current.componentImage]
      .some(candidate => candidate.targetId === target.targetId && candidate.nodeId === target.nodeId)

  const beginRuntimeText = (target: Readonly<RuntimeAuthoringTarget>) => {
    if (!editable || target.kind !== 'text') return
    const begun = beginRuntimeTargetEditSession(target, runtimeContext())
    if (!begun.ok) return report('运行时文字目标已失效，请重新选择')
    const course = useEditorStore.getState().captureRuntimeContentTextTarget(begun.session)
    if (!course) return report('运行时文字目标已失效或已锁定')
    setActive({ owner, target, value: course.initialValue, runtime: { session: begun.session, course } })
  }
  const beginComponentText = (target: Readonly<ComponentAuthoringTextTarget>) => {
    if (!editable || target.source !== 'auto' || !target.lightEdit || !sameTarget(target)) return
    const captured = flowComponentLightEditCommands.captureText(item.layerItemId, target.lightEdit.original, target.lightEdit.region)
    if (!captured) return report('组件文字目标已失效或已锁定')
    setActive({ owner, target, value: target.lightEdit.text, component: captured })
  }
  const commitText = async (edit: LocalTextEdit, value: string): Promise<void> => {
    if (!editable || ownerRef.current !== edit.owner || liveBusy) return report('编辑目标已切换或仍在确认，未写入修改')
    let intent: DynamicFallbackIntent
    if (edit.runtime) {
      if (!validateRuntimeTargetEditSession(edit.runtime.session, runtimeContext()).ok) return report('运行时文字目标已失效，未写入修改')
      intent = { ...commonIntent, kind: 'runtime.text', target: edit.runtime.course, value }
    } else if (edit.component && sameTarget(edit.target as ComponentAuthoringTextTarget)) {
      const current = useEditorStore.getState()
      const project = selectActiveCourseProjectDocument(current)
      if (project?.id !== edit.component.projectId || project.revision !== edit.component.revision
        || current.courseAuthoringSession?.token.generation !== edit.component.generation) return report('组件文字目标已失效，未写入修改')
      const target = edit.target as ComponentAuthoringTextTarget
      if (!target.lightEdit || edit.component.original === undefined) return report('组件文字目标已失效，未写入修改')
      intent = { ...commonIntent, kind: 'component.text', original: edit.component.original,
        ...(edit.component.region ? { region: edit.component.region } : {}), text: value, expectedText: target.lightEdit.text }
    } else return report('组件文字目标已失效，未写入修改')
    setActive({ ...edit, value })
    setBusy({ owner, targetId: edit.target.targetId })
    try {
      if (await submitFallback(intent) && mounted.current && ownerRef.current === owner) setActive(null)
    } finally {
      if (mounted.current && ownerRef.current === owner) setBusy(null)
    }
  }
  const replaceRuntime = async (target: Readonly<RuntimeAuthoringTarget>) => {
    const begun = beginRuntimeTargetEditSession(target, runtimeContext())
    if (!begun.ok) return report('运行时图片目标已失效，请重新选择')
    const course = useEditorStore.getState().captureRuntimeAssetReplacementTarget(begun.session)
    if (!course) return report('运行时图片目标已失效或已锁定')
    await selectAndReplace(target.targetId, async asset => {
      if (!validateRuntimeTargetEditSession(begun.session, runtimeContext()).ok) return report('运行时图片目标已失效，未写入修改')
      await submitFallback({ ...commonIntent, kind: 'runtime.asset', target: course, asset: asset.meta, bytes: asset.bytes })
    })
  }
  const replaceComponent = async (target: Readonly<ComponentAuthoringImageTarget>) => {
    if (!sameTarget(target)) return report('组件图片目标已失效，请重新选择')
    const captured = flowComponentLightEditCommands.captureAsset(item.layerItemId, target.assetKey)
    if (!captured) return report('组件图片目标已失效或已锁定')
    await selectAndReplace(target.targetId, async asset => {
      if (!sameTarget(target)) return report('组件图片目标已失效，未写入修改')
      const current = useEditorStore.getState()
      const project = selectActiveCourseProjectDocument(current)
      if (project?.id !== captured.projectId || project.revision !== captured.revision
        || current.courseAuthoringSession?.token.generation !== captured.generation) return report('组件图片目标已失效，未写入修改')
      await submitFallback({ ...commonIntent, kind: 'component.asset', assetKey: captured.key,
        asset: asset.meta, bytes: asset.bytes,
        ...(item.kind === 'component' ? { expectedAssetId: item.assetOverrides?.[captured.key]?.assetId } : {}) })
    })
  }
  const selectAndReplace = async (targetId: string, commit: (asset: { meta: AssetMeta; bytes: Uint8Array }) => Promise<void>) => {
    if (!editable || selecting.current) return
    selecting.current = true
    const serial = ++request.current
    setBusy({ owner, targetId })
    try {
      const asset = await onSelectImageAsset()
      if (!asset || !mounted.current || request.current !== serial || ownerRef.current !== owner || !editableRef.current) return
      await commit(asset)
    } catch (error) { report(error instanceof Error ? error.message : '图片选择失败') }
    finally { if (request.current === serial) { selecting.current = false; if (mounted.current) setBusy(null) } }
  }

  const content = item.kind === 'runtime'
    ? <FlowPageRuntime key={owner} item={item} surfaceId={surfaceId} ownerKey={owner} width={frame.width} height={frame.height}
      assetUrls={assetUrls} onHeightChange={height => { if (ownerRef.current === owner) onHeightChange?.(height) }} onTargetsChanged={acceptRuntime} />
    : <FlowPageComponent key={owner} item={item} nodeId={item.layerItemId} projectId={projectId} surfaceId={surfaceId}
      ownerKey={owner} scope="scene" x={0} y={0} width={frame.width} height={frame.height} rotation={0}
      componentPackages={componentPackages} assetUrls={assetUrls} onTargetsChanged={acceptComponent} />
  const activeRuntime = liveActive?.runtime && liveActive.target.kind === 'text' ? liveActive : null
  const activeComponent = liveActive?.component && liveActive.target.kind === 'component-text' ? liveActive : null
  const overlayStyle: CSSProperties = { position: 'absolute', inset: 0, pointerEvents: 'none' }
  return <div data-testid="flow-paper-dynamic-light-edit" style={{ position: 'relative', width: '100%', height: '100%' }}>
    {content}
    {editable && item.kind === 'runtime' && <button type="button" data-testid="flow-runtime-edit-mode-toggle"
      aria-pressed={runtimeEditing} onPointerDown={event => { if (liveActive) event.preventDefault(); event.stopPropagation() }}
      onClick={event => { event.stopPropagation(); setMode({ owner, editing: !runtimeEditing }) }}
      style={{ position: 'absolute', zIndex: 9, top: 8, right: 8, pointerEvents: 'auto' }}>
      {runtimeEditing ? '\u5b8c\u6210\u7f16\u8f91\u7ee7\u7eed\u8fd0\u884c' : '\u7f16\u8f91\u56fe\u6587'}
    </button>}
    {failedTask?.owner === owner && (item.kind !== 'runtime' || runtimeEditing) && <div data-testid="flow-dynamic-edit-recovery" role="alert"
      style={{ position: 'absolute', zIndex: 8, left: 8, right: 8, bottom: 8, padding: 8, background: '#fff', color: '#7a2434', pointerEvents: 'auto' }}>
      <span>{failedTask.reason}</span>
      <button type="button" disabled={Boolean(liveBusy)} onClick={() => { void retryFailed() }}>重试</button>
      {failedTask.status !== 'unknown' && <button type="button" disabled={Boolean(liveBusy)} onClick={discardFailed}>取消修改</button>}
    </div>}
    {runtimeEditing && (runtimeTargets.length > 0 || activeRuntime) && <div className="canvas-authoring-targets" data-testid="flow-runtime-light-edit-targets"
      style={overlayStyle} onPointerDown={event => event.stopPropagation()}>
      {runtimeTargets.map(target => <button key={target.targetId} type="button"
        className={`canvas-authoring-target canvas-authoring-target--${target.kind}`}
        aria-label={`${target.label ?? target.key}，${target.kind === 'text' ? '编辑文字' : '替换图片'}`}
        disabled={liveBusy === target.targetId}
        style={{ left: target.bounds.x, top: target.bounds.y, width: target.bounds.width, height: target.bounds.height, pointerEvents: 'auto' }}
        onClick={event => { event.stopPropagation(); if (target.kind === 'text') beginRuntimeText(target); else void replaceRuntime(target) }}>
        <span className="canvas-authoring-target__badge" aria-hidden="true">{target.kind === 'asset' ? <ImagePlus size={14} /> : 'T'}<span>{target.label ?? target.key}</span></span>
      </button>)}
      {activeRuntime && <CanvasPlainTextEditor key={activeRuntime.target.targetId} bounds={activeRuntime.target.bounds}
        label={activeRuntime.target.label ?? activeRuntime.target.key} value={activeRuntime.value}
        multiline={activeRuntime.target.multiline} maxLength={activeRuntime.target.maxLength}
        onDraftChange={value => setActive(current => current?.owner === owner && current.target.targetId === activeRuntime.target.targetId
          ? { ...current, value } : current)}
        onCommit={value => commitText(activeRuntime, value)} onCancel={() => setActive(null)} />}
    </div>}
    {editable && item.kind === 'component' && <div onPointerDown={event => event.stopPropagation()}>
      <FlowDynamicAuthoringOverlay textTargets={componentTextTargets} imageTargets={componentImageTargets}
        style={overlayStyle} replacingImageTargetId={liveBusy}
        onTextActivate={beginComponentText} onImageActivate={target => { void replaceComponent(target) }}
        activeText={activeComponent ? { target: activeComponent.target as ComponentAuthoringTextTarget, value: activeComponent.value,
          onCommit: value => commitText(activeComponent, value), onCancel: () => setActive(null) } : undefined} />
    </div>}
  </div>
}
