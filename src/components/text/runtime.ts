import { mountDocumentInlineComponents } from '../../shared/document/textInteraction'
import type { ComponentInstance, ComponentLayoutPort, ComponentRuntimeImplementation, ComponentRuntimeScope } from '../../shared/contracts/component-platform'
import { formulaComponentDataSchema, textComponentDataSchema, type FormulaComponentData, type TextComponentData, type TextSizing } from './data'
import { applyTextComponentLayout, measureTextComponent, renderFormulaComponent, renderTextComponent } from './render'

/** A measured size is an observation. The host may turn it into a canonical frame edit. */
export const TEXT_LAYOUT_EVENT = 'text.layout'
function mounted<Data>(initial: ComponentInstance<Data>, scope: ComponentRuntimeScope, root: HTMLElement | undefined,
  render: (dom: Document, data: Data) => HTMLElement, sizing: (data: Data) => TextSizing, layout?: ComponentLayoutPort, inline?: import('../../shared/contracts/component-platform').ComponentRuntimeContext['inline']) {
  let instance = initial, disposed = false, element: HTMLElement | null = null
  let releaseInline: (() => void) | undefined
  let releaseLayout: (() => void) | undefined
  const active = () => !disposed && scope.isActive() && !scope.signal.aborted
  const measure = () => {
    if (!active() || !element?.isConnected || !instance.frame || layout?.read().mode === 'flow-content') return
    // Frame geometry includes the Surface wrapper's border/padding. Measure
    // the available local content box, before its camera/observation transform.
    const style = root && root.ownerDocument.defaultView?.getComputedStyle(root)
    const contentSize = (axis: 'width' | 'height', fallback: number) => {
      const value = style && Number.parseFloat(style.getPropertyValue(axis))
      if (value === undefined || !Number.isFinite(value) || value <= 0) return fallback
      // Computed CSS sizes are local and retain subpixels; clientWidth/Height
      // round them, while viewport rectangles also include the Surface camera.
      const sides = axis === 'width' ? ['left', 'right'] : ['top', 'bottom']
      const edges = style!.boxSizing === 'border-box' ? sides.reduce((sum, side) => sum
        + (Number.parseFloat(style!.getPropertyValue(`padding-${side}`)) || 0)
        + (Number.parseFloat(style!.getPropertyValue(`border-${side}-width`)) || 0), 0) : 0
      return Math.max(0, value - edges)
    }
    const size = { width: contentSize('width', instance.frame.width), height: contentSize('height', instance.frame.height) }
    const result = measureTextComponent(element, size, sizing(instance.data))
    applyTextComponentLayout(element, result)
    element.dataset.textOverflow = String(result.overflows)
    scope.events.emit(TEXT_LAYOUT_EVENT, { instanceId: instance.id, width: result.width + instance.frame.width - size.width,
      height: result.height + instance.frame.height - size.height, scale: result.scale, overflows: result.overflows })
  }
  const place = () => {
    if (!active() || !element) return
    if (layout) {
      // A flex text box isolates its lines from adjacent floats. Natural Flow
      // paragraphs participate in the surrounding reading flow instead.
      const natural = layout.read().mode === 'flow-content'
      element.style.display = natural ? 'block' : 'flex'
      element.style.height = natural ? 'auto' : '100%'
    }
    measure()
  }
  const paint = () => {
    if (!active() || !root) return
    element = render(root.ownerDocument, instance.data)
    element.style.width = '100%'
    root.replaceChildren(element)
    const previous = releaseInline
    releaseInline = mountDocumentInlineComponents(element, inline)
    previous?.()
    scope.events.emit('__runtime.text-ranges', { instanceId: instance.id })
    place()
  }
  const dispose = () => { if (disposed) return; disposed = true; releaseLayout?.(); releaseInline?.(); element?.remove(); element = null }
  scope.cleanup(dispose)
  paint()
  releaseLayout = layout?.subscribe(paint)
  void root?.ownerDocument.fonts?.ready.then(() => { if (active()) paint() })
  return {
    update(next: ComponentInstance<Data>) { instance = next; paint() },
    updatePlacement(frame: ComponentInstance<Data>['frame']) { instance = { ...instance, frame }; paint() },
    dispose,
  }
}
export const textRuntimeImplementation: ComponentRuntimeImplementation = {
  mount({ instance, scope, root, layout, inline }) {
    const parse = (value: ComponentInstance): ComponentInstance<TextComponentData> => ({ ...value, data: textComponentDataSchema.parse(value.data) })
    const handle = mounted(parse(instance), scope, root, renderTextComponent, data => data.sizing, layout, inline)
    return { ...handle, update(next) { handle.update(parse(next)) } }
  },
}
export const formulaRuntimeImplementation: ComponentRuntimeImplementation = {
  mount({ instance, scope, root }) {
    const parse = (value: ComponentInstance): ComponentInstance<FormulaComponentData> => ({ ...value, data: formulaComponentDataSchema.parse(value.data) })
    const handle = mounted(parse(instance), scope, root, renderFormulaComponent, data => data.sizing)
    return { ...handle, update(next) { handle.update(parse(next)) } }
  },
}
