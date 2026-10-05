import type { ComponentDefinition, ComponentInstance } from '../../shared/contracts/component-platform/project'
import { htmlDocumentKind } from '../../shared/html/documentKind'
import { isMeasuredWebFragmentBox } from '../../components/web/measuredFragmentBox'

/** Visual CSS may paint the wrapper; affine placement remains the frame owner's field. */
export function componentPaintStyle(instance: ComponentInstance, definition?: ComponentDefinition): Record<string, string | number> {
  const data = instance.data
  if (data && typeof data === 'object' && !Array.isArray(data)
    && typeof data.html === 'string' && isMeasuredWebFragmentBox(instance, htmlDocumentKind(data.html), undefined, definition)) {
    // Web CSS paints once in the content realm. Detached children still need their formal group clip.
    const clip: Record<string, string | number> = {}
    if (instance.childIds?.length) {
      const style = instance.style ?? {}
      const x = style['overflow-x'] ?? style.overflowX ?? style.overflow
      const y = style['overflow-y'] ?? style.overflowY ?? style.overflow
      if (typeof x === 'string' && /^(?:hidden|clip)$/.test(x)) clip.overflowX = x
      if (typeof y === 'string' && /^(?:hidden|clip)$/.test(y)) clip.overflowY = y
      if (Object.keys(clip).length) {
        for (const [key, value] of Object.entries(style)) {
          if (/^border-(?:radius|(?:top|bottom)-(?:left|right)-radius)$/.test(key)
            && (typeof value === 'string' || typeof value === 'number')) {
            clip[key.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase())] = value
          }
        }
      }
    }
    return clip
  }
  const geometry = /^(?:transform(?:-.+)?|translate|rotate|scale|zoom|position|inset(?:-.+)?|left|top|right|bottom|(?:min-|max-)?(?:width|height|inline-size|block-size)|margin(?:-.+)?|z-index|float|clear|order|flex(?:-.+)?|grid(?:-.+)?|align-self|justify-self)$/
  const result: Record<string, string | number> = {}
  for (const [key, value] of Object.entries(instance.style ?? {})) {
    const cssKey = key.startsWith('--') ? key : key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)
    if (geometry.test(cssKey) || typeof value !== 'string' && typeof value !== 'number') continue
    const reactKey = cssKey.startsWith('--') ? cssKey : cssKey === 'float' ? 'cssFloat'
      : cssKey.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase()).replace(/^Ms/, 'ms')
    result[reactKey] = value
  }
  if (instance.frame) result.boxSizing = 'border-box'
  return result
}

const previous = new WeakMap<HTMLElement, string[]>()
export function applyComponentPaintStyle(element: HTMLElement, instance: ComponentInstance, definition?: ComponentDefinition): void {
  for (const key of previous.get(element) ?? []) element.style.removeProperty(key)
  const style = componentPaintStyle(instance, definition), keys: string[] = []
  for (const [key, value] of Object.entries(style)) {
    const property = key === 'cssFloat' ? 'float' : key.startsWith('--') ? key : key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`).replace(/^ms-/, '-ms-')
    const unitless = /^(opacity|font-weight|line-height|flex|flex-grow|flex-shrink|order)$/.test(property)
    element.style.setProperty(property, typeof value === 'number' && value !== 0 && !unitless && !property.startsWith('--') ? `${value}px` : String(value))
    keys.push(property)
  }
  previous.set(element, keys)
}
