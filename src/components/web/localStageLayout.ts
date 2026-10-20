import type { ComponentLayoutInput } from '../../shared/contracts/component-platform'

export interface LocalStageLayoutFact {
  target: string
  viewport: { inlineSize: number; blockSize?: number; mode: ComponentLayoutInput['mode'] }
  contentBox: { inlineSize: number; blockSize: number }
  variant: string
  status: 'measured' | 'not-visible'
  tried: string[]
  issues: Array<{ code: string; target: string; axis?: string; excess?: number }>
  needsContentDecision: boolean
}

export interface LocalStageLayoutController {
  refresh(): void
  facts(): LocalStageLayoutFact[]
  dispose(): void
}

/** A content-realm projection only. This function is also serialized into owned documents. */
export function createLocalStageLayout(root: HTMLElement, options: {
  layout?: () => ComponentLayoutInput | undefined
  active?: () => boolean
  report?: (fact: LocalStageLayoutFact) => void
} = {}): LocalStageLayoutController {
  // Undeclared Web content keeps its original DOM and pays no observer/style cost.
  if (!root.matches('[data-gl-layout="stage"]') && !root.querySelector('[data-gl-layout="stage"]')) {
    let adopted: ReturnType<typeof createLocalStageLayout> | undefined, retired = false
    return { refresh() {
      if (retired) return
      if (!adopted && (root.matches('[data-gl-layout="stage"]') || root.querySelector('[data-gl-layout="stage"]'))) adopted = createLocalStageLayout(root, options)
      adopted?.refresh()
    }, facts: (): LocalStageLayoutFact[] => adopted?.facts() ?? [], dispose() { retired = true; adopted?.dispose() } }
  }
  const doc = root.ownerDocument, view = doc.defaultView!
  const ownerProperty = '__guolingLocalStageLayout'
  ;(Reflect.get(root, ownerProperty) as { dispose?(): void } | undefined)?.dispose?.()
  let disposed = false, queued = 0, sequence = 0
  const active = () => !disposed && root.isConnected && (options.active?.() ?? true)
  type State = { element: HTMLElement; id: string; variants: string[]; spacingSteps: number; attempt: number; tried: string[]; signature: string; css: string }
  const states = new Map<HTMLElement, State>()
  const style = doc.createElement('style')
  style.setAttribute('data-component-local-layout', '')
  const tree = root.getRootNode() as Document | ShadowRoot
  ;(tree === doc ? doc.head : tree.querySelector('head') ?? tree).appendChild(style)
  let observedBox: { key: string; inlineSize: number; blockSize: number } | undefined
  const number = (value: string) => Number.parseFloat(value) || 0
  const boxKey = () => { const css = view.getComputedStyle(root); return [css.width, css.height, css.boxSizing, css.padding, css.borderWidth].join('|') }
  const box = (element: HTMLElement) => {
    const css = view.getComputedStyle(element)
    const size = (axis: 'width' | 'height', sides: string[]) => {
      const value = css.getPropertyValue(axis), padding = sides.reduce((sum, side) => sum + number(css.getPropertyValue(`padding-${side}`)), 0)
      const border = sides.reduce((sum, side) => sum + number(css.getPropertyValue(`border-${side}-width`)), 0)
      return Math.max(0, value.endsWith('px') ? number(value) - (css.boxSizing === 'border-box' ? padding + border : 0)
        : (axis === 'width' ? element.clientWidth : element.clientHeight) - padding)
    }
    return { inlineSize: size('width', ['left', 'right']), blockSize: size('height', ['top', 'bottom']) }
  }
  const target = (element: Element) => element.id ? `#${element.id}` : element.getAttribute('data-gl-slot')
    ? `[data-gl-slot="${element.getAttribute('data-gl-slot')}"]` : element.getAttribute('data-gl-scroll')
      ? '[data-gl-scroll="auxiliary"]' : element.localName
  const visible = (element: HTMLElement) => {
    if (!element.getClientRects().length) return false
    for (let node: HTMLElement | null = element; node && root.contains(node); node = node.parentElement) {
      const css = view.getComputedStyle(node)
      if (css.display === 'none' || css.visibility === 'hidden' || Number.parseFloat(css.opacity) === 0) return false
      if (node === root) break
    }
    return true
  }
  const writeStyle = () => { const css = [...states.values()].map(state => state.css).join('\n'); if (style.textContent !== css) style.textContent = css }
  const apply = (state: State) => {
    const element = state.element, placement = options.layout?.(), natural = placement?.mode === 'flow-content'
    const selector = `[data-gl-runtime-id="${state.id}"]`, tight = state.spacingSteps > 1 && state.attempt % 2 === 1
    const variant = state.variants[Math.floor(state.attempt / state.spacingSteps)] ?? ''
    element.setAttribute('data-gl-runtime-variant', variant)
    // Inline author overrides continue to win. No author source, frame or font size is changed.
    const minPadding = view.getComputedStyle(element).getPropertyValue('--gl-padding-min').trim()
    state.css = `${selector}{display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:auto ${natural ? 'auto' : 'minmax(0,1fr)'} auto auto;box-sizing:border-box;min-width:0;min-height:0;${element.parentElement === root && !natural ? 'width:100%;height:100%;' : ''}gap:var(${tight ? '--gl-gap-min' : '--gl-gap-max'},12px);${tight && minPadding ? 'padding:var(--gl-padding-min);' : ''}}
${selector}>[data-gl-slot="heading"]{grid-row:1;min-width:0}
${selector}>[data-gl-slot="body"]{grid-row:2;min-width:0;min-height:0}
${selector}>[data-gl-slot="feedback"]{grid-row:3;min-width:0;overflow-wrap:anywhere;white-space:normal}
${selector}>[data-gl-slot="actions"]{grid-row:4;min-width:0;align-self:end}
${selector} [data-gl-scroll="auxiliary"]{overflow-y:auto;min-height:0;min-width:0}`
    writeStyle()
  }
  const inspect = (state: State): LocalStageLayoutFact => {
    const stage = state.element, bounds = stage.getBoundingClientRect(), issues: LocalStageLayoutFact['issues'] = []
    const placement = options.layout?.(), contentBox = box(stage)
    const measuredRoot = observedBox?.key === boxKey() ? observedBox : box(root)
    const viewport = placement ? { ...placement, inlineSize: measuredRoot.inlineSize,
      ...(placement.mode !== 'flow-content' ? { blockSize: measuredRoot.blockSize } : {}) }
      : { mode: 'free-frame' as const, inlineSize: measuredRoot.inlineSize, blockSize: measuredRoot.blockSize }
    const add = (code: string, element: Element, axis?: string, excess?: number) => {
      const issue = { code, target: target(element), ...(axis ? { axis } : {}), ...(excess !== undefined ? { excess: Math.ceil(excess * 100) / 100 } : {}) }
      if (!issues.some(value => value.code === code && value.target === issue.target && value.axis === axis)) issues.push(issue)
    }
    if (!visible(stage)) return { target: target(stage), viewport, contentBox, variant: stage.getAttribute('data-gl-runtime-variant') ?? '',
      status: 'not-visible', tried: [...state.tried], issues: [], needsContentDecision: false }
    for (const body of stage.querySelectorAll<HTMLElement>('[data-gl-slot="body"]'))
      if ((body.textContent?.trim() || body.children.length) && !visible(body)) add('body-hidden', body)
    for (const actions of stage.querySelectorAll<HTMLElement>('[data-gl-slot="actions"]')) {
      if (!visible(actions)) add('primary-actions-hidden', actions)
      const controls = [...actions.querySelectorAll<HTMLElement>('button,a[href],input:not([type="hidden"]),select,textarea,[role="button"],[tabindex],[onclick]')]
      if (controls.length && !controls.some(visible)) add('primary-actions-unreachable', actions)
    }
    const minFont = number(view.getComputedStyle(stage).getPropertyValue('--gl-font-min'))
    const slots = [...stage.children].filter((element): element is HTMLElement => element instanceof view.HTMLElement && element.hasAttribute('data-gl-slot') && visible(element))
    for (let index = 0; index + 1 < slots.length; index++) {
      const current = slots[index]!, rect = current.getBoundingClientRect()
      const next = slots.slice(index + 1).find(element => element.getBoundingClientRect().height > 0)
      if (!next) continue
      const following = next.getBoundingClientRect(), overlap = Math.min(rect.bottom, following.bottom) - Math.max(rect.top, following.top)
      if (rect.height > 0 && overlap > 1 && Math.min(rect.right, following.right) > Math.max(rect.left, following.left) + 1)
        add('slot-overlap', current, 'block', overlap)
    }
    const elements = [stage, ...stage.querySelectorAll<HTMLElement>('*')].filter(element => !['script', 'style', 'template'].includes(element.localName) && visible(element))
    for (const element of elements) {
      const css = view.getComputedStyle(element), auxiliary = element.closest('[data-gl-scroll="auxiliary"]')
      const horizontal = element.scrollWidth - element.clientWidth, vertical = element.scrollHeight - element.clientHeight
      if (horizontal > 1) add('horizontal-overflow', element, 'inline', horizontal)
      if (vertical > 1 && /^(hidden|clip)$/.test(css.overflowY)) add('clipped-content', element, 'block', vertical)
      else if (vertical > 1 && element.hasAttribute('data-gl-slot') && !auxiliary) add('content-overflow', element, 'block', vertical)
      if (minFont && [...element.childNodes].some(node => node.nodeType === 3 && node.textContent?.trim()) && number(css.fontSize) < minFont)
        add('font-below-declared-minimum', element)
      if (element.matches('[data-gl-scroll="auxiliary"]') && vertical > 1) {
        if (element.clientHeight < 24) add('auxiliary-scroll-unreachable', element)
        for (let parent = element.parentElement; parent && stage.contains(parent); parent = parent.parentElement) {
          const parentCss = view.getComputedStyle(parent)
          if (/^(auto|scroll)$/.test(parentCss.overflowY) && parent.scrollHeight > parent.clientHeight + 1) { add('nested-scroll', element); break }
        }
      }
      if (!element.matches('[data-gl-slot="actions"], [data-gl-slot="actions"] button, [data-gl-slot="actions"] a, [data-gl-slot="actions"] input, [data-gl-slot="actions"] [tabindex]')) continue
      const rect = element.getBoundingClientRect()
      const outside = (clip: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>, x: boolean, y: boolean) => Math.max(0, x ? clip.left - rect.left : 0, x ? rect.right - clip.right : 0, y ? clip.top - rect.top : 0, y ? rect.bottom - clip.bottom : 0)
      if (placement?.mode !== 'flow-content' && outside(bounds, true, true) > 1) add('primary-action-outside-stage', element)
      for (let parent = element.parentElement; parent && root.contains(parent); parent = parent.parentElement) {
        const parentCss = view.getComputedStyle(parent), x = /^(hidden|clip|auto|scroll)$/.test(parentCss.overflowX), y = /^(hidden|clip|auto|scroll)$/.test(parentCss.overflowY)
        const borderBox = parent.getBoundingClientRect(), bordersX = number(parentCss.borderLeftWidth) + number(parentCss.borderRightWidth), bordersY = number(parentCss.borderTopWidth) + number(parentCss.borderBottomWidth)
        const localWidth = number(parentCss.width) + (parentCss.boxSizing === 'border-box' ? 0 : number(parentCss.paddingLeft) + number(parentCss.paddingRight) + bordersX)
        const localHeight = number(parentCss.height) + (parentCss.boxSizing === 'border-box' ? 0 : number(parentCss.paddingTop) + number(parentCss.paddingBottom) + bordersY)
        const scaleX = localWidth > 0 ? borderBox.width / localWidth : 1, scaleY = localHeight > 0 ? borderBox.height / localHeight : 1
        const left = borderBox.left + number(parentCss.borderLeftWidth) * scaleX, top = borderBox.top + number(parentCss.borderTopWidth) * scaleY
        const excess = outside({ left, top, right: left + parent.clientWidth * scaleX, bottom: top + parent.clientHeight * scaleY }, x, y)
        if (excess > 1) { add('primary-action-clipped', element, x && y ? 'both' : x ? 'inline' : 'block', excess); break }
        if (parent === root) break
      }
      if (element.matches('button,a,input,[tabindex],[role="button"],[onclick]') && rect.width && rect.height && typeof tree.elementFromPoint === 'function') {
        const painted = tree.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
        if (painted && !element.contains(painted)) add('primary-action-occluded', element)
      }
    }
    if (placement?.mode !== 'flow-content' && (stage.scrollHeight > stage.clientHeight + 1 || bounds.bottom > root.getBoundingClientRect().bottom + 1))
      add('stage-overflow', stage, 'block', Math.max(stage.scrollHeight - stage.clientHeight, bounds.bottom - root.getBoundingClientRect().bottom))
    return { target: target(stage), viewport, contentBox, variant: stage.getAttribute('data-gl-runtime-variant') ?? '', status: 'measured', tried: [...state.tried], issues,
      needsContentDecision: issues.length > 0 && state.attempt + 1 >= state.variants.length * state.spacingSteps }
  }
  const run = () => {
    queued = 0
    if (!active()) return
    const stages = [...(root.matches('[data-gl-layout="stage"]') ? [root] : []), ...root.querySelectorAll<HTMLElement>('[data-gl-layout="stage"]')]
    for (const [element] of states) if (!stages.includes(element)) states.delete(element)
    for (const element of stages) {
      if (element.closest('[data-gl-layout="stage"]') !== element) continue
      let state = states.get(element)
      if (!state) {
        const variants = [...new Set((element.getAttribute('data-gl-variants') ?? '').split(/\s+/).filter(value => /^(wide|compact)$/.test(value)))]
        const css = view.getComputedStyle(element), spacingSteps = css.getPropertyValue('--gl-gap-min').trim() || css.getPropertyValue('--gl-padding-min').trim() ? 2 : 1
        state = { element, id: `local-${++sequence}`, variants: variants.length ? variants : [''], spacingSteps, attempt: 0, tried: [], signature: '', css: '' }
        states.set(element, state); element.setAttribute('data-gl-runtime-id', state.id); apply(state); schedule(false); continue
      }
      const candidate = `${state.variants[Math.floor(state.attempt / state.spacingSteps)] || 'base'}:${state.spacingSteps > 1 && state.attempt % 2 ? 'minimum-spacing' : 'authored-spacing'}`
      if (!state.tried.includes(candidate)) state.tried.push(candidate)
      const fact = inspect(state), signature = JSON.stringify(fact)
      if (state.signature !== signature) {
        state.signature = signature
        element.setAttribute('data-gl-runtime-layout', signature)
        options.report?.(fact)
      }
      if (fact.issues.length && state.attempt + 1 < state.variants.length * state.spacingSteps) { state.attempt++; apply(state); schedule(false) }
    }
    writeStyle()
  }
  function schedule(reset = true) {
    if (!active()) return
    if (reset) for (const state of states.values()) {
      const variants = [...new Set((state.element.getAttribute('data-gl-variants') ?? '').split(/\s+/).filter(value => /^(wide|compact)$/.test(value)))]
      state.variants = variants.length ? variants : ['']
      const css = view.getComputedStyle(state.element)
      state.spacingSteps = css.getPropertyValue('--gl-gap-min').trim() || css.getPropertyValue('--gl-padding-min').trim() ? 2 : 1
      state.attempt = 0; state.tried = []; apply(state)
    }
    if (!queued) queued = view.requestAnimationFrame(run)
  }
  const mutations = new view.MutationObserver(records => {
    if (records.some(record => record.type !== 'attributes' || !record.attributeName?.startsWith('data-gl-runtime-'))) schedule()
  })
  mutations.observe(root, { childList: true, characterData: true, attributes: true, subtree: true })
  const resize = new view.ResizeObserver(entries => {
    const entry = entries.find(value => value.target === root), sizes = entry?.contentBoxSize
    const content = Array.isArray(sizes) ? sizes[0] : sizes as unknown as ResizeObserverSize | undefined
    if (!content) return
    const css = view.getComputedStyle(root), vertical = /^(vertical|sideways)/.test(css.writingMode)
    const next = { key: boxKey(), inlineSize: vertical ? content.blockSize : content.inlineSize, blockSize: vertical ? content.inlineSize : content.blockSize }
    if (observedBox?.key === next.key && observedBox.inlineSize === next.inlineSize && observedBox.blockSize === next.blockSize) return
    observedBox = next; schedule()
  })
  resize.observe(root)
  const changed = () => schedule()
  root.addEventListener('load', changed, true); root.addEventListener('toggle', changed, true)
  doc.fonts?.addEventListener('loadingdone', changed)
  void doc.fonts?.ready.then(() => { if (active()) schedule() })
  schedule()
  const controller = { refresh: changed, facts: (): LocalStageLayoutFact[] => [...states.values()].map(state => inspect(state)), dispose() {
    if (disposed) return
    disposed = true; if (queued) view.cancelAnimationFrame(queued)
    mutations.disconnect(); resize.disconnect(); style.remove()
    root.removeEventListener('load', changed, true); root.removeEventListener('toggle', changed, true); doc.fonts?.removeEventListener('loadingdone', changed)
    for (const state of states.values()) for (const name of ['data-gl-runtime-id', 'data-gl-runtime-variant', 'data-gl-runtime-layout']) state.element.removeAttribute(name)
    states.clear()
    if (Reflect.get(root, ownerProperty) === controller) Reflect.deleteProperty(root, ownerProperty)
  } }
  Object.defineProperty(root, ownerProperty, { configurable: true, value: controller })
  return controller
}
