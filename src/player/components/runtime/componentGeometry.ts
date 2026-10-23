import { invertMatrix, multiplyMatrices, type AffineMatrix } from '../../../core/components/geometry'
import type { AffineTransform, ComponentFrame, ComponentGeometrySnapshot, ComponentRuntimeTarget, ComponentTarget } from '../../../shared/contracts/component-platform'
import { componentClientMatrix } from './componentClientMatrix'

export interface ComponentGeometryPorts {
  target(reference: ComponentTarget): Pick<ComponentRuntimeTarget, 'element' | 'elements'> | null
  /** Existing formal Flow owner IDs and their live DOM roots, nearest first. */
  flows(reference: ComponentTarget): readonly { containerId: string; root: HTMLElement }[]
}

/** Reuses the mounted Flow's existing scroll owner, including natural-height nested Flows. */
function flowScroll(root: HTMLElement, element: HTMLElement): HTMLElement | undefined {
  const candidates = [root, ...root.querySelectorAll<HTMLElement>('[data-flow-paper-scroll]')]
  return candidates.find(scroll => scroll.matches('[data-flow-paper-scroll]')
    && (scroll.contains(element) || !element.closest('[data-flow-paper-scroll]'))
    && /^(auto|scroll|overlay)$/.test(scroll.ownerDocument.defaultView?.getComputedStyle(scroll).overflowY ?? ''))
}

function elementFrame(element: HTMLElement): ComponentFrame | null {
  if (!element.isConnected) return null
  const transform = componentClientMatrix(element)
  if (!transform) return null
  const css = element.ownerDocument.defaultView!.getComputedStyle(element)
  const width = element.offsetWidth || Number.parseFloat(css.width), height = element.offsetHeight || Number.parseFloat(css.height)
  return width > 0 && height > 0 ? { width, height, transform: [...transform] } : null
}

/** No async boundary or cross-component state notifications occur between target measurements. */
export function measureComponentGeometry(references: readonly ComponentTarget[], ports: ComponentGeometryPorts): ComponentGeometrySnapshot {
  const targets: ComponentGeometrySnapshot['targets'] = []
  const view = references.map(reference => ports.target(reference)?.element?.ownerDocument.defaultView).find(Boolean)
  const clock = view?.performance ?? performance
  const sampleTime = clock.timeOrigin + clock.now()
  const flows = new Map<HTMLElement, { contentToViewport: AffineTransform; viewport: { x: number; y: number; width: number; height: number }; scrollSize: { width: number; height: number } } | null>()
  for (const reference of references) {
    const target = ports.target(reference), element = target?.element
    // Semantic ranges with multiple runs have no single local border box.
    // Their observed rectangle is the union in host viewport pixels.
    let viewportFrame = element ? elementFrame(element) : null
    if (target?.elements && target.elements.length > 1) {
      const boxes = target.elements.filter(value => value.isConnected).map(value => value.getBoundingClientRect()).filter(rect => rect.width > 0 && rect.height > 0)
      if (boxes.length) {
        const left = Math.min(...boxes.map(rect => rect.left)), top = Math.min(...boxes.map(rect => rect.top))
        viewportFrame = { width: Math.max(...boxes.map(rect => rect.right)) - left, height: Math.max(...boxes.map(rect => rect.bottom)) - top, transform: [1, 0, 0, 1, left, top] }
      } else viewportFrame = null
    }
    const entry: ComponentGeometrySnapshot['targets'][number] = { reference: structuredClone(reference), viewportFrame }
    if (element && viewportFrame) for (const { containerId, root } of ports.flows(reference)) {
      const scroll = flowScroll(root, element)
      if (!scroll) continue
      if (!flows.has(scroll)) {
        const matrix = scroll.isConnected ? componentClientMatrix(scroll) : null
        flows.set(scroll, matrix ? {
          contentToViewport: [...multiplyMatrices(matrix, [1, 0, 0, 1, scroll.clientLeft - scroll.scrollLeft, scroll.clientTop - scroll.scrollTop])],
          viewport: { x: scroll.scrollLeft, y: scroll.scrollTop, width: scroll.clientWidth, height: scroll.clientHeight },
          scrollSize: { width: scroll.scrollWidth, height: scroll.scrollHeight },
        } : null)
      }
      const flow = flows.get(scroll)
      if (flow) entry.flow = { containerId, ...flow, contentFrame: { ...viewportFrame,
        transform: [...multiplyMatrices(invertMatrix(flow.contentToViewport), viewportFrame.transform)] } }
      break
    }
    targets.push(entry)
  }
  return { sampleTime, targets }
}

/** A sandbox reply projects this one host batch into the requesting iframe's viewport. */
export function projectComponentGeometry(snapshot: ComponentGeometrySnapshot, hostToViewport: AffineMatrix): ComponentGeometrySnapshot {
  return { sampleTime: snapshot.sampleTime, targets: snapshot.targets.map((target): ComponentGeometrySnapshot['targets'][number] => ({ ...target,
    viewportFrame: target.viewportFrame ? { ...target.viewportFrame, transform: [...multiplyMatrices(hostToViewport, target.viewportFrame.transform)] } : null,
    ...(target.flow ? { flow: { ...target.flow, contentToViewport: [...multiplyMatrices(hostToViewport, target.flow.contentToViewport)] } } : {}),
  })) }
}
