import { describe, expect, it } from 'vitest'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { validateOfficeCandidate } from '../../src/main/workbench/office/officeCandidate'

const P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types'
const relationships = (body: string) => `<Relationships xmlns="${REL}">${body}</Relationships>`
const relation = (id: string, type: string, target: string) => `<Relationship Id="${id}" Type="${R}/${type}" Target="${target}"/>`
const override = (part: string, type: string) => `<Override PartName="/${part}" ContentType="${type}"/>`
const timing = '<p:timing><p:tnLst><p:par><p:cTn id="1" dur="1000"/></p:par></p:tnLst></p:timing>'
const extension = '<p:extLst><p:ext uri="future"><x:payload value="keep"/></p:ext></p:extLst>'
const alternate = '<mc:AlternateContent><mc:Choice Requires="x"><x:item/></mc:Choice><mc:Fallback/></mc:AlternateContent>'
const slide = (text: string) => `<p:sld xmlns:p="${P}" xmlns:a="${A}" xmlns:x="urn:future" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>${timing}${extension}${alternate}</p:sld>`

function fixture(): Uint8Array {
  const parts: Record<string, string> = {
    '[Content_Types].xml': `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>`
      + override('ppt/presentation.xml', 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml')
      + ['ppt/slides/slide1.xml', 'ppt/slides/slide2.xml'].map(p => override(p, 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml')).join('')
      + override('ppt/notesSlides/notesSlide2.xml', 'application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml')
      + override('vendor/private.bin', 'application/x-vendor-private') + '</Types>',
    '_rels/.rels': relationships(relation('main', 'officeDocument', 'ppt/presentation.xml')),
    'ppt/presentation.xml': `<p:presentation xmlns:p="${P}" xmlns:r="${R}"><p:sldIdLst><p:sldId id="256" r:id="s1"/><p:sldId id="257" r:id="s2"/></p:sldIdLst></p:presentation>`,
    'ppt/_rels/presentation.xml.rels': relationships(relation('s1', 'slide', 'slides/slide1.xml') + relation('s2', 'slide', 'slides/slide2.xml')),
    'ppt/slides/slide1.xml': slide('before'),
    'ppt/slides/slide2.xml': slide('second'),
    'ppt/slides/_rels/slide1.xml.rels': relationships(relation('chart', 'chart', '../charts/chart1.xml')),
    'ppt/slides/_rels/slide2.xml.rels': relationships(relation('notes', 'notesSlide', '../notesSlides/notesSlide2.xml')),
    'ppt/charts/chart1.xml': '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"/>',
    'ppt/notesSlides/notesSlide2.xml': `<p:notes xmlns:p="${P}"/>`,
    'ppt/notesSlides/_rels/notesSlide2.xml.rels': relationships(relation('slide', 'slide', '../slides/slide2.xml')),
    'vendor/private.bin': 'unrecognized editable source bytes',
  }
  return zipSync(Object.fromEntries(Object.entries(parts).map(([name, body]) => [name, strToU8(body)])))
}
function candidate(source: Uint8Array, edit: (parts: Record<string, Uint8Array>, xml: (part: string, change: (text: string) => string) => void) => void): Uint8Array {
  const parts = unzipSync(source)
  edit(parts, (part, change) => { parts[part] = strToU8(change(strFromU8(parts[part]!))) })
  return zipSync(parts)
}

describe('PPT canvas candidates preserve non-target OOXML structure', () => {
  it('allows text/geometry changes while retaining opaque slide content', () => {
    const source = fixture()
    const next = candidate(source, (_parts, xml) => xml('ppt/slides/slide1.xml', text => text.replace('before', 'after').replace('x="0"', 'x="123"')))
    expect(validateOfficeCandidate(source, next, 'pptx')).toEqual(['ppt/slides/slide1.xml'])
  })
  it.each(['remove', 'change'])('rejects %s of an unknown source part', action => {
    const source = fixture()
    const next = candidate(source, parts => { if (action === 'remove') delete parts['vendor/private.bin']; else parts['vendor/private.bin'] = strToU8('lost') })
    expect(() => validateOfficeCandidate(source, next, 'pptx')).toThrow('非目标部件')
  })
  it.each(['remove', 'change'])('rejects %s of a retained part content type', action => {
    const source = fixture()
    const next = candidate(source, (_parts, xml) => xml('[Content_Types].xml', text => action === 'remove'
      ? text.replace(override('vendor/private.bin', 'application/x-vendor-private'), '')
      : text.replace('application/x-vendor-private', 'application/octet-stream')))
    expect(() => validateOfficeCandidate(source, next, 'pptx')).toThrow('内容类型改变')
  })
  it.each([timing, extension, alternate])('rejects silent removal of an opaque slide subtree', subtree => {
    const source = fixture()
    const next = candidate(source, (_parts, xml) => xml('ppt/slides/slide1.xml', text => text.replace(subtree, '')))
    expect(() => validateOfficeCandidate(source, next, 'pptx')).toThrow('动画、扩展或复杂对象改变')
  })
  it('preserves complex-object relationships even when their target bytes remain', () => {
    const source = fixture()
    const next = candidate(source, parts => { parts['ppt/slides/_rels/slide1.xml.rels'] = strToU8(relationships('')) })
    expect(() => validateOfficeCandidate(source, next, 'pptx')).toThrow('非目标部件关系改变')
  })
  it('allows page insertion/reordering and deletion of the removed page notes closure', () => {
    const source = fixture()
    const next = candidate(source, (parts, xml) => {
      for (const part of ['ppt/slides/slide2.xml', 'ppt/slides/_rels/slide2.xml.rels', 'ppt/notesSlides/notesSlide2.xml', 'ppt/notesSlides/_rels/notesSlide2.xml.rels']) delete parts[part]
      parts['ppt/slides/slide3.xml'] = strToU8(slide('new'))
      xml('ppt/presentation.xml', text => text.replace('<p:sldId id="256" r:id="s1"/><p:sldId id="257" r:id="s2"/>', '<p:sldId id="258" r:id="s3"/><p:sldId id="256" r:id="s1"/>'))
      xml('ppt/_rels/presentation.xml.rels', text => text.replace(relation('s2', 'slide', 'slides/slide2.xml'), relation('s3', 'slide', 'slides/slide3.xml')))
      xml('[Content_Types].xml', text => text.replace(override('ppt/slides/slide2.xml', 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml'), override('ppt/slides/slide3.xml', 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml'))
        .replace(override('ppt/notesSlides/notesSlide2.xml', 'application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml'), ''))
    })
    expect(() => validateOfficeCandidate(source, next, 'pptx')).not.toThrow()
  })
  it('rejects an untyped new binary part', () => {
    const source = fixture()
    const next = candidate(source, parts => { parts['ppt/media/new.opaque'] = strToU8('new') })
    expect(() => validateOfficeCandidate(source, next, 'pptx')).toThrow('新增部件缺少内容类型')
  })
})
