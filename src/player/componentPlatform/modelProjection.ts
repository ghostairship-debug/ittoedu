import {allDocumentTextSlots,inlineComponentIds,documentInlineChildIds} from '../../shared/document/textInteraction'
import {paintComponentSpatialGraph} from './paintSpatialGraph'
import {bindSpatialInput} from './spatialInput'
import { mountComponentFlowToc } from './flowToc'
import type { ComponentInstance, ComponentSurface, CourseProjectV10 } from '../../shared/contracts/component-platform'
import { resolveComponentBackground, isComponentVisibleAtSurface, componentDefinitionBuiltinKey, owningContainer } from '../../shared/contracts/component-platform'
import { resolveComponentOuterPresentation } from '../../shared/componentPresentation'
import { applyComponentBackgroundPaint } from '../../shared/componentBackgroundPaint'
import { transformPoint } from '../../core/components/geometry'
import { createTeacherControllerHudGeometry, teacherControllerReferenceSize, isViewportComponent, projectTeacherControllerInstances, type TeacherControllerDisplayPort } from '../../shared/teacherControllerViewportGeometry'
import { flowParagraphAnchoredFrame, type FlowParagraphBlockRect } from '../../shared/flowParagraphAnchors'
import { FLOW_BODY_PAPER_PADDING, FLOW_BODY_SCROLL_PADDING, flowPaperMaxWidth, FLOW_BODY_FONT_FAMILY, resolveFlowPaperBackground } from '../../shared/flowBodyPresentation'
import type { FlowMediaLayoutWidths } from '../../shared/flowMediaLayout'
import { renderDocumentText } from '../../shared/document/render'
import type { FlowTextContent } from '../../shared/document/content'
import { componentSurfaceGeometryTargets } from './spatialTargets'
import { spatialComponentCenter, spatialConnectionSegments, spatialConnectionTargets, spatialPathPoints, spatialPathTargetIds, spatialRelationLabelPosition, spatialSemanticVisible } from '../surfaces/spatial/componentPlatform/graph'
import {
  componentFrameStyle, componentSpatialCameraMatrix, createComponentSpatialAdapter, createComponentSpatialCameraPort, panComponentSpatialCamera, zoomComponentSpatialCamera,
  type ComponentSpatialAdapter, type ComponentSpatialCameraPort,
} from '../surfaces/spatial/componentSpatialAdapter'
import type { ComponentPlatformRuntime } from '../components/ComponentPlatformRuntime'
import { applyComponentPaintStyle } from '../components/componentPlacementStyle'
import { PlaybackViewSession, createPlaybackContent } from '../playbackViewSession'
import { createStageGeometry } from '../../shared/stageViewport'
import type { ComponentPlayerProjection, ComponentPlayerModel, ComponentPlayerObservation } from './ModelPlayer'

interface NodeView { outer: HTMLElement; stage: HTMLElement; content: HTMLElement; children: HTMLElement; caption?: HTMLElement; sectionDefaultCollapsed?: boolean; flow?: boolean; flowLayout?: FlowMediaLayoutWidths }
interface SurfaceView {
  root: HTMLElement
  kind: ComponentSurface['kind']
  spatial?: ComponentSpatialAdapter
  camera?: ComponentSpatialCameraPort
  releaseCamera?: () => void
  releaseInput?: () => void
  playback?: PlaybackViewSession
  observation?: ComponentPlayerObservation
  content?: HTMLElement
  designSize?: ComponentSurface['designSize']
  flow?: { scroll: HTMLElement; scrollPaddingBottom: number; paper: HTMLElement; body: HTMLElement; paperUnderlay: HTMLElement; paperOverlay: HTMLElement; viewportUnderlay: HTMLElement; viewportOverlay: HTMLElement }
  graph?: SVGSVGElement
  releaseGraph?: () => void
  toc?: ReturnType<typeof mountComponentFlowToc>
}

/** DOM placement only: no professional rendering, author writes, or navigation sequence. */
export function createComponentModelProjection(context: {
  root: HTMLElement; runtime: ComponentPlatformRuntime; signal: AbortSignal
  initialSurfaceId?: string
  teacherController?: TeacherControllerDisplayPort
  onCamera?(surfaceId: string, camera: ComponentSpatialCameraPort): () => void
}): ComponentPlayerProjection {
  const { root, runtime } = context
  const document = root.ownerDocument
  const shell = document.createElement('div')
  shell.dataset.componentModelPlayer = ''
  Object.assign(shell.style, { position: 'relative', isolation: 'isolate', width: '100%', height: '100%', transformOrigin: '0 0' })
  const plane = (name: string, zIndex: string) => {
    const element = document.createElement('div')
    element.dataset.componentPlane = name
    Object.assign(element.style, { position: 'absolute', inset: '0px', zIndex, pointerEvents: 'none' })
    shell.append(element)
    return element
  }
  const underlay = plane('underlay', '0')
  const surfacePlane = plane('surface', '1')
  const overlay = plane('overlay', '2')
  root.append(shell)
  const nodes = new Map<string, NodeView>()
  const surfaces = new Map<string, SurfaceView>()
  let activeSurface = context.initialSurfaceId
  let projectId: string | undefined
  let disposed = false
  let currentProject: CourseProjectV10 | undefined
  let currentModel: ComponentPlayerModel | undefined
  function paintFlowScrollClearance() {
    const project = currentProject, view = surfaces.get(activeSurface ?? ''), flow = view?.flow
    if (!project || !flow || !view?.playback) return
    const scrollBox = flow.scroll.getBoundingClientRect(), paperBox = flow.body.getBoundingClientRect()
    const viewport = view.playback.viewportElement?.getBoundingClientRect() ?? view.root.getBoundingClientRect()
    const scale = scrollBox.height / flow.scroll.offsetHeight
    if (!(scale > 0)) return
    const left = Math.max(scrollBox.left, viewport.left, paperBox.left), right = Math.min(scrollBox.right, viewport.right, paperBox.right)
    const top = Math.max(scrollBox.top, viewport.top), bottom = Math.min(scrollBox.bottom, viewport.bottom)
    const lastBlock = Array.from(flow.body.children).reverse().find(element => {
      const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0
    })
    const trailing = lastBlock ? Math.max(0, flow.paper.getBoundingClientRect().bottom - lastBlock.getBoundingClientRect().bottom) / scale : 0
    let padding = flow.scrollPaddingBottom
    for (const id of project.global.overlay) {
      const node = nodes.get(id)
      if (!node || node.outer.hidden || !isViewportComponent(project, id)) continue
      const dock = node.outer.getBoundingClientRect()
      if (dock.width > 0 && dock.height > 0 && dock.left < right && dock.right > left && dock.top < bottom && dock.bottom > top) {
        // Existing paper/last-block spacing already clears part of the visible dock.
        // Invert content fit/observation only for the remaining end-of-document travel.
        padding = Math.max(padding, (scrollBox.bottom - Math.max(top, dock.top)) / scale - trailing)
      }
    }
    const value = `${padding}px`
    if (flow.scroll.style.paddingBottom === value) return
    const atEnd = flow.scroll.scrollTop + flow.scroll.clientHeight >= flow.scroll.scrollHeight - 1
    flow.scroll.style.paddingBottom = value
    if (atEnd) flow.scroll.scrollTop = flow.scroll.scrollHeight
  }
  const paintControllerPlacement = () => {
    const project = currentProject
    if (!project || disposed) return
    const geometry = createTeacherControllerHudGeometry({ referenceSize: teacherControllerReferenceSize(project),
      viewportRect: { x: 0, y: 0, width: root.clientWidth, height: root.clientHeight },
      controllerInsets: surfaces.get(activeSurface ?? '')?.playback?.chrome.controllerInsets })
    const display = projectTeacherControllerInstances(project, geometry, context.teacherController)
    for (const id of [...project.global.underlay, ...project.global.overlay]) {
      if (!isViewportComponent(project, id)) continue
      const node = nodes.get(id), frame = display.instances[id]?.frame
      if (node && frame) {
        Object.assign(node.outer.style, componentFrameStyle(frame))
      }
    }
    paintFlowScrollClearance()
  }

  function placeNode(node: NodeView, instance: ComponentInstance, project: CourseProjectV10, inlineSize: number) {
    const presentation = resolveComponentOuterPresentation(project, instance, { placement: node.flow ? 'flow' : 'free', purpose: 'playback', inlineSize, flowLayout: node.flowLayout })
    Object.assign(node.outer.style, presentation.outerStyle)
    Object.assign(node.stage.style, presentation.stageStyle)
    Object.assign(node.content.style, presentation.contentStyle)
    Object.assign(node.children.style, presentation.childrenStyle)
    return presentation
  }

  function renderChildren(parent: HTMLElement, ids: readonly string[], project: CourseProjectV10, flow: boolean, used: Set<string>, flowLayout?: FlowMediaLayoutWidths) {
    let cursor = parent.firstElementChild
    for (const id of ids) {
      const instance: ComponentInstance | undefined = project.instances[id]
      if (!instance || project.definitions[instance.definitionId]?.role === 'behavior') continue
      used.add(id)
      let node = nodes.get(id)
      const presentation = resolveComponentOuterPresentation(project, instance, { placement: flow ? 'flow' : 'free', purpose: 'playback',
        inlineSize: node?.outer.clientWidth || parent.clientWidth || instance.frame?.width || 1, flowLayout })
      if (!node) {
        const outer = document.createElement('div'), stage = document.createElement(presentation.section ? 'details' : 'div'), content = document.createElement(presentation.section ? 'summary' : 'div'), children = document.createElement('div')
        outer.dataset.componentObject = id
        content.dataset.componentRuntimeRoot = id
        children.style.pointerEvents = 'none'
        stage.append(content, children); outer.append(stage)
        node = { outer, stage, content, children }; nodes.set(id, node)
        if (flow) observer?.observe(outer)
        runtime.bind(id, content); runtime.bindTarget(id, outer)
      }
      if (presentation.section && node.stage.tagName === 'DETAILS' && node.sectionDefaultCollapsed !== presentation.section.collapsedByDefault) {
        node.sectionDefaultCollapsed = presentation.section.collapsedByDefault
        ;(node.stage as HTMLDetailsElement).open = presentation.section.open
      }
      if(node.outer.style.display==='none'){runtime.bind(id,node.content);runtime.bindTarget(id,node.outer)}node.outer.style.display=''
      applyComponentPaintStyle(node.outer, instance, project.definitions[instance.definitionId])
      node.outer.id = id
      node.flow = flow; node.flowLayout = flowLayout
      node.outer.dataset.componentPlacement = flow ? 'flow' : 'free'
      Object.assign(node.outer.style, presentation.outerStyle)
      Object.assign(node.stage.style, presentation.stageStyle)
      Object.assign(node.content.style, presentation.contentStyle)
      Object.assign(node.children.style, presentation.childrenStyle)
      if (flow && instance.flowLayout?.caption) {
          if (!node.caption) { node.caption = document.createElement('figcaption'); node.outer.append(node.caption) }
          node.caption.innerHTML = renderDocumentText(instance.flowLayout.caption as FlowTextContent)
      } else { node.caption?.remove(); node.caption = undefined }
      // Do not reinsert unchanged live roots on resize or same-page updates.
      if (node.outer !== cursor) parent.insertBefore(node.outer, cursor)
      cursor = node.outer.nextElementSibling
      // Only document sections continue the reading order. Local compositions keep their frames.
      const inlineIds=new Set([...allDocumentTextSlots(instance.data).flatMap(slot=>inlineComponentIds(slot.content)),...documentInlineChildIds(project,instance.id).filter(id=>!project.instances[id]?.frame&&!project.instances[id]?.flowPlacement)])
      for(const id of inlineIds)if(instance.childIds?.includes(id)){used.add(id);const inlineNode=nodes.get(id);if(inlineNode)inlineNode.outer.style.display='none'}
      renderChildren(node.children, (instance.childIds ?? []).filter(id=>!inlineIds.has(id)), project, presentation.childrenPlacement === 'flow', used, flowLayout)
    }
  }
  function revealSurface(id: string): boolean {
    if (disposed || !currentProject?.surfaces.some(surface => surface.id === id)) return false
    activeSurface = id
    // The existing display API exposes geometry/observation synchronously. Realm
    // readiness remains owned by the caller's normal ModelPlayer update queue.
    if (!surfaces.has(id) && currentModel) sync(currentModel)
    for (const [surfaceId, surface] of surfaces) surface.root.hidden = surfaceId !== id
    resize()
    return true
  }
  const paintGlobalObservation = () => {
    const project = currentProject, view = surfaces.get(activeSurface ?? ''), transform = view?.content?.style.transform
    if (!project) return
    for (const id of [...project.global.underlay, ...project.global.overlay]) {
      const instance = project.instances[id], node = nodes.get(id), definition = instance && project.definitions[instance.definitionId]
      if (!node || !instance?.frame || isViewportComponent(project, id)) continue
      const frame = `matrix(${instance.frame.transform.join(',')})`
      const stage = view?.content?.parentElement
      const fit = view?.kind === 'flow' ? '' : stage ? `translate(${stage.style.left || '0px'},${stage.style.top || '0px'}) ${stage.style.transform}` : ''
      node.outer.style.transform = `${fit} ${transform && transform !== 'none' ? transform : ''} ${frame}`.trim()
    }
    paintFlowScrollClearance()
  }
  const paintGraph=(id:string)=>{const project=currentProject,view=surfaces.get(id);if(project&&view?.graph&&view.camera)paintComponentSpatialGraph(document,project,id,view.graph,view.camera.read(),{width:view.designSize?.width??view.root.clientWidth,height:view.designSize?.height??view.root.clientHeight})}
  const resize = () => {
    const project = currentProject
    const active = activeSurface ? surfaces.get(activeSurface) : undefined
    Object.assign(shell.style, { width: '100%', height: '100%', transform: 'none' })
    // Establish the current fixed-paper fit before measuring paragraph anchors in logical coordinates.
    active?.playback?.resize()
    const activeModel = project?.surfaces.find(surface => surface.id === activeSurface)
    if (project) {
      applyComponentBackgroundPaint(shell, resolveComponentBackground(project, activeModel), id => runtime.assetUrl(id))
      for (const id of [...project.global.underlay, ...project.global.overlay]) {
        const instance = project.instances[id], node = nodes.get(id)
        if (!node || !instance?.frame) continue
        if (!isViewportComponent(project, id)) Object.assign(node.outer.style, componentFrameStyle(instance.frame))
      }
      paintControllerPlacement()
      for (const [id, node] of nodes) if (node.flow && project.instances[id])
        placeNode(node, project.instances[id], project, node.outer.clientWidth || project.instances[id].frame?.width || 1)
      for (const surface of project.surfaces.filter(surface => surface.id === activeSurface)) {
        const view = surfaces.get(surface.id)
        if (!view?.flow) continue
        const rect = view.flow.paper.getBoundingClientRect(), blocks: FlowParagraphBlockRect[] = [], zoom = (view.playback?.fitScale(surface.id) ?? 1) * (view.playback?.state.zoom ?? 1)
        const visit = (ids: readonly string[], depth: number) => { for (const id of ids) {
          const instance = project.instances[id], node = nodes.get(id)
          if (!node || !instance || instance.flowPlacement) continue
          const box = node.outer.getBoundingClientRect()
          if (box.width && box.height) blocks.push({ blockId: id, depth, x: (box.x - rect.x) / zoom, y: (box.y - rect.y) / zoom, width: box.width / zoom, height: box.height / zoom })
          if (node.flow) visit(instance.childIds ?? [], depth + 1)
        } }; visit(surface.childIds, 0)
        for (const id of surface.childIds) {
          const instance = project.instances[id], node = nodes.get(id), anchor = instance?.flowPlacement?.paragraphAnchor
          if (!node || !instance?.frame || instance.flowPlacement?.space !== 'paper' || !anchor) continue
           const ancestorIds: string[] = []
           let owner = owningContainer(project, anchor.blockId)
           while (owner?.kind === 'instance') { ancestorIds.push(owner.instanceId); owner = owningContainer(project, owner.instanceId) }
           const frame = instance.frame, shown = flowParagraphAnchoredFrame(anchor, { x: frame.transform[4], y: frame.transform[5], width: frame.width, height: frame.height }, view.flow.paper.clientWidth, blocks, ancestorIds)
          if (shown) Object.assign(node.outer.style, componentFrameStyle({ ...frame, transform: [frame.transform[0], frame.transform[1], frame.transform[2], frame.transform[3], shown.x, shown.y] }))
        }
      }
    }
    for (const surface of active ? [active] : []) surface.spatial?.setViewport({
      x: 0, y: 0, width: surface.designSize?.width ?? surface.root.clientWidth ?? root.clientWidth,
      height: surface.designSize?.height ?? surface.root.clientHeight ?? root.clientHeight,
    })
    if (activeSurface) paintGraph(activeSurface)
    paintGlobalObservation()
  }
  const Observer = document.defaultView?.ResizeObserver
  const observer = Observer ? new Observer(resize) : undefined
  observer?.observe(root)
  const contentRelayout = () => resize()
  root.addEventListener('toggle', contentRelayout, true); root.addEventListener('load', contentRelayout, true)
  void document.fonts?.ready.then(() => { if (!disposed) resize() })
  function sync(model: ComponentPlayerModel) {
      if (disposed || context.signal.aborted) return
      const project = model.project; currentProject = project; currentModel = model
      if (!project.surfaces.some(surface => surface.id === activeSurface)) activeSurface = project.surfaces[0]?.id
      if (projectId && projectId !== project.id) runtime.bindTarget(projectId, null)
      projectId = project.id; runtime.bindTarget(project.id, shell)
      const used = new Set<string>()
      const collect = (ids: readonly string[]) => {
        for (const id of ids) {
          const instance = project.instances[id]
          if (!instance || project.definitions[instance.definitionId]?.role === 'behavior') continue
          used.add(id); collect(instance.childIds ?? [])
        }
      }
      collect(project.global.underlay); collect(project.global.overlay)
      for (const surface of project.surfaces) if (surface.kind !== 'spatial') collect(surface.childIds)
      // Retire old placements before a new surface adapter binds the same instance.
      for (const [id, node] of nodes) if (!used.has(id)) {
        runtime.bind(id, null); runtime.bindTarget(id, null); observer?.unobserve(node.outer); node.outer.remove(); nodes.delete(id)
      }
      const surfaceIds = new Set(project.surfaces.map(surface => surface.id))
      for (const [id, view] of surfaces) if (!surfaceIds.has(id) || project.surfaces.find(surface => surface.id === id)?.kind !== view.kind) {
        view.spatial?.dispose(); view.releaseCamera?.(); view.releaseInput?.(); view.releaseGraph?.(); view.camera?.dispose(); view.toc?.destroy(); view.playback?.destroy(); view.root.remove(); surfaces.delete(id); runtime.bindTarget(id, null)
      }
      for (const surface of project.surfaces) {
        let view = surfaces.get(surface.id)
        // Unvisited pages have no DOM or executing content realm. A visited page
        // retains its existing roots/session when another surface becomes active.
        if (!view && surface.id !== activeSurface) continue
        if (!view) {
          const element = document.createElement('div')
          element.dataset.componentSurface = surface.id
          Object.assign(element.style, { position: 'relative', width: '100%', height: '100%', pointerEvents: 'auto', overflow: surface.kind === 'flow' ? 'auto' : 'hidden' })
          surfacePlane.append(element)
          view = { root: element, kind: surface.kind }; surfaces.set(surface.id, view)
          runtime.bindTarget(surface.id, element)
           {
            element.dataset.pageBackdrop = 'transparent'
            const playback = new PlaybackViewSession(), viewport = playback.mount(element), host = document.createElement('div')
            viewport.append(host)
            const content = createPlaybackContent(host)
            if (surface.designSize) { host.dataset.canvasWidth = String(surface.designSize.width); host.dataset.canvasHeight = String(surface.designSize.height) }
            playback.register({ id: surface.id, kind: surface.kind, root: host, content, onObservationChange: paintGlobalObservation }); playback.activate(surface.id)
            view.observation = {
              readZoom: () => playback.state.zoom,
              setZoom: zoom => { if (!disposed && !context.signal.aborted) playback.zoomTo(zoom) },
              reset: () => {
                if (disposed || context.signal.aborted) return
                playback.reset()
                const scroll = element.querySelector<HTMLElement>('[data-flow-paper-scroll]')
                if (scroll) { scroll.scrollTop = 0; scroll.scrollLeft = 0 }
              },
              goToInstance: (instanceId, signal) => {
                if (disposed || context.signal.aborted || signal?.aborted || surface.kind !== 'flow') return false
                const flow = view!.flow
                if (!flow) return false
                if (instanceId === null) { flow.scroll.scrollTop = 0; flow.scroll.scrollLeft = 0; return true }
                const target = nodes.get(instanceId)?.outer
                if (!target || !flow.body.contains(target)) return false
                let ancestor = target.parentElement
                while (ancestor && ancestor !== flow.body) { if (ancestor.tagName === 'DETAILS') (ancestor as HTMLDetailsElement).open = true; ancestor = ancestor.parentElement }
                const scale = flow.paper.getBoundingClientRect().width / Math.max(1, flow.paper.offsetWidth)
                flow.scroll.scrollTop += (target.getBoundingClientRect().top - flow.scroll.getBoundingClientRect().top) / Math.max(.000001, scale)
                return true
              },
              subscribe: listener => playback.subscribe(listener),
            }
            view.playback = playback; view.content = content
          }
          if (surface.kind === 'flow') {
            element.style.overflow = 'hidden'
            const scroll = document.createElement('div'), paper = document.createElement('article'), body = document.createElement('div')
            Object.assign(scroll.style, { position: 'absolute', inset: '0px', overflow: 'auto', padding: FLOW_BODY_SCROLL_PADDING, containerType: 'inline-size', boxSizing: 'border-box' })
            Object.assign(paper.style, { position: 'relative', minHeight: '100%', width: '100%', margin: '0 auto', padding: FLOW_BODY_PAPER_PADDING, boxSizing: 'border-box', fontFamily: FLOW_BODY_FONT_FAMILY, fontSize: '16px', lineHeight: '1.6', color: '#1f2937' })
            Object.assign(body.style, { position: 'relative', display: 'flow-root', zIndex: '1' })
            const layer = (parent: HTMLElement, name: string, zIndex: string) => {
              const layer = document.createElement('div'); layer.dataset.componentFlowPlane = name
              Object.assign(layer.style, { position: 'absolute', inset: '0px', zIndex, pointerEvents: 'none' }); parent.append(layer); return layer
            }
            const paperUnderlay = layer(paper, 'paper-underlay', '0'); paper.append(body); const paperOverlay = layer(paper, 'paper-overlay', '2')
            scroll.dataset.flowPaperScroll = 'true'
            scroll.append(paper); view.content!.append(scroll)
            view.flow = { scroll, scrollPaddingBottom: parseFloat(scroll.style.paddingBottom), paper, body, paperUnderlay, paperOverlay, viewportUnderlay: layer(view.content!, 'viewport-underlay', '0'), viewportOverlay: layer(view.content!, 'viewport-overlay', '2') }
          }
          if (surface.kind === 'spatial') {
            view.camera = createComponentSpatialCameraPort(surface.spatial?.home ?? { x: 0, y: 0, zoom: 1 })
             view.releaseInput = bindSpatialInput(view.content!, view.camera)
            view.releaseCamera = context.onCamera?.(surface.id, view.camera)
             view.spatial = createComponentSpatialAdapter({ container: view.content!, camera: view.camera,
              onElement: (id, content) => { runtime.bind(id, content); runtime.bindTarget(id, content?.parentElement ?? null) },
            })
            view.graph = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
            Object.assign(view.graph.style, { position: 'absolute', inset: '0px', width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' })
             view.content!.append(view.graph); view.releaseGraph = view.camera.subscribe(() => paintGraph(surface.id))
          }
        }
        if (surface.kind === 'spatial') view.spatial!.sync(project, surface.id)
        if (view.flow) {
          if (surface.flow?.layout.toc === 'hidden') { view.toc?.destroy(); view.toc = undefined }
          else if (context.teacherController) {
            view.toc ??= mountComponentFlowToc(view.root, surface.id, context.teacherController)
            view.toc.sync()
          }
          const layout = surface.flow?.layout ?? { readingWidth: 860, wideContentWidth: 1100, paperBackgroundColor: '#ffffff' }
          Object.assign(view.flow.paper.style, { width: flowPaperMaxWidth(layout), maxWidth: flowPaperMaxWidth(layout), containerType: 'inline-size' })
          applyComponentBackgroundPaint(view.flow.paper, resolveFlowPaperBackground(project, surface), id => runtime.assetUrl(id))
        }
        view.designSize = surface.designSize
         const host = view.content?.parentElement
         if (host) {
           if (surface.designSize) { host.dataset.canvasWidth = String(surface.designSize.width); host.dataset.canvasHeight = String(surface.designSize.height) }
           else { delete host.dataset.canvasWidth; delete host.dataset.canvasHeight }
         }
      }
      // Spatial removals have now unbound their old placement; bind free/flow roots last.
       renderChildren(underlay, project.global.underlay, project, false, used)
       renderChildren(overlay, project.global.overlay, project, false, used)
      for (const surface of project.surfaces) {
        const view = surfaces.get(surface.id)
        if (!view) continue
        if (view.flow) {
          if (surface.flow?.layout.toc === 'hidden') { view.toc?.destroy(); view.toc = undefined }
          else if (context.teacherController) {
            view.toc ??= mountComponentFlowToc(view.root, surface.id, context.teacherController)
            view.toc.sync()
          }
          renderChildren(view.flow.body, surface.childIds.filter(id => !project!.instances[id]?.flowPlacement), project, true, used, surface.flow?.layout)
          for (const space of ['paper', 'viewport'] as const) for (const plane of ['underlay', 'overlay'] as const) {
            const parent = space === 'paper' ? plane === 'underlay' ? view.flow.paperUnderlay : view.flow.paperOverlay : plane === 'underlay' ? view.flow.viewportUnderlay : view.flow.viewportOverlay
            renderChildren(parent, surface.childIds.filter(id => { const placement = project!.instances[id]?.flowPlacement; return placement?.space === space && placement.plane === plane }), project, false, used)
          }
        } else if (surface.kind !== 'spatial') renderChildren(view.content!, surface.childIds, project, false, used)
      }
      const next = activeSurface && surfaces.has(activeSurface) ? activeSurface : project.surfaces[0]?.id
      if (next) revealSurface(next)
  }
  const releaseControllerPlacement = context.teacherController?.subscribe(paintControllerPlacement)
  const releasePlacementOnly = context.teacherController?.subscribePlacement?.(paintControllerPlacement)
  return {
    sync,
    revealSurface,
    camera: id => surfaces.get(id)?.camera,
    viewport: id => { const view = surfaces.get(id); return view ? { width: view.designSize?.width ?? view.root.clientWidth, height: view.designSize?.height ?? view.root.clientHeight } : undefined },
    observation: id => surfaces.get(id)?.observation,
    dispose() {
      if (disposed) return
      disposed = true; observer?.disconnect(); releaseControllerPlacement?.(); releasePlacementOnly?.()
      for (const view of surfaces.values()) { view.spatial?.dispose(); view.releaseCamera?.(); view.releaseInput?.(); view.releaseGraph?.(); view.camera?.dispose(); view.toc?.destroy(); view.playback?.destroy() }
      for (const id of nodes.keys()) { runtime.bind(id, null); runtime.bindTarget(id, null) }
      for (const id of surfaces.keys()) runtime.bindTarget(id, null)
      if (projectId) runtime.bindTarget(projectId, null)
       root.removeEventListener('toggle', contentRelayout, true); root.removeEventListener('load', contentRelayout, true)
       nodes.clear(); surfaces.clear(); shell.remove()
    },
  }
}
