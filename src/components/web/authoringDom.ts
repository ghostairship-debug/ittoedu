import type { ComponentAuthorBinding, ComponentAuthorRecord, ComponentAuthorScope, ComponentAuthorGeometryObservation, ComponentAuthorGeometry, ComponentAuthorSpotInput } from '../../shared/contracts/component-platform/runtime'
import { componentPaintStack } from './paintHit'

/** Author-content invalidation shared by the adapter and the HTML observer.
 * A synchronous paint read can temporarily override inline pointer-events;
 * a restored attribute has no authored change for either consumer to rescan.
 * Self contained for the embedded HTML adapter. Observe attributeOldValue.
 */
export function authoringMutationRoots(records: readonly MutationRecord[]): Node[] {
  const attributes = new Map<Node, Map<string, string | null>>()
  const key = (record: MutationRecord) => `${record.attributeNamespace ?? ''}\0${record.attributeName}`
  for (const record of records) if (record.type === 'attributes') {
    let first = attributes.get(record.target)
    if (!first) { first = new Map(); attributes.set(record.target, first) }
    if (!first.has(key(record))) first.set(key(record), record.oldValue)
  }
  const hint = (node: Node): boolean => {
    for (let current: Node | null = node.nodeType === 3 ? node.parentNode : node; current;) {
      if (current.nodeType === 1 && (current as Element).closest('[data-html-preview-edit-markers]')) return true
      const tree = current.getRootNode()
      current = tree.nodeType === 11 && 'host' in tree ? (tree as ShadowRoot).host : null
    }
    return false
  }
  return records.filter(record => {
    if (hint(record.target)) return false
    if (record.type === 'childList') return [...record.addedNodes, ...record.removedNodes].some(node => !hint(node))
    if (record.type === 'attributes') return (record.target as Element).getAttributeNS(record.attributeNamespace, record.attributeName!)
      !== attributes.get(record.target)!.get(key(record))
    return true
  }).map(record => record.target)
}

export interface DomAuthorObservation {
  node: Text | HTMLImageElement
  authorKey: string
  record: ComponentAuthorRecord
  initialValue: string
  bindingStatus: 'bound' | 'unresolved'
  geometry?: ComponentAuthorGeometryObservation
  textStyle?: ComponentAuthorSpotInput['textStyle']
}

/**
 * The same finite DOM content adapter runs in the component realm and in saved
 * HTML. Keep runtime dependencies inside this function: HTML embeds its source.
 * It never submits edits and never recreates author nodes or executes programs.
 */
export function createDomAuthoring(root: HTMLElement, options: {
  records(): Record<string, ComponentAuthorRecord>
  /** Parser document identity, shared by observation and record rebinding. */
  scope?: ComponentAuthorScope
  resolveResource?(reference: string): string | undefined
  matchesResource?(reference: string, liveUrl: string): boolean
  resourceReference?(url: string): string | undefined
  originalText?(node: Text): string | undefined
  claimText?(node: Text, text: string | null): void
  onChange?(): void
  /** Early HTML bootstrap may retain closed roots without changing their mode. */
  shadowRoot?(host: Element): ShadowRoot | null | undefined
  report?(authorKey: string, status: 'bound' | 'unmounted' | 'unresolved'): void
}, paintStack: typeof componentPaintStack = componentPaintStack, mutationRoots = authoringMutationRoots) {
  type Target = Text | HTMLImageElement
  type Container = Element | ShadowRoot
  type Path = ComponentAuthorBinding['path']
  type Property = { original: string | null; applied: string | null; priority?: string; computed?: string }
  type Applied = { node: Target; content?: Property; attributes: Map<Element, Map<string, Property>>; styles: Map<string, Property> }
  type ValueIndex = Map<string, Target[]>
  type ScanLookup = { elements: Map<string, Container[]>; scopes: WeakMap<Element, ComponentAuthorScope>;
    paths: WeakMap<Container, Path>; indices: WeakMap<Element, number>; indexedParents: WeakSet<Container>;
    values: Map<string, ValueIndex>; nodeIndexes: WeakMap<Target, Set<ValueIndex>>; contexts: WeakMap<Container, string | null> }
  let lookup: ScanLookup | undefined
  const withLookup = <Value,>(work: () => Value): Value => {
    if (lookup) return work()
    lookup = { elements: new Map(), scopes: new WeakMap(), paths: new WeakMap(), indices: new WeakMap(), indexedParents: new WeakSet(),
      values: new Map(), nodeIndexes: new WeakMap(), contexts: new WeakMap() }
    try { return work() } finally { lookup = undefined }
  }
  const doc = root.ownerDocument, win = doc.defaultView!
  type PaintScope = NonNullable<Parameters<typeof componentPaintStack>[5]>
  let paintScope: PaintScope | undefined
  const withReadScope = <Value,>(read: () => Value): Value => {
    if (paintScope) return read()
    const current: PaintScope = { prepared: new Map(), restore: [], paint: new Map(), shown: new Map() }
    paintScope = current
    try { return read() } finally {
      try { for (const restore of current.restore.reverse()) restore() } finally { paintScope = undefined }
    }
  }
  const descriptions = new WeakMap<Node, { scope: string; observation: DomAuthorObservation }>()
  const observedNodes = new Map<string, Target>()
  const previews = new Map<string, { node: Target; record: ComponentAuthorRecord; geometry: ComponentAuthorGeometry }>()
  const active = new Map<string, Applied>(), statuses = new Map<string, string>()
  let disposed = false, queued = false, refreshing = false, observationActive = true, dirty = false
  let explicitActive = true, runtimeActive = true
  let reactScopes = new WeakMap<Element, ComponentAuthorScope>()
  const shadowOf = (host: Element) => options.shadowRoot?.(host) ?? host.shadowRoot
  const hostOf = (node: Node | null): Element | undefined => node?.nodeType === 11 && 'host' in node ? (node as ShadowRoot).host : undefined
  const parentOf = (element: Element): Element | null => element.parentElement ?? hostOf(element.parentNode) ?? null
  const within = (node: Node): boolean => {
    for (let current: Node | undefined = node; current; current = hostOf(current.getRootNode())) if (root.contains(current)) return true
    return false
  }
  const containerOf = (node: Target): Container => node.nodeType === 3 ? node.parentNode as Container : node as HTMLImageElement
  const elementOf = (node: Target) => node.nodeType === 3 ? node.parentElement ?? hostOf(node.parentNode)! : node as HTMLImageElement
  const nodesWithin = (start: Node) => {
    const result: Node[] = [], stack: Node[] = [...start.childNodes].reverse()
    if (start.nodeType === 1) { const shadow = shadowOf(start as Element); if (shadow) stack.push(shadow) }
    while (stack.length) {
      const node = stack.pop()!
      // Hint chrome can have an open shadow root; closest() inside that root
      // does not cross its host. It is never author content or an observed root.
      if (node.nodeType === 1 && (node as Element).hasAttribute('data-html-preview-edit-markers')) continue
      result.push(node)
      stack.push(...[...node.childNodes].reverse())
      if (node.nodeType === 1) { const shadow = shadowOf(node as Element); if (shadow) stack.push(shadow) }
    }
    return result
  }
  const contentRoots = (): Array<HTMLElement | ShadowRoot> => [root, ...nodesWithin(root).filter(node => node.nodeType === 11 && 'host' in node) as ShadowRoot[]]
  const valueOf = (node: Target) => node.nodeType === 3 ? node.nodeValue ?? '' : (node as HTMLImageElement).getAttribute('src') ?? ''
  const authorValueOf = (node: Target) => node.nodeType === 3 ? options.originalText?.(node as Text) ?? valueOf(node)
    : options.resourceReference?.(valueOf(node)) ?? valueOf(node)
  const cssAxes = (value: string) => {
    const result: string[] = []; let start = 0, depth = 0
    for (let index = 0; index < value.length; index++) {
      if (value[index] === '(') depth++
      else if (value[index] === ')') depth--
      else if (!depth && /\s/.test(value[index]!)) {
        if (index > start) result.push(value.slice(start, index)); start = index + 1
      }
    }
    if (start < value.length) result.push(value.slice(start))
    return result
  }
  const visibleBounds = (node: Node) => {
    if (node.nodeType !== 1 && node.nodeType !== 3) return null
    const element = elementOf(node as Target), style = win.getComputedStyle(element)
    if (style.visibility === 'hidden' || style.visibility === 'collapse') return null
    const paintedColor = (value: string) => Boolean(value && value !== 'none' && value !== 'transparent'
      && !/^rgba\([^)]*,\s*0(?:\.0+)?\s*\)$/.test(value) && !/\/\s*0(?:\.0+)?\s*\)$/.test(value))
    if (node.nodeType === 3) {
      if (!node.textContent?.trim()) return null
      const paint = element.namespaceURI === 'http://www.w3.org/2000/svg'
        ? paintedColor(style.fill) && Number(style.fillOpacity || '1') > 0
          || paintedColor(style.stroke) && Number(style.strokeOpacity || '1') > 0 && parseFloat(style.strokeWidth || '1') > 0
        : paintedColor(style.getPropertyValue('-webkit-text-fill-color') || style.color)
          || Boolean(style.textShadow && style.textShadow !== 'none')
      if (!paint) return null
    }
    const range = node.nodeType === 3 ? doc.createRange() : undefined
    range?.selectNodeContents(node)
    const rect = range ? range.getBoundingClientRect?.() : element.getBoundingClientRect()
    let left = rect?.left ?? -Infinity, top = rect?.top ?? -Infinity
    let right = rect?.right ?? Infinity, bottom = rect?.bottom ?? Infinity
    const clip = (x: number, y: number, width: number, height: number, horizontal = true, vertical = true) => {
      if (horizontal) { left = Math.max(left, x); right = Math.min(right, x + width) }
      if (vertical) { top = Math.max(top, y); bottom = Math.min(bottom, y + height) }
    }
    const establishesPositionedBlock = (css: CSSStyleDeclaration) => Boolean(
      css.transform && css.transform !== 'none' || css.perspective && css.perspective !== 'none'
      || css.filter && css.filter !== 'none' || css.backdropFilter && css.backdropFilter !== 'none'
      || css.translate && css.translate !== 'none' || css.rotate && css.rotate !== 'none' || css.scale && css.scale !== 'none'
      || /(?:^|\s)(?:layout|paint|strict|content)(?:\s|$)/.test(css.contain)
      || /(?:^|,|\s)(?:transform|perspective|filter)(?:\s|,|$)/.test(css.willChange))
    const containingBlock = (positioned: Element, fixed: boolean): Element => {
      for (let parent = parentOf(positioned); parent; parent = parentOf(parent)) {
        const css = win.getComputedStyle(parent)
        if (establishesPositionedBlock(css) || !fixed && css.position && css.position !== 'static') return parent
      }
      return doc.documentElement
    }
    // Out-of-flow descendants escape overflow boxes between themselves and
    // their actual containing block. Opacity, clip-path and display still apply.
    let overflowContainingBlock: Element | undefined
    const rootStyle = win.getComputedStyle(doc.documentElement)
    const bodyOverflowOnViewport = rootStyle.overflowX === 'visible' && rootStyle.overflowY === 'visible'
      || !rootStyle.overflowX && !rootStyle.overflowY
    for (let current: Element | null = element; current; current = parentOf(current)) {
      const css = win.getComputedStyle(current)
      // Match the paint reader: zero-opacity ancestors leave layout boxes but no content.
      if (css.display === 'none' || css.opacity !== '' && Number(css.opacity) === 0 || css.contentVisibility === 'hidden') return null
      const box = current.getBoundingClientRect()
      const sx = current instanceof win.HTMLElement && current.offsetWidth ? box.width / current.offsetWidth : 1
      const sy = current instanceof win.HTMLElement && current.offsetHeight ? box.height / current.offsetHeight : 1
      if (current === overflowContainingBlock) overflowContainingBlock = undefined
      const horizontal = /^(hidden|clip|auto|scroll)$/.test(css.overflowX), vertical = /^(hidden|clip|auto|scroll)$/.test(css.overflowY)
      if (horizontal || vertical) {
        const viewport = current === doc.documentElement || current === doc.body && bodyOverflowOnViewport
        if (viewport) clip(0, 0, win.innerWidth, win.innerHeight, horizontal, vertical)
        else if (!overflowContainingBlock) clip(box.left, box.top, box.width, box.height, horizontal, vertical)
      }
      const oldClip = /^(?:absolute|fixed)$/.test(css.position) && /^rect\(([^)]+)\)$/.exec(css.clip)
      if (oldClip) {
        const edges = oldClip[1]!.split(/[\s,]+/).filter(Boolean).map((value, index) => value === 'auto'
          ? index === 1 ? box.width / sx : index === 2 ? box.height / sy : 0 : parseFloat(value))
        if (edges.length === 4 && edges.every(Number.isFinite)) clip(box.left + edges[3]! * sx, box.top + edges[0]! * sy, (edges[1]! - edges[3]!) * sx, (edges[2]! - edges[0]!) * sy)
      }
      const inset = /^inset\(([^)]+)\)$/.exec(css.clipPath)
      if (inset) {
        const values = inset[1]!.split(/\s+round\s+/)[0]!.trim().split(/\s+/)
        const edges = [values[0], values[1] ?? values[0], values[2] ?? values[0], values[3] ?? values[1] ?? values[0]]
          .map((value, index) => parseFloat(value!) * (value!.endsWith('%') ? (index % 2 ? box.width : box.height) / 100 : index % 2 ? sx : sy))
        if (edges.every(Number.isFinite)) clip(box.left + edges[3]!, box.top + edges[0]!, box.width - edges[1]! - edges[3]!, box.height - edges[0]! - edges[2]!)
      }
      if (left >= right || top >= bottom) return null
      if (!overflowContainingBlock && (css.position === 'fixed' || css.position === 'absolute')) overflowContainingBlock = containingBlock(current, css.position === 'fixed')
    }
    return { x: left, y: top, width: right - left, height: bottom - top }
  }
  const visible = (node: Node) => Boolean(visibleBounds(node))
  const paintIgnore = '[data-html-preview-edit-markers]'
  type PaintRect = { x: number; y: number; width: number; height: number }
  const intersectRect = (a: PaintRect, b: PaintRect): PaintRect | null => {
    const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y)
    const right = Math.min(a.x + a.width, b.x + b.width), bottom = Math.min(a.y + a.height, b.y + b.height)
    return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null
  }
  /** A layout box can survive below another page or modal. Read the same paint
   * stack as hit(), including pointer-events:none decorations, without letting
   * the editor's own hint layer become an occluder. */
  const painted = (node: Node, region?: PaintRect): boolean => {
    const bounds = visibleBounds(node)
    if (!bounds) return false
    if (typeof doc.elementsFromPoint !== 'function') return true
    const element = elementOf(node as Target), range = node.nodeType === 3 ? doc.createRange() : undefined
    range?.selectNodeContents(node)
    const boxes = range ? [...range.getClientRects()] : [element.getBoundingClientRect()]
    const viewport = { x: 0, y: 0, width: win.innerWidth, height: win.innerHeight }
    const pending = boxes.flatMap(box => {
      let clipped = intersectRect(box, bounds)
      if (clipped) clipped = intersectRect(clipped, viewport)
      if (clipped && region) clipped = intersectRect(clipped, region)
      return clipped ? [clipped] : []
    })
    const seen = new Set<string>()
    while (pending.length) {
      const box = pending.pop()!, key = `${box.x},${box.y},${box.width},${box.height}`
      if (seen.has(key)) continue
      seen.add(key)
      const dx = Math.min(.5, box.width / 4), dy = Math.min(.5, box.height / 4)
      const points = [[box.x + box.width / 2, box.y + box.height / 2], [box.x + dx, box.y + dy],
        [box.x + box.width - dx, box.y + dy], [box.x + dx, box.y + box.height - dy], [box.x + box.width - dx, box.y + box.height - dy]]
      const blockers = new Set<Element>()
      for (const [x, y] of points) {
        const top = paintStack(root, x!, y!, paintIgnore, shadowOf, paintScope)[0]
        if (top === element) return true
        if (top) blockers.add(top)
      }
      // Follow the actual occluder's edges rather than dropping a partially
      // visible line just because its centre (or a fixed inset) is covered.
      for (const blocker of blockers) {
        const overlap = intersectRect(box, blocker.getBoundingClientRect())
        if (!overlap) continue
        const right = box.x + box.width, bottom = box.y + box.height, ox = overlap.x + overlap.width, oy = overlap.y + overlap.height
        if (overlap.x > box.x) pending.push({ x: box.x, y: box.y, width: overlap.x - box.x, height: box.height })
        if (ox < right) pending.push({ x: ox, y: box.y, width: right - ox, height: box.height })
        if (overlap.y > box.y) pending.push({ x: box.x, y: box.y, width: box.width, height: overlap.y - box.y })
        if (oy < bottom) pending.push({ x: box.x, y: oy, width: box.width, height: bottom - oy })
      }
    }
    return false
  }
  const contextValueOf = (element: Container) => {
    if (lookup?.contexts.has(element)) return lookup.contexts.get(element)!
    const value = readContextValue(element)
    lookup?.contexts.set(element, value)
    return value
  }
  const readContextValue = (element: Container) => {
    if (!options.originalText) return element.textContent
    const walker = doc.createTreeWalker(element, 4), values: string[] = []
    for (let node = walker.nextNode(); node; node = walker.nextNode()) values.push(authorValueOf(node as Text))
    return values.join('')
  }
  const eligible = (node: Node): node is Target => node.nodeType === 1 && (node as Element).localName === 'img'
    || node.nodeType === 3 && Boolean(node.nodeValue?.trim()) && Boolean(node.parentElement ?? hostOf(node.parentNode))
      && !elementOf(node as Text).closest('script,style,noscript,template,textarea,title,option,[contenteditable],[data-html-preview-edit-markers]')
  const targets = () => {
    return nodesWithin(root).filter(eligible)
  }
  const ordered = (scope: ComponentAuthorScope) => JSON.stringify(Object.entries(scope).sort(([a], [b]) => a.localeCompare(b)))
  const newKey = () => {
    if (typeof win.crypto.randomUUID === 'function') return `dom-${win.crypto.randomUUID()}`
    // Saved file/opaque frames can expose getRandomValues without the secure-
    // context randomUUID convenience method. Keys remain local software data.
    const bytes = win.crypto.getRandomValues(new Uint8Array(16))
    bytes[6] = (bytes[6]! & 15) | 64; bytes[8] = (bytes[8]! & 63) | 128
    return `dom-${[...bytes].map(value => value.toString(16).padStart(2, '0')).join('')}`
  }

  // React keys and explicit data IDs identify repeated program items. Read the
  // current committed tree, never mutate its fibers or treat hook state as data.
  // DOM adapters still work when a framework does not expose this information.
  const readReactScopes = () => {
    reactScopes = new WeakMap()
    const roots = new Set<any>()
    for (const element of [root, ...nodesWithin(root).filter(node => node.nodeType === 1) as Element[]]) {
      const name = Object.keys(element).find(key => key.startsWith('__reactFiber$'))
      if (!name) continue
      let fiber = (element as unknown as Record<string, any>)[name]
      while (fiber?.return) fiber = fiber.return
      if (fiber?.stateNode?.current) roots.add(fiber.stateNode.current)
    }
    const visit = (fiber: any, inherited: ComponentAuthorScope, keyDepth: number) => {
      if (!fiber) return
      const scope = { ...inherited }
      if (fiber.key !== null && fiber.key !== undefined) scope[`react:key:${keyDepth++}`] = String(fiber.key)
      const props = fiber.memoizedProps
      if (props && typeof props === 'object' && typeof fiber.type !== 'string') {
        for (const [name, value] of Object.entries(props)) {
          if (/^(children|ref|active|selected|hover|focus|current|progress)/i.test(name)) continue
          if (/^(id|.*Id|.*Key)$/.test(name) && (typeof value === 'string' || typeof value === 'number')) scope[`react:${name}`] = String(value)
          else if (value && typeof value === 'object' && !Array.isArray(value)) {
            const id = (value as Record<string, unknown>).id
            if (typeof id === 'string' || typeof id === 'number') scope[`react:${name}.id`] = String(id)
          }
        }
      }
      if (fiber.stateNode?.nodeType === 1) reactScopes.set(fiber.stateNode, scope)
      for (let child = fiber.child; child; child = child.sibling) visit(child, scope, keyDepth)
    }
    for (const fiber of roots) visit(fiber, {}, 0)
  }
  const scopeOf = (element: Element): ComponentAuthorScope => {
    const cached = lookup?.scopes.get(element)
    if (cached) return cached
    const scope = { ...reactScopes.get(element), ...options.scope }
    let depth = 0
    for (let current: Element | null = element; current && within(current); current = parentOf(current)) {
      for (const attribute of [...current.attributes]) {
        if (/^data-(?:(?:item|record|entity|author|state|scene|view)-)?(?:id|key|state)$/.test(attribute.name))
          scope[`dom:${depth}:${attribute.name}`] = attribute.value
      }
      depth++
      if (current === root) break
    }
    lookup?.scopes.set(element, scope)
    return scope
  }
  const attributesOf = (element: Element): Record<string, string> => {
    const attributes: Record<string, string> = {}
    for (const name of ['id', 'role', 'aria-label', 'name']) {
      const value = element.getAttribute(name)
      if (value) attributes[name] = value
    }
    // Structural classes help distinguish local regions, but UI state classes
    // must not retire an address whenever the selected line changes.
    const classes = [...element.classList].filter(value => !/^(?:(?:is|has)-)?(?:active|selected|playing|paused|hidden|open|closed|focused|hovered|disabled)$/.test(value))
    if (classes.length) attributes.class = classes.join(' ')
    return attributes
  }
  const pathFor = (element: Container): Path => {
    const cached = lookup?.paths.get(element)
    if (cached) return cached
    if (lookup) {
      if (element === root) return []
      if (element.nodeType === 11) return [...pathFor((element as ShadowRoot).host), { tag: '#shadow-root', index: 0 }]
      const parent = element.parentNode as Container | null
      if (parent && !lookup.indexedParents.has(parent)) {
        [...parent.children].forEach((child, index) => lookup!.indices.set(child, index))
        lookup.indexedParents.add(parent)
      }
      const attributes = attributesOf(element as Element)
      const path = [...(parent && within(parent) ? pathFor(parent) : []), { tag: (element as Element).localName, index: lookup.indices.get(element as Element) ?? 0,
        ...(Object.keys(attributes).length ? { attributes } : {}) }]
      lookup.paths.set(element, path)
      return path
    }
    const path: Path = []
    for (let current: Container | null = element; current && current !== root; current = current.nodeType === 11 ? (current as ShadowRoot).host : current.parentNode as Container | null) {
      if (current.nodeType === 11) { path.unshift({ tag: '#shadow-root', index: 0 }); continue }
      const attributes = attributesOf(current as Element)
      path.unshift({ tag: (current as Element).localName, index: current.parentNode && 'children' in current.parentNode ? [...(current.parentNode as Container).children].indexOf(current as Element) : 0,
        ...(Object.keys(attributes).length ? { attributes } : {}) })
    }
    return path
  }
  const matches = (element: Element, step: Path[number]) => element.localName === step.tag
    && Object.entries(step.attributes ?? {}).every(([name, value]) => name === 'class'
      ? value.split(/\s+/).every(token => element.classList.contains(token)) : element.getAttribute(name) === value)
  const elementsAt = (path: Path): Container[] => {
    const key = JSON.stringify(path.map(({ tag, attributes }) => ({ tag, attributes })))
    const cached = lookup?.elements.get(key)
    if (cached) return cached
    let candidates: Container[] = [root]
    for (const step of path) candidates = step.tag === '#shadow-root'
      ? candidates.flatMap(parent => parent.nodeType === 1 ? shadowOf(parent as Element) ?? [] : [])
      : candidates.flatMap(parent => [...parent.children].filter(child => matches(child, step)))
    lookup?.elements.set(key, candidates)
    return candidates
  }
  const sameScope = (element: Container, scope?: ComponentAuthorScope) => ordered(scopeOf(element.nodeType === 11 ? (element as ShadowRoot).host : element as Element)) === ordered(scope ?? {})
  const resolve = (key: string, record: ComponentAuthorRecord, previous?: Applied): { node?: Target; status: 'bound' | 'unmounted' | 'unresolved' } => {
    if (lookup) {
      const path = record.binding.path.map(({ tag, attributes }) => ({ tag, attributes }))
      const group = JSON.stringify([path, ordered(record.scope ?? {}), record.kind, record.binding.textIndex ?? 0])
      let values = lookup.values.get(group)
      if (!values) {
        const candidates = elementsAt(record.binding.path).filter(element => sameScope(element, record.scope))
        if (!candidates.length) return { status: 'unmounted' }
        values = new Map()
        for (const element of candidates) {
          const node = record.kind === 'image' ? (element as Element).localName === 'img' ? element as HTMLImageElement : undefined
            : [...element.childNodes].filter(node => node.nodeType === 3)[record.binding.textIndex ?? 0] as Text | undefined
          if (!node) continue
          const value = node.nodeType === 3 ? authorValueOf(node) : valueOf(node)
          const bucket = values.get(value) ?? []; bucket.push(node); values.set(value, bucket)
          const indexes = lookup.nodeIndexes.get(node) ?? new Set<ValueIndex>()
          indexes.add(values); lookup.nodeIndexes.set(node, indexes)
        }
        lookup.values.set(group, values)
      }
      const override = record.kind === 'text' ? record.overrides.text : record.overrides.src
      const resolvedOverride = record.kind === 'image' && override ? options.resolveResource?.(override) ?? override : override
      const baseline = record.kind === 'image' ? options.resolveResource?.(record.binding.baseline) ?? record.binding.baseline : record.binding.baseline
      const nodes = new Set([...(values.get(baseline) ?? []), ...(resolvedOverride !== undefined ? values.get(resolvedOverride) ?? [] : [])])
      if (record.kind === 'image' && options.matchesResource) for (const [value, candidates] of values)
        if (options.matchesResource(record.binding.baseline, value) || override !== undefined && options.matchesResource(override, value))
          for (const node of candidates) nodes.add(node)
      if (previous && lookup.nodeIndexes.get(previous.node)?.has(values) && valueOf(previous.node) === previous.content?.applied) nodes.add(previous.node)
      if (record.binding.context?.some(context => { const anchors = elementsAt(context.path); return anchors.length !== 1 || contextValueOf(anchors[0]!) !== context.value })) return { status: 'unresolved' }
      return nodes.size === 1 ? { node: [...nodes][0], status: 'bound' } : { status: 'unresolved' }
    }
    const candidates = elementsAt(record.binding.path).filter(element => sameScope(element, record.scope))
    if (!candidates.length) return { status: 'unmounted' }
    const nodes = candidates.flatMap(element => {
      const node = record.kind === 'image' ? (element as Element).localName === 'img' ? element as HTMLImageElement : undefined
        : [...element.childNodes].filter(node => node.nodeType === 3)[record.binding.textIndex ?? 0] as Text | undefined
      if (!node) return []
      const value = node.nodeType === 3 ? authorValueOf(node) : valueOf(node), override = record.kind === 'text' ? record.overrides.text : record.overrides.src
      const resolvedOverride = record.kind === 'image' && override ? options.resolveResource?.(override) ?? override : override
      const baseline = record.kind === 'image' ? options.resolveResource?.(record.binding.baseline) ?? record.binding.baseline : record.binding.baseline
      if (value !== baseline && value !== resolvedOverride
        && !(record.kind === 'image' && (options.matchesResource?.(record.binding.baseline, value)
          || override !== undefined && options.matchesResource?.(override, value)))
        && !(previous?.node === node && value === previous.content?.applied)) return []
      if (record.binding.context?.some(context => {
        const anchors = elementsAt(context.path)
        return anchors.length !== 1 || contextValueOf(anchors[0]!) !== context.value
      })) return []
      return [node]
    })
    if (nodes.length === 1) return { node: nodes[0], status: 'bound' }
    return { status: 'unresolved' }
  }
  const status = (key: string, value: 'bound' | 'unmounted' | 'unresolved') => {
    if (statuses.get(key) !== value) { statuses.set(key, value); options.report?.(key, value) }
  }
  const setAttribute = (element: Element, name: string, value: string | null) => {
    if (element.getAttribute(name) === value) return
    if (value === null) element.removeAttribute(name)
    else element.setAttribute(name, value)
  }
  const restore = (state: Applied) => {
    if (state.content && valueOf(state.node) === state.content.applied) {
      if (state.node.nodeType === 3) state.node.nodeValue = state.content.original
      else setAttribute(state.node as HTMLImageElement, 'src', state.content.original)
    }
    if (state.node.nodeType === 3) options.claimText?.(state.node as Text, null)
    for (const [element, attributes] of state.attributes) for (const [name, property] of attributes)
      if (element.getAttribute(name) === property.applied) setAttribute(element, name, property.original)
    const element = elementOf(state.node) as HTMLElement
    for (const [name, property] of state.styles) if (element.style.getPropertyValue(name) === property.applied) {
      if (property.original) element.style.setProperty(name, property.original, property.priority)
      else element.style.removeProperty(name)
    }
  }
  const apply = (record: ComponentAuthorRecord, state: Applied) => {
    const element = elementOf(state.node) as HTMLElement
    const value = record.kind === 'text' ? record.overrides.text : record.overrides.src
    const content = value === undefined ? undefined : record.kind === 'image' ? options.resolveResource?.(value) ?? value : value
    if (content !== undefined) {
      if (state.node.nodeType === 3) options.claimText?.(state.node as Text, content)
      const current = valueOf(state.node)
      if (!state.content || current !== state.content.applied) state.content = { original: current, applied: content }
      else state.content.applied = content
      if (current !== content) {
        if (state.node.nodeType === 3) state.node.nodeValue = content
        else (state.node as HTMLImageElement).setAttribute('src', content)
      }
    } else if (state.content) {
      if (valueOf(state.node) === state.content.applied) {
        if (state.node.nodeType === 3) state.node.nodeValue = state.content.original
        else setAttribute(state.node as HTMLImageElement, 'src', state.content.original)
      }
      state.content = undefined
      if (state.node.nodeType === 3) options.claimText?.(state.node as Text, null)
    }
    const attribute = (target: Element, name: string, value: string | null) => {
      const properties = state.attributes.get(target) ?? new Map<string, Property>()
      state.attributes.set(target, properties)
      const current = target.getAttribute(name), previous = properties.get(name)
      properties.set(name, { original: previous && current === previous.applied ? previous.original : current, applied: value })
      setAttribute(target, name, value)
    }
    // A replacement image must also win responsive <picture>/srcset selection.
    // Restore the exact declarations on undo; do not rewrite unrelated images.
    if (record.kind === 'image' && content !== undefined) {
      const image = state.node as HTMLImageElement
      if (image.hasAttribute('srcset') || state.attributes.get(image)?.has('srcset')) attribute(image, 'srcset', null)
      if (image.parentElement?.localName === 'picture') for (const source of image.parentElement.querySelectorAll('source'))
        attribute(source, 'srcset', null)
    } else if (state.attributes.size) {
      for (const [target, properties] of state.attributes) for (const [name, property] of properties)
        if (target.getAttribute(name) === property.applied) setAttribute(target, name, property.original)
      state.attributes.clear()
    }
    const styles = { ...record.overrides.style }, geometry = record.overrides.geometry
    const baseStyle = (name: string) => {
      const previous = state.styles.get(name), current = element.style.getPropertyValue(name)
      return previous && current === previous.applied ? previous.computed ?? previous.original ?? ''
        : win.getComputedStyle(element).getPropertyValue(name) || current
    }
    const applyStyle = (name: string, value: string) => {
      const current = element.style.getPropertyValue(name), previous = state.styles.get(name)
      const original = previous && current === previous.applied ? previous.original : current
      const priority = previous && current === previous.applied ? previous.priority : element.style.getPropertyPriority(name)
      const computed = previous && current === previous.applied ? previous.computed : win.getComputedStyle(element).getPropertyValue(name)
      const declaration = doc.createElement('span').style
      declaration.setProperty(name, value)
      if (current !== declaration.getPropertyValue(name)) element.style.setProperty(name, value)
      state.styles.set(name, { original, priority, computed, applied: element.style.getPropertyValue(name) })
    }
    if (geometry) {
      if (geometry.width !== undefined) styles.width = `${geometry.width}px`
      if (geometry.height !== undefined) styles.height = `${geometry.height}px`
      if (record.kind === 'text' && (geometry.width !== undefined || geometry.height !== undefined)
        && baseStyle('display') === 'inline') styles.display = 'inline-block'
      // A percentage origin belongs to the new box, including when a rotated
      // text box is resized again. Keep the same restoration bookkeeping.
      for (const name of ['display', 'width', 'height']) if (styles[name] !== undefined) applyStyle(name, styles[name]!)
      const changesLinear = geometry.scaleX !== undefined || geometry.scaleY !== undefined || geometry.rotation !== undefined
      if (geometry.translateX !== undefined || geometry.translateY !== undefined || changesLinear) {
        const base = cssAxes(baseStyle('translate') || '0px 0px')
        // Individual transforms share the source's transform-origin. Keep that
        // pivot for its existing transform and compensate only the author delta:
        // T(O) T(A + RS*O - O) RS M T(-O) = T(A) RS T(O) M T(-O).
        const origin = win.getComputedStyle(element).transformOrigin.split(/\s+/).map(value => parseFloat(value) || 0)
        const angle = (geometry.rotation ?? 0) * Math.PI / 180, cosine = Math.cos(angle), sine = Math.sin(angle)
        const x = (origin[0] ?? 0) * (geometry.scaleX ?? 1), y = (origin[1] ?? 0) * (geometry.scaleY ?? geometry.scaleX ?? 1)
        const dx = (geometry.translateX ?? 0) + cosine * x - sine * y - (origin[0] ?? 0)
        const dy = (geometry.translateY ?? 0) + sine * x + cosine * y - (origin[1] ?? 0)
        styles.translate = `calc(${base[0] === 'none' ? '0px' : base[0]} + ${dx}px) calc(${base[1] ?? '0px'} + ${dy}px)`
      }
      if (geometry.scaleX !== undefined || geometry.scaleY !== undefined) {
        const source = baseStyle('scale'), base = (!source || source === 'none' ? '1 1' : source).split(/\s+/)
        styles.scale = `calc(${base[0]} * ${geometry.scaleX ?? 1}) calc(${base[1] ?? base[0]} * ${geometry.scaleY ?? geometry.scaleX ?? 1})`
      }
      if (geometry.rotation !== undefined) {
        const source = baseStyle('rotate')
        styles.rotate = `calc(${!source || source === 'none' ? '0deg' : source} + ${geometry.rotation}deg)`
      }
    }
    for (const [name, property] of state.styles) if (!(name in styles)) {
      if (element.style.getPropertyValue(name) === property.applied) {
        if (property.original) element.style.setProperty(name, property.original, property.priority)
        else element.style.removeProperty(name)
      }
      state.styles.delete(name)
    }
    for (const [name, value] of Object.entries(styles)) applyStyle(name, value)
  }
  const refresh = () => withLookup(() => {
    if (disposed || refreshing) return
    refreshing = true
    try {
      syncObservedRoots()
      readReactScopes()
      const records = { ...options.records() }
      for (const [key, preview] of previews) {
        const formal = records[key] ?? preview.record
        records[key] = { ...formal, overrides: { ...formal.overrides, geometry: preview.geometry } }
      }
      for (const [key, node] of observedNodes) if (!within(node)) observedNodes.delete(key)
      for (const [key, state] of active) if (!records[key]) { restore(state); active.delete(key); statuses.delete(key) }
      for (const [key, record] of Object.entries(records)) {
        const previous = active.get(key), preview = previews.get(key)
        const result = preview && within(preview.node) && sameScope(elementOf(preview.node), preview.record.scope)
          ? { node: preview.node, status: 'bound' as const } : resolve(key, record, previous)
        if (previous && result.node !== previous.node) { restore(previous); active.delete(key) }
        if (result.node) {
          const state = active.get(key) ?? { node: result.node, attributes: new Map(), styles: new Map() }
          const oldValue = result.node.nodeType === 3 ? authorValueOf(result.node) : valueOf(result.node)
          active.set(key, state); apply(record, state)
          const nextValue = result.node.nodeType === 3 ? authorValueOf(result.node) : valueOf(result.node)
          if (oldValue !== nextValue) for (const index of lookup?.nodeIndexes.get(result.node) ?? []) {
            const old = index.get(oldValue)?.filter(node => node !== result.node) ?? []
            if (old.length) index.set(oldValue, old); else index.delete(oldValue)
            index.set(nextValue, [...index.get(nextValue) ?? [], result.node])
          }
          if (oldValue !== nextValue) for (let parent: Element | null = elementOf(result.node); parent && within(parent); parent = parentOf(parent)) lookup?.contexts.delete(parent)
          observedNodes.set(key, result.node)
          descriptions.set(result.node, { scope: ordered(record.scope ?? {}), observation: {
            node: result.node, authorKey: key, record, initialValue: record.kind === 'image' ? record.overrides.src ?? authorValueOf(result.node) : valueOf(result.node),
            bindingStatus: 'bound',
          } })
        }
        status(key, result.status)
      }
    } finally { refreshing = false; if (inputPaintTarget !== undefined) refreshInputPaint() }
  })
  const describe = (node: Node): DomAuthorObservation | null => {
    if (!eligible(node) || !within(node)) return null
    const element = elementOf(node), scope = scopeOf(element), scopeKey = ordered(scope)
    const previous = descriptions.get(node)
    if (previous?.scope === scopeKey) {
      const record = options.records()[previous.observation.authorKey]
      if (record || previous.observation.record.binding.baseline === authorValueOf(node)) return { ...previous.observation,
        record: record ?? { ...previous.observation.record, overrides: {} },
        bindingStatus: resolve(previous.observation.authorKey, record ?? previous.observation.record, active.get(previous.observation.authorKey)).node === node ? 'bound' : 'unresolved',
        initialValue: record?.kind === 'image' ? record.overrides.src ?? authorValueOf(node)
          : record?.overrides.text ?? authorValueOf(node) }
    }
    const container = containerOf(node)
    const binding: ComponentAuthorBinding = { kind: 'dom', path: pathFor(container), baseline: authorValueOf(node),
      ...(node.nodeType === 3 ? { textIndex: [...container.childNodes].filter(child => child.nodeType === 3).indexOf(node) } : {}) }
    const observation: DomAuthorObservation = { node, authorKey: newKey(),
      record: { kind: node.nodeType === 3 ? 'text' : 'image', binding, ...(Object.keys(scope).length ? { scope } : {}), overrides: {} },
      initialValue: authorValueOf(node), bindingStatus: 'bound' }
    if (resolve(observation.authorKey, observation.record).node !== node) observation.bindingStatus = 'unresolved'
    descriptions.set(node, { scope: scopeKey, observation })
    observedNodes.set(observation.authorKey, node)
    return observation
  }
  type Matrix = ComponentAuthorGeometryObservation['parentToInstance']
  const multiply = (a: Matrix, b: Matrix): Matrix => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]]
  const linearTransform = (target: HTMLElement): Matrix | undefined => {
    if (!win.DOMMatrix) return undefined
    let linear: Matrix = [1, 0, 0, 1, 0, 0]
    for (let current: HTMLElement | null = target; current; current = parentOf(current) as HTMLElement | null) {
      const style = win.getComputedStyle(current)
      const transform = new win.DOMMatrix(style.transform === 'none' ? undefined : style.transform)
      if (!transform.is2D) return undefined
      let rotation = 0
      if (style.rotate && style.rotate !== 'none') {
        const match = /^(?:z\s+)?(-?[\d.]+)(deg|rad|turn)$/.exec(style.rotate)
        if (!match) return undefined
        rotation = Number(match[1]) * (match[2] === 'deg' ? Math.PI / 180 : match[2] === 'turn' ? Math.PI * 2 : 1)
      }
      const scale = style.scale && style.scale !== 'none' ? style.scale.split(/\s+/).map(Number) : [1, 1]
      if (scale.some(value => !Number.isFinite(value)) || scale.length > 2) return undefined
      const zoom = parseFloat(style.zoom) || 1, x = scale[0]! * zoom, y = (scale[1] ?? scale[0])! * zoom
      const cosine = Math.cos(rotation), sine = Math.sin(rotation)
      const local = multiply([cosine * x, sine * x, -sine * y, cosine * y, 0, 0], [transform.a, transform.b, transform.c, transform.d, 0, 0])
      linear = multiply(local, linear)
    }
    return linear
  }
  const geometry = (node: Node): ComponentAuthorGeometryObservation | undefined => {
    if (!eligible(node) || !within(node) || !win.DOMMatrix) return undefined
    const element = elementOf(node)
    const parentElement = parentOf(element)
    if (!(element instanceof win.HTMLElement) || !(parentElement instanceof win.HTMLElement) || node.parentNode?.nodeType === 11) return undefined
    // A text run with siblings is part of its parent's rich content, not an
    // independently resizable element. Its content is still directly editable.
    if (node.nodeType === 3 && [...element.childNodes].filter(child => child.nodeType === 1 || child.textContent?.trim()).length !== 1) return undefined
    const invert = (m: Matrix): Matrix | undefined => {
      const determinant = m[0] * m[3] - m[1] * m[2]
      return Math.abs(determinant) < 1e-10 ? undefined : [m[3] / determinant, -m[1] / determinant, -m[2] / determinant, m[0] / determinant,
        (m[2] * m[5] - m[3] * m[4]) / determinant, (m[1] * m[4] - m[0] * m[5]) / determinant]
    }
    const number = (value: string) => Number.parseFloat(value) || 0
    const box = (target: HTMLElement) => {
      const computed = win.getComputedStyle(target), rect = target.getBoundingClientRect()
      const horizontal = number(computed.paddingLeft) + number(computed.paddingRight) + number(computed.borderLeftWidth) + number(computed.borderRightWidth)
      const vertical = number(computed.paddingTop) + number(computed.paddingBottom) + number(computed.borderTopWidth) + number(computed.borderBottomWidth)
      const width = computed.display === 'inline' || !Number.isFinite(parseFloat(computed.width)) ? target.offsetWidth
        : number(computed.width) + (computed.boxSizing === 'border-box' ? 0 : horizontal)
      const height = computed.display === 'inline' || !Number.isFinite(parseFloat(computed.height)) ? target.offsetHeight
        : number(computed.height) + (computed.boxSizing === 'border-box' ? 0 : vertical)
      if (!(width > 0 && height > 0 && rect.width > 0 && rect.height > 0)) return undefined
      const linear = linearTransform(target)
      if (!linear) return undefined
      const xs = [0, linear[0] * width, linear[2] * height, linear[0] * width + linear[2] * height]
      const ys = [0, linear[1] * width, linear[3] * height, linear[1] * width + linear[3] * height]
      const matrix: Matrix = [...linear.slice(0, 4), rect.x - Math.min(...xs), rect.y - Math.min(...ys)] as Matrix
      return { width, height, matrix, boxInsets: { width: computed.boxSizing === 'border-box' ? 0 : horizontal, height: computed.boxSizing === 'border-box' ? 0 : vertical } }
    }
    try {
      const measured = box(element), parent = box(parentElement)
      if (!measured || !parent) return undefined
      const inverseParent = invert(parent.matrix)
      const documentRoot = root === doc.body || root === doc.documentElement
      const rootBox = documentRoot ? undefined : box(root)
      const toInstance: Matrix | undefined = documentRoot ? [1, 0, 0, 1, 0, 0] : rootBox && invert(rootBox.matrix)
      if (!inverseParent || !toInstance) return undefined
      const observation = describe(node)
      // CSSOM has resolved the origin's percentages to pixels. Typed OM keeps
      // their size dependence so a text-box resize can preserve the requested
      // corner even when the source rotates about its default centre.
      const style = win.getComputedStyle(element), sourceState = observation && active.get(observation.authorKey)
      const sourceValue = (name: string) => {
        const previous = sourceState?.styles.get(name)
        return previous && element.style.getPropertyValue(name) === previous.applied
          ? previous.computed ?? previous.original ?? '' : style.getPropertyValue(name)
      }
      type Numeric = { toSum(...units: string[]): { values: Iterable<{ unit: string; value: number }> } }
      const numeric = (win as unknown as { CSSNumericValue: { parse(value: string): Numeric } }).CSSNumericValue
      const length = (value: string | Numeric) => {
        const terms = (typeof value === 'string' ? numeric.parse(value) : value).toSum('px', 'percent').values
        let offset = 0, fraction = 0
        for (const term of terms) {
          if (term.unit === 'px') offset += term.value
          else if (term.unit === 'percent') fraction += term.value / 100
          else throw new Error('Unsupported source transform length')
        }
        return { offset, fraction }
      }
      const typed = element.computedStyleMap(), originValues = String(typed.get('transform-origin')).match(/calc\([^)]*\)|\S+/g) ?? []
      const originX = length(originValues[0] ?? '50%'), originY = length(originValues[1] ?? '50%')
      const sourceTransform = new win.DOMMatrix(style.transform === 'none' ? undefined : style.transform)
      let transformWidth = { x: 0, y: 0 }, transformHeight = { x: 0, y: 0 }
      let prefix: Matrix = [1, 0, 0, 1, 0, 0]
      type TransformPart = { constructor: { name: string }; x: Numeric; y: Numeric; toMatrix(): DOMMatrix }
      if (style.transform !== 'none') for (const part of typed.get('transform') as unknown as Iterable<TransformPart>) {
        if (part.constructor.name === 'CSSTranslate') {
          const x = length(part.x), y = length(part.y)
          transformWidth.x += prefix[0] * x.fraction; transformWidth.y += prefix[1] * x.fraction
          transformHeight.x += prefix[2] * y.fraction; transformHeight.y += prefix[3] * y.fraction
          // Translation does not change the prefix linear map.
        } else {
          const matrix = part.toMatrix()
          prefix = multiply(prefix, [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f])
        }
      }
      const sourceScale = sourceValue('scale'), scale = sourceScale && sourceScale !== 'none' ? sourceScale.split(/\s+/).map(Number) : [1, 1]
      const sourceRotate = sourceValue('rotate'), rotation = sourceRotate && sourceRotate !== 'none'
        ? /^(?:z\s+)?(-?[\d.]+)(deg|rad|turn)$/.exec(sourceRotate) : undefined
      if (sourceRotate && sourceRotate !== 'none' && !rotation || scale.some(value => !Number.isFinite(value)) || scale.length > 2) return undefined
      const radians = rotation ? Number(rotation[1]) * (rotation[2] === 'deg' ? Math.PI / 180 : rotation[2] === 'turn' ? Math.PI * 2 : 1) : 0
      const cosine = Math.cos(radians), sine = Math.sin(radians), sx = scale[0]!, sy = scale[1] ?? sx
      const individual: Matrix = [cosine * sx, sine * sx, -sine * sy, cosine * sy, 0, 0]
      const translate = cssAxes(sourceValue('translate') || 'none')
      const tx = length(translate[0] === 'none' ? '0px' : translate[0] ?? '0px'), ty = length(translate[1] ?? '0px')
      const source = multiply(individual, [sourceTransform.a, sourceTransform.b, sourceTransform.c, sourceTransform.d, sourceTransform.e, sourceTransform.f])
      const ox = originX.offset + originX.fraction * measured.width, oy = originY.offset + originY.fraction * measured.height
      const sourceOffset = {
        current: { x: tx.offset + tx.fraction * measured.width + source[4] + (1 - source[0]) * ox - source[2] * oy,
          y: ty.offset + ty.fraction * measured.height + source[5] - source[1] * ox + (1 - source[3]) * oy },
        widthDelta: { x: tx.fraction + individual[0] * transformWidth.x + individual[2] * transformWidth.y + (1 - source[0]) * originX.fraction,
          y: individual[1] * transformWidth.x + individual[3] * transformWidth.y - source[1] * originX.fraction },
        heightDelta: { x: individual[0] * transformHeight.x + individual[2] * transformHeight.y - source[2] * originY.fraction,
          y: ty.fraction + individual[1] * transformHeight.x + individual[3] * transformHeight.y + (1 - source[3]) * originY.fraction },
      }
      const zoom = parseFloat(style.zoom) || 1
      // CSS translations live before the element's own zoom. Factor that unit map
      // into the observation's parent coordinate map so gesture deltas stay CSS px.
      return { frame: { width: measured.width, height: measured.height, transform: multiply([1 / zoom, 0, 0, 1 / zoom, 0, 0], multiply(inverseParent, measured.matrix)) },
        parentToInstance: multiply(multiply(toInstance, parent.matrix), [zoom, 0, 0, zoom, 0, 0]), author: observation?.record.overrides.geometry ?? {}, boxInsets: measured.boxInsets, sourceOffset }
    } catch { return undefined }
  }
  const enqueue = () => {
    dirty = true
    if (queued || disposed || !observationActive) return
    queued = true
    queueMicrotask(() => {
      queued = false
      if (!disposed && observationActive && dirty) { dirty = false; refresh(); options.onChange?.() }
    })
  }
  const updateActive = () => {
    const value = explicitActive && runtimeActive
    if (observationActive === value || disposed) return
    observationActive = value
    if (value && dirty) enqueue()
  }
  const setActive = (value: boolean) => { explicitActive = value; updateActive() }
  const activity = (event: Event) => {
    const value = (event as CustomEvent<{ active: boolean; visible: boolean }>).detail
    if (value && typeof value.active === 'boolean' && typeof value.visible === 'boolean') { runtimeActive = value.active && value.visible; updateActive() }
  }
  win.addEventListener('__runtime.activity', activity)
  const initialActivity = (win as Window & { __guolingRuntimeActivity?: { active: boolean; visible: boolean } }).__guolingRuntimeActivity
  if (initialActivity) { runtimeActive = initialActivity.active && initialActivity.visible; updateActive() }
  const observer = new win.MutationObserver(changes => {
    // Opaque-frame hints are regular DOM children. Their redraw is software
    // chrome, not an authored change that should trigger scan -> redraw again.
    if (mutationRoots(changes).length) enqueue()
  })
  const observedRoots = new Set<HTMLElement | ShadowRoot>()
  function syncObservedRoots(): void {
    const current = new Set(contentRoots())
    if ([...observedRoots].some(value => !current.has(value))) { observer.disconnect(); observedRoots.clear() }
    for (const value of current) if (!observedRoots.has(value)) {
      observer.observe(value, { subtree: true, childList: true, characterData: true, attributes: true, attributeOldValue: true }); observedRoots.add(value)
    }
  }
  const inputPaintName = `cw-author-input-${Math.random().toString(36).slice(2)}`
  let inputPaintStyle: CSSStyleSheet | undefined, inputPaintRoot: Document | ShadowRoot | undefined
  let inputPaintTarget: string | Node | undefined
  const highlightRegistry = (win as unknown as { CSS?: { highlights?: { set(name: string, value: unknown): void; delete(name: string): void } } }).CSS?.highlights
  const HighlightType = Reflect.get(win, 'Highlight') as (new (...ranges: Range[]) => unknown) | undefined
  const refreshInputPaint = () => {
    highlightRegistry?.delete(inputPaintName)
    const node = typeof inputPaintTarget === 'string' ? observedNodes.get(inputPaintTarget) : inputPaintTarget
    if (!node || node.nodeType !== 3 || !within(node) || !HighlightType || !highlightRegistry) return
    const paintRoot = node.getRootNode() as Document | ShadowRoot
    if (!('adoptedStyleSheets' in paintRoot)) return
    if (!inputPaintStyle) { inputPaintStyle = new win.CSSStyleSheet(); inputPaintStyle.replaceSync(`::highlight(${inputPaintName}){color:transparent!important;text-shadow:none!important}`) }
    if (inputPaintRoot !== paintRoot) { if (inputPaintRoot) inputPaintRoot.adoptedStyleSheets = inputPaintRoot.adoptedStyleSheets.filter(sheet => sheet !== inputPaintStyle); paintRoot.adoptedStyleSheets = [...paintRoot.adoptedStyleSheets, inputPaintStyle]; inputPaintRoot = paintRoot }
    const range = doc.createRange(); range.selectNodeContents(node)
    highlightRegistry.set(inputPaintName, new HighlightType(range))
  }
  const suppressText = (target?: string | Node) => { inputPaintTarget = target; refreshInputPaint() }
  const textStyle = (node: Node) => {
    if (node.nodeType !== 3) return undefined
    const element = elementOf(node as Text), style = win.getComputedStyle(element)
    const result = Object.fromEntries(['font-family', 'font-size', 'color', 'font-weight', 'font-style', 'text-decoration-line',
      'background-color', 'text-align', 'line-height', 'letter-spacing', 'word-spacing', 'text-transform', 'white-space', 'fill'].map(name => [name, style.getPropertyValue(name)]))
    const linear = element instanceof win.HTMLElement ? linearTransform(element) : undefined
    if (linear) { result.transform = `matrix(${linear.join(',')})`; result['transform-origin'] = '0 0' }
    const siblings = [...element.childNodes].filter(child => child.nodeType === 1 || child.textContent?.trim())
    if (element instanceof win.HTMLElement && siblings.length === 1 && style.display !== 'inline' && style.display !== 'contents') {
      const width = element.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0)
      if (width > 0) result.width = `${width}px`
    } else {
      const range = doc.createRange(); range.selectNodeContents(node)
      if (range.getClientRects?.().length === 1) result.width = 'max-content'
    }
    return result
  }
  refresh()
  return {
    refresh,
    /** Pause observation only. Explicit reads/record application retain their existing semantics. */
    setActive,
    roots: contentRoots,
    /** Paint visibility only; hidden source content and its author records remain intact. */
    visible,
    withReadScope,
    painted(node: Node, region?: PaintRect) { return withReadScope(() => painted(node, region)) },
    /** Discovery enumerates content only; callers request binding and geometry for consumed targets. */
    targets(scope: Node = root): Array<Text | HTMLImageElement> {
      if (scope === doc) scope = root
      if (!within(scope)) return []
      return (scope === root ? nodesWithin(root) : [scope, ...nodesWithin(scope)]).filter(eligible)
    },
    describe,
    geometry,
    suppressText,
    previewGeometry(authorKey: string, value: ComponentAuthorGeometry | null) {
      if (disposed) return
      if (value === null) previews.delete(authorKey)
      else {
        const node = observedNodes.get(authorKey), observation = node && describe(node)
        if (!node || !observation) return
        previews.set(authorKey, { node, record: observation.record, geometry: value })
      }
      refresh()
    },
    textStyle,
    scan(): DomAuthorObservation[] { refresh(); return withLookup(() => targets().filter(visible).flatMap(node => {
      const value = describe(node)
      if (!value) return []
      const style = textStyle(node)
      return [{ ...value, geometry: geometry(node), ...(style ? { textStyle: style } : {}) }]
    })) },
    hit(x: number, y: number): DomAuthorObservation | undefined {
      return withReadScope(() => {
      const element = paintStack(root, x, y, paintIgnore, shadowOf, paintScope)[0]
      // A transparent paragraph body has no paint at the caret's empty area,
      // so paintStack may return only its background ancestor. Preserve that
      // native caret hit, but reject any independent foreground paint first.
      const position = doc.caretPositionFromPoint?.(x, y)
      const caret = (doc as Document & { caretRangeFromPoint?(x: number, y: number): Range | null }).caretRangeFromPoint?.(x, y)
      const text = position?.offsetNode ?? caret?.startContainer
      if (text?.nodeType === 3 && eligible(text) && within(text) && visible(text)) {
        const parent = elementOf(text), native = doc.elementFromPoint?.(x, y)
        if ((!element || element === parent || element.contains(parent)) && native?.contains(text)) {
          const observation = describe(text); if (observation) return observation
        }
      }
      if (!element || !within(element)) return undefined
      // The paint owner is already known. Its own image or direct text children
      // are the only nodes whose elementOf(node) can equal that owner.
      const shadow = shadowOf(element)
      const local = [element, ...(shadow ? shadow.childNodes : []), ...element.childNodes].filter(eligible)
      for (const node of local) {
        if (elementOf(node) !== element || !visible(node)) continue
        const rect = node.nodeType === 3 ? (() => { const range = doc.createRange(); range.selectNodeContents(node); return range.getBoundingClientRect() })() : element.getBoundingClientRect()
        if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
          if (node.nodeType !== 3) continue
          // Preserve paragraph-body/caret hits beyond the glyphs, after the
          // common paint reader has ruled out a covering decoration or modal.
          const position = doc.caretPositionFromPoint?.(x, y)
          const caret = (doc as Document & { caretRangeFromPoint?(x: number, y: number): Range | null }).caretRangeFromPoint?.(x, y)
          if (position?.offsetNode !== node && caret?.startContainer !== node) continue
        }
        const observation = describe(node); if (observation) return observation
      }
      return undefined
      })
    },
    paintedElementAt(x: number, y: number): Element | undefined { return withReadScope(() => paintStack(root, x, y, paintIgnore, shadowOf, paintScope)[0]) },
    dispose() { if (disposed) return; disposed = true; highlightRegistry?.delete(inputPaintName); if (inputPaintRoot) inputPaintRoot.adoptedStyleSheets = inputPaintRoot.adoptedStyleSheets.filter(sheet => sheet !== inputPaintStyle); observer.disconnect(); win.removeEventListener('__runtime.activity', activity); for (const state of active.values()) restore(state); active.clear(); previews.clear(); observedNodes.clear() },
  }
}

/** Keep the embedded and in-process consumers on the same paint reader. */
export function domAuthoringFactorySource(): string {
  return `((root,options)=>(${createDomAuthoring.toString()})(root,options,(${componentPaintStack.toString()}),(${authoringMutationRoots.toString()})))`
}
