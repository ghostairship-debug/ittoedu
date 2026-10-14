import {createStageGeometry} from '../../shared/stageViewport'
import {panComponentSpatialCamera,zoomComponentSpatialCamera,type ComponentSpatialCameraPort} from '../surfaces/spatial/componentSpatialAdapter'
export function bindSpatialInput(element: HTMLElement, camera: ComponentSpatialCameraPort): () => void {
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
