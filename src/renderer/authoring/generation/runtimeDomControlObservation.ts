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
