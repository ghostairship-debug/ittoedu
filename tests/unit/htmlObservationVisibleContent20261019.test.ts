// @vitest-environment node
import { afterEach, expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
import { htmlActionScript, type HtmlPageOperation, type HtmlPageState } from '../../src/main/workbench/observation/HtmlActionPageScript'
import { htmlActionToolSchemas } from '../../src/core/tools/HtmlActionTools'

const opened: JSDOM[] = []
afterEach(() => { for (const dom of opened.splice(0)) dom.window.close() })

function fixture(markup: string, width = 600, height = 400) {
  const dom = new JSDOM(`<!doctype html><html><body>${markup}</body></html>`, { url: 'https://local.test/', runScripts: 'outside-only' })
  opened.push(dom)
  const { window } = dom
  Object.defineProperties(window, { innerWidth: { value: width }, innerHeight: { value: height } })
  // Chromium inherits contenteditable through nested markup; jsdom omits it.
  Object.defineProperty(window.HTMLElement.prototype, 'isContentEditable', { configurable: true, get(this: HTMLElement): boolean {
    const setting = this.getAttribute('contenteditable')
    if (setting === 'false') return false
    if (setting === '' || setting === 'true' || setting === 'plaintext-only') return true
    return this.parentElement?.isContentEditable ?? false
  } })
  const rect = (x: number, y: number, w: number, h: number) => ({ x, y, width: w, height: h, left: x, top: y, right: x + w, bottom: y + h })
  for (const element of window.document.querySelectorAll('*')) {
    Object.defineProperty(element, 'getBoundingClientRect', { configurable: true, value: () => {
      const geometry = element.closest('[data-rect]')?.getAttribute('data-rect')?.split(',').map(Number)
      return geometry ? rect(geometry[0]!, geometry[1]!, geometry[2]!, geometry[3]!) : rect(0, 0, width, height)
    } })
    Object.defineProperty(element, 'getClientRects', { configurable: true, value: () => {
      for (let parent: Element | null = element; parent; parent = parent.parentElement) if (window.getComputedStyle(parent).display === 'none') return []
      return [element.getBoundingClientRect()]
    } })
  }
  // jsdom has no layout. Supply range geometry, including a wrapping node whose
  // individual glyphs cross the viewport/ancestor/host clipping boundaries.
  Object.defineProperty(window.Range.prototype, 'getClientRects', { value: function (this: Range) {
    const node = this.startContainer as Text, parent = node.parentElement!
    const bounds = parent.getBoundingClientRect()
    const layout = parent.getAttribute('data-text-layout')?.split(',').map(Number)
    if (!layout) return [bounds]
    const [columns = 5, glyphWidth = 20, lineHeight = 20] = layout
    const result = []
    for (let offset = this.startOffset; offset < this.endOffset; offset += 1) {
      result.push(rect(bounds.x + offset % columns * glyphWidth, bounds.y + Math.floor(offset / columns) * lineHeight, glyphWidth, lineHeight))
    }
    return result
  } })
  return { window, evaluate: <T = HtmlPageState>(operation: HtmlPageOperation = { type: 'observe' }) => window.eval(htmlActionScript(operation)) as T }
}

function visibleReport(state: HtmlPageState) {
  // Fingerprints are private action preparation data, stripped by HtmlActionService.
  return { structure: state.structure, elements: state.elements.map(({ label, text, value }) => ({ label, text, value })) }
}

it('reports unique visible text owners and controls without ancestor, hidden or source text duplication', () => {
  const f = fixture(`<main><section><article>
    <h1>Visible <span style="display:none">HIDDEN_DISPLAY</span>heading</h1>
    <div><p id="result">Actual answer: <strong>42</strong><span style="visibility:hidden">HIDDEN_VISIBILITY</span></p></div>
    <button id="go"><span>Continue</span><span style="display:none">HIDDEN_BUTTON</span></button>
    <input aria-label="Answer" value="42">
    <div style="opacity:0">HIDDEN_OPACITY</div><div style="content-visibility:hidden">HIDDEN_CONTENT</div>
    <script>const HIDDEN_SCRIPT = 'source';</script><style>.HIDDEN_STYLE { color: red }</style>
    <template>HIDDEN_TEMPLATE</template><noscript>HIDDEN_NOSCRIPT</noscript>
  </article></section></main>`)
  const state = f.evaluate()
  expect(state.structure).toEqual(['Visible heading', 'Actual answer:', '42', 'Continue'])
  expect(state.elements.map(element => element.tag)).toEqual(['button', 'input', 'h1', 'p', 'strong'])
  expect(state.elements.find(element => element.tag === 'button')).toMatchObject({ label: 'Continue', text: 'Continue' })
  expect(state.elements.find(element => element.tag === 'input')).toMatchObject({ label: 'Answer', value: '42', editable: true })
  expect(JSON.stringify(visibleReport(state))).not.toContain('HIDDEN_')
  f.window.document.querySelector('#result')!.textContent = 'Actual answer: 84'
  const updated = f.evaluate()
  expect(updated.structure).toContain('Actual answer: 84')
  expect(updated.structure).not.toContain('Actual answer:')
})

it('retains every visible candidate and feedback beyond 4000 characters for service pagination', () => {
  const paragraphs = Array.from({ length: 135 }, (_, index) => `<p>Visible item ${index}: ${'readable '.repeat(10)}</p>`).join('')
  const f = fixture(`<main><section>${paragraphs}<output>FINAL_RESULT_135</output></section></main>`)
  const state = f.evaluate()
  expect(state.elements).toHaveLength(136)
  expect(state.matchedElements).toBe(136)
  expect(state.structure).toHaveLength(136)
  expect(state.structure.join('\n').length).toBeGreaterThan(4000)
  expect(state.structure.at(-1)).toBe('FINAL_RESULT_135')
  expect(state.elements.at(-1)).toMatchObject({ tag: 'output', text: 'FINAL_RESULT_135' })
  expect(state.elements.some(element => element.tag === 'main' || element.tag === 'section')).toBe(false)
})

it('keeps a long visible element label and text complete for full detail and tail filtering', () => {
  const text = `${'Readable text '.repeat(60)}ACTUAL_RESULT_AT_TAIL`
  const f = fixture(`<p>${text}</p>`)
  const state = f.evaluate()
  expect(state.elements[0]).toMatchObject({ label: text, text })
  expect(state.structure).toEqual([text])
})

it('clips a wrapping text node and its reported element to the actual visible viewport and host rectangle', () => {
  const f = fixture(`<div style="overflow-y:hidden" data-rect="0,0,200,60">
    <p data-rect="-20,20,100,60" data-text-layout="5,20,20">ABCDEFGHIJKLMNO</p>
    <p data-rect="0,110,100,20">OFFSCREEN_RESULT</p>
  </div>`, 300, 100)
  const state = f.evaluate({ type: 'observe', clip: { x: 0, y: 20, width: 60, height: 40 } })
  expect(state.structure).toEqual(['BCD GHI'])
  expect(state.elements).toHaveLength(1)
  expect(state.elements[0]).toMatchObject({ tag: 'p', label: 'BCD GHI', text: 'BCD GHI', rect: { x: 0, y: 20, width: 60, height: 40 } })
  expect(JSON.stringify(visibleReport(state))).not.toContain('OFFSCREEN_RESULT')
})

it('keeps observed control fingerprints usable without changing trusted input preparation or dispatching events', () => {
  const f = fixture('<button><span>Go</span><span style="display:none">Private label</span></button><input aria-label="Answer" value="initial">')
  let hit: Element = f.window.document.querySelector('button')!
  Object.defineProperty(f.window.document, 'elementFromPoint', { value: () => hit })
  let clicks = 0, inputs = 0
  hit.addEventListener('click', () => { clicks += 1 })
  f.window.document.querySelector('input')!.addEventListener('input', () => { inputs += 1 })
  const state = f.evaluate({ type: 'observe', clip: { x: 10, y: 10, width: 100, height: 50 } })
  const button = state.elements.find(element => element.tag === 'button')!
  expect(button.label).toBe('Go')
  expect(f.evaluate({ type: 'click', path: button.path, fingerprint: button.fingerprint })).toMatchObject({ applied: true })
  const input = state.elements.find(element => element.tag === 'input')!
  hit = f.window.document.querySelector('input')!
  expect(f.evaluate({ type: 'input', path: input.path, fingerprint: input.fingerprint, value: 'new value' })).toMatchObject({ applied: true, value: 'initial' })
  expect((hit as HTMLInputElement).value).toBe('initial')
  expect([clicks, inputs]).toEqual([0, 0])
})

it('keeps the actual contenteditable host for nested text and focused input preparation', () => {
  const f = fixture('<div id="editor" contenteditable="true"><p><span>Editable text</span></p></div><div id="empty" contenteditable="true"></div>')
  // Focus belongs to the editing host, not its inherited editable descendants.
  const host = f.window.document.querySelector('#editor')!
  const nested = host.querySelector('span')!
  expect((nested as HTMLElement).isContentEditable).toBe(true)
  Object.defineProperty(f.window.document, 'elementFromPoint', { value: () => nested })
  Object.defineProperty(f.window.document, 'activeElement', { get: () => host })
  const state = f.evaluate()
  expect(state.structure).toEqual(['Editable text'])
  expect(state.elements).toHaveLength(2)
  const target = state.elements.find(element => element.text === 'Editable text')!
  expect(target).toMatchObject({ tag: 'div', label: 'Editable text', editable: true, value: 'Editable text' })
  expect(state.elements.find(element => element.label === '')).toMatchObject({ tag: 'div', editable: true, value: '' })
  expect(f.evaluate({ type: 'input', path: target.path, fingerprint: target.fingerprint, value: 'New text', requireFocus: true }))
    .toMatchObject({ applied: true, value: 'Editable text' })
  expect(host.textContent).toBe('Editable text')
})

it('prioritizes the actual editing host while retaining all ordinary text handles', () => {
  const paragraphs = Array.from({ length: 130 }, (_, index) => `<p>Visible item ${index}</p>`).join('')
  const f = fixture(`${paragraphs}<div contenteditable="true"><p>Editable result</p></div>`)
  const state = f.evaluate()
  expect(state.elements).toHaveLength(131)
  expect(state.elements[0]).toMatchObject({ tag: 'div', label: 'Editable result', editable: true })
  expect(state.structure.at(-1)).toBe('Editable result')
})

it('preserves block and line-break separators inside a text owner while keeping inline text joined', () => {
  const f = fixture('<div contenteditable="true"><p>1</p><p>2</p><p>甲<strong>乙</strong>丙<br>下一行</p></div><button><span style="display:block">First</span><span style="display:block">Second</span></button>')
  const state = f.evaluate()
  expect(state.structure).toEqual(['1 2 甲乙丙 下一行', 'First Second'])
  expect(state.elements.find(element => element.tag === 'div')).toMatchObject({ editable: true, value: '1 2 甲乙丙 下一行' })
  expect(state.elements.find(element => element.tag === 'button')).toMatchObject({ text: 'First Second' })
})

it('does not introduce whitespace or a line-break separator from a hidden subtree', () => {
  const f = fixture('<button>甲<span style="display:none"> <br> </span>乙</button><div contenteditable="true">甲<span style="display:none"> </span>乙</div>')
  const state = f.evaluate()
  expect(state.structure).toEqual(['甲乙', '甲乙'])
  expect(state.elements[0]).toMatchObject({ tag: 'button', text: '甲乙' })
  expect(state.elements[1]).toMatchObject({ tag: 'div', text: '甲乙', editable: true })
})

it('accepts lightweight filtered generation pagination and full detail input without arbitrary maxima', () => {
  const schema = htmlActionToolSchemas['html.observe']
  expect(schema.parse({ purpose: 'diagnostic', query: 'Actual result', offset: 120, limit: 300, cursor: 'generation-page', detail: 'full' }))
    .toEqual({ purpose: 'diagnostic', query: 'Actual result', offset: 120, limit: 300, cursor: 'generation-page', detail: 'full' })
  expect(schema.parse({ offset: 100_000, limit: 100_000 })).toEqual({ offset: 100_000, limit: 100_000 })
  expect(schema.safeParse({ offset: -1 }).success).toBe(false)
  expect(schema.safeParse({ limit: 0 }).success).toBe(false)
  expect(schema.safeParse({ detail: 'source' }).success).toBe(false)
  expect(schema.safeParse({ path: 'not-model-authority' }).success).toBe(false)
})
