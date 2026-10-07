import type { ComponentInstance, ComponentSurface, CourseProjectV10 } from '../../shared/contracts/component-platform'
import { resolveComponentBackground, isComponentVisibleAtSurface, componentDefinitionBuiltinKey } from '../../shared/contracts/component-platform'
import { resolveComponentOuterPresentation } from '../../shared/componentPresentation'
import { transformPoint } from '../../core/components/geometry'
import { createTeacherControllerHudGeometry, teacherControllerReferenceSize, isGlobalTeacherController, projectTeacherControllerInstances, type TeacherControllerDisplayPort } from '../../shared/teacherControllerViewportGeometry'
import { flowParagraphAnchoredFrame, type FlowParagraphBlockRect } from '../../shared/flowParagraphAnchors'
import { FLOW_BODY_PAPER_PADDING, FLOW_BODY_SCROLL_PADDING, flowPaperMaxWidth, FLOW_BODY_FONT_FAMILY, resolveFlowPaperBackground } from '../../shared/flowBodyPresentation'
import type { FlowMediaLayoutWidths } from '../../shared/flowMediaLayout'
import { renderDocumentText } from '../../shared/document/render'
import type { FlowTextContent } from '../../shared/document/content'
import { componentSurfaceGeometryTargets } from './spatialTargets'
import { spatialComponentCenter, spatialPathPoints, spatialSemanticVisible } from '../surfaces/spatial/componentPlatform/graph'
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
  flow?: { paper: HTMLElement; body: HTMLElement; paperUnderlay: HTMLElement; paperOverlay: HTMLElement; viewportUnderlay: HTMLElement; viewportOverlay: HTMLElement }
  graph?: SVGSVGElement
  releaseGraph?: () => void
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
  const hud = document.createElement('div')
  hud.dataset.componentPlane = 'hud'
  Object.assign(hud.style, { position: 'absolute', inset: '0px', overflow: 'hidden', pointerEvents: 'none', zIndex: '3' })
  root.append(shell, hud)
  const nodes = new Map<string, NodeView>()
  const surfaces = new Map<string, SurfaceView>()
  let activeSurface = context.initialSurfaceId
  let projectId: string | undefined
  let disposed = false
  let currentProject: CourseProjectV10 | undefined
  let currentModel: ComponentPlayerModel | undefined
  const paintControllerPlacement = () => {
    const project = currentProject
    if (!project || disposed) return
    const geometry = createTeacherControllerHudGeometry({ referenceSize: teacherControllerReferenceSize(project),
      viewportRect: { x: 0, y: 0, width: root.clientWidth, height: root.clientHeight } })
    const display = projectTeacherControllerInstances(project, geometry, context.teacherController)
    for (const id of [...project.global.underlay, ...project.global.overlay]) {
      if (!isGlobalTeacherController(project, id)) continue
      const node = nodes.get(id), frame = display.instances[id]?.frame
      if (node && frame) Object.assign(node.outer.style, componentFrameStyle(frame))
    }
  }

  function placeNode(node: NodeView, instance: ComponentInstance, project: CourseProjectV10, inlineSize: number) {
    const presentation = resolveComponentOuterPresentation(project, instance, { placement: node.flow ? 'flow' : 'free', purpose: 'playback', inlineSize, flowLayout: node.flowLayout })
    Object.assign(node.outer.style, presentation.outerStyle, { pointerEvents: 'auto' })
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
        runtime.bind(id, content); runtime.bindTarget(id, outer)
      }
      if (presentation.section && node.stage.tagName === 'DETAILS' && node.sectionDefaultCollapsed !== presentation.section.collapsedByDefault) {
        node.sectionDefaultCollapsed = presentation.section.collapsedByDefault
        ;(node.stage as HTMLDetailsElement).open = presentation.section.open
      }
      applyComponentPaintStyle(node.outer, instance, project.definitions[instance.definitionId])
      node.flow = flow; node.flowLayout = flowLayout
      node.outer.dataset.componentPlacement = flow ? 'flow' : 'free'
      Object.assign(node.outer.style, presentation.outerStyle, { pointerEvents: 'auto' })
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
      renderChildren(node.children, instance.childIds ?? [], project, presentation.childrenPlacement === 'flow', used, flowLayout)
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
    const project = currentProject, transform = surfaces.get(activeSurface ?? '')?.content?.style.transform
    if (!project) return
    for (const id of [...project.global.underlay, ...project.global.overlay]) {
      const instance = project.instances[id], node = nodes.get(id), definition = instance && project.definitions[instance.definitionId]
      if (!node || !instance?.frame || componentDefinitionBuiltinKey(definition) === 'guoling.navigation') continue
      const frame = `matrix(${instance.frame.transform.join(',')})`
      node.outer.style.transform = transform && transform !== 'none' ? `${transform} ${frame}` : frame
    }
  }
  const paintGraph = (id: string) => {
    const project = currentProject
    const view = surfaces.get(id), surface = project?.surfaces.find(value => value.id === id)
    if (!project || !view?.graph || !view.camera || !surface) return
    const svg = view.graph, pose = view.camera.read(), targets = componentSurfaceGeometryTargets(project, id)
    const matrix = componentSpatialCameraMatrix(pose, { x: 0, y: 0, width: view.designSize?.width ?? view.root.clientWidth, height: view.designSize?.height ?? view.root.clientHeight })
    const element = (tag: string, attributes: Record<string, string | number>) => {
      const value = document.createElementNS('http://www.w3.org/2000/svg', tag)
      for (const [key, item] of Object.entries(attributes)) value.setAttribute(key, String(item))
      return value
    }
    svg.replaceChildren()
    const arrowId = `component-arrow-${id}`, defs = element('defs', {}), marker = element('marker', { id: arrowId, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' })
    marker.append(element('path', { d: 'M0 0L10 5L0 10Z', fill: '#64748b' })); defs.append(marker); svg.append(defs)
    const visible = (instanceId: string) => Boolean(project?.instances[instanceId] && isComponentVisibleAtSurface(project.instances[instanceId], id) && spatialSemanticVisible(surface.spatial, instanceId, pose.zoom))
    for (const relation of surface.spatial?.relations ?? []) {
      if (!visible(relation.sourceInstanceId) || !visible(relation.targetInstanceId)) continue
      const a = spatialComponentCenter(targets, relation.sourceInstanceId), b = spatialComponentCenter(targets, relation.targetInstanceId)
      if (!a || !b) continue
      const start = transformPoint(matrix, a), end = transformPoint(matrix, b)
      const group = element('g', { 'data-spatial-relation-id': relation.id })
      const line = element('line', { x1: start.x, y1: start.y, x2: end.x, y2: end.y, stroke: '#64748b', 'stroke-width': 2 })
      if (relation.kind !== 'line') line.setAttribute('marker-end', `url(#${arrowId})`)
      if (relation.kind === 'bidirectional') line.setAttribute('marker-start', `url(#${arrowId})`)
      group.append(line)
      if (relation.label) { const label = element('text', { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 - 6, fill: '#334155' }); label.textContent = relation.label; group.append(label) }
      svg.append(group)
    }
    for (const path of surface.spatial?.paths ?? []) {
      const points = spatialPathPoints(surface.spatial, path, targets).map(point => transformPoint(matrix, point))
      const line = element('polyline', { 'data-spatial-path-id': path.id, points: points.map(point => `${point.x},${point.y}`).join(' '), fill: 'none', stroke: path.style?.color ?? '#3388ff', 'stroke-width': path.style?.width ?? 2 })
      if (path.style?.dash === 'dashed' || path.style?.dash === 'dotted') line.setAttribute('stroke-dasharray', path.style.dash === 'dashed' ? '8 5' : '2 4')
      svg.append(line)
    }
  }
  function bindSpatialInput(element: HTMLElement, camera: ComponentSpatialCameraPort): () => void {
    let space = false, drag: { id: number; point: { x: number; y: number } } | undefined
    const editable = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest('input,textarea,select,[contenteditable="true"]'))
    const geometry = () => {
      const rect = element.getBoundingClientRect()
      return createStageGeometry({ width: element.clientWidth || rect.width, height: element.clientHeight || rect.height }, rect)
    }
    const point = (event: MouseEvent) => geometry().toAuthor({ x: event.clientX, y: event.clientY })
    const keydown = (event: KeyboardEvent) => { if (event.code === 'Space' && !editable(event.target)) { space = true; event.preventDefault() } }
    const keyup = (event: KeyboardEvent) => { if (event.code === 'Space') space = false }
    const blur = () => { space = false; drag = undefined }
    const down = (event: PointerEvent) => {
      if (event.button !== 0 && event.button !== 1 || editable(event.target)) return
      if (!space && event.button !== 1 && event.target instanceof Element && event.target.closest('[data-component-instance-id]')) return
      event.preventDefault(); element.focus({ preventScroll: true })
      drag = { id: event.pointerId, point: point(event) }; element.setPointerCapture?.(event.pointerId)
    }
    const move = (event: PointerEvent) => {
      if (!drag || drag.id !== event.pointerId) return
      const next = point(event)
      camera.set(panComponentSpatialCamera(camera.read(), { x: next.x - drag.point.x, y: next.y - drag.point.y }))
      drag.point = next; event.preventDefault()
    }
    const up = (event: PointerEvent) => { if (drag?.id === event.pointerId) { drag = undefined; if (element.hasPointerCapture?.(event.pointerId)) element.releasePointerCapture(event.pointerId) } }
    const wheel = (event: WheelEvent) => {
      if (editable(event.target) || !event.ctrlKey && !event.metaKey && event.target instanceof Element && event.target.closest('[data-component-instance-id]')) return
      event.preventDefault()
      const current = camera.read(), frame = geometry()
      camera.set(zoomComponentSpatialCamera(current, Math.max(0.01, current.zoom * Math.exp(-event.deltaY * 0.002)), frame.toAuthor({ x: event.clientX, y: event.clientY }),
        { x: 0, y: 0, width: frame.referenceSize.width, height: frame.referenceSize.height }))
    }
    element.tabIndex = 0
    element.addEventListener('keydown', keydown); element.addEventListener('keyup', keyup); element.addEventListener('blur', blur)
    element.addEventListener('pointerdown', down); element.addEventListener('pointermove', move); element.addEventListener('pointerup', up); element.addEventListener('pointercancel', up)
    element.addEventListener('wheel', wheel, { passive: false })
    return () => {
      blur(); element.removeEventListener('keydown', keydown); element.removeEventListener('keyup', keyup); element.removeEventListener('blur', blur)
      element.removeEventListener('pointerdown', down); element.removeEventListener('pointermove', move); element.removeEventListener('pointerup', up); element.removeEventListener('pointercancel', up)
      element.removeEventListener('wheel', wheel)
    }
  }
  const resize = () => {
    const project = currentProject
    const active = activeSurface ? surfaces.get(activeSurface) : undefined
    const size = active?.kind !== 'flow' ? active?.designSize : undefined
    if (size) {
      const scale = root.clientWidth && root.clientHeight ? Math.min(root.clientWidth / size.width, root.clientHeight / size.height) : 1
      const x = root.clientWidth ? (root.clientWidth - size.width * scale) / 2 : 0
      const y = root.clientHeight ? (root.clientHeight - size.height * scale) / 2 : 0
      Object.assign(shell.style, { width: `${size.width}px`, height: `${size.height}px`, transform: `translate(${x}px, ${y}px) scale(${scale})` })
    } else Object.assign(shell.style, { width: '100%', height: '100%', transform: 'none' })
    const activeModel = project?.surfaces.find(surface => surface.id === activeSurface)
    if (project) {
      const background = resolveComponentBackground(project, activeModel), url = background.assetId ? runtime.assetUrl(background.assetId) : undefined
      Object.assign(shell.style, { backgroundColor: background.color, backgroundImage: url ? `url(${JSON.stringify(url)})` : 'none', backgroundSize: background.fit === 'fill' ? '100% 100%' : background.fit, backgroundPosition: 'center', backgroundRepeat: 'no-repeat' })
      for (const id of [...project.global.underlay, ...project.global.overlay]) {
        const instance = project.instances[id], node = nodes.get(id)
        if (!node || !instance?.frame) continue
        if (!isGlobalTeacherController(project, id)) Object.assign(node.outer.style, componentFrameStyle(instance.frame))
      }
      paintControllerPlacement()
      for (const [id, node] of nodes) if (node.flow && project.instances[id])
        placeNode(node, project.instances[id], project, node.outer.clientWidth || project.instances[id].frame?.width || 1)
      for (const surface of project.surfaces) {
        const view = surfaces.get(surface.id)
        if (!view?.flow) continue
        const rect = view.flow.paper.getBoundingClientRect(), blocks: FlowParagraphBlockRect[] = [], zoom = view.playback?.state.zoom ?? 1
        for (const id of surface.childIds) {
          const instance = project.instances[id], node = nodes.get(id)
          if (!node || !instance || instance.flowPlacement) continue
          const box = node.outer.getBoundingClientRect(); blocks.push({ blockId: id, depth: 0, x: (box.x - rect.x) / zoom, y: (box.y - rect.y) / zoom, width: box.width / zoom, height: box.height / zoom })
        }
        for (const id of surface.childIds) {
          const instance = project.instances[id], node = nodes.get(id), anchor = instance?.flowPlacement?.paragraphAnchor
          if (!node || !instance?.frame || instance.flowPlacement?.space !== 'paper' || !anchor) continue
          const frame = instance.frame, shown = flowParagraphAnchoredFrame(anchor, { x: frame.transform[4], y: frame.transform[5], width: frame.width, height: frame.height }, view.flow.paper.clientWidth, blocks)
          if (shown) Object.assign(node.outer.style, componentFrameStyle({ ...frame, transform: [frame.transform[0], frame.transform[1], frame.transform[2], frame.transform[3], shown.x, shown.y] }))
        }
      }
    }
    for (const surface of surfaces.values()) surface.spatial?.setViewport({
      x: 0, y: 0, width: surface.designSize?.width ?? surface.root.clientWidth ?? root.clientWidth,
      height: surface.designSize?.height ?? surface.root.clientHeight ?? root.clientHeight,
    })
    for (const id of surfaces.keys()) paintGraph(id)
    for (const surface of surfaces.values()) surface.playback?.resize()
  }
  const Observer = document.defaultView?.ResizeObserver
  const observer = Observer ? new Observer(resize) : undefined
  observer?.observe(root)
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
        runtime.bind(id, null); runtime.bindTarget(id, null); node.outer.remove(); nodes.delete(id)
      }
      const surfaceIds = new Set(project.surfaces.map(surface => surface.id))
      for (const [id, view] of surfaces) if (!surfaceIds.has(id) || project.surfaces.find(surface => surface.id === id)?.kind !== view.kind) {
        view.spatial?.dispose(); view.releaseCamera?.(); view.releaseInput?.(); view.releaseGraph?.(); view.camera?.dispose(); view.playback?.destroy(); view.root.remove(); surfaces.delete(id); runtime.bindTarget(id, null)
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
          if (surface.kind !== 'spatial') {
            element.dataset.pageBackdrop = 'transparent'
            const playback = new PlaybackViewSession(), viewport = playback.mount(element), host = document.createElement('div')
            viewport.append(host)
            const content = createPlaybackContent(host)
            if (surface.designSize) { host.dataset.canvasWidth = String(surface.designSize.width); host.dataset.canvasHeight = String(surface.designSize.height) }
            playback.register({ id: surface.id, kind: surface.kind, root: host, content, onObservationChange: paintGlobalObservation }); playback.activate(surface.id)
            view.observation = {
              readZoom: () => playback.state.zoom,
              setZoom: zoom => { if (!disposed && !context.signal.aborted) playback.zoomTo(zoom) },
              reset: () => { if (!disposed && !context.signal.aborted) playback.reset() },
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
            view.flow = { paper, body, paperUnderlay, paperOverlay, viewportUnderlay: layer(view.content!, 'viewport-underlay', '0'), viewportOverlay: layer(view.content!, 'viewport-overlay', '2') }
          }
          if (surface.kind === 'spatial') {
            view.camera = createComponentSpatialCameraPort(surface.spatial?.home ?? { x: 0, y: 0, zoom: 1 })
            view.releaseInput = bindSpatialInput(element, view.camera)
            view.releaseCamera = context.onCamera?.(surface.id, view.camera)
            view.spatial = createComponentSpatialAdapter({ container: element, camera: view.camera,
              onElement: (id, content) => { runtime.bind(id, content); runtime.bindTarget(id, content?.parentElement ?? null) },
            })
            view.graph = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
            Object.assign(view.graph.style, { position: 'absolute', inset: '0px', width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' })
            element.append(view.graph); view.releaseGraph = view.camera.subscribe(() => paintGraph(surface.id))
          }
        }
        if (surface.kind === 'spatial') view.spatial!.sync(project, surface.id)
        if (view.flow) {
          const layout = surface.flow?.layout ?? { readingWidth: 860, wideContentWidth: 1100, paperBackgroundColor: '#ffffff' }
          const background = resolveFlowPaperBackground(project, surface), url = background.assetId ? runtime.assetUrl(background.assetId) : undefined
          Object.assign(view.flow.paper.style, { maxWidth: flowPaperMaxWidth(layout), backgroundColor: background.color,
            backgroundImage: url ? `url(${JSON.stringify(url)})` : 'none', backgroundSize: background.fit === 'fill' ? '100% 100%' : background.fit,
            backgroundPosition: 'center', backgroundRepeat: 'no-repeat' })
        }
        view.designSize = surface.designSize
      }
      // Spatial removals have now unbound their old placement; bind free/flow roots last.
      renderChildren(underlay, project.global.underlay.filter(id => !isGlobalTeacherController(project, id)), project, false, used)
      renderChildren(overlay, project.global.overlay.filter(id => !isGlobalTeacherController(project, id)), project, false, used)
      renderChildren(hud, [...project.global.underlay, ...project.global.overlay].filter(id => isGlobalTeacherController(project, id)), project, false, used)
      for (const surface of project.surfaces) {
        const view = surfaces.get(surface.id)
        if (!view) continue
        if (view.flow) {
          renderChildren(view.flow.body, surface.childIds.filter(id => !project!.instances[id]?.flowPlacement), project, true, used, surface.flow?.layout)
          for (const space of ['paper', 'viewport'] as const) for (const plane of ['underlay', 'overlay'] as const) {
            const parent = space === 'paper' ? plane === 'underlay' ? view.flow.paperUnderlay : view.flow.paperOverlay : plane === 'underlay' ? view.flow.viewportUnderlay : view.flow.viewportOverlay
            renderChildren(parent, surface.childIds.filter(id => { const placement = project!.instances[id]?.flowPlacement; return placement?.space === space && placement.plane === plane }), project, false, used)
          }
        } else if (surface.kind !== 'spatial') renderChildren(view.content!, surface.childIds, project, false, used)
      }
      const next = activeSurface && surfaces.has(activeSurface) ? activeSurface : project.surfaces[0]?.id
      if (next) revealSurface(next)
      resize()
  }
  const releaseControllerPlacement = context.teacherController?.subscribe(paintControllerPlacement)
  return {
    sync,
    revealSurface,
    camera: id => surfaces.get(id)?.camera,
    viewport: id => { const view = surfaces.get(id); return view ? { width: view.designSize?.width ?? view.root.clientWidth, height: view.designSize?.height ?? view.root.clientHeight } : undefined },
    observation: id => surfaces.get(id)?.observation,
    dispose() {
      if (disposed) return
      disposed = true; observer?.disconnect(); releaseControllerPlacement?.()
      for (const view of surfaces.values()) { view.spatial?.dispose(); view.releaseCamera?.(); view.releaseInput?.(); view.releaseGraph?.(); view.camera?.dispose(); view.playback?.destroy() }
      for (const id of nodes.keys()) { runtime.bind(id, null); runtime.bindTarget(id, null) }
      for (const id of surfaces.keys()) runtime.bindTarget(id, null)
      if (projectId) runtime.bindTarget(projectId, null)
      nodes.clear(); surfaces.clear(); shell.remove(); hud.remove()
    },
  }
}
