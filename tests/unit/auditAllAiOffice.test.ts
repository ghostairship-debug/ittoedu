import { expect, it, vi } from 'vitest'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { extractOfficeMaterial } from '../../src/renderer/project/materialExtraction'
import { r19LessonMaterials } from '../fixtures/r19LessonMaterials'
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '/pdf.worker.min.mjs' }))
const fixture = (format: 'docx' | 'pptx') => unzipSync(r19LessonMaterials().find(item => item.format === format)!.bytes)
it('CA-062 retains DOCX paragraph tabs and breaks in their source order', () => {
  const files = fixture('docx')
  files['word/document.xml'] = strToU8(strFromU8(files['word/document.xml']).replace(/<w:p>[\s\S]*?<\/w:p>/, '<w:p><w:r><w:t>温度</w:t><w:tab/><w:t>20</w:t><w:br/><w:t>湿度</w:t><w:tab/><w:t>30</w:t></w:r></w:p>'))
  expect(extractOfficeMaterial(zipSync(files), 'docx').fragments[0].text).toBe('温度\t20\n湿度\t30')
})
it('CA-154 retains healthy pages when another slide part is missing', () => {
  const files = fixture('pptx'), name = 'ppt/presentation.xml'
  files[name] = strToU8(strFromU8(files[name]).replace('</p:sldIdLst>', '<p:sldId id="257" r:id="missing"/></p:sldIdLst>'))
  files['ppt/_rels/presentation.xml.rels'] = strToU8(strFromU8(files['ppt/_rels/presentation.xml.rels']).replace('</Relationships>', '<Relationship Id="missing" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/missing.xml"/></Relationships>'))
  const output = extractOfficeMaterial(zipSync(files), 'pptx')
  expect(output.fragments.length).toBeGreaterThan(0)
  expect(output.gaps).toEqual(expect.arrayContaining([expect.objectContaining({ locator: { part: 'ppt/slides/missing.xml', page: 2 } })]))
})
it('CA-154 accepts a real empty bounded first batch so later pages can be extracted', () => {
  const files = fixture('pptx')
  files['ppt/slides/slide1.xml'] = strToU8('<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree/></p:cSld></p:sld>')
  const output = extractOfficeMaterial(zipSync(files), 'pptx', { maxPages: 32 })
  expect(output.fragments).toEqual([])
})
it('CA-061 excludes inherited placeholder samples and master content hidden by the slide', () => {
  const files = fixture('pptx')
  files['ppt/slides/_rels/slide1.xml.rels'] = strToU8(strFromU8(files['ppt/slides/_rels/slide1.xml.rels']).replace('</Relationships>', '<Relationship Id="layout" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>'))
  const shape = '<p:sp><p:nvSpPr><p:nvPr><p:ph/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Click to edit Master</a:t></a:r></a:p></p:txBody></p:sp>'
  files['ppt/slideLayouts/slideLayout1.xml'] = strToU8(`<p:sldLayout xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree>${shape}</p:spTree></p:cSld></p:sldLayout>`)
  expect(extractOfficeMaterial(zipSync(files), 'pptx').fragments.map(item => item.text).join('')).not.toContain('Click to edit Master')
  files['ppt/slides/slide1.xml'] = strToU8(strFromU8(files['ppt/slides/slide1.xml']).replace('<p:sld ', '<p:sld showMasterSp="0" '))
  files['ppt/slideLayouts/slideLayout1.xml'] = strToU8(strFromU8(files['ppt/slideLayouts/slideLayout1.xml']).replace('<p:ph/>', ''))
  expect(extractOfficeMaterial(zipSync(files), 'pptx').fragments.map(item => item.text).join('')).not.toContain('Click to edit Master')
})
