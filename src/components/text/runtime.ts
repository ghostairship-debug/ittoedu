import { mountDocumentInlineComponents } from '../../shared/document/textInteraction'
import type { ComponentInstance, ComponentLayoutInput, ComponentLayoutPort, ComponentRuntimeImplementation, ComponentRuntimeScope } from '../../shared/contracts/component-platform'
import { formulaComponentDataSchema, textComponentDataSchema, type FormulaComponentData, type TextComponentData, type TextSizing } from './data'
import { applyTextComponentLayout, measureTextComponent, renderFormulaComponent, renderTextComponent } from './render'
import { elementTextFontRequests, prepareTextFonts } from '../../shared/fonts/ensureBundledFonts'

/** A measured size is an observation. The host may turn it into a canonical frame edit. */
export const TEXT_LAYOUT_EVENT = 'text.layout'
function mounted<Data>(initial: ComponentInstance<Data>, scope: ComponentRuntimeScope, root: HTMLElement | undefined,
  render: (dom: Document, data: Data) => HTMLElement, sizing: (data: Data) => TextSizing, layout?: ComponentLayoutPort, inline?: import('../../shared/contracts/component-platform').ComponentRuntimeContext['inline']) {
  let instance = initial, disposed = false, element: HTMLElement | null = null
  let releaseInline: (() => void) | undefined
  let releaseLayout: (() => void) | undefined
  let observer: ResizeObserver | undefined
  let fontGeneration = 0, fontsReady = true
  let contentBox: { width: number; height: number; key: string } | undefined
  const active = () => !disposed && scope.isActive() && !scope.signal.aborted
  const boxKey = (style: CSSStyleDeclaration | undefined) => [instance.frame?.width, instance.frame?.height,
    style?.width, style?.height, style?.boxSizing, style?.padding, style?.borderWidth].join('|')
  const measure = (accepted?: ComponentLayoutInput) => {
    if (!active() || !fontsReady || !element?.isConnected || !instance.frame) return
    const placement = accepted ?? layout?.read()
    if (placement?.mode === 'flow-content') return
    // Frame geometry includes the Surface wrapper's border/padding. Measure
    // the available local content box, before its camera/observation transform.
    const style = root && root.ownerDocument.defaultView?.getComputedStyle(root)
    const contentSize = (axis: 'width' | 'height', fallback: number) => {
      // CSSOM's px string can round a layout unit down. Reapplying it can wrap
      // an otherwise unchanged line, so prefer the observer's untransformed box.
      if (contentBox?.key === boxKey(style)) return contentBox[axis]
      const sides = axis === 'width' ? ['left', 'right'] : ['top', 'bottom']
      const edges = (box: CSSStyleDeclaration | undefined) => box?.boxSizing === 'border-box' ? sides.reduce((sum, side) => sum
        + (Number.parseFloat(box.getPropertyValue(`padding-${side}`)) || 0)
        + (Number.parseFloat(box.getPropertyValue(`border-${side}-width`)) || 0), 0) : 0
      // Hidden mounts retain percentage CSS sizes such as 100%. They are not
      // pixels; the current host layout supplies the authored frame until resolved.
      const cssSize = style?.getPropertyValue(axis).trim()
      const value = cssSize?.endsWith('px') ? Number.parseFloat(cssSize) : undefined
      if (value === undefined || !Number.isFinite(value) || value <= 0) {
        // Free-frame input is the outer border box. Its retained wrappers still
        // expose their insets while hidden; Flow retains its host-derived size.
        if (placement && placement.mode !== 'free-frame') return fallback
        const outer = scope.target({ kind: 'instance', instanceId: instance.id })?.element
        const boundary = root && outer?.contains(root) ? outer : root
        let inset = 0
        for (let node = root; node; node = node.parentElement ?? undefined) {
          inset += edges(node.ownerDocument.defaultView?.getComputedStyle(node))
          if (node === boundary) break
        }
        return Math.max(0, fallback - inset)
      }
      // Synchronous fallback before the first observation. Hidden mounts above
      // retain the current formal frame; client/viewport rects are not local sizes.
      return Math.max(0, value - edges(style || undefined))
    }
    const size = { width: contentSize('width', placement?.inlineSize ?? instance.frame.width),
      height: contentSize('height', placement?.blockSize ?? instance.frame.height) }
    const result = measureTextComponent(element, size, sizing(instance.data))
    applyTextComponentLayout(element, result)
    element.dataset.textOverflow = String(result.overflows)
    scope.events.emit(TEXT_LAYOUT_EVENT, { instanceId: instance.id, width: result.width + instance.frame.width - size.width,
      height: result.height + instance.frame.height - size.height, scale: result.scale, overflows: result.overflows })
  }
  const place = (accepted?: ComponentLayoutInput) => {
    if (!active() || !element) return
    const placement = accepted ?? layout?.read()
    if (layout) {
      // A flex text box isolates its lines from adjacent floats. Natural Flow
      // paragraphs participate in the surrounding reading flow instead.
      const natural = placement?.mode === 'flow-content'
      element.style.display = natural ? 'block' : 'flex'
      element.style.height = natural ? 'auto' : '100%'
    }
    measure(placement)
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
    const generation = ++fontGeneration
    const pending = prepareTextFonts(elementTextFontRequests(element), root.ownerDocument.fonts)
    fontsReady = !pending
    if (pending) void pending.then(() => {
      if (!active() || generation !== fontGeneration) return
      fontsReady = true; place()
    }, error => {
      if (!active() || generation !== fontGeneration) return
      // Keep the authored frame rather than persisting fallback-font geometry.
      console.warn('当前文字字体准备失败，保留原文字框尺寸', error)
    })
    place()
  }
  const dispose = () => { if (disposed) return; disposed = true; observer?.disconnect(); contentBox = undefined; releaseLayout?.(); releaseInline?.(); element?.remove(); element = null }
  scope.cleanup(dispose)
  paint()
  const Observer = root?.ownerDocument.defaultView?.ResizeObserver
  if (root && Observer && active()) {
    observer = new Observer(entries => {
      if (!active() || !instance.frame || layout?.read().mode === 'flow-content') return
      const entry = entries.find(value => value.target === root), box = entry?.contentBoxSize[0]
      if (!entry || !box) return
      const style = root.ownerDocument.defaultView?.getComputedStyle(root)
      const vertical = style?.writingMode.startsWith('vertical') || style?.writingMode.startsWith('sideways')
      const width = vertical ? box.blockSize : box.inlineSize, height = vertical ? box.inlineSize : box.blockSize
      if (!(width > 0 && height > 0)) { contentBox = undefined; return }
      const key = boxKey(style)
      if (contentBox?.key === key && contentBox.width === width && contentBox.height === height) return
      contentBox = { width, height, key }
      // Restart from authored fonts; a prior shrink measurement is presentation,
      // not the input for the next available box.
      paint()
    })
    observer.observe(root)
  }
  // Natural text reflows in CSS. Replacing its DOM from a height observation
  // creates a ResizeObserver feedback loop and discards live inline handles.
  releaseLayout = layout?.subscribe(input => { if (input.mode === 'flow-content') place(input); else paint() })
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
