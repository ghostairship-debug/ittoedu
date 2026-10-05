import type { ComponentAsset, ComponentAuthorSpot, ComponentEdit, CourseProjectV10, JsonValue } from '../../../../shared/contracts/component-platform'
import type { DocumentResources } from '../../../../shared/workbench/document'
import { decodeHtmlEntities, scanHtmlSource } from '../../../../shared/html/htmlSourceScanner'
import { componentSourceOwnerIsShared } from '../../../runtime/componentSourceAuthoring'

export function authorSpotValue(data: JsonValue, path: readonly string[]): JsonValue | undefined {
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
  if (region?.kind === 'data' && region.encoding === 'html-attribute' && region.path?.length === 1 && region.path[0] === 'html') {
    const token = 'cw-resource:spot-' + crypto.randomUUID()
    const bindings = authorSpotValue(project.instances[spot.instanceId].data, ['resourceBindings'])
    edits.push(...authorSpotEdits(project, spot, token, resources), bindings && typeof bindings === 'object' && !Array.isArray(bindings)
      ? { type: 'data.set', instanceId: spot.instanceId, path: ['resourceBindings', token], value: imported.meta.id }
      : { type: 'data.set', instanceId: spot.instanceId, path: ['resourceBindings'], value: { [token]: imported.meta.id } })
  } else edits.push(...authorSpotEdits(project, spot, imported.meta.id, resources))
  return edits
}
