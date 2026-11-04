import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import type { OfficeNativeObjectEdit } from '../../../shared/workbench/officeObjectEdit'
import { children } from './officePackage'

/** Parses one detached OOXML property element with the caller's standard namespaces. */
export function parseOfficeObjectXml(xml: string, namespaces: Readonly<Record<string, string>>): Element {
  const fragment = xml.trim().replace(/^<\?xml\s[^?]*\?>\s*/i, '')
  if (/<!DOCTYPE\b|<!ENTITY\b/i.test(fragment)) throw new Error('Office 原生节点不能包含外部实体声明。')
  const declarations = Object.entries(namespaces).map(([prefix, uri]) => `xmlns${prefix ? `:${prefix}` : ''}="${uri}"`).join(' ')
  const issues: string[] = []
  const report = (message: string) => { issues.push(message) }
  const document = new DOMParser({ errorHandler: { warning: report, error: report, fatalError: report } })
    .parseFromString(`<officeFragment ${declarations}>${fragment}</officeFragment>`, 'application/xml')
  const nodes = Array.from(document.documentElement?.childNodes ?? []).filter(node => node.nodeType !== 8 && (node.nodeType !== 3 || node.textContent?.trim()))
  if (issues.length || nodes.length !== 1 || nodes[0]?.nodeType !== 1)
    throw new Error(`Office 对象属性需要一个有效的 XML 元素。${issues[0] ?? ''}`)
  return nodes[0] as Element
}

export function prepareNativeObjectEdit(root: Element, edit: OfficeNativeObjectEdit, namespaces: Readonly<Record<string, string>>, allowRootTypeChange = false) {
  let node = root
  for (const { name, index } of edit.path) {
    const colon = name.indexOf(':')
    const prefix = colon < 0 ? '' : name.slice(0, colon)
    const local = colon < 0 ? name : name.slice(colon + 1)
    const namespace = node.lookupNamespaceURI(prefix || null) ?? namespaces[prefix] ?? (prefix ? undefined : node.namespaceURI)
    // A prefix can be declared on the child itself, as in generated chart references.
    const child = namespace ? children(node, namespace, local)[index] : Array.from(node.childNodes)
      .filter((candidate): candidate is Element => candidate.nodeType === 1 && (candidate as Element).tagName === name)[index]
    if (!child) throw new Error(`目标对象内的原生节点不存在：${name}[${index}]`)
    node = child
  }
  const declarations = { ...namespaces }
  const seen = new Set<string>()
  for (let current: Node | null = node; current?.nodeType === 1; current = current.parentNode) {
    for (const attribute of Array.from((current as Element).attributes)) {
      if (attribute.namespaceURI !== 'http://www.w3.org/2000/xmlns/') continue
      const prefix = attribute.name === 'xmlns' ? '' : attribute.localName
      if (!seen.has(prefix)) { declarations[prefix] = attribute.value; seen.add(prefix) }
    }
  }
  const replacement = edit.xml === null ? null : parseOfficeObjectXml(edit.xml, declarations)
  if (replacement && !edit.insert && !(allowRootTypeChange && node === root)
    && (replacement.namespaceURI !== node.namespaceURI || replacement.localName !== node.localName))
    throw new Error(`替换节点须保持 ${node.tagName} 的元素类型。需要改变子级元素类型时，请编辑其父节点。`)
  return { node, replacement }
}

export function replaceNativeObjectNode(node: Element, replacement: Element | null, insert?: OfficeNativeObjectEdit['insert']): boolean {
  const parent = node.parentNode
  if (!parent) throw new Error(`目标节点没有原生父容器：${node.tagName}`)
  if (!replacement) parent.removeChild(node)
  else if (insert) parent.insertBefore(node.ownerDocument.importNode(replacement, true), insert === 'before' ? node : node.nextSibling)
  else {
    const serializer = new XMLSerializer()
    if (serializer.serializeToString(node) === serializer.serializeToString(replacement)) return false
    parent.replaceChild(node.ownerDocument.importNode(replacement, true), node)
  }
  return true
}
