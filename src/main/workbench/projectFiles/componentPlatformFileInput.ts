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
import { readHtmlClosure } from '../htmlImport/readHtmlClosure'
import { readComponentSourceClosure } from './componentSourceClosure'
import { prepareContentResources, prepareImageResource } from '../contentApply/resources/contentResources'
import { assetReferencePath, projectReferencePath } from '../../../shared/composition/projectReferences'
import { parse } from 'parse5'
import type { DocumentRegistry } from '../../../core/documents/DocumentRegistry'

const TEXT = new Set(['.html', '.htm', '.css', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.json', '.md', '.markdown', '.txt', '.svg'])
const SOURCE = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx'])

/** Both path application and manual import capture the same already-open source Session. */
export async function readCurrentHtmlDocumentSource(registry: Pick<DocumentRegistry, 'list' | 'get'>, filename: string): Promise<string | undefined> {
  const key = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value
  const observed = registry.list().find(snapshot => snapshot.binding.kind === 'file' && key(snapshot.binding.path) === key(filename))
  if (!observed) return undefined
  const snapshot = await registry.get(observed.documentId).drain()
  return snapshot.model.kind === 'text' ? snapshot.model.source : undefined
}

/** Browser HTML encodings are decoded at the source boundary; the original bytes remain untouched. */
export function decodeComponentHtmlSource(bytes: Uint8Array): { text: string; notices: string[] } {
  const prefix = new TextDecoder('windows-1252').decode(bytes.subarray(0, 4096))
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le'
    : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be'
    : bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 'utf-8'
    : /<meta\b[^>]*charset\s*=\s*["']?\s*([\w-]+)/i.exec(prefix)?.[1] ?? 'utf-8'
  const notices: string[] = []
  let decoder: TextDecoder
  try { decoder = new TextDecoder(encoding) }
  catch { decoder = new TextDecoder('utf-8'); notices.push(`源文件声明的 ${encoding} 编码不可用，按 UTF-8 读取；原始字节已保留`) }
  const text = decoder.decode(bytes)
  if (text.includes('\uFFFD')) notices.push('部分源文字无法解码，已保留其余内容与原始字节，请核对这些字符')
  return { text, notices }
}

/** Read-only source admission shares the task's actual file access and realpath closure. */
export async function readComponentProjectFileInput(input: {
  from: string
  fileAccess: ToolRunGrant['fileAccess']
  /** Host capture wins over disk; sourceHtml can be a captured independent page. */
  sourceHtml?: string
  currentHtml?(filename: string): Promise<string | undefined>
  signal?: AbortSignal
}): Promise<ComponentProjectFileInput> {
  const { fileAccess, signal } = input
  if (!fileAccess?.workspaceRoot) throw new Error('按路径应用内容需要本任务的工作空间。')
  signal?.throwIfAborted()
  const root = await fs.realpath(fileAccess.workspaceRoot)
  const filename = await fs.realpath(path.resolve(fileAccess.workspaceRoot, input.from))
  if (fileAccess.permission !== 'full' && !isInsideRoot(root, filename)) throw new Error('内容源文件位于本任务授权工作空间外。')
  let bytes = new Uint8Array(await fs.readFile(filename))
  const extension = path.extname(filename).toLowerCase()
  const html = extension === '.html' || extension === '.htm'
  const currentHtml = html ? input.sourceHtml ?? await input.currentHtml?.(filename) : undefined
  if (currentHtml !== undefined) bytes = new TextEncoder().encode(currentHtml)
  const text = html ? currentHtml ?? decodeComponentHtmlSource(bytes).text : TEXT.has(extension) ? new TextDecoder('utf-8', { fatal: true }).decode(bytes) : undefined
  if (extension === '.html' || extension === '.htm') {
    const closure = await readHtmlClosure({ htmlPath: filename, rootDir: fileAccess.permission === 'full' ? path.parse(filename).root : root, sourceHtml: text })
    signal?.throwIfAborted()
    return { filename, bytes, text, siblingFiles: closure.siblingFiles }
  }
  if (extension === '.css' || extension === '.md' || extension === '.markdown') {
    const closure = await readHtmlClosure({ htmlPath: filename, rootDir: fileAccess.permission === 'full' ? path.parse(filename).root : root,
      sourceHtml: extension === '.css' ? `<style>${text ?? ''}</style>` : await marked.parse(text ?? '', { async: false }) })
    signal?.throwIfAborted()
    return { filename, bytes, text, siblingFiles: closure.siblingFiles }
  }
  if (SOURCE.has(extension) && text !== undefined) {
    const closure = await readComponentSourceClosure({ filename,
      rootDir: fileAccess.permission === 'full' ? path.parse(filename).root : root, bytes, text, signal })
    signal?.throwIfAborted()
    return { filename, bytes, text, sourceEntry: closure.entry, siblingFiles: closure.files }
  }
  signal?.throwIfAborted()
  return { filename, bytes, ...(text !== undefined ? { text } : {}) }
}

/** Format decoding only; geometry, resources, identities, diagnostics and writing remain with L19. */
export async function prepareComponentProjectFileSource(input: ComponentProjectFileInput, file: ComponentProjectFile,
  _intent: ContentApplyIntent): Promise<ContentApplySource> {
  const extension = path.extname(input.filename).toLowerCase()
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
    const prepared = await prepareContentResources({ html, siblingFiles: siblings }, randomUUID)
    const bindings = new Map<string, string>()
    input.resourceEdits = []; input.resourceBindings = {}
    input.diagnostics = prepared.diagnostics.map(issue => ({ ...issue, repairable: true }))
    for (const resource of prepared.resources) {
      const existing = resource.origins.map(origin => {
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
  const source = componentFileContentSource(file, input.text, input)
  return source.kind === 'html' ? { ...source, original: { bytes: input.bytes, filename: path.basename(input.filename),
    mimeType: extension === '.html' || extension === '.htm' ? 'text/html' : 'text/plain' } } : source
}
