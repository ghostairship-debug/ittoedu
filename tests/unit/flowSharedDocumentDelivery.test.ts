import { createCourseProjectArchive, openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import { buildPublishedCourseV2Payload } from '@/renderer/export/course/buildPublishedCourse'
import { describe, expect, it } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { documentContentSchema, type FlowTextContent } from '@/shared/document/content'
import type { PublishedFlowSurface } from '@/shared/publishedCourseTypes'
import { buildFlowPrintPlan, renderFlowPrintBodyHtml } from '@/renderer/export/course/flowPrintPlan'
import { createBlankFlowCourseProject } from '@/renderer/project/createFlowCourseProject'
import { replaceFlowDocumentContent, splitFlowEditorBlock, mergeFlowEditorBlock } from '@/renderer/course/flowEditorCommands'
import { createFlowEditorHistory, commitFlowEditorHistory, undoFlowEditorHistory, redoFlowEditorHistory } from '@/renderer/course/flowEditorSlice'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import { regenerateFlowIdentities } from '../../src/core/tools/flowDocumentModel'
import { buildFlowDocxFromPlan } from '@/renderer/export/course/flowDocx'

const mixed = (id: string): FlowTextContent => ({ inlines: [
  { type: 'text', text: '前文', style: { bold: true } },
  { type: 'math', formulaId: id, latex: '\\frac{U}{R}', accessibleText: '电压除以电阻' },
  { type: 'text', text: '后文', code: true, link: { href: 'https://example.com/lesson' } },
] })
function fixture() {
  const content = documentContentSchema.parse({ blocks: [
    { id: 'heading', type: 'heading', level: 1, content: mixed('h-math') },
    { id: 'paragraph', type: 'paragraph', content: mixed('p-math') },
    { id: 'quote', type: 'quote', content: mixed('q-math'), citation: mixed('cite-math') },
    { id: 'list', type: 'list', ordered: true, items: [{ id: 'item', content: mixed('li-math') }] },
    { id: 'table', type: 'table', caption: mixed('caption-math'), columns: [{ id: 'column', header: mixed('header-math') }], rows: [{ id: 'row', cells: { column: mixed('cell-math') } }] },
    { id: 'callout', type: 'callout', tone: 'note', title: mixed('title-math'), body: mixed('body-math') },
    { id: 'section', type: 'section', title: mixed('section-math'), collapsedByDefault: false, blocks: [] },
    { id: 'formula', type: 'formula', formulaId: 'display-math', latex: '\\sqrt{x^2}', accessibleText: 'x平方的平方根' },
    { id: 'code', type: 'code', code: 'const x = 1\nconst y = 2', language: 'js' },
  ] })
  return { id: 'flow', type: 'flow', title: '混合正文', blocks: content.blocks, layout: { readingWidth: 760, wideContentWidth: 960 }, surfaceLayerItems: [] } satisfies PublishedFlowSurface
}

describe('Flow shared document delivery', () => {
  it('keeps inline math through the print plan and renders all body slots as MathML', () => {
    const plan = buildFlowPrintPlan(fixture())
    const paragraph = plan.nodes.find(node => node.type === 'paragraph')!
    expect(paragraph.type === 'paragraph' && paragraph.content.inlines[1]).toMatchObject({ type: 'math', latex: '\\frac{U}{R}' })
    const html = renderFlowPrintBodyHtml(plan)
    expect((html.match(/<mfrac>/g) ?? []).length).toBe(11)
    expect(html).toContain('<msqrt>')
    expect(html).toContain('href="https://example.com/lesson"')
    expect(html).toContain('<code>后文</code>')
    expect(html).not.toContain('[object Object]')
  })
  it('retains structured media captions even when the carrier needs a descriptive fallback', () => {
    const plan = buildFlowPrintPlan(fixture())
    const mediaPlan = { ...plan, nodes: [{ type: 'media' as const, blockId: 'audio', mediaKind: 'audio' as const, assetId: 'audio-asset', fallbackLabel: '音频', caption: mixed('audio-caption') }] }
    expect(renderFlowPrintBodyHtml(mediaPlan)).toContain('<mfrac>')
    const result = buildFlowDocxFromPlan(mediaPlan)
    const xml = strFromU8(unzipSync(result.bytes)['word/document.xml']!)
    expect(xml).toContain('<m:f>')
    expect(result.warnings).toHaveLength(1)
  })
  it('exports editable fractions in paragraphs, headers and cells without text or image math fallback', () => {
    const result = buildFlowDocxFromPlan(buildFlowPrintPlan(fixture()))
    const xml = strFromU8(unzipSync(result.bytes)['word/document.xml']!)
    expect((xml.match(/<m:f>/g) ?? []).length).toBe(11)
    expect(xml).toContain('<m:rad>')
    expect(xml).toMatch(/<w:t>前文<\/w:t>[\s\S]*?<m:f>[\s\S]*?<w:t>后文<\/w:t>/)
    expect(xml).toMatch(/<w:tc>[\s\S]*?<m:f>/)
    expect(xml).toContain('HYPERLINK')
    expect(xml).toContain('Consolas')
    expect(xml).not.toContain('[object Object]')
    expect(result.warnings).toEqual([])
  })
})


describe('Flow canonical shared document transaction', () => {
  it('rejects old content and duplicated inline identities at the real V9 boundary', () => {
    const project = createBlankFlowCourseProject({ includeDefaultController: false, controls: 'none' })
    const flow = project.surfaces.find(surface => surface.type === 'flow')!
    expect(replaceFlowDocumentContent(project, flow.id, fixture().blocks).ok).toBe(true)
    expect(courseProjectDocumentSchema.safeParse({ ...project, surfaces: [{ ...flow, blocks: [{ id: 'old', type: 'heading', level: 1, text: '旧文字' }] }] }).success).toBe(false)
    const invalid = fixture().blocks
    if (invalid[1]!.type === 'paragraph') invalid[1]!.content = mixed('h-math')
    const rejected = replaceFlowDocumentContent(project, flow.id, invalid)
    expect(rejected.ok).toBe(false)
    expect(project.revision).toBe(0)
  })
  it('splits beside a math atom, merges, copies identities and groups canonical history without absorbing undo', () => {
    const project = createBlankFlowCourseProject({ includeDefaultController: false, controls: 'none' })
    const flow = project.surfaces.find(surface => surface.type === 'flow')!
    const first = replaceFlowDocumentContent(project, flow.id, fixture().blocks).nextDocument!
    const split = splitFlowEditorBlock(first, { surfaceId: flow.id, blockId: 'paragraph', parentId: null }, 3).nextDocument!
    const splitFlow = split.surfaces.find(surface => surface.type === 'flow')!
    const left = splitFlow.blocks.find(block => block.id === 'paragraph')!
    expect(left.type === 'paragraph' && left.content.inlines.at(-1)).toMatchObject({ type: 'math', formulaId: 'p-math' })
    const right = splitFlow.blocks[splitFlow.blocks.findIndex(block => block.id === 'paragraph') + 1]!
    const merged = mergeFlowEditorBlock(split, { surfaceId: flow.id, blockId: right.id, parentId: null }).nextDocument!
    expect(merged).toBeDefined()
    const copy = regenerateFlowIdentities(left)
    expect(copy.id).not.toBe(left.id)
    expect(copy.type === 'paragraph' && copy.content.inlines[1]).not.toMatchObject({ formulaId: 'p-math' })
    let history = createFlowEditorHistory(project)
    history = commitFlowEditorHistory(history, first, 'typing')
    history = commitFlowEditorHistory(history, split, 'typing')
    expect(history.past).toHaveLength(1)
    const undone = undoFlowEditorHistory(history)
    expect(undone.present).toBe(project)
    const redone = redoFlowEditorHistory(undone)
    history = commitFlowEditorHistory(redone, merged, 'typing')
    expect(history.past).toHaveLength(2)
    const reopened = openCourseProjectArchive(createCourseProjectArchive({ project: history.present, assetFiles: {}, componentFiles: {} })).project
    expect(reopened.surfaces).toEqual(merged.surfaces)
    const published = buildPublishedCourseV2Payload({ project: reopened, assetFiles: {}, components: {} })
    const publishedFlow = published.surfaces.find(surface => surface.type === 'flow')!
    const xml = strFromU8(unzipSync(buildFlowDocxFromPlan(buildFlowPrintPlan(publishedFlow)).bytes)['word/document.xml']!)
    expect((xml.match(/<m:f>/g) ?? []).length).toBe(11)
  })
})
