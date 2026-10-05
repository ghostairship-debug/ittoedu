import type { ComponentInstance, ComponentRuntimeImplementation, ComponentRuntimeScope } from '../../shared/contracts/component-platform'
import { formulaComponentDataSchema, textComponentDataSchema, type FormulaComponentData, type TextComponentData, type TextSizing } from './data'
import { applyTextComponentLayout, measureTextComponent, renderFormulaComponent, renderTextComponent } from './render'

/** A measured size is an observation. The host may turn it into a canonical frame edit. */
export const TEXT_LAYOUT_EVENT = 'text.layout'
function mounted<Data>(initial: ComponentInstance<Data>, scope: ComponentRuntimeScope, root: HTMLElement | undefined,
  render: (dom: Document, data: Data) => HTMLElement, sizing: (data: Data) => TextSizing) {
  let instance = initial, disposed = false, element: HTMLElement | null = null
  const active = () => !disposed && scope.isActive() && !scope.signal.aborted
  const measure = () => {
    if (!active() || !element?.isConnected || !instance.frame) return
    const result = measureTextComponent(element, instance.frame, sizing(instance.data))
    applyTextComponentLayout(element, result)
    element.dataset.textOverflow = String(result.overflows)
    scope.events.emit(TEXT_LAYOUT_EVENT, { instanceId: instance.id, height: result.height, scale: result.scale, overflows: result.overflows })
  }
  const paint = () => {
    if (!active() || !root) return
    element = render(root.ownerDocument, instance.data)
    element.style.width = '100%'
    root.replaceChildren(element)
    measure()
  }
  const dispose = () => { if (disposed) return; disposed = true; element?.remove(); element = null }
  scope.cleanup(dispose)
  paint()
  void root?.ownerDocument.fonts?.ready.then(() => { if (active()) paint() })
  return {
    update(next: ComponentInstance<Data>) { instance = next; paint() },
    updatePlacement(frame: ComponentInstance<Data>['frame']) { instance = { ...instance, frame }; paint() },
    dispose,
  }
}
export const textRuntimeImplementation: ComponentRuntimeImplementation = {
  mount({ instance, scope, root }) {
    const parse = (value: ComponentInstance): ComponentInstance<TextComponentData> => ({ ...value, data: textComponentDataSchema.parse(value.data) })
    const handle = mounted(parse(instance), scope, root, renderTextComponent, data => data.sizing)
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
