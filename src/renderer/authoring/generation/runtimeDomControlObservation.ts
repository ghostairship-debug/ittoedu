const MOUNT_SELECTOR = '[data-runtime-instance-id], [data-component-instance-id]'
const CONTROL_SELECTOR = 'button, [role="button"]'
const MAX_INSTANCES = 32
const MAX_CONTROLS = 32

export interface RuntimeDomObservationTarget { instanceId: string; carrier: 'runtime' | 'component' }

function text(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().slice(0, 240)
}

function parentElement(element: Element): Element | null {
  if (element.parentElement) return element.parentElement
  const root = element.getRootNode()
  return 'host' in root ? (root as ShadowRoot).host : null
}

function closest(element: Element, selector: string): HTMLElement | null {
  for (let current: Element | null = element; current; current = parentElement(current)) {
    if (current.matches(selector)) return current as HTMLElement
  }
  return null
}

function instanceId(element: Element): string | null {
  const mount = closest(element, MOUNT_SELECTOR)
  return mount?.dataset.runtimeInstanceId ?? mount?.dataset.componentInstanceId ?? null
}

function domControls(mount: HTMLElement): HTMLElement[] {
  const roots: Array<HTMLElement | ShadowRoot> = [mount], controls: HTMLElement[] = []
  for (let index = 0; index < roots.length; index++) {
    const root = roots[index]!
    controls.push(...root.querySelectorAll<HTMLElement>(CONTROL_SELECTOR))
    if (root instanceof HTMLElement && root.shadowRoot) roots.push(root.shadowRoot)
    for (const element of root.querySelectorAll('*')) if (element.shadowRoot) roots.push(element.shadowRoot)
  }
  return controls
}

function centerHit(dom: Document, x: number, y: number): Element | null {
  let hit = dom.elementFromPoint(x, y)
  // Chromium retargets document hit tests to a shadow host. Follow the actual
  // open root hit test; do not mistake that host for an intercepting element.
  for (let depth = 0; depth < 16 && hit?.shadowRoot; depth++) {
    if (typeof hit.shadowRoot.elementFromPoint !== 'function') break
    const inner = hit.shadowRoot.elementFromPoint(x, y)
    if (!inner || inner === hit) break
    hit = inner
  }
  return hit
}

function visibleBounds(element: HTMLElement, root: HTMLElement) {
  const view = root.ownerDocument.defaultView
  if (!view || !element.isConnected) return null
  const bounds = element.getBoundingClientRect()
  if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0) return null
  let left = Math.max(0, bounds.left), top = Math.max(0, bounds.top)
  let right = Math.min(view.innerWidth, bounds.right), bottom = Math.min(view.innerHeight, bounds.bottom)
  for (let current: Element | null = element; current; current = parentElement(current)) {
    const style = view.getComputedStyle(current)
    if (current.hasAttribute('hidden') || style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || Number(style.opacity || 1) === 0) return null
    if (current !== element) {
      const rect = current.getBoundingClientRect()
      if (/(hidden|clip|auto|scroll)/.test(style.overflowX)) { left = Math.max(left, rect.left); right = Math.min(right, rect.right) }
      if (/(hidden|clip|auto|scroll)/.test(style.overflowY)) { top = Math.max(top, rect.top); bottom = Math.min(bottom, rect.bottom) }
    }
  }
  if (right <= left || bottom <= top) return null
  return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
}

function describeHit(element: Element, view: Window) {
  return {
    tag: element.tagName.toLowerCase(), role: element.getAttribute('role'),
    label: text(element.getAttribute('aria-label')), text: text(element.textContent),
    instanceId: instanceId(element), pointerEvents: view.getComputedStyle(element).pointerEvents,
    runtimeLayer: closest(element, '[data-canvas-runtime-phaser]') ? 'phaser'
      : closest(element, '[data-canvas-runtime-dom-overlay]') ? 'dom-overlay'
        : closest(element, '[data-canvas-runtime-dom-underlay]') ? 'dom-underlay' : null,
  }
}

function readVisibleInstanceText(mounts: HTMLElement[], targetId: string, view: Window) {
  const styles = new Map<Element, CSSStyleDeclaration>(), visited = new Set<Node>()
  const styleOf = (element: Element) => {
    let style = styles.get(element)
    if (!style) { style = view.getComputedStyle(element); styles.set(element, style) }
    return style
  }
  const hidden = (element: Element) => {
    const style = styleOf(element)
    return element.hasAttribute('hidden') || style.display === 'none' || Number(style.opacity || 1) === 0
      || style.contentVisibility === 'hidden'
  }
  const composedParent = (element: Element): Element | null => element.assignedSlot ?? parentElement(element)
  const stack: Array<{ node: Node; visible: boolean } | null> = []
  for (const mount of [...mounts].reverse()) {
    let blocked = false
    for (let ancestor = composedParent(mount); ancestor; ancestor = composedParent(ancestor)) {
      if (hidden(ancestor)) { blocked = true; break }
    }
    if (!blocked) stack.push({ node: mount, visible: true })
  }
  let content = ''
  const lineBreak = () => { if (content && !content.endsWith('\n')) content += '\n' }
  while (stack.length && visited.size < 10_000 && content.length <= 8000) {
    const entry = stack.pop()!
    if (!entry) { lineBreak(); continue }
    const { node } = entry
    if (visited.has(node)) continue
    visited.add(node)
    if (node.nodeType === Node.TEXT_NODE) {
      if (entry.visible) content += (node.nodeValue ?? '').replace(/\s+/g, ' ')
      continue
    }
    let visible = entry.visible
    let children: Node[] = [...node.childNodes]
    if (node instanceof Element) {
      if (!node.isConnected || instanceId(node) !== targetId || hidden(node)
        || node.matches('style, script, template, noscript, head, meta, link, canvas, iframe, object, embed')) continue
      const style = styleOf(node)
      // Visibility may be restored by a descendant; only display/opacity prune
      // the subtree. Read text nodes once instead of aggregating innerText.
      visible = !['hidden', 'collapse'].includes(style.visibility)
      if (node.matches('br, button, [role="button"]') || /^(block|flex|grid|table|list-item)/.test(style.display)) {
        lineBreak(); stack.push(null)
      }
      if (node.shadowRoot) children = [node.shadowRoot]
      else if (node.localName === 'details' && !node.hasAttribute('open')) {
        const summary = [...node.children].find(child => child.localName === 'summary')
        children = summary ? [summary] : []
      } else if (node.localName === 'slot') {
        const assigned = (node as HTMLSlotElement).assignedNodes({ flatten: true })
        if (assigned.length) children = assigned
      }
    }
    for (const child of children.reverse()) stack.push({ node: child, visible })
  }
  content = content.replace(/[^\S\n]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n+/g, '\n').trim()
  return { text: content.slice(0, 8000), truncated: content.length > 8000 || stack.length > 0 }
}

/** Admission-only lookup. The caller supplies a frozen instance and an exact
 * accessible label; no CSS selector or script can be supplied by a candidate. */
export function resolveRuntimeDomButton(root: HTMLElement, targetId: string, label: string) {
  const view = root.ownerDocument.defaultView
  if (!view) throw new Error('按钮检查没有实际窗口')
  const mounts = [...root.querySelectorAll<HTMLElement>(MOUNT_SELECTOR)]
    .filter(mount => (mount.dataset.runtimeInstanceId ?? mount.dataset.componentInstanceId) === targetId)
  const normalized = (value: string) => value.replace(/\s+/g, ' ').trim()
  const matching = [...new Set(mounts.flatMap(domControls))].filter(control => instanceId(control) === targetId
    && normalized(control.getAttribute('aria-label') || control.innerText || control.textContent || '') === normalized(label)
    && visibleBounds(control, root))
  if (matching.length !== 1) throw new Error(`按钮检查需要当前实例内唯一可见控件“${label}”，实际找到 ${matching.length} 个`)
  const element = matching[0]!
  if (element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true'
    || view.getComputedStyle(element).pointerEvents === 'none') throw new Error(`按钮“${label}”不可操作`)
  const bounds = visibleBounds(element, root)!
  const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2
  if (x < 0 || x >= view.innerWidth || y < 0 || y >= view.innerHeight
    || closest(centerHit(root.ownerDocument, x, y) ?? root, CONTROL_SELECTOR) !== element) throw new Error(`按钮“${label}”中心被遮挡或在窗口外`)
  return { element, x, y, readText: () => readVisibleInstanceText(mounts, targetId, view) }
}

/** Reads only visible DOM facts in actual mounted target instances. Never clicks or infers private state. */
export function observeRuntimeDomControls(root: HTMLElement, targets: readonly RuntimeDomObservationTarget[]) {
  const dom = root.ownerDocument, view = dom.defaultView
  const unique = [...new Map(targets.map(target => [target.instanceId, target])).values()]
  const mounts = [...root.querySelectorAll<HTMLElement>(MOUNT_SELECTOR)]
  if (root.matches(MOUNT_SELECTOR)) mounts.unshift(root)
  let controlCount = 0
  const instances = unique.slice(0, MAX_INSTANCES).map(target => {
    const matching = mounts.filter(mount => (target.carrier === 'runtime' ? mount.dataset.runtimeInstanceId : mount.dataset.componentInstanceId) === target.instanceId)
    let visibleControlCount = 0
    const controls = matching.flatMap(mount => domControls(mount).flatMap(control => {
      if (closest(control, MOUNT_SELECTOR) !== mount) return []
      const bounds = visibleBounds(control, root)
      if (!bounds || !view) return []
      visibleControlCount += 1
      if (controlCount >= MAX_CONTROLS) return []
      controlCount += 1
      const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
      const insideViewport = center.x >= 0 && center.x < view.innerWidth && center.y >= 0 && center.y < view.innerHeight
      const available = typeof dom.elementFromPoint === 'function'
      const hit = available && insideViewport ? centerHit(dom, center.x, center.y) : null
      return [{
        tag: control.tagName.toLowerCase(), role: control.getAttribute('role') ?? 'button',
        label: text(control.getAttribute('aria-label') || control.innerText || control.textContent),
        text: text(control.innerText || control.textContent), bounds,
        pointerEvents: view.getComputedStyle(control).pointerEvents,
        disabled: control.matches(':disabled'), ariaDisabled: control.getAttribute('aria-disabled'),
        centerHit: { point: center, coordinateSpace: 'viewport-css-pixels',
          status: !available ? 'unavailable' : !insideViewport ? 'outside-viewport'
            : !hit ? 'none' : closest(hit, CONTROL_SELECTOR) === control ? 'control' : 'other-element',
          element: hit && view ? describeHit(hit, view) : null },
      }]
    }))
    return { ...target, status: !matching.length ? 'instance-not-mounted'
      : visibleControlCount ? 'visible-dom-controls-observed' : 'no-visible-dom-controls-observed',
    visibleControlCount, truncated: visibleControlCount > controls.length, controls }
  })
  return { observedAt: Date.now(), coverage: 'visible-dom-buttons-and-center-hit-only',
    actionsPerformed: [], clickPerformed: false, functionalResult: 'not-tested',
    unobserved: ['canvas-interactions', 'iframe-or-closed-shadow-dom-controls', 'private-runtime-state', 'post-click-behavior'],
    instruction: '只读当前目标实例的可见 DOM 按钮与中心命中事实；没有执行点击。命中控件不等于功能通过，没有可见 DOM 控件也不等于没有互动问题。',
    limits: { maxInstances: MAX_INSTANCES, maxControls: MAX_CONTROLS },
    truncated: unique.length > instances.length || instances.some(instance => instance.truncated), instances }
}
