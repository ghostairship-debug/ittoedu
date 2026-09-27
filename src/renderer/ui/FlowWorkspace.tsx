import { captureFlowBlock, captureFlowSelection, usePinnedSelection, workbenchSelection } from '../workbench/SelectionContextController'
import { ElementAiButton } from '../workbench/elementCards/ElementAiCard'
import { TextAiButton, textCardLabel } from '../workbench/elementCards/ElementTextCards'
import { textTargetContent } from '../../core/drivers/course/elementFields'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import type { AssetMeta } from '../../shared/contracts/media-v1'
import type { FlowBlock, FlowMediaBlock } from '../../shared/courseProjectTypes'
import type { ComponentPackageData } from '../../shared/componentTypes'
import { documentResourceReferences } from '../../shared/document/resources'
import { FLOW_BODY_CSS, FLOW_BODY_PAPER_PADDING, FLOW_BODY_SCROLL_PADDING, FLOW_COMPONENT_BLOCK_HEIGHT, flowPaperMaxWidth, resolveFlowBodyWidth } from '../../shared/flowBodyPresentation'
import { measureFlowPaperOrigin } from '../../shared/flowViewportGeometry'
import type { FlowParagraphBlockRect } from '../../shared/flowParagraphAnchors'
import { resolveFlowRuntimePaperSlots } from '../../shared/flowRuntimePaperLayout'
import type { StageRect } from '../authoring/stageViewportTransform'
import { MIN_NODE_SIZE } from '../../shared/constants'
import { SharedDocumentEditor, type SharedDocumentEditorHandle } from '../document'
import { createFlowDocumentResourcePort } from '../document/flowDocumentResources'
import { createDocumentClipboardContext, readDocumentClipboardContext } from '../document/documentClipboardContext'
import { componentPackageMeta } from '../../shared/componentPackageMeta'
import type { DocumentResources } from '../../shared/document/resources'
import { assertActiveFlowEditorView, captureFlowEditorAuthoringTarget, type FlowEditorView } from '../course/flowEditorView'
import type { FlowEditorSelection } from '../course/flowEditorSlice'
import type { CourseAuthoringSessionToken } from '../authoring/courseAuthoringSession'
import { flowFormulaBlockToAuthoringNode, type FlowFormulaDraft, type FlowTextEditSession } from '../authoring/flowTextEdit'
import { FlowOverlayAuthoringLayer } from './flow/FlowOverlayAuthoringLayer'
import { useFlowTextAuthoringController, type FlowCurrentSessionCommandPort } from './flow/useFlowTextAuthoringController'
import { retainAssetObjectUrls, useAssetObjectUrls } from './useAssetObjectUrls'
import { EditableChartView } from './EditableChartView'
import { FormulaEditDialog } from './FormulaEditDialog'
import { findComponentPackageSource, mountPublishedComponent } from '../../player/surfaces/publishedComponentMount'
import { authoringObservationDraftToken } from '../authoring/generation/authoringObservation'
import type { FlowDocumentDraft } from '../store/slices/flowAuthoringSlice'
import { resolveFlowMediaLayoutProjection, FLOW_MEDIA_INLINE_SIZE_CUSTOM_PROPERTY, FLOW_MEDIA_INLINE_SIZE_REFERENCE } from '../../shared/flowMediaLayout'
import type { DocumentContextSelection } from '../../shared/document/ports'
import { flowContextSelectionIntent } from '../course/flowContextSelection'
import { resolveFlowContextSelection } from '../../core/tools/flowTextSlot'
import { cancelEditPreview, useEditPreview } from '../workbench/EditPreviewProjection'
import { usePropertiesContext } from './properties/PropertiesContextAdapter'
import { FLOW_MEDIA_ACCEPT, FlowBlockQuickActions, FlowBlockQuickMenu, flowBlockCommands, type FlowMediaKind } from './flow/FlowBlockQuickActions'
import { NativeSelectionContext } from '../workbench/NativeSelectionContext'
import { useWorkspaceMediaSource } from '../lessonWorkspace/workspaceMediaSourceContext'
import { deliverWorkspaceMediaDrop, type WorkspaceMediaDropHandler } from '../lessonWorkspace/workspaceMediaDrop'
import type { ImportedImageAsset } from '../project/assetManager'
import { WORKSPACE_MEDIA_DRAG_TYPE } from '../lessonWorkspace/workspaceMediaDrag'
import { flowMediaDropAfterBlock } from './flow/flowMediaDropPosition'
import { FlowPaperMedia } from './flow/FlowPaperMedia'
import { FlowMediaCropEditor } from './flow/FlowMediaCropEditor'
import type { FlowMediaToolPort } from './flow/flowMediaCommands'
import { measureFlowParagraphLayout, observeFlowParagraphLayout } from './flow/flowParagraphLayout'
import { flowMediaFloatAnchor } from './flow/flowMediaFloatPlacement'

export interface FlowWorkspaceProps {
  readonly documentId?: string | null
  readonly toolbarContainer?: HTMLElement | null
  readonly view: FlowEditorView
  readonly sessionToken: CourseAuthoringSessionToken
  readonly assets: Readonly<Record<string, AssetMeta>>
  readonly selection: FlowEditorSelection | null
  readonly textEdit: FlowTextEditSession | null
  readonly documentDraft?: FlowDocumentDraft | null
  readonly previewTextEdit?: FlowTextEditSession | null
  readonly commands: FlowCurrentSessionCommandPort
  readonly readOnly?: boolean
  readonly assetFiles?: Record<string, Uint8Array>
  readonly componentPackages?: Record<string, ComponentPackageData>
  readonly onDropWorkspaceMedia?: WorkspaceMediaDropHandler
  readonly onSelectImageAsset?: () => Promise<ImportedImageAsset | null>
  readonly onStatus?: (message: string) => void
}
export interface FlowBlockFocusRequest {
  readonly documentId: string
  readonly surfaceId: string
  readonly blockId: string
  readonly revision: number
}
export type FlowMenuPageCapture =
  | { readonly ok: false; readonly reason: string }
  | { readonly ok: true; readonly documentId: string; readonly projectId: string; readonly revision: number;
      readonly locationId: string; readonly surfaceId: string; readonly generation: number;
      readonly selectedBlockId: string | null; readonly selectionSignature: string; readonly paperWidth: number; readonly bodyWidth: number;
      readonly paragraphRects: readonly FlowParagraphBlockRect[] }
const flowMenuCaptureListeners = new Set<() => FlowMenuPageCapture>()
/** Flush the visible editor, then capture the page and observed layout before a menu opens a file picker. */
export function captureFlowMenuPage(): FlowMenuPageCapture {
  if (flowMenuCaptureListeners.size !== 1) return { ok: false, reason: '当前 Flow 页面尚未就绪' }
  return [...flowMenuCaptureListeners][0]()
}
const flowBlockFocusListeners = new Set<(request: FlowBlockFocusRequest) => boolean>()
/** A one-shot view focus request; an unmounted or changed document drops it. */
export function requestFlowBlockFocus(request: FlowBlockFocusRequest): boolean {
  let accepted = false
  for (const listener of flowBlockFocusListeners) accepted = listener(request) || accepted
  return accepted
}
/** A jump to a document object, asked for before its page may be on screen (an element AI card, M15). */
let pendingBlockSelection: { documentId: string; surfaceId: string; blockId: string; expires: number } | null = null
const flowBlockSelectionListeners = new Set<() => void>()
/** Selects the object once its Flow page shows it; a request not taken within two seconds is dropped. */
export function requestFlowBlockSelection(request: { documentId: string; surfaceId: string; blockId: string }): void {
  pendingBlockSelection = { ...request, expires: Date.now() + 2000 }
  for (const listener of flowBlockSelectionListeners) listener()
}
const EMPTY_ASSET_FILES: Record<string, Uint8Array> = {}
const EMPTY_COMPONENT_PACKAGES: Record<string, ComponentPackageData> = {}
export function FlowWorkspace({ documentId, view, sessionToken, assets, selection, textEdit, documentDraft, commands, readOnly = false, assetFiles = EMPTY_ASSET_FILES, componentPackages = EMPTY_COMPONENT_PACKAGES, onDropWorkspaceMedia, onSelectImageAsset, onStatus }: FlowWorkspaceProps) {
  assertActiveFlowEditorView(view)
  const mediaSource = useWorkspaceMediaSource()
  const mediaSourceRef = useRef(mediaSource)
  mediaSourceRef.current = mediaSource
  const paperRef = useRef<HTMLElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const workspaceRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<SharedDocumentEditorHandle>(null)
  const [error, setError] = useState<string | null>(null)
  const [cropTarget, setCropTarget] = useState<{ documentId: string; projectId: string; surfaceId: string; generation: number; revision: number; block: FlowMediaBlock } | null>(null)
  const [captionFocus, setCaptionFocus] = useState<{ documentId: string; projectId: string; surfaceId: string; generation: number; revision: number; blockId: string; expires: number } | null>(null)
  const [mediaDragOver, setMediaDragOver] = useState(false)
  const propertyContext = usePropertiesContext({ onReplaceImage: () => setError('请在完整属性面板中替换浮层图片。') })
  // The selected Flow document object, once the property context agrees with the editor's selection.
  const selectedBlock = (blockId: string) => propertyContext.kind === 'flow-block' && propertyContext.selection.selectedBlockId === blockId
    ? view.blocks.find(entry => entry.blockId === blockId)?.block : undefined
  const quickBarBlock = (target: DocumentContextSelection) => !readOnly && target.mode === 'layout' && target.revision === String(view.revision) && target.selection?.kind === 'object'
    ? selectedBlock(target.selection.blockId) : undefined
  // One file input serves the quick bar's 替换 and the right-click menu's 替换… (M21).
  const replacementInput = useRef<HTMLInputElement>(null)
  const replaceMedia = (kind: FlowMediaKind) => {
    const input = replacementInput.current
    if (!input) return
    input.accept = FLOW_MEDIA_ACCEPT[kind]
    input.click()
  }
  const pendingFocus = useRef<FlowBlockFocusRequest | null>(null)
  const focusTimer = useRef<number | null>(null)
  const focusExpiry = useRef<number | null>(null)
  const focusCurrent = useRef({ documentId, surfaceId: view.surfaceId, revision: view.revision, selectedBlockId: selection?.selectedBlockId, blocks: view.blocks })
  focusCurrent.current = { documentId, surfaceId: view.surfaceId, revision: view.revision, selectedBlockId: selection?.selectedBlockId, blocks: view.blocks }
  const focusWhenReady = () => {
    const request = pendingFocus.current, current = focusCurrent.current
    if (!request) return
    if (request.documentId !== current.documentId || request.surfaceId !== current.surfaceId || current.revision > request.revision) {
      pendingFocus.current = null
      if (focusExpiry.current !== null) window.clearTimeout(focusExpiry.current)
      focusExpiry.current = null
      return
    }
    if (current.revision !== request.revision || current.selectedBlockId !== request.blockId) return
    if (!current.blocks.some(entry => entry.blockId === request.blockId && entry.block.type === 'paragraph')) {
      pendingFocus.current = null
      if (focusExpiry.current !== null) window.clearTimeout(focusExpiry.current)
      focusExpiry.current = null
      return
    }
    pendingFocus.current = null
    if (focusExpiry.current !== null) window.clearTimeout(focusExpiry.current)
    focusExpiry.current = null
    if (focusTimer.current !== null) window.clearTimeout(focusTimer.current)
    focusTimer.current = window.setTimeout(() => {
      focusTimer.current = null
      const live = focusCurrent.current
      if (live.documentId === request.documentId && live.surfaceId === request.surfaceId && live.revision === request.revision && live.selectedBlockId === request.blockId) editorRef.current?.focusBlock(request.blockId)
    }, 0)
  }
  useEffect(() => {
    if (!documentId) return
    const listen = (request: FlowBlockFocusRequest) => {
      const current = focusCurrent.current
      if (request.documentId !== documentId || request.surfaceId !== view.surfaceId || request.revision < current.revision) return false
      pendingFocus.current = request
      if (focusExpiry.current !== null) window.clearTimeout(focusExpiry.current)
      focusExpiry.current = window.setTimeout(() => { if (pendingFocus.current === request) pendingFocus.current = null; focusExpiry.current = null }, 1000)
      focusWhenReady()
      return true
    }
    flowBlockFocusListeners.add(listen)
    return () => {
      flowBlockFocusListeners.delete(listen)
      pendingFocus.current = null
      if (focusTimer.current !== null) window.clearTimeout(focusTimer.current)
      focusTimer.current = null
      if (focusExpiry.current !== null) window.clearTimeout(focusExpiry.current)
      focusExpiry.current = null
    }
  }, [documentId, view.surfaceId])
  useEffect(() => { focusWhenReady() }, [documentId, view.surfaceId, view.revision, selection?.selectedBlockId])
  useEffect(() => {
    if (!documentId) return
    let timer: number | null = null
    const apply = () => {
      if (timer !== null) window.clearTimeout(timer)
      timer = null
      const request = pendingBlockSelection
      if (!request || request.documentId !== documentId || request.surfaceId !== view.surfaceId) return
      if (request.expires < Date.now()) { pendingBlockSelection = null; return }
      // The editor may still be loading this page's document; try again shortly.
      if (editorRef.current?.selectBlock(request.blockId)) pendingBlockSelection = null
      else timer = window.setTimeout(apply, 60)
    }
    flowBlockSelectionListeners.add(apply)
    apply()
    return () => { flowBlockSelectionListeners.delete(apply); if (timer !== null) window.clearTimeout(timer) }
  }, [documentId, view.surfaceId])
  const pinned = usePinnedSelection(documentId)
  const generation = useEditPreview(documentId, view.revision)
  const editPreview = useMemo(() => generation && (generation.target.kind === 'flow-block' || generation.target.kind === 'flow-range')
    && generation.target.surfaceId === view.surfaceId && !readOnly
    ? { editId: generation.editId, sequence: generation.sequence, target: generation.target, value: generation.value, cancel: () => { void cancelEditPreview(generation).catch(error => setError((error as Error).message)) } }
    : undefined, [generation, view.surfaceId, readOnly])
  const [paperScroll, setPaperScroll] = useState({ top: 0, left: 0 })
  const [paperOrigin, setPaperOrigin] = useState({ x: 0, y: 0 })
  const paperLayoutKey = `${documentId ?? ''}/${view.projectId}/${view.surfaceId}/${sessionToken.locationId}/${sessionToken.revision}/${sessionToken.generation}/${view.revision}`
  const [paperLayout, setPaperLayout] = useState<{ key: string; width: number; rects: readonly FlowParagraphBlockRect[] }>({ key: paperLayoutKey, width: 0, rects: [] })
  const viewKey = `${view.projectId}/${view.surfaceId}`
  const currentPaperLayout = paperLayout.key === paperLayoutKey ? paperLayout : { key: paperLayoutKey, width: 0, rects: [] }
  const runtimeOwnerKey = `${documentId ?? ''}/${view.projectId}/${view.surfaceId}/${sessionToken.generation}`
  const [runtimeHeights, setRuntimeHeights] = useState<{ key: string; values: Readonly<Record<string, number>> }>({ key: runtimeOwnerKey, values: {} })
  const observedRuntimeHeights = runtimeHeights.key === runtimeOwnerKey ? runtimeHeights.values : {}
  const runtimeLayout = useMemo(() => {
    const blocks = currentPaperLayout.rects.map(rect => ({ blockId: rect.blockId, top: rect.y, bottom: rect.y + rect.height }))
    const visible = new Set(blocks.map(block => block.blockId))
    const entries = view.overlayLayers.flatMap(layer => {
      if (layer.owner !== 'surface' || layer.item.paperSpace !== 'paper' || !layer.paragraphAnchor || !layer.effectiveVisible
        || layer.item.kind !== 'runtime' || !layer.item.runtime.enabled || layer.item.runtime.protocol !== 'surface-runtime'
        || layer.item.runtime.runtimeApiVersion !== 3 || layer.item.runtime.renderMode !== 'dom') return []
      let block = view.blocks.find(entry => entry.blockId === layer.paragraphAnchor?.blockId)
      while (block && !visible.has(block.blockId)) block = view.blocks.find(entry => entry.blockId === block?.parentId)
      if (!block) return []
      return [{ id: layer.selectionId, blockId: block.blockId, order: layer.stackOrder,
        observedHeight: observedRuntimeHeights[layer.selectionId] ?? layer.item.frame.height,
        offsetY: layer.paragraphAnchor.offsetY }]
    })
    const slots = resolveFlowRuntimePaperSlots(blocks, entries)
    const runtimeFrames: Record<string, StageRect> = {}
    for (const slot of slots.slots) {
      const layer = view.overlayLayers.find(layer => layer.selectionId === slot.id)
      if (!layer?.paragraphAnchor) continue
      runtimeFrames[slot.id] = { ...layer.item.frame, x: layer.paragraphAnchor.xRatio * currentPaperLayout.width,
        y: slot.top, height: slot.height }
    }
    return { runtimeFrames, runtimeSpacers: Object.entries(slots.addedAfterBlock).map(([blockId, height]) => ({ blockId, height })) }
  }, [currentPaperLayout, view.overlayLayers, view.blocks, observedRuntimeHeights])
  const onRuntimeHeightChange = (layerItemId: string, height: number) => {
    if (!Number.isFinite(height) || height < 0) return
    setRuntimeHeights(previous => {
      const values = previous.key === runtimeOwnerKey ? previous.values : {}
      return values[layerItemId] === height ? previous : { key: runtimeOwnerKey, values: { ...values, [layerItemId]: height } }
    })
  }
  const [panState, setPanState] = useState({ key: viewKey, x: 0, y: 0 })
  const viewPan = panState.key === viewKey ? panState : { x: 0, y: 0 }
  const setViewPan = (pan: { x: number; y: number }) => setPanState(current => current.key === viewKey && current.x === pan.x && current.y === pan.y ? current : { key: viewKey, ...pan })
  const [viewport, setViewport] = useState({ width: 1280, height: 720, nativeChrome: { right: 0, bottom: 0 } })
  const assetMimeTypes = useMemo(() => Object.fromEntries(Object.entries(assets).map(([id, asset]) => [id, asset.mimeType])), [assets])
  const assetUrls = useAssetObjectUrls(assetFiles, assetMimeTypes)
  const current = useRef({ documentId, view, sessionToken, commands, readOnly, selection }); current.current = { documentId, view, sessionToken, commands, readOnly, selection }
  useEffect(() => {
    const capture = (): FlowMenuPageCapture => {
      const value = current.current
      if (!value.documentId || value.readOnly || value.selection?.authoringScope !== 'page') return { ok: false, reason: '请切换到可编辑的 Flow 当前文档页' }
      const flushed = editorRef.current?.flush()
      if (!flushed?.ready || flushed.diagnostics.length) return { ok: false, reason: '请先完成当前正文输入' }
      const paper = paperRef.current
      const width = paper?.getBoundingClientRect().width ?? 0
      const padding = paper ? window.getComputedStyle(paper) : null
      const bodyWidth = Math.max(0, width - (Number.parseFloat(padding?.paddingLeft ?? '0') || 0)
        - (Number.parseFloat(padding?.paddingRight ?? '0') || 0))
      const rects = paper ? measureFlowParagraphLayout(paper) : []
      const selected = value.selection?.selectedBlockId
      const selectedBlockId = selected && value.view.blocks.some(entry => entry.blockId === selected)
        ? selected : value.view.blocks.some(entry => entry.blockId === value.view.activeBlockId) ? value.view.activeBlockId : null
      return { ok: true, documentId: value.documentId, projectId: value.view.projectId, revision: value.view.revision,
        locationId: value.view.locationId, surfaceId: value.view.surfaceId, generation: value.sessionToken.generation,
        selectedBlockId, selectionSignature: JSON.stringify(value.selection), paperWidth: width, bodyWidth, paragraphRects: rects }
    }
    flowMenuCaptureListeners.add(capture)
    return () => { flowMenuCaptureListeners.delete(capture) }
  }, [])
  const bodyWidth = resolveFlowBodyWidth(view.layout, viewport.width - viewport.nativeChrome.right)
  const objectRevision = useMemo(() => ({ assetUrls, componentPackages, bodyWidth }), [assetUrls, componentPackages, bodyWidth])
  const controller = useFlowTextAuthoringController({ view, sessionToken, selection, readOnly, textEdit, workspaceRef, commands })
  const document = useMemo(() => {
    const blocks = view.blocks.filter(block => block.parentId === null).map(block => structuredClone(block.block) as FlowBlock)
    const refs = documentResourceReferences(blocks)
    return { content: { blocks }, resources: { assets: refs.assets.map(assetId => ({ assetId, source: { kind: 'project' as const } })), components: refs.components.map(component => ({ ...component, source: { kind: 'project' as const } })) } }
  }, [view.blocks])
  const run = (intent: Parameters<FlowCurrentSessionCommandPort['run']>[1], blockId?: string) => {
    const value = current.current
    const receipt = value.commands.run(captureFlowEditorAuthoringTarget({ view: value.view, sessionToken: value.sessionToken, target: blockId ? { kind: 'block', blockId } : { kind: 'surface' } }), intent)
    if (!receipt.ok) setError(receipt.reason ?? '正文操作未提交')
    else setError(null)
    return receipt
  }
  const runOverlay = (layerItemId: string, intent: Parameters<FlowCurrentSessionCommandPort['run']>[1]) => {
    if (!editorRef.current?.flush().ready) { setError('请先完成当前正文输入，再调整纸面对象'); return }
    const value = current.current
    const receipt = value.commands.run(captureFlowEditorAuthoringTarget({
      view: value.view,
      sessionToken: value.sessionToken,
      target: { kind: 'overlay', layerItemId },
    }), intent)
    if (!receipt.ok) setError(receipt.reason ?? '纸面对象操作未提交')
    else setError(null)
  }
  const mediaToolsFor = (block: Pick<FlowMediaBlock, 'id' | 'assetId' | 'mediaKind'>): FlowMediaToolPort => {
    const captured = { documentId, projectId: view.projectId, surfaceId: view.surfaceId,
      generation: sessionToken.generation, revision: view.revision }
    const matchesCurrent = (): FlowMediaBlock | null => {
      const liveView = current.current.view
      const live = liveView.blocks.find(entry => entry.blockId === block.id)?.block
      if (captured.documentId && current.current.documentId === captured.documentId
        && liveView.projectId === captured.projectId && liveView.surfaceId === captured.surfaceId
        && current.current.sessionToken.generation === captured.generation && liveView.revision === captured.revision
        && live?.type === 'media' && live.assetId === block.assetId && live.mediaKind === block.mediaKind) {
        return structuredClone(live) as FlowMediaBlock
      }
      setError('媒体对象已变化，请重新选择')
      return null
    }
    return {
      openCrop: () => {
        const snapshot = matchesCurrent()
        if (snapshot && captured.documentId) setCropTarget({ documentId: captured.documentId, projectId: captured.projectId,
          surfaceId: captured.surfaceId, generation: captured.generation, revision: captured.revision, block: snapshot })
      },
      patchMedia: patch => { if (matchesCurrent()) run({ kind: 'patch-block', patch }, block.id) },
      openCaption: (caption, draft) => {
        if (!matchesCurrent() || !captured.documentId) { draft.cancel(); return }
        draft.cancel()
        const receipt = caption ? null : run({ kind: 'patch-block', patch: { caption: { inlines: [] } } }, block.id)
        if (receipt && !receipt.ok) return
        setCaptionFocus({ documentId: captured.documentId, projectId: captured.projectId, surfaceId: captured.surfaceId,
          generation: captured.generation, revision: captured.revision + (receipt?.historyEntry ? 1 : 0),
          blockId: block.id, expires: Date.now() + 1000 })
      },
      convertToOverlay: () => {
        if (!matchesCurrent()) return
        const paper = paperRef.current
        const media = paper?.querySelector<HTMLElement>(`[data-flow-block-id="${CSS.escape(block.id)}"] [data-flow-media-kind="${block.mediaKind}"]`)
        if (!paper || !media || currentPaperLayout.width <= 0) { setError('正文尚未完成布局，请稍后再改为浮动'); return }
        const paperRect = paper.getBoundingClientRect(), mediaRect = media.getBoundingClientRect()
        const frame = { mode: 'absolute' as const, x: mediaRect.left - paperRect.left, y: mediaRect.top - paperRect.top,
          width: mediaRect.width, height: mediaRect.height }
        if (frame.width < MIN_NODE_SIZE || frame.height < MIN_NODE_SIZE) { setError('媒体尚未完成布局，请稍后再改为浮动'); return }
        const paragraphAnchor = flowMediaFloatAnchor(block.id, frame, currentPaperLayout.width, currentPaperLayout.rects)
        if (!paragraphAnchor) { setError('找不到可挂靠的正文段落，请稍后再试'); return }
        run({ kind: 'convert-block-to-overlay', frame, paragraphAnchor }, block.id)
      },
    }
  }
  useEffect(() => {
    setCropTarget(target => target && (target.documentId !== documentId || target.projectId !== view.projectId
      || target.surfaceId !== view.surfaceId || target.generation !== sessionToken.generation
      || target.revision !== view.revision) ? null : target)
  }, [documentId, view.projectId, view.surfaceId, sessionToken.generation, view.revision])
  useEffect(() => {
    if (!captionFocus) return
    const sameIdentity = () => current.current.documentId === captionFocus.documentId
      && current.current.view.projectId === captionFocus.projectId
      && current.current.view.surfaceId === captionFocus.surfaceId
      && current.current.sessionToken.generation === captionFocus.generation
    if (!sameIdentity() || view.revision > captionFocus.revision || selection?.selectedBlockId !== captionFocus.blockId) {
      setCaptionFocus(null)
      return
    }
    if (view.revision < captionFocus.revision) return
    let timer: number | null = null
    const attempt = () => {
      timer = null
      if (!sameIdentity() || current.current.view.revision !== captionFocus.revision) { setCaptionFocus(null); return }
      if (editorRef.current?.focusSlot(captionFocus.blockId, 'caption')) { setCaptionFocus(null); return }
      if (Date.now() >= captionFocus.expires) { setError('请在正文中选择图片说明后编辑'); setCaptionFocus(null); return }
      timer = window.setTimeout(attempt, 60)
    }
    timer = window.setTimeout(attempt, 0)
    return () => { if (timer !== null) window.clearTimeout(timer) }
  }, [captionFocus, documentId, view.projectId, view.surfaceId, view.revision, sessionToken.generation, selection?.selectedBlockId])
  const contextualCommandIssue = (target: DocumentContextSelection): string | null => {
    try {
      const currentView = current.current.view
      if (target.revision !== String(currentView.revision) || target.mode !== 'layout' || !target.selection) throw new Error('请在正文中重新选择当前内容后发送。')
      resolveFlowContextSelection(currentView.blocks.filter(block => block.parentId === null).map(block => structuredClone(block.block) as FlowBlock), currentView.revision, target.selection)
      return null
    } catch (error) { return error instanceof Error ? error.message : String(error) }
  }
  // `null` reaches `onContextualTargetChange` from several places (SharedDocumentEditor.tsx:143
  // caret collapse in source mode, :217 revision change, :224 mode switch, :266 dismissal), so a
  // `null` on its own does not mean the layout editor is coming back. The committed editor decides
  // the retirement instead: `switchMode` publishes that `null` while the source editor is still
  // mounted (SharedDocumentEditor.tsx:352 renders one host at a time), so the check runs after the
  // commit that swaps them. A caret collapsed inside source mode therefore keeps the guard and the
  // block it points at, and the guard is dropped only once the source editor is really gone.
  const [sourceRetirement, setSourceRetirement] = useState(0)
  const sourceEditorMounted = () => Boolean(workspaceRef.current?.querySelector('[aria-label="正文源文编辑"]'))
  useEffect(() => {
    if (!selection?.documentSelectionIssue) return
    if (sourceEditorMounted()) return
    run({ kind: 'clear-selection' })
    // `sessionToken.generation` is in the key of the editor below (see `:146`), so bumping it
    // remounts the editor without ever calling `onContextualTargetChange`: that path retires the
    // source-mode guard too, and without this dependency the effect would not re-run and the
    // guard would outlive source mode, refusing every later selection-scope send with a message
    // about a view the user is no longer in.
  }, [selection?.documentSelectionIssue, sourceRetirement, sessionToken.generation])
  useEffect(() => {
    const selected = new Set(readOnly ? [] : selection?.selectedBlockIds ?? [])
    for (const figure of paperRef.current?.querySelectorAll<HTMLElement>('figure[data-flow-media-layout]') ?? []) {
      const block = figure.closest<HTMLElement>('[data-flow-block-id]')
      const active = Boolean(block && selected.has(block.dataset.flowBlockId!))
      if (active) figure.dataset.flowMediaSelected = 'true'
      else delete figure.dataset.flowMediaSelected
      figure.style.outline = active ? '2px solid #2563eb' : ''
      figure.style.outlineOffset = active ? '3px' : ''
    }
  }, [selection, readOnly, view.revision, objectRevision])
  useLayoutEffect(() => {
    const node = workspaceRef.current
    if (!node) return
    const update = () => {
      const rect = node.getBoundingClientRect(); const scroll = scrollRef.current
      if (rect.width > 0 && rect.height > 0) setViewport({ width: rect.width, height: rect.height, nativeChrome: { right: scroll ? Math.max(0, scroll.offsetWidth - scroll.clientWidth) : 0, bottom: scroll ? Math.max(0, scroll.offsetHeight - scroll.clientHeight) : 0 } })
      if (scroll && paperRef.current) setPaperOrigin(measureFlowPaperOrigin(node, scroll, paperRef.current, 1, viewPan))
    }
    update(); const observer = new ResizeObserver(update); observer.observe(node)
    if (paperRef.current) observer.observe(paperRef.current)
    return () => observer.disconnect()
  }, [viewPan.x, viewPan.y])
  useLayoutEffect(() => {
    const paper = paperRef.current
    if (!paper) return
    return observeFlowParagraphLayout(paper, rects => {
      const width = paper.getBoundingClientRect().width
      setPaperLayout(previous => previous.key === paperLayoutKey && previous.width === width && previous.rects.length === rects.length
        && previous.rects.every((rect, index) => {
          const next = rects[index]
          return next && rect.blockId === next.blockId && rect.depth === next.depth
            && rect.x === next.x && rect.y === next.y && rect.width === next.width && rect.height === next.height
        }) ? previous : { key: paperLayoutKey, width, rects })
    })
  }, [paperLayoutKey])
  const formulaOverlay = view.overlayLayers.find(layer => layer.selectionId === controller.formulaBlockId)?.item
  const [toolbarHost, setToolbarHost] = useState<HTMLDivElement | null>(null)
  const formulaNode = formulaOverlay?.kind === 'native' && formulaOverlay.content.nativeType === 'formula'
    ? flowFormulaBlockToAuthoringNode({ id: formulaOverlay.layerItemId, ...formulaOverlay.content.data } as Parameters<typeof flowFormulaBlockToAuthoringNode>[0]) : null
  const formulaDraft = controller.edit?.kind === 'formula' ? controller.edit.draft as FlowFormulaDraft : null
  const dropWorkspaceMedia = (event: React.DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes(WORKSPACE_MEDIA_DRAG_TYPE) || !onDropWorkspaceMedia) return
    event.preventDefault(); event.stopPropagation(); setMediaDragOver(false)
    if (readOnly || !paperRef.current?.querySelector('.ProseMirror')) {
      setError('请切换到可编辑的 Flow 正文后拖入媒体')
      return
    }
    if (!editorRef.current?.flush().ready) { setError('请先完成当前正文输入，再拖入媒体'); return }
    const afterBlockId = flowMediaDropAfterBlock(paperRef.current, view.blocks.map(entry => entry.blockId), event.clientY)
    const target = { documentId: documentId ?? null, projectId: view.projectId, revision: view.revision,
      locationId: view.locationId, surfaceId: view.surfaceId, sessionGeneration: sessionToken.generation }
    const raw = event.dataTransfer.getData(WORKSPACE_MEDIA_DRAG_TYPE)
    void deliverWorkspaceMediaDrop(raw, mediaSource, { surface: 'flow', afterBlockId }, target, onDropWorkspaceMedia,
      () => mediaSourceRef.current.directory === mediaSource.directory && mediaSourceRef.current.files === mediaSource.files)
      .then(result => { if (!result.ok) setError(result.reason ?? '媒体未插入') })
  }
  return <div ref={workspaceRef} className="flow-workspace" data-testid="flow-workspace" data-flow-not-slide-stage="true"
    data-flow-project-id={view.projectId} data-flow-surface-id={view.surfaceId} data-flow-location-id={view.locationId} data-flow-active-block-id={view.activeBlockId}
    data-observation-source="authoring" data-observation-project-id={view.projectId} data-observation-revision={view.revision}
    data-observation-session-generation={sessionToken.generation} data-observation-surface-id={view.surfaceId} data-observation-location-id={view.locationId}
    data-observation-state-id="" data-observation-ready="true" data-observation-draft-token={authoringObservationDraftToken(documentDraft ?? textEdit)}
    style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', isolation: 'isolate', backgroundColor: view.backgroundColor,
      backgroundImage: view.backgroundAssetId && assetUrls[view.backgroundAssetId] ? `url(${JSON.stringify(assetUrls[view.backgroundAssetId])})` : undefined, backgroundSize: 'cover', backgroundPosition: 'center' }}>
    <div ref={setToolbarHost} className="flow-document-format-host" />
    <NativeSelectionContext documentId={documentId} revision={view.revision} locationId={selection?.locationId ?? view.locationId} itemIds={selection?.selectedOverlayIds ?? []}
      enabled={!readOnly} ownsDocumentSelection={false} textEditing={Boolean(textEdit)} />
    <FlowOverlayAuthoringLayer view={view} sessionToken={sessionToken} selection={selection} locationId={selection?.locationId ?? view.locationId}
      documentId={documentId} onSelectImageAsset={onSelectImageAsset}
      onDynamicStatus={(message, kind) => { if (kind === 'error') setError(message); else onStatus?.(message) }}
      readOnly={readOnly} assetUrls={assetUrls} componentPackages={componentPackages} paperScrollTop={paperScroll.top} paperScrollLeft={paperScroll.left}
      paperOrigin={paperOrigin} paperWidth={currentPaperLayout.width} paragraphRects={currentPaperLayout.rects}
      runtimeFrames={runtimeLayout.runtimeFrames} onRuntimeHeightChange={onRuntimeHeightChange}
      overlayViewportSize={viewport} viewPan={viewPan} onViewPanChange={setViewPan} onEditFormula={controller.openFormula}
      onBodyPlaneChange={(layerItemId, bodyPlane) => runOverlay(layerItemId, { kind: 'patch-overlay-body-plane', bodyPlane })}
      onBeforeGesture={() => editorRef.current?.flush().ready ?? true} commands={commands}>
      <div ref={scrollRef} className="flow-workspace__scroll flow-media-query-root" data-testid="flow-workspace-scroll" data-flow-media-query-root="true"
        onClick={event => { if (event.target === event.currentTarget && editorRef.current?.flush().ready) run({ kind: 'clear-selection' }) }}
        onScroll={event => setPaperScroll({ top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft })}
        style={{ flex: 1, position: 'relative', zIndex: 2, overflow: 'auto', height: '100%', padding: FLOW_BODY_SCROLL_PADDING, containerType: 'inline-size', containerName: 'flow-media-root', transform: `translate(${viewPan.x}px, ${viewPan.y}px)` }}>
        <input ref={replacementInput} type="file" hidden tabIndex={-1} aria-label="替换文档中的媒体文件" onClick={event => event.stopPropagation()} onChange={event => {
          const file = event.target.files?.[0]; event.target.value = ''
          if (!file || propertyContext.kind !== 'flow-block') return
          const blockCommands = propertyContext.commands
          void file.arrayBuffer()
            .then(bytes => blockCommands.importReplacementMedia({ name: file.name, mimeType: file.type, bytes: new Uint8Array(bytes) }))
            .catch(() => blockCommands.reportError('媒体文件读取失败'))
        }} />
        <article ref={paperRef} className="flow-paper flow-body-content" data-testid="flow-paper" data-flow-reading-width={view.layout.readingWidth}
          data-workspace-media-drop={mediaDragOver || undefined}
          onDragOverCapture={event => { if (onDropWorkspaceMedia && event.dataTransfer.types.includes(WORKSPACE_MEDIA_DRAG_TYPE)) { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'copy'; setMediaDragOver(!readOnly && Boolean(paperRef.current?.querySelector('.ProseMirror'))) } }}
          onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setMediaDragOver(false) }}
          onDropCapture={dropWorkspaceMedia}
          style={{ width: '100%', maxWidth: flowPaperMaxWidth(view.layout), minHeight: '100%', margin: '0 auto', padding: FLOW_BODY_PAPER_PADDING, background: 'transparent', color: '#1f2937', boxShadow: mediaDragOver ? 'inset 0 0 0 3px #245b46' : undefined }}>
          <style>{FLOW_BODY_CSS}</style>
          <SharedDocumentEditor key={`${view.projectId}/${view.surfaceId}/${sessionToken.generation}`} ref={editorRef} document={document} revision={String(view.revision)} readOnly={readOnly} target="flow" toolbarHost={toolbarHost}
            editPreview={editPreview}
            runtimeSpacers={runtimeLayout.runtimeSpacers}
            objectRevision={objectRevision}
            clipboardContext={(resources: DocumentResources) => createDocumentClipboardContext(resources, { assets, assetFiles, componentPackages })}
            clipboardResourcePort={context => {
              const source = readDocumentClipboardContext(context)
              return createFlowDocumentResourcePort({
                target: { id: view.projectId, revision: view.revision, assets: { ...assets }, componentPackages: Object.fromEntries(Object.entries(componentPackages).map(([id, data]) => [id, componentPackageMeta(data)])) },
                resolveAsset: source.resolveAsset, prepareComponent: ref => source.prepareComponent(ref),
              })
            }}
            sourceDraft={documentDraft?.surfaceId === view.surfaceId ? documentDraft.source : undefined}
            onChange={(next, operation) => run({ kind: 'replace-document-content', blocks: next.content.blocks, historyGroup: operation.historyGroup, preparedResources: operation.preparedResources }).ok}
            onDraft={(source, diagnostics) => { if (diagnostics.length) { run({ kind: 'update-document-draft', source, diagnostics, composing: false }); setError('源文尚有错误，当前草稿不能提交到工程') } else run({ kind: 'clear-document-draft' }) }}
            onCompositionChange={(composing, source) => { if (composing) run({ kind: 'update-document-draft', source, diagnostics: [], composing }); else if (!editorRef.current?.flush().diagnostics.length) run({ kind: 'clear-document-draft' }) }}
            onUndo={() => run({ kind: 'document-history', direction: 'undo' })} onRedo={() => run({ kind: 'document-history', direction: 'redo' })}
            pinnedTargets={pinned?.revision === view.revision ? pinned?.targets : undefined}
            onContextualTargetChange={target => {
              if (documentId) void workbenchSelection.observe(documentId, view.revision, snapshot => target?.mode === 'layout' ? captureFlowSelection(snapshot, view.surfaceId, target) : null)
              if (target?.mode === 'source') {
                const blockId = current.current.view.activeBlockId
                if (blockId) run({ kind: 'select-blocks', blockIds: [blockId], focus: 'text', textRange: null, documentSelectionIssue: 'Flow 源文选区暂不支持 AI 局部修改，请切回正文选择内容。' }, blockId)
                return
              }
              // The source-mode guard must not outlive source mode, but it must survive everything
              // the source editor retires a target for while it is still on screen. Leaving the
              // issue behind after a real return to layout would refuse the next selection-scope
              // send with a source-view message the user cannot see; clearing it on a caret
              // collapse inside source mode would silently widen that send to the whole page.
              if (selection?.documentSelectionIssue) setSourceRetirement(count => count + 1)
            }}
            contextualCommandIssue={contextualCommandIssue}
            onContextualCommand={async (instruction, target) => {
              const issue = contextualCommandIssue(target)
              if (issue) throw new Error(issue)
              if (!documentId) throw new Error('文档尚未就绪。')
              const snapshot = await workbenchSelection.prepare(documentId)
              await workbenchSelection.request(captureFlowSelection(snapshot, current.current.view.surfaceId, target), instruction)
            }}
            renderQuickBarActions={target => {
              const block = quickBarBlock(target)
              return block && propertyContext.kind === 'flow-block' ? <FlowBlockQuickActions block={block} commands={propertyContext.commands} replaceMedia={replaceMedia} mediaTools={block.type === 'media' ? mediaToolsFor(block) : undefined} /> : null
            }}
            renderAiButton={(target, issue) => {
              // Selected text opens a text card (M15); it stays until closed and follows its text through follow-ups.
              if (target.selection?.kind === 'text' && target.mode === 'layout' && documentId && !readOnly) {
                const surfaceId = view.surfaceId, label = textCardLabel(target.ranges?.map(range => range.before).join('') || '所选文字')
                return <TextAiButton documentId={documentId} disabledReason={issue ?? contextualCommandIssue(target)} start={async () => {
                  const snapshot = await workbenchSelection.prepare(documentId)
                  const capture = captureFlowSelection(snapshot, surfaceId, target), range = capture.targets[0]
                  if (capture.targets.length !== 1 || range?.kind !== 'flow-range') throw new Error('请在一段文字内选择要修改的内容。')
                  return { target: range, label, content: textTargetContent(snapshot.model, range) }
                }} />
              }
              // A picture, table or other object of the document has its own AI card (M15).
              const blockId = target.selection?.kind === 'object' ? target.selection.blockId : target.selection?.kind === 'cells' ? target.selection.tableId : null
              const entry = blockId && !readOnly ? view.blocks.find(value => value.blockId === blockId) : undefined
              if (!entry || !documentId) return undefined
              const surfaceId = view.surfaceId, label = entry.label || target.label
              return <ElementAiButton documentId={documentId} target={{ kind: 'flow-block', surfaceId, blockId: entry.blockId, parentId: entry.parentId }} label={label}
                disabledReason={target.mode === 'layout' ? null : '请切回正文后再用 AI 修改。'}
                capture={async () => captureFlowBlock(await workbenchSelection.prepare(documentId), surfaceId, entry.blockId, label)} />
            }}
            renderQuickBarMenu={target => {
              const block = quickBarBlock(target)
              return block && propertyContext.kind === 'flow-block' ? <FlowBlockQuickMenu block={block} commands={propertyContext.commands} replaceMedia={replaceMedia} mediaTools={block.type === 'media' ? mediaToolsFor(block) : undefined} /> : null
            }}
            objectMenu={blockId => {
              const block = readOnly ? undefined : selectedBlock(blockId)
              return block && propertyContext.kind === 'flow-block' ? flowBlockCommands(block, propertyContext.commands, replaceMedia, block.type === 'media' ? mediaToolsFor(block) : undefined) : []
            }}
            onSelection={next => {
              if (!next) { run({ kind: 'clear-selection' }); return }
              const intent = flowContextSelectionIntent(next)
              run(intent, intent.blockIds[0])
            }}
            renderObject={(block, host) => {
              const root = createRoot(host)
              const releaseUrls = retainAssetObjectUrls(assetUrls)
              if (block.type === 'media') {
                const projection = resolveFlowMediaLayoutProjection(block.layout, view.layout)
                const wrapped = block.wrap === 'left' || block.wrap === 'right'
                const selected = !readOnly && Boolean(selection?.selectedBlockIds.includes(block.id))
                const figure = host.parentElement!
                figure.className = `flow-block-media ${projection.className}`
                figure.dataset.flowMediaLayout = block.layout; figure.dataset.flowMediaWidthTier = projection.tier
                if (selected) figure.dataset.flowMediaSelected = 'true'; else delete figure.dataset.flowMediaSelected
                figure.style.setProperty(FLOW_MEDIA_INLINE_SIZE_CUSTOM_PROPERTY, projection.inlineSize)
                Object.assign(figure.style, { outline: selected ? '2px solid #2563eb' : '', outlineOffset: selected ? '3px' : '', width: wrapped ? projection.wrappedOuterInlineSize : FLOW_MEDIA_INLINE_SIZE_REFERENCE, maxWidth: wrapped ? '100%' : FLOW_MEDIA_INLINE_SIZE_REFERENCE, inlineSize: wrapped ? projection.wrappedOuterInlineSize : FLOW_MEDIA_INLINE_SIZE_REFERENCE, maxInlineSize: wrapped ? '100%' : FLOW_MEDIA_INLINE_SIZE_REFERENCE, cssFloat: wrapped ? block.wrap : 'none', position: 'relative', left: wrapped ? '' : '50%', transform: wrapped ? '' : 'translateX(-50%)', margin: wrapped ? block.wrap === 'left' ? '0 16px 8px 0' : '0 0 8px 16px' : '0' })
                root.render(block.mediaKind === 'image' ? <FlowPaperMedia block={block} url={assetUrls[block.assetId]} /> : renderFlowPaperMedia(block, assetUrls))
              }
              if (block.type === 'component') {
                if ((block.wrap === 'left' || block.wrap === 'right') && host.parentElement) { host.parentElement.style.cssFloat = block.wrap; host.parentElement.style.width = '48%'; host.parentElement.style.margin = block.wrap === 'left' ? '0 16px 8px 0' : '0 0 8px 16px' }
                root.render(<FlowComponentBlockView projectId={view.projectId} block={block} readingWidth={bodyWidth} componentPackages={componentPackages} assetUrls={assetUrls} />)
              }
              if (block.type === 'chart') root.render(<EditableChartView id={block.id} chart={block.chart} width={bodyWidth} height={block.height}
                onCommit={readOnly ? undefined : chart => { const receipt = run({ kind: 'patch-block', patch: { chart } }, block.id); return receipt.ok ? null : receipt.reason ?? '图表未提交' }}
                onHeightCommit={readOnly ? undefined : height => { run({ kind: 'patch-block', patch: { height } }, block.id) }} />)
              return () => { queueMicrotask(() => { try { root.unmount() } finally { releaseUrls() } }) }
            }} />
          {error && <p role="alert">{error}</p>}
        </article>
      </div>
    </FlowOverlayAuthoringLayer>
    {cropTarget && cropTarget.documentId === documentId && cropTarget.projectId === view.projectId
      && cropTarget.surfaceId === view.surfaceId && cropTarget.generation === sessionToken.generation
      && cropTarget.revision === view.revision && <div style={{ position: 'absolute', inset: 0, zIndex: 40, display: 'grid', placeItems: 'center', background: '#0008' }}>
        <div style={{ width: 'min(520px, 90%)', maxHeight: '90%', overflow: 'auto', padding: 20, borderRadius: 8, background: '#fff', boxShadow: '0 18px 48px #0004' }}>
          <FlowMediaCropEditor block={cropTarget.block} url={assetUrls[cropTarget.block.assetId]} onCancel={() => setCropTarget(null)} onConfirm={patch => {
            const live = current.current
            const liveBlock = live.view.blocks.find(entry => entry.blockId === cropTarget.block.id)?.block
            if (live.documentId !== cropTarget.documentId || live.view.projectId !== cropTarget.projectId
              || live.view.surfaceId !== cropTarget.surfaceId || live.sessionToken.generation !== cropTarget.generation
              || live.view.revision !== cropTarget.revision || liveBlock?.type !== 'media'
              || liveBlock.mediaKind !== 'image' || liveBlock.assetId !== cropTarget.block.assetId) {
              setError('图片已变化，请重新打开裁剪')
              setCropTarget(null)
              return
            }
            if (run({ kind: 'patch-block', patch }, cropTarget.block.id).ok) setCropTarget(null)
          }} />
        </div>
      </div>}
    {formulaNode && formulaDraft && <FormulaEditDialog node={formulaNode} draftSource={formulaDraft.source} onDraftChange={controller.updateFormulaDraft}
      onCompositionChange={controller.setFormulaComposing} onCancel={controller.cancelCurrent} onCommit={controller.commitFormula} />}
  </div>
}
function renderFlowPaperMedia(
  block: Extract<FlowBlock, { type: 'media' }>,
  assetUrls: Record<string, string>,
): ReactNode {
  const url = assetUrls[block.assetId]
  if (block.mediaKind === 'image') {
    return (
      <img
        data-flow-asset-id={block.assetId}
        data-flow-media-kind="image"
        {...(url ? { src: url } : {})}
        alt={block.altText ?? ''}
        style={{ maxWidth: '100%', display: 'block' }}
      />
    )
  }
  if (block.mediaKind === 'video') {
    return (
      <video
        data-flow-asset-id={block.assetId}
        data-flow-media-kind="video"
        {...(url ? { src: url } : {})}
        aria-label={block.altText ?? ''}
        controls
        muted
        playsInline
        preload="metadata"
        style={{ maxWidth: '100%', display: 'block' }}
      />
    )
  }
  return (
    <div className="flow-media-placeholder" data-flow-media-kind="audio">
      音频占位符
    </div>
  )
}


function FlowComponentBlockView({
  projectId,
  block,
  readingWidth,
  componentPackages,
  assetUrls,
}: {
  projectId: string
  block: Extract<FlowBlock, { type: 'component' }>
  readingWidth: number
  componentPackages?: Record<string, ComponentPackageData>
  assetUrls: Record<string, string>
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const pkg = findComponentPackageSource(componentPackages, block.component.packageId, block.component.version)
  const fallbackUrl = block.staticFallbackAssetId ? assetUrls[block.staticFallbackAssetId] : undefined

  useEffect(() => {
    const el = containerRef.current
    if (!el || !pkg) return
    const handle = mountPublishedComponent(el, {
      projectId,
      container: el,
      componentId: block.component.packageId,
      version: block.component.version,
      instanceId: block.id,
      width: el.clientWidth || readingWidth,
      height: FLOW_COMPONENT_BLOCK_HEIGHT,
      props: block.props,
      staticFallbackAssetId: block.staticFallbackAssetId,
      components: componentPackages,
      resolveAsset: (id) => assetUrls[id],
      mode: 'edit',
      interactive: false,
    })
    const observer = new ResizeObserver(() => { if (el.clientWidth > 0) handle.resize(el.clientWidth, FLOW_COMPONENT_BLOCK_HEIGHT) })
    observer.observe(el)
    return () => { observer.disconnect(); handle.destroy() }
  }, [block.component.packageId, block.component.version, block.id, block.props, block.staticFallbackAssetId, componentPackages, assetUrls, pkg, projectId])

  if (!pkg) {
    return (
      <aside
        data-flow-component-package-id={block.component.packageId}
        data-flow-component-version={block.component.version}
      >
        {fallbackUrl ? (
          <img
            src={fallbackUrl}
            data-flow-static-fallback-asset-id={block.staticFallbackAssetId}
            alt={`${block.component.packageId} 后备`}
            style={{ maxWidth: '100%', display: 'block' }}
          />
        ) : null}
        <strong>互动组件：{block.component.packageId}</strong>
        <p>版本 {block.component.version}</p>
      </aside>
    )
  }

  return (
    <div
      ref={containerRef}
      data-flow-component-package-id={block.component.packageId}
      data-flow-component-version={block.component.version}
      style={{ width: '100%', minHeight: FLOW_COMPONENT_BLOCK_HEIGHT, position: 'relative' }}
    />
  )
}
