import { expect, it, vi } from 'vitest'
import * as scanner from '../../src/shared/html/htmlSourceScanner'
import { analyzeHtmlAuthoringRecords, extractHtmlAuthoringRecords, patchHtmlAuthoringRecords, readHtmlAuthoringRecords, readHtmlFrameSources } from '../../src/shared/html/htmlAuthoringRecords'
import { htmlFrameAuthoringBootstrapSource } from '../../src/shared/html/htmlFrameAuthoring'
import { sourceEditsFromChanges } from '../../src/shared/document/sourceMerge'
import type { ComponentAuthorRecord } from '../../src/shared/contracts/component-platform/runtime'

const record: ComponentAuthorRecord = { kind: 'text', binding: { kind: 'dom',
  path: [{ tag: 'body', index: 1 }, { tag: 'p', index: 0 }], textIndex: 0, baseline: 'Original' }, overrides: { text: 'Changed' } }

it('reuses caller-owned lexical facts and retains exact source changes and unrelated author bytes', () => {
  const source = '<html><head><script>const inert="cw-html-authoring-records";</script></head><body><p>Original</p><script type="application/json">' + 'KEEP'.repeat(10_000) + '</script></body></html>'
  const prepared = scanner.scanHtmlSource(source).tokens
  const scan = vi.spyOn(scanner, 'scanHtmlSource')
  try {
    const analysis = analyzeHtmlAuthoringRecords(source, () => prepared)
    const changes: Array<{ from: number; to: number; inserted: number }> = []
    const updated = patchHtmlAuthoringRecords(source, { ...analysis.authoringRecords, field: record }, { tokens: () => prepared }, changes)
    expect(scan.mock.calls.filter(call => call[0] === source)).toHaveLength(0)
    expect(extractHtmlAuthoringRecords(updated).source).toBe(source)
    const edits = sourceEditsFromChanges(source, updated, changes)!
    expect(edits).toBeDefined()
    expect(edits.every(edit => !source.slice(edit.from, edit.to).includes('KEEP'.repeat(10)) && !edit.text.includes('KEEP'.repeat(10)))).toBe(true)
    let replayed = source
    for (const edit of [...edits].sort((a, b) => b.from - a.from)) replayed = replayed.slice(0, edit.from) + edit.text + replayed.slice(edit.to)
    expect(replayed).toBe(updated)
  } finally { scan.mockRestore() }
})

it('still upgrades old executable software while retaining frame sources on a record-only update', () => {
  const source = '<html><head></head><body><p>Original</p></body></html>'
  const sources = { 'child.html': { html: '<p>Child</p>', base: 'child.html' } }
  const saved = patchHtmlAuthoringRecords(source, { field: record }, { sources })
  const regions = scanner.indexHtmlElements(saved).elements
  let old = saved
  for (const region of regions.filter(region => ['cw-html-frame-bootstrap', 'cw-html-authoring-consumer'].includes(region.id ?? '')).sort((a, b) => b.content.start - a.content.start)) {
    old = old.slice(0, region.content.start) + 'window.oldSoftware=true;' + old.slice(region.content.end)
  }
  const tokens = scanner.scanHtmlSource(old).tokens
  const next = patchHtmlAuthoringRecords(old, { field: { ...record, overrides: { text: 'Again' } } }, { tokens: () => tokens })
  expect(readHtmlFrameSources(next)).toEqual(sources)
  expect(readHtmlAuthoringRecords(next).field.overrides.text).toBe('Again')
  const bootstrap = scanner.indexHtmlElements(next).elements.find(region => region.id === 'cw-html-frame-bootstrap')!
  expect(next.slice(bootstrap.content.start, bootstrap.content.end)).toBe(htmlFrameAuthoringBootstrapSource())
  expect(next).not.toContain('window.oldSoftware=true;')
})

it('does not let prepared tokens bypass duplicate or invalid existing metadata diagnostics', () => {
  const source = '<html><head></head><body><p>Original</p></body></html>'
  const saved = patchHtmlAuthoringRecords(source, { field: record })
  const data = scanner.indexHtmlElements(saved).elements.find(region => region.id === 'cw-html-authoring-records')!
  const duplicate = saved + saved.slice(data.full.start, data.full.end)
  expect(() => patchHtmlAuthoringRecords(duplicate, { field: record }, { tokens: () => scanner.scanHtmlSource(duplicate).tokens })).toThrow('作者数据区重复')
  const invalid = saved.slice(0, data.content.start) + '{"version":1,"records":null}' + saved.slice(data.content.end)
  expect(() => patchHtmlAuthoringRecords(invalid, { field: record }, { tokens: () => scanner.scanHtmlSource(invalid).tokens })).toThrow('作者数据区格式不完整')
})
