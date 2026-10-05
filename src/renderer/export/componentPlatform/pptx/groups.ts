import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { rotationToDrawingMlDegree } from '../../drawingMlRotation'
import type { officeFrame } from './frame'

export interface PptxEditableGroup {
  name: string
  frame: ReturnType<typeof officeFrame>
  childWidth: number
  childHeight: number
  children: PptxGroupChild[]
}
export type PptxGroupChild = string | PptxEditableGroup
export type PptxSlideGroups = Map<number, PptxEditableGroup[]>

const p = 'http://schemas.openxmlformats.org/presentationml/2006/main'
const a = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const emu = (pixels: number) => String(Math.round(pixels * 9525))
const names = (group: PptxEditableGroup): string[] => group.children.flatMap(child => typeof child === 'string' ? [child] : names(child))

/** PptxGenJS emits the professional objects; this output-only pass restores
 * author groups and rotates editable graphicFrames without rasterizing them. */
export function applyPptxEditableGroups(bytes: Uint8Array, slides: PptxSlideGroups): Uint8Array {
  if (!slides.size) return bytes
  const files = unzipSync(bytes)
  for (const [index, groups] of slides) {
    const path = `ppt/slides/slide${index}.xml`
    const dom = new DOMParser().parseFromString(strFromU8(files[path]!), 'application/xml')
    const tree = dom.getElementsByTagNameNS(p, 'spTree')[0]!
    const drawings = new Map<string, Element>()
    let nextId = 1
    for (const identity of Array.from(tree.getElementsByTagNameNS(p, 'cNvPr'))) nextId = Math.max(nextId, Number(identity.getAttribute('id')) + 1)
    for (const drawing of Array.from(tree.children)) {
      const identity = drawing.getElementsByTagNameNS(p, 'cNvPr')[0]
      if (identity) drawings.set(identity.getAttribute('name')!, drawing)
    }
    const element = (namespace: string, tag: string, attrs: Record<string, string> = {}) => {
      const node = dom.createElementNS(namespace, tag)
      for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value)
      return node
    }
    const build = (group: PptxEditableGroup): Element => {
      const node = element(p, 'p:grpSp'), nonVisual = element(p, 'p:nvGrpSpPr')
      nonVisual.append(element(p, 'p:cNvPr', { id: String(nextId++), name: group.name }), element(p, 'p:cNvGrpSpPr'), element(p, 'p:nvPr'))
      node.appendChild(nonVisual)
      const properties = element(p, 'p:grpSpPr'), frame = group.frame
      const transform = element(a, 'a:xfrm', { rot: String(rotationToDrawingMlDegree(frame.rotation)), ...(frame.flipY ? { flipV: '1' } : {}) })
      transform.append(element(a, 'a:off', { x: emu(frame.x), y: emu(frame.y) }), element(a, 'a:ext', { cx: emu(frame.width), cy: emu(frame.height) }),
        element(a, 'a:chOff', { x: '0', y: '0' }), element(a, 'a:chExt', { cx: emu(group.childWidth), cy: emu(group.childHeight) }))
      properties.appendChild(transform); node.appendChild(properties)
      for (const child of group.children) {
        if (typeof child !== 'string') node.appendChild(build(child))
        else {
          const drawing = drawings.get(child)
          if (!drawing) throw new Error(`PPTX 编组 ${group.name} 缺少专业对象 ${child}`)
          node.appendChild(drawing)
        }
      }
      return node
    }
    for (const group of groups) {
      const first = names(group)[0]
      if (!first) continue
      const anchor = drawings.get(first)
      if (!anchor) throw new Error(`PPTX 编组 ${group.name} 缺少首个对象`)
      // Insert before moving the existing editable objects, retaining layer order.
      const placeholder = dom.createComment('group')
      tree.insertBefore(placeholder, anchor)
      tree.replaceChild(build(group), placeholder)
    }
    files[path] = strToU8(new XMLSerializer().serializeToString(dom))
  }
  return zipSync(files)
}
