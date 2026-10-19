import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { documentRelativePathSchema } from '../../shared/document/resources'
import { markdownResourceReferences } from '../../shared/document/markdownResourceReferences'
import { validateDocumentResources } from '../../core/drivers/resources'
import type { DocumentBinding, DocumentModel, DocumentResources } from '../../shared/workbench/document'
import type { DocumentSourcePublication, PreparedDocumentSave } from '../../shared/workbench/documentSave'
import { captureHtmlClosure } from './htmlImport/readHtmlClosure'

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'
type Diagnostic = DocumentSourcePublication['diagnostics'][number]

export function safeSourceRelative(relative: string): string {
  documentRelativePathSchema.parse(relative)
  // Retain the publication path contract on every host, including Windows aliases.
  if (relative.split('/').some(part => /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)))
    throw new Error('附件路径不是安全文件名')
  return relative
}

export async function resourcePath(root: string, relative: string, options: { rejectSymlinks?: boolean } = {}): Promise<string> {
  const target = path.resolve(root, safeSourceRelative(relative))
  if (options.rejectSymlinks) {
    let current = root
    for (const part of relative.split('/')) {
      current = path.join(current, part)
      try { if ((await fs.lstat(current)).isSymbolicLink()) throw new Error('附件路径不能包含符号链接') }
      catch (error) { if (!missing(error)) throw error; break }
    }
  }
  let ancestor = target
  for (;;) {
    try {
      const real = await fs.realpath(ancestor)
      const local = path.relative(root, real)
      if (local === '..' || local.startsWith(`..${path.sep}`) || path.isAbsolute(local)) throw new Error('附件引用越出文档目录')
      break
    } catch (error) {
      if (!missing(error)) throw error
      ancestor = path.dirname(ancestor)
    }
  }
  return target
}

export async function markdownReferences(source: string): Promise<string[]> {
  return markdownResourceReferences(source, safeSourceRelative)
}

type ReadResource = { kind: 'file'; bytes: Uint8Array; version: string }
  | { kind: 'directory'; files: Record<string, Uint8Array>; version: string }

export async function readSourceResource(root: string, relative: string): Promise<ReadResource> {
  const filename = await resourcePath(root, relative)
  const stat = await fs.stat(filename)
  if (stat.isFile()) {
    const bytes = await fs.readFile(filename)
    return { kind: 'file', bytes, version: digest(bytes) }
  }
  if (!stat.isDirectory()) throw new Error('附件不是普通文件或组件目录')
  const entries = await fs.readdir(filename, { withFileTypes: true })
  const versions: [string, string][] = []
  const files: Record<string, Uint8Array> = Object.create(null)
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isSymbolicLink()) throw new Error('组件附件不能包含符号链接')
    const resource = await readSourceResource(root, `${relative}/${entry.name}`)
    versions.push([entry.name, resource.version])
    if (resource.kind === 'file') files[entry.name] = resource.bytes
    else for (const [child, bytes] of Object.entries(resource.files)) files[`${entry.name}/${child}`] = bytes
  }
  return { kind: 'directory', files, version: digest(Buffer.from(JSON.stringify(versions))) }
}

export async function resourceVersion(root: string, relative: string): Promise<string> {
  return (await readSourceResource(root, relative)).version
}

/** A package owns each contained path, including a newly pasted linked image. */
function coalesceSourceResources(resources: DocumentResources): void {
  for (const [relative, bytes] of Object.entries(resources.assets)) for (const [directory, files] of Object.entries(resources.components)) {
    if (!relative.startsWith(`${directory}/`)) continue
    files[relative.slice(directory.length + 1)] = bytes
    delete resources.assets[relative]
    break
  }
}

export function sourceResourceFiles(resources: DocumentResources): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>()
  const add = (relative: string, bytes: Uint8Array) => {
    safeSourceRelative(relative)
    if (files.has(relative) && digest(files.get(relative)!) !== digest(bytes)) throw new Error('附件路径重复且内容不同')
    files.set(relative, bytes)
  }
  for (const [relative, bytes] of Object.entries(resources.assets)) add(relative, bytes)
  for (const [directory, entries] of Object.entries(resources.components)) {
    safeSourceRelative(directory)
    for (const [relative, bytes] of Object.entries(entries)) add(`${directory}/${safeSourceRelative(relative)}`, bytes)
  }
  return files
}

export function sourceDocumentFormat(model: DocumentModel, binding: DocumentBinding): DocumentSourcePublication['format'] | undefined {
  if (model.kind === 'markdown') return 'markdown'
  const filename = binding.kind === 'file' ? binding.path : binding.suggestedName
  return model.kind === 'text' && /\.html?$/i.test(filename) ? 'html' : undefined
}

export interface CaptureDocumentSourceOptions {
  /** Already-authorized, settled source snapshots; this port does not grant file access. */
  currentSource?(filename: string): Promise<string | undefined>
  /** The caller selects the source format once, before any temporary path exists. */
  format?: DocumentSourcePublication['format']
}

/** The source binding is only a fallback location. No source file or directory is
 * required when the fixed model already carries all referenced bytes. */
function missingResourceReader(binding: DocumentBinding, options: CaptureDocumentSourceOptions) {
  let root: Promise<string | undefined> | undefined
  return async (relative: string): Promise<ReadResource | undefined> => {
    safeSourceRelative(relative)
    if (binding.kind !== 'file') return undefined
    const directory = path.dirname(path.resolve(binding.path))
    const current = await options.currentSource?.(path.join(directory, relative))
    if (current !== undefined) {
      const bytes = new TextEncoder().encode(current)
      return { kind: 'file', bytes, version: digest(bytes) }
    }
    root ??= fs.realpath(directory).catch(error => { if (missing(error)) return undefined; throw error })
    const actualRoot = await root
    if (!actualRoot) return undefined
    try { return await readSourceResource(actualRoot, relative) }
    catch (error) { if (missing(error)) return undefined; throw error }
  }
}

function retainPackage(resources: DocumentResources, held: DocumentResources, relative: string): string | undefined {
  const directory = Object.keys(held.components).find(directory => relative === directory || relative.startsWith(`${directory}/`))
  if (!directory) return undefined
  resources.components[directory] ??= { ...held.components[directory] }
  for (const [asset, bytes] of Object.entries(held.assets)) if (asset.startsWith(`${directory}/`))
    resources.components[directory]![asset.slice(directory.length + 1)] = bytes
  return directory
}

/** Formats keep their real parsers. Both choose held bytes, then an authorized
 * open source, then disk, and hand exactly this manifest to the one publisher. */
export async function prepareDocumentSave(model: DocumentModel, binding: DocumentBinding,
  options: CaptureDocumentSourceOptions = {}): Promise<PreparedDocumentSave> {
  const format = options.format ?? sourceDocumentFormat(model, binding)
  if (!format || model.kind !== 'text' && model.kind !== 'markdown') return { model }
  const resources: DocumentResources = { assets: Object.create(null), components: Object.create(null) }
  const read = missingResourceReader(binding, options)
  const diagnostics: Diagnostic[] = []
  let references: string[]
  if (format === 'html') {
    const closure = await captureHtmlClosure({ html: model.source, siblingFiles: sourceResourceFiles(model.resources),
      readRelative: async relative => {
        const resource = await read(relative)
        return resource?.kind === 'file' ? resource.bytes : undefined
      } })
    diagnostics.push(...closure.diagnostics)
    references = closure.localReferences
    for (const diagnostic of closure.diagnostics) if (diagnostic.code === 'missing-relative-resource' && diagnostic.reference
      && Object.keys(model.resources.components).some(directory => diagnostic.reference!.startsWith(`${directory}/`)))
      throw Object.assign(new Error(`受管组件缺少已引用的附件：${diagnostic.reference}`), { code: 'ENOENT' })
    for (const [relative, bytes] of closure.siblingFiles) {
      const directory = retainPackage(resources, model.resources, relative)
      if (directory) resources.components[directory]![relative.slice(directory.length + 1)] = bytes
      else resources.assets[relative] = bytes
    }
  } else {
    references = await markdownReferences(model.source)
    for (const relative of references) {
      const directory = retainPackage(resources, model.resources, relative)
      const held = model.resources.assets[relative]
      if (held) { resources.assets[relative] = held; continue }
      if (directory && (relative === directory || resources.components[directory]?.[relative.slice(directory.length + 1)])) continue
      const resource = await read(relative)
      if (resource?.kind === 'file') resources.assets[relative] = resource.bytes
      else if (resource?.kind === 'directory') resources.components[relative] = resource.files
      else if (directory) throw Object.assign(new Error(`受管组件缺少已引用的附件：${relative}`), { code: 'ENOENT' })
      else diagnostics.push({ level: 'warning', code: 'missing-relative-resource', reference: relative,
        message: `找不到相对资源 ${relative}；原引用已保留，源文件仍可保存` })
    }
  }
  coalesceSourceResources(resources)
  validateDocumentResources(resources, true)
  const files = [...sourceResourceFiles(resources)].map(([path, bytes]) => ({ path, version: digest(bytes) }))
  return { model: { ...model, resources }, sourcePublication: {
    format, references, files, componentDirectories: Object.keys(resources.components), diagnostics,
  } }
}

export function validateSourcePublication(publication: DocumentSourcePublication): void {
  if (!publication || !['markdown', 'html'].includes(publication.format) || !Array.isArray(publication.files)
    || !Array.isArray(publication.componentDirectories) || !Array.isArray(publication.diagnostics)
    || !Array.isArray(publication.references) || publication.references.some(reference => typeof reference !== 'string')) throw new Error('保存资源清单无效')
  for (const file of publication.files) {
    if (!file || typeof file.path !== 'string' || !/^[a-f0-9]{64}$/.test(file.version)) throw new Error('保存资源版本无效')
    safeSourceRelative(file.path)
  }
  for (const directory of publication.componentDirectories) safeSourceRelative(directory)
  for (const diagnostic of publication.diagnostics) if (!diagnostic || !['info', 'warning', 'error'].includes(diagnostic.level)
    || typeof diagnostic.code !== 'string' || typeof diagnostic.message !== 'string'
    || diagnostic.reference !== undefined && typeof diagnostic.reference !== 'string') throw new Error('保存资源诊断无效')
}

/** The copy and open consumers need the same model without publishing it. */
export async function captureDocumentSaveModel(model: DocumentModel, binding: DocumentBinding,
  options: CaptureDocumentSourceOptions = {}): Promise<DocumentModel> {
  return (await prepareDocumentSave(model, binding, options)).model
}

/** Existing Markdown callers retain their read API, now sharing the capture owner. */
export async function readDocumentMarkdownResources(filename: string, currentSource?: string): Promise<DocumentResources> {
  const source = currentSource ?? await fs.readFile(filename, 'utf8')
  return (await prepareDocumentSave({ kind: 'markdown', source, resources: { assets: {}, components: {} } },
    { kind: 'file', path: filename, version: null, bindingVersion: 1 })).model.resources
}

/** Read only the files promised by a saved operation, never a newly reinterpreted
 * or reduced closure. Callers compare every version before acknowledging it. */
export async function readPublishedSourceResources(root: string, publication: DocumentSourcePublication): Promise<DocumentResources> {
  validateSourcePublication(publication)
  const resources: DocumentResources = { assets: Object.create(null), components: Object.create(null) }
  for (const directory of publication.componentDirectories) {
    await resourcePath(root, directory)
    resources.components[directory] = Object.create(null)
  }
  for (const file of publication.files) {
    const bytes = await fs.readFile(await resourcePath(root, file.path))
    if (digest(bytes) !== file.version) throw new Error(`已保存附件发生变化：${file.path}`)
    const directory = publication.componentDirectories.find(directory => file.path.startsWith(`${directory}/`))
    if (directory) resources.components[directory]![file.path.slice(directory.length + 1)] = bytes
    else resources.assets[file.path] = bytes
  }
  validateDocumentResources(resources, true)
  return resources
}
