import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { marked } from 'marked'
import type { ToolRunGrant } from '../../../shared/workbench/tools'
import { isInsideRoot } from '../../../shared/workbench/executionPermission'
import type { ComponentProjectFile, ComponentProjectFileInput } from '../../../core/projectFiles/componentPlatform'
import { componentFileContentSource } from '../../../core/projectFiles/componentPlatform'
import type { ContentApplyIntent, ContentApplySource } from '../../../core/contentApply/planning/types'
import type { ComponentImplementation } from '../../../shared/contracts/component-platform'
import { readHtmlClosure, resolveSourceInputPath } from '../htmlImport/readHtmlClosure'
import { readComponentSourceClosure } from './componentSourceClosure'
import { prepareContentResources, prepareImageResource, type PreparedContentResource } from '../contentApply/resources/contentResources'
import { assetReferencePath, cssUrlReferences, projectReferencePath } from '../../../shared/composition/projectReferences'
import { parse, serialize, type DefaultTreeAdapterTypes } from 'parse5'
import type { HostImageInput } from '../../../core/tools/imageResource'
import { parseGeneratedImageReference } from '../../../shared/workbench/images'
import { decodeHtmlSource as decodeComponentHtmlSource } from '../../../shared/html/sourceEncoding'
export { decodeComponentHtmlSource }

const TEXT = new Set(['.html', '.htm', '.css', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.json', '.md', '.markdown', '.txt', '.svg'])
const SOURCE = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx'])

/** Author modules remain data leaves. Only newly needed dependencies and their admitted media accompany one edit. */
async function prepareWebModuleSource(input: ComponentProjectFileInput, file: ComponentProjectFile,
  references: ReadonlyMap<string, { bytes: Uint8Array; mediaType: string }>): Promise<ContentApplySource> {
  const target = file.webModule!, entry = path.posix.normalize(target.path)
  const suppliedEntry = input.sourceEntry ?? path.basename(input.filename)
  const supplied = new Map<string, Uint8Array>()
  for (const [name, bytes] of input.siblingFiles ?? []) supplied.set(path.posix.normalize(path.posix.join(path.posix.dirname(entry),
    path.posix.relative(path.posix.dirname(suppliedEntry), name))), bytes)
  const siblings = new Map(supplied), names = new Map<string, string>()
  for (const [name, code] of Object.entries(target.modules)) {
    const normalized = path.posix.normalize(name)
    if (names.has(normalized)) throw new Error(`作者模块路径重复：${name}；请先在对象数据中核对重复模块。`)
    names.set(normalized, name)
    // A neighboring disk draft must not overwrite a module already owned by this captured document.
    siblings.set(normalized, new TextEncoder().encode(code))
  }
  siblings.set(entry, new TextEncoder().encode(input.text!))
  for (const asset of Object.values(input.assetContext?.assets ?? {})) {
    const bytes = input.assetContext?.bytes[asset.id]
    if (bytes && !siblings.has(asset.path)) siblings.set(asset.path, bytes)
  }
  const sourcePath = `./${entry}`.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  const prepared = await prepareContentResources({ html: `<script type="module" src="${sourcePath}"></script>`,
    siblingFiles: siblings, resourceReferences: references }, randomUUID)
  input.diagnostics = [...input.diagnostics ?? [], ...prepared.diagnostics.map(issue => ({ ...issue, repairable: true }))]
  const changed = Object.entries({ [entry]: input.text!, ...prepared.modules }).filter(([name]) => name === entry || !names.has(name))
  const source: Extract<ContentApplySource, { kind: 'data' }> = { kind: 'data', fields: [], resourceEdits: [] }
  for (const [name, code] of changed) {
    const original = name === entry ? target.path : name
    if (target.modules[original] !== code) source.fields.push({ path: ['modules', original], value: code })
  }
  const bindings: Record<string, string> = Object.create(null)
  for (const resource of [...prepared.resources, ...prepared.unresolvedResources] as PreparedContentResource[]) {
    const tokens = [...new Set([`cw-resource:${resource.key}`, ...resource.origins.map(origin => origin.reference)
      .filter(reference => reference.startsWith('cw-resource:'))])].filter(token => changed.some(([, code]) => code.includes(token)))
    if (!tokens.length) continue
    const existing = resource.origins.map(origin => {
      const id = input.assetContext?.references?.[origin.reference]
        ?? (origin.reference.startsWith('cw-resource:') ? origin.reference.slice('cw-resource:'.length) : undefined)
      return id && input.assetContext?.assets[id] && input.assetContext.bytes[id] ? input.assetContext.assets[id] : undefined
    }).find(Boolean) ?? Object.values(input.assetContext?.assets ?? {}).find(asset => {
      const bytes = input.assetContext?.bytes[asset.id]
      return bytes?.byteLength === resource.bytes.byteLength && bytes.every((value, index) => value === resource.bytes[index])
    })
    const id = existing?.id ?? resource.image?.id ?? randomUUID()
    if (!existing) {
      const extension = resource.image?.path.split('.').at(-1) ?? resource.mediaType.split('/').at(-1)?.replace(/[^a-z0-9]/gi, '') ?? 'bin'
      source.resourceEdits!.push({ type: 'asset.add', asset: { id, path: `assets/${id}.${extension}`, mimeType: resource.mediaType,
        byteLength: resource.bytes.byteLength, ...(resource.image ? { kind: 'image' as const, width: resource.image.width, height: resource.image.height } : {}) }, bytes: resource.bytes })
    }
    for (const token of tokens) {
      const held = input.assetContext?.references?.[token]
      if (held) {
        const bytes = input.assetContext?.bytes[held]
        if (!bytes || bytes.byteLength !== resource.bytes.byteLength || bytes.some((value, index) => value !== resource.bytes[index]))
          throw new Error(`模块资源引用 ${token} 与当前对象的其他资源冲突；原稿已保留。`)
      } else bindings[token] = id
    }
  }
  if (Object.keys(bindings).length) {
    if (input.assetContext?.references) for (const [token, id] of Object.entries(bindings))
      source.fields.push({ path: ['resourceBindings', token], value: id })
    else source.fields.push({ path: ['resourceBindings'], value: bindings })
  }
  return source
}

/** Read-only source admission shares the task's actual file access and realpath closure. */
export async function readComponentProjectFileInput(input: {
  from: string
  fileAccess: ToolRunGrant['fileAccess']
  /** Host capture wins over disk; sourceHtml can be a captured independent page. */
  sourceHtml?: string
  currentSource?(filename: string): Promise<string | undefined>
  signal?: AbortSignal
}): Promise<ComponentProjectFileInput> {
  const { fileAccess, signal } = input
  const relativeRoot = fileAccess?.workspaceRoot ?? fileAccess?.assemblyRoot
  if (!fileAccess || !relativeRoot && (!fileAccess.assemblyReadRoots?.length || !path.isAbsolute(input.from)))
    throw new Error('按路径应用内容需要本任务的工作空间或装配目录。')
  signal?.throwIfAborted()
  const root = fileAccess.workspaceRoot ? (await resolveSourceInputPath(fileAccess.workspaceRoot)).filename : undefined
  const selected = await resolveSourceInputPath(relativeRoot ? path.resolve(relativeRoot, input.from) : input.from), filename = selected.filename
  const assemblyRoots = await Promise.all([...new Set([fileAccess.assemblyRoot, ...fileAccess.assemblyReadRoots ?? []]
    .filter((value): value is string => !!value))].map(async directory => (await resolveSourceInputPath(directory)).filename))
  const assemblyRoot = assemblyRoots.filter(directory => isInsideRoot(directory, filename)).sort((left, right) => right.length - left.length)[0]
  // These grants name individual run roots. Never join them through the common runs directory.
  const resourceRoot = assemblyRoot ?? (fileAccess.permission === 'full' ? path.parse(filename).root
    : root && isInsideRoot(root, filename) ? root : undefined)
  if (!resourceRoot) throw new Error('内容源文件位于本任务授权工作空间外，且不属于已提供的装配目录。')
  const extension = path.extname(filename).toLowerCase()
  const html = extension === '.html' || extension === '.htm'
  const opened = TEXT.has(extension) && (!html || input.sourceHtml === undefined || selected.missing)
    ? await input.currentSource?.(filename) : undefined
  if (selected.missing && opened === undefined) throw selected.missing
  const current = html && input.sourceHtml !== undefined ? input.sourceHtml : opened
  const bytes = current === undefined ? new Uint8Array(await fs.readFile(filename)) : new TextEncoder().encode(current)
  const text = current ?? (html ? decodeComponentHtmlSource(bytes).text : TEXT.has(extension) ? new TextDecoder('utf-8', { fatal: true }).decode(bytes) : undefined)
  if (extension === '.html' || extension === '.htm') {
    const closure = await readHtmlClosure({ htmlPath: filename, rootDir: resourceRoot,
      sourceHtml: text, currentSource: input.currentSource })
    signal?.throwIfAborted()
    return { filename, bytes, text, siblingFiles: closure.siblingFiles, diagnostics: closure.diagnostics.map(issue => ({ ...issue, repairable: true })) }
  }
  if (extension === '.css' || extension === '.md' || extension === '.markdown') {
    const closure = await readHtmlClosure({ htmlPath: filename, rootDir: resourceRoot,
      sourceHtml: extension === '.css' ? `<style>${text ?? ''}</style>` : await marked.parse(text ?? '', { async: false }), currentSource: input.currentSource })
    signal?.throwIfAborted()
    return { filename, bytes, text, siblingFiles: closure.siblingFiles, diagnostics: closure.diagnostics.map(issue => ({ ...issue, repairable: true })) }
  }
  if (SOURCE.has(extension) && text !== undefined) {
    const closure = await readComponentSourceClosure({ filename,
      rootDir: resourceRoot, bytes, text, signal, currentSource: input.currentSource })
    signal?.throwIfAborted()
    return { filename, bytes, text, sourceEntry: closure.entry, siblingFiles: closure.files, diagnostics: closure.diagnostics.map(issue => ({ ...issue, repairable: true })) }
  }
  signal?.throwIfAborted()
  return { filename, bytes, ...(text !== undefined ? { text } : {}) }
}

/** Format decoding only; geometry, resources, identities, diagnostics and writing remain with L19. */
export async function prepareComponentProjectFileSource(input: ComponentProjectFileInput, file: ComponentProjectFile,
  _intent: ContentApplyIntent, resources?: { readImage(source: string): Promise<HostImageInput | null> }): Promise<ContentApplySource> {
  const extension = path.extname(input.filename).toLowerCase()
  if (extension === '.json' && file.kind === 'structure' && input.text !== undefined && ['insert', 'redo'].includes(_intent)) {
    const source = componentFileContentSource(file, input.text, input)
    // A structure.json target can receive inline HTML; it still needs resource admission below.
    if (source.kind !== 'html') return source
  }
  const cssSource = file.binding?.kind === 'theme' && extension === '.css'
  const projectReferences = new Map<string, { bytes: Uint8Array; mediaType: string }>()
  const canonicalReferences = Object.values(input.assetContext?.assets ?? {}).map(asset => [`cw-resource:${asset.id}`, asset.id])
  const localReferences = Object.entries(input.assetContext?.references ?? {})
  for (const [reference, id] of input.resourceNamespace === 'project'
    ? [...localReferences, ...canonicalReferences] : [...canonicalReferences, ...localReferences]) {
    const asset = input.assetContext?.assets[id!], bytes = input.assetContext?.bytes[id!]
    if (asset && bytes) projectReferences.set(reference!, { bytes, mediaType: asset.mimeType ?? 'application/octet-stream' })
  }
  if (file.webModule) {
    if (_intent !== 'content' || input.text === undefined) throw new Error('作者模块需要文本内容；修改只作用当前模块。')
    return prepareWebModuleSource(input, file, projectReferences)
  }
  const resourceReference = (reference: string) => reference.startsWith('cw-result:')
    ? decodeURIComponent(reference.slice('cw-result:'.length))
    : parseGeneratedImageReference(reference) ? reference : null
  if (input.text !== undefined && (['.html', '.htm'].includes(extension) || cssSource
    || ['page', 'html', 'structure'].includes(file.kind) && ['insert', 'redo'].includes(_intent))) {
    const document = parse(cssSource ? `<style>${input.text.replace(/<\/style/gi, '<\\/style')}</style>` : input.text), admitted = new Map<string, Promise<string>>()
    const imageUrl = (reference: string): Promise<string> => {
      const resource = resourceReference(reference)
      if (resource === null) return Promise.resolve(reference)
      let result = admitted.get(reference)
      if (!result) {
        result = (async () => {
          if (!resources) throw new Error('当前源文没有授权图片资源读取能力')
          const source = await resources.readImage(resource)
          if (!source || !source.mimeType.startsWith('image/')) throw new Error('HTML 图片引用不属于本任务的可用图片资源')
          return `data:${source.mimeType};base64,${Buffer.from(source.bytes).toString('base64')}`
        })()
        admitted.set(reference, result)
      }
      return result
    }
    const css = async (value: string) => {
      const references = cssUrlReferences(value)
      let result = value
      for (const reference of [...references].reverse()) if (resourceReference(reference.reference) !== null)
        result = result.slice(0, reference.start) + `url("${await imageUrl(reference.reference)}")` + result.slice(reference.end)
      return result
    }
    const visit = async (node: DefaultTreeAdapterTypes.Node): Promise<void> => {
      if ('tagName' in node) {
        if (node.tagName === 'img') for (const attr of node.attrs) if (attr.name === 'src') attr.value = await imageUrl(attr.value)
        for (const attr of node.attrs) if (attr.name === 'style') attr.value = await css(attr.value)
        if (node.tagName === 'style') for (const child of node.childNodes) if (child.nodeName === '#text')
          (child as DefaultTreeAdapterTypes.TextNode).value = await css((child as DefaultTreeAdapterTypes.TextNode).value)
      }
      if ('childNodes' in node) for (const child of node.childNodes) await visit(child)
    }
    await visit(document)
    if (admitted.size) {
      const style = document.childNodes.find(node => 'tagName' in node)?.childNodes
        .find(node => 'tagName' in node && node.tagName === 'head')
      input.text = cssSource && style && 'childNodes' in style ? style.childNodes.flatMap(node => 'childNodes' in node
        ? node.childNodes.map(child => child.nodeName === '#text' ? (child as DefaultTreeAdapterTypes.TextNode).value : '') : []).join('') : serialize(document)
      input.bytes = new TextEncoder().encode(input.text)
    }
  }
  if (file.binding?.kind === 'asset' && file.mimeType?.startsWith('image/')) {
    const mediaTypes: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' }
    const image = await prepareImageResource({ bytes: input.bytes, mimeType: mediaTypes[extension] ?? file.mimeType, filename: path.basename(input.filename) }, randomUUID)
    input.bytes = image.bytes
    input.assetReplacement = { width: image.meta.width, height: image.meta.height, mimeType: image.meta.mimeType }
    return { kind: 'data', fields: [] }
  }
  if (input.text !== undefined && (file.binding?.kind === 'theme' || file.binding?.kind === 'flow')) {
    const markdown = file.binding.kind === 'flow' && file.binding.format === 'markdown'
    const html = file.binding.kind === 'theme' ? `<style>${input.text}</style>`
      : markdown ? await marked.parse(input.text, { async: false }) : input.text
    const supplied = new Map(input.siblingFiles ?? []), siblings = new Map(supplied)
    for (const asset of Object.values(input.assetContext?.assets ?? {})) {
      const bytes = input.assetContext?.bytes[asset.id]
      if (bytes && !siblings.has(asset.path)) siblings.set(asset.path, bytes)
    }
    const prepared = await prepareContentResources({ html, siblingFiles: siblings, resourceReferences: projectReferences }, randomUUID)
    const bindings = new Map<string, string>()
    input.resourceEdits = []; input.resourceBindings = {}
    input.diagnostics = [...input.diagnostics ?? [], ...prepared.diagnostics.map(issue => ({ ...issue, repairable: true }))]
    for (const resource of prepared.resources) {
      const existing = resource.origins.map(origin => {
        const id = input.assetContext?.references?.[origin.reference]
          ?? (origin.reference.startsWith('cw-resource:') ? origin.reference.slice('cw-resource:'.length) : undefined)
        if (id && input.assetContext?.assets[id] && input.assetContext.bytes[id]) return input.assetContext.assets[id]
        const path = assetReferencePath(origin.reference)
        return path && !supplied.has(projectReferencePath(origin.reference) ?? '')
          ? Object.values(input.assetContext?.assets ?? {}).find(asset => asset.path === path) : undefined
      }).find(Boolean)
      const id = existing?.id ?? resource.image?.id ?? randomUUID()
      const extension = resource.image?.path.split('.').at(-1) ?? resource.mediaType.split('/').at(-1)?.replace(/[^a-z0-9]/gi, '') ?? 'bin'
      const asset = existing ?? { id, path: `assets/${id}.${extension}`, mimeType: resource.mediaType, byteLength: resource.bytes.byteLength,
        ...(resource.image ? { kind: 'image' as const, width: resource.image.width, height: resource.image.height } : {}) }
      if (!existing) input.resourceEdits.push({ type: 'asset.add', asset, bytes: resource.bytes })
      bindings.set(`cw-resource:${resource.key}`, `../${asset.path}`)
      resource.origins.forEach(origin => { input.resourceBindings![origin.reference] = asset })
    }
    let normalized = prepared.html
    for (const [reference, path] of bindings) normalized = normalized.split(reference).join(path)
    input.preparedHtml = normalized
    if (file.binding.kind === 'theme') {
      const document = parse(normalized)
      const css: string[] = []
      const visit = (node: typeof document | typeof document.childNodes[number]) => {
        if ('tagName' in node && node.tagName === 'style') css.push(node.childNodes.map(child => child.nodeName === '#text' && 'value' in child ? child.value : '').join(''))
        else if ('childNodes' in node) node.childNodes.forEach(visit)
      }
      visit(document)
      return { kind: 'data', fields: [{ path: ['css'], value: css.join('\n') }] }
    }
    return markdown ? { kind: 'data', fields: [{ path: [], value: input.text }] } : { kind: 'html', html: normalized }
  }
  if (input.text === undefined) {
    const mediaTypes: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif' }
    const mediaType = mediaTypes[extension]
    if (mediaType && ['insert', 'redo'].includes(_intent)) return { kind: 'html', html: `<img src="data:${mediaType};base64,${Buffer.from(input.bytes).toString('base64')}">` }
    throw new Error('该二进制文件需要专业资源替换适配；可将图片插入页面，原件保留。')
  }
  if (SOURCE.has(extension) || extension === '.css' && file.kind === 'source') {
    if (file.sourceFile && file.implementation?.workspace && _intent !== 'insert' && _intent !== 'redo') {
      const captured = file.sourceFile, previous = file.implementation
      const ownerId = captured.privateOwner ? previous.workspace!.ownerId : randomUUID()
      const suppliedEntry = input.sourceEntry ?? path.basename(input.filename)
      const incoming = [...(input.siblingFiles ?? new Map([[suppliedEntry, input.bytes]]))].map(([name, bytes]) => ({
        name: path.posix.normalize(path.posix.join(path.posix.dirname(captured.path), path.posix.relative(path.posix.dirname(suppliedEntry), name))), bytes,
      }))
      // A parent import needs room above the edited file. Move the captured tree together so authored specifiers stay intact.
      const levels = Math.max(0, ...incoming.map(({ name }) => name.split('/').findIndex(part => part !== '..')))
      const prefix = 'source/'.repeat(levels)
      const logical = (name: string) => path.posix.normalize(`${prefix}${name}`)
      const files = Object.fromEntries(Object.entries(captured.files).map(([name, bytes]) => [logical(name), Uint8Array.from(bytes)]))
      for (const item of incoming) files[logical(item.name)] = Uint8Array.from(item.bytes)
      files[logical(captured.path)] = Uint8Array.from(input.bytes)
      return { kind: 'data', fields: [], implementation: { ...previous, workspace: { ownerId, entry: logical(previous.workspace!.entry) } },
        componentFiles: [{ type: 'component.files.set', ownerId, files, expectedFiles: captured.privateOwner ? captured.files : null }] }
    }
    const prior = file.implementation, ownerId = randomUUID(), entry = input.sourceEntry ?? path.basename(input.filename)
    const files = Object.fromEntries([...(input.siblingFiles ?? new Map([[entry, input.bytes]]))]
      .map(([name, bytes]) => [name, Uint8Array.from(bytes)]))
    files[entry] = Uint8Array.from(input.bytes)
    const implementation: Extract<ComponentImplementation, { kind: 'source' }> = {
      kind: 'source', language: extension === '.ts' || extension === '.tsx' ? 'typescript' : 'javascript',
      workspace: { ownerId, entry }, ...(prior?.dependencies ? { dependencies: prior.dependencies } : {}),
      ...(prior?.moduleBindings ? { moduleBindings: prior.moduleBindings } : {}),
      ...(prior?.resourceBindings ? { resourceBindings: prior.resourceBindings } : {}),
    }
    const componentFiles = [{ type: 'component.files.set' as const, ownerId, files, expectedFiles: null }]
    if (_intent === 'insert' || _intent === 'redo') {
      const definitionId = randomUUID(), viewport = file.programViewport
      return { kind: 'objects', definitions: [{ id: definitionId, role: 'content', title: path.basename(input.filename), implementation }],
        objects: [{ definitionId, data: {}, ...(viewport ? { frame: { width: viewport.width, height: viewport.height,
          transform: [1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number] } } : {}) }], componentFiles }
    }
    if (file.target?.kind !== 'instance' && file.binding?.kind !== 'definition-source') throw new Error('源码内容修改需要已有对象或共享定义；向页面创建组件请使用 insert 意图。')
    return { kind: 'data', fields: [], implementation, componentFiles }
  }
  if (file.kind === 'source') return componentFileContentSource(file, input.text, input)
  if (extension === '.md' || extension === '.markdown') {
    const source = componentFileContentSource(file, await marked.parse(input.text, { async: false }), input)
    return source.kind === 'html' ? { ...source, original: { bytes: input.bytes, filename: path.basename(input.filename), mimeType: 'text/markdown' } } : source
  }
  if (extension === '.css' && (file.kind === 'html' || file.kind === 'page') && file.target?.kind === 'instance') {
    return { kind: 'data', fields: [{ path: ['css'], value: input.text }] }
  }
  if (file.kind === 'html' || file.kind === 'page' || file.kind === 'structure' && ['insert', 'redo'].includes(_intent)) {
    const siblings = new Map(input.siblingFiles ?? [])
    for (const asset of Object.values(input.assetContext?.assets ?? {})) {
      const bytes = input.assetContext?.bytes[asset.id]
      if (bytes && !siblings.has(asset.path)) siblings.set(asset.path, bytes)
    }
    input.siblingFiles = siblings
  }
  const source = componentFileContentSource(file, input.text, input)
  return source.kind === 'html' ? { ...source, resourceReferences: projectReferences,
    original: { bytes: input.bytes, filename: path.basename(input.filename),
    mimeType: extension === '.html' || extension === '.htm' ? 'text/html' : 'text/plain' } } : source
}
