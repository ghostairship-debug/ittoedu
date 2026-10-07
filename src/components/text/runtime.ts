import type { ComponentInstance, ComponentLayoutPort, ComponentRuntimeImplementation, ComponentRuntimeScope } from '../../shared/contracts/component-platform'
import { formulaComponentDataSchema, textComponentDataSchema, type FormulaComponentData, type TextComponentData, type TextSizing } from './data'
import { applyTextComponentLayout, measureTextComponent, renderFormulaComponent, renderTextComponent } from './render'

/** A measured size is an observation. The host may turn it into a canonical frame edit. */
export const TEXT_LAYOUT_EVENT = 'text.layout'
function mounted<Data>(initial: ComponentInstance<Data>, scope: ComponentRuntimeScope, root: HTMLElement | undefined,
  render: (dom: Document, data: Data) => HTMLElement, sizing: (data: Data) => TextSizing, layout?: ComponentLayoutPort) {
  let instance = initial, disposed = false, element: HTMLElement | null = null
  let releaseLayout: (() => void) | undefined
  const active = () => !disposed && scope.isActive() && !scope.signal.aborted
  const measure = () => {
    if (!active() || !element?.isConnected || !instance.frame || layout?.read().mode === 'flow-content') return
    const result = measureTextComponent(element, instance.frame, sizing(instance.data))
    applyTextComponentLayout(element, result)
    element.dataset.textOverflow = String(result.overflows)
    scope.events.emit(TEXT_LAYOUT_EVENT, { instanceId: instance.id, height: result.height, scale: result.scale, overflows: result.overflows })
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
    place()
  }
  const dispose = () => { if (disposed) return; disposed = true; releaseLayout?.(); element?.remove(); element = null }
  scope.cleanup(dispose)
  paint()
  releaseLayout = layout?.subscribe(place)
  void root?.ownerDocument.fonts?.ready.then(() => { if (active()) paint() })
  return {
    update(next: ComponentInstance<Data>) { instance = next; paint() },
    updatePlacement(frame: ComponentInstance<Data>['frame']) { instance = { ...instance, frame }; paint() },
    dispose,
  }
}
export const textRuntimeImplementation: ComponentRuntimeImplementation = {
  mount({ instance, scope, root, layout }) {
    const parse = (value: ComponentInstance): ComponentInstance<TextComponentData> => ({ ...value, data: textComponentDataSchema.parse(value.data) })
    const handle = mounted(parse(instance), scope, root, renderTextComponent, data => data.sizing, layout)
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
