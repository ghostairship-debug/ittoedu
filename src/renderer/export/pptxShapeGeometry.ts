import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { isStrokeOnlyShapeType, type ShapeNode } from '../../shared/contracts/native-v1'
import { pptxObjectName } from './pptxShared'
import { drawingMlPathGeometryXml, drawingMlGradientFillXml } from './drawingMlShapeGeometry'

const drawingNs = 'http://schemas.openxmlformats.org/drawingml/2006/main'
export type PptxShapeExtensions = Map<string, ShapeNode>

function fragment(dom: XMLDocument, xml: string): Node {
  const parsed = new DOMParser().parseFromString(`<root xmlns:a="${drawingNs}">${xml}</root>`, 'application/xml')
  return dom.importNode(parsed.documentElement.firstElementChild!, true)
}
/** PptxGenJS provides no custom geometry API. Replace only registered shapes in
 * this export's output; the registry is ephemeral and contains formal Native data. */
export function applyPptxShapeExtensions(bytes: Uint8Array, extensions: PptxShapeExtensions): Uint8Array {
  if (!extensions.size) return bytes
  const files = unzipSync(bytes)
  const found = new Set<string>()
  for (const [path, source] of Object.entries(files)) {
    if (!/^ppt\/(slides|slideMasters)\/[^/]+\.xml$/.test(path)) continue
    const dom = new DOMParser().parseFromString(strFromU8(source), 'application/xml')
    if (dom.getElementsByTagName('parsererror').length) throw new Error(`PPTX 形状投影无法解析 ${path}`)
    let changed = false
    for (const shape of Array.from(dom.getElementsByTagNameNS('*', 'sp'))) {
      const identity = shape.getElementsByTagNameNS('*', 'cNvPr')[0]
      const key = identity?.getAttribute('name') ?? ''
      const node = extensions.get(key)
      if (!node) continue
      const properties = Array.from(shape.children).find(child => child.localName === 'spPr')
      if (!properties) throw new Error(`PPTX 形状 ${key} 缺少 spPr`)
      if (node.pathGeometry) {
        const old = Array.from(properties.children).find(child => child.localName === 'prstGeom' || child.localName === 'custGeom')
        if (!old) throw new Error(`PPTX 形状 ${key} 缺少几何`)
        old.replaceWith(fragment(dom, drawingMlPathGeometryXml(node.pathGeometry)))
      }
      if (node.braceGeometry) {
        const preset = Array.from(properties.children).find(child => child.localName === 'prstGeom')
        if (!preset) throw new Error(`PPTX 括号 ${key} 缺少预设几何`)
        preset.replaceChildren()
        const adjustments = dom.createElementNS(drawingNs, 'a:avLst')
        for (const [name, value] of Object.entries({ adj1: node.braceGeometry.curvatureRatio, adj2: node.braceGeometry.midpoint })) {
          const guide = dom.createElementNS(drawingNs, 'a:gd')
          guide.setAttribute('name', name); guide.setAttribute('fmla', `val ${Math.round(value * 100000)}`)
          adjustments.appendChild(guide)
        }
        preset.appendChild(adjustments)
      }
      if (node.style.fillGradient && !isStrokeOnlyShapeType(node.shapeType)) {
        const old = Array.from(properties.children).find(child => ['solidFill', 'noFill', 'gradFill'].includes(child.localName))
        if (!old) throw new Error(`PPTX 形状 ${key} 缺少填充`)
        old.replaceWith(fragment(dom, drawingMlGradientFillXml(node.style.fillGradient, node.width, node.height, node.style.fillOpacity * node.opacity)))
      }
      identity.setAttribute('name', pptxObjectName(node)); found.add(key); changed = true
    }
    if (changed) files[path] = strToU8(new XMLSerializer().serializeToString(dom))
  }
  for (const key of extensions.keys()) if (!found.has(key)) throw new Error(`PPTX 形状 ${key} 未完成可编辑投影`)
  return zipSync(files)
}
