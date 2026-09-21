import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import type { AssetMeta } from '../../shared/contracts/media-v1'
import type { FlowBlock } from '../../shared/courseProjectTypes'
import type { ComponentPackageData } from '../../shared/componentTypes'
import { documentResourceReferences } from '../../shared/document/resources'
import { FLOW_BODY_CSS, FLOW_BODY_PAPER_PADDING, FLOW_BODY_SCROLL_PADDING, flowPaperMaxWidth, resolveFlowBodyWidth } from '../../shared/flowBodyPresentation'
import { measureFlowPaperOrigin } from '../../shared/flowViewportGeometry'
import { SharedDocumentEditor, type SharedDocumentEditorHandle } from '../document'
import { createFlowDocumentResourcePort } from '../document/flowDocumentResources'
import { createDocumentClipboardContext, readDocumentClipboardContext } from '../document/documentClipboardContext'
import { componentPackageMeta } from '../components/editableComponentPackage'
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
import { flowContextSelectionIntent, resolveFlowContextSelection } from '../course/flowContextSelection'
import { requestContextualCourseCommand } from './chat/contextualCourseCommand'

export interface FlowWorkspaceProps {
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
}
const EMPTY_ASSET_FILES: Record<string, Uint8Array> = {}
const EMPTY_COMPONENT_PACKAGES: Record<string, ComponentPackageData> = {}
export function FlowWorkspace({ view, sessionToken, assets, selection, textEdit, documentDraft, commands, readOnly = false, assetFiles = EMPTY_ASSET_FILES, componentPackages = EMPTY_COMPONENT_PACKAGES }: FlowWorkspaceProps) {
  assertActiveFlowEditorView(view)
  const paperRef = useRef<HTMLElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const workspaceRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<SharedDocumentEditorHandle>(null)
  const [error, setError] = useState<string | null>(null)
  const [paperScroll, setPaperScroll] = useState({ top: 0, left: 0 })
  const [paperOrigin, setPaperOrigin] = useState({ x: 0, y: 0 })
  const viewKey = `${view.projectId}/${view.surfaceId}`
  const [panState, setPanState] = useState({ key: viewKey, x: 0, y: 0 })
  const viewPan = panState.key === viewKey ? panState : { x: 0, y: 0 }
  const setViewPan = (pan: { x: number; y: number }) => setPanState(current => current.key === viewKey && current.x === pan.x && current.y === pan.y ? current : { key: viewKey, ...pan })
  const [viewport, setViewport] = useState({ width: 1280, height: 720, nativeChrome: { right: 0, bottom: 0 } })
  const assetMimeTypes = useMemo(() => Object.fromEntries(Object.entries(assets).map(([id, asset]) => [id, asset.mimeType])), [assets])
  const assetUrls = useAssetObjectUrls(assetFiles, assetMimeTypes)
  const current = useRef({ view, sessionToken, commands }); current.current = { view, sessionToken, commands }
  const bodyWidth = resolveFlowBodyWidth(view.layout, viewport.width - viewport.nativeChrome.right)
  const objectRevision = useMemo(() => ({ assetUrls, componentPackages, bodyWidth }), [assetUrls, componentPackages, bodyWidth])
  const controller = useFlowTextAuthoringController({ view, sessionToken, selection, readOnly, textEdit, workspaceRef, commands })
  const blocks = view.blocks.filter(block => block.parentId === null).map(block => structuredClone(block.block) as FlowBlock)
  const refs = documentResourceReferences(blocks)
  const document = { content: { blocks }, resources: { assets: refs.assets.map(assetId => ({ assetId, source: { kind: 'project' as const } })), components: refs.components.map(component => ({ ...component, source: { kind: 'project' as const } })) } }
  const run = (intent: Parameters<FlowCurrentSessionCommandPort['run']>[1], blockId?: string) => {
    const value = current.current
    const receipt = value.commands.run(captureFlowEditorAuthoringTarget({ view: value.view, sessionToken: value.sessionToken, target: blockId ? { kind: 'block', blockId } : { kind: 'surface' } }), intent)
    if (!receipt.ok) setError(receipt.reason ?? '正文操作未提交')
    else setError(null)
    return receipt
  }
  const contextualCommandIssue = (target: DocumentContextSelection): string | null => {
    try {
      const currentView = current.current.view
      if (target.revision !== String(currentView.revision) || target.mode !== 'layout' || !target.selection) throw new Error('请在排版视图重新选择当前内容后发送。')
      resolveFlowContextSelection(currentView.blocks.filter(block => block.parentId === null).map(block => structuredClone(block.block) as FlowBlock), currentView.revision, target.selection)
      return null
    } catch (error) { return error instanceof Error ? error.message : String(error) }
  }
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
  const formulaOverlay = view.overlayLayers.find(layer => layer.selectionId === controller.formulaBlockId)?.item
  const [toolbarHost, setToolbarHost] = useState<HTMLDivElement | null>(null)
  const formulaNode = formulaOverlay?.kind === 'native' && formulaOverlay.content.nativeType === 'formula'
    ? flowFormulaBlockToAuthoringNode({ id: formulaOverlay.layerItemId, ...formulaOverlay.content.data } as Parameters<typeof flowFormulaBlockToAuthoringNode>[0]) : null
  const formulaDraft = controller.edit?.kind === 'formula' ? controller.edit.draft as FlowFormulaDraft : null
  return <div ref={workspaceRef} className="flow-workspace" data-testid="flow-workspace" data-flow-not-slide-stage="true"
    data-flow-project-id={view.projectId} data-flow-surface-id={view.surfaceId} data-flow-location-id={view.locationId} data-flow-active-block-id={view.activeBlockId}
    data-observation-source="authoring" data-observation-project-id={view.projectId} data-observation-revision={view.revision}
    data-observation-session-generation={sessionToken.generation} data-observation-surface-id={view.surfaceId} data-observation-location-id={view.locationId}
    data-observation-state-id="" data-observation-ready="true" data-observation-draft-token={authoringObservationDraftToken(documentDraft ?? textEdit)}
    style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', isolation: 'isolate', backgroundColor: view.backgroundColor,
      backgroundImage: view.backgroundAssetId && assetUrls[view.backgroundAssetId] ? `url(${JSON.stringify(assetUrls[view.backgroundAssetId])})` : undefined, backgroundSize: 'cover', backgroundPosition: 'center' }}>
    <div ref={setToolbarHost} className="flow-document-format-host" />
    <FlowOverlayAuthoringLayer view={view} sessionToken={sessionToken} selection={selection} locationId={selection?.locationId ?? view.locationId}
      readOnly={readOnly} assetUrls={assetUrls} componentPackages={componentPackages} paperScrollTop={paperScroll.top} paperScrollLeft={paperScroll.left}
      paperOrigin={paperOrigin} overlayViewportSize={viewport} viewPan={viewPan} onViewPanChange={setViewPan} onEditFormula={controller.openFormula}
      onBeforeGesture={() => editorRef.current?.flush().ready ?? true} commands={commands}>
      <div ref={scrollRef} className="flow-workspace__scroll flow-media-query-root" data-testid="flow-workspace-scroll" data-flow-media-query-root="true"
        onClick={event => { if (event.target === event.currentTarget && editorRef.current?.flush().ready) run({ kind: 'clear-selection' }) }}
        onScroll={event => setPaperScroll({ top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft })}
        style={{ flex: 1, position: 'relative', zIndex: 2, overflow: 'auto', height: '100%', padding: FLOW_BODY_SCROLL_PADDING, containerType: 'inline-size', containerName: 'flow-media-root', transform: `translate(${viewPan.x}px, ${viewPan.y}px)` }}>
        <article ref={paperRef} className="flow-paper flow-body-content" data-testid="flow-paper" data-flow-reading-width={view.layout.readingWidth}
          style={{ width: '100%', maxWidth: flowPaperMaxWidth(view.layout), minHeight: '100%', margin: '0 auto', padding: FLOW_BODY_PAPER_PADDING, background: 'transparent', color: '#1f2937' }}>
          <style>{FLOW_BODY_CSS}</style>
          <SharedDocumentEditor key={`${view.projectId}/${view.surfaceId}/${sessionToken.generation}`} ref={editorRef} document={document} revision={String(view.revision)} readOnly={readOnly} target="flow" toolbarHost={toolbarHost}
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
            onContextualTargetChange={target => {
              if (target?.mode === 'source') {
                const blockId = current.current.view.activeBlockId
                if (blockId) run({ kind: 'select-blocks', blockIds: [blockId], focus: 'text', textRange: null, documentSelectionIssue: 'Flow 源文选区暂不支持 AI 局部修改，请切回排版选择内容。' }, blockId)
              }
            }}
            contextualCommandIssue={contextualCommandIssue}
            onContextualCommand={(instruction, target) => {
              const issue = contextualCommandIssue(target)
              if (issue) throw new Error(issue)
              requestContextualCourseCommand({ instruction, projectId: current.current.view.projectId, sessionToken: current.current.sessionToken, documentSelection: structuredClone(target.selection!) })
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
                root.render(renderFlowPaperMedia(block, assetUrls))
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
      height: 320,
      props: block.props,
      staticFallbackAssetId: block.staticFallbackAssetId,
      components: componentPackages,
      resolveAsset: (id) => assetUrls[id],
      mode: 'edit',
      interactive: false,
    })
    const observer = new ResizeObserver(() => { if (el.clientWidth > 0) handle.resize(el.clientWidth, 320) })
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
      style={{ width: '100%', minHeight: 320, position: 'relative' }}
    />
  )
}
