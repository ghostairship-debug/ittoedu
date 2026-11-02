import path from 'node:path'
import { createHash } from 'node:crypto'
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate'
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'

export const NS = {
  word: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  sheet: 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
  slide: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  drawing: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  relationship: 'http://schemas.openxmlformats.org/package/2006/relationships',
  officeRelationship: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
}

export function descendants(node: Document | Element, namespace: string, name: string): Element[] {
  return Array.from(node.getElementsByTagNameNS(namespace, name))
}
export function children(node: Element, namespace: string, name: string): Element[] {
  return Array.from(node.childNodes).filter((value): value is Element => value.nodeType === 1 && (value as Element).namespaceURI === namespace && (name === '*' || (value as Element).localName === name))
}
export function textOf(node: Document | Element, namespace: string, name = 't'): string {
  return descendants(node, namespace, name).map(value => value.textContent ?? '').join('')
}

export class OfficePackage {
  readonly parts: Record<string, Uint8Array>
  readonly changed = new Set<string>()
  private readonly documents = new Map<string, Document>()
  private readonly binaryChanges = new Set<string>()
  private readonly original: Uint8Array
  constructor(bytes: Uint8Array) { this.original = Uint8Array.from(bytes); this.parts = unzipSync(bytes) }
  partVersion(name: string): string {
    const bytes = this.parts[name]
    if (!bytes) throw new Error(`Office 文件缺少部件：${name}`)
    return createHash('sha256').update(bytes).digest('hex')
  }
  xml(name: string): Document {
    const cached = this.documents.get(name)
    if (cached) return cached
    const bytes = this.parts[name]
    if (!bytes) throw new Error(`Office 文件缺少部件：${name}`)
    const errors: string[] = []
    const xml = new DOMParser({ errorHandler: { warning: () => {}, error: message => errors.push(message), fatalError: message => errors.push(message) } }).parseFromString(strFromU8(bytes), 'application/xml')
    if (errors.length || !xml.documentElement) throw new Error(`Office XML 无法解析：${name} ${errors[0] ?? ''}`)
    this.documents.set(name, xml)
    return xml
  }
  write(name: string) { this.binaryChanges.delete(name); this.changed.add(name) }
  /** Raw assets are package parts too; do not route their bytes through an XML serializer. */
  setBinary(name: string, bytes: Uint8Array): void {
    const previous = this.parts[name]
    if (previous?.length === bytes.length && previous.every((value, index) => value === bytes[index])) return
    this.parts[name] = Uint8Array.from(bytes)
    this.documents.delete(name)
    this.binaryChanges.add(name); this.changed.add(name)
  }
  remove(name: string) { delete this.parts[name]; this.documents.delete(name); this.binaryChanges.delete(name); this.changed.add(name) }
  main(): string {
    const relation = descendants(this.xml('_rels/.rels'), NS.relationship, 'Relationship').find(value => value.getAttribute('Type')?.endsWith('/officeDocument'))
    if (!relation) throw new Error('文件没有 Office 主文档关系')
    return this.target('', relation.getAttribute('Target') ?? '')
  }
  relationships(part: string): Map<string, string> {
    const name = path.posix.join(path.posix.dirname(part), '_rels', path.posix.basename(part) + '.rels')
    if (!this.parts[name]) return new Map()
    return new Map(descendants(this.xml(name), NS.relationship, 'Relationship')
      .filter(value => value.getAttribute('TargetMode') !== 'External')
      .map(value => [value.getAttribute('Id') ?? '', this.target(part, value.getAttribute('Target') ?? '')]))
  }
  private target(part: string, target: string): string {
    return path.posix.normalize(target.startsWith('/') ? target.slice(1) : path.posix.join(path.posix.dirname(part), target))
  }
  save(): Uint8Array {
    // Parsing a package is not an edit. Preserve ZIP metadata and signatures when nothing changed.
    if (this.changed.size === 0) return Uint8Array.from(this.original)
    for (const name of this.changed) if (this.parts[name] && !this.binaryChanges.has(name)) this.parts[name] = strToU8(new XMLSerializer().serializeToString(this.xml(name)))
    return zipSync(this.parts)
  }
}

/** Preserve existing run properties, hyperlinks, pictures, bookmarks and field structure. */
export function replaceTextRange(container: Element, namespace: string, start: number, length: number, replacement: string) {
  if (/[\r\n\t]/.test(replacement)) throw new Error('此局部文本编辑保留现有段落结构；换行或制表请使用独立段落创建')
  const texts = descendants(container, namespace, 't')
  if (!texts.length) {
    if (start !== 0 || length !== 0) throw new Error('文本位置不存在')
    const prefix = namespace === NS.word ? 'w' : 'a'
    const run = container.ownerDocument.createElementNS(namespace, `${prefix}:r`)
    const text = container.ownerDocument.createElementNS(namespace, `${prefix}:t`)
    text.textContent = replacement
    text.setAttribute('xml:space', 'preserve')
    run.appendChild(text); container.appendChild(run)
    return
  }
  let offset = 0
  let inserted = false
  const end = start + length
  for (const text of texts) {
    const original = text.textContent ?? ''
    const finish = offset + original.length
    if (finish >= start && offset <= end) {
      const prefix = original.slice(0, Math.max(0, start - offset))
      const suffix = original.slice(Math.max(0, end - offset))
      text.textContent = prefix + (inserted ? '' : replacement) + suffix
      text.setAttribute('xml:space', 'preserve')
      inserted = true
    }
    offset = finish
  }
  if (!inserted) throw new Error('文本位置不存在')
}
