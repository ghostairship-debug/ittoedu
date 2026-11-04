import path from 'node:path'
import { strFromU8, strToU8 } from 'fflate'
import type { OfficeNativeObjectEdit, OfficeNativeRelationshipInspection } from '../../../shared/workbench/officeObjectEdit'
import { children, descendants, NS, OfficePackage } from './officePackage'

const contentTypesPart = '[Content_Types].xml'
const contentTypeNs = 'http://schemas.openxmlformats.org/package/2006/content-types'
const relationshipsType = 'application/vnd.openxmlformats-package.relationships+xml'
const packagePath = /^[^/\\:?#]+(?:\/[^/\\:?#]+)*$/

type Dependencies = NonNullable<OfficeNativeObjectEdit['dependencies']>
type Relationship = NonNullable<Dependencies['relationships']>[number]

const relationshipPart = (owner: string) => owner ? path.posix.join(path.posix.dirname(owner), '_rels', path.posix.basename(owner) + '.rels') : '_rels/.rels'
const ownerOf = (rels: string) => rels === '_rels/.rels' ? '' : path.posix.join(path.posix.dirname(path.posix.dirname(rels)), path.posix.basename(rels, '.rels'))

function targetPart(owner: string, raw: string): string {
  const target = raw.split('#')[0]!
  if (!target) return owner
  // Relationship targets are URI paths. Do not silently traverse above package root.
  const normalized = path.posix.normalize(target.startsWith('/') ? target.slice(1) : path.posix.join(path.posix.dirname(owner), target))
  if (!packagePath.test(normalized) || normalized === '.' || normalized === '..' || normalized.startsWith('../'))
    throw new Error(`Office 包内关系目标无效：${owner || '/'} → ${raw}`)
  return normalized
}

function hasTarget(pkg: OfficePackage, target: string): boolean {
  if (Object.hasOwn(pkg.parts, target)) return true
  try { return Object.hasOwn(pkg.parts, decodeURI(target)) } catch { return false }
}

export function describeNativePart(pkg: OfficePackage, part: string) {
  if (!Object.hasOwn(pkg.parts, part) || part.endsWith('/')) throw new Error(`Office 文件缺少部件：${part}`)
  const contentType = types(pkg).get(part) ?? undefined
  return { part, partVersion: pkg.partVersion(part), ...(contentType ? { contentType } : {}) }
}

export function readNativePart(pkg: OfficePackage, part: string) {
  const metadata = describeNativePart(pkg, part)
  const bytes = pkg.parts[part]!
  const content = /(?:\/xml|\+xml)$/i.test(metadata.contentType ?? '') || /\.(?:xml|rels)$/i.test(part)
    ? { xml: strFromU8(bytes) } : { base64: Buffer.from(bytes).toString('base64') }
  return { packagePart: metadata, ...content, relationships: inspectPartRelationships(pkg, part) }
}

function types(pkg: OfficePackage) {
  const document = pkg.xml(contentTypesPart), root = document.documentElement
  if (root.namespaceURI !== contentTypeNs || root.localName !== 'Types') throw new Error('Office 内容类型目录无效')
  const defaults = new Map(descendants(root, contentTypeNs, 'Default').map(node => [node.getAttribute('Extension')?.toLowerCase(), node.getAttribute('ContentType')]))
  const overrides = new Map(descendants(root, contentTypeNs, 'Override').map(node => [node.getAttribute('PartName')?.replace(/^\//, ''), node.getAttribute('ContentType')]))
  return { document, root, get: (part: string) => overrides.get(part) ?? defaults.get(path.posix.extname(part).slice(1).toLowerCase()) }
}

function registerType(pkg: OfficePackage, name: string, contentType: string): void {
  const { document, root, get } = types(pkg)
  if (get(name) === contentType) return
  const override = document.createElementNS(contentTypeNs, 'Override')
  override.setAttribute('PartName', '/' + name)
  override.setAttribute('ContentType', contentType)
  root.appendChild(override)
  pkg.write(contentTypesPart)
}

function relationNodes(pkg: OfficePackage, owner: string): Element[] {
  const filename = relationshipPart(owner)
  if (!Object.hasOwn(pkg.parts, filename)) return []
  const document = pkg.xml(filename)
  if (document.documentElement.namespaceURI !== NS.relationship || document.documentElement.localName !== 'Relationships')
    throw new Error(`Office 关系目录无效：${filename}`)
  return descendants(document, NS.relationship, 'Relationship')
}

function appendRelationships(pkg: OfficePackage, owner: string, additions: readonly Relationship[]): void {
  if (!additions.length) return
  const filename = relationshipPart(owner)
  if (!Object.hasOwn(pkg.parts, filename)) {
    pkg.setBinary(filename, strToU8(`<Relationships xmlns="${NS.relationship}"/>`))
    registerType(pkg, filename, relationshipsType)
  }
  const ids = new Set(relationNodes(pkg, owner).map(node => node.getAttribute('Id')))
  const xml = pkg.xml(filename)
  for (const addition of additions) {
    if (ids.has(addition.id)) throw new Error(`Office 关系 ID 已使用：${filename}#${addition.id}`)
    ids.add(addition.id)
    const relation = xml.createElementNS(NS.relationship, 'Relationship')
    relation.setAttribute('Id', addition.id)
    relation.setAttribute('Type', addition.type)
    relation.setAttribute('Target', addition.target)
    if (addition.targetMode) relation.setAttribute('TargetMode', addition.targetMode)
    xml.documentElement.appendChild(relation)
  }
  pkg.write(filename)
}

function relationshipIds(node: Element): Set<string> {
  const result = new Set<string>()
  const walk = (element: Element): void => {
    for (const attr of Array.from(element.attributes)) if (attr.namespaceURI === NS.officeRelationship) result.add(attr.value)
    for (const child of Array.from(element.childNodes)) if (child.nodeType === 1) walk(child as Element)
  }
  walk(node)
  return result
}

export function inspectPartRelationships(pkg: OfficePackage, owner: string): OfficeNativeRelationshipInspection[] {
  return relationNodes(pkg, owner).map(node => {
    const id = node.getAttribute('Id') ?? '', type = node.getAttribute('Type') ?? '', target = node.getAttribute('Target') ?? ''
    if (node.getAttribute('TargetMode') === 'External') return { id, type, target, targetMode: 'External' }
    let part = targetPart(owner, target)
    if (!Object.hasOwn(pkg.parts, part)) {
      try { const decoded = decodeURI(part); if (Object.hasOwn(pkg.parts, decoded)) part = decoded } catch { /* Preserve the original unresolved URI. */ }
    }
    return { id, type, target, part }
  })
}

export function inspectNativeDependencies(pkg: OfficePackage, owner: string, root: Element | undefined, requested?: string) {
  const ids = root ? relationshipIds(root) : new Set<string>()
  const relationships = inspectPartRelationships(pkg, owner).filter(relation => ids.has(relation.id))
  if (!requested) return { relationships }
  const visited = new Set<string>(), pending = relationships.flatMap(relation => relation.part ? [relation.part] : [])
  for (const part of pending) {
    if (visited.has(part)) continue
    visited.add(part)
    if (!Object.hasOwn(pkg.parts, part)) continue
    const local = inspectPartRelationships(pkg, part)
    if (part === requested) {
      const { packagePart: { contentType }, ...content } = readNativePart(pkg, part)
      if (!contentType) throw new Error(`Office 依赖缺少内容类型：${part}`)
      return { relationships, dependencySource: { path: part, contentType, ...content } }
    }
    for (const relation of local) if (relation.part) pending.push(relation.part)
  }
  throw new Error(`对象未引用指定依赖，或依赖不存在：${requested}`)
}

/** Change the edited object's dependency graph without rewriting unrelated references. */
export function attachNativeDependencies(pkg: OfficePackage, owner: string, original: Element, replacement: Element | null, dependencies?: Dependencies): void {
  if (!dependencies) return
  const additions = dependencies.parts ?? [], relationships = dependencies.relationships ?? []
  const ids = replacement ? relationshipIds(replacement) : new Set()
  for (const relation of relationships) if (!ids.has(relation.id))
    throw new Error(`新关系未被本次修改的对象引用：${owner}#${relation.id}`)
  const reachable = new Set<string>()
  const collect = (part: string): void => {
    if (reachable.has(part)) return
    reachable.add(part)
    for (const relation of additions.find(addition => addition.path === part)?.relationships ?? [])
      if (!relation.targetMode) collect(targetPart(part, relation.target))
  }
  for (const relation of relationships) if (!relation.targetMode) collect(targetPart(owner, relation.target))
  for (const part of additions) {
    if (!packagePath.test(part.path) || part.path.split('/').some(segment => segment === '.' || segment === '..')
      || part.path === contentTypesPart || part.path.endsWith('.rels') || Object.hasOwn(pkg.parts, part.path))
      throw new Error(`新增依赖须使用新的包内部件路径：${part.path}`)
    if (!reachable.has(part.path)) throw new Error(`新增部件未关联本次修改的对象：${part.path}`)
    if (part.base64 && !/^(?:[\w+/]{4})*(?:[\w+/]{2}==|[\w+/]{3}=)?$/.test(part.base64))
      throw new Error(`新增部件不是有效的 Base64：${part.path}`)
    pkg.setBinary(part.path, part.xml !== undefined ? strToU8(part.xml) : Buffer.from(part.base64!, 'base64'))
    registerType(pkg, part.path, part.contentType)
  }
  for (const part of additions) appendRelationships(pkg, part.path, part.relationships ?? [])
  const oldIds = relationshipIds(original)
  const removeParts = dependencies.removeParts ?? []
  if (removeParts.length) {
    const pending = inspectPartRelationships(pkg, owner).filter(relation => oldIds.has(relation.id) && relation.part).map(relation => relation.part!)
    const originalGraph = new Set<string>()
    for (const part of pending) {
      if (originalGraph.has(part) || !Object.hasOwn(pkg.parts, part)) continue
      originalGraph.add(part)
      for (const relation of inspectPartRelationships(pkg, part)) if (relation.part) pending.push(relation.part)
    }
    for (const part of removeParts) if (part === owner || part === pkg.main() || !originalGraph.has(part))
      throw new Error(`只能移除原对象依赖图中的部件：${part}`)
  }
  if (dependencies.removeRelationships?.length) {
    const remaining = relationshipIds(pkg.xml(owner).documentElement)
    const existing = new Map(relationNodes(pkg, owner).map(relation => [relation.getAttribute('Id'), relation]))
    for (const id of new Set(dependencies.removeRelationships)) {
      const relation = existing.get(id)
      if (!oldIds.has(id) || !relation) throw new Error(`该关系不属于原目标节点：${owner}#${id}`)
      if (remaining.has(id)) throw new Error(`当前文件中仍有节点引用此关系：${owner}#${id}`)
      relation.parentNode!.removeChild(relation)
    }
    pkg.write(relationshipPart(owner))
  }
  appendRelationships(pkg, owner, relationships)
  if (removeParts.length) {
    const { root } = types(pkg)
    for (const part of new Set(removeParts)) for (const name of [part, relationshipPart(part)]) {
      if (!Object.hasOwn(pkg.parts, name)) continue
      pkg.remove(name)
      for (const override of descendants(root, contentTypeNs, 'Override')) if (override.getAttribute('PartName') === '/' + name) {
        override.parentNode!.removeChild(override)
        pkg.write(contentTypesPart)
      }
    }
  }
}

function invalidNativeStructure(pkg: OfficePackage, part: string): string[] {
  if (!Object.hasOwn(pkg.parts, part)) return []
  const document = pkg.xml(part)
  const root = document.documentElement
  if (root.namespaceURI === NS.word && root.localName === 'document') {
    const body = children(root, NS.word, 'body')[0]
    if (!body) return ['Word 主文档缺少正文容器']
    const invalidInBody = new Set(['tc', 'tr', 'r', 't', 'tcPr', 'tblPr', 'trPr', 'pPr', 'rPr'])
    return children(body, NS.word, '*').flatMap(node => invalidInBody.has(node.localName)
      ? [`Word 正文不能直接包含 ${node.tagName}`] : [])
  }
  if (root.namespaceURI !== NS.slide || root.localName !== 'sld') return []
  const ids = new Set<string>()
  const broken: string[] = []
  const nonvisual: Readonly<Record<string, string>> = { sp: 'nvSpPr', pic: 'nvPicPr', graphicFrame: 'nvGraphicFramePr', grpSp: 'nvGrpSpPr', cxnSp: 'nvCxnSpPr' }
  const container = descendants(document, NS.slide, 'spTree')[0]
  const scanShapes = (node: Element): void => {
    for (const shape of children(node, NS.slide, '*')) {
      const property = nonvisual[shape.localName]
      if (!property) continue
      const properties = children(shape, NS.slide, property)[0]
      if (!properties || !children(properties, NS.slide, 'cNvPr')[0]?.getAttribute('id'))
        broken.push(`PPT 对象 ${shape.tagName} 缺少 ${property}/cNvPr 的形状 ID`)
      if (shape.localName === 'grpSp') scanShapes(shape)
    }
  }
  if (container) scanShapes(container)
  else broken.push('PPT 幻灯片缺少对象容器 spTree')
  for (const node of descendants(document, NS.slide, 'cNvPr')) {
    const id = node.getAttribute('id') ?? ''
    if (!id || ids.has(id)) broken.push(`重复或缺失的形状 ID ${id}`)
    ids.add(id)
  }
  const nodes = [
    ...['spTgt', 'bldP', 'bldDgm', 'bldOleChart', 'bldGraphic'].flatMap(name => descendants(document, NS.slide, name)),
    ...['stCxn', 'endCxn'].flatMap(name => descendants(document, NS.drawing, name)),
  ]
  for (const node of nodes) {
    const id = node.getAttribute(node.namespaceURI === NS.slide ? 'spid' : 'id')
    if (id && !ids.has(id)) broken.push(`${node.tagName} 引用了不存在的形状 ${id}`)
  }
  return broken
}

/** Check the changed package graph. Pre-existing broken references do not veto unrelated changes. */
export function validateOfficePackageChanges(original: Uint8Array, candidate: Uint8Array, changedParts: readonly string[]): void {
  const before = new OfficePackage(original), after = new OfficePackage(candidate)
  const affected = new Set<string>(), typesAfter = types(after)
  const removed = new Set(changedParts.filter(part => !hasTarget(after, part)))
  for (const part of changedParts) {
    if (part.endsWith('/')) continue
    if (part.endsWith('.rels')) affected.add(ownerOf(part))
    else if (part !== contentTypesPart) affected.add(part)
    if (part !== contentTypesPart && Object.hasOwn(after.parts, part) && !typesAfter.get(part))
      throw new Error(`Office 部件缺少内容类型：${part}`)
  }
  if (removed.size) for (const rels of Object.keys(after.parts).filter(part => part.endsWith('.rels'))) {
    const owner = ownerOf(rels)
    const relations = relationNodes(after, owner)
    if (relations.some(node => node.getAttribute('TargetMode') !== 'External'
      && removed.has(targetPart(owner, node.getAttribute('Target') ?? '')))) affected.add(owner)
  }
  for (const owner of affected) {
    const oldRelations = relationNodes(before, owner), newRelations = relationNodes(after, owner)
    const ids = new Set<string>()
    for (const relation of newRelations) {
      const id = relation.getAttribute('Id') ?? ''
      if (!id || ids.has(id)) throw new Error(`Office 关系 ID 缺失或重复：${owner}#${id}`)
      ids.add(id)
      if (relation.getAttribute('TargetMode') === 'External') continue
      const target = targetPart(owner, relation.getAttribute('Target') ?? '')
      if (hasTarget(after, target)) continue
      const preexisting = !hasTarget(before, target) && oldRelations.some(node => node.getAttribute('Id') === id
        && node.getAttribute('Target') === relation.getAttribute('Target'))
      if (!preexisting) throw new Error(`Office 关系缺少目标部件：${owner}#${id} → ${target}`)
    }
    if (owner && Object.hasOwn(after.parts, owner) && (/\+xml$/i.test(typesAfter.get(owner) ?? '') || /\.xml$/i.test(owner))) {
      const originalIds = Object.hasOwn(before.parts, owner) ? relationshipIds(before.xml(owner).documentElement) : new Set<string>()
      const oldIds = new Set(oldRelations.map(node => node.getAttribute('Id')))
      for (const id of relationshipIds(after.xml(owner).documentElement)) if (!ids.has(id) && (!originalIds.has(id) || oldIds.has(id)))
        throw new Error(`Office XML 引用了不存在的关系：${owner}#${id}`)
      const remaining = invalidNativeStructure(before, owner)
      for (const broken of invalidNativeStructure(after, owner)) {
        const previous = remaining.indexOf(broken)
        if (previous < 0) throw new Error(`${owner}：${broken}`)
        remaining.splice(previous, 1)
      }
    }
  }
}
