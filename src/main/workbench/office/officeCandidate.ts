import path from 'node:path'
import { OfficePackage, descendants, NS } from './officePackage'
import type { OfficeFormat } from '../../../shared/workbench/officeFiles'

const equals = (a: Uint8Array | undefined, b: Uint8Array | undefined) => Boolean(a && b && a.length === b.length && a.every((value, i) => value === b[i]))
const CONTENT_TYPES = 'http://schemas.openxmlformats.org/package/2006/content-types'
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006'
const relPart = (part: string) => path.posix.join(path.posix.dirname(part), '_rels', path.posix.basename(part) + '.rels')
const relOwner = (name: string) => name === '_rels/.rels' ? '' : path.posix.join(path.posix.dirname(path.posix.dirname(name)), path.posix.basename(name, '.rels'))
const fail = (detail: string): never => { throw new Error('候选文件未能保全原件结构：' + detail + '；原件未修改') }

function contentTypes(pkg: OfficePackage): (part: string) => string | undefined {
  const root = pkg.xml('[Content_Types].xml').documentElement
  if (root.namespaceURI !== CONTENT_TYPES || root.localName !== 'Types') fail('内容类型目录无效')
  const defaults = new Map<string, string>(), overrides = new Map<string, string>()
  for (const child of Array.from(root.childNodes)) {
    if (child.nodeType !== 1) continue
    const element = child as Element
    if (element.namespaceURI !== CONTENT_TYPES) continue
    const isDefault = element.localName === 'Default'
    if (!isDefault && element.localName !== 'Override') continue
    const key = isDefault ? (element.getAttribute('Extension') ?? '').toLowerCase()
      : (element.getAttribute('PartName') ?? '').replace(/^\//, '')
    const value = element.getAttribute('ContentType') ?? '', map = isDefault ? defaults : overrides
    if (!key || !value || map.has(key)) fail('内容类型缺失或重复：' + key)
    map.set(key, value)
  }
  return part => overrides.get(part) ?? defaults.get(path.posix.extname(part).slice(1).toLowerCase())
}

function slideParts(pkg: OfficePackage): Set<string> {
  const main = pkg.main(), relations = pkg.relationships(main)
  return new Set(descendants(pkg.xml(main), NS.slide, 'sldId').map(slide => {
    const id = slide.getAttributeNS(NS.officeRelationship, 'id') ?? slide.getAttribute('r:id') ?? ''
    const target = relations.get(id)
    if (!target || !pkg.parts[target]) return fail('幻灯片关系缺失：' + id)
    return target
  }))
}

// Prefix changes and attribute ordering are not content changes. Keep text and opaque attributes.
function canonical(node: Node): unknown {
  if (node.nodeType !== 1) return [node.nodeType, node.nodeValue]
  const element = node as Element
  const attributes = Array.from(element.attributes).filter(attr => attr.namespaceURI !== 'http://www.w3.org/2000/xmlns/')
    .map(attr => [attr.namespaceURI ?? '', attr.localName ?? attr.name, attr.value]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  return [element.namespaceURI ?? '', element.localName, attributes, Array.from(element.childNodes).map(canonical)]
}

function opaqueSlideNodes(pkg: OfficePackage, part: string): Map<string, number> {
  const result = new Map<string, number>()
  const visit = (node: Element, anchor: string, ancestry: string): void => {
    if (node.namespaceURI === NS.slide && ['sp', 'pic', 'graphicFrame', 'grpSp', 'cxnSp'].includes(node.localName)) {
      const id = descendants(node, NS.slide, 'cNvPr')[0]?.getAttribute('id')
      if (id) { anchor = 'object:' + id; ancestry = '' }
    }
    const location = ancestry + '/' + node.namespaceURI + ':' + node.localName
    const protectedNode = node.localName === 'extLst'
      || node.namespaceURI === NS.slide && ['timing', 'transition', 'oleObj', 'control', 'contentPart'].includes(node.localName)
      || node.namespaceURI === MC && node.localName === 'AlternateContent'
      || node.namespaceURI === NS.drawing && node.localName === 'graphicData' && node.getAttribute('uri') !== 'http://schemas.openxmlformats.org/drawingml/2006/table'
      || Boolean(node.namespaceURI && ![NS.slide, NS.drawing, MC].includes(node.namespaceURI))
    if (protectedNode) {
      const key = JSON.stringify([anchor, location, canonical(node)])
      result.set(key, (result.get(key) ?? 0) + 1)
      return
    }
    for (const child of Array.from(node.childNodes)) if (child.nodeType === 1) visit(child as Element, anchor, location)
  }
  visit(pkg.xml(part).documentElement, 'slide', '')
  return result
}

function assertSlidePreserved(before: OfficePackage, after: OfficePackage, part: string): void {
  const expected = opaqueSlideNodes(before, part), actual = opaqueSlideNodes(after, part)
  for (const [key, count] of expected) if ((actual.get(key) ?? 0) < count) fail('幻灯片的动画、扩展或复杂对象改变：' + part)
  const previousIds = new Set(descendants(before.xml(part), NS.slide, 'cNvPr').map(node => node.getAttribute('id')))
  const currentIds = new Set(descendants(after.xml(part), NS.slide, 'cNvPr').map(node => node.getAttribute('id')))
  for (const target of descendants(after.xml(part), NS.slide, 'spTgt')) {
    const id = target.getAttribute('spid')
    if (previousIds.has(id) && !currentIds.has(id)) fail('删除对象后仍有动画引用：' + part + '#' + id)
  }
}

/** Validate an editor's candidate before it reaches the existing file writer. */
export function validateOfficeCandidate(original: Uint8Array, bytes: Uint8Array, format: OfficeFormat): string[] {
  const before = new OfficePackage(original), after = new OfficePackage(bytes)
  const main = after.main()
  const expected = format === 'pptx' ? NS.slide : format === 'docx' ? NS.word : NS.sheet
  if (after.xml(main).documentElement.namespaceURI !== expected || before.main() !== main)
    throw new Error('候选文件的专业格式或主文档身份已改变；原件未修改')
  const changed = [...new Set([...Object.keys(before.parts), ...Object.keys(after.parts)])]
    .filter(name => !equals(before.parts[name], after.parts[name]))
  const beforeTypes = contentTypes(before), afterTypes = contentTypes(after)
  for (const name of Object.keys(after.parts)) {
    if (name === '[Content_Types].xml' || name.endsWith('/')) continue
    if (before.parts[name] && beforeTypes(name) && beforeTypes(name) !== afterTypes(name)) fail('原部件内容类型改变：' + name)
    if (!before.parts[name] && !afterTypes(name)) fail('新增部件缺少内容类型：' + name)
  }
  const oldSlides = format === 'pptx' ? slideParts(before) : new Set<string>()
  const newSlides = format === 'pptx' ? slideParts(after) : new Set<string>()
  const mutable = new Set(['[Content_Types].xml', main, relPart(main), 'docProps/app.xml', 'docProps/core.xml'])
  const deletable = new Set<string>()
  for (const part of oldSlides) {
    mutable.add(part); mutable.add(relPart(part))
    if (newSlides.has(part)) continue
    deletable.add(part); deletable.add(relPart(part))
    const relations = relPart(part)
    if (!before.parts[relations]) continue
    const targets = before.relationships(part)
    for (const relation of descendants(before.xml(relations), NS.relationship, 'Relationship')) {
      if (!relation.getAttribute('Type')?.endsWith('/notesSlide')) continue
      const note = targets.get(relation.getAttribute('Id') ?? '')
      if (note) { deletable.add(note); deletable.add(relPart(note)) }
    }
  }
  for (const name of changed) {
    // Only the existing high-frequency canvas parts may change. Everything else, including
    // future/unknown binary and XML parts, is retained by default; adding parts remains allowed.
    if (before.parts[name] && (!after.parts[name] ? !deletable.has(name) : !mutable.has(name))) fail('普通编辑改变了非目标部件：' + name)
    if (after.parts[name] && /\.(?:xml|rels)$/i.test(name)) after.xml(name)
    if (oldSlides.has(name) && newSlides.has(name)) assertSlidePreserved(before, after, name)
  }
  for (const name of Object.keys(after.parts).filter(name => name.endsWith('.rels'))) {
    const xml = after.xml(name), ids = new Set<string>()
    const owner = relOwner(name)
    if (xml.documentElement.namespaceURI !== NS.relationship || xml.documentElement.localName !== 'Relationships') fail('关系目录无效：' + name)
    if (before.parts[name] && changed.includes(name)) {
      const now = new Map(descendants(xml, NS.relationship, 'Relationship').map(node => [node.getAttribute('Id'), JSON.stringify(canonical(node))]))
      for (const relation of descendants(before.xml(name), NS.relationship, 'Relationship')) {
        const type = relation.getAttribute('Type') ?? '', id = relation.getAttribute('Id')
        // Pictures/links and the presentation's slide list are explicitly editable. All other
        // old relationships keep their IDs and targets, including unknown extension relationships.
        if (type.endsWith('/image') || type.endsWith('/hyperlink') || owner === main && type.endsWith('/slide')) continue
        if (now.get(id) !== JSON.stringify(canonical(relation))) fail('非目标部件关系改变：' + name + '#' + id)
      }
    }
    for (const relation of descendants(xml, NS.relationship, 'Relationship')) {
      const id = relation.getAttribute('Id') ?? ''
      if (!id || ids.has(id)) throw new Error('候选文件关系标识缺失或重复：' + name)
      ids.add(id)
      if (relation.getAttribute('TargetMode') === 'External') continue
      const raw = (relation.getAttribute('Target') ?? '').split('#')[0]!
      if (!raw) continue
      const target = path.posix.normalize(raw.startsWith('/') ? raw.slice(1) : path.posix.join(path.posix.dirname(owner), raw))
      if (target.startsWith('../') || !after.parts[target]) {
        // Do not turn a pre-existing unsupported relation into an unrelated editing failure.
        const existed = before.parts[name] && before.relationships(owner).get(id) === target && !before.parts[target]
        if (!existed) throw new Error('候选文件缺少关联部件：' + target)
      }
    }
  }
  // Content types must continue to describe every existing source part.
  const contentTypesXml = after.xml('[Content_Types].xml')
  for (const item of Array.from(contentTypesXml.documentElement.childNodes)) {
    if (item.nodeType !== 1) continue
    const element = item as Element
    if (element.localName === 'Override') {
      const target = (element.getAttribute('PartName') ?? '').replace(/^\//, '')
      if (!after.parts[target] && before.parts[target]) throw new Error('候选文件删除部件后未更新内容类型：' + target)
    }
  }
  return changed
}
