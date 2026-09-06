import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it, vi } from 'vitest'
import { pptxImportFixture, pptxInheritanceFixture, pptxCommonMappingFixture } from '../fixtures/pptxImport'
import { parsePptxImport } from '@/renderer/project/pptxImport'
import { planPptxImportTransaction } from '@/renderer/project/pptxImportTransaction'
import { openPptxPackage, PPTX_IMPORT_LIMITS } from '@/renderer/project/pptxPackage'
import { applyEditorTransactionStep } from '@/renderer/authoring/editorTransaction'
import * as assetManager from '@/renderer/project/assetManager'
import { parseComponentPackageFiles } from '@/renderer/components/importComponentPackage'
import { createImageNode } from '@/renderer/project/nativeNodeFactories'
import { createBlankCourseProject, createCourseProject } from '@/renderer/project/createCourseProject'
import {
  createCourseProjectArchive,
  detectCourseProjectArchiveFormat,
  inspectCourseProjectArchiveIdentity,
  openCourseProjectArchive,
  type CourseProjectArchiveData,
} from '@/renderer/project/courseProjectArchive'
import {
  shouldMarkCourseProjectDirty,
  shouldOfferCourseProjectRecovery,
} from '@/renderer/project/courseProjectLifecycle'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import { resolveNativeLinePoints } from '@/shared/nativeLineGeometry'
import { analyzeTextNodeLayout } from '@/shared/textLayout'
import { materializeNativeLayerItem } from '@/shared/courseProjectSchema'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import type { CourseProjectDocument } from '@/shared/courseProjectTypes'
import type { ComponentManifest } from '@/shared/componentTypes'
import { UserFacingError } from '@/shared/errors'
import { COURSE_PROJECT_REJECTION_INPUTS } from '../fixtures/course-project-v9'

const NOW = '2026-08-17T12:00:00.000Z'
const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/course-project-v9')
const DIAGRAM_BYTES = new Uint8Array([137, 80, 78, 71, 1, 2, 3])

describe('S2 restricted PPTX import atomic archive transaction', () => {
  it('restores inherited group text, ordinary borders, rounded/process shapes and single justified glyphs', async () => {
    const draft = await parsePptxImport(pptxCommonMappingFixture())
    expect(draft.issues.map(i => i.type)).toEqual(['边框样式', '边框样式'])
    expect(draft.issues.every(i => i.page === 1 && !i.message.startsWith('已跳过'))).toBe(true)
    const items = draft.slides[0]!.items
    expect(items).toHaveLength(6)
    expect(items[0]).toMatchObject({ frame: { x: 100, y: 100, width: 180, height: 30 }, content: { data: { text: '树状图', style: { fontSize: 18, color: '#123456' } } } })
    expect(items[1]).toMatchObject({ content: { data: { style: { borderWidth: 2, lineStyle: 'dashed' } } } })
    expect(items[2]).toMatchObject({ content: { data: { text: 'A', style: { align: 'left', fontSize: 18 } } } })
    expect(items[3]!.frame.height).toBeCloseTo(6.4999475)
    expect(items[4]).toMatchObject({ content: { data: { shapeType: 'rounded-rectangle', style: { cornerRadius: 25, lineStyle: 'dotted' } } } })
    expect(items[5]).toMatchObject({ content: { data: { shapeType: 'rectangle' } } })
    const project = planPptxImportTransaction(createBlankCourseProject(), draft, '普通映射').nextDocument
    expect(openCourseProjectArchive(createCourseProjectArchive({ project, assetFiles: {}, componentFiles: {} })).project).toEqual(project)
  })
  it('still reports multi-character justified paragraphs and unknown shape adjustments', async () => {
    const files = unzipSync(pptxCommonMappingFixture())
    files['ppt/slides/slide1.xml'] = strToU8(strFromU8(files['ppt/slides/slide1.xml']!).replace('<a:t>A</a:t>', '<a:t>AB</a:t>').replace('val 25000', '*/ w 1 2'))
    const draft = await parsePptxImport(zipSync(files))
    expect(draft.issues.map(i => i.type)).toEqual(['边框样式', '段落对齐', '自定义形状参数'])
    expect(draft.slides[0]!.items).toHaveLength(4)
  })
  it('identifies legacy equations separately from unsupported charts before partial import', async () => {
    const files = unzipSync(pptxImportFixture({ unsupported: true }))
    files['ppt/slides/slide1.xml'] = strToU8(strFromU8(files['ppt/slides/slide1.xml']!).replace('<p:graphicFrame/>', '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="9" name="公式1"/></p:nvGraphicFramePr><a:graphic><a:graphicData><p:oleObj progId="Equation.3"/></a:graphicData></a:graphic></p:graphicFrame>'))
    const draft = await parsePptxImport(zipSync(files))
    expect(draft.issues).toEqual([{ page: 1, type: '旧版公式（OLE）', message: '已跳过“公式1”：尚未支持转换为可编辑内容，可在源软件另存图片后补入' }])
    expect(draft.slides[0]!.items).toHaveLength(2)
  })
  it('honors source no-wrap auto-fit without clipping ordinary question text or enlarging fixed frames', async () => {
    const files = unzipSync(pptxCommonMappingFixture())
    files['ppt/slides/slide1.xml'] = strToU8(strFromU8(files['ppt/slides/slide1.xml']!).replace(/<p:sp>[\s\S]*?<\/p:sp>/g, object => object.includes('小文字框') ? object.replace('<a:bodyPr/>', '<a:bodyPr wrap="none"><a:spAutoFit/></a:bodyPr>').replace('<a:t>小尺寸</a:t>', '<a:t>写出三次传球的所有可能结果（即传球的方式）；</a:t>') : object))
    const draft = await parsePptxImport(zipSync(files))
    const item = draft.slides[0]!.items.find(i => i.label === '小文字框 文字')!
    if (item.kind !== 'native') throw new Error('native missing')
    const node = materializeNativeLayerItem(item)
    if (node.type !== 'text') throw new Error('text missing')
    expect(node.width).toBeGreaterThan(200)
    expect(analyzeTextNodeLayout(node).overflowsHeight).toBe(false)
    expect(node.text).toBe('写出三次传球的所有可能结果（即传球的方式）；')
    expect(draft.issues).toContainEqual(expect.objectContaining({ type: '文字自动扩框', page: 1 }))
    const fixed = (await parsePptxImport(pptxCommonMappingFixture())).slides[0]!.items.find(i => i.label === '小文字框 文字')!
    expect(fixed.frame.height).toBeCloseTo(6.4999475)
  })
  it('keeps interleaved layout decoration shared, resolves page placeholders and imports editable table data in one archive transaction', async () => {
    const draft = await parsePptxImport(await pptxInheritanceFixture())
    expect(draft.slides).toHaveLength(4)
    expect(draft.shared).toHaveLength(4)
    expect(draft.slides.map(s => s.sharedKeys?.length)).toEqual([2, 2, 2, 0])
    expect(draft.slides[0]!.sharedKeys).toEqual(draft.slides[2]!.sharedKeys)
    for (const [index, slide] of draft.slides.entries()) {
      expect(slide.items[0]).toMatchObject({ frame: { x: 96, y: 48, width: 1056, height: 96 }, content: { nativeType: 'text', data: { text: `第${index + 1}页标题`, style: { fontSize: 40 } } } })
      expect(slide.items.some(i => i.label === '装饰A' || i.label === '装饰B')).toBe(false)
    }
    const table = draft.slides[0]!.items.find(i => i.kind === 'native' && i.content.nativeType === 'table')!
    if (table.kind !== 'native' || table.content.nativeType !== 'table') throw new Error('table')
    expect(table.content.data.rows.map(row => row.cells.map(c => c.text))).toEqual([['分数', '含义'], ['1/2', '平均分成两份，取一份']])
    expect(table.content.data.columns.map(c => c.width)).toEqual([288, 672])
    expect(draft.issues.every(i => i.type === '表格样式')).toBe(true)
    const project = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
    const step = planPptxImportTransaction(project, draft, '继承课件')
    const initial = { document: project, resources: { assetFiles: {}, componentPackages: {} } }
    const applied = applyEditorTransactionStep(initial, step, 'forward')
    const surface = applied.document.surfaces.at(-1)!
    expect(surface.surfaceLayerItems).toHaveLength(4)
    expect(surface.surfaceLayerItems.map(e => e.visibility.locationIds.length)).toEqual([2, 2, 1, 1])
    expect(applied.document.surfaces[0]).toEqual(project.surfaces[0])
    expect(applied.document.globalLayerItems).toEqual(project.globalLayerItems)
    expect(applied.document.revision).toBe(project.revision + 1)
    courseProjectDocumentSchema.parse(applied.document)
    const reopened = openCourseProjectArchive(createCourseProjectArchive({ project: applied.document, assetFiles: {}, componentFiles: {} }))
    expect(reopened.project).toEqual(applied.document)
    expect(applyEditorTransactionStep(applied, step, 'inverse')).toEqual(initial)
  })
  it('expands nested ordinary group transforms and keeps source order', async () => {
    const files = unzipSync(pptxImportFixture())
    let xml = strFromU8(files['ppt/slides/slide1.xml']!)
    const group = (body: string) => `<p:grpSp><p:nvGrpSpPr/><p:grpSpPr><a:xfrm><a:off x="952500" y="952500"/><a:ext cx="12192000" cy="6858000"/><a:chOff x="0" y="0"/><a:chExt cx="6096000" cy="3429000"/></a:xfrm></p:grpSpPr>${body}</p:grpSp>`
    xml = xml.replace(/<p:sp>[\s\S]*?<\/p:sp>/g, object => object.includes('基础图形') ? group(group(object)) : object)
    files['ppt/slides/slide1.xml'] = strToU8(xml)
    const draft = await parsePptxImport(zipSync(files))
    expect(draft.issues).toEqual([])
    expect(draft.slides[0]!.items).toHaveLength(2)
    expect(draft.slides[0]!.items[1]).toMatchObject({ frame: { x: 700, y: 1700, width: 800, height: 800 }, content: { nativeType: 'shape' } })
  })
  it('retains supported picture crop in native image data and archive', async () => {
    const files = unzipSync(pptxImportFixture({ image: true }))
    files['ppt/slides/slide1.xml'] = strToU8(strFromU8(files['ppt/slides/slide1.xml']!).replace('<a:stretch>', '<a:srcRect l="10000" t="20000" r="15000" b="5000"/><a:stretch>'))
    const decoder = vi.spyOn(assetManager, 'readImageDimensions').mockResolvedValue({ width: 200, height: 200 })
    try {
      const draft = await parsePptxImport(zipSync(files))
      expect(draft.issues).toEqual([])
      expect(draft.slides[0]!.items[2]).toMatchObject({ content: { nativeType: 'image', data: { crop: { left: 0.1, top: 0.2, right: 0.15, bottom: 0.05 } } } })
      courseProjectDocumentSchema.parse(planPptxImportTransaction(createBlankCourseProject(), draft, '裁剪').nextDocument)
    } finally { decoder.mockRestore() }
  })
  it('reports merged tables instead of silently changing the cell structure', async () => {
    const files = unzipSync(await pptxInheritanceFixture())
    files['ppt/slides/slide1.xml'] = strToU8(strFromU8(files['ppt/slides/slide1.xml']!).replace('<a:tc>', '<a:tc gridSpan="2">'))
    const draft = await parsePptxImport(zipSync(files))
    expect(draft.issues).toContainEqual(expect.objectContaining({ page: 1, type: '合并表格' }))
    expect(draft.slides[0]!.items.every(i => i.kind !== 'native' || i.content.nativeType !== 'table')).toBe(true)
    expect(draft.slides[0]!.items).toHaveLength(2)
  })
  it('imports real PPTX horizontal, vertical and flipped arrow lines as editable line geometry', async () => {
    const { default: PptxGenJS } = await import('pptxgenjs')
    const pptx = new PptxGenJS()
    pptx.layout = 'LAYOUT_WIDE'
    const slide = pptx.addSlide()
    slide.addShape(pptx.ShapeType.line, { x: 1, y: 1, w: 4, h: 0, line: { color: '2563EB', width: 2, endArrowType: 'triangle' } })
    slide.addShape(pptx.ShapeType.line, { x: 1, y: 2, w: 0, h: 3, line: { color: '000000', width: 1, dashType: 'dash' } })
    slide.addShape(pptx.ShapeType.line, { x: 3, y: 2, w: 3, h: 2, flipH: true, line: { color: 'FF0000', width: 2, beginArrowType: 'oval', endArrowType: 'stealth' } })
    const draft = await parsePptxImport(await pptx.write({ outputType: 'uint8array' }) as Uint8Array)
    expect(draft.issues).toEqual([])
    expect(draft.slides[0]!.items).toHaveLength(3)
    const [horizontal, vertical, flipped] = draft.slides[0]!.items
    expect(horizontal).toMatchObject({ content: { nativeType: 'shape', data: { shapeType: 'line', style: { endArrow: 'triangle' } } } })
    expect(vertical).toMatchObject({ content: { data: { style: { lineStyle: 'dashed' } } } })
    expect(flipped).toMatchObject({ content: { data: { style: { startArrow: 'circle', endArrow: 'stealth' } } } })
    const expectedPoints = [[[96, 96], [480, 96]], [[96, 192], [96, 480]], [[576, 192], [288, 384]]]
    for (const [index, item] of draft.slides[0]!.items.entries()) {
      if (item.kind !== 'native' || item.content.nativeType !== 'shape') throw new Error('line')
      const points = resolveNativeLinePoints(item.content.data.lineGeometry, item.frame.width, item.frame.height)
      for (const [pointIndex, point] of points.entries()) {
        expect(item.frame.x + point.x).toBeCloseTo(expectedPoints[index]![pointIndex]![0]!)
        expect(item.frame.y + point.y).toBeCloseTo(expectedPoints[index]![pointIndex]![1]!)
      }
      expect(Math.min(item.frame.width, item.frame.height)).toBeGreaterThan(item.content.data.style.borderWidth)
    }
    courseProjectDocumentSchema.parse(planPptxImportTransaction(createBlankCourseProject(), draft, '线条').nextDocument)
  })
  it('imports an adjusted flipped elbow connector without changing its bend or direction', async () => {
    const files = unzipSync(pptxImportFixture())
    const connector = '<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="8" name="折线箭头"/></p:nvCxnSpPr><p:spPr><a:xfrm flipH="true"><a:off x="952500" y="952500"/><a:ext cx="3810000" cy="1905000"/></a:xfrm><a:prstGeom prst="bentConnector3"><a:avLst><a:gd name="adj1" fmla="val 25000"/></a:avLst></a:prstGeom><a:ln w="19050"><a:solidFill><a:srgbClr val="2563EB"/></a:solidFill><a:tailEnd type="triangle"/></a:ln></p:spPr></p:cxnSp>'
    files['ppt/slides/slide1.xml'] = strToU8(strFromU8(files['ppt/slides/slide1.xml']!).replace('</p:spTree>', connector + '</p:spTree>'))
    const draft = await parsePptxImport(zipSync(files))
    expect(draft.issues).toEqual([])
    const item = draft.slides[0]!.items[2]!
    expect(item).toMatchObject({ content: { data: { shapeType: 'elbow-arrow', lineGeometry: { kind: 'elbow' }, style: { endArrow: 'triangle' } } } })
    if (item.kind !== 'native' || item.content.nativeType !== 'shape') throw new Error('elbow')
    const points = resolveNativeLinePoints(item.content.data.lineGeometry, item.frame.width, item.frame.height)
    expect(points.map(p => [Math.round(item.frame.x + p.x), Math.round(item.frame.y + p.y)])).toEqual([[500, 100], [400, 100], [400, 300], [100, 300]])
  })
  it('reads a normal PresentationML archive emitted by PptxGenJS as editable pages', async () => {
    const { default: PptxGenJS } = await import('pptxgenjs')
    const pptx = new PptxGenJS()
    pptx.layout = 'LAYOUT_WIDE'
    for (const title of ['第一课', '第二课']) {
      const slide = pptx.addSlide()
      slide.addText(title, { x: 1, y: 1, w: 8, h: 1, fontSize: 28, fontFace: 'Arial', color: '123456' })
      slide.addShape(pptx.ShapeType.rect, { x: 1, y: 3, w: 3, h: 2, fill: { color: '2563EB' }, line: { color: '2563EB' } })
    }
    const bytes = await pptx.write({ outputType: 'uint8array' }) as Uint8Array
    const draft = await parsePptxImport(bytes)
    expect(draft.slides).toHaveLength(2)
    expect(draft.slides.map(s => s.items.filter(i => i.kind === 'native' && i.content.nativeType === 'text').length)).toEqual([1, 1])
    const project = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
    expect(planPptxImportTransaction(project, draft, '正常 PPTX').nextDocument.locations).toHaveLength(3)
  })
  it('imports editable text, shape and media with one revision, reversible sidecar and archive reopen', async () => {
    // Browser decoding is covered by the real-host test; this unit targets XML and atomic archive semantics.
    const decoder = vi.spyOn(assetManager, 'readImageDimensions').mockResolvedValue({ width: 1, height: 1 })
    try {
      const draft = await parsePptxImport(pptxImportFixture({ image: true, unsupported: true }))
      expect(draft.issues).toEqual([expect.objectContaining({ page: 1, type: 'graphicFrame' })])
      expect(draft.slides[0]!.items.map(i => i.kind === 'native' && i.content.nativeType)).toEqual(['text', 'shape', 'image'])
      const text = draft.slides[0]!.items[0]!
      if (text.kind !== 'native' || text.content.nativeType !== 'text') throw new Error('text')
      expect(text.content.data.text).toBe('知识 😀')
      expect(text.content.data.runs[0]!.end).toBe(4)
      expect(text.frame).toMatchObject({ x: 100, y: 100, width: 1000, height: 200 })
      const project = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
      const original = structuredClone(project)
      const step = planPptxImportTransaction(project, draft, '导入课件')
      const initial = { document: project, resources: { assetFiles: {}, componentPackages: {} } }
      const applied = applyEditorTransactionStep(initial, step, 'forward')
      expect(applied.document.revision).toBe(project.revision + 1)
      expect(applied.document.locations).toHaveLength(project.locations.length + 1)
      expect(Object.keys(applied.resources.assetFiles)).toHaveLength(1)
      courseProjectDocumentSchema.parse(applied.document)
      const reopened = openCourseProjectArchive(createCourseProjectArchive({ project: applied.document, assetFiles: applied.resources.assetFiles, componentFiles: {} }))
      expect(reopened.project).toEqual(applied.document)
      expect(reopened.assetFiles).toEqual(applied.resources.assetFiles)
      expect(applyEditorTransactionStep(applied, step, 'inverse')).toEqual(initial)
      expect(project).toEqual(original)

      for (const fault of ['document', 'sidecar']) {
        let current = initial
        const broken = fault === 'document' ? { ...step, get nextDocument(): typeof project { throw new Error('document rejected') } }
          : { ...step, resourceChanges: { assetFileChanges: [{ assetId: 'fault', get after(): Uint8Array { throw new Error('sidecar rejected') } }] } }
        expect(() => { current = applyEditorTransactionStep(current, broken, 'forward') }).toThrow('rejected')
        expect(current).toBe(initial)
        expect(current.document).toEqual(original)
        expect(current.resources.assetFiles).toEqual({})
      }
    } finally { decoder.mockRestore() }
  })
  it('rejects unreadable archives and resource excess but reports unsupported objects alongside retained content', async () => {
    expect(() => openPptxPackage(new Uint8Array(PPTX_IMPORT_LIMITS.fileBytes + 1))).toThrow('文件大小')
    expect(() => openPptxPackage(zipSync({ 'bomb.xml': new Uint8Array(2_000_000) }))).toThrow('解压比')
    await expect(parsePptxImport(pptxImportFixture({ brokenRelationship: true }))).rejects.toThrow('第 1 页：损坏关系')
    const partial = await parsePptxImport(pptxImportFixture({ unsupported: true }))
    expect(partial.slides[0]!.items).toHaveLength(2)
    expect(partial.issues).toEqual([expect.objectContaining({ page: 1, type: 'graphicFrame', message: expect.stringContaining('已跳过') })])
    for (const [from, to, reason] of [
      ['<a:xfrm>', '<a:xfrm flipH="true">', '翻转'],
      ['<a:rPr sz="3200"', '<a:rPr baseline="2000" sz="3200"', '文字效果'],
      ['<a:srgbClr val="123456"/>', '<a:srgbClr val="123456"><a:alpha val="50000"/></a:srgbClr>', '文字透明度'],
    ]) {
      const files = unzipSync(pptxImportFixture())
      files['ppt/slides/slide1.xml'] = strToU8(strFromU8(files['ppt/slides/slide1.xml']!).replace(from!, to!))
      const draft = await parsePptxImport(zipSync(files))
      expect(draft.slides[0]!.items).toHaveLength(1)
      expect(draft.issues).toEqual([expect.objectContaining({ page: 1, type: reason })])
    }
  })
  it('retains static content with warnings for animation, hyperlinks, shadow and unsupported background', async () => {
    const files = unzipSync(pptxImportFixture())
    files['ppt/slides/slide1.xml'] = strToU8(strFromU8(files['ppt/slides/slide1.xml']!)
      .replace('<p:cNvPr id="2" name="课题"/>', '<p:cNvPr id="2" name="课题"><a:hlinkClick r:id="web"/></p:cNvPr>')
      .replace('</p:sld>', '<p:timing/></p:sld>')
      .replace('<a:prstGeom prst="ellipse"/>', '<a:prstGeom prst="ellipse"/><a:effectLst><a:outerShdw/></a:effectLst>')
      .replace('<a:solidFill><a:srgbClr val="F0F5FF"/></a:solidFill>', '<a:gradFill/>'))
    const draft = await parsePptxImport(zipSync(files))
    expect(draft.slides[0]!.items).toHaveLength(2)
    expect(draft.slides[0]!.backgroundColor).toBe('#ffffff')
    expect(draft.issues.map(issue => issue.type)).toEqual(expect.arrayContaining(['动画', '超链接', '视觉效果', '背景']))
  })
  it('isolates broken media and pages and keeps source page numbers in reports', async () => {
    const files = unzipSync(pptxImportFixture({ image: true }))
    delete files['ppt/media/image.png']
    files['ppt/presentation.xml'] = strToU8(strFromU8(files['ppt/presentation.xml']!).replace('<p:sldId id="256"', '<p:sldId id="257" r:id="missing"/><p:sldId id="256"'))
    const decoder = vi.spyOn(assetManager, 'readImageDimensions').mockRejectedValue(new Error('图片无法解码'))
    try {
      const draft = await parsePptxImport(zipSync(files))
      expect(draft.slides).toHaveLength(1)
      expect(draft.slides[0]!.items).toHaveLength(2)
      expect(draft.assets).toHaveLength(0)
      expect(draft.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ page: 1, message: expect.stringContaining('已跳过页面') }),
        expect.objectContaining({ page: 2, message: expect.stringContaining('已跳过“图片”') }),
      ]))
    } finally { decoder.mockRestore() }
  })
  it('does not keep a half-converted shape/text object and refuses an entirely empty result', async () => {
    const files = unzipSync(pptxImportFixture())
    files['ppt/slides/slide1.xml'] = strToU8(strFromU8(files['ppt/slides/slide1.xml']!)
      .replace('<a:noFill/>', '<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>')
      .replace('<a:rPr sz="3200"', '<a:rPr baseline="2000" sz="3200"'))
    const draft = await parsePptxImport(zipSync(files))
    expect(draft.slides[0]!.items).toHaveLength(1)
    expect(draft.slides[0]!.items[0]).toMatchObject({ kind: 'native', content: { nativeType: 'shape', data: { shapeType: 'ellipse' } } })
    files['ppt/slides/slide1.xml'] = strToU8(strFromU8(files['ppt/slides/slide1.xml']!).replace(/<p:sp>[\s\S]*?<\/p:sp>/g, '<p:graphicFrame/>'))
    await expect(parsePptxImport(zipSync(files))).rejects.toThrow('无可导入内容')
  })
})

function makeComponentFiles(): Record<string, Uint8Array> {
  const manifest: ComponentManifest = {
    schemaVersion: 4,
    runtimeApiVersion: 4,
    renderMode: 'phaser',
    supportedScopes: ['scene', 'global'],
    id: 'com.example.archive-chart',
    name: '归档图表',
    version: '1.2.3',
    entry: 'runtime.js',
    thumbnail: 'thumbnail.png',
    defaultSize: { width: 480, height: 280 },
    minSize: { width: 160, height: 100 },
    preserveAspectRatio: true,
    assets: {},
    defaultProps: { value: 1 },
  }
  return {
    'manifest.json': strToU8(JSON.stringify(manifest)),
    'runtime.js': strToU8(
      "window.CoursewareComponent.define({id:'com.example.archive-chart',runtimeApiVersion:4,create:function(){return {destroy:function(){}}}})",
    ),
    'thumbnail.png': new Uint8Array([137, 80, 78, 71]),
  }
}

function makeV8ArchiveBytes() {
  return COURSE_PROJECT_REJECTION_INPUTS['v8-unsupported']
}

function attachComponent(data: CourseProjectArchiveData): CourseProjectArchiveData {
  const packageFiles = makeComponentFiles()
  const component = parseComponentPackageFiles(packageFiles)
  const project = structuredClone(data.project)
  project.componentPackages[component.metadata.packageId] = component.metadata
  return {
    project: courseProjectDocumentSchema.parse(project),
    assetFiles: data.assetFiles,
    componentFiles: { [component.key]: packageFiles },
  }
}

function loadSlideNativeFixture(): CourseProjectArchiveData {
  const project = courseProjectDocumentSchema.parse(
    JSON.parse(readFileSync(join(FIXTURE_DIR, 'slide-native.json'), 'utf8')),
  ) as CourseProjectDocument
  return attachComponent({
    project,
    assetFiles: { diagram: DIAGRAM_BYTES },
    componentFiles: {},
  })
}

function makeBlankV9ArchiveData(): CourseProjectArchiveData {
  const project = createBlankCourseProject({
    id: 'v9-blank-archive',
    title: '空白 V9 归档',
    now: NOW,
    includeDefaultController: false,
    controls: 'none',
  })
  const surface = project.surfaces[0]
  if (!surface || surface.type !== 'slide') throw new Error('expected slide surface')
  const scene = surface.scenes[0]!
  scene.layerItems.push(sceneNodeToCourseLayerItem(createImageNode({
    id: 'image_node',
    assetId: 'diagram',
    width: 200,
    height: 200,
  }), 0))
  project.assets.diagram = {
    id: 'diagram',
    filename: 'diagram.png',
    mimeType: 'image/png',
    kind: 'image',
    path: 'assets/diagram.bin',
    byteLength: DIAGRAM_BYTES.byteLength,
    width: 2,
    height: 2,
  }
  return attachComponent({
    project: courseProjectDocumentSchema.parse(project),
    assetFiles: { diagram: DIAGRAM_BYTES },
    componentFiles: {},
  })
}

describe('Course Project V9 archive', () => {
  it('round-trips schema, asset bytes and embedded component files from a V9 fixture', () => {
    const data = loadSlideNativeFixture()
    const bytes = createCourseProjectArchive(data, { mtime: NOW })
    const reopened = openCourseProjectArchive(bytes)

    expect(courseProjectDocumentSchema.parse(reopened.project)).toEqual(data.project)
    expect(reopened.project.schemaVersion).toBe(9)
    expect('scenes' in reopened.project).toBe(false)
    expect([...reopened.assetFiles.diagram!]).toEqual([...DIAGRAM_BYTES])
    const componentKey = Object.keys(data.componentFiles)[0]!
    expect(Object.keys(reopened.componentFiles[componentKey]!).sort()).toEqual(
      Object.keys(data.componentFiles[componentKey]!).sort(),
    )
    expect([...reopened.componentFiles[componentKey]!['runtime.js']!]).toEqual(
      [...data.componentFiles[componentKey]!['runtime.js']!],
    )
    expect(createCourseProjectArchive(reopened, { mtime: NOW })).toEqual(bytes)
    expect(inspectCourseProjectArchiveIdentity(bytes)).toMatchObject({
      schemaVersion: 9,
      projectId: 'v9-slide-native',
      title: 'V9 原生幻灯',
    })
  })

  it('round-trips a blank V9 factory document with save/reopen', () => {
    const data = makeBlankV9ArchiveData()
    const bytes = createCourseProjectArchive(data, { mtime: NOW })
    const reopened = openCourseProjectArchive(bytes)
    expect(reopened.project.schemaVersion).toBe(9)
    expect(reopened.project.id).toBe('v9-blank-archive')
    expect([...reopened.assetFiles.diagram!]).toEqual([...DIAGRAM_BYTES])
    expect(createCourseProjectArchive(reopened, { mtime: NOW })).toEqual(bytes)
  })

  it('opens schemaVersion 9, rejects other integer versions, and treats missing versions as corrupted', () => {
    const v8Bytes = makeV8ArchiveBytes()
    const v9Bytes = createCourseProjectArchive(loadSlideNativeFixture(), { mtime: NOW })

    expect(detectCourseProjectArchiveFormat(v8Bytes)).toMatchObject({
      kind: 'unsupported',
      identity: { schemaVersion: 8, projectId: 'v8-rejection' },
    })
    expect(detectCourseProjectArchiveFormat(v9Bytes)).toMatchObject({
      kind: 'v9',
      identity: { schemaVersion: 9, projectId: 'v9-slide-native' },
    })
    expect(detectCourseProjectArchiveFormat(new Uint8Array([1, 2, 3, 4]))).toMatchObject({
      kind: 'corrupted',
    })
    expect(detectCourseProjectArchiveFormat(new Uint8Array())).toMatchObject({
      kind: 'corrupted',
      reason: expect.stringMatching(/空/),
    })

    const unsupported = zipSync({
      'project.json': strToU8(JSON.stringify({
        schemaVersion: 10,
        id: 'future',
        title: '不支持',
      })),
    })
    expect(detectCourseProjectArchiveFormat(unsupported)).toMatchObject({
      kind: 'unsupported',
      identity: { schemaVersion: 10, projectId: 'future' },
    })
    expect(() => openCourseProjectArchive(unsupported)).toThrow(/版本不支持|格式版本为 10/)

    expect(() => openCourseProjectArchive(v8Bytes)).toThrow(/版本不支持|格式版本为 8/)
    expect(() => openCourseProjectArchive(v8Bytes)).toThrow(UserFacingError)
    expect(() => {
      try {
        openCourseProjectArchive(v8Bytes)
      } catch (error) {
        expect(error).toBeInstanceOf(UserFacingError)
        expect(String(error)).not.toMatch(
          new RegExp(`${['导入', '旧版', '工程'].join('')}|显式迁移`),
        )
        throw error
      }
    }).toThrow(UserFacingError)

    expect(() => openCourseProjectArchive(v9Bytes)).not.toThrow()

    const missingAsset = unzipSync(v9Bytes)
    delete missingAsset['assets/diagram.bin']
    expect(() => openCourseProjectArchive(zipSync(missingAsset))).toThrow(/缺少素材/)

    const unversionedV9Shape = zipSync({
      'project.json': strToU8(JSON.stringify({
        id: 'unversioned-v9',
        title: '缺版本',
        locations: [],
        surfaces: [],
      })),
    })
    expect(detectCourseProjectArchiveFormat(unversionedV9Shape)).toMatchObject({
      kind: 'corrupted',
      identity: { schemaVersion: null },
    })
    expect(() => openCourseProjectArchive(unversionedV9Shape)).toThrow(/损坏|schemaVersion/)

    const unversionedV8Shape = zipSync({
      'project.json': strToU8(JSON.stringify({
        id: 'unversioned-v8',
        title: '缺版本',
        scenes: [],
      })),
    })
    expect(detectCourseProjectArchiveFormat(unversionedV8Shape)).toMatchObject({
      kind: 'corrupted',
      identity: { schemaVersion: null },
    })

    expect(shouldMarkCourseProjectDirty('document')).toBe(true)
    expect(shouldMarkCourseProjectDirty('selection')).toBe(false)
    expect(shouldOfferCourseProjectRecovery({
      recovery: {
        schemaVersion: 8,
        projectId: 'legacy-archive',
        revision: 0,
        updatedAt: null,
        title: null,
      },
      official: null,
    })).toBe('ignore-legacy-default')
    expect(shouldOfferCourseProjectRecovery({
      recovery: inspectCourseProjectArchiveIdentity(v9Bytes),
      official: null,
    })).toBe('offer')
  })

  it('writes only portable relative archive paths and no local absolute path', () => {
    const bytes = createCourseProjectArchive(makeBlankV9ArchiveData(), { mtime: NOW })
    const files = unzipSync(bytes)
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining([
        'project.json',
        'assets/diagram.bin',
        'components/com.example.archive-chart@1.2.3/manifest.json',
        'components/com.example.archive-chart@1.2.3/runtime.js',
      ]),
    )
    for (const path of Object.keys(files)) {
      expect(path).not.toMatch(/^(?:[a-zA-Z]:|\/|\\\\)/)
      expect(path.split('/')).not.toContain('..')
    }
    expect(strFromU8(files['project.json']!)).not.toContain('C:\\')
  })

  it.each(['../outside.txt', 'assets/../../outside.txt', 'C:/outside.txt', '\\\\host\\x'])(
    'rejects an unsafe ZIP entry before reading content: %s',
    (unsafePath) => {
      const validBytes = createCourseProjectArchive(makeBlankV9ArchiveData(), { mtime: NOW })
      const files = unzipSync(validBytes)
      files[unsafePath] = new Uint8Array([1])
      const malicious = zipSync(files)

      expect(() => openCourseProjectArchive(malicious)).toThrow(UserFacingError)
      try {
        openCourseProjectArchive(malicious)
      } catch (error) {
        expect(error).toBeInstanceOf(UserFacingError)
        expect((error as UserFacingError).message).toMatch(/不安全|路径穿越|无效路径/)
      }
    },
  )

  it('rejects missing declared binary files on save', () => {
    const source = makeBlankV9ArchiveData()
    delete source.assetFiles.diagram
    expect(() => createCourseProjectArchive(source)).toThrowError(
      expect.objectContaining({
        title: '课程工程保存失败',
        message: expect.stringContaining('缺少二进制内容'),
      }),
    )
  })

  it('round-trips scene.go targetStateId and rejects a missing presentation background asset', () => {
    const source = makeBlankV9ArchiveData()
    const surface = source.project.surfaces[0]
    if (!surface || surface.type !== 'slide') throw new Error('expected slide surface')
    const firstScene = surface.scenes[0]!
    surface.scenes.push({
      id: 'scene_target',
      name: '目标场景',
      backgroundColor: '#ffffff',
      backgroundAssetId: null,
      layerItems: [],
      presentation: {
        initialStateId: 'state_detail',
        states: [{ id: 'state_detail', name: '详情', layerItemOverrides: {} }],
      },
      interactions: [],
    })
    source.project.locations.push({
      id: 'location-target',
      label: '目标场景',
      kind: 'slide-scene',
      surfaceId: surface.id,
      sceneId: 'scene_target',
    })
    firstScene.interactions.push({
      id: 'go_to_detail',
      enabled: true,
      trigger: { type: 'scene.enter' },
      conditions: [],
      actions: [{
        id: 'go_to_detail_action',
        start: 'after-previous',
        delayMs: 0,
        action: {
          type: 'scene.go',
          sceneId: 'scene_target',
          targetStateId: 'state_detail',
        },
      }],
    })

    const restored = openCourseProjectArchive(createCourseProjectArchive(source, { mtime: NOW }))
    expect(restored.project.surfaces[0]).toMatchObject({
      type: 'slide',
      scenes: [
        {
          interactions: [{
            actions: [{
              id: 'go_to_detail_action',
              start: 'after-previous',
              delayMs: 0,
              action: {
                type: 'scene.go',
                sceneId: 'scene_target',
                targetStateId: 'state_detail',
              },
            }],
          }],
        },
        { id: 'scene_target' },
      ],
    })

    firstScene.presentation!.states[0]!.backgroundAssetId = 'missing_background'
    expect(() => createCourseProjectArchive(source)).toThrowError(
      expect.objectContaining({
        title: '课程工程保存失败',
        message: expect.stringContaining('missing_background'),
      }),
    )
  })
})

describe('createBlankCourseProject', () => {
  it('constructs Course Project V9 directly without V8 document fields', () => {
    const project = createBlankCourseProject({
      id: 'blank-direct',
      title: '直接空白',
      now: NOW,
    })
    const aliased = createCourseProject({
      id: 'blank-alias',
      title: '别名空白',
      now: NOW,
    })
    expect(project.schemaVersion).toBe(9)
    expect(aliased.schemaVersion).toBe(9)
    expect('scenes' in project).toBe(false)
    expect('globalLayer' in project).toBe(false)
    expect('canvas' in project).toBe(false)
    expect(project.revision).toBe(0)
    expect(project.surfaces[0]).toMatchObject({ type: 'slide', title: '直接空白' })
    expect(project.locations[0]).toMatchObject({
      kind: 'slide-scene',
      sceneId: project.startLocationId,
    })
    expect(project.globalLayerItems.some((entry) => (
      entry.item.kind === 'native' && entry.item.content.nativeType === 'teacher-controller'
    ))).toBe(true)
    const controller = project.globalLayerItems.find((entry) => (
      entry.item.kind === 'native' && entry.item.content.nativeType === 'teacher-controller'
    ))
    if (!controller || controller.item.kind !== 'native' ||
      controller.item.content.nativeType !== 'teacher-controller') {
      throw new Error('expected teacher controller')
    }
    expect(controller.plane).toBe('overlay')
    expect(controller.item.content.data.defaultCollapsed).toBe(true)
    expect(courseProjectDocumentSchema.parse(structuredClone(project))).toEqual(project)
    expect(courseProjectDocumentSchema.parse(structuredClone(aliased))).toEqual(aliased)
  })

  it.each([true, false])(
    'preserves an explicit defaultCollapsed=%s through save and reopen',
    (defaultCollapsed) => {
      const project = createBlankCourseProject({
        id: `blank-explicit-${defaultCollapsed}`,
        title: '显式折叠设置',
        now: NOW,
      })
      const controller = project.globalLayerItems.find((entry) => (
        entry.item.kind === 'native' && entry.item.content.nativeType === 'teacher-controller'
      ))
      if (!controller || controller.item.kind !== 'native' ||
        controller.item.content.nativeType !== 'teacher-controller') {
        throw new Error('expected teacher controller')
      }
      controller.item.content.data.defaultCollapsed = defaultCollapsed
      const revisionBeforeSave = project.revision

      const bytes = createCourseProjectArchive({
        project: courseProjectDocumentSchema.parse(project),
        assetFiles: {},
        componentFiles: {},
      }, { mtime: NOW })
      const reopened = openCourseProjectArchive(bytes)
      const reopenedController = reopened.project.globalLayerItems.find((entry) => (
        entry.item.kind === 'native' && entry.item.content.nativeType === 'teacher-controller'
      ))
      if (!reopenedController || reopenedController.item.kind !== 'native' ||
        reopenedController.item.content.nativeType !== 'teacher-controller') {
        throw new Error('expected reopened teacher controller')
      }

      expect(reopenedController.plane).toBe('overlay')
      expect(reopenedController.item.content.data.defaultCollapsed).toBe(defaultCollapsed)
      expect(reopened.project.revision).toBe(revisionBeforeSave)
      expect(reopened.project).toEqual(project)
    },
  )
})
