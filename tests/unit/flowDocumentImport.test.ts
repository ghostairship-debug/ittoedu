// @vitest-environment node
import { afterEach, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { strToU8, zipSync } from 'fflate'
import { importFlowDocument } from '../../src/main/workbench/office/flowDocumentImport'
import { planFlowImport } from '../../src/renderer/project/flowImportTransaction'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { projectFlowDocument } from '../../src/core/components/document/flowDocumentProjection'
import { componentPropertiesEdits, componentPropertiesView } from '../../src/renderer/ui/properties/componentProperties'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { createTextComponentData } from '../../src/components/text/data'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) {
  if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected fixture directory')
  await fs.rm(root, { recursive: true, force: true })
} })
it('imports Word styles, headings, links, picture, list and merged table into native Flow; saves and reopens without the source directory', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flow-import-')); roots.push(root)
  const source = path.join(root, 'source'); await fs.mkdir(source)
  const png = await sharp({ create: { width: 20, height: 10, channels: 4, background: '#f3a24b' } }).png().toBuffer()
  const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main', r = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships', a = 'http://schemas.openxmlformats.org/drawingml/2006/main'
  const docx = zipSync({
    '_rels/.rels': strToU8(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="${r}/officeDocument" Target="word/document.xml"/></Relationships>`),
    'word/document.xml': strToU8(`<w:document xmlns:w="${w}" xmlns:r="${r}" xmlns:a="${a}"><w:body>
      <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>导入标题</w:t></w:r></w:p>
      <w:p><w:r><w:rPr><w:sz w:val="24"/><w:b/></w:rPr><w:t>小字</w:t></w:r><w:hyperlink r:id="link"><w:r><w:rPr><w:sz w:val="48"/></w:rPr><w:t>大字链接</w:t></w:r></w:hyperlink></w:p>
      <w:p><w:r><w:drawing><a:blip r:embed="image"/></w:drawing></w:r></w:p>
      <w:p><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>列表项</w:t></w:r></w:p>
      <w:tbl><w:tblGrid><w:gridCol/><w:gridCol/></w:tblGrid><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>合并单元格</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>甲</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>乙</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
      </w:body></w:document>`),
    'word/styles.xml': strToU8(`<w:styles xmlns:w="${w}"><w:style w:styleId="Heading1"><w:rPr><w:sz w:val="60"/><w:b/></w:rPr></w:style></w:styles>`),
    'word/numbering.xml': strToU8(`<w:numbering xmlns:w="${w}"><w:abstractNum w:abstractNumId="0"><w:lvl><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`),
    'word/_rels/document.xml.rels': strToU8(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="image" Type="${r}/image" Target="media/photo.png"/><Relationship Id="link" Type="${r}/hyperlink" Target="https://example.org/lesson" TargetMode="External"/></Relationships>`),
    'word/media/photo.png': png,
  })
  await fs.writeFile(path.join(source, 'first.docx'), docx)
  const imported = await importFlowDocument(path.join(source, 'first.docx'), docx)
  expect(imported.blocks.find(block => block.type === 'heading')).toMatchObject({ type: 'heading', level: 1, content: { inlines: [{ text: '导入标题', style: { fontSize: 40 } }] } })
  expect(imported.blocks.find(block => block.type === 'paragraph' && block.content.inlines.length === 2)).toMatchObject({ content: { inlines: [{ style: { fontSize: 16, bold: true } }, { style: { fontSize: 32 }, link: { href: 'https://example.org/lesson' } }] } })
  expect(imported.assets).toHaveLength(1); expect(imported.assets[0].asset).toMatchObject({ width: 20, height: 10 })
  expect(imported.blocks.find(block => block.type === 'list')).toMatchObject({ ordered: false })
  expect(imported.blocks.find(block => block.type === 'table')).toMatchObject({ merges: [{ columnIds: expect.any(Array), rowIds: expect.any(Array) }] })
  const host = new DocumentHostService(path.join(root, 'profile'), {})
  let snapshot = await host.internalAPI.create({ kind: 'course-v10', project: createBlankCourseProjectV10('验收'), resources: { assets: {}, components: {} } }, '验收.glx')
  const project = snapshot.model.kind === 'course-v10' ? snapshot.model.project : (() => { throw new Error('wrong model') })()
  const plan = planFlowImport(project, imported)
  const result = await host.internalAPI.dispatch({ documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision, operationId: randomUUID(), actor: 'human', mutation: { type: 'command', command: captureComponentOperation(project, plan.edits) } })
  expect(result.status).toBe('applied')
  snapshot = await host.internalAPI.save(snapshot.documentId, path.join(root, '验收.glx'))
  expect(snapshot.dirty).toBe(false)
  await host.operate({ type: 'close', documentId: snapshot.documentId })
  await fs.rename(source, path.join(root, 'source-moved'))
  const reopened = await new DocumentHostService(path.join(root, 'cold-profile'), {}).internalAPI.open(path.join(root, '验收.glx'))
  if (reopened.model.kind !== 'course-v10') throw new Error('wrong model')
  expect(projectFlowDocument(reopened.model.project, plan.surfaceId).content.blocks).toMatchObject(imported.blocks)
  expect(projectFlowDocument(reopened.model.project, plan.surfaceId).content.blocks).toHaveLength(imported.blocks.length)
  expect(reopened.model.resources.assets[imported.assets[0].asset.id]).toEqual(imported.assets[0].bytes)
  expect(reopened.model.project.surfaces).toHaveLength(2)
})
it('imports relative Markdown pictures and tables, and Chinese TXT as editable paragraphs', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flow-source-')); roots.push(root)
  const png = await sharp({ create: { width: 10, height: 8, channels: 4, background: '#ffffff' } }).png().toBuffer()
  await fs.mkdir(path.join(root, 'assets')); await fs.writeFile(path.join(root, 'assets/picture.png'), png)
  const md = await importFlowDocument(path.join(root, 'notes.md'), strToU8('# 标题\n\n![插图](assets/picture.png)\n\n|项目|数量|\n|---|---|\n|甲|2|\n'))
  expect(md.blocks.map(block => block.type)).toEqual(['heading', 'media', 'table'])
  expect(md.assets).toHaveLength(1); expect(md.issues).toEqual([])
  const txt = await importFlowDocument(path.join(root, 'notes.txt'), strToU8('中文第一段\r\n中文第二段'))
  expect(txt.blocks).toMatchObject([{ type: 'paragraph', content: { inlines: [{ text: '中文第一段' }] } }, { type: 'paragraph', content: { inlines: [{ text: '中文第二段' }] } }])
})
it('steps each actual text size rather than overwriting all runs from the appearance default', () => {
  const data = createTextComponentData(); data.appearance.fontSize = 18
  data.content.inlines = [{ type: 'text', text: '小字', style: { fontSize: 28, bold: true } }, { type: 'text', text: '大字', style: { fontSize: 40 } }, { type: 'text', text: '默认' }]
  const instance = { id: 'text', definitionId: TEXT_DEFINITION.id, data: JSON.parse(JSON.stringify(data)) }
  const edits = componentPropertiesEdits(instance, TEXT_DEFINITION, { fontSizeStep: 1 })
  expect(edits).toMatchObject([{ path: ['appearance', 'fontSize'], value: 20 }, { path: ['content', 'inlines', '0', 'style', 'fontSize'], value: 32 }, { path: ['content', 'inlines', '1', 'style', 'fontSize'], value: 44 }])
})
