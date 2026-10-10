import { IDENTITY_MATRIX, reparentFrame, type AffineFrame } from '../../components/geometry'

export interface HtmlAssemblyDiagnostic {
  level: 'info' | 'warning' | 'error'
  code: string
  message: string
  reference?: string
  /** Temporary source location, not an author identity. */
  sourcePath?: readonly number[]
}

export type MeasuredHtmlChild =
  | { kind: 'element'; index: number }
  | { kind: 'text' | 'comment'; text: string }

/** One browser read, before any assembly changes. Frame maps into the design viewport. */
export interface MeasuredHtmlElement {
  sourcePath: readonly number[]
  tagName: string
  namespace?: string
  attributes: Record<string, string>
  sourceHtml: string
  style: Record<string, string>
  /** Measured parent layout, needed to distinguish flex/grid z-index and order. */
  parentDisplay?: string
  pseudoElements: Record<string, Record<string, string>>
  children: MeasuredHtmlChild[]
  frame?: AffineFrame
  geometryIssue?: string
}

export interface HtmlDesignCapture {
  viewport: { width: number; height: number }
  /** Rendered content boxes, excluding the implicit document canvas. */
  contentBounds?: { x: number; y: number; width: number; height: number }
  /** Known viewport-dependent CSS in this measured shell, not a source execution verdict. */
  viewportDependent?: boolean
  body: number
  pageStyle: Record<string, string>
  /** Font faces and keyframes needed by retained internal content, without page layout rules. */
  supportCss?: string
  /** Actual DOM relationships, resolved before descendants can become separate objects. */
  sourceScopes?: { index: number; reason: string; html?: string }[]
  elements: MeasuredHtmlElement[]
  diagnostics: HtmlAssemblyDiagnostic[]
}

/** Inline formatting and atomic Web content stay inside their object. */
export type HtmlObjectContent =
  | { kind: 'text' | 'comment'; text: string }
  | { kind: 'element'; tagName: string; namespace?: string; attributes: Record<string, string>;
      style: Record<string, string>; pseudoElements: Record<string, Record<string, string>>; children: HtmlObjectContent[] }

export interface HtmlSourceRegion {
  sourcePath: readonly number[]
  html: string
  reason: string
}

export interface HtmlAssemblyObject {
  kind: 'group' | 'text' | 'image' | 'svg' | 'web' | 'program'
  label: string
  sourcePath: readonly number[]
  frame: AffineFrame
  /** Outer layout declarations are removed. The frame is its only position owner. */
  style: Record<string, string>
  pseudoElements: Record<string, Record<string, string>>
  /** Browser ordering inputs for L19 to assign one formal parent order. */
  stacking?: { zIndex: string; layoutOrder: string; positioned?: boolean }
  content?: HtmlObjectContent
  /** Program source is retained, never converted to a static image. */
  program?: { html: string; reason: string }
  /** Static interactive HTML/CSS keeps one browser document, without computed child styles. */
  retainedSource?: { html: string; reason: string }
  children: HtmlAssemblyObject[]
  /** Pure paint has no text/media role, but participates in the same measured paint order. */
  decorations: { sourcePath: readonly number[]; frame: AffineFrame; content: HtmlObjectContent;
    stacking?: HtmlAssemblyObject['stacking']; interleaves?: boolean }[]
  /** Hidden or non-affine regions retain source when they have no usable free frame. */
  sourceRegions: HtmlSourceRegion[]
}

export interface HtmlAssembly {
  viewport: { width: number; height: number }
  root: HtmlAssemblyObject
  diagnostics: HtmlAssemblyDiagnostic[]
  supportCss?: string
  /** The body has a shared internal layout that a Flow reading list must retain. */
  flowCoupled?: boolean
  /** Input for an explicit later redo; it does not continuously own page geometry. */
  source: { html: string; themeCss?: string }
}

const INLINE = new Set(['a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'cite', 'code', 'del', 'dfn', 'em', 'i', 'ins', 'kbd', 'mark', 'q', 'ruby', 'rp', 'rt', 's', 'samp', 'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'var', 'wbr'])
const NON_CONTENT = new Set(['base', 'head', 'link', 'meta', 'script', 'style', 'template', 'title'])
const SEMANTIC_GROUP = new Set(['article', 'aside', 'figure', 'fieldset', 'footer', 'header', 'main', 'nav', 'section', 'ul', 'ol', 'li'])
const POSITION_STYLE = /^(?:position|inset(?:-.+)?|top|right|bottom|left|(?:min-|max-)?(?:width|height|inline-size|block-size)|margin(?:-.+)?|transform(?:-.+)?|translate|rotate|scale|zoom|z-index|float|clear|order|flex(?:-.+)?|grid(?:-.+)?|align-self|justify-self)$/
const GROUP_LAYOUT_STYLE = /^(?:display|padding(?:-.+)?|gap|row-gap|column-gap|align-items|align-content|justify-items|justify-content)$/

/** Retains paint, clipping, inherited fonts and effects, without another outer layout owner. */
export function htmlObjectStyle(style: Readonly<Record<string, string>>, group = false): Record<string, string> {
  return Object.fromEntries(Object.entries(style).filter(([name]) => !POSITION_STYLE.test(name) && !(group && GROUP_LAYOUT_STYLE.test(name))))
}

function hasPaint(element: MeasuredHtmlElement): boolean {
  const style = element.style
  return !!(style['background-image'] && style['background-image'] !== 'none'
    || style['background-color'] && !['transparent', 'rgba(0, 0, 0, 0)'].includes(style['background-color'])
    || style['box-shadow'] && style['box-shadow'] !== 'none'
    || parseFloat(style['outline-width'] ?? '0') > 0 && style['outline-style'] !== 'none'
    || ['top', 'right', 'bottom', 'left'].some(side => parseFloat(style[`border-${side}-width`] ?? '0') > 0 && style[`border-${side}-style`] !== 'none')
    || Object.keys(element.pseudoElements).length)
}

function stackingOf(element: MeasuredHtmlElement): NonNullable<HtmlAssemblyObject['stacking']> {
  const style = element.style
  const layoutItem = /^(?:inline-)?(?:flex|grid)$/.test(element.parentDisplay ?? '')
  const positioned = ['relative', 'absolute', 'fixed', 'sticky'].includes(style.position ?? '')
  return { zIndex: positioned || layoutItem ? style['z-index'] ?? 'auto' : 'auto',
    layoutOrder: layoutItem ? style.order ?? '0' : '0' }
}

/** Context boundaries are atomic in their parent, even when the wrapper has no paint. */
function hasStackingContext(element: MeasuredHtmlElement): boolean {
  const style = element.style
  return stackingOf(element).zIndex !== 'auto'
    || ['fixed', 'sticky'].includes(style.position ?? '')
    || ['transform', 'translate', 'rotate', 'scale', 'filter', 'backdrop-filter', 'perspective'].some(name => Boolean(style[name] && style[name] !== 'none'))
    || Number(style.opacity ?? '1') < 1
    || style.isolation === 'isolate'
    || Boolean(style['mix-blend-mode'] && style['mix-blend-mode'] !== 'normal')
    || /(?:^|\s)(?:layout|paint|strict|content)(?:\s|$)/.test(style.contain ?? '')
    || /(?:^|,\s*)(?:transform|opacity|filter|perspective)(?:\s*,|$)/.test(style['will-change'] ?? '')
}

function sourceProgramReason(element: MeasuredHtmlElement): string | undefined {
  if (['iframe', 'canvas', 'object', 'embed'].includes(element.tagName)) return element.tagName
  if (Object.keys(element.attributes).some(name => /^on[a-z]/i.test(name))) return 'event-handler'
  if (Object.entries(element.attributes).some(([name, value]) => /^(?:href|src|action|formaction)$/.test(name) && /^javascript:/i.test(value.trim().replace(/[\t\r\n]/g, '')))) return 'event-handler'
  return undefined
}

/** Converts only a completed capture. No DOM mutation or formal identity allocation occurs here. */
export function assembleMeasuredHtml(capture: HtmlDesignCapture, source: HtmlAssembly['source'], framing: 'viewport' | 'content' = 'viewport'): HtmlAssembly {
  const diagnostics = [...capture.diagnostics]
  const sourceScopes = new Map(capture.sourceScopes?.map(scope => [scope.index, scope]))
  const documentScope = sourceScopes.get(capture.body)
  if (documentScope) {
    diagnostics.push({ level: 'info', code: 'html-semantic-source-scope', message: `关联的 ${documentScope.reason} 保留本次完整输入，后代不再拆分。`, sourcePath: [] })
    return { viewport: { ...capture.viewport }, source, diagnostics, flowCoupled: true,
      root: { kind: 'web', label: '关联内容', sourcePath: [], frame: { ...capture.viewport, transform: IDENTITY_MATRIX },
        style: {}, pseudoElements: {}, retainedSource: { html: source.html, reason: documentScope.reason }, children: [], decorations: [], sourceRegions: [] } }
  }
  const element = (index: number) => capture.elements[index]!
  const textOf = (index: number): string => element(index).children.map(child => child.kind === 'element' ? NON_CONTENT.has(element(child.index).tagName) ? '' : textOf(child.index) : child.kind === 'text' ? child.text : '').join('')
  const contentOf = (index: number, outer = false): HtmlObjectContent => {
    const value = element(index)
    // Computed style owns this render snapshot. Original inline CSS remains available in sourceHtml,
    // and cannot reintroduce a second positioning owner through the style attribute.
    const attributes = Object.fromEntries(Object.entries(value.attributes).filter(([name]) => name !== 'style'))
    return { kind: 'element', tagName: value.tagName, namespace: value.namespace, attributes,
      style: outer ? htmlObjectStyle(value.style) : { ...value.style }, pseudoElements: value.pseudoElements,
      children: value.children.map(child => child.kind === 'element' ? contentOf(child.index) : { ...child }) }
  }
  const inline = (index: number): boolean => {
    const value = element(index)
    return INLINE.has(value.tagName) && !sourceProgramReason(value)
      && !['absolute', 'fixed'].includes(value.style.position ?? '')
      && (!value.style.transform || value.style.transform === 'none')
      && (!value.style.rotate || value.style.rotate === 'none')
      && (!value.style.scale || value.style.scale === 'none')
      && value.children.every(child => child.kind !== 'element' || inline(child.index))
  }
  const kindOf = (index: number): HtmlAssemblyObject['kind'] | 'decoration' => {
    const value = element(index)
    if (sourceScopes.has(index)) return 'web'
    if (sourceProgramReason(value)) return 'program'
    if (['img', 'picture'].includes(value.tagName)) return 'image'
    if (value.tagName === 'svg') return 'svg'
    if (['table', 'video', 'audio', 'input', 'select', 'textarea', 'button', 'details'].includes(value.tagName)) return 'web'
    const children = value.children.filter((child): child is Extract<MeasuredHtmlChild, { kind: 'element' }> => child.kind === 'element' && !NON_CONTENT.has(element(child.index).tagName))
    const ownText = value.children.some(child => child.kind === 'text' && child.text.trim())
    if (textOf(index).trim() && children.every(child => inline(child.index))) return 'text'
    // Mixed anonymous text and block children need their internal browser layout.
    if (ownText) return 'web'
    if (!children.length) return 'decoration'
    return 'group'
  }
  const bounds = framing === 'content' ? capture.contentBounds : undefined
  const rootFrame: AffineFrame = bounds && bounds.width > 0 && bounds.height > 0
    ? { width: bounds.width, height: bounds.height, transform: [1, 0, 0, 1, bounds.x, bounds.y] }
    : { ...capture.viewport, transform: IDENTITY_MATRIX }
  if (framing === 'content' && !bounds) diagnostics.push({ level: 'warning', code: 'html-content-bounds-unavailable',
    message: '片段没有可测的初始内容边界；保留设计视口及源码。' })
  const root: HtmlAssemblyObject = { kind: 'group', label: framing === 'content' ? '内容' : '页面', sourcePath: [],
    frame: rootFrame, style: htmlObjectStyle(capture.pageStyle, true),
    pseudoElements: element(capture.body).pseudoElements, children: [], decorations: [], sourceRegions: [] }
  const bodyContent = contentOf(capture.body, true)
  if (bodyContent.kind === 'element') root.content = { ...bodyContent, children: [], style: root.style }

  const append = (index: number, parent: HtmlAssemblyObject, parentToViewport: AffineFrame['transform']): void => {
    const value = element(index)
    if (NON_CONTENT.has(value.tagName)) return
    if (!value.frame || value.geometryIssue) {
      parent.sourceRegions.push({ sourcePath: value.sourcePath, html: value.sourceHtml, reason: value.geometryIssue ?? 'not-laid-out' })
      if (value.geometryIssue) diagnostics.push({ level: 'warning', code: 'html-source-region', message: `局部 ${value.tagName} 保留源码：${value.geometryIssue}`, sourcePath: value.sourcePath })
      return
    }
    const kind = kindOf(index)
    // Layout-only wrappers disappear after measurement; their children keep exact parent coordinates.
    if (kind === 'group' && !SEMANTIC_GROUP.has(value.tagName) && !hasPaint(value) && !hasStackingContext(value)
      && !value.attributes.id && !value.attributes['aria-label'] && !value.attributes.title
      && (!value.style.transform || value.style.transform === 'none')
      && (!value.style.rotate || value.style.rotate === 'none')
      && (!value.style.scale || value.style.scale === 'none')
      && (value.style.opacity ?? '1') === '1' && (value.style.filter ?? 'none') === 'none'
      && !['hidden', 'clip', 'scroll', 'auto'].includes(value.style.overflow ?? 'visible')) {
      value.children.forEach(child => { if (child.kind === 'element') append(child.index, parent, parentToViewport) })
      return
    }
    const frame = reparentFrame(value.frame, IDENTITY_MATRIX, parentToViewport)
    if (kind === 'decoration') {
      if (hasPaint(value)) parent.decorations.push({ sourcePath: value.sourcePath, frame, content: contentOf(index, true),
        stacking: { ...stackingOf(value), positioned: hasStackingContext(value) || ['relative', 'absolute', 'fixed', 'sticky'].includes(value.style.position ?? '') },
        interleaves: hasStackingContext(value) || ['relative', 'absolute', 'fixed', 'sticky'].includes(value.style.position ?? '')
          || /^(?:inline-)?(?:flex|grid)$/.test(value.parentDisplay ?? '') })
      return
    }
    const label = value.attributes['aria-label'] || value.attributes.title || value.attributes.alt
      || textOf(index).trim().replace(/\s+/g, ' ').slice(0, 80) || value.attributes.id || value.tagName
    const object: HtmlAssemblyObject = { kind, label, sourcePath: value.sourcePath, frame,
      style: htmlObjectStyle(value.style, kind === 'group'), pseudoElements: value.pseudoElements,
      stacking: { ...stackingOf(value), positioned: hasStackingContext(value) || ['relative', 'absolute', 'fixed', 'sticky'].includes(value.style.position ?? '') },
      children: [], decorations: [], sourceRegions: [] }
    parent.children.push(object)
    const scope = sourceScopes.get(index)
    if (scope) {
      object.retainedSource = { html: scope.html ?? value.sourceHtml, reason: scope.reason }
      // The retained document paints its own root. Its formal frame alone owns external placement.
      object.style = {}
      object.pseudoElements = {}
      diagnostics.push({ level: 'info', code: 'html-semantic-source-scope', message: `关联的 ${scope.reason} 保留在同一 Web 文档，后代不再拆分。`, sourcePath: value.sourcePath })
    } else if (kind === 'group') {
      const shell = contentOf(index, true)
      if (shell.kind === 'element') object.content = { ...shell, style: object.style, children: [] }
      // A collapsed affine group is kept as one source region: children cannot be reparented through it.
      const [a, b, c, d] = value.frame.transform
      if (a * d - b * c === 0) {
        object.kind = 'program'; object.program = { html: value.sourceHtml, reason: 'singular-transform' }
        diagnostics.push({ level: 'info', code: 'html-source-region', message: '零尺度编组保留为源码区域。', sourcePath: value.sourcePath })
      } else value.children.forEach(child => { if (child.kind === 'element') append(child.index, object, value.frame!.transform) })
    } else if (kind === 'program') object.program = { html: value.sourceHtml, reason: sourceProgramReason(value)! }
    else object.content = contentOf(index, true)
  }
  element(capture.body).children.forEach(child => { if (child.kind === 'element') append(child.index, root, root.frame.transform) })
  // Anonymous body text has no independently measured box. Preserve its browser layout as a source region.
  if (element(capture.body).children.some(child => child.kind === 'text' && child.text.trim())) {
    return sourceProgramAssembly(capture.viewport, source, 'anonymous-body-content', diagnostics,
      framing === 'content' ? capture : undefined)
  }
  // A layout-only wrapper may have been flattened above for free placement. Flow
  // still needs its authored CSS layout, so decide coupling from the capture.
  const coupled = Boolean(sourceScopes.size) || capture.elements.some(value => ['flex', 'inline-flex', 'grid', 'inline-grid'].includes(value.style.display ?? '')
      || ['left', 'right'].includes(value.style.float ?? '')
      || ['absolute', 'fixed', 'sticky'].includes(value.style.position ?? '')
      || ['transform', 'rotate', 'scale'].some(name => Boolean(value.style[name] && value.style[name] !== 'none'))
      || Number(value.style['column-count']) > 1
      || Boolean(value.style['column-width'] && value.style['column-width'] !== 'auto'))
    || root.children.some(child => child.kind === 'group' || child.content?.kind === 'element' && child.content.tagName === 'details')
    || Boolean(root.decorations.length || root.sourceRegions.length)
  return { viewport: { ...capture.viewport }, root, diagnostics, supportCss: capture.supportCss, source, flowCoupled: coupled }
}

export function sourceProgramAssembly(viewport: HtmlAssembly['viewport'], source: HtmlAssembly['source'], reason: string,
  diagnostics: readonly HtmlAssemblyDiagnostic[] = [], shell?: HtmlDesignCapture): HtmlAssembly {
  const bounds = shell?.contentBounds
  const measurable = reason === 'anonymous-body-content' && bounds && bounds.width > 0 && bounds.height > 0
    && bounds.x >= 0 && bounds.y >= 0 && !shell?.viewportDependent
  // Source still owns its internal CSS coordinates. Keep their zero origin and
  // positive leading space; shifting the root to bounds.x/y would count it twice.
  const size = measurable ? { width: bounds.x + bounds.width, height: bounds.y + bounds.height } : viewport
  const messages = [...diagnostics, { level: 'info' as const, code: 'html-source-program', message: `含 ${reason} 的耦合内容保留完整源码。` }]
  if (shell) messages.push(measurable
    ? { level: 'info', code: 'html-program-shell-size', message: '静态匿名正文按已测内容占位；原始文本和排版源码已保留。' }
    : { level: 'info', code: 'html-program-shell-viewport', message: '程序使用已分配设计视口；禁脚本初态不能代表其动态边界，完整源码已保留。' })
  return { viewport: { ...viewport }, source, diagnostics: messages,
    root: { kind: 'program', label: '源程序', sourcePath: [], frame: { ...size, transform: IDENTITY_MATRIX },
      style: {}, pseudoElements: {}, program: { html: source.html, reason }, children: [], decorations: [], sourceRegions: [] } }
}
