import { describe, expect, it } from 'vitest'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { applyOfficeContent, inspectOfficeContent } from '../../src/main/workbench/office/OfficeContentService'
import { descendants, NS, OfficePackage } from '../../src/main/workbench/office/officePackage'

const onePixelPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6p8AAAAASUVORK5CYII='
const namespace = `xmlns:p="${NS.slide}" xmlns:a="${NS.drawing}" xmlns:r="${NS.officeRelationship}"`
const transform = '<a:xfrm><a:off x="127000" y="254000"/><a:ext cx="2540000" cy="635000"/></a:xfrm>'
const textBody = (text: string) => `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr b="1"/><a:t>${text}</a:t></a:r></a:p></p:txBody>`
const shape = (id: number, name: string, text: string) => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${transform}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></p:spPr>${textBody(text)}</p:sp>`
const picture = (id: number) => `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="picture-${id}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdImage"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${transform}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`
const cell = (text: string) => `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${text}</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>`

function original(): Uint8Array {
  const parts: Record<string, Uint8Array> = {}
  const xml = (part: string, value: string) => { parts[part] = strToU8(value) }
  xml('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>')
  xml('_rels/.rels', `<Relationships xmlns="${NS.relationship}"><Relationship Id="rId1" Type="${NS.officeRelationship}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`)
  xml('ppt/presentation.xml', `<p:presentation ${namespace}><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst><p:sldSz cx="9144000" cy="5143500"/></p:presentation>`)
  xml('ppt/_rels/presentation.xml.rels', `<Relationships xmlns="${NS.relationship}"><Relationship Id="rId1" Type="${NS.officeRelationship}/slide" Target="slides/slide1.xml"/><Relationship Id="rId2" Type="${NS.officeRelationship}/slide" Target="slides/slide2.xml"/></Relationships>`)
  const table = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="6" name="table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="127000" y="1270000"/><a:ext cx="2540000" cy="1270000"/></p:xfrm><a:graphic><a:graphicData uri="${NS.drawing}/table"><a:tbl><a:tblPr/><a:tblGrid><a:gridCol w="1270000"/><a:gridCol w="1270000"/></a:tblGrid><a:tr h="635000">${cell('A')}${cell('B')}</a:tr><a:tr h="635000">${cell('C')}${cell('D')}</a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>`
  const group = `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="7" name="group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2540000" cy="1270000"/><a:chOff x="0" y="0"/><a:chExt cx="2540000" cy="1270000"/></a:xfrm></p:grpSpPr>${shape(8, 'nested', 'Nested')}</p:grpSp>`
  xml('ppt/slides/slide1.xml', `<p:sld ${namespace}><p:cSld><p:spTree><p:nvGrpSpPr/><p:grpSpPr/>${shape(2, 'title', 'Original')}${picture(3)}${picture(4)}${shape(5, 'other', 'Human kept')}${table}${group}</p:spTree></p:cSld><p:timing><p:tnLst><p:par><p:cTn id="1"><p:childTnLst><p:set><p:cBhvr><p:cTn id="2"/><p:tgtEl><p:spTgt spid="2"/></p:tgtEl></p:cBhvr></p:set></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing><p:extLst><p:ext uri="keep"><custom xmlns="urn:unknown">untouched</custom></p:ext></p:extLst></p:sld>`)
  xml('ppt/slides/slide2.xml', `<p:sld ${namespace}><p:cSld><p:spTree>${shape(2, 'second-slide', 'Do not touch')}</p:spTree></p:cSld></p:sld>`)
  xml('ppt/slides/_rels/slide1.xml.rels', `<Relationships xmlns="${NS.relationship}"><Relationship Id="rIdImage" Type="${NS.officeRelationship}/image" Target="../media/original.png"/></Relationships>`)
  parts['ppt/media/original.png'] = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 3])
  parts['custom/opaque.bin'] = Uint8Array.from([0, 255, 17, 0, 99])
  return zipSync(parts)
}
function inspect(bytes: Uint8Array) {
  const result = inspectOfficeContent(bytes, 'pptx')
  if (result.format !== 'pptx') throw new Error('Expected PPTX')
  return result
}

describe('PPT original object editing through the shared Office content contract', () => {
  it('retains original bytes for inspect and unchanged legacy text, and exposes stable common object targets', async () => {
    const bytes = original(), view = inspect(bytes), slide = view.slides[0]
    expect([view.width, view.height]).toEqual([720, 405])
    expect(slide.shapes.map(object => [object.shapeId, object.kind])).toEqual([
      ['2', 'shape'], ['3', 'picture'], ['4', 'picture'], ['5', 'shape'], ['6', 'table'], ['7', 'group'], ['8', 'shape'],
    ])
    expect(slide.shapes.find(object => object.shapeId === '8')?.groupPath).toEqual(['7'])
    const saved = await applyOfficeContent(bytes, { format: 'pptx', operation: 'edit', edits: [{ slide: 0, shapeId: '2', part: slide.part, partVersion: slide.partVersion, text: 'Original' }] })
    expect(saved.changedParts).toEqual([])
    expect(saved.bytes).toEqual(bytes)
  })

  it('applies text, geometry, style, order, crop and table edits without flattening the original document', async () => {
    const bytes = original(), view = inspect(bytes), slide = view.slides[0]
    const target = (shapeId: string) => ({ slide: 0, shapeId, part: slide.part, partVersion: slide.partVersion })
    const saved = await applyOfficeContent(bytes, { format: 'pptx', operation: 'edit', edits: [
      { ...target('2'), type: 'runText', paragraph: 0, run: 0, text: 'AI changed title' },
      { ...target('2'), type: 'textStyle', style: { italic: true, fontSize: 28, color: '0066CC' } },
      { ...target('2'), type: 'transform', x: 24, y: 36, width: 220, height: 60, rotation: 15 },
      { ...target('5'), type: 'shapeStyle', fill: 'ABCDEF', stroke: '123456', strokeWidth: 2 },
      { ...target('3'), type: 'imageCrop', left: 5, top: 10, right: 15, bottom: 5 },
      { ...target('6'), type: 'tableCell', row: 1, column: 0, text: 'Edited cell' },
      { ...target('2'), type: 'layer', position: 'front' },
    ] })
    const after = inspect(saved.bytes), objects = after.slides[0].shapes
    const title = objects.find(object => object.shapeId === '2')!
    expect(title.text).toBe('AI changed title')
    expect(title.frame).toEqual({ x: 24, y: 36, width: 220, height: 60, rotation: 15 })
    expect(title.runs[0][0].style).toMatchObject({ bold: true, italic: true, fontSize: 28, color: '0066CC' })
    expect(objects.at(-1)?.shapeId).toBe('2')
    expect(objects.find(object => object.shapeId === '5')).toMatchObject({ text: 'Human kept', fill: 'ABCDEF', stroke: '123456' })
    expect(objects.find(object => object.shapeId === '3')?.crop).toEqual({ left: 5, top: 10, right: 15, bottom: 5 })
    expect(objects.find(object => object.shapeId === '6')?.cells).toEqual([['A', 'B'], ['Edited cell', 'D']])
    expect(objects.find(object => object.shapeId === '8')?.groupPath).toEqual(['7'])
    const beforeParts = unzipSync(bytes), afterParts = unzipSync(saved.bytes)
    for (const name of ['ppt/slides/slide2.xml', 'ppt/slides/_rels/slide1.xml.rels', 'ppt/media/original.png', 'custom/opaque.bin']) expect(afterParts[name]).toEqual(beforeParts[name])
    expect(strFromU8(afterParts[slide.part])).toContain('spid="2"')
    expect(strFromU8(afterParts[slide.part])).toContain('urn:unknown')
    expect(saved.changedParts).toEqual([slide.part])
    await expect(applyOfficeContent(saved.bytes, { format: 'pptx', operation: 'edit', edits: [{ ...target('5'), type: 'text', text: 'stale overwrite' }] })).rejects.toThrow('内容已改变')
  })

  it('replaces a selected picture with a private media relationship and retains another picture sharing the original', async () => {
    const bytes = original(), slide = inspect(bytes).slides[0]
    const saved = await applyOfficeContent(bytes, { format: 'pptx', operation: 'edit', edits: [{
      slide: 0, part: slide.part, partVersion: slide.partVersion, shapeId: '3', type: 'replaceImage', image: { contentType: 'image/png', base64: onePixelPng },
    }] })
    const pkg = new OfficePackage(saved.bytes), pictures = descendants(pkg.xml(slide.part), NS.slide, 'pic')
    const first = descendants(pictures[0], NS.drawing, 'blip')[0].getAttributeNS(NS.officeRelationship, 'embed')!
    const second = descendants(pictures[1], NS.drawing, 'blip')[0].getAttributeNS(NS.officeRelationship, 'embed')!
    expect(first).not.toBe(second); expect(second).toBe('rIdImage')
    const newPart = pkg.relationships(slide.part).get(first)!
    expect(pkg.parts[newPart]).toEqual(Uint8Array.from(Buffer.from(onePixelPng, 'base64')))
    expect(pkg.parts['ppt/media/original.png']).toEqual(unzipSync(bytes)['ppt/media/original.png'])
    expect(pkg.parts['custom/opaque.bin']).toEqual(unzipSync(bytes)['custom/opaque.bin'])
    expect(saved.changedParts).toContain(newPart)
    expect(saved.changedParts).not.toContain('ppt/media/original.png')
  })

  it('does not publish a partly mutated package when another operation in the batch is invalid', async () => {
    const bytes = original(), before = Uint8Array.from(bytes)
    const slide = inspect(bytes).slides[0], identity = { slide: slide.index, part: slide.part, partVersion: slide.partVersion }
    await expect(applyOfficeContent(bytes, { format: 'pptx', operation: 'edit', edits: [
      { ...identity, shapeId: '2', type: 'transform', x: 100 },
      { ...identity, shapeId: '6', type: 'tableCell', row: 99, column: 0, text: 'invalid' },
    ] })).rejects.toThrow('单元格不存在')
    expect(bytes).toEqual(before)
  })
})
