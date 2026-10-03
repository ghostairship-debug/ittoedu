import type { CompositionLayerItem } from '../../shared/courseProjectTypes'
import type { CompositionContentEdit } from '../../shared/composition/edit'
import type { CompositionBounds } from '../../player/composition/mountWebComposition'

type Node = CompositionLayerItem['content']['root']
export interface CompositionStyleOrigin { label: string; value: string; important: boolean }
export interface CompositionStyleFact { value: string; computed: string; origins: CompositionStyleOrigin[] }
export const cssPixels = (value: number) => `${Math.round(value * 100) / 100}px`
const number = (value: string) => Number.parseFloat(value) || 0

export function compositionDom(document: Document | null | undefined, nodeId: string): HTMLElement | null {
  return [...document?.querySelectorAll<HTMLElement>('[data-composition-node]') ?? []]
    .find(element => element.dataset.compositionNode === nodeId) ?? null
}

/** Read the browser's active rules; never store the resulting DOM or geometry. */
export function compositionStyleFact(element: HTMLElement, property: string): CompositionStyleFact {
  const win = element.ownerDocument.defaultView!, origins: CompositionStyleOrigin[] = []
  const rules = (list: CSSRuleList, context: string[] = []) => {
    for (const rule of Array.from(list)) {
      if ('selectorText' in rule && 'style' in rule) {
        const css = rule as CSSStyleRule
        let matches = false
        try { matches = element.matches(css.selectorText) } catch { /* Pseudo-element rules are not element declarations. */ }
        const value = css.style.getPropertyValue(property)
        if (matches && value) origins.push({ label: [...context, css.selectorText].join(' · '), value,
          important: css.style.getPropertyPriority(property) === 'important' })
      } else if ('cssRules' in rule) {
        if ('media' in rule && !win.matchMedia((rule as CSSMediaRule).conditionText).matches) continue
        if (rule.constructor.name === 'CSSSupportsRule' && !win.CSS.supports((rule as CSSSupportsRule).conditionText)) continue
        const label = rule.cssText.slice(0, rule.cssText.indexOf('{')).trim()
        rules((rule as CSSGroupingRule).cssRules, [...context, label])
      }
    }
  }
  for (const sheet of Array.from(element.ownerDocument.styleSheets)) {
    if (sheet.disabled || sheet.media.mediaText && !win.matchMedia(sheet.media.mediaText).matches) continue
    try { rules(sheet.cssRules) } catch { /* External rules without source access remain readable through computed style. */ }
  }
  const inline = element.style.getPropertyValue(property)
  if (inline) origins.push({ label: '当前元素', value: inline, important: element.style.getPropertyPriority(property) === 'important' })
  const computed = win.getComputedStyle(element).getPropertyValue(property)
  const typed = (element as HTMLElement & { computedStyleMap?(): { get(property: string): { toString(): string } | undefined } }).computedStyleMap?.().get(property)?.toString()
  const important = origins.filter(origin => origin.important)
  // Typed OM supplies the browser-selected percentage instead of resolved pixels.
  // When raw expressions are involved, retain their editing entry rather than guess a reverse formula.
  const candidates = important.length ? important : origins
  const value = inline && (!important.length || element.style.getPropertyPriority(property)) ? inline
    : candidates.some(origin => /(?:var|calc|min|max|clamp)\(/.test(origin.value)) ? candidates[candidates.length - 1]!.value
      : typed ?? (candidates.length === 1 ? candidates[0]!.value : computed)
  return { value, computed, origins }
}

export function compositionStylePatch(element: HTMLElement, patch: Record<string, string | null>): Record<string, string | null> {
  const offsetProperties = ['inset', 'left', 'top', 'right', 'bottom', 'inset-inline', 'inset-block', 'inset-inline-start', 'inset-inline-end', 'inset-block-start', 'inset-block-end']
  const importantOffset = offsetProperties.some(property => compositionStyleFact(element, property).origins.some(origin => origin.important))
  return Object.fromEntries(Object.entries(patch).map(([property, value]) => [property,
    value !== null && (importantOffset && offsetProperties.includes(property) || compositionStyleFact(element, property).origins.some(origin => origin.important))
      && !/!important\s*$/i.test(value) ? `${value} !important` : value]))
}

/** The client-to-iframe gesture conversion supports translation and positive axis-aligned scale. */
export function compositionViewportGestureIssue(iframe: HTMLIFrameElement): string | null {
  const win = iframe.ownerDocument.defaultView!
  const issue = '当前视图带有旋转或倾斜，内部拖动和缩放暂不可用；可通过属性、AI 或内容编辑调整。'
  for (let node: HTMLElement | null = iframe; node; node = node.parentElement) {
    const css = win.getComputedStyle(node)
    if (css.perspective !== 'none') return issue
    if (css.transform !== 'none') {
      const matrix = new win.DOMMatrixReadOnly(css.transform)
      if (!matrix.is2D || Math.abs(matrix.b) > 1e-8 || Math.abs(matrix.c) > 1e-8 || matrix.a <= 0 || matrix.d <= 0) return issue
    }
    if (css.rotate && css.rotate !== 'none') {
      const angle = css.rotate.trim().split(/\s+/).at(-1)!, value = Number.parseFloat(angle)
      const degrees = angle.endsWith('grad') ? value * .9 : angle.endsWith('rad') ? value * 180 / Math.PI : angle.endsWith('turn') ? value * 360 : value
      if (!Number.isFinite(degrees) || Math.abs(degrees / 360 - Math.round(degrees / 360)) > 1e-8) return issue
    }
    if (css.scale && css.scale !== 'none' && css.scale.trim().split(/\s+/).some(value => !Number.isFinite(Number.parseFloat(value)) || Number.parseFloat(value) <= 0)) return issue
  }
  return null
}

export function compositionGeometryIssue(element: HTMLElement): string | null {
  const win = element.ownerDocument.defaultView!
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const css = win.getComputedStyle(node)
    if (css.transform !== 'none' || css.perspective !== 'none' || !['none', ''].includes(css.translate || '')
      || !['none', ''].includes(css.rotate || '') || !['none', ''].includes(css.scale || '') || !['1', 'normal', ''].includes(css.zoom || ''))
      return '此区域使用 CSS 变换，请通过布局属性编辑。'
  }
  return win.getComputedStyle(element).writingMode !== 'horizontal-tb' ? '竖排区域请通过布局属性编辑。' : null
}

interface ContainingBox { x: number; y: number; width: number; height: number }
/** Absolute positioning uses the padding box of the existing positioned ancestor. */
export function compositionContainingBox(element: HTMLElement, parent = element.parentElement, fixed = false): ContainingBox {
  const doc = element.ownerDocument, win = doc.defaultView!
  if (!fixed) for (let ancestor = parent; ancestor; ancestor = ancestor.parentElement) {
    const css = win.getComputedStyle(ancestor)
    if (css.position !== 'static' || css.contain.split(/\s+/).some(value => ['layout', 'paint', 'strict', 'content'].includes(value))
      || css.filter !== 'none' || css.backdropFilter && css.backdropFilter !== 'none' || /(?:transform|filter|perspective)/.test(css.willChange) || css.contentVisibility === 'auto') {
      const rect = ancestor.getBoundingClientRect()
      return { x: rect.x + ancestor.clientLeft - ancestor.scrollLeft, y: rect.y + ancestor.clientTop - ancestor.scrollTop,
        width: ancestor.clientWidth, height: ancestor.clientHeight }
    }
  }
  return { x: fixed ? 0 : -win.scrollX, y: fixed ? 0 : -win.scrollY,
    width: doc.documentElement.clientWidth, height: doc.documentElement.clientHeight }
}

export function compositionCssSize(element: HTMLElement, rect: CompositionBounds): { width: number; height: number } {
  const css = element.ownerDocument.defaultView!.getComputedStyle(element), borderBox = css.boxSizing === 'border-box'
  return { width: rect.width - (borderBox ? 0 : number(css.paddingLeft) + number(css.paddingRight) + number(css.borderLeftWidth) + number(css.borderRightWidth)),
    height: rect.height - (borderBox ? 0 : number(css.paddingTop) + number(css.paddingBottom) + number(css.borderTopWidth) + number(css.borderBottomWidth)) }
}

export function compositionToFree(element: HTMLElement, nodeId: string, bounds?: CompositionBounds, parent?: HTMLElement): Extract<CompositionContentEdit, { type: 'style' }> {
  const issue = compositionGeometryIssue(element)
  if (issue) throw new Error(issue)
  const css = element.ownerDocument.defaultView!.getComputedStyle(element), rect = bounds ?? element.getBoundingClientRect()
  const box = compositionContainingBox(element, parent), size = compositionCssSize(element, rect)
  return { type: 'style', nodeId, patch: compositionStylePatch(element, {
    position: 'absolute', inset: 'auto', 'inset-inline': 'auto', 'inset-block': 'auto',
    'inset-inline-start': 'auto', 'inset-inline-end': 'auto', 'inset-block-start': 'auto', 'inset-block-end': 'auto',
    left: cssPixels(rect.x - box.x - number(css.marginLeft)), top: cssPixels(rect.y - box.y - number(css.marginTop)),
    right: 'auto', bottom: 'auto', width: cssPixels(size.width), height: cssPixels(size.height),
  }) }
}

/** Relative positioning participates in flow and keeps the element's absolute descendants anchored. */
export function compositionToFlow(element: HTMLElement, nodeId: string): Extract<CompositionContentEdit, { type: 'style' }> {
  return { type: 'style', nodeId, patch: compositionStylePatch(element, {
    position: 'relative', inset: 'auto', 'inset-inline': 'auto', 'inset-block': 'auto',
    'inset-inline-start': 'auto', 'inset-inline-end': 'auto', 'inset-block-start': 'auto', 'inset-block-end': 'auto', left: 'auto', top: 'auto', right: 'auto', bottom: 'auto',
  }) }
}

export function compositionGestureLength(element: HTMLElement, property: string, value: number, base: number,
  allowPixelOverride = false): string {
  const fact = compositionStyleFact(element, property), raw = fact.value.trim()
  if (/^-?(?:\d+\.?\d*|\.\d+)%$/.test(raw) && base > 0) return `${Math.round(value / base * 10000) / 100}%`
  if (!raw || raw === 'auto' || raw === 'none' || /^-?(?:\d+\.?\d*|\.\d+)(?:px)?$/.test(raw)) return cssPixels(value)
  if (allowPixelOverride) return cssPixels(value)
  throw new Error(`${property} 使用 ${raw}；保留原表达式编辑，或显式开启“手势使用像素覆盖”。`)
}

export function compositionResize(element: HTMLElement, nodeId: string, delta: { x: number; y: number },
  allowPixelOverride = false): { edit: CompositionContentEdit; bounds: CompositionBounds } {
  const issue = compositionGeometryIssue(element)
  if (issue) throw new Error(issue)
  const win = element.ownerDocument.defaultView!, css = win.getComputedStyle(element), parent = element.parentElement
  if (!parent) throw new Error('根容器请通过布局属性修改尺寸。')
  const parentCss = win.getComputedStyle(parent), rect = element.getBoundingClientRect(), size = compositionCssSize(element, rect)
  const containing = compositionContainingBox(element, parent, css.position === 'fixed')
  const clamp = (value: number, minimum: string, maximum: string, base: number) => {
    const limit = (raw: string, fallback: number) => raw.endsWith('%') ? number(raw) * base / 100 : raw.endsWith('px') ? number(raw) : fallback
    return Math.max(Math.max(1, limit(minimum, 0)), Math.min(limit(maximum, Infinity), value))
  }
  const free = css.position === 'absolute' || css.position === 'fixed'
  const baseWidth = free ? containing.width : parent.clientWidth - number(parentCss.paddingLeft) - number(parentCss.paddingRight)
  const baseHeight = free ? containing.height : parent.clientHeight - number(parentCss.paddingTop) - number(parentCss.paddingBottom)
  const width = clamp(size.width + delta.x, css.minWidth, css.maxWidth, baseWidth)
  const height = clamp(size.height + delta.y, css.minHeight, css.maxHeight, baseHeight)
  if (css.position === 'absolute' || css.position === 'fixed') return {
    edit: { type: 'style', nodeId, patch: compositionStylePatch(element, {
      ...(delta.x ? { width: compositionGestureLength(element, 'width', width, containing.width, allowPixelOverride) } : {}),
      ...(delta.y ? { height: compositionGestureLength(element, 'height', height, containing.height, allowPixelOverride) } : {}),
    }) }, bounds: { x: rect.x, y: rect.y, width: rect.width + width - size.width, height: rect.height + height - size.height },
  }
  if (parentCss.display.includes('flex')) {
    const horizontal = parentCss.flexDirection.startsWith('row'), property = horizontal ? 'width' : 'height'
    if (!(horizontal ? delta.x : delta.y)) return { edit: { type: 'style', nodeId, patch: {} }, bounds: rect }
    const basis = horizontal ? width : height, base = horizontal ? parent.clientWidth - number(parentCss.paddingLeft) - number(parentCss.paddingRight)
      : parent.clientHeight - number(parentCss.paddingTop) - number(parentCss.paddingBottom)
    const basisFact = compositionStyleFact(element, 'flex-basis')
    const value = basisFact.value !== 'auto' ? compositionGestureLength(element, 'flex-basis', basis, base, allowPixelOverride)
      : compositionGestureLength(element, property, basis, base, allowPixelOverride)
    return { edit: { type: 'style', nodeId, patch: compositionStylePatch(element, { 'flex-basis': value, 'flex-grow': '0', 'flex-shrink': '0' }) },
      bounds: { x: rect.x, y: rect.y, width: horizontal ? rect.width + width - size.width : rect.width,
        height: horizontal ? rect.height : rect.height + height - size.height } }
  }
  if (parentCss.display.includes('grid')) {
    if (!delta.x) return { edit: { type: 'style', nodeId, patch: {} }, bounds: rect }
    const tracks = parentCss.gridTemplateColumns.split(/\s+/).map(value => Number.parseFloat(value))
    const gap = number(parentCss.columnGap), start = parent.getBoundingClientRect().x + parent.clientLeft + number(parentCss.paddingLeft) - parent.scrollLeft
    let column = 0, edge = start
    while (column < tracks.length - 1 && rect.x > edge + tracks[column]! + gap / 2) { edge += tracks[column]! + gap; column++ }
    if (tracks.some(value => !Number.isFinite(value)) || Math.abs(rect.width - tracks[column]!) > 2 || column >= tracks.length - 1)
      throw new Error('此网格项跨列或位于最后一列，请通过网格列定义调整。')
    const next = Math.max(1, Math.min(tracks[column]! + tracks[column + 1]! - 1, tracks[column]! + delta.x))
    const original = compositionStyleFact(parent, 'grid-template-columns').value.trim().split(/\s+/)
    let values: string[]
    if (original.length === tracks.length && original.every(value => /^(?:\d+\.?\d*|\.\d+)(?:fr|px|%)$/.test(value))) {
      values = [...original]
      for (const index of [column, column + 1]) {
        const pixels = index === column ? next : tracks[column]! + tracks[column + 1]! - next
        const raw = original[index]!, oldValue = Number.parseFloat(raw)
        values[index] = raw.endsWith('fr') ? `${Math.round(oldValue * pixels / tracks[index]! * 10000) / 10000}fr`
          : raw.endsWith('%') ? `${Math.round(oldValue * pixels / tracks[index]! * 10000) / 10000}%` : cssPixels(pixels)
      }
    } else {
      if (!allowPixelOverride) throw new Error('网格列定义使用复杂规则；请修改原规则，或显式开启“手势使用像素覆盖”。')
      values = tracks.map((value, index) => cssPixels(index === column ? next : index === column + 1 ? tracks[column]! + tracks[column + 1]! - next : value))
    }
    const parentId = parent.dataset.compositionNode
    if (!parentId) throw new Error('网格容器没有正式编辑目标。')
    return { edit: { type: 'style', nodeId: parentId, patch: compositionStylePatch(parent, { 'grid-template-columns': values.join(' ') }) },
      bounds: { x: rect.x, y: rect.y, width: next, height: rect.height } }
  }
  throw new Error('此自动布局请通过宽度、高度或容器规则调整。')
}

export function compositionHasResize(element: HTMLElement): boolean {
  const win = element.ownerDocument.defaultView!, css = win.getComputedStyle(element)
  return ['absolute', 'fixed'].includes(css.position) || Boolean(element.parentElement
    && /flex|grid/.test(win.getComputedStyle(element.parentElement).display))
}

export function compositionTreeParent(root: Node, nodeId: string): Extract<Node, { kind: 'element' }> | undefined {
  if (root.kind !== 'element') return undefined
  if (root.children.some(child => child.id === nodeId)) return root
  for (const child of root.children) { const parent = compositionTreeParent(child, nodeId); if (parent) return parent }
  return undefined
}
