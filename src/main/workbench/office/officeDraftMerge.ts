import { Buffer } from 'node:buffer'
import { XMLSerializer } from '@xmldom/xmldom'
import { strToU8 } from 'fflate'
import { NS, OfficePackage } from './officePackage'
import { OfficeDraftMergeConflict } from './officeDraftMergeError'
import { inspectPartRelationships, validateOfficePackageChanges } from './officeNativeDependencies'
import { address, recalculateXlsx, sheets, updateDimension } from './xlsxContent'
import type { OfficeContentResult } from '../../../shared/workbench/officeFiles'
import { mergedDocumentSource, planDocumentSourceMerge } from '../../../shared/document/sourceMerge'
import type { OfficeObjectEdit } from '../../../shared/workbench/officeObjectEdit'
import { compareXlsxStyleEdit, editXlsxObject } from './xlsxObjectCompiler'

const xmlns = 'http://www.w3.org/2000/xmlns/'
const xmlSpace = 'http://www.w3.org/XML/1998/namespace'
const equalBytes = (left?: Uint8Array, right?: Uint8Array) => left === right
  || left !== undefined && right !== undefined && Buffer.from(left.buffer, left.byteOffset, left.byteLength).equals(right)
const element = (node: Node): node is Element => node.nodeType === 1
const qualified = (value: Element | Attr) => `{${value.namespaceURI ?? ''}}${value.localName}`
const attributes = (value: Element) => new Map(Array.from(value.attributes)
  .filter(attr => attr.namespaceURI !== xmlns).map(attr => [qualified(attr), attr]))
const childNodes = (value: Element) => {
  const nodes = Array.from(value.childNodes)
  return nodes.some(element) && value.getAttributeNS(xmlSpace, 'space') !== 'preserve'
    ? nodes.filter(node => node.nodeType !== 3 || !!node.nodeValue?.trim()) : nodes
}
const sameOrder = (left: string[], right: string[]) => left.length === right.length && left.every((id, index) => id === right[index])
const conflict = (location: string, reason: string): never => { throw new OfficeDraftMergeConflict(location, reason) }

function relationshipUses(xml: Document) {
  const counts = new Map<string, number>()
  for (const node of Array.from(xml.getElementsByTagName('*'))) {
    for (const attribute of Array.from(node.attributes)) if (attribute.namespaceURI === NS.officeRelationship)
      counts.set(attribute.value, (counts.get(attribute.value) ?? 0) + 1)
  }
  return counts
}

function assertNewRelationshipInputs(base: OfficePackage, proposed: OfficePackage, latest: OfficePackage, owner: string) {
  if (!/\.xml$/i.test(owner) || !proposed.parts[owner]) return
  const before = base.parts[owner] ? relationshipUses(base.xml(owner)) : new Map<string, number>()
  const added = [...relationshipUses(proposed.xml(owner))].filter(([id, count]) => count > (before.get(id) ?? 0))
  if (!added.length) return
  const expectedLinks = new Map(inspectPartRelationships(base, owner).map(relation => [relation.id, relation]))
  const proposedLinks = new Map(inspectPartRelationships(proposed, owner).map(relation => [relation.id, relation]))
  const currentLinks = new Map(inspectPartRelationships(latest, owner).map(relation => [relation.id, relation]))
  const seen = new Set<string>()
  const contentDependency = (type: string) => !/\/(hyperlink|slide)$/i.test(type)
  const verifyDependency = (part: string, origin: string): void => {
    if (seen.has(part) || !base.parts[part] || !equalBytes(base.parts[part], proposed.parts[part])) return
    seen.add(part)
    if (!equalBytes(base.parts[part], latest.parts[part])) conflict(origin, `新引用的依赖部件已修改：${part}`)
    const expected = inspectPartRelationships(base, part).sort((a, b) => a.id.localeCompare(b.id))
    const current = inspectPartRelationships(latest, part).sort((a, b) => a.id.localeCompare(b.id))
    if (JSON.stringify(expected) !== JSON.stringify(current)) conflict(origin, `新引用的依赖关系已修改：${part}`)
    for (const relation of expected) if (relation.part && contentDependency(relation.type)) verifyDependency(relation.part, origin)
  }
  for (const [id] of added) {
    const expected = expectedLinks.get(id), requested = proposedLinks.get(id), current = currentLinks.get(id)
    const origin = `${owner}#${id}`
    if (expected && JSON.stringify(expected) === JSON.stringify(requested) && JSON.stringify(expected) !== JSON.stringify(current))
      conflict(origin, '新引用的现有关联目标已改变')
    if (requested?.part && contentDependency(requested.type)) verifyDependency(requested.part, origin)
  }
}

function nodeKey(node: Node): { key: string; explicit: boolean; label: string } {
  if (!element(node)) return { key: `#${node.nodeType}`, explicit: false, label: node.nodeName }
  let id: string | null | undefined
  if (node.namespaceURI === NS.slide && ['sp', 'pic', 'graphicFrame', 'grpSp', 'cxnSp'].includes(node.localName)) {
    const nonvisual = Array.from(node.childNodes).filter(element).find(value => value.localName.startsWith('nv'))
    id = nonvisual && Array.from(nonvisual.childNodes).filter(element).find(value => value.localName === 'cNvPr')?.getAttribute('id')
  }
  id ||= node.getAttributeNS(NS.officeRelationship, 'id') || node.getAttributeNS(NS.word, 'id')
    || node.getAttributeNS('http://schemas.microsoft.com/office/word/2010/wordml', 'paraId')
    || node.getAttribute('id') || node.getAttribute('Id')
  if (!id) {
    if (node.namespaceURI === NS.sheet) id = node.getAttribute('r') || (node.localName === 'numFmt' ? node.getAttribute('numFmtId') : null)
    else if (!node.namespaceURI || node.namespaceURI.endsWith('/content-types')) id = node.getAttribute('PartName') || node.getAttribute('Extension')
  }
  return { key: qualified(node) + (id ? `[${id}]` : ''), explicit: !!id, label: node.nodeName + (id ? `[${id}]` : '') }
}

function reconcile<T>(base: T, proposed: T, latest: T, location: string): T {
  if (proposed === base || proposed === latest) return latest
  if (latest === base) return proposed
  return conflict(location, '同一内容已被另一项操作修改')
}

class XmlMerge {
  private signatures = new WeakMap<Node, string>()
  private serializer = new XMLSerializer()
  constructor(private readonly recalculate: boolean) {}

  private signature(node?: Node): string | undefined {
    if (!node) return undefined
    const existing = this.signatures.get(node)
    if (existing !== undefined) return existing
    const value = this.serializer.serializeToString(node)
    this.signatures.set(node, value)
    return value
  }

  /** Match stable OOXML identifiers first, then exact siblings and positional runs. */
  private align(base: Node[], side: Node[], other: Node[], location: string) {
    const group = (nodes: Node[]) => {
      const result = new Map<string, number[]>()
      nodes.forEach((node, index) => {
        const { key } = nodeKey(node), indexes = result.get(key)
        if (indexes) indexes.push(index)
        else result.set(key, [index])
      })
      return result
    }
    const baseGroups = group(base), sideGroups = group(side), otherGroups = group(other), identities: string[] = []
    for (const [key, indexes] of sideGroups) {
      const old = baseGroups.get(key) ?? []
      const matched = new Set<number>()
      const exact = new Map<string, number[]>()
      for (const index of old) {
        const signature = this.signature(base[index])!
        const matches = exact.get(signature)
        if (matches) matches.push(index)
        else exact.set(signature, [index])
      }
      const sideSignatures = indexes.map(index => this.signature(side[index])!)
      const duplicated = new Set(sideSignatures).size !== sideSignatures.length || [...exact.values()].some(matches => matches.length > 1)
      if (duplicated && old.length === indexes.length) {
        // Equal-size unkeyed groups cannot identify a particular copy of
        // repeated content. A value becoming equal to its neighbor is an edit.
        for (const [index, next] of indexes.entries()) identities[next] = `old:${old[index]}`
        continue
      }
      if (duplicated && old.length !== indexes.length) {
        const otherIndexes = otherGroups.get(key) ?? []
        if (!sameOrder(old.map(index => this.signature(base[index])!), otherIndexes.map(index => this.signature(other[index])!)))
          conflict(location + '/' + nodeKey(side[indexes[0]!]!).label, '有重复的无标识节点，无法定位并发增删')
      }
      for (const index of indexes) {
        const id = exact.get(this.signature(side[index])!)?.shift()
        if (id !== undefined) { identities[index] = `old:${id}`; matched.add(id) }
      }
      const oldRest = old.filter(index => !matched.has(index))
      const newRest = indexes.filter(index => identities[index] === undefined)
      if (oldRest.length && newRest.length && old.length === indexes.length
        && indexes.some((index, at) => identities[index] !== undefined && identities[index] !== `old:${old[at]}`)) {
        const otherIndexes = otherGroups.get(key) ?? []
        if (!sameOrder(old.map(index => this.signature(base[index])!), otherIndexes.map(index => this.signature(other[index])!)))
          conflict(location + '/' + nodeKey(side[indexes[0]!]!).label, '无标识节点可能同时重排与改写，无法可靠匹配')
      }
      if (oldRest.length && newRest.length && oldRest.length !== newRest.length)
        conflict(location + '/' + nodeKey(side[indexes[0]!]!).label, '同类节点增删与内容变化同时发生，原位置无法唯一对应')
      if (oldRest.length) {
        for (const [index, next] of newRest.entries()) identities[next] = `old:${oldRest[index]}`
      } else {
        const counts = new Map<string, number>()
        for (const next of newRest) {
          const node = side[next]!, { explicit } = nodeKey(node)
          const fingerprint = explicit ? key : this.signature(node)!
          const number = counts.get(fingerprint) ?? 0
          counts.set(fingerprint, number + 1)
          identities[next] = `new:${fingerprint}:${number}`
        }
      }
    }
    return { order: identities, nodes: new Map(identities.map((id, index) => [id, side[index]!])) }
  }

  private order(base: string[], proposed: string[], latest: string[], location: string): string[] {
    if (sameOrder(proposed, latest) || sameOrder(base, proposed)) return latest
    if (sameOrder(base, latest)) return proposed
    const baseIds = new Set(base), newIds = new Set(proposed), currentIds = new Set(latest)
    const common = base.filter(id => newIds.has(id) && currentIds.has(id)), commonIds = new Set(common)
    const move = (side: string[]) => side.filter(id => commonIds.has(id))
    const aiMoves = !sameOrder(common, move(proposed)), humanMoves = !sameOrder(common, move(latest))
    if (aiMoves && humanMoves && !sameOrder(move(proposed), move(latest)))
      return conflict(location, '同一组节点的顺序被分别调整')
    const survives = (id: string) => !baseIds.has(id) || commonIds.has(id)
    const primary = (aiMoves ? proposed : latest).filter(survives)
    const secondary = (aiMoves ? latest : proposed).filter(survives)
    const primaryIds = new Set(primary)
    let previous: string | undefined
    for (const [index, id] of secondary.entries()) {
      if (primaryIds.has(id)) { previous = id; continue }
      const next = secondary.slice(index + 1).find(value => primaryIds.has(value))
      const left = previous === undefined ? -1 : primary.indexOf(previous)
      const right = next === undefined ? primary.length : primary.indexOf(next)
      if (left >= right) return conflict(location, '新增节点依赖的相邻位置已改变')
      primary.splice(right, 0, id)
      previous = id
      primaryIds.add(id)
    }
    return primary
  }

  node(base: Node | undefined, proposed: Node | undefined, latest: Node | undefined, target: Document, location: string): Node | undefined {
    const before = this.signature(base), requested = this.signature(proposed), current = this.signature(latest)
    if (requested === before || requested === current) return latest && target.importNode(latest, true)
    if (current === before) return proposed && target.importNode(proposed, true)
    const parent = base?.parentNode
    if (base?.nodeType === 3 && proposed?.nodeType === 3 && latest?.nodeType === 3
      && parent && element(parent) && parent.localName === 't'
      && [NS.drawing, NS.word, NS.sheet].includes(parent.namespaceURI ?? '')) {
      const plan = planDocumentSourceMerge(base.nodeValue ?? '', proposed.nodeValue ?? '', latest.nodeValue ?? '')
      if (plan.conflicts.length) return conflict(location, '同一段文字范围被分别修改')
      return target.createTextNode(mergedDocumentSource(plan))
    }
    if (!base || !proposed || !latest || !element(base) || !element(proposed) || !element(latest)
      || qualified(base) !== qualified(proposed) || qualified(base) !== qualified(latest))
      return conflict(location, '同一节点已修改、替换或删除')
    if (base.namespaceURI === NS.sheet && base.localName === 'dimension') return target.importNode(latest, true)
    const next = target.importNode(latest, false) as Element
    const oldAttrs = attributes(base), aiAttrs = attributes(proposed), humanAttrs = attributes(latest)
    for (const key of new Set([...oldAttrs.keys(), ...aiAttrs.keys(), ...humanAttrs.keys()])) {
      const before = oldAttrs.get(key), edited = aiAttrs.get(key), current = humanAttrs.get(key)
      const attribute = edited ?? current ?? before!
      const value = reconcile(before?.value, edited?.value, current?.value, `${location}/@${attribute.name}`)
      if (value === current?.value) continue
      if (value === undefined) next.removeAttributeNS(attribute.namespaceURI, attribute.localName)
      else if (attribute.namespaceURI) next.setAttributeNS(attribute.namespaceURI, attribute.name, value)
      else next.setAttribute(attribute.name, value)
    }
    const baseChildren = childNodes(base), proposedChildren = childNodes(proposed), latestChildren = childNodes(latest)
    const oldOrder = baseChildren.map((_, index) => `old:${index}`)
    const ai = this.align(baseChildren, proposedChildren, latestChildren, location), human = this.align(baseChildren, latestChildren, proposedChildren, location)
    // These collections use numeric positions as external references. Two competing
    // insertions can assign the same index to different definitions.
    if (base.namespaceURI === NS.sheet && ['fonts', 'fills', 'borders', 'cellXfs', 'cellStyleXfs', 'dxfs', 'sst'].includes(base.localName)
      && !sameOrder(oldOrder, ai.order) && !sameOrder(oldOrder, human.order) && !sameOrder(ai.order, human.order))
      return conflict(location, '共享索引被同时分配或重排')
    const nodes = new Map<string, Node>()
    for (const id of new Set([...oldOrder, ...ai.order, ...human.order])) {
      const before = id.startsWith('old:') ? baseChildren[Number(id.slice(4))] : undefined
      const edited = ai.nodes.get(id), current = human.nodes.get(id), named = before ?? edited ?? current!
      const label = nodeKey(named).label
      const occurrence = before && !nodeKey(before).explicit ? `#${Number(id.slice(4)) + 1}` : ''
      const value = this.node(before, edited, current, target, `${location}/${label}${occurrence}`)
      if (value) nodes.set(id, value)
    }
    const ordered = this.order(oldOrder, ai.order, human.order, location).flatMap(id => nodes.get(id) ?? [])
    if (base.namespaceURI === NS.sheet && base.localName === 'sheetData' && ordered.every(node => element(node) && node.localName === 'row'))
      ordered.sort((a, b) => Number((a as Element).getAttribute('r')) - Number((b as Element).getAttribute('r')))
    if (base.namespaceURI === NS.sheet && base.localName === 'row' && ordered.every(node => element(node) && node.localName === 'c'))
      ordered.sort((a, b) => address((a as Element).getAttribute('r') ?? '').column - address((b as Element).getAttribute('r') ?? '').column)
    for (const child of ordered) next.appendChild(child)
    return next
  }

  root(base: Element, proposed: Element, latest: Element, target: Document, part: string) {
    // Formula results are generated, not authored values. Recalculate once on the
    // merged grid instead of treating two independently recalculated caches as edits.
    if (this.recalculate && base.namespaceURI === NS.sheet && base.localName === 'worksheet') {
      for (const root of [base, proposed, latest]) {
        for (const cell of Array.from(root.getElementsByTagNameNS(NS.sheet, 'c'))) {
          if (!cell.getElementsByTagNameNS(NS.sheet, 'f').length) continue
          cell.removeAttribute('t')
          for (const child of Array.from(cell.childNodes).filter(element)) {
            if (child.namespaceURI === NS.sheet && ['v', 'is'].includes(child.localName)) cell.removeChild(child)
          }
        }
      }
    }
    return this.node(base, proposed, latest, target, part)
  }
}

/** Merge only the OPC parts the proposed edit actually changed. */
export function mergeOfficeDraft(baseBytes: Uint8Array, proposedBytes: Uint8Array, latestBytes: Uint8Array, recalculate = false) {
  const base = new OfficePackage(baseBytes), proposed = new OfficePackage(proposedBytes), latest = new OfficePackage(latestBytes)
  const changed = [...new Set([...Object.keys(base.parts), ...Object.keys(proposed.parts)])]
    .filter(part => !equalBytes(base.parts[part], proposed.parts[part]))
  // Use the current graph before introducing any proposed part.
  for (const part of changed) if (!equalBytes(proposed.parts[part], latest.parts[part]))
    assertNewRelationshipInputs(base, proposed, latest, part)
  // Conversely, a dependency edit must not silently affect a concurrently
  // introduced user reference to that dependency.
  for (const part of Object.keys(latest.parts)) {
    if (!equalBytes(base.parts[part], latest.parts[part]) && !equalBytes(proposed.parts[part], latest.parts[part]))
      assertNewRelationshipInputs(base, latest, proposed, part)
  }
  for (const part of changed) {
    const before = base.parts[part], edited = proposed.parts[part], current = latest.parts[part]
    if (equalBytes(edited, current)) continue
    if (equalBytes(before, current)) {
      if (edited) latest.setBinary(part, edited)
      else latest.remove(part)
      continue
    }
    if (!before || !edited || !current || !/\.(xml|rels)$/i.test(part))
      conflict(part, '同一文件部件被同时替换、增加或删除')
    const xml = latest.xml(part)
    const root = new XmlMerge(recalculate).root(base.xml(part).documentElement, proposed.xml(part).documentElement, xml.documentElement, xml, part)
    if (!root) conflict(part, '合入后缺少 XML 根节点')
    xml.replaceChild(root!, xml.documentElement)
    const bytes = strToU8(new XMLSerializer().serializeToString(xml))
    latest.setBinary(part, bytes)
  }
  return { bytes: latest.save(), changedParts: [...latest.changed] }
}

export function mergeOfficeContent(base: Uint8Array, proposed: OfficeContentResult, latest: Uint8Array, objectEdit?: OfficeObjectEdit): OfficeContentResult {
  const unchanged = () => ({ ...proposed, bytes: latest, changedParts: [], calculation: undefined })
  if (equalBytes(base, proposed.bytes) || equalBytes(latest, proposed.bytes)) return unchanged()
  if (objectEdit?.format === 'xlsx' && 'style' in objectEdit) {
    const pkg = new OfficePackage(latest)
    const { changed, conflicts } = compareXlsxStyleEdit(new OfficePackage(base), new OfficePackage(proposed.bytes), pkg, objectEdit)
    if (conflicts.length) conflict(`${objectEdit.target.sheet}!${objectEdit.target.cell}/${conflicts.join('、')}`, '同一单元格样式已修改')
    if (!changed.length) return unchanged()
    editXlsxObject(pkg, objectEdit)
    const bytes = pkg.save(), changedParts = [...pkg.changed]
    validateOfficePackageChanges(latest, bytes, changedParts)
    return { ...proposed, bytes, changedParts }
  }
  const recalculate = proposed.format === 'xlsx' && !!proposed.calculation
  const merged = mergeOfficeDraft(base, proposed.bytes, latest, recalculate)
  if (!merged.changedParts.length) return unchanged()
  try { validateOfficePackageChanges(latest, merged.bytes, merged.changedParts) }
  catch (error) { conflict(merged.changedParts.join('、'), error instanceof Error ? error.message : String(error)) }
  if (proposed.format !== 'xlsx') return { ...proposed, ...merged }
  const pkg = new OfficePackage(merged.bytes)
  for (const sheet of sheets(pkg)) if (merged.changedParts.includes(sheet.part)) {
    updateDimension(sheet)
    pkg.write(sheet.part)
  }
  const calculated = recalculate ? recalculateXlsx(pkg) : undefined
  return { ...proposed, bytes: pkg.save(), changedParts: [...new Set([...merged.changedParts, ...pkg.changed])],
    ...(calculated ?? {}) }
}
