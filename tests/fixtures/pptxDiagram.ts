import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { pptxImportFixture } from './pptxImport'

export function pptxDiagramFixture(kind: 'process1' | 'orgChart1' | 'cycle2' = 'orgChart1', options: { stale?: boolean; unsupportedChild?: boolean; unsupportedLayout?: boolean; external?: boolean; missingConnection?: boolean } = {}) {
  const files = unzipSync(pptxImportFixture())
  const a = 'http://schemas.openxmlformats.org/drawingml/2006/main'
  const d = 'http://schemas.openxmlformats.org/drawingml/2006/diagram'
  const ds = 'http://schemas.microsoft.com/office/drawing/2008/diagram'
  const r = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  const transform = (x: number, y: number, w = 1500000, h = 700000) => `<a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/>`
  const text = (value: string) => `<a:bodyPr anchor="ctr" lIns="0" rIns="0" tIns="0" bIns="0"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="2400"/><a:t>${value}</a:t></a:r></a:p>`
  const positions = kind === 'process1' ? [[0, 900000], [2300000, 900000], [4600000, 900000]]
    : kind === 'orgChart1' ? [[2300000, 0], [0, 2100000], [4600000, 2100000]] : [[2300000, 0], [4600000, 2100000], [0, 2100000]]
  const nodes = ['开始', '观察', '解释']
  const ids = [...nodes.map((_, i) => `n${i}`), ...Array.from({ length: kind === 'cycle2' ? 3 : 2 }, (_, i) => `edge${i}`)]
  const data = ids.map((id, i) => `<dgm:pt modelId="${id}"${i >= 3 ? ' type="sibTrans"' : ''}><dgm:t>${text(nodes[i] ?? '')}</dgm:t></dgm:pt><dgm:pt modelId="p-${id}" type="pres"><dgm:prSet presAssocID="${id}" presStyleLbl="${i >= 3 ? 'edge' : 'node'}" presStyleIdx="${i >= 3 ? i - 3 : i}" presStyleCnt="${i >= 3 ? ids.length - 3 : 3}"/></dgm:pt>`).join('')
  const shapes = ids.map((id, i) => {
    if (options.missingConnection && i === 3) return ''
    const edge = i >= 3
    const [x, y] = positions[i] ?? [1800000 + (i - 3) * 2300000, 1300000]
    const geometry = options.unsupportedChild && i === 4 ? '<a:prstGeom prst="unknown-shape"/>' : edge ? '<a:custGeom><a:pathLst><a:path fill="none"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="700000" y="200000"/></a:lnTo></a:path></a:pathLst></a:custGeom>' : `<a:prstGeom prst="${kind === 'cycle2' ? 'ellipse' : 'rect'}"/>`
    return `<dsp:sp modelId="p-${id}"><dsp:nvSpPr><dsp:cNvPr id="${i + 1}" name=""/></dsp:nvSpPr><dsp:spPr><a:xfrm>${transform(x, y)}</a:xfrm>${geometry}${edge ? '<a:noFill/>' : '<a:solidFill><a:srgbClr val="185E78"><a:hueOff val="0"/></a:srgbClr></a:solidFill>'}<a:ln w="19050"><a:solidFill><a:srgbClr val="185E78"/></a:solidFill></a:ln></dsp:spPr><dsp:style><a:fontRef idx="minor"><a:srgbClr val="FFFFFF"/></a:fontRef></dsp:style>${edge ? '' : `<dsp:txBody>${text(options.stale && i === 0 ? '过期文字' : nodes[i])}</dsp:txBody><dsp:txXfrm>${transform(x + 100000, y + 100000, 1300000, 500000)}</dsp:txXfrm>`}</dsp:sp>`
  }).join('')
  files['ppt/diagrams/data1.xml'] = strToU8(`<dgm:dataModel xmlns:dgm="${d}" xmlns:a="${a}" xmlns:dsp="${ds}"><dgm:ptLst>${data}</dgm:ptLst><dgm:extLst><dsp:dataModelExt relId="cache"/></dgm:extLst></dgm:dataModel>`)
  files['ppt/diagrams/layout1.xml'] = strToU8(`<dgm:layoutDef xmlns:dgm="${d}" uniqueId="urn:microsoft.com/office/officeart/2005/8/layout/${options.unsupportedLayout ? 'venn1' : kind}"/>`)
  files['ppt/diagrams/drawing1.xml'] = strToU8(`<dsp:drawing xmlns:dsp="${ds}" xmlns:a="${a}"><dsp:spTree><dsp:grpSpPr/>${shapes}</dsp:spTree></dsp:drawing>`)
  files['ppt/slides/_rels/slide1.xml.rels'] = strToU8(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="data" Type="${r}/diagramData" Target="../diagrams/data1.xml"/><Relationship Id="layout" Type="${r}/diagramLayout" Target="../diagrams/layout1.xml"/><Relationship Id="cache" Type="http://schemas.microsoft.com/office/2007/relationships/diagramDrawing" Target="${options.external ? 'https://example.invalid/cache.xml' : '../diagrams/drawing1.xml'}" ${options.external ? 'TargetMode="External"' : ''}/></Relationships>`)
  const frame = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="10" name="图示"/></p:nvGraphicFramePr><p:xfrm>${transform(4000000, 3000000, 6500000, 3200000)}</p:xfrm><a:graphic><a:graphicData><dgm:relIds xmlns:dgm="${d}" r:dm="data" r:lo="layout"/></a:graphicData></a:graphic></p:graphicFrame>`
  files['ppt/slides/slide1.xml'] = strToU8(strFromU8(files['ppt/slides/slide1.xml']!).replace('</p:spTree>', `${frame}</p:spTree>`))
  return zipSync(files)
}
