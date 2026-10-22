import type { ComponentFrame, ComponentInstance, CourseProjectV10 } from '../../../shared/contracts/component-platform'
import { componentSurface } from '../../../shared/contracts/component-platform'
import { applyComponentPaintStyle } from '../../components/componentPlacementStyle'
import {
  componentSpatialCameraMatrix, type ComponentSpatialCameraPort,
  type ComponentSpatialViewport,
} from './componentPlatform/camera'

export { createComponentSpatialCameraPort, componentSpatialCameraMatrix, panComponentSpatialCamera, zoomComponentSpatialCamera } from './componentPlatform/camera'
export type { ComponentSpatialCamera, ComponentSpatialCameraPort, ComponentSpatialViewport } from './componentPlatform/camera'

export function componentFrameStyle(frame: ComponentFrame | undefined): Partial<CSSStyleDeclaration> {
  return frame ? { position: 'absolute', left: '0px', top: '0px', width: `${frame.width}px`, height: `${frame.height}px`,
    transformOrigin: '0 0', transform: `matrix(${frame.transform.join(',')})` }
    : { position: 'absolute', left: '0px', top: '0px', width: '0px', height: '0px', transformOrigin: '0 0', transform: 'none' }
}

interface SpatialNode { outer: HTMLDivElement; content: HTMLDivElement; children: HTMLDivElement; runtimeBound: boolean }

/** Owns only local world DOM. The composition root owns global planes and R0 leases. */
export function createComponentSpatialAdapter(options: {
  container: HTMLElement
  camera: ComponentSpatialCameraPort
  onElement(instanceId: string, element: HTMLElement | null): void
  /** A container exclusively places its own subtree within this authored border box. */
  onContainer?(instanceId: string, root: HTMLElement, outer: HTMLElement): void
}) {
  const document = options.container.ownerDocument
  const world = document.createElement('div')
  world.dataset.componentSpatialWorld = ''
  Object.assign(world.style, { position: 'absolute', left: '0px', top: '0px', width: '0px', height: '0px', transformOrigin: '0 0' })
  options.container.appendChild(world)
  const nodes = new Map<string, SpatialNode>()
  let viewport: ComponentSpatialViewport = { x: 0, y: 0, width: options.container.clientWidth, height: options.container.clientHeight }
  let disposed = false
  const paintCamera = () => {
    if (!disposed) world.style.transform = `matrix(${componentSpatialCameraMatrix(options.camera.read(), viewport).join(',')})`
  }
  const unsubscribe = options.camera.subscribe(paintCamera)
  paintCamera()

  function renderChildren(parent: HTMLElement, childIds: readonly string[], project: CourseProjectV10, used: Set<string>) {
    let cursor: Element | null = parent.firstElementChild
    for (const id of childIds) {
      const instance: ComponentInstance | undefined = project.instances[id]
      if (!instance) continue
      // Headless behavior instances are mounted by R0, without fake world rectangles.
      if (project.definitions[instance.definitionId]?.role === 'behavior') continue
      used.add(id)
      let node = nodes.get(id)
      if (!node) {
        const outer = document.createElement('div'), content = document.createElement('div'), children = document.createElement('div')
        outer.dataset.componentInstanceId = id
        content.dataset.componentRuntimeRoot = id
        // The formal border box owns placement. Its padding content box owns
        // runtime layout; child world coordinates retain their separate layer.
        Object.assign(content.style, { position: 'relative', width: '100%', height: '100%', minWidth: '0px' })
        Object.assign(children.style, { position: 'absolute', left: '0px', top: '0px', width: '0px', height: '0px' })
        outer.append(content, children)
        node = { outer, content, children, runtimeBound: false }; nodes.set(id, node)
        Object.assign(node.outer.style, componentFrameStyle(instance.frame))
        parent.insertBefore(node.outer, cursor)
      }
      applyComponentPaintStyle(node.outer, instance, project.definitions[instance.definitionId])
      Object.assign(node.outer.style, componentFrameStyle(instance.frame))
      if (node.outer !== cursor) parent.insertBefore(node.outer, cursor)
      cursor = node.outer.nextElementSibling
      if (instance.container) {
        if (node.runtimeBound) { options.onElement(id, null); node.runtimeBound = false }
        options.onContainer?.(id, node.content, node.outer)
      } else {
        if (!node.runtimeBound) { options.onElement(id, node.content); node.runtimeBound = true }
        renderChildren(node.children, instance.childIds ?? [], project, used)
      }
    }
  }

  return {
    world,
    /** Parent-local viewport. Client-origin mapping is supplied separately for editor hits. */
    setViewport(next: ComponentSpatialViewport) { viewport = { ...next }; paintCamera() },
    sync(project: CourseProjectV10, surfaceId: string) {
      if (disposed) return
      const surface = componentSurface(project, surfaceId)
      if (!surface || surface.kind !== 'spatial') throw new Error(`空间容器已不存在：${surfaceId}`)
      const used = new Set<string>()
      renderChildren(world, surface.childIds, project, used)
      for (const [id, node] of nodes) if (!used.has(id)) {
        if (node.runtimeBound) options.onElement(id, null)
        node.outer.remove(); nodes.delete(id)
      }
    },
    /** Placement previews are DOM-only and do not call R0 update or alter the document. */
    previewFrames(frames: ReadonlyMap<string, ComponentFrame>) {
      for (const [id, frame] of frames) {
        const node = nodes.get(id)
        if (node) Object.assign(node.outer.style, componentFrameStyle(frame))
      }
    },
    dispose() {
      if (disposed) return
      disposed = true; unsubscribe()
      for (const [id, node] of nodes) if (node.runtimeBound) options.onElement(id, null)
      nodes.clear(); world.remove()
    },
  }
}

export type ComponentSpatialAdapter = ReturnType<typeof createComponentSpatialAdapter>
