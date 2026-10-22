import type { ComponentAsset, ComponentAuthorGeometry, ComponentAuthorSpot, ComponentAuthorField, ComponentAuthorRecord, ComponentEdit, CourseProjectV10, JsonValue } from '../../../shared/contracts/component-platform'
import type { DocumentResources } from '../../../shared/workbench/document'
import { decodeHtmlEntities, indexHtmlElements, scanHtmlSource } from '../../../shared/html/htmlSourceScanner'
import { componentSourceOwnerIsShared } from '../source/sourceAuthoringEdits'
import { assertAuthorRecordBinding, prepareWebAuthoringRecordEdits } from '../../../components/web/authoringRecords'
import { encodeAuthorSourceText, readAuthorSourceText } from './sourceAuthorText'
import { equalComponentValue } from '../../drivers/courseV10Operations'
import { locateHtmlAuthorRecordSource } from '../../../shared/html/htmlSourceLocator'
import { imageDataSchema, replaceImageSource } from '../../../components/image/data'

function usesRecordOwner(project: CourseProjectV10, spot: ComponentAuthorField & { instanceId: string }): boolean {
  if (!spot.authorKey || !spot.binding) return false
  const path = spot.dataPath
  const recordField = spot.fieldScope === 'authoring' && path?.length === 4 && path[0] === 'records' && path[1] === spot.authorKey
    && path[2] === 'overrides' && path[3] === (spot.kind === 'text' ? 'text' : 'src')
  const record = project.instances[spot.instanceId]?.authoring?.records?.[spot.authorKey]
  return !spot.sourceRegion && (!path || recordField) || Object.hasOwn(record?.overrides ?? {}, spot.kind === 'text' ? 'text' : 'src')
}

export function authorSpotGeometryEdits(project: CourseProjectV10, spot: ComponentAuthorSpot, geometry: ComponentAuthorGeometry,
  originalProject: CourseProjectV10 = project): ComponentEdit[] {
  if (!Object.keys(geometry).length) return []
  if (spot.geometry && spot.authorKey) {
    const current = project.instances[spot.instanceId]?.authoring?.records?.[spot.authorKey]?.overrides.geometry
    const values = current && typeof current === 'object' && !Array.isArray(current) ? current as ComponentAuthorGeometry : {}
    const defaults: ComponentAuthorGeometry = { translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0 }
    for (const key of Object.keys(geometry) as (keyof ComponentAuthorGeometry)[]) {
      if ((values[key] ?? defaults[key]) !== (spot.geometry.author[key] ?? defaults[key]))
        throw new Error('此处作者几何已变化，本次手势已保留原结果，请重新操作')
    }
  }
  return authorSpotPresentationEdits(project, spot, { geometry }, originalProject)
}

function authorSpotPresentationEdits(project: CourseProjectV10, spot: ComponentAuthorSpot,
  patch: ComponentAuthorRecord['overrides'], originalProject: CourseProjectV10 = project): ComponentEdit[] {
  // A static precise source address can receive software identity in the same transaction as its first geometry.
  // Dynamic same-looking items still need their real semantic binding; a DOM index is not persistent identity.
  if ((spot.bindingStatus === 'unresolved' || spot.bindingStatus === 'source-required') && spot.sourceRegion?.kind === 'data'
    && spot.sourceRegion.path?.length === 1 && spot.sourceRegion.path[0] === 'html' && spot.authorKey && spot.binding) {
    const instance = project.instances[spot.instanceId], data = instance?.data
    const source = authorSpotValue(data, ['html']), original = authorSpotValue(originalProject.instances[spot.instanceId]?.data, ['html'])
    if (typeof source !== 'string' || source !== original) throw new Error('精确HTML源地址已变化，本次手势未写入，请重新操作')
    if (instance.authoring?.records?.[spot.authorKey] !== undefined) throw new Error('原作者记录尚未唯一绑定，本次手势未写入')
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
      ...prepareWebAuthoringRecordEdits(anchored, { ...spot, binding, bindingStatus: 'bound' }, patch)]
  }
  return prepareWebAuthoringRecordEdits(project, spot, patch)
}

/** Local formatting uses the same author records and canonical transaction as local geometry. */
export function authorSpotStyleSourceRegion(project: CourseProjectV10, spot: ComponentAuthorSpot): ComponentAuthorSpot['sourceRegion'] | undefined {
  if (spot.sourceRegion?.kind === 'data' && spot.sourceRegion.path?.length === 1 && spot.sourceRegion.path[0] === 'html'
    && spot.sourceRegion.encoding === 'html-text') return spot.sourceRegion
  const instance = project.instances[spot.instanceId], record = spot.authorKey && instance?.authoring?.records?.[spot.authorKey]
  const source = authorSpotValue(instance?.data, ['html'])
  if (!record || typeof source !== 'string' || Object.keys(record.scope ?? {}).some(key => key.startsWith('react:'))) return undefined
  const located = locateHtmlAuthorRecordSource(source, record, spot.authorKey!)
  return located?.valueSpan ? { kind: 'data', path: ['html'], ...located.valueSpan, encoding: 'html-text' } : undefined
}

export function authorSpotIsSvgText(spot: Pick<ComponentAuthorSpot, 'binding'>): boolean {
  const boundary = [...spot.binding?.path ?? []].reverse().find(step => /^(?:svg|foreignobject)$/i.test(step.tag))
  return boundary?.tag.toLowerCase() === 'svg'
}

export function authorSpotStyleEdits(project: CourseProjectV10, spot: ComponentAuthorSpot, style: Record<string, string>): ComponentEdit[] {
  if (!Object.keys(style).length) return []
  if (spot.kind !== 'text') throw new Error('此处不是可格式化文字')
  if (spot.geometry) return authorSpotPresentationEdits(project, spot, { style })
  const region = authorSpotStyleSourceRegion(project, spot)
  // A text node sharing its DOM parent must not format neighboring text or elements.
  // Wrap its exact static HTML source, then let the original runtime parse that source.
  if (region?.kind !== 'data' || region.path?.length !== 1 || region.path[0] !== 'html' || region.encoding !== 'html-text'
    || !spot.binding || !spot.authorKey) throw new Error('此片段由程序共享排版，请在组件源码中修改格式')
  const instance = project.instances[spot.instanceId], source = authorSpotValue(instance?.data, ['html'])
  if (typeof source !== 'string') throw new Error('原HTML源码已不存在')
  const previous = instance.authoring?.records?.[spot.authorKey]
  authorSpotEdit(project, { ...spot, sourceRegion: region, initialValue: spot.sourceRegion ? spot.initialValue : previous!.binding.baseline },
    spot.sourceRegion ? spot.initialValue : previous!.binding.baseline)
  const scan = scanHtmlSource(source), index = indexHtmlElements(source, scan.tokens)
  const owner = index.elements.filter(element => element.content.start <= region.start && element.content.end >= region.end)
    .sort((a, b) => a.full.end - a.full.start - (b.full.end - b.full.start))[0]
  if (!owner || owner.name !== spot.binding.path.at(-1)?.tag) throw new Error('精确HTML父元素已变化，请重新选择')
  const key = spot.authorKey.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  const wrapperTag = authorSpotIsSvgText(spot) ? 'tspan' : 'span'
  const html = source.slice(0, region.start) + `<${wrapperTag} data-cw-author-key="${key}">` + source.slice(region.start, region.end) + `</${wrapperTag}>` + source.slice(region.end)
  const binding = structuredClone(spot.binding)
  binding.path.push({ tag: wrapperTag, index: index.elements.filter(element => element.parent === index.elements.indexOf(owner) && element.full.start < region.start).length,
    attributes: { 'data-cw-author-key': spot.authorKey } })
  delete binding.textIndex
  const scope = spot.scope && Object.fromEntries(Object.entries(spot.scope).map(([name, value]) => {
    const dom = /^dom:(\d+):(.+)$/.exec(name)
    return [dom ? `dom:${Number(dom[1]) + 1}:${dom[2]}` : name, value]
  }))
  const records = instance.authoring?.records
  assertAuthorRecordBinding(previous, spot)
  const nextRecords = records ? { ...records } : undefined
  if (nextRecords) delete nextRecords[spot.authorKey]
  const anchored = { ...project, instances: { ...project.instances, [instance.id]: { ...instance,
    data: { ...instance.data as Record<string, JsonValue>, html },
    ...(nextRecords ? { authoring: { ...instance.authoring, records: nextRecords } } : {}) } } }
  const siblingBindings: ComponentEdit[] = Object.entries(records ?? {}).flatMap(([key, record]) => key !== spot.authorKey && record.kind === 'text'
    && equalComponentValue(record.scope ?? {}, spot.scope ?? {}) && equalComponentValue(record.binding.path, spot.binding!.path)
    && (record.binding.textIndex ?? 0) > (spot.binding!.textIndex ?? 0)
    ? [{ type: 'authoring.set', instanceId: instance.id, path: ['records', key, 'binding', 'textIndex'], value: (record.binding.textIndex ?? 0) - 1 }]
    : [])
  return [{ type: 'data.set', instanceId: instance.id, path: ['html'], value: html },
    ...siblingBindings,
    ...prepareWebAuthoringRecordEdits(anchored, { ...spot, binding, ...(scope ? { scope } : {}), bindingStatus: 'bound' },
      { ...previous?.overrides, style: { ...previous?.overrides.style, ...style } })]
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
export function authorSpotEdit(project: CourseProjectV10, spot: ComponentAuthorField & { instanceId: string }, value: JsonValue): ComponentEdit {
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
    } else {
      if (readAuthorSourceText(source, region) !== spot.initialValue) throw new Error('此处源码已变化，请重新打开编辑')
      replacement = encodeAuthorSourceText(source, region, value)
    }
    const next = source.slice(0, region.start) + replacement + source.slice(region.end)
    if (region.kind === 'implementation' && implementation?.kind === 'source' && !implementation.workspace)
      return { type: 'implementation.set', instanceId: instance.id, implementation: { ...implementation, source: next } }
    return { type: 'data.set', instanceId: instance.id, path: region.path ?? [], value: next }
  }
  if (!spot.dataPath || JSON.stringify(authorSpotValue((spot.fieldScope === 'authoring' ? instance.authoring : instance.data) as JsonValue, spot.dataPath)) !== JSON.stringify(spot.initialValue))
    throw new Error('此处可编辑内容已变化，请重新打开编辑')
  return { type: spot.fieldScope === 'authoring' ? 'authoring.set' : 'data.set', instanceId: instance.id, path: spot.dataPath, value }
}

/** Source ranges address the entry by default, or the logical filename in region.path. */
export function authorSpotEdits(project: CourseProjectV10, spot: ComponentAuthorField & { instanceId: string }, value: JsonValue, resources: DocumentResources): ComponentEdit[] {
  const instance = project.instances[spot.instanceId]
  if (!instance) throw new Error('原可编辑对象已不存在')
  if (usesRecordOwner(project, spot)) {
    if (typeof value !== 'string') throw new Error('此处需要文字或图片地址')
    return prepareWebAuthoringRecordEdits(project, spot, spot.kind === 'text' ? { text: value } : { src: value })
  }
  const implementation = instance.implementationOverride ?? project.definitions[instance.definitionId]?.implementation
  const withCurrentBinding = (edits: ComponentEdit[]): ComponentEdit[] => {
    const record = spot.authorKey && instance.authoring?.records?.[spot.authorKey]
    if (!record || typeof value !== 'string') return edits
    assertAuthorRecordBinding(record, spot)
    // Changing the real author field also advances its DOM binding baseline;
    // unrelated geometry/style remain on that same object after the redraw.
    return [...edits, { type: 'authoring.set', instanceId: instance.id, path: ['records', spot.authorKey!, 'binding'],
      value: { ...record.binding, baseline: value } as unknown as JsonValue }]
  }
  if (spot.sourceRegion?.kind !== 'implementation' || implementation?.kind !== 'source' || !implementation.workspace)
    return withCurrentBinding([authorSpotEdit(project, spot, value)])
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
  return withCurrentBinding([{ type: 'component.files.set', ownerId: nextOwnerId, expectedFiles: reuse ? structuredClone(files) : null,
    files: { ...structuredClone(files), [name]: new TextEncoder().encode(edit.implementation.source) } },
  { type: 'implementation.set', instanceId: instance.id,
    implementation: { ...metadata, workspace: { ownerId: nextOwnerId, entry } } }])
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
    const bindings = project.instances[spot.instanceId].authoring?.resourceBindings
    edits.push(...authorSpotEdits(project, spot, token, resources), bindings && typeof bindings === 'object' && !Array.isArray(bindings)
      ? { type: 'authoring.set', instanceId: spot.instanceId, path: ['resourceBindings', token], value: imported.meta.id }
      : { type: 'authoring.set', instanceId: spot.instanceId, path: ['resourceBindings'], value: { [token]: imported.meta.id } })
  } else {
    const replacementEdits = authorSpotEdits(project, spot, imported.meta.id, resources)
    const instance = project.instances[spot.instanceId]
    const implementation = instance.implementationOverride ?? project.definitions[instance.definitionId]?.implementation
    if (spot.kind === 'image' && !region && spot.fieldScope !== 'authoring'
      && spot.dataPath?.length === 1 && spot.dataPath[0] === 'assetId'
      && implementation?.kind === 'builtin' && implementation.key === 'guoling.image') {
      const replacement = replaceImageSource(imageDataSchema.parse(instance.data), imported.meta.id)
      replacementEdits.push({ type: 'data.set', instanceId: instance.id, path: ['originalAssetId'], value: replacement.originalAssetId })
    }
    edits.push(...replacementEdits)
  }
  return edits
}
