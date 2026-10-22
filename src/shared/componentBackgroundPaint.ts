import type { ComponentBackground } from './contracts/component-platform/project'
import { cssUrlReferences } from './composition/projectReferences'

/** Settings use one image representation. A color/image edit replaces a CSS paint branch. */
export function mergeComponentBackground(current: ComponentBackground | undefined, patch: ComponentBackground): ComponentBackground {
  const next = { ...current, ...patch }
  if (patch.paint !== undefined && patch.paint !== null) { delete next.color; delete next.assetId; delete next.fit }
  else if (patch.paint === null || ['color', 'assetId', 'fit'].some(key => Reflect.get(patch, key) !== undefined)) delete next.paint
  return next
}

export function componentBackgroundAssetIds(background: ComponentBackground | null | undefined): string[] {
  if (!background) return []
  return [...new Set(background.paint ? background.paint.layers.flatMap(layer => Object.values(layer.resourceBindings))
    : background.assetId ? [background.assetId] : [])]
}

export function rebindComponentBackground(background: ComponentBackground, map: (id: string) => string): ComponentBackground {
  return { ...background, ...(background.assetId ? { assetId: map(background.assetId) } : {}),
    ...(background.paint ? { paint: { layers: background.paint.layers.map(layer => ({ ...layer, style: { ...layer.style },
      resourceBindings: Object.fromEntries(Object.entries(layer.resourceBindings).map(([token, id]) => [token, map(id)])) })) } } : {}) }
}

function projectUrls(value: string, bindings: Readonly<Record<string, string>>, resolve: (id: string) => string | undefined): string {
  let result = '', cursor = 0
  for (const reference of cssUrlReferences(value)) {
    const id = bindings[reference.reference], url = id && resolve(id)
    if (!url) continue
    result += value.slice(cursor, reference.start) + `url(${JSON.stringify(url)})`
    cursor = reference.end
  }
  return result + value.slice(cursor)
}

/** The browser owns CSS background composition. This projection owns only resource URL leases. */
export function componentBackgroundPaintStyles(background: ComponentBackground | null | undefined,
  resolve: (id: string) => string | undefined): Record<string, string>[] {
  if (!background) return []
  if (background.paint) return background.paint.layers.map(layer => Object.fromEntries(Object.entries(layer.style)
    .map(([name, value]) => [name.replace(/-([a-z])/g, (_match, character: string) => character.toUpperCase()),
      projectUrls(value, layer.resourceBindings, resolve)])))
  const url = background.assetId && resolve(background.assetId)
  return [{ backgroundColor: background.color ?? 'transparent', backgroundImage: url ? `url(${JSON.stringify(url)})` : 'none',
    backgroundSize: background.fit === 'fill' ? '100% 100%' : background.fit ?? 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' }]
}

/** Paint lives before content and never participates in selection, ownership or document layout. */
export function applyComponentBackgroundPaint(root: HTMLElement, background: ComponentBackground | null | undefined,
  resolve: (id: string) => string | undefined): void {
  root.style.isolation = 'isolate'
  for (const name of ['background-color', 'background-image', 'background-size', 'background-position', 'background-repeat', 'background-origin', 'background-clip', 'background-attachment', 'background-blend-mode']) root.style.removeProperty(name)
  let paint = root.querySelector<HTMLElement>(':scope > [data-component-background-paint]')
  if (!background) { paint?.remove(); return }
  if (!paint) {
    paint = root.ownerDocument.createElement('div'); paint.dataset.componentBackgroundPaint = ''; paint.setAttribute('aria-hidden', 'true')
    paint.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:-1'
    root.prepend(paint)
  }
  const styles = componentBackgroundPaintStyles(background, resolve)
  while (paint.children.length > styles.length) paint.lastElementChild!.remove()
  styles.forEach((style, index) => {
    let layer = paint!.children[index] as HTMLElement | undefined
    if (!layer) { layer = root.ownerDocument.createElement('div'); paint!.append(layer) }
    layer.style.cssText = 'position:absolute;inset:0;pointer-events:none'
    for (const [name, value] of Object.entries(style)) layer.style.setProperty(name.replace(/[A-Z]/g, character => `-${character.toLowerCase()}`), value)
  })
}
