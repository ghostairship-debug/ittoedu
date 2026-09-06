import { utils, write } from 'cfb'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { pptxImportFixture } from './pptxImport'
import equations from './pptxLegacyEquations.json'

export const equationNativeBytes = (hex: string) => Uint8Array.from(hex.match(/../g)!, value => parseInt(value, 16))
export function equationOleFixture(native: Uint8Array): Uint8Array {
  const container = utils.cfb_new()
  utils.cfb_add(container, 'Equation Native', native)
  return Uint8Array.from(write(container, { type: 'array', fileType: 'cfb' }))
}

export function pptxEquationFixture(native = equationNativeBytes(equations[0]!.hex), external = false): Uint8Array {
  const files = unzipSync(pptxImportFixture())
  const object = '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="5" name="概率公式"/></p:nvGraphicFramePr><p:xfrm><a:off x="7000000" y="4000000"/><a:ext cx="1600000" cy="1200000"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/presentationml/2006/ole"><p:oleObj r:id="equation" progId=""/></a:graphicData></a:graphic></p:graphicFrame>'
  files['ppt/slides/slide1.xml'] = strToU8(strFromU8(files['ppt/slides/slide1.xml']!).replace('</p:spTree>', `${object}</p:spTree>`))
  files['ppt/slides/_rels/slide1.xml.rels'] = strToU8(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="equation" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" Target="${external ? 'https://example.invalid/formula.bin' : '../embeddings/equation.bin'}" ${external ? 'TargetMode="External"' : ''}/></Relationships>`)
  files['ppt/embeddings/equation.bin'] = Uint8Array.from(equationOleFixture(native))
  return zipSync(files)
}
