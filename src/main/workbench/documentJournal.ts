import { publishNewFile, publicationIdentity } from './publishNewFile'
import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { deserialize, serialize } from 'node:v8'
import { isDeepStrictEqual } from 'node:util'
import { DocumentSaveFailure, type DocumentSaveIdentity, type DocumentSaveProof, type DocumentSourcePublication } from '../../shared/workbench/documentSave'
import type { HtmlResourceSource } from './htmlImport/types'
import { JournalBindingIndex, journalIdentity, type JournalBindingMetadata } from './JournalBindingIndex'
import { DocumentJournalCodec, DocumentJournalDecoder } from './documentJournalCodec'
import { applyDocumentStateTransition } from '../../core/documents/documentStateEffects'
import { captureDocumentSaveModel, prepareDocumentSave, markdownReferences, readPublishedSourceResources, resourcePath, resourceVersion,
  sourceResourceFiles, sourceDocumentFormat, validateSourcePublication, type CaptureDocumentSourceOptions } from './documentSourceResources'
import { createMarkdownDriver } from '../../core/drivers/MarkdownDriver'
import { createTextDriver } from '../../core/drivers/TextDriver'
import { createDocumentArchiveDriver, createDocumentJournalCheckpoint } from './documentArchiveWorker'
import { JOURNAL_MAGIC as MAGIC, JOURNAL_COMMIT as COMMIT, JOURNAL_HEADER_SIZE as HEADER_SIZE, recordDocumentJournalPayload as recordPayload } from './documentJournalRecord'
import type { DocumentBinding, DocumentKind, DocumentModel, DocumentPersistence, DocumentStateTransition, DurableDocumentState } from '../../shared/workbench/document'

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
  saveIdentity?: DocumentSaveIdentity
  fileIdentity?: string
  sourcePublication?: DocumentSourcePublication
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


/** A retained intent is not necessarily pending: clean saves may keep the same binding. */
function pendingSave(state: Pick<DurableDocumentState, 'epoch' | 'revision' | 'savedRevision' | 'binding'>,
  kind: DocumentKind, intent: SaveIntent | null): boolean {
  if (!intent || intent.epoch !== state.epoch || intent.kind !== kind || state.revision < intent.revision
    || state.savedRevision !== null && state.savedRevision > intent.revision
    || !isDeepStrictEqual(state.binding, intent.sourceBinding)) return false
  const newBinding = state.binding.kind === 'untitled'
    ? intent.targetBinding.bindingVersion === 1
    : intent.targetBinding.bindingVersion === state.binding.bindingVersion + 1
      && fileKey(intent.targetBinding.path) !== fileKey(state.binding.path)
  return state.savedRevision !== intent.revision || newBinding
}

/** Reconciliation eligibility is not proof of settlement: a rename may change
 * the source binding while an earlier Save As still has an unknown outcome. */
function acknowledgedSave(state: Pick<DurableDocumentState, 'epoch' | 'savedRevision' | 'binding'>,
  kind: DocumentKind, intent: SaveIntent): boolean {
  return state.epoch === intent.epoch && kind === intent.kind && state.savedRevision !== null
    && state.savedRevision >= intent.revision
    && isDeepStrictEqual(state.binding, { ...intent.targetBinding, version: intent.expectedVersion })
}

async function syncDirectory(directory: string): Promise<void> {
  // Windows does not expose directory fsync through Node; file handles are flushed.
  if (process.platform === 'win32') return
  const handle = await fs.open(directory, 'r')
  try { await handle.sync() } finally { await handle.close() }
}

function checkState(state: DurableDocumentState, documentId: string): void {
  if (!state || ![1, 2, 3].includes(state.schemaVersion)
      || state.schemaVersion === 1 && state.disposition !== undefined
      || state.schemaVersion >= 2 && !['active', 'closed', 'discarded'].includes(state.disposition ?? '')
      || state.documentId !== documentId || !state.epoch ||
      !Number.isSafeInteger(state.sequence) || state.sequence < 0 ||
      !Number.isSafeInteger(state.revision) || state.revision < 0 ||
      !Array.isArray(state.past) || !Array.isArray(state.future) ||
      !Array.isArray(state.operations) || !Array.isArray(state.stoppedRuns)) throw new Error('恢复日志状态无效')
  // The current document and replay identities are required. Optional historical
  // models are checked by Session restore, which can retain the raw journal and
  // isolate a broken history without rejecting a usable current document.
  for (const model of [state.model]) {
    if (!model || !['markdown', 'text', 'course-v9', 'course-v10'].includes(model.kind) || !model.resources ||
        ((model.kind === 'markdown' || model.kind === 'text') && typeof model.source !== 'string')) throw new Error('恢复日志文档无效')
    const bytes = [...Object.values(model.resources.assets), ...Object.values(model.resources.components).flatMap(files => Object.values(files))]
    if (bytes.some(value => !(value instanceof Uint8Array))) throw new Error('恢复日志资源无效')
  }
  for (const operation of state.operations) {
    if (!operation || !operation.operationId || !operation.digest || !operation.result || operation.result.documentId !== documentId ||
        operation.result.operationId !== operation.operationId) throw new Error('恢复日志操作回执无效')
  }
}

function record(state: DurableDocumentState): Buffer { return recordPayload(serialize(state)) }

/** Read one complete record at a time, so a long journal does not need a >2 GiB readFile buffer.
 * Only an incomplete final record is discarded; committed corruption still fails explicitly. */
async function scan(filename: string, documentId?: string, options: { offset?: number; repairTail?: boolean;
  onRecord?(offset: number): void; onCheckpoint?(offset: number, length: number): void; onCodec?(codec: DocumentJournalCodec): void } = {}): Promise<DurableDocumentState | null> {
  let file: Awaited<ReturnType<typeof fs.open>>
  try { file = await fs.open(filename, 'r') } catch (error) { if (missing(error)) return null; throw error }
  let offset = options.offset ?? 0, fileSize = 0
  const initialIdentity = await journalIdentity(filename)
  let latest: DurableDocumentState | null = null
  const decoder = new DocumentJournalDecoder()
  const read = async (position: number, size: number): Promise<Buffer> => {
    const bytes = Buffer.allocUnsafe(size)
    let received = 0
    while (received < size) {
      const next = await file.read(bytes, received, Math.min(size - received, 1024 * 1024), position + received)
      if (!next.bytesRead) throw new DocumentJournalError('journal-corrupt', '恢复日志在读取期间改变或记录不完整')
      received += next.bytesRead
    }
    return bytes
  }
  try {
    fileSize = (await file.stat()).size
    while (offset < fileSize) {
      if (fileSize - offset < HEADER_SIZE) break
      const header = await read(offset, HEADER_SIZE), size = header.readUInt32BE(8)
      if (!header.subarray(0, 8).equals(MAGIC) || header.readUInt32BE(12) !== ((~size) >>> 0))
        throw new DocumentJournalError('journal-corrupt', '恢复日志记录头损坏')
      const end = offset + HEADER_SIZE + size + COMMIT.length
      if (end > fileSize) break
      const payload = await read(offset + HEADER_SIZE, size)
      if (!(await read(end - COMMIT.length, COMMIT.length)).equals(COMMIT)
        || !createHash('sha256').update(payload).digest().equals(header.subarray(16)))
        throw new DocumentJournalError('journal-corrupt', '恢复日志完整记录校验失败')
      let state: DurableDocumentState
      try {
        const decoded = decoder.decode(payload)
        if (decoded.type === 'transition') {
          if (!latest) throw new Error('恢复增量缺少完整checkpoint')
          state = applyDocumentStateTransition(latest, decoded.value)
        } else {
          state = decoded.value
          checkState(state, documentId ?? state.documentId)
          options.onCheckpoint?.(offset, end - offset)
        }
      } catch { throw new DocumentJournalError('journal-corrupt', '恢复日志完整记录无法解码或状态无效') }
      if (path.basename(filename) !== `${digest(Buffer.from(state.documentId))}.journal`
        || latest && (state.documentId !== latest.documentId || state.sequence <= latest.sequence))
        throw new DocumentJournalError('journal-corrupt', '恢复日志身份或顺序损坏')
      latest = state; options.onRecord?.(offset); offset = end
    }
    // A torn suffix is repairable only after an actual committed state. With no
    // readable record there is no owner or recovery point to justify erasing input.
    if (!latest && fileSize > 0) throw new DocumentJournalError('journal-corrupt', '恢复日志没有可读取的完整记录，原文件已保留')
    if (await journalIdentity(filename) !== initialIdentity) throw new DocumentJournalError('journal-sequence-conflict', '恢复日志在读取期间改变，未修复或提交')
  } finally { await file.close() }
  if (offset !== fileSize && options.repairTail !== false) {
    const handle = await fs.open(filename, 'r+')
    try {
      if ((await handle.stat()).size !== fileSize) throw new DocumentJournalError('journal-sequence-conflict', '恢复日志在尾部修复前改变，未截断')
      await handle.truncate(offset); await handle.sync()
    } finally { await handle.close() }
  }
  if (latest) checkState(latest, documentId ?? latest.documentId)
  options.onCodec?.(decoder.writer())
  return latest
}

async function readSavedModel(filename: string, kind: DocumentKind, publication?: DocumentSourcePublication): Promise<DocumentModel> {
  const driver = kind === 'markdown' ? createMarkdownDriver() : kind === 'text' ? createTextDriver() : createDocumentArchiveDriver()
  const model = await driver.load(new Uint8Array(await fs.readFile(filename)))
  if (publication) return { ...model, resources: await readPublishedSourceResources(path.dirname(filename), publication) }
  return captureDocumentSaveModel(model, { kind: 'file', path: filename, version: null, bindingVersion: 1 })
}

async function assertPublishedResources(root: string, publication?: DocumentSourcePublication): Promise<void> {
  if (!publication) return
  for (const directory of publication.componentDirectories) {
    const stat = await fs.stat(await resourcePath(root, directory))
    if (!stat.isDirectory()) throw new DocumentJournalError('resource-conflict', '已保存组件附件目录发生变化')
  }
  for (const file of publication.files) {
    const filename = await resourcePath(root, file.path)
    try {
      if (digest(await fs.readFile(filename)) !== file.version) throw new DocumentJournalError('resource-conflict', `已保存附件发生变化：${file.path}`)
    } catch (error) {
      if (!missing(error)) throw error
      throw new DocumentJournalError('resource-conflict', `已保存附件不再存在：${file.path}`)
    }
  }
}

/** Opening and saving use this same opaque version, including Markdown's local attachments. */
export async function readDocumentFileVersion(filename: string, kind: DocumentKind, references?: readonly string[]): Promise<string | null> {
  let bytes: Buffer
  try { bytes = await fs.readFile(filename) } catch (error) { if (missing(error)) return null; throw error }
  if (kind !== 'markdown') return digest(bytes)
  const root = await fs.realpath(path.dirname(filename))
  const attachments: [string, string][] = []
  for (const relative of references ?? await markdownReferences(bytes.toString('utf8'))) {
    try { attachments.push([relative, await resourceVersion(root, relative)]) }
    catch (error) { if (!missing(error)) throw error; attachments.push([relative, 'missing']) }
  }
  return digest(Buffer.from(JSON.stringify([digest(bytes), attachments])))
}

async function writeFlushed(filename: string, bytes: Uint8Array): Promise<void> {
  const handle = await fs.open(filename, 'wx')
  try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
}

async function saveFile(input: Parameters<DocumentPersistence['save']>[0],
  recordIntent: (target: FileBinding, expectedVersion: string, fileIdentity: string | null) => Promise<void>): ReturnType<DocumentPersistence['save']> {
  if (input.binding.kind !== 'file') throw new Error('保存需要已选择的文件路径')
  const binding = input.binding
  const root = await fs.realpath(path.dirname(path.resolve(binding.path)))
  const filename = path.join(root, path.basename(binding.path))
  // Reject symlinks: replacing a link must not silently change its meaning or writer identity.
  try { if ((await fs.lstat(filename)).isSymbolicLink()) throw new Error('保存目标不能是符号链接') } catch (error) { if (!missing(error)) throw error }
  // The old target and the captured new source have different reference sets.
  // Parse the old target once; each check still rereads its bytes and versions.
  let targetReferences: readonly string[] | undefined
  if (input.model.kind === 'markdown') {
    try { targetReferences = await markdownReferences(await fs.readFile(filename, 'utf8')) }
    catch (error) { if (!missing(error)) throw error; targetReferences = [] }
  }
  const assertCurrent = async () => {
    if (await readDocumentFileVersion(filename, input.model.kind, targetReferences) !== binding.version) throw new DocumentJournalError('file-conflict', '磁盘文件或附件已改变，当前稿已保留')
  }
  await assertCurrent()
  const staged: { temporary: string; target: string }[] = []
  const packages: { relative: string; temporary: string; target: string }[] = []
  const temporary = path.join(root, `.${path.basename(filename)}.${randomUUID()}.tmp`)
  let publishing = false, published = false, retainCandidate = false
  try {
    if (input.sourcePublication && (input.model.kind === 'markdown' || input.model.kind === 'text')) {
      if (!Buffer.from(input.bytes).equals(Buffer.from(input.model.source, 'utf8'))) throw new Error('保存正文与固定文档版本不一致')
      const files = sourceResourceFiles(input.model.resources)
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
        try { await publishNewFile(item.temporary, item.target) }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || digest(await fs.readFile(item.target)) !== digest(await fs.readFile(item.temporary))) throw error
        }
        await fs.rm(item.temporary, { force: true })
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
    }
    // Source publications already checked these same captured bytes before sidecar preparation.
    if (input.model.kind === 'text' && !input.sourcePublication && !Buffer.from(input.bytes).equals(Buffer.from(input.model.source, 'utf8'))) throw new Error('保存正文与固定文档版本不一致')
    await writeFlushed(temporary, input.bytes)
    await assertCurrent()
    // The complete candidate version includes Markdown's referenced attachments.
    // Persist it before publishing the document, so restart can distinguish a
    // completed replacement from a prepared temporary file or an external edit.
    const expectedVersion = await readDocumentFileVersion(temporary, input.model.kind, input.sourcePublication?.references)
    if (!expectedVersion) throw new Error('保存候选文件不可读取')
    await recordIntent({ kind: 'file', path: filename, version: binding.version, bindingVersion: binding.bindingVersion }, expectedVersion, await publicationIdentity(temporary))
    await assertCurrent()
    await assertPublishedResources(root, input.sourcePublication)
    publishing = true
    if (binding.version === null) {
      // New/Save As targets use exclusive creation, closing the check-then-create race.
      await publishNewFile(temporary, filename)
    } else await fs.rename(temporary, filename)
    published = true
    await syncDirectory(root)
    const version = await readDocumentFileVersion(filename, input.model.kind, input.sourcePublication?.references)
    if (version !== expectedVersion) throw new DocumentJournalError('file-conflict', '保存发布后磁盘制品已改变，当前稿与原保存记录已保留，请比较磁盘版本')
    await assertPublishedResources(root, input.sourcePublication)
    return { kind: 'file', path: filename, version, bindingVersion: binding.bindingVersion }
  } catch (error) {
    // Definite syscall rejection leaves the destination untouched; an interrupted
    // publication or failed acknowledgement is investigated with its retained intent.
    const code = (error as NodeJS.ErrnoException).code
    const knownRejection = ['EEXIST', 'EACCES', 'EPERM', 'ENOSPC', 'EROFS', 'EXDEV', 'ENOTSUP', 'ENOENT', 'EBUSY'].includes(code ?? '')
    retainCandidate = published || publishing && !knownRejection
    throw new DocumentSaveFailure(retainCandidate ? 'unknown' : 'not-published', error)
  } finally {
    await Promise.all([...(retainCandidate ? [] : [temporary]), ...staged.map(item => item.temporary)].map(filename => fs.rm(filename, { force: true }).catch(() => {})))
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
  listBindings(): Promise<readonly JournalBindingMetadata[]>
  readonly recoveryIssues: readonly string[]
  assertAvailable(paths?: readonly string[], documentIds?: readonly string[], readOnly?: boolean): Promise<void>
  /** Diagnostic read: never truncates a torn tail or updates a save binding. */
  inspect(documentId: string): Promise<DurableDocumentState | null>
  discard(documentId: string): Promise<void>
  preserveUnavailable(documentId: string): Promise<void>
  lookupSave(documentId: string, identity: DocumentSaveIdentity): Promise<DocumentSaveProof | null>
}

/** Transient facts of this exact prepared source publication, never recovery or IPC data. */
export interface PublishedSourceObservation {
  documentId: string
  revision: number
  binding: FileBinding
  model: DocumentModel
  publication: DocumentSourcePublication
  sources: HtmlResourceSource[]
  directoryDependency: boolean
}

/** Main-process persistence only. The DocumentSession remains the sole content/history writer. */
export function createDocumentJournal(options: { directory: string; isLive?(documentId: string): boolean;
  currentSource?: CaptureDocumentSourceOptions['currentSource'];
  observeSourcePublication?(documentId: string): ((observation: PublishedSourceObservation) => void) | undefined;
  onBindingRecovered?(state: DurableDocumentState, before: DocumentBinding): Promise<void> }): DocumentJournal {
  const directory = path.resolve(options.directory)
  const bindings = new JournalBindingIndex()
  const checkedProjectInputs = new Set<string>()
  const unavailable = new Map<string, { documentId?: string; path?: string; message: string }>()
  type DurableHead = Pick<DurableDocumentState, 'documentId' | 'epoch' | 'sequence' | 'revision' | 'savedRevision' | 'binding' | 'disposition'> & {
    kind: DocumentKind; identity: string; checkpointOffset: number; checkpointLength: number; codec: DocumentJournalCodec
  }
  const heads = new Map<string, DurableHead>()
  const pendingCheckpoints = new Map<string, DurableDocumentState>()
  const preparingCheckpoints = new Set<string>()
  const preparedSources = new WeakMap<DocumentModel, Omit<PublishedSourceObservation, 'documentId' | 'revision' | 'binding' | 'model'>>()
  const rememberHead = async (target: string, state: DurableDocumentState, checkpointOffset: number,
    checkpointLength: number, codec: DocumentJournalCodec): Promise<void> => {
    const identity = await journalIdentity(target)
    if (!identity) { heads.delete(target); return }
    heads.set(target, { documentId: state.documentId, epoch: state.epoch, sequence: state.sequence,
      revision: state.revision, savedRevision: state.savedRevision, binding: structuredClone(state.binding),
      disposition: state.disposition ?? 'active', kind: state.model.kind, identity, checkpointOffset, checkpointLength, codec })
  }
  const load = async (target: string, documentId?: string): Promise<DurableDocumentState | null> => {
    const known = await bindings.read(target)
    let offset = known?.offset ?? 0
    let checkpointLength = 0, codec = new DocumentJournalCodec()
    const state = await scan(target, documentId, { offset,
      onCheckpoint: (value, length) => { offset = value; checkpointLength = length }, onCodec: value => { codec = value } })
    if (state) {
      await rememberHead(target, state, offset, checkpointLength, codec)
      if (!known) await bindings.update(target, state, offset, heads.get(target)?.identity ?? null)
    } else heads.delete(target)
    return state
  }
  const verifiedHead = async (target: string, documentId: string): Promise<DurableHead | undefined> => {
    const known = heads.get(target)
    if (known && await journalIdentity(target) === known.identity) return known
    heads.delete(target)
    await load(target, documentId)
    return heads.get(target)
  }
  const filename = (documentId: string) => path.join(directory, `${digest(Buffer.from(documentId))}.journal`)
  const intentFilename = (documentId: string) => path.join(directory, `${digest(Buffer.from(documentId))}.save-intent.json`)
  const retainedIntentFilename = (documentId: string, identity: DocumentSaveIdentity) => path.join(directory, 'save-intents',
    digest(Buffer.from(JSON.stringify([documentId, identity.runId, identity.operationId, identity.requestDigest]))), path.basename(intentFilename(documentId)))
  const preserveJournalInput = async (target: string, retainedDirectory: string): Promise<void> => {
    const retained = path.join(retainedDirectory, path.basename(target))
    try { await fs.access(retained); return } catch (error) { if (!missing(error)) throw error }
    await fs.mkdir(retainedDirectory, { recursive: true })
    const temporary = `${retained}.${randomUUID()}.tmp`
    const identity = await journalIdentity(target)
    try {
      await fs.copyFile(target, temporary)
      if (await journalIdentity(target) !== identity) throw new DocumentJournalError('journal-sequence-conflict', '工程恢复原记录在保留期间改变，未转换或压缩')
      const handle = await fs.open(temporary, 'r+')
      try { await handle.sync() } finally { await handle.close() }
      try { await publishNewFile(temporary, retained) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
      await syncDirectory(retainedDirectory)
      await syncDirectory(path.dirname(retainedDirectory))
      await syncDirectory(directory)
    } finally { await fs.rm(temporary, { force: true }).catch(() => undefined) }
  }
  const readIntentAt = async (documentId: string, source: string): Promise<SaveIntent | null> => {
    let bytes: string
    try { bytes = await fs.readFile(source, 'utf8') }
    catch (error) { if (missing(error)) return null; throw error }
    let intent: SaveIntent
    try { intent = JSON.parse(bytes) as SaveIntent } catch { throw new Error('保存恢复记录损坏') }
    if (intent.schemaVersion !== 1 || intent.documentId !== documentId || !intent.epoch ||
      !Number.isSafeInteger(intent.revision) || intent.revision < 0 ||
      !['markdown', 'text', 'course-v9', 'course-v10'].includes(intent.kind) ||
      !intent.sourceBinding || !['file', 'untitled'].includes(intent.sourceBinding.kind) ||
      (intent.sourceBinding.kind === 'file' && (!path.isAbsolute(intent.sourceBinding.path) ||
        !Number.isSafeInteger(intent.sourceBinding.bindingVersion) || intent.sourceBinding.bindingVersion < 1 ||
        intent.sourceBinding.version !== null && typeof intent.sourceBinding.version !== 'string')) ||
      (intent.sourceBinding.kind === 'untitled' && typeof intent.sourceBinding.suggestedName !== 'string') ||
      intent.targetBinding?.kind !== 'file' || !path.isAbsolute(intent.targetBinding.path) ||
      !Number.isSafeInteger(intent.targetBinding.bindingVersion) || intent.targetBinding.bindingVersion < 1 ||
      intent.targetBinding.version !== null && typeof intent.targetBinding.version !== 'string' ||
      typeof intent.expectedVersion !== 'string' || !/^[a-f0-9]{64}$/.test(intent.expectedVersion)) throw new Error('保存恢复记录无效')
    if (intent.sourcePublication) validateSourcePublication(intent.sourcePublication)
    return intent
  }
  const readIntent = async (documentId: string, identity?: DocumentSaveIdentity): Promise<SaveIntent | null> => {
    if (identity) {
      const retained = await readIntentAt(documentId, retainedIntentFilename(documentId, identity))
      if (retained) return retained
    }
    const current = await readIntentAt(documentId, intentFilename(documentId))
    if (!identity || current?.saveIdentity && isDeepStrictEqual(current.saveIdentity, identity)) return current
    return null
  }
  const preserveLegacyProject = async (target: string, state: DurableDocumentState, offset?: number): Promise<void> => {
    if (state.model.kind !== 'course-v10' || state.model.project.schemaVersion !== 11 || checkedProjectInputs.has(target)) return
    const original = await scan(target, state.documentId, { offset, repairTail: false })
    const models = original ? [original.model, ...(original.savedModel ? [original.savedModel] : []),
      ...[...original.past, ...original.future].flatMap(entry => entry?.before && entry.after ? [entry.before, entry.after] : []),
      ...original.operations.flatMap(operation => [...(operation.before ? [operation.before] : []), ...(operation.after ? [operation.after] : [])])] : []
    // Decoded legacy input predates the current Project 11 static type.
    const rawSchemaVersion = (project: object): unknown => Reflect.get(project, 'schemaVersion')
    if (models.some(model => model?.kind === 'course-v10' && model.project && rawSchemaVersion(model.project) === 10))
      await preserveJournalInput(target, path.join(directory, 'project-v10-inputs', path.basename(target, '.journal')))
    checkedProjectInputs.add(target)
  }
  const appendBytes = async (target: string, encoded: Buffer): Promise<number> => {
    await fs.mkdir(directory, { recursive: true })
    const handle = await fs.open(target, 'a+')
    const before = (await handle.stat()).size
    try { await handle.writeFile(encoded); await handle.sync() }
    catch (error) {
      // Windows append handles cannot truncate. Roll back through the same journal
      // owner with a writable handle; the failed append still rejects its caller.
      const rollback = await fs.open(target, 'r+')
      try { await rollback.truncate(before); await rollback.sync() } finally { await rollback.close() }
      throw error
    }
    finally { await handle.close() }
    await syncDirectory(directory)
    return before
  }
  const appendWithinQueue = async (target: string, input: DurableDocumentState): Promise<void> => {
    checkState(input, input.documentId)
    const state: DurableDocumentState = { ...input, schemaVersion: input.schemaVersion === 3 ? 3 : 2, disposition: input.disposition ?? 'active' }
    const indexed = await bindings.read(target)
    // Preserve the actual old input before a recovery scan can repair its torn tail.
    await preserveLegacyProject(target, state, indexed?.offset)
    const head = await verifiedHead(target, state.documentId)
    if (head && state.sequence <= head.sequence) {
      const previous = await load(target, state.documentId)
      if (state.sequence === previous?.sequence && isDeepStrictEqual(previous, state)) {
        const handle = await fs.open(target, 'r+')
        try { await handle.sync() } finally { await handle.close() }
        await syncDirectory(directory)
        return
      }
      throw new DocumentJournalError('journal-sequence-conflict', '恢复日志序号已用于其他状态')
    }
    if (head?.disposition && head.disposition !== 'active') throw new DocumentJournalError('journal-sequence-conflict', '文档恢复记录已结束，不能重新激活')
    const codec = new DocumentJournalCodec()
    const prepared = state.schemaVersion === 3 ? codec.prepare('checkpoint', state) : undefined
    const encoded = prepared ? recordPayload(prepared.payload) : record(state)
    const before = await appendBytes(target, encoded)
    prepared?.commit()
    let recordOffset = before
    // Standalone checkpoints carry every promised effect/history/receipt/resource.
    // Keeping the old compaction policy for direct legacy append does not affect normal deltas.
    if (before + encoded.length > Math.max(16 * 1024 * 1024, encoded.length * 3)) {
      const temporary = `${target}.checkpoint-${randomUUID()}.tmp`
      try {
        await writeFlushed(temporary, encoded)
        await fs.rename(temporary, target); recordOffset = 0
        await syncDirectory(directory)
      } catch { /* A failed optional replacement cannot undo the durable append. */ }
      finally { await fs.rm(temporary, { force: true }).catch(() => undefined) }
    }
    await rememberHead(target, state, recordOffset, encoded.length, codec)
    pendingCheckpoints.delete(target)
    await bindings.update(target, state, recordOffset, heads.get(target)?.identity ?? null).catch(() => undefined)
  }
  const appendTransitionWithinQueue = async (target: string, transition: DocumentStateTransition, checkpoint: DurableDocumentState): Promise<void> => {
    const head = await verifiedHead(target, transition.documentId)
    if (!head || head.sequence !== transition.baseSequence || head.epoch !== transition.epoch
      || transition.sequence !== head.sequence + 1 || head.disposition !== 'active')
      throw new DocumentJournalError('journal-sequence-conflict', '恢复增量的基础身份或顺序已改变')
    if (checkpoint.documentId !== transition.documentId || checkpoint.sequence !== transition.sequence
      || checkpoint.epoch !== transition.epoch || checkpoint.revision !== transition.revision || checkpoint.schemaVersion !== 3)
      throw new DocumentJournalError('journal-sequence-conflict', '恢复增量与当前checkpoint身份不一致')
    const prepared = head.codec.prepare('transition', transition)
    const encoded = recordPayload(prepared.payload)
    const before = await appendBytes(target, encoded)
    // No reference becomes reusable before its containing record is durable.
    prepared.commit()
    await rememberHead(target, checkpoint, head.checkpointOffset, head.checkpointLength, head.codec)
    await bindings.update(target, checkpoint, head.checkpointOffset, heads.get(target)?.identity ?? null).catch(() => undefined)
    // Maintenance is independent of the accepted ACK. Capture the immutable state now;
    // if a newer suffix wins the queue, leave it in place rather than overwrite it.
    const deltaBytes = before + encoded.length - head.checkpointOffset - head.checkpointLength
    if (deltaBytes > Math.max(16 * 1024 * 1024, head.checkpointLength)) scheduleCheckpoint(target, checkpoint)
  }
  const scheduleCheckpoint = (target: string, checkpoint: DurableDocumentState): void => {
    // One running job and one latest immutable state per journal. Encoding never
    // owns the file queue, so new durable appends can overtake stale preparation.
    pendingCheckpoints.set(target, checkpoint)
    if (preparingCheckpoints.has(target)) return
    preparingCheckpoints.add(target)
    setImmediate(() => {
      const checkpoint = pendingCheckpoints.get(target), head = heads.get(target)
      pendingCheckpoints.delete(target)
      const prepare = async () => {
        if (!checkpoint || !head || head.sequence !== checkpoint.sequence || head.epoch !== checkpoint.epoch) return
        const compacted = await createDocumentJournalCheckpoint(checkpoint)
        await serial(fileKey(target), async () => {
          const current = await verifiedHead(target, checkpoint.documentId)
          if (!current || current.sequence !== checkpoint.sequence || current.epoch !== checkpoint.epoch || current.identity !== head.identity) return
          const temporary = `${target}.checkpoint-${randomUUID()}.tmp`
          try {
            await writeFlushed(temporary, compacted)
            if (await journalIdentity(target) !== current.identity) return
            await fs.rename(temporary, target); await syncDirectory(directory)
            const codec = new DocumentJournalCodec()
            codec.adoptCheckpoint(checkpoint)
            await rememberHead(target, checkpoint, 0, compacted.length, codec)
            await bindings.update(target, checkpoint, 0, heads.get(target)?.identity ?? null).catch(() => undefined)
          } finally { await fs.rm(temporary, { force: true }).catch(() => undefined) }
        })
      }
      void prepare().catch(() => undefined).finally(() => {
        preparingCheckpoints.delete(target)
        const pending = pendingCheckpoints.get(target)
        if (pending) scheduleCheckpoint(target, pending)
      })
    })
  }
  const reconcileSave = async (target: string, state: DurableDocumentState): Promise<DurableDocumentState> => {
    if (state.disposition && state.disposition !== 'active') return state
    if (options.isLive?.(state.documentId)) return state
    const intent = await readIntent(state.documentId)
    if (!intent) return state
    if (!pendingSave(state, state.model.kind, intent)) {
      if (state.savedRevision === intent.revision && isDeepStrictEqual(state.binding, { ...intent.targetBinding, version: intent.expectedVersion })) await options.onBindingRecovered?.(state, intent.sourceBinding)
      return state
    }
    const targetPath = intent.targetBinding.path
    try {
      if ((await fs.lstat(targetPath)).isSymbolicLink()) return state
      if (fileKey(await fs.realpath(path.dirname(targetPath))) !== fileKey(path.dirname(targetPath))) return state
    } catch (error) { if (missing(error)) return state; throw error }
    const version = await readDocumentFileVersion(targetPath, intent.kind, intent.sourcePublication?.references)
    if (version !== intent.expectedVersion) return state
    if (intent.fileIdentity && await publicationIdentity(targetPath) !== intent.fileIdentity) return state
    try { await assertPublishedResources(path.dirname(targetPath), intent.sourcePublication) }
    catch (error) { if (error instanceof DocumentJournalError || missing(error)) return state; throw error }
    const diskModel = await readSavedModel(targetPath, intent.kind, intent.sourcePublication)
    if (await readDocumentFileVersion(targetPath, intent.kind, intent.sourcePublication?.references) !== version || intent.fileIdentity && await publicationIdentity(targetPath) !== intent.fileIdentity) return state
    try { await assertPublishedResources(path.dirname(targetPath), intent.sourcePublication) }
    catch (error) { if (error instanceof DocumentJournalError || missing(error)) return state; throw error }
    const repaired: DurableDocumentState = { ...state, schemaVersion: state.schemaVersion === 3 ? 3 : 2, disposition: 'active', sequence: state.sequence + 1,
      savedRevision: intent.revision, savedModel: diskModel,
      binding: { ...intent.targetBinding, version } }
    await appendWithinQueue(target, repaired)
    await options.onBindingRecovered?.(repaired, intent.sourceBinding)
    return repaired
  }
  const recordSaveIntent = (input: Parameters<DocumentPersistence['save']>[0], targetBinding: FileBinding, expectedVersion: string, fileIdentity: string | null): Promise<void> => {
    const target = filename(input.documentId)
    return serial(fileKey(target), async () => {
      const state = await verifiedHead(target, input.documentId)
      if (!state || state.disposition && state.disposition !== 'active' || state.revision < input.revision || state.kind !== input.model.kind) throw new Error('保存版本不属于当前文档恢复日志')
      // A later Save As may proceed independently of an earlier uncertain
      // publication. Keep only that unresolved operation's small original proof,
      // rather than overwriting the only way its caller can query the outcome.
      const previous = await readIntent(input.documentId)
      if (previous?.saveIdentity && !acknowledgedSave(state, state.kind, previous))
        await preserveJournalInput(intentFilename(input.documentId), path.dirname(retainedIntentFilename(input.documentId, previous.saveIdentity)))
      const intent: SaveIntent = { schemaVersion: 1, documentId: input.documentId, epoch: state.epoch,
        revision: input.revision, kind: input.model.kind, sourceBinding: state.binding,
        targetBinding, expectedVersion, ...(input.saveIdentity ? { saveIdentity: input.saveIdentity } : {}), ...(fileIdentity ? { fileIdentity } : {}),
        ...(input.sourcePublication ? { sourcePublication: input.sourcePublication } : {}) }
      const destination = intentFilename(input.documentId), temporary = `${destination}.${randomUUID()}.tmp`
      await fs.mkdir(directory, { recursive: true })
      try {
        await writeFlushed(temporary, Buffer.from(JSON.stringify(intent)))
        await fs.rename(temporary, destination)
        await syncDirectory(directory)
      } finally { await fs.rm(temporary, { force: true }).catch(() => {}) }
    })
  }
  const listBindings = async (): Promise<readonly JournalBindingMetadata[]> => {
    let names: string[]
    try { names = await fs.readdir(directory) } catch (error) { if (missing(error)) return []; throw error }
    const found: JournalBindingMetadata[] = []
    for (const name of names.filter(value => /^[a-f0-9]{64}\.journal$/.test(value)).sort()) {
      const target = path.join(directory, name)
      try {
      const entry = await serial(fileKey(target), async () => {
        let metadata = await bindings.read(target)
        if (!metadata) { await load(target); metadata = await bindings.read(target) }
        if (!metadata || metadata.disposition !== 'active') return null
        const intent = await readIntent(metadata.documentId)
        // A published Save As may not yet have acknowledged its new binding.
        if (pendingSave(metadata, metadata.kind, intent)) {
          const state = await load(target, metadata.documentId)
          if (state) await reconcileSave(target, state)
          metadata = await bindings.read(target)
        }
        return metadata
      })
      if (entry) found.push(entry)
      unavailable.delete(target)
      } catch {
        const prior = await bindings.read(target, true)
        const message = `一份文档恢复记录无法读取，原文件保留：${prior?.binding.kind === 'file' ? prior.binding.path : name}`
        unavailable.set(target, { ...(prior ? { documentId: prior.documentId } : {}),
          ...(prior?.binding.kind === 'file' ? { path: prior.binding.path } : {}), message })
        if (prior) found.push({ ...prior, unavailable: true })
      }
    }
    for (const filename of unavailable.keys()) if (!names.includes(path.basename(filename))) unavailable.delete(filename)
    return found
  }
  const saveCaptured = (input: Parameters<DocumentPersistence['save']>[0], prepared: boolean): ReturnType<DocumentPersistence['save']> => {
    const frozen = { ...input }
    if (frozen.binding.kind !== 'file') return Promise.reject(new Error('保存需要已选择的文件路径'))
    const binding = frozen.binding
    let observeSourcePublication: ((observation: PublishedSourceObservation) => void) | undefined
    try { observeSourcePublication = options.observeSourcePublication?.(frozen.documentId) }
    catch { /* An optional observer cannot prevent the captured save. */ }
    return serial(fileKey(binding.path), async () => {
      try {
        // Direct persistence consumers still get this same preparation owner,
        // but cannot re-import arbitrary files from a publication target.
        if (!prepared && !frozen.sourcePublication) {
          const prepared = await prepareDocumentSave(frozen.model, { kind: 'untitled', suggestedName: path.basename(binding.path) })
          frozen.model = prepared.model; frozen.sourcePublication = prepared.sourcePublication
        }
        if (frozen.sourcePublication) validateSourcePublication(frozen.sourcePublication)
        const saved = await saveFile(frozen, (target, expectedVersion, fileIdentity) => recordSaveIntent(frozen, target, expectedVersion, fileIdentity))
        const observation = preparedSources.get(frozen.model)
        preparedSources.delete(frozen.model)
        if (observation) {
          try { observeSourcePublication?.({ ...observation, documentId: frozen.documentId, revision: frozen.revision, binding: saved, model: frozen.model }) }
          catch { /* Passive preparation reuse cannot change an already-published save. */ }
        }
        return saved
      } catch (error) { throw error instanceof DocumentSaveFailure ? error : new DocumentSaveFailure('not-published', error) }
    })
  }
  return {
    async prepareSave(input) {
      let directoryDependency = false
      let sources: HtmlResourceSource[] = []
      const prepared = await prepareDocumentSave(input.model, input.sourceBinding, { currentSource: options.currentSource,
        format: sourceDocumentFormat(input.model, input.sourceBinding) ?? sourceDocumentFormat(input.model, input.targetBinding),
        onDependencyDirectory: () => { directoryDependency = true }, onHtmlResourceSources: value => { sources = value } })
      if (prepared.sourcePublication) preparedSources.set(prepared.model, { publication: prepared.sourcePublication, sources, directoryDependency })
      return prepared
    },
    append(state) {
      checkState(state, state.documentId)
      // V3 is the immutable Session-owned representation. Legacy direct callers still get a detached capture.
      const frozen = state.schemaVersion === 3 ? state : deserialize(serialize(state)) as DurableDocumentState
      const target = filename(frozen.documentId)
      return serial(fileKey(target), () => appendWithinQueue(target, frozen))
    },
    preserveRecovery(state) {
      const target = filename(state.documentId)
      return serial(fileKey(target), async () => {
        const head = await verifiedHead(target, state.documentId)
        if (!head || head.sequence !== state.sequence || head.epoch !== state.epoch)
          throw new DocumentJournalError('journal-sequence-conflict', '原恢复记录已改变，未隔离或覆盖历史')
        const retained = path.join(directory, 'recovery-inputs', `${path.basename(target, '.journal')}-${randomUUID()}`)
        await preserveJournalInput(target, retained)
        try { await writeFlushed(path.join(retained, path.basename(intentFilename(state.documentId))), await fs.readFile(intentFilename(state.documentId))) }
        catch (error) { if (!missing(error)) throw error }
        await syncDirectory(retained)
        return retained
      })
    },
    appendTransition(transition, checkpoint) {
      // Both inputs are private immutable Session facts, not renderer/IPC payloads.
      return serial(fileKey(filename(transition.documentId)), () => appendTransitionWithinQueue(filename(transition.documentId), transition, checkpoint))
    },
    finalize(state, disposition) {
      checkState(state, state.documentId)
      const terminal: DurableDocumentState = { ...state, schemaVersion: state.schemaVersion === 3 ? 3 : 2, disposition, sequence: state.sequence + 1 }
      const frozen = state.schemaVersion === 3 ? terminal : deserialize(serialize(terminal)) as DurableDocumentState
      const target = filename(frozen.documentId)
      return serial(fileKey(target), () => appendWithinQueue(target, frozen))
    },
    recover(documentId) {
      const target = filename(documentId)
      return serial(fileKey(target), async () => {
        const state = await load(target, documentId)
        return state && (!state.disposition || state.disposition === 'active') ? reconcileSave(target, state) : null
      })
    },
    discard(documentId) {
      const target = filename(documentId)
      return serial(fileKey(target), async () => {
        const state = await load(target, documentId)
        // Discard applies to the authoring draft, not an uncertain disk write.
        // Do not require proof I/O to succeed just to close the document; an
        // unreadable intent remains available for the original query/diagnosis.
        let retainIntent = true
        try {
          const intent = await readIntent(documentId)
          retainIntent = Boolean(intent && (!state || !acknowledgedSave(state, state.model.kind, intent)))
        } catch { /* Keep the unclassified publication evidence. */ }
        if (state && (!state.disposition || state.disposition === 'active')) {
          await appendWithinQueue(target, { ...state, schemaVersion: state.schemaVersion === 3 ? 3 : 2, disposition: 'discarded', sequence: state.sequence + 1 })
        }
        await Promise.all([target, ...(!retainIntent ? [intentFilename(documentId)] : [])].map(name => fs.rm(name, { force: true })))
        await bindings.discard(target)
        heads.delete(target)
        pendingCheckpoints.delete(target)
        await syncDirectory(directory)
      })
    },
    preserveUnavailable(documentId) {
      const target = filename(documentId)
      return serial(fileKey(target), async () => {
        const retained = path.join(directory, 'unavailable', `${path.basename(target)}-${randomUUID()}`)
        await fs.mkdir(retained, { recursive: true })
        for (const source of [target, intentFilename(documentId), `${target}.binding.json`]) {
          try { await fs.rename(source, path.join(retained, path.basename(source))) }
          catch (error) { if (!missing(error)) throw error }
        }
        await bindings.discard(target); unavailable.delete(target); heads.delete(target); pendingCheckpoints.delete(target)
        await syncDirectory(directory)
      })
    },
    async lookupSave(documentId, identity) {
      return serial(fileKey(filename(documentId)), async () => {
        const intent = await readIntent(documentId, identity)
        if (!intent?.saveIdentity || !isDeepStrictEqual(intent.saveIdentity, identity) || !intent.fileIdentity) return null
        try {
          if (fileKey(await fs.realpath(path.dirname(intent.targetBinding.path))) !== fileKey(path.dirname(intent.targetBinding.path))) return null
          if (await publicationIdentity(intent.targetBinding.path) !== intent.fileIdentity) return null
          const version = await readDocumentFileVersion(intent.targetBinding.path, intent.kind, intent.sourcePublication?.references)
          if (version !== intent.expectedVersion) return null
          await assertPublishedResources(path.dirname(intent.targetBinding.path), intent.sourcePublication)
          const savedModel = await readSavedModel(intent.targetBinding.path, intent.kind, intent.sourcePublication)
          if (await readDocumentFileVersion(intent.targetBinding.path, intent.kind, intent.sourcePublication?.references) !== version) return null
          await assertPublishedResources(path.dirname(intent.targetBinding.path), intent.sourcePublication)
          return { identity, documentId, epoch: intent.epoch, savedRevision: intent.revision,
            sourceBinding: intent.sourceBinding, binding: { ...intent.targetBinding, version }, savedModel,
            warnings: intent.sourcePublication?.diagnostics.map(diagnostic => diagnostic.message) ?? [] }
        } catch (error) { if (missing(error) || error instanceof DocumentJournalError && error.code === 'resource-conflict') return null; throw error }
      })
    },
    listBindings,
    get recoveryIssues() { return [...unavailable.values()].map(issue => issue.message) },
    async assertAvailable(paths = [], documentIds = [], _readOnly = false) {
      await listBindings()
      const contains = (parent: string, child: string) => { const rel = path.relative(fileKey(parent), fileKey(child)); return !rel || rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel) }
      // Unknown ownership is a diagnostic, not a reservation of every workspace path.
      // A supplied document ID can still identify its exact journal without trusting a
      // damaged payload or a missing binding index.
      for (const [target, issue] of unavailable) if (documentIds.some(id => filename(id) === target)
        || issue.documentId && documentIds.includes(issue.documentId)
        || issue.path && paths.some(filename => contains(issue.path!, filename) || contains(filename, issue.path!))) throw new Error(issue.message)
    },
    async list() { return (await listBindings()).filter(entry => !entry.unavailable).map(entry => entry.documentId) },
    inspect(documentId) {
      const target = filename(documentId)
      return serial(fileKey(target), () => scan(target, documentId, { repairTail: false }))
    },
    save(input) { return saveCaptured(deserialize(serialize(input)) as typeof input, false) },
    savePrepared(input) { return saveCaptured(input, true) },
  }
}

