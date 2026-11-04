import { XMLSerializer } from '@xmldom/xmldom'
import type { PptxObjectEditSource, PptxObjectSourceInspection, PptxObjectSourceTarget } from '../../../shared/workbench/officeObjectEdit'
import { NS, type OfficePackage } from './officePackage'
import { attachNativeDependencies } from './officeNativeDependencies'
import { prepareNativeObjectEdit, replaceNativeObjectNode } from './officeObjectXml'
import { objects, shapeElements, slideParts } from './pptxContent'

const namespaces = { a: NS.drawing, p: NS.slide, r: NS.officeRelationship }

export function editPptxObject(pkg: OfficePackage, input: PptxObjectEditSource): void {
  const { target, edit } = input
  const slides = slideParts(pkg), part = slides[target.slide]
  if (!part || part !== target.part || pkg.partVersion(part) !== target.partVersion)
    throw new Error('幻灯片位置或版本已改变，请先重新检查')
  if (slides.filter(candidate => candidate === part).length !== 1)
    throw new Error('多张幻灯片使用同一原生部件，需先将目标页另存为独立部件')
  const matches = objects(pkg, part).filter(object => object.shapeId === target.shapeId)
  if (matches.length !== 1) throw new Error('选中的 PPT 对象不存在或身份不唯一')
  const root = matches[0]!.node
  const { node, replacement } = prepareNativeObjectEdit(root, edit, namespaces, true)
  if (node === root && replacement && (replacement.namespaceURI !== NS.slide || !shapeElements.has(replacement.localName)))
    throw new Error('形状所在位置需要合法的幻灯片对象元素')
  const changed = replaceNativeObjectNode(node, replacement, edit.insert)
  attachNativeDependencies(pkg, part, node, replacement, edit.dependencies)
  if (!changed) return
  if ((node !== root || replacement) && !objects(pkg, part).some(object => object.shapeId === target.shapeId))
    throw new Error(`替换内容缺少当前形状 ID：${target.shapeId}。要删除形状，请对形状根提交 null。`)
  pkg.write(part)
}

/** A narrowly selected source read can show any local node without inflating preview snapshots. */
export function inspectPptxObjectSource(pkg: OfficePackage, target: PptxObjectSourceTarget): PptxObjectSourceInspection {
  const part = slideParts(pkg)[target.slide]
  if (!part) throw new Error('幻灯片不存在，请重新检查')
  const matches = objects(pkg, part).filter(object => object.shapeId === target.shapeId)
  if (matches.length !== 1) throw new Error('选中的 PPT 对象不存在或身份不唯一')
  return { format: 'pptx', target: { ...target, part, partVersion: pkg.partVersion(part) },
    xml: new XMLSerializer().serializeToString(matches[0]!.node) }
}
