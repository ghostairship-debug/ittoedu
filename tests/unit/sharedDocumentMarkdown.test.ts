import { describe, expect, it } from 'vitest'
import { parseDocumentMarkdown, serializeDocumentMarkdown } from '../../src/shared/document/markdown'
import { plainDocumentText } from '../../src/shared/document/content'
import { sharedDocumentFixture } from '../fixtures/shared-document/content'
const options = () => { let n = 0; return { createId: (kind: string) => `${kind}-${++n}` } }
describe('cw-markdown-v1', () => {
  it('round-trips full content, all styles, identities, objects and resource mappings', () => {
    const original = sharedDocumentFixture()
    const source = serializeDocumentMarkdown(original, 'file')
    const parsed = parseDocumentMarkdown(source, { ...options(), target: 'file' })
    expect(parsed.status, JSON.stringify(parsed.diagnostics)).toBe('valid')
    if (parsed.status === 'valid') expect(parsed.document).toEqual(original)
  })
  it('imports ordinary Markdown and writes stable identities for reopen', () => {
    const first = parseDocumentMarkdown('# 标题\n\n**粗体** 与 *斜体*、[链接](https://example.org)、`$代码$`。\n\n- 第一项\n- 第二项\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n', options())
    expect(first.status, JSON.stringify(first.diagnostics)).toBe('valid')
    if (first.status !== 'valid') return
    expect(first.document.content.blocks.map(b => b.type)).toEqual(['heading', 'paragraph', 'list', 'table'])
    const saved = serializeDocumentMarkdown(first.document)
    const reopened = parseDocumentMarkdown(saved, { createId: () => { throw new Error('不应重建已保存身份') } })
    expect(reopened.status, JSON.stringify(reopened.diagnostics)).toBe('valid')
    if (reopened.status === 'valid') expect(reopened.document).toEqual(first.document)
  })
  it('distinguishes literal dollars, formulas, and code, and keeps hard breaks', () => {
    const result = parseDocumentMarkdown('价格 \\$5，公式 $x^2$。  \n`$not math$`', options())
    expect(result.status, JSON.stringify(result.diagnostics)).toBe('valid')
    if (result.status !== 'valid') return
    const p = result.document.content.blocks[0]!
    if (p.type !== 'paragraph') throw new Error('paragraph')
    expect(p.content.inlines.filter(i => i.type === 'math')).toHaveLength(1)
    expect(plainDocumentText(p.content)).toContain('\n$not math$')
  })
  it.each([
    '公式 $x+1',
    '$$\nx+1',
    '<!--cw:block {"id":"p","unknown":true}-->\n内容',
    '<!--cw:block {"id":"p"}-->\n甲\n\n<!--cw:block {"id":"p"}-->\n乙',
    '[文字]{cw:css="display:none"}',
    '$x${cw:formulaId="f" cw:formulaId="g"}',
    '```cw-object-v1\n{"kind":"flow-block","block":{"id":"m","type":"media","assetId":"missing","mediaKind":"image","layout":"wide"},"resources":{"assets":[],"components":[]}}\n```',
    '<!--cw:unknown {"id":"x"}-->\n内容',
  ])('preserves invalid source and produces a diagnostic %s', source => {
    const result = parseDocumentMarkdown(source, options())
    expect(result.status).toBe('invalid')
    expect(result.source).toBe(source)
    expect(result.diagnostics[0]!.line).toBeGreaterThan(0)
  })
  it('requires real resource preparation for images', () => {
    expect(parseDocumentMarkdown('![电路](assets/circuit.png)', options()).status).toBe('invalid')
    const result = parseDocumentMarkdown('![电路](assets/circuit.png)', { ...options(), resolveImage: href => ({ assetId: 'a-circuit', source: { kind: 'relative', path: href } }) })
    expect(result.status, JSON.stringify(result.diagnostics)).toBe('valid')
  })
  it('preserves code containing brackets, multiline code atoms, and table math separators', () => {
    const original = sharedDocumentFixture()
    original.content.blocks = [
      { id: 'p', type: 'paragraph', content: { inlines: [{ type: 'text', text: ']\n$code$', code: true, style: { bold: true } }] } },
      { id: 't', type: 'table', columns: [{ id: 'c', header: { inlines: [] } }], rows: [{ id: 'r', cells: { c: { inlines: [{ type: 'math', formulaId: 'f', latex: String.raw`\left|x\right|`, accessibleText: '绝对值' }] } } }], merges: [] },
      { id: 'code', type: 'code', language: 'cw-object-v1', code: 'literal sample' },
    ]
    original.resources = { assets: [], components: [] }
    const result = parseDocumentMarkdown(serializeDocumentMarkdown(original), options())
    expect(result.status, JSON.stringify(result.diagnostics)).toBe('valid')
    if (result.status === 'valid') expect(result.document).toEqual(original)
  })
  it('distinguishes soft line breaks and explicit hard line breaks', () => {
    const result = parseDocumentMarkdown('第一行\n第二行  \n第三行', options())
    expect(result.status).toBe('valid')
    if (result.status === 'valid') expect(result.document.content.blocks[0]).toMatchObject({ content: { inlines: [{ type: 'text', text: '第一行 第二行\n第三行' }] } })
  })
  it('resolves reference-style links without losing the target', () => {
    const result = parseDocumentMarkdown('[课程][lesson]\n\n[lesson]: https://example.org "课程"', options())
    expect(result.status, JSON.stringify(result.diagnostics)).toBe('valid')
    if (result.status === 'valid') expect(result.document.content.blocks[0]).toMatchObject({ content: { inlines: [{ link: { href: 'https://example.org', title: '课程' } }] } })
  })
  it('decodes ordinary Markdown entities exactly once and preserves literal entity text', () => {
    const parsed = parseDocumentMarkdown('A &amp; B &#x1f600; &copy; `&amp;`', options())
    expect(parsed.status).toBe('valid')
    if (parsed.status !== 'valid') return
    const p = parsed.document.content.blocks[0]!
    if (p.type !== 'paragraph') throw new Error('paragraph')
    expect(plainDocumentText(p.content)).toBe('A & B 😀 © &amp;')
    p.content.inlines.push({ type: 'text', text: '&copy; literal', link: { href: 'https://example.org/?q=&copy;', title: '&copy;' } })
    const reopened = parseDocumentMarkdown(serializeDocumentMarkdown(parsed.document), options())
    expect(reopened.status).toBe('valid')
    if (reopened.status === 'valid') expect(reopened.document).toEqual(parsed.document)
  })
  it('locates an unknown formula command inside the source line', () => {
    const source = '标题\n\n公式 $x+\\unknown{1}$ 后续正文'
    const parsed = parseDocumentMarkdown(source, options())
    expect(parsed.status).toBe('invalid')
    expect(parsed.diagnostics[0]).toMatchObject({ offset: source.indexOf('\\unknown'), line: 3 })
  })
  it('maps diagnostics back to original Windows line endings', () => {
    const source = '标题\r\n\r\n公式 $x+\\unknown{1}$ 后续正文'
    const parsed = parseDocumentMarkdown(source, options())
    expect(parsed.source).toBe(source)
    expect(parsed.diagnostics[0]).toMatchObject({ offset: source.indexOf('\\unknown'), line: 3 })
  })
  it('preserves significant edge whitespace through a strict object block', () => {
    const document = { content: { blocks: [{ type: 'paragraph' as const, id: 'p', content: { inlines: [{ type: 'text' as const, text: '  前后空格  ' }] } }] }, resources: { assets: [], components: [] } }
    const parsed = parseDocumentMarkdown(serializeDocumentMarkdown(document), options())
    expect(parsed.status).toBe('valid')
    if (parsed.status === 'valid') expect(parsed.document).toEqual(document)
  })
  it.each(['```js\nunfinished', '```cw-object-v1\n{}', '<!--cw:block {"id":"p","content":{"inlines":[]}}-->\n不同正文', 'x{cw:color="#ffffff"}'])('rejects incomplete fences and shadow body fields %s', source => expect(parseDocumentMarkdown(source, options()).status).toBe('invalid'))
})
