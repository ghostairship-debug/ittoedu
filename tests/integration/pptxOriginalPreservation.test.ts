// @vitest-environment node
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import PptxGenJS from 'pptxgenjs'
import { applyOfficeContent, inspectOfficeContent } from '../../src/main/workbench/office/OfficeContentService'
import { descendants, NS, OfficePackage } from '../../src/main/workbench/office/officePackage'

async function originalFixture() {
  const pptx = new PptxGenJS()
  const slide = pptx.addSlide()
  slide.addText('Before', { x: 1, y: 1, w: 4, h: 1, objectName: 'Duplicate name' })
  slide.addText('Keep second', { x: 1, y: 3, w: 4, h: 1, objectName: 'Duplicate name' })
  slide.addNotes('Keep the speaker notes')
  pptx.addSlide().addText('Keep other slide', { x: 1, y: 1, w: 5, h: 1, objectName: 'Other title' })
  const parts = unzipSync(await pptx.write({ outputType: 'uint8array' }) as Uint8Array)
  const slidePart = 'ppt/slides/slide1.xml'
  const before = new OfficePackage(zipSync(parts))
  const shapeId = descendants(before.xml(slidePart), NS.slide, 'sp')
    .map(shape => descendants(shape, NS.slide, 'cNvPr')[0].getAttribute('id')!)[0]
  // A real generated deck with an existing timeline, an explicit break and an opaque extension.
  const timing = `<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst><p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst><p:par><p:cTn id="3" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst><p:par><p:cTn id="4" presetID="1" presetClass="entr" presetSubtype="0" fill="hold" nodeType="clickEffect"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst><p:set><p:cBhvr><p:cTn id="5" dur="1" fill="hold"/><p:tgtEl><p:spTgt spid="${shapeId}"/></p:tgtEl><p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn><p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst><p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>`
  parts[slidePart] = strToU8(strFromU8(parts[slidePart])
    .replace('<a:t>Before</a:t>', '<a:t>Before</a:t></a:r><a:br/><a:r><a:t> break</a:t>')
    .replace('</p:sld>', `${timing}<p:extLst><p:ext uri="urn:guoling:opaque-test"><g:future xmlns:g="urn:guoling:test" target="${shapeId}">Keep extension</g:future></p:ext></p:extLst></p:sld>`))
  parts['customXml/guoling-opaque.bin'] = new Uint8Array([0, 1, 2, 127, 128, 254, 255])
  parts['[Content_Types].xml'] = strToU8(strFromU8(parts['[Content_Types].xml']).replace('</Types>', '<Override PartName="/customXml/guoling-opaque.bin" ContentType="application/octet-stream"/></Types>'))
  parts['ppt/slides/_rels/slide1.xml.rels'] = strToU8(strFromU8(parts['ppt/slides/_rels/slide1.xml.rels']).replace('</Relationships>', '<Relationship Id="rIdGuolingOpaque" Type="urn:guoling:opaque-test" Target="../../customXml/guoling-opaque.bin"/></Relationships>'))
  const bytes = zipSync(parts, { level: 0, mtime: new Date('2020-01-02T00:00:00Z') })
  const inspection = inspectOfficeContent(bytes, 'pptx')
  if (inspection.format !== 'pptx') throw new Error('wrong format')
  const first = inspection.slides[0]
  return { bytes, parts, slidePart, inspection, target: {
    slide: first.index, part: first.part, partVersion: first.partVersion, shapeId: first.shapes[0].shapeId,
  } }
}

describe('PPTX original-file preservation', () => {
  it('keeps every original ZIP byte for inspection and unchanged text, including explicit breaks', async () => {
    const f = await originalFixture()
    expect(f.inspection.slides[0].shapes[0].text).toBe('Before\n break')
    const pkg = new OfficePackage(f.bytes)
    pkg.xml(f.slidePart)
    expect(pkg.save()).toEqual(f.bytes)
    const unchanged = await applyOfficeContent(f.bytes, { format: 'pptx', operation: 'edit', edits: [{
      ...f.target, text: f.inspection.slides[0].shapes[0].text,
    }] })
    expect(unchanged.changedParts).toEqual([])
    expect(unchanged.bytes).toEqual(f.bytes)
    expect(descendants(new OfficePackage(unchanged.bytes).xml(f.slidePart), NS.drawing, 'br')).toHaveLength(1)
  })

  it('edits a stable shape ID among duplicate names and preserves opaque parts and timeline references', async () => {
    const f = await originalFixture()
    const edited = await applyOfficeContent(f.bytes, { format: 'pptx', operation: 'edit', edits: [{ ...f.target, text: 'After' }] })
    expect(edited.changedParts).toEqual([f.slidePart])
    const parts = unzipSync(edited.bytes)
    expect(Object.keys(parts).sort()).toEqual(Object.keys(f.parts).sort())
    for (const part of Object.keys(f.parts)) if (part !== f.slidePart) expect(parts[part], part).toEqual(f.parts[part])
    const before = new OfficePackage(f.bytes), after = new OfficePackage(edited.bytes)
    for (const name of ['timing', 'extLst']) {
      expect(descendants(after.xml(f.slidePart), NS.slide, name).map(node => node.toString()))
        .toEqual(descendants(before.xml(f.slidePart), NS.slide, name).map(node => node.toString()))
    }
    expect(descendants(after.xml(f.slidePart), NS.slide, 'spTgt').map(node => node.getAttribute('spid'))).toEqual([f.target.shapeId])
    const reopened = inspectOfficeContent(edited.bytes, 'pptx')
    if (reopened.format !== 'pptx') throw new Error('wrong format')
    expect(reopened.slides[0].shapes.map(shape => shape.shapeId)).toEqual(f.inspection.slides[0].shapes.map(shape => shape.shapeId))
    expect(reopened.slides[0].shapes.map(shape => shape.text)).toEqual(['After', 'Keep second'])
    expect(reopened.slides[1]).toEqual(f.inspection.slides[1])
    expect(reopened.slides[0].partVersion).not.toBe(f.target.partVersion)
    if (process.env.OFFICE_TEST_EVIDENCE_DIRECTORY) {
      const directory = process.env.OFFICE_TEST_EVIDENCE_DIRECTORY
      await fs.mkdir(directory, { recursive: true })
      await fs.writeFile(path.join(directory, 'original-timeline-opaque.pptx'), f.bytes)
      await fs.writeFile(path.join(directory, 'edited-timeline-opaque.pptx'), edited.bytes)
    }
  })

  it('treats an explicit line-break removal as a change instead of a no-op', async () => {
    const f = await originalFixture()
    const edited = await applyOfficeContent(f.bytes, { format: 'pptx', operation: 'edit', edits: [{ ...f.target, text: 'Before break' }] })
    expect(edited.changedParts).toEqual([f.slidePart])
    expect(descendants(new OfficePackage(edited.bytes).xml(f.slidePart), NS.drawing, 'br')).toHaveLength(0)
    const reopened = inspectOfficeContent(edited.bytes, 'pptx')
    if (reopened.format !== 'pptx') throw new Error('wrong format')
    expect(reopened.slides[0].shapes[0].text).toBe('Before break')
  })

  it('rejects ambiguous names, stale parts and stale versions without changing the input', async () => {
    const f = await originalFixture()
    await expect(applyOfficeContent(f.bytes, { format: 'pptx', operation: 'edit', edits: [{ slide: 0, shape: 'Duplicate name', text: 'Wrong' }] })).rejects.toThrow('须唯一')
    await expect(applyOfficeContent(f.bytes, { format: 'pptx', operation: 'edit', edits: [{ ...f.target, part: 'ppt/slides/slide2.xml', text: 'Wrong' }] })).rejects.toThrow('位置已改变')
    const edited = await applyOfficeContent(f.bytes, { format: 'pptx', operation: 'edit', edits: [{ ...f.target, text: 'After' }] })
    await expect(applyOfficeContent(edited.bytes, { format: 'pptx', operation: 'edit', edits: [{ ...f.target, text: 'Stale write' }] })).rejects.toThrow('内容已改变')
    expect(inspectOfficeContent(f.bytes, 'pptx')).toEqual(f.inspection)
  })

  it('accepts several edits against one inspected part version', async () => {
    const f = await originalFixture()
    const edited = await applyOfficeContent(f.bytes, { format: 'pptx', operation: 'edit', edits: [
      { ...f.target, text: 'First change' },
      { ...f.target, shapeId: f.inspection.slides[0].shapes[1].shapeId, text: 'Second change' },
    ] })
    const reopened = inspectOfficeContent(edited.bytes, 'pptx')
    if (reopened.format !== 'pptx') throw new Error('wrong format')
    expect(reopened.slides[0].shapes.map(shape => shape.text)).toEqual(['First change', 'Second change'])
  })
})
