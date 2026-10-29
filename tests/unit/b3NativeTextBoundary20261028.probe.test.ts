// @vitest-environment node
// Controlled current-code probe, not the missing historical "95小时" adoption input.
import { afterAll, beforeAll, expect, it } from 'vitest'
import { build } from 'esbuild'
import { chromium, type Browser, type Page } from 'playwright'
import { assembleMeasuredHtml, type HtmlAssemblyObject, type HtmlDesignCapture } from '../../src/core/contentApply/assembly/htmlAssembly'
import { professionalHtmlDraft } from '../../src/main/workbench/contentApply/application/professionalHtml'
import { textComponentDataSchema } from '../../src/components/text/data'

let browser: Browser, page: Page
beforeAll(async () => {
  const built = await build({ stdin: { contents: `
    export {captureHtmlDesignViewport} from './src/main/workbench/contentApply/measurement/browserCapture';
    export {cssUsesViewport} from './src/components/web/measuredFragmentBox';
    export {renderTextComponent,measureTextComponent,applyTextComponentLayout} from './src/components/text/render';
  `, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'browser', format: 'iife',
  globalName: 'B3NativeProbe', target: 'es2022' })
  browser = await chromium.launch({ headless: true })
  page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  await page.addScriptTag({ content: built.outputFiles[0]!.text })
}, 30_000)
afterAll(async () => { await browser?.close() })

type BrowserApi = {
  captureHtmlDesignViewport: typeof import('../../src/main/workbench/contentApply/measurement/browserCapture').captureHtmlDesignViewport
  cssUsesViewport: typeof import('../../src/components/web/measuredFragmentBox').cssUsesViewport
  renderTextComponent: typeof import('../../src/components/text/render').renderTextComponent
  measureTextComponent: typeof import('../../src/components/text/render').measureTextComponent
  applyTextComponentLayout: typeof import('../../src/components/text/render').applyTextComponentLayout
}
const sourceHtml = '<!doctype html><style>body{margin:0}</style><p id="boundary" style="position:absolute;left:0;top:0;display:inline-block;margin:0;padding:0;border:0;font-family:Microsoft YaHei,sans-serif;font-size:28px;font-weight:400;line-height:normal;white-space:normal;overflow-wrap:normal;letter-spacing:normal">95小时</p>'
const flatten = (object: HtmlAssemblyObject): HtmlAssemblyObject[] => [object, ...object.children.flatMap(flatten)]

it('compares source, capture, assembly, native draft and actual native glyphs at the same critical widths', async () => {
  await page.setContent(sourceHtml)
  const boundarySearch = await page.evaluate(async () => {
    await document.fonts.ready
    const source = document.getElementById('boundary')!, intrinsicWidth = source.getBoundingClientRect().width
    const samples: { requestedWidth: number; actualWidth: number; lines: number }[] = []
    for (let step = 0; step <= 128; step++) {
      const requestedWidth = intrinsicWidth - step / 64
      source.style.width = `${requestedWidth}px`
      const range = document.createRange(); range.selectNodeContents(source)
      const sample = { requestedWidth, actualWidth: source.getBoundingClientRect().width,
        lines: new Set(Array.from(range.getClientRects(), rect => rect.top)).size }
      const previous = samples.at(-1)
      samples.push(sample)
      if (previous?.lines === 1 && sample.lines === 2) return { intrinsicWidth, samples,
        threshold: { requestedWidth, actualWidth: sample.actualWidth, oneLineWidth: previous.requestedWidth,
          meaning: 'First sampled two-line width when descending in 1/64px steps; the adjacent larger width has one line.' } }
    }
    return { intrinsicWidth, samples, threshold: null }
  })
  const { intrinsicWidth, threshold } = boundarySearch
  if (!threshold) {
    process.stdout.write('B3_NATIVE_CRITICAL_WIDTH_PROBE ' + JSON.stringify({ sample: 'new controlled input; historical input unavailable',
      sourceHtml, boundarySearch, error: 'No source transition from one to two lines within 2px below intrinsic width.' }) + '\n')
    throw new Error('No measured source 1-to-2-line threshold within the bounded 2px search; no threshold was substituted.')
  }
  const receipts = []
  for (const delta of [-1 / 64, 0, 1 / 64]) {
    await page.setContent(sourceHtml)
    const captured = await page.evaluate(async width => {
      document.getElementById('boundary')!.style.width = `${width}px`
      const api = (window as unknown as { B3NativeProbe: BrowserApi }).B3NativeProbe
      const capture = await api.captureHtmlDesignViewport(1_000, api.cssUsesViewport)
      return { capture, html: document.documentElement.outerHTML }
    }, threshold.requestedWidth + delta)
    const capture: HtmlDesignCapture = captured.capture
    const measured = capture.elements.find(element => element.attributes.id === 'boundary')!
    const assembly = assembleMeasuredHtml(capture, { html: captured.html })
    const object = flatten(assembly.root).find(value => JSON.stringify(value.sourcePath) === JSON.stringify(measured.sourcePath))!
    expect(object?.kind, JSON.stringify({ capture: capture.diagnostics, assembly: assembly.diagnostics })).toBe('text')
    const prepared = professionalHtmlDraft(object, {}, () => 'probe-formula', assembly.supportCss)
    expect(prepared?.kind, JSON.stringify(prepared)).toBe('native')
    if (prepared?.kind !== 'native' || !prepared.draft.frame) throw new Error('Native text draft required')
    const data = textComponentDataSchema.parse(prepared.draft.data), frame = prepared.draft.frame
    const rendered = await page.evaluate(({ data, frame, style }) => {
      const api = (window as unknown as { B3NativeProbe: BrowserApi }).B3NativeProbe
      const carrier = document.createElement('div')
      for (const [name, value] of Object.entries(style)) carrier.style.setProperty(name, value)
      Object.assign(carrier.style, { position: 'absolute', left: '0', top: '200px',
        width: `${frame.width}px`, height: `${frame.height}px` })
      const native = api.renderTextComponent(document, data)
      carrier.appendChild(native); document.body.appendChild(carrier)
      const layout = api.measureTextComponent(native, frame, data.sizing)
      api.applyTextComponentLayout(native, layout)
      const geometry = (root: HTMLElement, content: HTMLElement) => {
        const origin = root.getBoundingClientRect(), walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT)
        const glyphs: { text: string; left: number; top: number; width: number; height: number }[] = []
        let node: Node | null
        while ((node = walker.nextNode())) {
          let offset = 0
          for (const text of node.textContent ?? '') {
            const range = document.createRange(); range.setStart(node, offset); range.setEnd(node, offset + text.length)
            const rect = range.getBoundingClientRect()
            glyphs.push({ text, left: rect.left - origin.left, top: rect.top - origin.top, width: rect.width, height: rect.height })
            offset += text.length
          }
        }
        const computed = getComputedStyle(content)
        return { width: origin.width, height: origin.height, contentWidth: content.getBoundingClientRect().width,
          lines: new Set(glyphs.map(glyph => glyph.top)).size, glyphs,
          computed: Object.fromEntries(['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing',
            'white-space', 'overflow-wrap'].map(name => [name, computed.getPropertyValue(name)])) }
      }
      const source = document.getElementById('boundary')!
      return { source: geometry(source, source), native: geometry(native, native.querySelector<HTMLElement>('[data-text-component-content]')!), layout }
    }, { data, frame, style: object.style })
    receipts.push({ delta, requestedWidth: threshold.requestedWidth + delta, captureFrame: measured.frame,
      assemblyFrame: object.frame, draftFrame: frame, data, ...rendered })
  }
  process.stdout.write('B3_NATIVE_CRITICAL_WIDTH_PROBE ' + JSON.stringify({ sample: 'new controlled input; historical input unavailable', sourceHtml, intrinsicWidth, threshold, boundarySearch: boundarySearch.samples, receipts }) + '\n')
  expect(receipts.map(result => result.source.lines)).toEqual(expect.arrayContaining([1, 2]))
  for (const result of receipts) {
    const widths = [result.captureFrame!.width, result.assemblyFrame.width, result.draftFrame.width,
      result.native.width, result.native.contentWidth]
    expect(widths).toEqual(Array(widths.length).fill(result.source.width))
    expect(result.native.glyphs.map(glyph => glyph.text).join('')).toBe('95小时')
    expect(result.native.lines).toBe(result.source.lines)
    expect(result.native.glyphs).toHaveLength(result.source.glyphs.length)
    for (let index = 0; index < result.source.glyphs.length; index++) {
      for (const key of ['left', 'top', 'width', 'height'] as const)
        expect(Math.abs(result.native.glyphs[index]![key] - result.source.glyphs[index]![key])).toBeLessThan(0.1)
    }
  }
}, 30_000)
