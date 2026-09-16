import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { pptxImportFixture } from './pptxImport'

export function pptxMediaFixture(options: { secondPage?: boolean; visibilityEffect?: boolean; kind?: 'audio' | 'video'; external?: boolean; missing?: boolean; extension?: string; bytes?: Uint8Array; duplicate?: boolean } = {}) {
  const files = unzipSync(pptxImportFixture())
  const r = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  const kind = options.kind ?? 'video'
  const extension = options.extension ?? (kind === 'audio' ? 'wav' : 'mp4')
  const target = options.external ? 'https://example.invalid/video.mp4' : `../media/video.${extension}`
  files['ppt/slides/_rels/slide1.xml.rels'] = strToU8(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="video" Type="${r}/${kind}" Target="${target}" ${options.external ? 'TargetMode="External"' : ''}/></Relationships>`)
  if (!options.missing) files[`ppt/media/video.${extension}`] = Uint8Array.from(options.bytes ?? [1, 2, 3])
  const picture = (id: number) => `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="内嵌视频 ${id}"/><p:cNvPicPr/><p:nvPr><a:${kind}File r:link="video"/></p:nvPr></p:nvPicPr><p:blipFill><a:blip r:embed="poster"/></p:blipFill><p:spPr><a:xfrm><a:off x="6000000" y="3000000"/><a:ext cx="3810000" cy="2143125"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr></p:pic>`
  files['ppt/slides/slide1.xml'] = strToU8(strFromU8(files['ppt/slides/slide1.xml']!).replace('</p:spTree>', `${picture(50)}${options.duplicate ? picture(51) : ''}</p:spTree>`))
  if (options.visibilityEffect) {
    const timing = '<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite"><p:childTnLst><p:set><p:cBhvr><p:cTn id="2" dur="1" fill="hold"><p:stCondLst><p:cond evt="onClick" delay="0"><p:tgtEl><p:spTgt spid="2"/></p:tgtEl></p:cond></p:stCondLst></p:cTn><p:tgtEl><p:spTgt spid="3"/></p:tgtEl><p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>'
    files['ppt/slides/slide1.xml'] = strToU8(strFromU8(files['ppt/slides/slide1.xml']!).replace('</p:sld>', `${timing}</p:sld>`))
  }
  if (options.secondPage) {
    const baseFiles = unzipSync(pptxImportFixture())
    files['ppt/slides/slide2.xml'] = strToU8(strFromU8(baseFiles['ppt/slides/slide1.xml']!).replace('知识 😀', '第二页'))
    files['ppt/presentation.xml'] = strToU8(strFromU8(files['ppt/presentation.xml']!).replace('</p:sldIdLst>', '<p:sldId id="257" r:id="slide2"/></p:sldIdLst>'))
    files['ppt/_rels/presentation.xml.rels'] = strToU8(strFromU8(files['ppt/_rels/presentation.xml.rels']!).replace('</Relationships>', `<Relationship Id="slide2" Type="${r}/slide" Target="slides/slide2.xml"/></Relationships>`))
  }
  return zipSync(files)
}
