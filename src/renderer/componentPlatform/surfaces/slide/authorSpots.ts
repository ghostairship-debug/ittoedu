import type { ComponentAsset, ComponentAuthorGeometry, ComponentAuthorSpot, ComponentEdit, CourseProjectV10, JsonValue } from '../../../../shared/contracts/component-platform'
import type { DocumentResources } from '../../../../shared/workbench/document'
import { decodeHtmlEntities, indexHtmlElements, scanHtmlSource } from '../../../../shared/html/htmlSourceScanner'
import { componentSourceOwnerIsShared } from '../../../runtime/componentSourceAuthoring'
import { prepareWebAuthoringRecordEdits } from '../../../../components/web/authoringRecords'

function usesRecordOwner(project: CourseProjectV10, spot: ComponentAuthorSpot): boolean {
  if (!spot.authorKey || !spot.binding) return false
  return !spot.sourceRegion && !spot.dataPath || authorSpotValue(project.instances[spot.instanceId]?.data,
    ['authoringRecords', spot.authorKey]) !== undefined
}

export function authorSpotGeometryEdits(project: CourseProjectV10, spot: ComponentAuthorSpot, geometry: ComponentAuthorGeometry,
  originalProject: CourseProjectV10 = project): ComponentEdit[] {
  if (!Object.keys(geometry).length) return []
  if (spot.geometry && spot.authorKey) {
    const current = authorSpotValue(project.instances[spot.instanceId]?.data, ['authoringRecords', spot.authorKey, 'overrides', 'geometry'])
    const values = current && typeof current === 'object' && !Array.isArray(current) ? current as ComponentAuthorGeometry : {}
    const defaults: ComponentAuthorGeometry = { translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0 }
    for (const key of Object.keys(geometry) as (keyof ComponentAuthorGeometry)[]) {
      if ((values[key] ?? defaults[key]) !== (spot.geometry.author[key] ?? defaults[key]))
        throw new Error('此处作者几何已变化，本次手势已保留原结果，请重新操作')
    }
  }
  // A static precise source address can receive software identity in the same transaction as its first geometry.
  // Dynamic same-looking items still need their real semantic binding; a DOM index is not persistent identity.
  if ((spot.bindingStatus === 'unresolved' || spot.bindingStatus === 'source-required') && spot.sourceRegion?.kind === 'data'
    && spot.sourceRegion.path?.length === 1 && spot.sourceRegion.path[0] === 'html' && spot.authorKey && spot.binding) {
    const instance = project.instances[spot.instanceId], data = instance?.data
    const source = authorSpotValue(data, ['html']), original = authorSpotValue(originalProject.instances[spot.instanceId]?.data, ['html'])
    if (typeof source !== 'string' || source !== original) throw new Error('精确HTML源地址已变化，本次手势未写入，请重新操作')
    if (authorSpotValue(data, ['authoringRecords', spot.authorKey]) !== undefined) throw new Error('原作者记录尚未唯一绑定，本次手势未写入')
    authorSpotEdit(project, spot, spot.initialValue)
    const region = spot.sourceRegion, scan = scanHtmlSource(source)
    const owner = indexHtmlElements(source, scan.tokens).elements.filter(element => spot.kind === 'image'
      ? element.startTag.start <= region.start && element.startTag.end >= region.end
      : element.content.start <= region.start && element.content.end >= region.end)
      .sort((a, b) => (a.full.end - a.full.start) - (b.full.end - b.full.start))[0]
    if (!owner || owner.name !== spot.binding.path.at(-1)?.tag) throw new Error('精确HTML父元素已变化，本次手势未写入')
    const token = scan.tokens.find(token => token.kind === 'start-tag' && token.span.start === owner.startTag.start)!
    const existing = token.attributes?.find(attribute => attribute.name === 'data-cw-author-key')
    if (existing && existing.decodedValue !== spot.authorKey) throw new Error('HTML对象已有其他作者身份，本次手势未写入')
    const key = spot.authorKey.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
    const at = owner.startTag.end - (source.slice(owner.startTag.end - 2, owner.startTag.end) === '/>' ? 2 : 1)
    const html = existing ? source : source.slice(0, at) + ` data-cw-author-key="${key}"` + source.slice(at)
    const binding = structuredClone(spot.binding), step = binding.path.at(-1)!
    step.attributes = { ...step.attributes, 'data-cw-author-key': spot.authorKey }
    const anchored = { ...project, instances: { ...project.instances, [spot.instanceId]: { ...instance,
      data: { ...data as Record<string, JsonValue>, html } } } }
    return [{ type: 'data.set', instanceId: spot.instanceId, path: ['html'], value: html },
      ...prepareWebAuthoringRecordEdits(anchored, { ...spot, binding, bindingStatus: 'bound' }, { geometry })]
  }
  return Object.keys(geometry).length ? prepareWebAuthoringRecordEdits(project, spot, { geometry }) : []
}

export function authorSpotValue(data: JsonValue | undefined, path: readonly string[]): JsonValue | undefined {
  let current: JsonValue | undefined = data
  for (const key of path) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, JsonValue>)[key]
  }
  return current
}

/** Only a registered author address becomes an edit; observed DOM text is never the writer. */
export function authorSpotEdit(project: CourseProjectV10, spot: ComponentAuthorSpot, value: JsonValue): ComponentEdit {
  const instance = project.instances[spot.instanceId]
  if (!instance) throw new Error('原可编辑对象已不存在')
  const region = spot.sourceRegion
  if (region) {
    const implementation = instance.implementationOverride ?? project.definitions[instance.definitionId]?.implementation
    const source = region.kind === 'implementation' && implementation?.kind === 'source'
      ? implementation.source : region.kind === 'data' ? authorSpotValue(instance.data, region.path ?? []) : undefined
    if (typeof source !== 'string' || typeof value !== 'string' || typeof spot.initialValue !== 'string'
      || !Number.isInteger(region.start) || !Number.isInteger(region.end) || region.start < 0 || region.end < region.start
      || region.end > source.length)
      throw new Error('此处没有匹配原内容的精确源码范围，请打开组件源码编辑')
    const raw = source.slice(region.start, region.end)
    let replacement = value
    if (region.encoding && region.kind === 'data') {
      const tokens = scanHtmlSource(source).tokens
      const attribute = tokens.flatMap(token => token.attributes ?? []).find(item => item.valueSpan?.start === region.start && item.valueSpan.end === region.end)
      const text = tokens.some(token => token.kind === 'text' && token.span.start <= region.start && token.span.end >= region.end)
      if ((region.encoding === 'html-text' ? !text : !attribute) || decodeHtmlEntities(raw) !== spot.initialValue)
        throw new Error('此处HTML内容已变化，请重新打开编辑')
      replacement = value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      if (region.encoding === 'html-attribute') {
        replacement = replacement.replace(/"/g, '&quot;').replace(/'/g, '&#39;')
        if (attribute?.quote === '') replacement = replacement.replace(/[\s=`]/g, char => '&#' + char.charCodeAt(0) + ';')
      }
    } else if (raw !== spot.initialValue) throw new Error('此处源码已变化，请重新打开编辑')
    const next = source.slice(0, region.start) + replacement + source.slice(region.end)
    if (region.kind === 'implementation' && implementation?.kind === 'source' && !implementation.workspace)
      return { type: 'implementation.set', instanceId: instance.id, implementation: { ...implementation, source: next } }
    return { type: 'data.set', instanceId: instance.id, path: region.path ?? [], value: next }
  }
  if (!spot.dataPath || JSON.stringify(authorSpotValue(instance.data, spot.dataPath)) !== JSON.stringify(spot.initialValue))
    throw new Error('此处可编辑内容已变化，请重新打开编辑')
  return { type: 'data.set', instanceId: instance.id, path: spot.dataPath, value }
}

/** Source ranges address the entry by default, or the logical filename in region.path. */
export function authorSpotEdits(project: CourseProjectV10, spot: ComponentAuthorSpot, value: JsonValue, resources: DocumentResources): ComponentEdit[] {
  const instance = project.instances[spot.instanceId]
  if (!instance) throw new Error('原可编辑对象已不存在')
  if (usesRecordOwner(project, spot)) {
    if (typeof value !== 'string') throw new Error('此处需要文字或图片地址')
    return prepareWebAuthoringRecordEdits(project, spot, spot.kind === 'text' ? { text: value } : { src: value })
  }
  const implementation = instance.implementationOverride ?? project.definitions[instance.definitionId]?.implementation
  if (spot.sourceRegion?.kind !== 'implementation' || implementation?.kind !== 'source' || !implementation.workspace)
    return [authorSpotEdit(project, spot, value)]
  const { ownerId, entry } = implementation.workspace
  const name = spot.sourceRegion.path?.join('/') || entry, files = resources.components[ownerId], bytes = files?.[name]
  if (!files || !bytes) throw new Error(`原源码文件“${name}”已不存在，请打开组件源码编辑。`)
  let source: string
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  catch { throw new Error(`源码文件“${name}”不是 UTF-8 文本，请打开组件源码编辑。`) }
  const { workspace: _workspace, source: _source, ...metadata } = implementation
  // Reuse the exact source-range comparison and replacement for both source representations.
  const inlineProject = { ...project, instances: { ...project.instances, [instance.id]: { ...instance,
    implementationOverride: { ...metadata, source } } } }
  const edit = authorSpotEdit(inlineProject, spot, value)
  if (edit.type !== 'implementation.set' || edit.implementation?.kind !== 'source' || typeof edit.implementation.source !== 'string')
    throw new Error('原精确源码范围已变化，请重新打开编辑。')
  const reuse = !componentSourceOwnerIsShared(project, instance.id, ownerId)
  const nextOwnerId = reuse ? ownerId : crypto.randomUUID()
  return [{ type: 'component.files.set', ownerId: nextOwnerId, expectedFiles: reuse ? structuredClone(files) : null,
    files: { ...structuredClone(files), [name]: new TextEncoder().encode(edit.implementation.source) } },
  { type: 'implementation.set', instanceId: instance.id,
    implementation: { ...metadata, workspace: { ownerId: nextOwnerId, entry } } }]
}

export function dataWithSpotEdit(data: JsonValue, edit: Extract<ComponentEdit, { type: 'data.set' }>): JsonValue {
  if (!edit.path.length) return structuredClone(edit.value)
  const next = structuredClone(data)
  let owner = next as Record<string, JsonValue>
  for (const key of edit.path.slice(0, -1)) owner = owner[key] as Record<string, JsonValue>
  owner[edit.path.at(-1)!] = structuredClone(edit.value)
  return next
}

export function authorSpotImageEdits(project: CourseProjectV10, spot: ComponentAuthorSpot, imported: { meta: ComponentAsset; bytes: Uint8Array }, resources: DocumentResources = { assets: {}, components: {} }): ComponentEdit[] {
  const edits: ComponentEdit[] = [{ type: 'asset.add', asset: imported.meta, bytes: imported.bytes }]
  const region = spot.sourceRegion
  if (usesRecordOwner(project, spot) || region?.kind === 'data' && region.encoding === 'html-attribute' && region.path?.length === 1 && region.path[0] === 'html') {
    const token = 'cw-resource:spot-' + crypto.randomUUID()
    const bindings = authorSpotValue(project.instances[spot.instanceId].data, ['resourceBindings'])
    edits.push(...authorSpotEdits(project, spot, token, resources), bindings && typeof bindings === 'object' && !Array.isArray(bindings)
      ? { type: 'data.set', instanceId: spot.instanceId, path: ['resourceBindings', token], value: imported.meta.id }
      : { type: 'data.set', instanceId: spot.instanceId, path: ['resourceBindings'], value: { [token]: imported.meta.id } })
  } else edits.push(...authorSpotEdits(project, spot, imported.meta.id, resources))
  return edits
}
