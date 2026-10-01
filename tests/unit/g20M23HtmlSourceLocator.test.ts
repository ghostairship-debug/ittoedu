import { expect, it } from 'vitest'
import { locateHtmlSourceTarget, escapeHtmlText } from '../../src/main/workbench/htmlPreview/htmlSourceLocator'
import type { HtmlTargetReport } from '../../src/renderer/documentFiles/html/htmlPreviewController'

const identity = { documentId: 'doc', epoch: 'epoch', revision: 4, bindingVersion: 2 }
const rectangle = { x: 1, y: 2, width: 30, height: 20 }
function textReport(path: HtmlTargetReport['domPath'], rawText: string, sectionOrder: number | null = null): HtmlTargetReport {
  return { handle: 'one', kind: 'text', domPath: path, sectionOrder, rawText, attributeName: null,
    rect: rectangle, scriptCreated: false }
}

it('locates only the selected repeated text and preserves source UTF-16 boundaries', () => {
  const source = '\uFEFF<html>\r\n<body><section><p>😀&amp;甲</p><p>😀&amp;甲</p></section></body></html>\r\n'
  const path = [{ name: 'html', index: 0 }, { name: 'body', index: 1 },
    { name: 'section', index: 0 }, { name: 'p', index: 1 }]
  const result = locateHtmlSourceTarget(source, textReport(path, '😀&甲', 0), identity)
  expect(result.status).toBe('editable')
  if (result.status !== 'editable') return
  expect(source.slice(result.locator.valueSpan!.start, result.locator.valueSpan!.end)).toBe('😀&amp;甲')
  expect(result.locator.expectedRaw).toBe('😀&amp;甲')
  const changed = source.slice(0, result.locator.valueSpan!.start) + escapeHtmlText('😀<乙') + source.slice(result.locator.valueSpan!.end)
  expect(changed).toContain('<p>😀&amp;甲</p><p>😀&lt;乙</p>')
  expect(changed.startsWith('\uFEFF')).toBe(true)
  expect(changed.endsWith('\r\n')).toBe(true)
})

it('rejects ambiguous direct text and script-created reports without guessing', () => {
  const source = '<html><body><p>same<!--split-->same</p></body></html>'
  const report = textReport([{ name: 'html', index: 0 }, { name: 'body', index: 1 }, { name: 'p', index: 0 }], 'same')
  expect(locateHtmlSourceTarget(source, report, identity)).toMatchObject({ status: 'not-editable', reason: 'not-unique' })
  expect(locateHtmlSourceTarget(source, { ...report, scriptCreated: true }, identity)).toMatchObject({ status: 'not-editable', reason: 'script-created' })
  expect(locateHtmlSourceTarget(source, { ...report, rawText: 'changed' }, identity)).toMatchObject({ status: 'not-editable' })
})

it('locates image src attribute with its quote and surrounding attributes intact', () => {
  const source = '<html><body><img alt="hello" src=\'a&amp;b.png\' width="80"></body></html>'
  const report: HtmlTargetReport = { handle: 'image', kind: 'image', domPath: [{ name: 'html', index: 0 },
    { name: 'body', index: 1 }, { name: 'img', index: 0 }], sectionOrder: null,
    rawText: 'a&b.png', attributeName: 'src', rect: rectangle, scriptCreated: false }
  const result = locateHtmlSourceTarget(source, report, identity)
  expect(result.status).toBe('editable')
  if (result.status !== 'editable') return
  expect(source.slice(result.locator.valueSpan!.start, result.locator.valueSpan!.end)).toBe('a&amp;b.png')
  expect(result.locator.attributeName).toBe('src')
})

it('maps Chromium paths through explicit and implicit document wrappers', () => {
  // Paths were measured using Chromium document.children / Element.children, as the preview agent does.
  const cases = [
    { source: '<html><head><title>T</title></head><body><section><p>A</p></section></body></html>',
      path: ['html:0', 'body:1', 'section:0', 'p:0'], rawText: 'A', sectionOrder: 0 },
    { source: '<html><body><p>B</p></body></html>',
      path: ['html:0', 'body:1', 'p:0'], rawText: 'B', sectionOrder: null },
    { source: '<section><p>C</p></section>',
      path: ['html:0', 'body:1', 'section:0', 'p:0'], rawText: 'C', sectionOrder: 0 },
  ] as const
  for (const entry of cases) {
    const path = entry.path.map(step => { const [name, index] = step.split(':'); return { name: name!, index: Number(index) } })
    const result = locateHtmlSourceTarget(entry.source, textReport(path, entry.rawText, entry.sectionOrder), identity)
    expect(result.status, entry.source).toBe('editable')
    if (result.status === 'editable') expect(entry.source.slice(result.locator.valueSpan!.start, result.locator.valueSpan!.end)).toBe(entry.rawText)
  }
})

it('maps Chromium implicit tbody and explicit tbody to the exact repeated cell', () => {
  const implicit = '<table><tr><td>same</td></tr><tr><td>same</td></tr></table>'
  const implicitPath = [{ name: 'html', index: 0 }, { name: 'body', index: 1 },
    { name: 'table', index: 0 }, { name: 'tbody', index: 0 }, { name: 'tr', index: 1 }, { name: 'td', index: 0 }]
  const located = locateHtmlSourceTarget(implicit, textReport(implicitPath, 'same'), identity)
  expect(located.status).toBe('editable')
  if (located.status === 'editable') expect(located.locator.valueSpan!.start).toBe(implicit.lastIndexOf('same'))
  const explicit = '<div><table><tbody><tr><td>E</td></tr></tbody></table></div>'
  const explicitPath = [{ name: 'html', index: 0 }, { name: 'body', index: 1 }, { name: 'div', index: 0 },
    { name: 'table', index: 0 }, { name: 'tbody', index: 0 }, { name: 'tr', index: 0 }, { name: 'td', index: 0 }]
  expect(locateHtmlSourceTarget(explicit, textReport(explicitPath, 'E'), identity).status).toBe('editable')
  // A fragment containing a bare row is repaired/ignored by Chromium, so the source tree is not evidence.
  const invalid = '<tr><td>E</td></tr>'
  expect(locateHtmlSourceTarget(invalid, textReport(explicitPath.slice(0, 2).concat(explicitPath.slice(4)), 'E'), identity))
    .toMatchObject({ status: 'not-editable' })
})

it('compares browser-normalized CRLF and named entities while keeping the original span', () => {
  const source = '<p>甲\r\n&nbsp;&mdash;&copy;</p><img src="a&amp;b&nbsp;.png">'
  const path = [{ name: 'html', index: 0 }, { name: 'body', index: 1 }, { name: 'p', index: 0 }]
  const text = locateHtmlSourceTarget(source, textReport(path, '甲\n\u00a0—©'), identity)
  expect(text.status).toBe('editable')
  if (text.status === 'editable') expect(text.locator.expectedRaw).toBe('甲\r\n&nbsp;&mdash;&copy;')
  const image = locateHtmlSourceTarget(source, { ...textReport([{ name: 'html', index: 0 },
    { name: 'body', index: 1 }, { name: 'img', index: 1 }], 'a&b\u00a0.png'),
    kind: 'image', attributeName: 'src' }, identity)
  expect(image.status).toBe('editable')
  if (image.status === 'editable') expect(image.locator.expectedRaw).toBe('a&amp;b&nbsp;.png')
})

it('resolves a unique src-less image to an exact insertion tag and rejects false origin reports', () => {
  const source = '<section><img alt="待生成插图"></section>'
  const path = [{ name: 'html', index: 0 }, { name: 'body', index: 1 },
    { name: 'section', index: 0 }, { name: 'img', index: 0 }]
  const report: HtmlTargetReport = { ...textReport(path, '', 0), kind: 'image', attributeName: 'src' }
  const result = locateHtmlSourceTarget(source, report, identity)
  expect(result.status).toBe('editable')
  if (result.status === 'editable') {
    expect(result.locator.valueSpan).toBeNull()
    expect(result.locator.expectedRaw).toBe('')
    expect(source.slice(result.locator.elementSpan.start, result.locator.elementSpan.end)).toBe('<img alt="待生成插图">')
  }
  expect(locateHtmlSourceTarget(source, { ...report, scriptCreated: true }, identity))
    .toMatchObject({ status: 'not-editable', reason: 'script-created' })
  expect(locateHtmlSourceTarget(source, { ...report, rawText: 'unexpected.png' }, identity))
    .toMatchObject({ status: 'not-editable', reason: 'source-changed' })
})

it('rejects parser-repaired nesting and duplicate image attributes instead of choosing a span', () => {
  const repaired = '<p><span><div>unsafe</div></span></p>'
  const impossiblePath = [{ name: 'html', index: 0 }, { name: 'body', index: 1 },
    { name: 'p', index: 0 }, { name: 'span', index: 0 }, { name: 'div', index: 0 }]
  expect(locateHtmlSourceTarget(repaired, textReport(impossiblePath, 'unsafe'), identity))
    .toMatchObject({ status: 'not-editable', reason: 'not-unique' })
  const duplicate = '<img src="one.png" src="two.png">'
  const image: HtmlTargetReport = { ...textReport([{ name: 'html', index: 0 },
    { name: 'body', index: 1 }, { name: 'img', index: 0 }], 'one.png'),
    kind: 'image', attributeName: 'src' }
  expect(locateHtmlSourceTarget(duplicate, image, identity))
    .toMatchObject({ status: 'not-editable', reason: 'not-unique' })
})


it.each(['<svg><path d="M0 0L1 1"/></svg>', '<template><p>模板</p></template>', '<select><option>选项</option></select>', '<math><mi>x</mi></math>'])(
  'keeps exact ordinary text editable beside %s without losing child indices', sibling => {
    const source = `<html><body>${sibling}<h1>标题</h1><h1>标题</h1></body></html>`
    const path = [{ name: 'html', index: 0 }, { name: 'body', index: 1 }, { name: 'h1', index: 2 }]
    const located = locateHtmlSourceTarget(source, textReport(path, '标题'), identity)
    expect(located.status).toBe('editable')
    if (located.status === 'editable') expect(located.locator.valueSpan!.start).toBe(source.lastIndexOf('标题'))
  })
