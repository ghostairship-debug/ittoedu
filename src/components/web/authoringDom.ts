import type { ComponentAuthorBinding, ComponentAuthorRecord, ComponentAuthorScope, ComponentAuthorGeometryObservation, ComponentAuthorGeometry } from '../../shared/contracts/component-platform/runtime'

export interface DomAuthorObservation {
  node: Text | HTMLImageElement
  authorKey: string
  record: ComponentAuthorRecord
  initialValue: string
  bindingStatus: 'bound' | 'unresolved'
  geometry?: ComponentAuthorGeometryObservation
}

/**
 * The same finite DOM content adapter runs in the component realm and in saved
 * HTML. Keep runtime dependencies inside this function: HTML embeds its source.
 * It never submits edits and never recreates author nodes or executes programs.
 */
export function createDomAuthoring(root: HTMLElement, options: {
  records(): Record<string, ComponentAuthorRecord>
  resolveResource?(reference: string): string | undefined
  resourceReference?(url: string): string | undefined
  onChange?(): void
  report?(authorKey: string, status: 'bound' | 'unmounted' | 'unresolved'): void
}) {
  type Target = Text | HTMLImageElement
  type Path = ComponentAuthorBinding['path']
  type Property = { original: string | null; applied: string | null; priority?: string; computed?: string }
  type Applied = { node: Target; content?: Property; attributes: Map<Element, Map<string, Property>>; styles: Map<string, Property> }
  const doc = root.ownerDocument, win = doc.defaultView!
  const descriptions = new WeakMap<Node, { scope: string; observation: DomAuthorObservation }>()
  const observedNodes = new Map<string, Target>()
  const previews = new Map<string, { node: Target; record: ComponentAuthorRecord; geometry: ComponentAuthorGeometry }>()
  const active = new Map<string, Applied>(), statuses = new Map<string, string>()
  let disposed = false, queued = false, refreshing = false
  let reactScopes = new WeakMap<Element, ComponentAuthorScope>()
  const elementOf = (node: Target) => node.nodeType === 3 ? node.parentElement! : node as HTMLImageElement
  const valueOf = (node: Target) => node.nodeType === 3 ? node.nodeValue ?? '' : (node as HTMLImageElement).getAttribute('src') ?? ''
  const authorValueOf = (node: Target) => node.nodeType === 3 ? valueOf(node) : options.resourceReference?.(valueOf(node)) ?? valueOf(node)
  const eligible = (node: Node): node is Target => node.nodeType === 1 && (node as Element).localName === 'img'
    || node.nodeType === 3 && Boolean(node.nodeValue?.trim()) && Boolean(node.parentElement)
      && !node.parentElement!.closest('script,style,noscript,template,textarea,title,option,[contenteditable],[data-html-preview-edit-markers]')
  const targets = () => {
    const nodes: Target[] = [], walker = doc.createTreeWalker(root, 1 | 4)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) if (eligible(node)) nodes.push(node)
    return nodes
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
    for (const element of [root, ...root.querySelectorAll('*')]) {
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
    const scope = { ...reactScopes.get(element) }
    let depth = 0
    for (let current: Element | null = element; current && root.contains(current); current = current.parentElement) {
      for (const attribute of [...current.attributes]) {
        if (/^data-(?:(?:item|record|entity|author|state|scene|view)-)?(?:id|key|state)$/.test(attribute.name))
          scope[`dom:${depth}:${attribute.name}`] = attribute.value
      }
      depth++
      if (current === root) break
    }
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
  const pathFor = (element: Element): Path => {
    const path: Path = []
    for (let current: Element | null = element; current && current !== root; current = current.parentElement) {
      const attributes = attributesOf(current)
      path.unshift({ tag: current.localName, index: current.parentElement ? [...current.parentElement.children].indexOf(current) : 0,
        ...(Object.keys(attributes).length ? { attributes } : {}) })
    }
    return path
  }
  const matches = (element: Element, step: Path[number]) => element.localName === step.tag
    && Object.entries(step.attributes ?? {}).every(([name, value]) => name === 'class'
      ? value.split(/\s+/).every(token => element.classList.contains(token)) : element.getAttribute(name) === value)
  const elementsAt = (path: Path): Element[] => {
    let candidates: Element[] = [root]
    for (const step of path) candidates = candidates.flatMap(parent => [...parent.children].filter(child => matches(child, step)))
    return candidates
  }
  const sameScope = (element: Element, scope?: ComponentAuthorScope) => ordered(scopeOf(element)) === ordered(scope ?? {})
  const resolve = (key: string, record: ComponentAuthorRecord, previous?: Applied): { node?: Target; status: 'bound' | 'unmounted' | 'unresolved' } => {
    const candidates = elementsAt(record.binding.path).filter(element => sameScope(element, record.scope))
    if (!candidates.length) return { status: 'unmounted' }
    const nodes = candidates.flatMap(element => {
      const node = record.kind === 'image' ? element.localName === 'img' ? element as HTMLImageElement : undefined
        : [...element.childNodes].filter(node => node.nodeType === 3)[record.binding.textIndex ?? 0] as Text | undefined
      if (!node) return []
      const value = valueOf(node), override = record.kind === 'text' ? record.overrides.text : record.overrides.src
      const resolvedOverride = record.kind === 'image' && override ? options.resolveResource?.(override) ?? override : override
      const baseline = record.kind === 'image' ? options.resolveResource?.(record.binding.baseline) ?? record.binding.baseline : record.binding.baseline
      if (value !== baseline && value !== resolvedOverride
        && !(previous?.node === node && value === previous.content?.applied)) return []
      if (record.binding.context?.some(context => {
        const anchors = elementsAt(context.path)
        return anchors.length !== 1 || anchors[0]!.textContent !== context.value
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
        const base = (baseStyle('translate') || '0px 0px').split(/\s+/)
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
  const refresh = () => {
    if (disposed || refreshing) return
    refreshing = true
    try {
      readReactScopes()
      const records = { ...options.records() }
      for (const [key, preview] of previews) {
        const formal = records[key] ?? preview.record
        records[key] = { ...formal, overrides: { ...formal.overrides, geometry: preview.geometry } }
      }
      for (const [key, node] of observedNodes) if (!root.contains(node)) observedNodes.delete(key)
      for (const [key, state] of active) if (!records[key]) { restore(state); active.delete(key); statuses.delete(key) }
      for (const [key, record] of Object.entries(records)) {
        const previous = active.get(key), preview = previews.get(key)
        const result = preview && root.contains(preview.node) && sameScope(elementOf(preview.node), preview.record.scope)
          ? { node: preview.node, status: 'bound' as const } : resolve(key, record, previous)
        if (previous && result.node !== previous.node) { restore(previous); active.delete(key) }
        if (result.node) {
          const state = active.get(key) ?? { node: result.node, attributes: new Map(), styles: new Map() }
          active.set(key, state); apply(record, state)
          observedNodes.set(key, result.node)
          descriptions.set(result.node, { scope: ordered(record.scope ?? {}), observation: {
            node: result.node, authorKey: key, record, initialValue: record.kind === 'image' ? record.overrides.src ?? authorValueOf(result.node) : valueOf(result.node),
            bindingStatus: 'bound',
          } })
        }
        status(key, result.status)
      }
    } finally { refreshing = false }
  }
  const describe = (node: Node): DomAuthorObservation | null => {
    if (!eligible(node) || !root.contains(node)) return null
    const element = elementOf(node), scope = scopeOf(element), scopeKey = ordered(scope)
    const previous = descriptions.get(node)
    if (previous?.scope === scopeKey) {
      const record = options.records()[previous.observation.authorKey]
      if (record || previous.observation.record.binding.baseline === authorValueOf(node)) return { ...previous.observation,
        record: record ?? { ...previous.observation.record, overrides: {} },
        bindingStatus: resolve(previous.observation.authorKey, record ?? previous.observation.record, active.get(previous.observation.authorKey)).node === node ? 'bound' : 'unresolved',
        initialValue: record?.kind === 'image' ? record.overrides.src ?? authorValueOf(node) : authorValueOf(node) }
    }
    const binding: ComponentAuthorBinding = { kind: 'dom', path: pathFor(element), baseline: authorValueOf(node),
      ...(node.nodeType === 3 ? { textIndex: [...element.childNodes].filter(child => child.nodeType === 3).indexOf(node) } : {}) }
    const observation: DomAuthorObservation = { node, authorKey: newKey(),
      record: { kind: node.nodeType === 3 ? 'text' : 'image', binding, ...(Object.keys(scope).length ? { scope } : {}), overrides: {} },
      initialValue: authorValueOf(node), bindingStatus: 'bound' }
    if (resolve(observation.authorKey, observation.record).node !== node) observation.bindingStatus = 'unresolved'
    descriptions.set(node, { scope: scopeKey, observation })
    observedNodes.set(observation.authorKey, node)
    return observation
  }
  const geometry = (node: Node): ComponentAuthorGeometryObservation | undefined => {
    if (!eligible(node) || !root.contains(node) || !win.DOMMatrix) return undefined
    const element = elementOf(node)
    if (!(element instanceof win.HTMLElement) || !element.parentElement) return undefined
    // A text run with siblings is part of its parent's rich content, not an
    // independently resizable element. Its content is still directly editable.
    if (node.nodeType === 3 && [...element.childNodes].filter(child => child.nodeType === 1 || child.textContent?.trim()).length !== 1) return undefined
    type Matrix = ComponentAuthorGeometryObservation['parentToInstance']
    const multiply = (a: Matrix, b: Matrix): Matrix => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
      a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]]
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
      let linear: Matrix = [1, 0, 0, 1, 0, 0]
      for (let current: HTMLElement | null = target; current; current = current.parentElement) {
        const style = win.getComputedStyle(current)
        if (style.perspective && style.perspective !== 'none') return undefined
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
      const xs = [0, linear[0] * width, linear[2] * height, linear[0] * width + linear[2] * height]
      const ys = [0, linear[1] * width, linear[3] * height, linear[1] * width + linear[3] * height]
      const matrix: Matrix = [...linear.slice(0, 4), rect.x - Math.min(...xs), rect.y - Math.min(...ys)] as Matrix
      return { width, height, matrix, boxInsets: { width: computed.boxSizing === 'border-box' ? 0 : horizontal, height: computed.boxSizing === 'border-box' ? 0 : vertical } }
    }
    try {
      const measured = box(element), parent = box(element.parentElement)
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
      const source = multiply(individual, [sourceTransform.a, sourceTransform.b, sourceTransform.c, sourceTransform.d, sourceTransform.e, sourceTransform.f])
      const ox = originX.offset + originX.fraction * measured.width, oy = originY.offset + originY.fraction * measured.height
      const sourceOffset = {
        current: { x: source[4] + (1 - source[0]) * ox - source[2] * oy, y: source[5] - source[1] * ox + (1 - source[3]) * oy },
        widthDelta: { x: individual[0] * transformWidth.x + individual[2] * transformWidth.y + (1 - source[0]) * originX.fraction,
          y: individual[1] * transformWidth.x + individual[3] * transformWidth.y - source[1] * originX.fraction },
        heightDelta: { x: individual[0] * transformHeight.x + individual[2] * transformHeight.y - source[2] * originY.fraction,
          y: individual[1] * transformHeight.x + individual[3] * transformHeight.y + (1 - source[3]) * originY.fraction },
      }
      return { frame: { width: measured.width, height: measured.height, transform: multiply(inverseParent, measured.matrix) },
        parentToInstance: multiply(toInstance, parent.matrix), author: observation?.record.overrides.geometry ?? {}, boxInsets: measured.boxInsets, sourceOffset }
    } catch { return undefined }
  }
  const enqueue = () => {
    if (queued || disposed) return
    queued = true
    queueMicrotask(() => { queued = false; if (!disposed) { refresh(); options.onChange?.() } })
  }
  const observer = new win.MutationObserver(enqueue)
  observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true })
  refresh()
  return {
    refresh,
    describe,
    geometry,
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
    scan(): DomAuthorObservation[] { refresh(); return targets().flatMap(node => { const value = describe(node); return value ? [{ ...value, geometry: geometry(node) }] : [] }) },
    dispose() { if (disposed) return; disposed = true; observer.disconnect(); for (const state of active.values()) restore(state); active.clear(); previews.clear(); observedNodes.clear() },
  }
}
