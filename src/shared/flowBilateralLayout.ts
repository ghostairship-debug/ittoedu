/** View-only central exclusions shared by the editor and compiled Player.
 * Empty gaps never enter author content. Runtime is measured once, not mounted
 * in the hidden typography probe. Native text order and node identity survive. */
export interface FlowBilateralGap { node: Text; offset: number; width: number }
const gapSelector = '[data-flow-bilateral-gap]'
const atomicSelector = '[data-flow-body-block="course-instance"],[data-compiled-node]'
const finiteBox = (r: DOMRect) => r.width > 0 && r.height > 0
const intersects = (a: DOMRect, b: { left: number; right: number; top: number; bottom: number }) =>
  a.right > b.left + .25 && a.left < b.right - .25 && a.bottom > b.top + .25 && a.top < b.bottom - .25

function flowBilateralCandidates(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('[style*="--flow-bilateral"]')]
    .filter(node => node.style.getPropertyValue('--flow-bilateral') === '1')
}
export function flowBilateralObjects(root: HTMLElement): HTMLElement[] {
  return flowBilateralCandidates(root).filter(node => finiteBox(node.getBoundingClientRect()))
}
export function createFlowBilateralGap(document: Document, width: number): HTMLSpanElement {
  const gap = document.createElement('span')
  gap.dataset.flowBilateralGap = ''
  gap.contentEditable = 'false'
  gap.setAttribute('aria-hidden', 'true')
  gap.style.cssText = 'display:inline-block;height:0;padding:0;border:0;margin:0;vertical-align:baseline;pointer-events:none;user-select:none;'
  gap.style.width = width + 'px'
  return gap
}
function insertGap(node: Text, offset: number, gap: HTMLElement): Text {
  if (offset === 0) { node.before(gap); return node }
  if (offset === node.length) { node.after(gap); return node }
  const after = node.splitText(offset); after.before(gap); return after
}

/** Synchronous layout solve on a non-interactive copy; only final gaps reach UI. */
export function planFlowBilateralGaps(root: HTMLElement, textRoots: readonly HTMLElement[]): FlowBilateralGap[] {
  const objects = flowBilateralObjects(root)
  if (!objects.length || !textRoots.length || !root.parentElement) return []
  const document = root.ownerDocument, browser = document.defaultView!
  const copy = root.cloneNode(true) as HTMLElement
  const pairs = new Map<Node, Node>(), origins = new WeakMap<Text, { node: Text; offset: number }>()
  const pair = (a: Node, b: Node) => {
    pairs.set(a, b)
    if (a.nodeType === 3) origins.set(b as Text, { node: a as Text, offset: 0 })
    for (let i = 0; i < a.childNodes.length; i++) pair(a.childNodes[i]!, b.childNodes[i]!)
  }
  pair(root, copy)
  const roots = textRoots.filter(node => !objects.some(object => object.contains(node)))
    .map(node => pairs.get(node) as HTMLElement).filter(Boolean)
  const obstacles = objects.map(node => pairs.get(node) as HTMLElement)
  for (const node of root.querySelectorAll<HTMLElement>(atomicSelector)) {
    if (textRoots.some(text => node.contains(text))) continue
    const clone = pairs.get(node) as HTMLElement, height = node.offsetHeight
    clone.replaceChildren()
    Object.assign(clone.style, { height: height + 'px', minHeight: height + 'px', maxHeight: height + 'px', boxSizing: 'border-box' })
  }
  // Copying a DOM tree must not start a second iframe, program, image or media load.
  for (const node of root.querySelectorAll<HTMLElement>('iframe,img,video,audio,canvas,object,embed')) {
    const clone = pairs.get(node) as HTMLElement
    if (!copy.contains(clone)) continue
    const placeholder = document.createElement('span')
    placeholder.style.cssText = clone.style.cssText
    Object.assign(placeholder.style, { display: 'inline-block', width: node.offsetWidth + 'px', height: node.offsetHeight + 'px' })
    clone.replaceWith(placeholder)
  }
  copy.querySelectorAll('script,link,style,' + gapSelector).forEach(node => node.remove())
  copy.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'))
  copy.dataset.flowBilateralMeasure = ''
  copy.setAttribute('aria-hidden', 'true'); copy.inert = true; copy.contentEditable = 'false'
  Object.assign(copy.style, { position: 'absolute', left: '0px', top: '0px', visibility: 'hidden', pointerEvents: 'none',
    width: root.offsetWidth + 'px', height: 'auto', minHeight: '0px', margin: '0px', boxSizing: 'border-box', transform: 'none' })
  root.parentElement.append(copy)
  const plan: FlowBilateralGap[] = [], gapPlans = new WeakMap<HTMLElement, FlowBilateralGap>()
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  const quantize = (value: number) => Math.ceil(value * 64) / 64
  try {
    const scale = copy.offsetWidth ? copy.getBoundingClientRect().width / copy.offsetWidth : 1
    if (!(scale > 0)) return []
    const budget = Math.max(32, roots.reduce((sum, node) => sum + (node.textContent?.length ?? 0), 0) * 2)
    const attempts = new Map<string, number>(), sourceIds = new WeakMap<Text, number>()
    let sourceSerial = 0
    for (let iteration = 0; iteration < budget; iteration++) {
      const boxes = obstacles.map(node => { const r = node.getBoundingClientRect(); return {
        left: r.left - 20 * scale, right: r.right + 20 * scale, top: r.top - 8 * scale, bottom: r.bottom + 8 * scale } })
      let hit: { node: Text; block: HTMLElement; offset: number; rect: DOMRect; right: number; blockRight: number } | undefined
      for (const block of roots) {
        if (!copy.contains(block) || !finiteBox(block.getBoundingClientRect())) continue
        const walker = document.createTreeWalker(block, 4)
        for (let node = walker.nextNode() as Text | null; node && !hit; node = walker.nextNode() as Text | null) {
          if (!origins.has(node) || !node.data.trim()) continue
          const range = document.createRange(); range.selectNodeContents(node)
          if (![...range.getClientRects()].some(rect => boxes.some(box => intersects(rect, box)))) continue
          for (const part of segmenter.segment(node.data)) {
            if (!part.segment.trim()) continue
            range.setStart(node, part.index); range.setEnd(node, part.index + part.segment.length)
            const rect = range.getBoundingClientRect(), collisions = boxes.filter(box => intersects(rect, box))
            if (collisions.length) {
              hit = { node, block, offset: part.index, rect, right: Math.max(...collisions.map(box => box.right)), blockRight: block.getBoundingClientRect().right }
              break
            }
          }
        }
        if (hit) break
      }
      if (!hit) return plan
      let node = hit.node, offset = hit.offset, rect = hit.rect
      // Marks and previous view-only splits are not word boundaries. Measure
      // one logical word across its actual text nodes before choosing a gap.
      if (/[A-Za-z0-9]/.test(node.data[offset] ?? '')) {
        const segments: Array<{ node: Text; start: number; end: number }> = []
        const walker = document.createTreeWalker(hit.block, 4)
        let text = '', at = 0
        for (let part = walker.nextNode() as Text | null; part; part = walker.nextNode() as Text | null) {
          if (!origins.has(part)) continue
          if (part === node) at = text.length + offset
          segments.push({ node: part, start: text.length, end: text.length + part.length }); text += part.data
        }
        const start = text.slice(0, at).match(/[A-Za-z0-9_'’-]+$/)?.index ?? at
        const end = at + (text.slice(at).match(/^[A-Za-z0-9_'’-]+/)?.[0].length ?? 0)
        const first = segments.find(part => part.start <= start && part.end > start)
        const last = segments.find(part => part.start < end && part.end >= end)
        if (first && last) {
          const range = document.createRange(); range.setStart(first.node, start - first.start); range.setEnd(last.node, end - last.start)
          const word = range.getBoundingClientRect(), pieces = [...range.getClientRects()]
          if (word.width <= hit.blockRight - hit.right && pieces.every(piece => Math.abs(piece.top - rect.top) < .5))
            { node = first.node; offset = start - first.start; rect = word }
        }
      }
      const origin = origins.get(node)!
      const anchor = { node: origin.node, offset: origin.offset + offset }
      if (!sourceIds.has(anchor.node)) sourceIds.set(anchor.node, ++sourceSerial)
      const key = sourceIds.get(anchor.node) + ':' + anchor.offset + ':' + Math.round(rect.top * 4) + ':' + Math.round(rect.left * 4)
      attempts.set(key, (attempts.get(key) ?? 0) + 1)
      if (attempts.get(key)! > 4) throw new Error('中央双侧正文排版未收敛，原正文与既有编辑状态保留')
      const width = quantize((hit.right - rect.left + .5 * scale) / scale)
      if (!(width > 0)) throw new Error('中央双侧正文避让宽度无效')
      const previous = offset === 0 ? node.previousSibling : null
      if (previous instanceof browser.HTMLElement && previous.matches(gapSelector)
        && Math.abs(previous.getBoundingClientRect().top - rect.bottom) < rect.height) {
        const existing = gapPlans.get(previous)
        if (existing) { existing.width = quantize(existing.width + width); previous.style.width = existing.width + 'px'; continue }
      }
      const gap = createFlowBilateralGap(document, width), value = { ...anchor, width }
      const right = insertGap(node, offset, gap)
      if (right !== node) origins.set(right, { node: origin.node, offset: origin.offset + offset })
      gapPlans.set(gap, value); plan.push(value)
    }
    throw new Error('中央双侧正文排版超过本次可收敛范围，原正文保留')
  } finally { copy.remove() }
}

/** Observe typography/content and object sizes, not the resulting body height.
 * Selection-only updates and our own empty-gap mutations reuse the stable plan. */
export function observeFlowBilateralLayout(root: HTMLElement, options: {
  textRoots(): readonly HTMLElement[]
  apply(gaps: readonly FlowBilateralGap[]): void | boolean
  paused?(): boolean
  beforeMeasure?(): void
  error?(message: string): void
}): { invalidate(): void; destroy(): void } {
  const browser = root.ownerDocument.defaultView!
  let frame = 0, stopped = false, signature = '', failedSignature = '', observed = new Set<Element>()
  const resize = typeof browser.ResizeObserver === 'function' ? new browser.ResizeObserver(() => invalidate()) : undefined
  const mutation = new browser.MutationObserver(() => invalidate())
  function invalidate() {
    if (stopped || frame) return
    frame = browser.requestAnimationFrame(() => {
      frame = 0
      if (stopped || !root.isConnected || options.paused?.()) return
      options.beforeMeasure?.()
      if (options.paused?.()) return
      // Zero-height Runtime wrappers must already be observed: their first height
      // need not resize a longer body or mutate the parent document's DOM.
      const objects = flowBilateralCandidates(root), texts = options.textRoots()
      const nextObserved = new Set<Element>([root, ...objects])
      for (const node of observed) if (!nextObserved.has(node)) resize?.unobserve(node)
      for (const node of nextObserved) if (!observed.has(node)) resize?.observe(node)
      observed = nextObserved
      const next = JSON.stringify([root.clientWidth, objects.map(node => [node.getAttribute('style'), node.offsetWidth, node.offsetHeight]),
        texts.map(node => { const css = browser.getComputedStyle(node); return [node.textContent, node.getAttribute('style'), css.font, css.lineHeight, css.letterSpacing, css.textAlign, css.whiteSpace, css.wordBreak] })])
      if (next === signature || next === failedSignature) return
      try {
        const gaps = planFlowBilateralGaps(root, texts)
        if (options.apply(gaps) === false) { invalidate(); return }
        signature = next; failedSignature = ''
      } catch (error) { failedSignature = next; options.error?.(error instanceof Error ? error.message : String(error)) }
    })
  }
  mutation.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['style', 'class'] })
  const fonts = () => { signature = ''; failedSignature = ''; invalidate() }
  root.ownerDocument.fonts?.addEventListener('loadingdone', fonts)
  invalidate()
  return { invalidate, destroy() { stopped = true; browser.cancelAnimationFrame(frame); mutation.disconnect(); resize?.disconnect(); root.ownerDocument.fonts?.removeEventListener('loadingdone', fonts) } }
}

export function applyFlowBilateralDomGaps(root: HTMLElement, gaps: readonly FlowBilateralGap[]): void {
  if (gaps.some(gap => !root.contains(gap.node) || gap.offset < 0 || gap.offset > gap.node.length))
    throw new Error('中央双侧正文来源已改变，请重新排版')
  const groups: Array<{ node: Text; offset: number; gaps: FlowBilateralGap[] }> = []
  const indexed = new Map<Text, Map<number, typeof groups[number]>>()
  for (const gap of gaps) {
    let offsets = indexed.get(gap.node)
    if (!offsets) { offsets = new Map(); indexed.set(gap.node, offsets) }
    let group = offsets.get(gap.offset)
    if (!group) { group = { node: gap.node, offset: gap.offset, gaps: [] }; offsets.set(gap.offset, group); groups.push(group) }
    group.gaps.push(gap)
  }
  root.querySelectorAll(gapSelector).forEach(node => node.remove())
  // Descending anchors keep source nodes/offsets valid. Gaps sharing one anchor
  // remain in the measured order, including the no-split offset-zero case.
  groups.sort((a, b) => a.node === b.node ? b.offset - a.offset
    : a.node.compareDocumentPosition(b.node) & 4 ? 1 : -1)
  for (const { node, offset, gaps } of groups) {
    const fragment = root.ownerDocument.createDocumentFragment()
    for (const gap of gaps) fragment.append(createFlowBilateralGap(root.ownerDocument, gap.width))
    const reference = offset === 0 ? node : offset === node.length ? node.nextSibling : node.splitText(offset)
    node.parentNode!.insertBefore(fragment, reference)
  }
}

