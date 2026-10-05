import { renderDocumentMath, renderDocumentText } from '../../shared/document/render'
import type { FlowTextContent } from '../../shared/document/content'
import type { FormulaComponentData, TextAppearance, TextComponentData, TextSizing } from './data'

export interface TextComponentSize { width: number; height: number }
export interface TextLayoutResult {
  /** Only this height may be proposed to the host geometry owner; no position or width mutation. */
  height: number
  scale: number
  overflows: boolean
}
export function resolveTextComponentLayout(size: TextComponentSize, sizing: TextSizing, measured: TextComponentSize): TextLayoutResult {
  if (sizing.mode === 'grow-height') return { height: Math.max(size.height, sizing.minHeight, measured.height), scale: 1, overflows: measured.width > size.width + 0.5 }
  return { height: size.height, scale: 1, overflows: measured.width > size.width + 0.5 || measured.height > size.height + 0.5 }
}
const escapeAttribute = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
const kebab = (value: string) => value.replace(/[A-Z]/g, character => `-${character.toLowerCase()}`)
const css = (style: Record<string, string>) => Object.entries(style).map(([key, value]) => `${kebab(key)}:${value}`).join(';')
/** Background/border opacity must not fade the authored text or formulas. */
function translucentColor(color: string, opacity: number): string {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(color)
  if (match) return `rgba(${Number.parseInt(match[1], 16)},${Number.parseInt(match[2], 16)},${Number.parseInt(match[3], 16)},${opacity})`
  return `color-mix(in srgb, ${color} ${opacity * 100}%, transparent)`
}
export function textAppearanceStyles(appearance: TextAppearance, sizing: TextSizing) {
  const box: Record<string, string> = {
    boxSizing: 'border-box', display: 'flex', flexDirection: 'column', height: '100%',
    justifyContent: appearance.verticalAlign === 'middle' ? 'center' : appearance.verticalAlign === 'bottom' ? 'flex-end' : 'flex-start',
    padding: `${appearance.padding}px`, backgroundColor: translucentColor(appearance.backgroundColor, appearance.backgroundOpacity),
    borderStyle: 'solid', borderWidth: `${appearance.borderWidth}px`, borderColor: translucentColor(appearance.borderColor, appearance.borderOpacity),
    borderRadius: `${appearance.cornerRadius}px`, overflow: sizing.overflow === 'clip' ? 'hidden' : 'visible',
  }
  const content: Record<string, string> = {
    minWidth: '0', flexShrink: '0', width: '100%', fontFamily: appearance.fontFamily, fontSize: `${appearance.fontSize}px`,
    color: appearance.color, textAlign: appearance.align,
    // The native professional algorithm uses 1.22 * fontSize plus a px line gap, not a multiplier gap.
    lineHeight: appearance.lineSpacing === undefined ? String(appearance.lineHeight) : `calc(1.22em + ${appearance.lineSpacing}px)`,
    fontWeight: appearance.bold ? '700' : '400', fontStyle: appearance.italic ? 'italic' : 'normal',
    letterSpacing: `${appearance.letterSpacing}px`, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
    writingMode: appearance.writingMode === 'horizontal' ? 'horizontal-tb' : appearance.writingMode,
    transform: `scale(${appearance.flipX ? -1 : 1},${appearance.flipY ? -1 : 1})`, transformOrigin: 'center',
  }
  if (appearance.writingMode !== 'horizontal') content.height = '100%'
  return { box, content }
}
/** Apply whole-text defaults inside each run so an explicit false/null range really overrides them. */
export function styledTextContent(data: TextComponentData): FlowTextContent {
  const { bold, italic, underline, strike, emphasis, highlightColor } = data.appearance
  return { inlines: data.content.inlines.map(inline => inline.type === 'text'
    ? { ...inline, style: { bold, italic, underline, strike, emphasis, highlightColor, ...inline.style } }
    : structuredClone(inline)) }
}
function componentHtml(markup: string, appearance: TextAppearance, sizing: TextSizing, accessibleText?: string): string {
  const styles = textAppearanceStyles(appearance, sizing)
  return `<div data-text-component="true" style="${escapeAttribute(css(styles.box))}"${accessibleText === undefined ? '' : ` aria-label="${escapeAttribute(accessibleText)}"`}><div data-text-component-content="true" style="${escapeAttribute(css(styles.content))}">${markup}</div></div>`
}
export function textComponentHtml(data: TextComponentData): string { return componentHtml(renderDocumentText(styledTextContent(data)), data.appearance, data.sizing) }
export function formulaComponentHtml(data: FormulaComponentData): string {
  const appearance = { ...data.appearance, ...data.formula.style }
  return componentHtml(renderDocumentMath(data.formula.latex, true), appearance, data.sizing, data.formula.accessibleText)
}
function htmlElement(dom: Document, html: string): HTMLElement {
  const template = dom.createElement('template')
  template.innerHTML = html
  // Template contents use an inert document; measurement needs the real body.
  return dom.adoptNode(template.content.firstElementChild as HTMLElement)
}
export function renderTextComponent(dom: Document, data: TextComponentData): HTMLElement {
  return htmlElement(dom, textComponentHtml(data))
}
export function renderFormulaComponent(dom: Document, data: FormulaComponentData): HTMLElement {
  return htmlElement(dom, formulaComponentHtml(data))
}
/** Measure in the same document as the actual renderer, with its loaded fonts. No layout writer lives here. */
export function measureTextComponent(element: HTMLElement, size: TextComponentSize, sizing: TextSizing): TextLayoutResult {
  const probe = element.cloneNode(true) as HTMLElement
  Object.assign(probe.style, { position: 'absolute', visibility: 'hidden', pointerEvents: 'none', left: '0', top: '0',
    width: `${size.width}px`, height: 'auto', minHeight: '0', maxHeight: 'none', overflow: 'visible' })
  const content = probe.querySelector<HTMLElement>('[data-text-component-content]')
  if (content?.style.writingMode.startsWith('vertical')) probe.style.height = `${size.height}px`
  element.ownerDocument.body.appendChild(probe)
  const read = (): TextComponentSize => {
    const horizontalEdges = Number.parseFloat(probe.style.padding || '0') * 2 + Number.parseFloat(probe.style.borderWidth || '0') * 2
    return { width: Math.max(probe.getBoundingClientRect().width, probe.scrollWidth, (content?.scrollWidth ?? 0) + horizontalEdges),
      height: Math.max(probe.getBoundingClientRect().height, probe.scrollHeight) }
  }
  try {
    let result = resolveTextComponentLayout(size, sizing, read())
    if (sizing.mode === 'shrink-text' && result.overflows) {
      // Scale every inline font, including explicitly styled math/text runs, then remeasure wrapping.
      const fonts = [probe, ...probe.querySelectorAll<HTMLElement>('[style]')].filter(node => node.style.fontSize)
        .map(node => ({ node, value: Number.parseFloat(node.style.fontSize) }))
      const apply = (scale: number) => fonts.forEach(({ node, value }) => { node.style.fontSize = `${value * scale}px` })
      let low = 0, high = 1
      for (let iteration = 0; iteration < 16; iteration++) {
        const scale = (low + high) / 2
        apply(scale)
        if (resolveTextComponentLayout(size, sizing, read()).overflows) high = scale
        else low = scale
      }
      apply(low)
      result = { ...resolveTextComponentLayout(size, sizing, read()), scale: low }
    }
    return result
  } finally { probe.remove() }
}
/** Apply the measured presentation without persisting reduced font sizes into authored content. */
export function applyTextComponentLayout(element: HTMLElement, result: TextLayoutResult): void {
  element.style.height = `${result.height}px`
  if (result.scale !== 1) {
    for (const node of [element, ...element.querySelectorAll<HTMLElement>('[style]')]) {
      if (node.style.fontSize) node.style.fontSize = `${Number.parseFloat(node.style.fontSize) * result.scale}px`
    }
  }
}
