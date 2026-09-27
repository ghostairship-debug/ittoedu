import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { ImagePlus } from 'lucide-react'
import type { AssetMeta } from '../../../shared/contracts/media-v1'
import type { ComponentAuthoringImageTarget, ComponentAuthoringTargetUpdate, ComponentAuthoringTextTarget, ComponentPackageData } from '../../../shared/componentTypes'
import type { ComponentLayerItem, RuntimeLayerItem } from '../../../shared/courseProjectTypes'
import type { RuntimeAuthoringTarget, RuntimeAuthoringTargetUpdate } from '../../../shared/runtimeTypes'
import type { StageRect } from '../../authoring/stageViewportTransform'
import type { DeepReadonly } from '../../course/flowEditorView'
import { beginRuntimeTargetEditSession, validateRuntimeTargetEditSession, type RuntimeTargetEditSession } from '../../authoring/runtimeTargetEditSession'
import { registerAuthoringObservationDraft } from '../../authoring/generation/authoringObservation'
import { registerFlowDynamicDraft } from '../../composition/runtime/flowDynamicDraftPreparation'
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
  readonly toolbarContainer?: HTMLElement | null
  readonly showRuntimeEditToggle?: boolean
  readonly onRuntimeEditModeChange?: (itemId: string, editing: boolean) => void
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
export function FlowPaperDynamicLightEdit({ documentId, projectId, surfaceId, locationId, generation, item, frame, assetUrls, componentPackages, readOnly = false, toolbarContainer, showRuntimeEditToggle = false, onRuntimeEditModeChange, onHeightChange, onRuntimeTargetsChanged, onSelectImageAsset, onStatus }: FlowPaperDynamicLightEditProps) {
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
  const activeRef = useRef<LocalTextEdit | null>(null)
  const composingRef = useRef(false)
  const runtimeEditRoot = useRef<HTMLDivElement>(null)
  const runtimePreparation = useRef<{ owner: string; pending: Promise<void> } | null>(null)
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
  activeRef.current = liveActive
  const liveBusy = busy?.owner === owner ? busy.targetId : null
  const busyRef = useRef<string | null>(null)
  busyRef.current = liveBusy
  const failedRef = useRef(false)
  failedRef.current = failedTask?.owner === owner
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
  const runtimeEditing = item.kind === 'runtime' && mode.owner === owner && mode.editing
  const modeChangeRef = useRef(onRuntimeEditModeChange)
  modeChangeRef.current = onRuntimeEditModeChange
  useEffect(() => () => { composingRef.current = false; modeChangeRef.current?.(item.layerItemId, false) }, [owner, item.layerItemId])
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
    composingRef.current = false
    setActive({ owner, target, value: course.initialValue, runtime: { session: begun.session, course } })
  }
  const beginComponentText = (target: Readonly<ComponentAuthoringTextTarget>) => {
    if (!editable || target.source !== 'auto' || !target.lightEdit || !sameTarget(target)) return
    const captured = flowComponentLightEditCommands.captureText(item.layerItemId, target.lightEdit.original, target.lightEdit.region)
    if (!captured) return report('组件文字目标已失效或已锁定')
    setActive({ owner, target, value: target.lightEdit.text, component: captured })
  }
  const commitText = async (edit: LocalTextEdit, value: string): Promise<boolean> => {
    if (!editable || ownerRef.current !== edit.owner || liveBusy) { report('编辑目标已切换或仍在确认，未写入修改'); return false }
    let intent: DynamicFallbackIntent
    if (edit.runtime) {
      if (!validateRuntimeTargetEditSession(edit.runtime.session, runtimeContext()).ok) { report('运行时文字目标已失效，未写入修改'); return false }
      intent = { ...commonIntent, kind: 'runtime.text', target: edit.runtime.course, value }
    } else if (edit.component && sameTarget(edit.target as ComponentAuthoringTextTarget)) {
      const current = useEditorStore.getState()
      const project = selectActiveCourseProjectDocument(current)
      if (project?.id !== edit.component.projectId || project.revision !== edit.component.revision
        || current.courseAuthoringSession?.token.generation !== edit.component.generation) { report('组件文字目标已失效，未写入修改'); return false }
      const target = edit.target as ComponentAuthoringTextTarget
      if (!target.lightEdit || edit.component.original === undefined) { report('组件文字目标已失效，未写入修改'); return false }
      intent = { ...commonIntent, kind: 'component.text', original: edit.component.original,
        ...(edit.component.region ? { region: edit.component.region } : {}), text: value, expectedText: target.lightEdit.text }
    } else { report('组件文字目标已失效，未写入修改'); return false }
    setActive({ ...edit, value })
    setBusy({ owner, targetId: edit.target.targetId })
    try {
      const applied = await submitFallback(intent)
      if (applied && mounted.current && ownerRef.current === owner) setActive(null)
      return applied && mounted.current && ownerRef.current === owner
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
      assetUrls={assetUrls} onHeightChange={height => { if (ownerRef.current === owner) onHeightChange?.(height) }}
      onTargetsChanged={acceptRuntime} onError={(phase, error) => { if (ownerRef.current === owner) report(`运行时 ${phase}：${error.message}`) }} />
    : <FlowPageComponent key={owner} item={item} nodeId={item.layerItemId} projectId={projectId} surfaceId={surfaceId}
      ownerKey={owner} scope="scene" x={0} y={0} width={frame.width} height={frame.height} rotation={0}
      componentPackages={componentPackages} assetUrls={assetUrls} onTargetsChanged={acceptComponent} />
  const activeRuntime = liveActive?.runtime && liveActive.target.kind === 'text' ? liveActive : null
  const activeComponent = liveActive?.component && liveActive.target.kind === 'component-text' ? liveActive : null
  const prepareRuntimeDraft = (): Promise<void> => {
    if (runtimePreparation.current?.owner === owner) return runtimePreparation.current.pending
    if (busyRef.current || failedRef.current) return Promise.reject(new Error('修改仍在确认或需要恢复，请先处理'))
    const edit = activeRef.current
    if (!edit?.runtime || edit.owner !== owner) { composingRef.current = false; return Promise.resolve() }
    if (composingRef.current) return Promise.reject(new Error('输入法组合中，请完成当前文字后再继续'))
    if (edit.value === edit.runtime.course.initialValue) { setActive(null); return Promise.resolve() }
    if (!editable) return Promise.reject(new Error('当前卡片已锁定或只读，文字草稿尚未提交'))
    const control = runtimeEditRoot.current?.querySelector<HTMLInputElement | HTMLTextAreaElement>('.canvas-plain-text-editor__control')
    if (control) control.readOnly = true
    const pending = (async () => {
      if (!await commitText(edit, edit.value)) throw new Error('修改未确认，草稿已保留')
    })()
    runtimePreparation.current = { owner, pending }
    const release = () => {
      if (runtimePreparation.current?.pending === pending) runtimePreparation.current = null
    }
    void pending.then(release, release)
    return pending
  }
  const prepareRef = useRef(prepareRuntimeDraft)
  prepareRef.current = prepareRuntimeDraft
  useEffect(() => {
    if (item.kind !== 'runtime') return
    return registerFlowDynamicDraft({ documentId, owner, prepare: () => prepareRef.current() })
  }, [documentId, owner, item.kind])
  useEffect(() => {
    if (!runtimeEditing || !activeRuntime) return
    const control = runtimeEditRoot.current?.querySelector<HTMLInputElement | HTMLTextAreaElement>('.canvas-plain-text-editor__control')
    if (!control) return
    const port = {
      read: () => {
        const edit = activeRef.current
        return { label: edit?.target.label ?? edit?.target.key ?? '', value: edit?.value ?? '',
          initialValue: edit?.runtime?.course.initialValue ?? '', composing: composingRef.current,
          bounds: edit?.target.bounds ?? { x: 0, y: 0, width: 0, height: 0 } }
      },
      commit: () => { void prepareRef.current().catch(error => report(error instanceof Error ? error.message : '修改未确认')) },
    }
    return registerAuthoringObservationDraft(control, port)
  }, [owner, runtimeEditing, activeRuntime?.target.targetId])
  const completeRuntimeEditing = async (): Promise<void> => {
    try { await prepareRuntimeDraft() } catch (error) { report(error instanceof Error ? error.message : '修改未确认'); return }
    if (mounted.current && ownerRef.current === owner) {
      setMode({ owner, editing: false })
      onRuntimeEditModeChange?.(item.layerItemId, false)
    }
  }
  const overlayStyle: CSSProperties = { position: 'absolute', inset: 0, pointerEvents: 'none' }
  return <div data-testid="flow-paper-dynamic-light-edit" style={{ position: 'relative', width: '100%', height: '100%' }}>
    {content}
    {editable && item.kind === 'runtime' && toolbarContainer && (showRuntimeEditToggle || runtimeEditing) && createPortal(<button type="button" className="secondary-button" data-testid="flow-runtime-edit-mode-toggle"
      aria-label={`${item.label ?? '运行内容'}：${runtimeEditing ? '完成编辑继续运行' : '编辑图文'}`} aria-pressed={runtimeEditing} disabled={Boolean(liveBusy)}
      onPointerDown={event => { if (liveActive) event.preventDefault(); event.stopPropagation() }}
      onClick={event => { event.stopPropagation(); if (runtimeEditing) void completeRuntimeEditing(); else { setMode({ owner, editing: true }); onRuntimeEditModeChange?.(item.layerItemId, true) } }}>
      {runtimeEditing ? '\u5b8c\u6210\u7f16\u8f91\u7ee7\u7eed\u8fd0\u884c' : '\u7f16\u8f91\u56fe\u6587'}
    </button>, toolbarContainer)}
    {failedTask?.owner === owner && (item.kind !== 'runtime' || runtimeEditing) && <div data-testid="flow-dynamic-edit-recovery" role="alert"
      style={{ position: 'absolute', zIndex: 8, left: 8, right: 8, bottom: 8, padding: 8, background: '#fff', color: '#7a2434', pointerEvents: 'auto' }}>
      <span>{failedTask.reason}</span>
      <button type="button" disabled={Boolean(liveBusy)} onClick={() => { void retryFailed() }}>重试</button>
      {failedTask.status !== 'unknown' && <button type="button" disabled={Boolean(liveBusy)} onClick={discardFailed}>取消修改</button>}
    </div>}
    {runtimeEditing && (runtimeTargets.length > 0 || activeRuntime) && <div ref={runtimeEditRoot} className="canvas-authoring-targets" data-testid="flow-runtime-light-edit-targets"
      style={overlayStyle} onPointerDown={event => event.stopPropagation()}>
      {editable && runtimeTargets.map(target => <button key={target.targetId} type="button"
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
        readOnly={Boolean(!editable || liveBusy || failedTask?.owner === owner || runtimePreparation.current?.owner === owner)}
        onDraftChange={(value, composing) => {
          if (!composing) composingRef.current = false
          if (!editable || runtimePreparation.current?.owner === owner || failedRef.current) return
          composingRef.current = composing
          if (activeRef.current?.owner === owner && activeRef.current.target.targetId === activeRuntime.target.targetId)
            activeRef.current = { ...activeRef.current, value }
          setActive(current => current?.owner === owner && current.target.targetId === activeRuntime.target.targetId
            ? { ...current, value } : current)
        }}
        onCommit={() => { void prepareRuntimeDraft().catch(error => report(error instanceof Error ? error.message : '修改未确认')) }}
        onCancel={() => { composingRef.current = false; activeRef.current = null; setActive(null) }} />}
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
