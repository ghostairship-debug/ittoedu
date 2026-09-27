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
import { scheduleStaticFallbackRecapture } from '../../composition/runtime/staticFallbackRecapture'
import type { CourseRuntimeContentTextTarget } from '../../runtime/runtimeContentTextAuthoringCommands'
import { useEditorStore } from '../../store/editorStore'
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
  const [active, setActive] = useState<LocalTextEdit | null>(null)
  const [busy, setBusy] = useState<{ owner: string; targetId: string } | null>(null)
  const request = useRef(0)
  const selecting = useRef(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current++ } }, [])
  useEffect(() => { selecting.current = false; request.current++; setBusy(null) }, [owner])
  const runtimeTargets = shown.runtime
  const componentTextTargets = shown.componentText
  const componentImageTargets = shown.componentImage
  const liveActive = active?.owner === owner ? active : null
  const liveBusy = busy?.owner === owner ? busy.targetId : null
  const report = (message: string, kind: 'success' | 'error' = 'error') => onStatus?.(message, kind)
  const scheduleFallback = () => {
    const state = useEditorStore.getState()
    const handle = state.captureCourseSubmission()
    if (!handle || handle.documentId !== documentId) return report('静态后备图未能关联本次修改，请撤销后重试')
    scheduleStaticFallbackRecapture({ handle, itemId: item.layerItemId, locationId,
      amend: (commit, command) => useEditorStore.getState().amendFrozenCourseCommit(commit, command) })
  }
  const editable = !readOnly && !item.locked
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
  const commitText = (edit: LocalTextEdit, value: string) => {
    if (!editable || ownerRef.current !== edit.owner) return report('编辑目标已切换，未写入修改')
    if (edit.runtime) {
      if (!validateRuntimeTargetEditSession(edit.runtime.session, runtimeContext()).ok) return report('运行时文字目标已失效，未写入修改')
      const result = useEditorStore.getState().updateRuntimeContentTextAtTarget(edit.runtime.course, value)
      if (!result.ok) report(`${result.reason} 未写入修改`)
      else if (result.status === 'unchanged') report('运行时文字没有变化', 'success')
      else scheduleFallback()
    } else if (edit.component && sameTarget(edit.target as ComponentAuthoringTextTarget)) {
      const result = flowComponentLightEditCommands.writeText(edit.component, value)
      if (!result.ok) report(`${result.reason} 未写入修改`)
      else if (result.status === 'unchanged') report('组件文字没有变化', 'success')
      else scheduleFallback()
    } else report('组件文字目标已失效，未写入修改')
    setActive(null)
  }
  const replaceRuntime = async (target: Readonly<RuntimeAuthoringTarget>) => {
    const begun = beginRuntimeTargetEditSession(target, runtimeContext())
    if (!begun.ok) return report('运行时图片目标已失效，请重新选择')
    const course = useEditorStore.getState().captureRuntimeAssetReplacementTarget(begun.session)
    if (!course) return report('运行时图片目标已失效或已锁定')
    await selectAndReplace(target.targetId, async asset => {
      if (!validateRuntimeTargetEditSession(begun.session, runtimeContext()).ok) return report('运行时图片目标已失效，未写入修改')
      const result = useEditorStore.getState().replaceRuntimeAssetAtTarget(course, asset.meta, asset.bytes)
      if (!result.ok) report(`${result.reason} 未写入修改`)
      else if (result.status === 'unchanged') report('运行时图片没有变化', 'success')
      else scheduleFallback()
    })
  }
  const replaceComponent = async (target: Readonly<ComponentAuthoringImageTarget>) => {
    if (!sameTarget(target)) return report('组件图片目标已失效，请重新选择')
    const captured = flowComponentLightEditCommands.captureAsset(item.layerItemId, target.assetKey)
    if (!captured) return report('组件图片目标已失效或已锁定')
    await selectAndReplace(target.targetId, asset => {
      if (!sameTarget(target)) return report('组件图片目标已失效，未写入修改')
      const result = flowComponentLightEditCommands.replaceAsset(captured, asset.meta, asset.bytes)
      if (!result.ok) report(`${result.reason} 未写入修改`)
      else if (result.status === 'unchanged') report('组件图片没有变化', 'success')
      else scheduleFallback()
    })
  }
  const selectAndReplace = async (targetId: string, commit: (asset: { meta: AssetMeta; bytes: Uint8Array }) => void) => {
    if (!editable || selecting.current) return
    selecting.current = true
    const serial = ++request.current
    setBusy({ owner, targetId })
    try {
      const asset = await onSelectImageAsset()
      if (!asset || !mounted.current || request.current !== serial || ownerRef.current !== owner || !editableRef.current) return
      commit(asset)
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
    {editable && item.kind === 'runtime' && (runtimeTargets.length > 0 || activeRuntime) && <div className="canvas-authoring-targets" data-testid="flow-runtime-light-edit-targets"
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
