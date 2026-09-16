import { describe, expect, it, vi } from 'vitest'
import { prepareDocumentClipboard, type DocumentClipboardResourcePort } from '../../src/renderer/document/documentClipboard'
import type { DocumentContent } from '../../src/shared/document/content'
import { emptyDocumentResources } from '../../src/shared/document/resources'

const text = (value: string) => ({ inlines: [{ type: 'text' as const, text: value }] })
const source = () => ({ content: { blocks: [
  { id: 'section', type: 'section', title: text('章节'), collapsedByDefault: false, blocks: [
    { id: 'list', type: 'list', ordered: true, items: [{ id: 'item', content: { inlines: [{ type: 'math', formulaId: 'math', latex: 'x^2', accessibleText: '平方' }, { type: 'text', text: '表格', link: { href: '#table' } }] } }] },
    { id: 'table', type: 'table', columns: [{ id: 'c1', header: text('一') }, { id: 'c2', header: text('二') }], rows: [{ id: 'r1', cells: { c1: text('值'), c2: text('') } }], merges: [{ rowIds: ['r1'], columnIds: ['c1', 'c2'] }] },
    { id: 'media', type: 'media', assetId: 'image', mediaKind: 'image', layout: 'content-width' },
    { id: 'component', type: 'component', component: { packageId: 'pkg', version: '1' }, props: { message: 'image' }, staticFallbackAssetId: 'image' },
  ] },
] } as DocumentContent, resources: { assets: [{ assetId: 'image', source: { kind: 'project' as const } }], components: [{ packageId: 'pkg', version: '1', source: { kind: 'project' as const } }] } })
function port(): DocumentClipboardResourcePort<string> {
  return { prepareResources: vi.fn(async () => ({ resources: { assets: [{ assetId: 'image-copy', source: { kind: 'relative' as const, path: 'assets/image.png' } }], components: [{ packageId: 'pkg-copy', version: '2', source: { kind: 'relative' as const, path: 'components/pkg.h5component' } }] }, assetIds: { image: 'image-copy' }, components: [{ from: { packageId: 'pkg', version: '1' }, to: { packageId: 'pkg-copy', version: '2' } }], prepared: 'staged' })), discard: vi.fn(async () => {}) }
}
describe('document clipboard preparation', () => {
  it('prepares resources before cloning nested identities and table references without changing either owner', async () => {
    const input = source(), before = structuredClone(input), target = emptyDocumentResources(), resourcePort = port()
    let id = 0
    const result = await prepareDocumentClipboard(input, target, resourcePort, () => `copy-${++id}`)
    const blocks = result.document.content.blocks[0]
    expect(blocks.type).toBe('section')
    if (blocks.type !== 'section') throw new Error('section')
    const [list, table, media, component] = blocks.blocks
    if (list.type !== 'list' || table.type !== 'table' || media.type !== 'media' || component.type !== 'component') throw new Error('types')
    expect(list.items[0].id).not.toBe('item')
    expect(list.items[0].content.inlines[0]).toMatchObject({ type: 'math', latex: 'x^2', accessibleText: '平方' })
    expect(list.items[0].content.inlines[0]).not.toMatchObject({ formulaId: 'math' })
    expect(list.items[0].content.inlines[1].link?.href).toBe(`#${table.id}`)
    expect(table.merges![0]).toEqual({ rowIds: [table.rows[0].id], columnIds: table.columns.map(c => c.id) })
    expect(Object.keys(table.rows[0].cells)).toEqual(table.columns.map(c => c.id))
    expect(media.assetId).toBe('image-copy')
    expect(component.component).toEqual({ packageId: 'pkg-copy', version: '2' })
    expect(component.props).toEqual({ message: 'image' })
    expect(result.prepared).toBe('staged')
    expect(input).toEqual(before); expect(target).toEqual(emptyDocumentResources()); expect(resourcePort.discard).not.toHaveBeenCalled()
  })
  it('discards staging when a resource mapping is incomplete and returns no partial body', async () => {
    const input = source(), before = structuredClone(input), resourcePort = port()
    const prepare = resourcePort.prepareResources
    resourcePort.prepareResources = async request => ({ ...await prepare(request), assetIds: {} })
    await expect(prepareDocumentClipboard(input, emptyDocumentResources(), resourcePort)).rejects.toThrow('尚未准备素材')
    expect(resourcePort.discard).toHaveBeenCalledExactlyOnceWith('staged'); expect(input).toEqual(before)
  })
  it('rejects invalid source before staging and releases staging on duplicate generated identity', async () => {
    const resourcePort = port(), input = source()
    await expect(prepareDocumentClipboard({ ...input, resources: emptyDocumentResources() }, emptyDocumentResources(), resourcePort)).rejects.toThrow('资源映射')
    expect(resourcePort.prepareResources).not.toHaveBeenCalled()
    await expect(prepareDocumentClipboard(input, emptyDocumentResources(), resourcePort, () => 'duplicate')).rejects.toThrow('重复身份')
    expect(resourcePort.discard).toHaveBeenCalledExactlyOnceWith('staged')
  })
  it('propagates failed resource preparation before allocating any content identity', async () => {
    const resourcePort = port(), input = source(), before = structuredClone(input), createId = vi.fn(() => 'unused')
    resourcePort.prepareResources = vi.fn(async () => { throw new Error('原素材文件已丢失') })
    await expect(prepareDocumentClipboard(input, emptyDocumentResources(), resourcePort, createId)).rejects.toThrow('原素材文件已丢失')
    expect(createId).not.toHaveBeenCalled(); expect(resourcePort.discard).not.toHaveBeenCalled(); expect(input).toEqual(before)
  })
})
