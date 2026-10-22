import { describe, expect, it } from 'vitest'
import type { DocumentBlock } from '../../src/shared/document/content'
import { emptyDocumentResources } from '../../src/shared/document/resources'
import { alignFlowBlocks, parseFlowHtml, serializeFlowHtml, type FlowHtmlContext } from '../../src/shared/document/html'
import { parseDocumentMarkdown, serializeDocumentMarkdown, type MarkdownDocument } from '../../src/shared/document/markdown'
import { editMarkdownSource, sameMarkdownContent } from '../../src/shared/document/markdownSourceEdit'

const text = (value: string) => ({ inlines: [{ type: 'text' as const, text: value }] })
const htmlContext: FlowHtmlContext = { assets: {}, packageName: () => '',
  instanceHtml: (id, childrenHtml) => `<guoling-instance path="${id}"${childrenHtml !== undefined ? ' data-flow-layout-group="true"' : ''}>${childrenHtml ?? ''}</guoling-instance>` }
function readingGroup(): Extract<DocumentBlock, { type: 'course-instance' }> {
  return { type: 'course-instance', id: 'reading-group', blocks: [
    { type: 'heading', id: 'heading', level: 2, content: text('Original heading') },
    { type: 'paragraph', id: 'paragraph', content: text('Keep this paragraph') },
    { type: 'course-instance', id: 'photo' },
  ] }
}

describe('a Flow reading group keeps child author semantics in its source views', () => {
  it('round-trips expanded HTML through the actual reference resolver and aligns only its child edit', () => {
    const previous = readingGroup()
    const html = serializeFlowHtml({ title: 'Flow', blocks: [previous] }, htmlContext).replace('Original heading', 'Changed heading')
    const parsed = parseFlowHtml(html, { assets: {}, instanceByPath: path => ['reading-group', 'photo'].includes(path) ? path : undefined })
    const aligned = alignFlowBlocks(parsed.blocks, [previous], htmlContext)
    expect(aligned.unresolved).toEqual([])
    expect(aligned.blocks).toEqual([{ ...previous, blocks: [
      { type: 'heading', id: 'heading', level: 2, content: text('Changed heading') },
      previous.blocks![1], previous.blocks![2],
    ] }])
  })

  it('distinguishes an explicitly empty expanded group from an opaque reference', () => {
    const values: DocumentBlock[] = [{ type: 'course-instance', id: 'empty', blocks: [] }, { type: 'course-instance', id: 'opaque' }]
    const html = serializeFlowHtml({ title: 'Flow', blocks: values }, htmlContext)
    const parsed = parseFlowHtml(html, { assets: {}, instanceByPath: path => path })
    expect(parsed.blocks).toEqual(values)
  })

  it('preserves the rest of the Markdown source when editing one child inside an object fence', () => {
    const document: MarkdownDocument = { content: { blocks: [readingGroup(), { type: 'paragraph', id: 'neighbor', content: text('Do not change this neighbor') }] }, resources: emptyDocumentResources() }
    const source = serializeDocumentMarkdown(document, 'file')
    let sequence = 0
    const options = { target: 'file' as const, createId: () => `generated-${++sequence}` }
    const before = parseDocumentMarkdown(source, options)
    if (before.status !== 'valid') throw new Error('Expected valid reading-group source')
    const after = structuredClone(before.document)
    const group = after.content.blocks[0]
    if (group.type !== 'course-instance' || group.blocks?.[0].type !== 'heading') throw new Error('Expected expanded heading')
    group.blocks[0].content = text('Changed heading')
    expect(sameMarkdownContent(before.document, after)).toBe(false)
    const result = editMarkdownSource(source, before.document, after, before.sourceMap, options)
    expect(result.endsWith(source.slice(before.sourceMap.blocks[0].to))).toBe(true)
    const parsed = parseDocumentMarkdown(result, options)
    expect(parsed.status).toBe('valid')
    if (parsed.status !== 'valid') throw new Error('Expected valid changed source')
    expect(parsed.document).toEqual(after)
  })

  it('keeps a changed formal instance reference even when the title and rendered content match', () => {
    const previous: DocumentBlock = { type: 'course-instance', id: 'photo-a', title: 'Photo' }
    const next: DocumentBlock = { type: 'course-instance', id: 'photo-b', title: 'Photo' }
    const identicalView: FlowHtmlContext = { ...htmlContext, instanceHtml: () => '<div>Same visible content</div>' }
    expect(alignFlowBlocks([next], [previous], identicalView).blocks).toEqual([next])
    const beforeDocument: MarkdownDocument = { content: { blocks: [previous] }, resources: emptyDocumentResources() }
    const afterDocument: MarkdownDocument = { ...beforeDocument, content: { blocks: [next] } }
    expect(sameMarkdownContent(beforeDocument, afterDocument)).toBe(false)
    const source = serializeDocumentMarkdown(beforeDocument, 'file')
    const options = { target: 'file' as const, createId: () => 'generated' }
    const before = parseDocumentMarkdown(source, options)
    if (before.status !== 'valid') throw new Error('Expected valid formal reference source')
    const result = editMarkdownSource(source, before.document, afterDocument, before.sourceMap, { ...options, previous: before })
    const parsed = parseDocumentMarkdown(result, { ...options, previous: before })
    if (parsed.status !== 'valid') throw new Error('Expected valid changed formal reference')
    expect(parsed.document.content.blocks).toEqual([next])
  })
})
