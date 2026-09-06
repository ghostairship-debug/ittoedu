import { strToU8, strFromU8, unzipSync, zipSync } from 'fflate'

/** Small frames and ordinary shapes reduced from the S2 classroom regression. */
export function pptxCommonMappingFixture(): Uint8Array {
  const files = unzipSync(pptxImportFixture())
  const relationship = '<Relationship Id="layout" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>'
  const rels = (body: string) => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`
  files['ppt/slides/_rels/slide1.xml.rels'] = strToU8(rels(relationship))
  files['ppt/slideLayouts/slideLayout1.xml'] = strToU8('<p:sldLayout xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree/></p:cSld></p:sldLayout>')
  files['ppt/slideLayouts/_rels/slideLayout1.xml.rels'] = strToU8(rels('<Relationship Id="master" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>'))
  files['ppt/slideMasters/slideMaster1.xml'] = strToU8('<p:sldMaster xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree/></p:cSld><p:txStyles><p:bodyStyle><a:lvl1pPr><a:buChar char="•"/><a:defRPr sz="3200"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1350"><a:latin typeface="Arial"/><a:solidFill><a:srgbClr val="123456"/></a:solidFill></a:defRPr></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>')
  const shape = (id: number, name: string, geometry: string, body = '', preset = 'rect', adjustment = '', stroke = '') => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/></p:nvSpPr><p:spPr><a:xfrm>${geometry}</a:xfrm><a:prstGeom prst="${preset}"><a:avLst>${adjustment}</a:avLst></a:prstGeom>${body ? '<a:noFill/>' : '<a:solidFill><a:srgbClr val="2563EB"/></a:solidFill>'}<a:ln w="19050">${stroke || '<a:noFill/>'}</a:ln></p:spPr>${body}</p:sp>`
  const text = (value: string, align = 'l') => `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="${align}"/><a:r><a:rPr/><a:t>${value}</a:t></a:r></a:p></p:txBody>`
  const rect = (x: number, y: number, w: number, h: number) => `<a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/>`
  const group = `<p:grpSp><p:nvGrpSpPr/><p:grpSpPr><a:xfrm><a:off x="952500" y="952500"/><a:ext cx="1905000" cy="1905000"/><a:chOff x="0" y="0"/><a:chExt cx="2000" cy="2000"/></a:xfrm></p:grpSpPr>${shape(10, '继承的分组文字', rect(0, 0, 1800, 300), text('树状图'))}${shape(11, '分组边框', rect(0, 400, 1800, 300), '', 'rect', '', '<a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:prstDash val="sysDash"/><a:miter/>')}</p:grpSp>`
  const objects = group
    + shape(12, '单字母', rect(3810000, 952500, 285750, 285750), text('A', 'just'))
    + shape(13, '小文字框', rect(3810000, 1905000, 1905000, 61912), text('小尺寸'))
    + shape(14, '圆角调整', rect(952500, 3810000, 1905000, 952500), '', 'roundRect', '<a:gd name="adj" fmla="val 25000"/>', '<a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:prstDash val="sysDot"/><a:bevel/>')
    + shape(15, '流程处理', rect(3810000, 3810000, 1905000, 952500), '', 'flowChartProcess')
  files['ppt/slides/slide1.xml'] = strToU8(strFromU8(files['ppt/slides/slide1.xml']!).replace(/<p:spTree>[\s\S]*?<\/p:spTree>/, `<p:spTree><p:nvGrpSpPr/><p:grpSpPr/>${objects}</p:spTree>`))
  return zipSync(files)
}

/** Non-flat OOXML fixture: interleaved layouts, inherited placeholders and a native table. */
export async function pptxInheritanceFixture(): Promise<Uint8Array> {
  const { default: PptxGenJS } = await import('pptxgenjs')
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  for (const [title, color] of [['A', '2563EB'], ['B', '16A34A']]) {
    pptx.defineSlideMaster({ title: title!, objects: [
      { rect: { x: 0.4, y: 0.3, w: 0.2, h: 6.8, fill: { color }, line: { color }, objectName: `装饰${title}` } },
      { placeholder: { options: { name: 'title', type: 'title', x: 1, y: 0.5, w: 11, h: 1, fontSize: 30, color: '123456', fontFace: 'Arial' }, text: '版式标题' } },
    ] })
  }
  for (const [index, masterName] of ['A', 'B', 'A', 'A'].entries()) {
    const slide = pptx.addSlide({ masterName })
    slide.addText(`第${index + 1}页标题`, { placeholder: 'title' })
    slide.addText(`局部正文${index + 1}`, { x: 1, y: 2, w: 10, h: 1, fontSize: 20, color: '333333' })
    if (index === 0) slide.addTable([['分数', '含义'], ['1/2', '平均分成两份，取一份']].map(row => row.map(text => ({ text }))), { x: 1, y: 3.5, w: 10, h: 1.5, colW: [3, 7], rowH: 0.75, fontSize: 20, color: '123456', fill: { color: 'FFFFFF' }, border: { type: 'solid', pt: 1, color: '333333' } })
  }
  const files = unzipSync(await pptx.write({ outputType: 'uint8array' }) as Uint8Array)
  // Split layout B onto a distinct master; retain the package relationship graph.
  const masterFile = 'ppt/slideMasters/slideMaster1.xml'
  const masterXml = strFromU8(files[masterFile]!)
  const decoration = (name: string, color: string) => `<p:sp><p:nvSpPr><p:cNvPr id="40" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="914400" y="6217920"/><a:ext cx="10058400" cy="182880"/></a:xfrm><a:prstGeom prst="rect"/><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>`
  files[masterFile] = strToU8(masterXml.replace(/<p:sldLayoutId id="2147483651"[^>]*\/>/, '').replace('</p:spTree>', decoration('母版A', 'EAB308') + '</p:spTree>'))
  files['ppt/slideMasters/slideMaster2.xml'] = strToU8(masterXml.replace(/<p:sldLayoutId id="21474836(?:49|50)"[^>]*\/>/g, '').replace('</p:spTree>', decoration('母版B', 'F97316') + '</p:spTree>'))
  const masterRels = strFromU8(files['ppt/slideMasters/_rels/slideMaster1.xml.rels']!)
  files['ppt/slideMasters/_rels/slideMaster1.xml.rels'] = strToU8(masterRels.replace(/<Relationship[^>]*Target="\.\.\/slideLayouts\/slideLayout3.xml"[^>]*\/>/, ''))
  files['ppt/slideMasters/_rels/slideMaster2.xml.rels'] = strToU8(masterRels.replace(/<Relationship[^>]*Target="\.\.\/slideLayouts\/slideLayout[12].xml"[^>]*\/>/g, ''))
  files['ppt/slideLayouts/_rels/slideLayout3.xml.rels'] = strToU8(strFromU8(files['ppt/slideLayouts/_rels/slideLayout3.xml.rels']!).replace('slideMaster1.xml', 'slideMaster2.xml'))
  files['ppt/presentation.xml'] = strToU8(strFromU8(files['ppt/presentation.xml']!).replace('</p:sldMasterIdLst>', '<p:sldMasterId id="2147483652" r:id="rIdExtraMaster"/></p:sldMasterIdLst>'))
  files['ppt/_rels/presentation.xml.rels'] = strToU8(strFromU8(files['ppt/_rels/presentation.xml.rels']!).replace('</Relationships>', '<Relationship Id="rIdExtraMaster" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster2.xml"/></Relationships>'))
  files['[Content_Types].xml'] = strToU8(strFromU8(files['[Content_Types].xml']!).replace('</Types>', '<Override PartName="/ppt/slideMasters/slideMaster2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/></Types>'))
  // Force the reader to resolve the placeholder geometry/font from its layout.
  for (let page = 1; page <= 4; page++) {
    const file = `ppt/slides/slide${page}.xml`
    let xml = strFromU8(files[file]!)
    xml = xml.replace(/<p:sp>[\s\S]*?<\/p:sp>/g, object => {
      if (!object.includes('<p:ph')) return object
      return object.replace(/<a:xfrm[^>]*>[\s\S]*?<\/a:xfrm>/, '').replace(/<a:rPr[^>]*>[\s\S]*?<\/a:rPr>/g, '<a:rPr/>')
    })
    if (page === 4) xml = xml.replace('<p:sld ', '<p:sld showMasterSp="0" ')
    files[file] = strToU8(xml)
  }
  return zipSync(files)
}

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
