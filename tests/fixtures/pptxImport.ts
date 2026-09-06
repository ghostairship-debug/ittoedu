import { strToU8, zipSync } from 'fflate'

export function pptxImportFixture(options: { image?: boolean; unsupported?: boolean; brokenRelationship?: boolean } = {}) {
  const relationships = (body: string) => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`
  const rel = (id: string, kind: string, target: string) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${kind}" Target="${target}"/>`
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/></Types>'),
    '_rels/.rels': strToU8(relationships(rel('main', 'officeDocument', 'ppt/presentation.xml'))),
    'ppt/presentation.xml': strToU8('<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="slide"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>'),
    'ppt/_rels/presentation.xml.rels': strToU8(relationships(rel('slide', 'slide', options.brokenRelationship ? 'slides/missing.xml' : 'slides/slide1.xml'))),
    'ppt/slides/slide1.xml': strToU8(`<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:cSld name="导入演示"><p:bg><p:bgPr><a:solidFill><a:srgbClr val="F0F5FF"/></a:solidFill></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr/><p:grpSpPr/>
      <p:sp><p:nvSpPr><p:cNvPr id="2" name="课题"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="952500" y="952500"/><a:ext cx="9525000" cy="1905000"/></a:xfrm><a:prstGeom prst="rect"/><a:noFill/></p:spPr><p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:r><a:rPr sz="3200" b="1"><a:solidFill><a:srgbClr val="123456"/></a:solidFill><a:latin typeface="Arial"/></a:rPr><a:t>知识 😀</a:t></a:r></a:p></p:txBody></p:sp>
      <p:sp><p:nvSpPr><p:cNvPr id="3" name="基础图形"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="952500" y="3333750"/><a:ext cx="1905000" cy="1905000"/></a:xfrm><a:prstGeom prst="ellipse"/><a:solidFill><a:srgbClr val="2563EB"/></a:solidFill></p:spPr></p:sp>
      ${options.image ? '<p:pic><p:nvPicPr><p:cNvPr id="4" name="图片"/></p:nvPicPr><p:blipFill><a:blip r:embed="image"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="3810000" y="3333750"/><a:ext cx="1905000" cy="1905000"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr></p:pic>' : ''}
      ${options.unsupported ? '<p:graphicFrame/>' : ''}</p:spTree></p:cSld></p:sld>`),
  }
  if (options.image) {
    files['ppt/slides/_rels/slide1.xml.rels'] = strToU8(relationships(rel('image', 'image', '../media/image.png')))
    files['ppt/media/image.png'] = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1sAAAAASUVORK5CYII='), c => c.charCodeAt(0))
  }
  return zipSync(files)
}
