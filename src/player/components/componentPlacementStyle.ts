import type { ComponentDefinition, ComponentInstance } from '../../shared/contracts/component-platform/project'
import { componentPaintStyle } from '../../shared/componentPaintStyle'

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
