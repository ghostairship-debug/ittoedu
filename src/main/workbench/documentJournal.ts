import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { deserialize, serialize } from 'node:v8'
import { isDeepStrictEqual } from 'node:util'
import { documentRelativePathSchema } from '../../shared/document/resources'
import type { DocumentBinding, DocumentKind, DocumentModel, DocumentPersistence, DocumentResources, DurableDocumentState } from '../../shared/workbench/document'

const MAGIC = Buffer.from('G20JNL01')
const COMMIT = Buffer.from('G20DONE!')
const HEADER_SIZE = 48
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'
const queues = new Map<string, Promise<unknown>>()
type FileBinding = Extract<DocumentBinding, { kind: 'file' }>
interface SaveIntent {
  schemaVersion: 1
  documentId: string
  epoch: string
  revision: number
  kind: DocumentKind
  sourceBinding: DocumentBinding
  targetBinding: FileBinding
  expectedVersion: string
}

export class DocumentJournalError extends Error {
  constructor(readonly code: 'journal-corrupt' | 'journal-sequence-conflict' | 'file-conflict' | 'resource-conflict', message: string) {
    super(message)
    this.name = 'DocumentJournalError'
  }
}

function serial<T>(key: string, action: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve()
  const next = previous.catch(() => {}).then(action)
  queues.set(key, next)
  void next.finally(() => { if (queues.get(key) === next) queues.delete(key) }).catch(() => {})
  return next
}

function fileKey(filename: string): string {
  const absolute = path.resolve(filename)
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute
}

async function syncDirectory(directory: string): Promise<void> {
  // Windows does not expose directory fsync through Node; file handles are flushed.
  if (process.platform === 'win32') return
  const handle = await fs.open(directory, 'r')
  try { await handle.sync() } finally { await handle.close() }
}

function checkState(state: DurableDocumentState, documentId: string): void {
  if (!state || state.schemaVersion !== 1 || state.documentId !== documentId || !state.epoch ||
      !Number.isSafeInteger(state.sequence) || state.sequence < 0 ||
      !Number.isSafeInteger(state.revision) || state.revision < 0 ||
      !Array.isArray(state.past) || !Array.isArray(state.future) ||
      !Array.isArray(state.operations) || !Array.isArray(state.stoppedRuns)) throw new Error('恢复日志状态无效')
  const models = [state.model, ...state.past.flatMap(item => [item.before, item.after]), ...state.future.flatMap(item => [item.before, item.after])]
  for (const model of models) {
    if (!model || !['markdown', 'course-v9'].includes(model.kind) || !model.resources ||
        (model.kind === 'markdown' && typeof model.source !== 'string')) throw new Error('恢复日志文档无效')
    const bytes = [...Object.values(model.resources.assets), ...Object.values(model.resources.components).flatMap(files => Object.values(files))]
    if (bytes.some(value => !(value instanceof Uint8Array))) throw new Error('恢复日志资源无效')
  }
  for (const operation of state.operations) {
    if (!operation.operationId || !operation.digest || operation.result.documentId !== documentId ||
        operation.result.operationId !== operation.operationId) throw new Error('恢复日志操作回执无效')
  }
}

function record(state: DurableDocumentState): Buffer {
  const payload = serialize(state)
  if (payload.length > 0xffffffff) throw new Error('恢复记录超出支持大小')
  const header = Buffer.alloc(HEADER_SIZE)
  MAGIC.copy(header)
  header.writeUInt32BE(payload.length, 8)
  header.writeUInt32BE((~payload.length) >>> 0, 12)
  createHash('sha256').update(payload).digest().copy(header, 16)
  return Buffer.concat([header, payload, COMMIT])
}

/** Only an incomplete final record is discarded. A complete damaged record fails loudly. */
async function scan(filename: string, documentId?: string): Promise<DurableDocumentState | null> {
  let bytes: Buffer
  try { bytes = await fs.readFile(filename) } catch (error) { if (missing(error)) return null; throw error }
  let offset = 0
  let latest: DurableDocumentState | null = null
  while (offset < bytes.length) {
    if (bytes.length - offset < HEADER_SIZE) break
    const header = bytes.subarray(offset, offset + HEADER_SIZE)
    const size = header.readUInt32BE(8)
    if (!header.subarray(0, 8).equals(MAGIC) || header.readUInt32BE(12) !== ((~size) >>> 0)) throw new DocumentJournalError('journal-corrupt', '恢复日志记录头损坏')
    const end = offset + HEADER_SIZE + size + COMMIT.length
    if (end > bytes.length) break
    const payload = bytes.subarray(offset + HEADER_SIZE, end - COMMIT.length)
    if (!bytes.subarray(end - COMMIT.length, end).equals(COMMIT) ||
        !createHash('sha256').update(payload).digest().equals(header.subarray(16))) throw new DocumentJournalError('journal-corrupt', '恢复日志完整记录校验失败')
    let state: DurableDocumentState
    try {
      state = deserialize(payload) as DurableDocumentState
      checkState(state, documentId ?? state.documentId)
    } catch { throw new DocumentJournalError('journal-corrupt', '恢复日志完整记录无法解码或状态无效') }
    if (path.basename(filename) !== `${digest(Buffer.from(state.documentId))}.journal` ||
        (latest && (state.documentId !== latest.documentId || state.sequence <= latest.sequence))) throw new DocumentJournalError('journal-corrupt', '恢复日志身份或顺序损坏')
    latest = state
    offset = end
  }
  if (offset !== bytes.length) {
    const handle = await fs.open(filename, 'r+')
    try { await handle.truncate(offset); await handle.sync() } finally { await handle.close() }
  }
  return latest
}

function safeRelative(relative: string): string {
  documentRelativePathSchema.parse(relative)
  // Reject Windows alternate streams, trailing-dot aliases, and device filenames on all hosts.
  if (relative.split('/').some(part => /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error('附件路径不是安全文件名')
  return relative
}

export async function resourcePath(root: string, relative: string, options: { rejectSymlinks?: boolean } = {}): Promise<string> {
  const target = path.resolve(root, safeRelative(relative))
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
  const references = new Set<string>()
  const add = (href: string) => {
    if (/^(https?:|data:|mailto:|#)/i.test(href)) return
    const decoded = decodeURIComponent(href.split(/[?#]/)[0]!)
    if (!decoded) return
    references.add(safeRelative(decoded.replace(/^\.\//, '')))
  }
  const { Lexer } = await import('marked')
  const visit = (tokens: unknown[]) => { for (const item of tokens) {
    if (!item || typeof item !== 'object') continue
    const token = item as Record<string, unknown>
    if ((token.type === 'image' || token.type === 'link') && typeof token.href === 'string') add(token.href)
    if (token.type === 'html' && typeof token.text === 'string') {
      for (const match of token.text.matchAll(/\b(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) add(match[1] ?? match[2] ?? match[3] ?? '')
    }
    if (token.type === 'code' && token.lang === 'cw-object-v1' && typeof token.text === 'string') {
      try {
        const object = JSON.parse(token.text) as { resources?: { assets?: { source: { kind: string; path?: string } }[]; components?: { source: { kind: string; path?: string } }[] } }
        for (const resource of [...(object.resources?.assets ?? []), ...(object.resources?.components ?? [])]) {
          if (resource.source.kind !== 'relative' || !resource.source.path) throw new Error('Markdown 资源必须使用完整相对路径')
          add(resource.source.path)
        }
      } catch (error) { if (!(error instanceof SyntaxError)) throw error }
    }
    for (const child of Object.values(token)) if (Array.isArray(child)) visit(child)
  } }
  visit(Lexer.lex(source))
  return [...references].sort()
}

type ReadResource = { kind: 'file'; bytes: Uint8Array; version: string } | { kind: 'directory'; files: Record<string, Uint8Array>; version: string }

async function readResource(root: string, relative: string): Promise<ReadResource> {
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
    const resource = await readResource(root, `${relative}/${entry.name}`)
    versions.push([entry.name, resource.version])
    if (resource.kind === 'file') files[entry.name] = resource.bytes
    else for (const [child, bytes] of Object.entries(resource.files)) files[`${entry.name}/${child}`] = bytes
  }
  return { kind: 'directory', files, version: digest(Buffer.from(JSON.stringify(versions))) }
}

async function resourceVersion(root: string, relative: string): Promise<string> {
  return (await readResource(root, relative)).version
}

/** Retain actual local resource bytes when opening Markdown, including a later Save As. */
export async function readDocumentMarkdownResources(filename: string): Promise<DocumentResources> {
  const source = await fs.readFile(filename, 'utf8')
  const root = await fs.realpath(path.dirname(path.resolve(filename)))
  const resources: DocumentResources = { assets: Object.create(null), components: Object.create(null) }
  for (const relative of await markdownReferences(source)) {
    try {
      const resource = await readResource(root, relative)
      if (resource.kind === 'file') resources.assets[relative] = resource.bytes
      else resources.components[relative] = resource.files
    } catch (error) { if (!missing(error)) throw error }
  }
  return resources
}

/** Opening and saving use this same opaque version, including Markdown's local attachments. */
export async function readDocumentFileVersion(filename: string, kind: DocumentKind): Promise<string | null> {
  let bytes: Buffer
  try { bytes = await fs.readFile(filename) } catch (error) { if (missing(error)) return null; throw error }
  if (kind !== 'markdown') return digest(bytes)
  const root = await fs.realpath(path.dirname(filename))
  const attachments: [string, string][] = []
  for (const relative of await markdownReferences(bytes.toString('utf8'))) {
    try { attachments.push([relative, await resourceVersion(root, relative)]) }
    catch (error) { if (!missing(error)) throw error; attachments.push([relative, 'missing']) }
  }
  return digest(Buffer.from(JSON.stringify([digest(bytes), attachments])))
}

function markdownFiles(model: DocumentModel): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>()
  const add = (relative: string, bytes: Uint8Array) => {
    safeRelative(relative)
    if (files.has(relative) && digest(files.get(relative)!) !== digest(bytes)) throw new Error('附件路径重复且内容不同')
    files.set(relative, bytes)
  }
  for (const [relative, bytes] of Object.entries(model.resources.assets)) add(relative, bytes)
  for (const [directory, entries] of Object.entries(model.resources.components)) {
    safeRelative(directory)
    for (const [relative, bytes] of Object.entries(entries)) add(`${directory}/${safeRelative(relative)}`, bytes)
  }
  return files
}

async function writeFlushed(filename: string, bytes: Uint8Array): Promise<void> {
  const handle = await fs.open(filename, 'wx')
  try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
}

async function saveFile(input: Parameters<DocumentPersistence['save']>[0],
  recordIntent: (target: FileBinding, expectedVersion: string) => Promise<void>): ReturnType<DocumentPersistence['save']> {
  if (input.binding.kind !== 'file') throw new Error('保存需要已选择的文件路径')
  const binding = input.binding
  const root = await fs.realpath(path.dirname(path.resolve(binding.path)))
  const filename = path.join(root, path.basename(binding.path))
  // Reject symlinks: replacing a link must not silently change its meaning or writer identity.
  try { if ((await fs.lstat(filename)).isSymbolicLink()) throw new Error('保存目标不能是符号链接') } catch (error) { if (!missing(error)) throw error }
  const assertCurrent = async () => {
    if (await readDocumentFileVersion(filename, input.model.kind) !== binding.version) throw new DocumentJournalError('file-conflict', '磁盘文件或附件已改变，当前稿已保留')
  }
  await assertCurrent()
  const staged: { temporary: string; target: string }[] = []
  const packages: { relative: string; temporary: string; target: string }[] = []
  const temporary = path.join(root, `.${path.basename(filename)}.${randomUUID()}.tmp`)
  try {
    if (input.model.kind === 'markdown') {
      if (!Buffer.from(input.bytes).equals(Buffer.from(input.model.source, 'utf8'))) throw new Error('保存正文与固定文档版本不一致')
      const files = markdownFiles(input.model)
      const directories = Object.keys(input.model.resources.components)
      if (directories.some(directory => directories.some(other => directory !== other && directory.startsWith(`${other}/`)))) throw new Error('组件包目录不能相互嵌套')
      // Existing component directories may be shared by other documents. Never extend
      // a published package in place: every changed package must get a fresh directory.
      for (const [directory, entries] of Object.entries(input.model.resources.components)) {
        const target = await resourcePath(root, directory)
        try {
          await fs.access(target)
          for (const [relative, bytes] of Object.entries(entries)) {
            const existing = await resourcePath(root, `${directory}/${relative}`)
            let same = false
            try { same = digest(await fs.readFile(existing)) === digest(bytes) } catch (error) { if (!missing(error)) throw error }
            if (!same) throw new DocumentJournalError('resource-conflict', '组件附件目录已存在，请使用新的目录')
          }
        } catch (error) {
          if (!missing(error)) throw error
          packages.push({ relative: directory, target, temporary: `${target}.${randomUUID()}.tmp` })
        }
      }
      // Check all collisions before preparing anything. Existing immutable resources are reused.
      const absent: [string, Uint8Array][] = []
      for (const [relative, bytes] of files) {
        const target = await resourcePath(root, relative)
        if (fileKey(target) === fileKey(filename)) throw new Error('附件不能覆盖正文文件')
        try { if (digest(await fs.readFile(target)) !== digest(bytes)) throw new DocumentJournalError('resource-conflict', '附件已存在且内容不同，请使用新的文件名') }
        catch (error) { if (!missing(error)) throw error; absent.push([relative, bytes]) }
      }
      for (const [relative, bytes] of absent) {
        const target = await resourcePath(root, relative)
        const bundle = packages.find(item => relative.startsWith(`${item.relative}/`))
        if (bundle) {
          const prepared = path.join(bundle.temporary, relative.slice(bundle.relative.length + 1))
          await fs.mkdir(path.dirname(prepared), { recursive: true })
          await writeFlushed(prepared, bytes)
          await syncDirectory(path.dirname(prepared))
          continue
        }
        await fs.mkdir(path.dirname(target), { recursive: true })
        await resourcePath(root, relative)
        const prepared = `${target}.${randomUUID()}.tmp`
        staged.push({ temporary: prepared, target })
        await writeFlushed(prepared, bytes)
      }
      // Publish complete immutable sidecars without overwrite. A crash can leave only unused
      // complete files; the old document remains intact until the final atomic replacement.
      for (const item of staged) {
        try { await fs.link(item.temporary, item.target) }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || digest(await fs.readFile(item.target)) !== digest(await fs.readFile(item.temporary))) throw error
        }
        await fs.unlink(item.temporary)
        await syncDirectory(path.dirname(item.target))
      }
      for (const bundle of packages) {
        await fs.mkdir(bundle.temporary, { recursive: true })
        await syncDirectory(bundle.temporary)
        try { await fs.access(bundle.target); throw new DocumentJournalError('resource-conflict', '组件附件目录已存在，请使用新的目录') }
        catch (error) { if (!missing(error)) throw error }
        await fs.rename(bundle.temporary, bundle.target)
        await syncDirectory(path.dirname(bundle.target))
      }
      for (const relative of await markdownReferences(input.model.source)) {
        try { await resourceVersion(root, relative) }
        catch (error) {
          const managed = files.has(relative) || directories.some(directory => relative === directory || relative.startsWith(`${directory}/`))
          // Ordinary source may already contain dangling links. Only resources carried
          // by this model promise a complete materialized attachment at save time.
          if (!missing(error) || managed) throw error
        }
      }
    }
    await writeFlushed(temporary, input.bytes)
    await assertCurrent()
    // The complete candidate version includes Markdown's referenced attachments.
    // Persist it before publishing the document, so restart can distinguish a
    // completed replacement from a prepared temporary file or an external edit.
    const expectedVersion = await readDocumentFileVersion(temporary, input.model.kind)
    if (!expectedVersion) throw new Error('保存候选文件不可读取')
    await recordIntent({ kind: 'file', path: filename, version: binding.version, bindingVersion: binding.bindingVersion }, expectedVersion)
    await assertCurrent()
    if (binding.version === null) {
      // New/Save As targets use exclusive creation, closing the check-then-create race.
      await fs.link(temporary, filename)
    } else await fs.rename(temporary, filename)
    await syncDirectory(root)
    const version = await readDocumentFileVersion(filename, input.model.kind)
    return { kind: 'file', path: filename, version, bindingVersion: binding.bindingVersion }
  } finally {
    await Promise.all([temporary, ...staged.map(item => item.temporary)].map(filename => fs.rm(filename, { force: true }).catch(() => {})))
    // These are exact, generated temporary directories beneath the verified document root.
    for (const bundle of packages) {
      const local = path.relative(root, path.resolve(bundle.temporary))
      if (local !== '..' && !local.startsWith(`..${path.sep}`) && !path.isAbsolute(local)) await fs.rm(bundle.temporary, { recursive: true, force: true }).catch(() => {})
    }
  }
}

export interface DocumentJournal extends DocumentPersistence {
  recover(documentId: string): Promise<DurableDocumentState | null>
  list(): Promise<string[]>
  discard(documentId: string): Promise<void>
}

/** Main-process persistence only. The DocumentSession remains the sole content/history writer. */
export function createDocumentJournal(options: { directory: string }): DocumentJournal {
  const directory = path.resolve(options.directory)
  const filename = (documentId: string) => path.join(directory, `${digest(Buffer.from(documentId))}.journal`)
  const intentFilename = (documentId: string) => path.join(directory, `${digest(Buffer.from(documentId))}.save-intent.json`)
  const readIntent = async (documentId: string): Promise<SaveIntent | null> => {
    let bytes: string
    try { bytes = await fs.readFile(intentFilename(documentId), 'utf8') }
    catch (error) { if (missing(error)) return null; throw error }
    let intent: SaveIntent
    try { intent = JSON.parse(bytes) as SaveIntent } catch { throw new Error('保存恢复记录损坏') }
    if (intent.schemaVersion !== 1 || intent.documentId !== documentId || !intent.epoch ||
      !Number.isSafeInteger(intent.revision) || intent.revision < 0 ||
      !['markdown', 'course-v9'].includes(intent.kind) ||
      !intent.sourceBinding || !['file', 'untitled'].includes(intent.sourceBinding.kind) ||
      (intent.sourceBinding.kind === 'file' && (!path.isAbsolute(intent.sourceBinding.path) ||
        !Number.isSafeInteger(intent.sourceBinding.bindingVersion) || intent.sourceBinding.bindingVersion < 1 ||
        intent.sourceBinding.version !== null && typeof intent.sourceBinding.version !== 'string')) ||
      (intent.sourceBinding.kind === 'untitled' && typeof intent.sourceBinding.suggestedName !== 'string') ||
      intent.targetBinding?.kind !== 'file' || !path.isAbsolute(intent.targetBinding.path) ||
      !Number.isSafeInteger(intent.targetBinding.bindingVersion) || intent.targetBinding.bindingVersion < 1 ||
      intent.targetBinding.version !== null && typeof intent.targetBinding.version !== 'string' ||
      typeof intent.expectedVersion !== 'string' || !/^[a-f0-9]{64}$/.test(intent.expectedVersion)) throw new Error('保存恢复记录无效')
    return intent
  }
  const appendWithinQueue = async (target: string, state: DurableDocumentState): Promise<void> => {
    checkState(state, state.documentId)
    const encoded = record(state)
    await fs.mkdir(directory, { recursive: true })
    const previous = await scan(target, state.documentId)
    if (previous && state.sequence <= previous.sequence) {
      if (state.sequence === previous.sequence && isDeepStrictEqual(previous, state)) {
        const handle = await fs.open(target, 'r+')
        try { await handle.sync() } finally { await handle.close() }
        await syncDirectory(directory)
        return
      }
      throw new DocumentJournalError('journal-sequence-conflict', '恢复日志序号已用于其他状态')
    }
    const handle = await fs.open(target, 'a+')
    const before = (await handle.stat()).size
    try { await handle.writeFile(encoded); await handle.sync() }
    catch (error) { await handle.truncate(before); await handle.sync(); throw error }
    finally { await handle.close() }
    await syncDirectory(directory)
  }
  const reconcileSave = async (target: string, state: DurableDocumentState): Promise<DurableDocumentState> => {
    const intent = await readIntent(state.documentId)
    if (!intent || intent.epoch !== state.epoch || intent.kind !== state.model.kind ||
      state.revision < intent.revision || state.savedRevision !== null && state.savedRevision > intent.revision ||
      !isDeepStrictEqual(state.binding, intent.sourceBinding)) return state

    // A clean Save As can publish a new file at revision r while the journal already
    // says savedRevision=r. Only its still-unacknowledged binding transition needs
    // repair; an ordinary clean save at the same path needs no new journal record.
    const newBinding = state.binding.kind === 'untitled'
      ? intent.targetBinding.bindingVersion === 1
      : intent.targetBinding.bindingVersion === state.binding.bindingVersion + 1
        && fileKey(intent.targetBinding.path) !== fileKey(state.binding.path)
    if (state.savedRevision === intent.revision && !newBinding) return state
    const targetPath = intent.targetBinding.path
    try {
      if ((await fs.lstat(targetPath)).isSymbolicLink()) return state
      if (fileKey(await fs.realpath(path.dirname(targetPath))) !== fileKey(path.dirname(targetPath))) return state
    } catch (error) { if (missing(error)) return state; throw error }
    const version = await readDocumentFileVersion(targetPath, intent.kind)
    if (version !== intent.expectedVersion) return state
    const repaired: DurableDocumentState = { ...state, sequence: state.sequence + 1,
      savedRevision: intent.revision,
      binding: { ...intent.targetBinding, version } }
    await appendWithinQueue(target, repaired)
    return repaired
  }
  const recordSaveIntent = (input: Parameters<DocumentPersistence['save']>[0], targetBinding: FileBinding, expectedVersion: string): Promise<void> => {
    const target = filename(input.documentId)
    return serial(fileKey(target), async () => {
      const state = await scan(target, input.documentId)
      if (!state || state.revision < input.revision || state.model.kind !== input.model.kind) throw new Error('保存版本不属于当前文档恢复日志')
      const intent: SaveIntent = { schemaVersion: 1, documentId: input.documentId, epoch: state.epoch,
        revision: input.revision, kind: input.model.kind, sourceBinding: state.binding,
        targetBinding, expectedVersion }
      const destination = intentFilename(input.documentId), temporary = `${destination}.${randomUUID()}.tmp`
      await fs.mkdir(directory, { recursive: true })
      try {
        await writeFlushed(temporary, Buffer.from(JSON.stringify(intent)))
        await fs.rename(temporary, destination)
        await syncDirectory(directory)
      } finally { await fs.rm(temporary, { force: true }).catch(() => {}) }
    })
  }
  return {
    append(state) {
      checkState(state, state.documentId)
      const frozen = deserialize(serialize(state)) as DurableDocumentState // Freeze before yielding to the queue.
      const target = filename(frozen.documentId)
      return serial(fileKey(target), () => appendWithinQueue(target, frozen))
    },
    recover(documentId) {
      const target = filename(documentId)
      return serial(fileKey(target), async () => {
        const state = await scan(target, documentId)
        return state ? reconcileSave(target, state) : null
      })
    },
    discard(documentId) {
      const target = filename(documentId)
      return serial(fileKey(target), async () => {
        await Promise.all([target, intentFilename(documentId)].map(name => fs.rm(name, { force: true })))
        await syncDirectory(directory)
      })
    },
    async list() {
      let names: string[]
      try { names = await fs.readdir(directory) } catch (error) { if (missing(error)) return []; throw error }
      const ids: string[] = []
      for (const name of names.filter(name => /^[a-f0-9]{64}\.journal$/.test(name)).sort()) {
        const target = path.join(directory, name)
        const state = await serial(fileKey(target), () => scan(target))
        if (state) ids.push(state.documentId)
      }
      return ids
    },
    save(input) {
      // The caller may commit r+1 while saving r. Capture everything synchronously.
      const frozen = deserialize(serialize(input)) as typeof input
      if (frozen.binding.kind !== 'file') return Promise.reject(new Error('保存需要已选择的文件路径'))
      return serial(fileKey(frozen.binding.path), () => saveFile(frozen,
        (target, expectedVersion) => recordSaveIntent(frozen, target, expectedVersion)))
    },
  }
}
