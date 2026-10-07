import type { ComponentAuthorBinding, ComponentAuthorRecord, ComponentAuthorScope } from '../../shared/contracts/component-platform/runtime'

export interface DomAuthorObservation {
  node: Text | HTMLImageElement
  authorKey: string
  record: ComponentAuthorRecord
  initialValue: string
}

/**
 * The same finite DOM content adapter runs in the component realm and in saved
 * HTML. Keep runtime dependencies inside this function: HTML embeds its source.
 * It never submits edits and never recreates author nodes or executes programs.
 */
export function createDomAuthoring(root: HTMLElement, options: {
  records(): Record<string, ComponentAuthorRecord>
  resolveResource?(reference: string): string | undefined
  onChange?(): void
  report?(authorKey: string, status: 'bound' | 'unmounted' | 'unresolved'): void
}) {
  type Target = Text | HTMLImageElement
  type Path = ComponentAuthorBinding['path']
  type Property = { original: string | null; applied: string | null; priority?: string }
  type Applied = { node: Target; content?: Property; attributes: Map<Element, Map<string, Property>>; styles: Map<string, Property> }
  const doc = root.ownerDocument, win = doc.defaultView!
  const descriptions = new WeakMap<Node, { scope: string; observation: DomAuthorObservation }>()
  const active = new Map<string, Applied>(), statuses = new Map<string, string>()
  let disposed = false, queued = false, refreshing = false
  let reactScopes = new WeakMap<Element, ComponentAuthorScope>()
  const elementOf = (node: Target) => node.nodeType === 3 ? node.parentElement! : node as HTMLImageElement
  const valueOf = (node: Target) => node.nodeType === 3 ? node.nodeValue ?? '' : (node as HTMLImageElement).getAttribute('src') ?? ''
  const eligible = (node: Node): node is Target => node.nodeType === 1 && (node as Element).localName === 'img'
    || node.nodeType === 3 && Boolean(node.nodeValue?.trim()) && Boolean(node.parentElement)
      && !node.parentElement!.closest('script,style,noscript,template,textarea,title,option,[contenteditable],[data-html-preview-edit-markers]')
  const targets = () => {
    const nodes: Target[] = [], walker = doc.createTreeWalker(root, 1 | 4)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) if (eligible(node)) nodes.push(node)
    return nodes
  }
  const ordered = (scope: ComponentAuthorScope) => JSON.stringify(Object.entries(scope).sort(([a], [b]) => a.localeCompare(b)))

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
      if (value !== record.binding.baseline && value !== resolvedOverride
        && !(previous?.node === node && value === previous.content?.applied)) return []
      if (record.binding.context?.some(context => {
        const anchors = elementsAt(context.path)
        return anchors.length !== 1 || anchors[0]!.textContent !== context.value
      })) return []
      return [node]
    })
    if (nodes.length === 1) return { node: nodes[0], status: 'bound' }
    // During this mount an exact selected node is known, even before its first
    // record is saved. Ambiguous replacement nodes cannot inherit that fact.
    const mounted = nodes.filter(node => descriptions.get(node)?.observation.authorKey === key)
    return mounted.length === 1 ? { node: mounted[0], status: 'bound' } : { status: 'unresolved' }
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
      return previous && current === previous.applied ? previous.original ?? '' : current
    }
    if (geometry) {
      if (geometry.translateX !== undefined || geometry.translateY !== undefined) {
        const base = (baseStyle('translate') || '0px 0px').split(/\s+/)
        styles.translate = `calc(${base[0] === 'none' ? '0px' : base[0]} + ${geometry.translateX ?? 0}px) calc(${base[1] ?? '0px'} + ${geometry.translateY ?? 0}px)`
      }
      if (geometry.scaleX !== undefined || geometry.scaleY !== undefined) {
        const base = (baseStyle('scale') || '1 1').split(/\s+/)
        styles.scale = `calc(${base[0] === 'none' ? '1' : base[0]} * ${geometry.scaleX ?? 1}) calc(${base[1] ?? base[0]} * ${geometry.scaleY ?? geometry.scaleX ?? 1})`
      }
      if (geometry.rotation !== undefined) styles.rotate = `calc(${baseStyle('rotate') || '0deg'} + ${geometry.rotation}deg)`
      if (geometry.scaleX !== undefined || geometry.scaleY !== undefined || geometry.rotation !== undefined) styles['transform-origin'] = '0 0'
      if (geometry.width !== undefined) styles.width = `${geometry.width}px`
      if (geometry.height !== undefined) styles.height = `${geometry.height}px`
      if (record.kind === 'text' && (geometry.width !== undefined || geometry.height !== undefined)
        && win.getComputedStyle(element).display === 'inline') styles.display = 'inline-block'
    }
    for (const [name, property] of state.styles) if (!(name in styles)) {
      if (element.style.getPropertyValue(name) === property.applied) {
        if (property.original) element.style.setProperty(name, property.original, property.priority)
        else element.style.removeProperty(name)
      }
      state.styles.delete(name)
    }
    for (const [name, value] of Object.entries(styles)) {
      const current = element.style.getPropertyValue(name), previous = state.styles.get(name)
      const original = previous && current === previous.applied ? previous.original : current
      const priority = previous && current === previous.applied ? previous.priority : element.style.getPropertyPriority(name)
      const declaration = doc.createElement('span').style
      declaration.setProperty(name, value)
      if (current !== declaration.getPropertyValue(name)) element.style.setProperty(name, value)
      state.styles.set(name, { original, priority, applied: element.style.getPropertyValue(name) })
    }
  }
  const refresh = () => {
    if (disposed || refreshing) return
    refreshing = true
    try {
      readReactScopes()
      const records = options.records()
      for (const [key, state] of active) if (!records[key]) { restore(state); active.delete(key); statuses.delete(key) }
      for (const [key, record] of Object.entries(records)) {
        const previous = active.get(key), result = resolve(key, record, previous)
        if (previous && result.node !== previous.node) { restore(previous); active.delete(key) }
        if (result.node) {
          const state = active.get(key) ?? { node: result.node, attributes: new Map(), styles: new Map() }
          active.set(key, state); apply(record, state)
          descriptions.set(result.node, { scope: ordered(record.scope ?? {}), observation: {
            node: result.node, authorKey: key, record, initialValue: valueOf(result.node),
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
      if (record || previous.observation.record.binding.baseline === valueOf(node)) return { ...previous.observation, ...(record ? { record } : {}), initialValue: valueOf(node) }
    }
    const binding: ComponentAuthorBinding = { kind: 'dom', path: pathFor(element), baseline: valueOf(node),
      ...(node.nodeType === 3 ? { textIndex: [...element.childNodes].filter(child => child.nodeType === 3).indexOf(node) } : {}) }
    const observation: DomAuthorObservation = { node, authorKey: `dom-${win.crypto.randomUUID()}`,
      record: { kind: node.nodeType === 3 ? 'text' : 'image', binding, ...(Object.keys(scope).length ? { scope } : {}), overrides: {} },
      initialValue: valueOf(node) }
    descriptions.set(node, { scope: scopeKey, observation })
    return observation
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
    scan(): DomAuthorObservation[] { refresh(); return targets().flatMap(node => { const value = describe(node); return value ? [value] : [] }) },
    dispose() { if (disposed) return; disposed = true; observer.disconnect(); for (const state of active.values()) restore(state); active.clear() },
  }
}
