import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { attachmentSnapshotSchema, type AttachmentReader, type AttachmentSnapshot, type AttachmentRepresentation, type AttachmentExtractor, type AttachmentPageRange } from '../../../shared/workbench/attachments'
import { prepareImageResource } from '../admittedImageResource'
import { MATERIAL_EXTRACTION_LIMITS } from '../../../shared/materialExtraction'

export class AttachmentError extends Error {
  constructor(readonly code: string, message: string, options?: ErrorOptions) { super(message, options); this.name = 'AttachmentError' }
}
export interface AttachmentServiceOptions {
  directory: string
  maxSourceBytes?: number
  extractor?: AttachmentExtractor
  /** Resolves an already granted read capability; the service never grants a path. */
  resolveAuthorizedPath?: (authorizationId: string) => Promise<{ path: string; kind?: 'file' | 'workspace' }>
}
export interface ReceiveAttachmentBytes {
  name: string
  bytes: Uint8Array
  declaredMediaType?: string
  source: Omit<AttachmentSnapshot['source'], 'readOnly'>
}
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const storageQueues = new Map<string, Promise<unknown>>()
const attachmentId = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value)
interface ReleaseIntent { version: 1; workspaceId: string; conversationId: string; attachmentIds: string[] }
export interface AttachmentLiveConversation { workspaceId: string; conversationId: string; attachmentIds: string[] }
function abort(signal?: AbortSignal) { signal?.throwIfAborted() }
function imageType(bytes: Buffer): string | undefined {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg'
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  if (['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))) return 'image/gif'
}

/** Managed immutable snapshots. Removing a draft reference must not delete this store. */
export class AttachmentService implements AttachmentReader {
  private readonly directory: string
  private readonly queueKey: string
  private readonly limit: number
  constructor(private readonly options: AttachmentServiceOptions) {
    this.directory = path.resolve(options.directory)
    this.queueKey = process.platform === 'win32' ? this.directory.toLowerCase() : this.directory
    this.limit = options.maxSourceBytes ?? 32 * 1024 * 1024
    if (!Number.isSafeInteger(this.limit) || this.limit < 1) throw new Error('Invalid attachment byte limit')
  }

  private serialStorage<T>(work: () => Promise<T>): Promise<T> {
    const result = (storageQueues.get(this.queueKey) ?? Promise.resolve()).catch(() => undefined).then(work)
    const tail = result.catch(() => undefined)
    storageQueues.set(this.queueKey, tail)
    void tail.finally(() => { if (storageQueues.get(this.queueKey) === tail) storageQueues.delete(this.queueKey) })
    return result
  }
  private releasePath(workspaceId: string, conversationId: string): string {
    return path.join(this.directory, 'releases', `${hash(Buffer.from(`${workspaceId}\u0000${conversationId}`))}.json`)
  }
  private async atomic(filename: string, bytes: Buffer): Promise<void> {
    const temporary = `${filename}.${randomUUID()}.tmp`
    const handle = await fs.open(temporary, 'wx', 0o600)
    try {
      try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
      await fs.rename(temporary, filename)
    } finally { await fs.rm(temporary, { force: true }).catch(() => undefined) }
  }

  /** A release intent is durable before the owning conversation is removed. An interrupted
   * deletion keeps its references because reconciliation checks the live owner again.
   */
  prepareConversationRelease(input: ReleaseIntent): Promise<void> {
    const intent = structuredClone(input)
    if (intent.version !== 1 || !intent.workspaceId || !intent.conversationId
      || !Array.isArray(intent.attachmentIds) || !intent.attachmentIds.every(attachmentId)) throw new AttachmentError('invalid-release-intent', '附件释放请求无效')
    if (!intent.attachmentIds.length) return Promise.resolve()
    intent.attachmentIds = [...new Set(intent.attachmentIds)]
    return this.serialStorage(async () => {
      await this.ensureDirectories()
      await this.atomic(this.releasePath(intent.workspaceId, intent.conversationId), Buffer.from(JSON.stringify(intent)))
    })
  }

  /** Only app-managed snapshots listed by a deleted owner may be removed. Blob retention is
   * determined from every surviving snapshot, including unattached intake and derived material.
   */
  collectConversationReleases(live: readonly AttachmentLiveConversation[]): Promise<void> {
    const conversations = structuredClone(live)
    return this.serialStorage(async () => {
      await this.ensureDirectories()
      const activeOwners = new Set(conversations.map(item => `${item.workspaceId}\u0000${item.conversationId}`))
      const retainedIds = new Set(conversations.flatMap(item => item.attachmentIds))
      const releaseDirectory = path.join(this.directory, 'releases')
      const releaseNames = (await fs.readdir(releaseDirectory)).filter(name => /^[a-f0-9]{64}\.json$/.test(name))
      if (!releaseNames.length) return
      const intents: Array<{ filename: string; value: ReleaseIntent; ownerLive: boolean }> = []
      for (const name of releaseNames) {
        const filename = path.join(releaseDirectory, name)
        let value: ReleaseIntent
        try { value = JSON.parse((await this.readFile(filename)).toString('utf8')) as ReleaseIntent }
        catch { throw new AttachmentError('corrupt-release-intent', '附件释放记录无法读取，未删除资源') }
        if (value.version !== 1 || !value.workspaceId || !value.conversationId || !Array.isArray(value.attachmentIds)
          || !value.attachmentIds.every(attachmentId) || this.releasePath(value.workspaceId, value.conversationId) !== filename)
          throw new AttachmentError('corrupt-release-intent', '附件释放记录无效，未删除资源')
        intents.push({ filename, value, ownerLive: activeOwners.has(`${value.workspaceId}\u0000${value.conversationId}`) })
      }
      const candidates = new Set(intents.filter(item => !item.ownerLive).flatMap(item => item.value.attachmentIds))
      const snapshotsDirectory = path.join(this.directory, 'snapshots')
      const snapshots = [] as Awaited<ReturnType<AttachmentService['readSnapshot']>>[]
      for (const name of (await fs.readdir(snapshotsDirectory)).filter(value => /^[a-f0-9-]{36}\.json$/.test(value)))
        snapshots.push(await this.readSnapshot(name.slice(0, -5)))
      const retainedDigests = new Set<string>()
      for (const snapshot of snapshots) {
        if (candidates.has(snapshot.id) && !retainedIds.has(snapshot.id)) {
          await fs.rm(path.join(snapshotsDirectory, `${snapshot.id}.json`), { force: true })
        } else {
          retainedDigests.add(snapshot.blobRef.digest)
          for (const representation of snapshot.representations) retainedDigests.add(representation.blobRef.digest)
        }
      }
      for (const digest of (await fs.readdir(path.join(this.directory, 'blobs'))).filter(value => /^[a-f0-9]{64}$/.test(value)))
        if (!retainedDigests.has(digest)) await fs.rm(path.join(this.directory, 'blobs', digest), { force: true })
      for (const intent of intents) if (intent.ownerLive || intent.value.attachmentIds.every(id => !retainedIds.has(id)))
        await fs.rm(intent.filename, { force: true })
    })
  }

  async receivePath(input: { authorizationId: string; name?: string }, options: { signal?: AbortSignal; onProgress?: (loaded: number, total: number) => void } = {}): Promise<AttachmentSnapshot> {
    input = structuredClone(input)
    abort(options.signal)
    if (!this.options.resolveAuthorizedPath) throw new AttachmentError('path-not-authorized', '没有已授权的文件读取入口')
    const authorized = await this.options.resolveAuthorizedPath(input.authorizationId)
    abort(options.signal)
    const handle = await fs.open(authorized.path, 'r')
    let bytes: Buffer
    try {
      const before = await handle.stat()
      if (!before.isFile()) throw new AttachmentError('not-a-file', '附件必须是普通文件')
      if (before.size > this.limit) throw new AttachmentError('source-too-large', '附件原件超过接收大小限制')
      abort(options.signal)
      options.onProgress?.(0, before.size)
      const chunks: Buffer[] = []; let total = 0
      while (true) {
        abort(options.signal)
        const chunk = Buffer.alloc(Math.min(65536, this.limit + 1 - total))
        const { bytesRead } = await handle.read(chunk)
        if (!bytesRead) break
        total += bytesRead
        if (total > this.limit) throw new AttachmentError('source-too-large', '附件原件超过接收大小限制')
        chunks.push(chunk.subarray(0, bytesRead))
        abort(options.signal)
        options.onProgress?.(total, before.size)
      }
      const after = await handle.stat()
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new AttachmentError('source-changed', '附件在读取期间已改变，请重新添加')
      bytes = Buffer.concat(chunks)
    } finally { await handle.close() }
    return this.receiveBytes({ name: input.name ?? path.basename(authorized.path), bytes, source: { kind: authorized.kind ?? 'file', authorizationId: input.authorizationId, pathHint: authorized.path } }, options)
  }

  async receiveBytes(input: ReceiveAttachmentBytes, options: { signal?: AbortSignal } = {}): Promise<AttachmentSnapshot> {
    // Copy before the first await: changing a caller's buffer cannot change an admitted snapshot.
    const bytes = Buffer.from(input.bytes), source = structuredClone(input.source), name = input.name, declared = input.declaredMediaType
    abort(options.signal)
    if (bytes.byteLength > this.limit) throw new AttachmentError('source-too-large', '附件原件超过接收大小限制')
    const digest = hash(bytes), blobRef = { digest, byteLength: bytes.length }
    const provenance = { originalDigest: digest, originalByteLength: bytes.length, complete: true, downsampled: false }
    const representations: AttachmentRepresentation[] = [], gaps: AttachmentSnapshot['gaps'] = []
    let mediaType = imageType(bytes)
    if (mediaType) {
      if (declared && declared !== mediaType && declared !== 'application/octet-stream') throw new AttachmentError('media-type-mismatch', '图片声明类型与真实字节不匹配')
      let admitted: Awaited<ReturnType<typeof prepareImageResource>>
      try { admitted = await prepareImageResource({ bytes, mimeType: mediaType, filename: name }, randomUUID) }
      catch (cause) { throw new AttachmentError('invalid-image', '附件图片无法完整解码', { cause }) }
      representations.push({ id: 'original-image', kind: 'image', mediaType, blobRef, width: admitted.meta.width!, height: admitted.meta.height!, provenance: { ...provenance, producer: 'sharp-verified-v1' } })
    } else if (declared?.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(name)) {
      throw new AttachmentError('invalid-image', '附件没有有效的图片字节')
    } else if (bytes.toString('ascii', 0, 5) === '%PDF-' || bytes.subarray(0, 2).equals(Buffer.from('PK'))) {
      mediaType = bytes.toString('ascii', 0, 5) === '%PDF-' ? 'application/pdf' : 'application/zip'
      representations.push({ id: 'original-file', kind: 'file', mediaType, blobRef, provenance: { ...provenance, producer: 'original-v1' } })
      gaps.push({ code: 'extraction-unavailable', message: '原件已保存；请提取需要的页或全文后发送。' })
    } else {
      let text: string
      try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); if (text.includes('\0')) throw new Error('binary') }
      catch { throw new AttachmentError('unsupported-representation', '该附件没有可用的文本或图片表示') }
      mediaType = /\.(md|markdown)$/i.test(name) ? 'text/markdown' : 'text/plain'
      representations.push({ id: 'original-text', kind: 'text', mediaType, blobRef, characters: text.length, provenance: { ...provenance, producer: 'utf8-v1', range: { unit: 'characters', from: 0, to: text.length, total: text.length } } })
    }
    abort(options.signal)
    const snapshot = attachmentSnapshotSchema.parse({ schemaVersion: 1, id: randomUUID(), capturedAt: Date.now(), state: 'added', name, source: { ...source, readOnly: true }, mediaType, byteLength: bytes.length, digest, blobRef, representations, gaps })
    await this.serialStorage(async () => {
      await this.ensureDirectories()
      await this.install(path.join(this.directory, 'blobs', digest), bytes)
      abort(options.signal)
      await this.install(path.join(this.directory, 'snapshots', `${snapshot.id}.json`), Buffer.from(JSON.stringify(snapshot)))
    })
    return structuredClone(snapshot)
  }

  async readSnapshot(id: string): Promise<AttachmentSnapshot> {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new AttachmentError('invalid-id', '附件标识无效')
    const bytes = await this.readFile(path.join(this.directory, 'snapshots', `${id}.json`))
    let snapshot: AttachmentSnapshot
    try { snapshot = attachmentSnapshotSchema.parse(JSON.parse(bytes.toString('utf8'))) }
    catch (cause) { throw new AttachmentError('corrupt-snapshot', '附件快照记录无法读取', { cause }) }
    if (snapshot.id !== id || snapshot.digest !== snapshot.blobRef.digest || snapshot.byteLength !== snapshot.blobRef.byteLength) throw new AttachmentError('corrupt-snapshot', '附件快照身份不一致')
    return snapshot
  }

  /** Derivation creates a new immutable record; callers explicitly replace their draft reference. */
  async extract(attachmentId: string, options: { pages?: AttachmentPageRange; signal?: AbortSignal } = {}): Promise<AttachmentSnapshot> {
    const pages = options.pages && structuredClone(options.pages)
    abort(options.signal)
    if (!this.options.extractor) throw new AttachmentError('extraction-unavailable', '附件提取工作进程尚未配置')
    const original = await this.readSnapshot(attachmentId)
    const bytes = await this.readFile(path.join(this.directory, 'blobs', original.digest))
    if (bytes.length !== original.byteLength || hash(bytes) !== original.digest) throw new AttachmentError('corrupt-blob', '附件原件快照已损坏')
    const extracted = await this.options.extractor.extract({ bytes: Uint8Array.from(bytes), filename: original.name, ...(pages ? { pages } : {}) }, { signal: options.signal })
    abort(options.signal)
    const { material, totalPages, selectedPages } = extracted
    if (!['pdf', 'docx', 'pptx'].includes(material.format) || material.format !== original.name.split('.').pop()?.toLowerCase() ||
        material.version !== 1 || !Array.isArray(material.fragments) || !Array.isArray(material.assets) || !Array.isArray(material.gaps) ||
        material.fragments.length > 100_000 || material.assets.length > 4096 || material.gaps.length > 100_000) throw new AttachmentError('invalid-extraction', '附件提取返回结构无效')
    if (material.format !== 'docx' && (!Number.isSafeInteger(totalPages) || totalPages! < 1 || totalPages! > MATERIAL_EXTRACTION_LIMITS.pages || !selectedPages ||
        !Number.isSafeInteger(selectedPages.from) || !Number.isSafeInteger(selectedPages.to) || selectedPages.from < 1 || selectedPages.to < selectedPages.from || selectedPages.to > totalPages! ||
        selectedPages.from !== (pages?.from ?? 1) || selectedPages.to !== (pages?.to ?? totalPages))) throw new AttachmentError('invalid-extraction', '附件提取页范围不一致')
    if (material.format === 'docx' && (pages || totalPages !== undefined || selectedPages)) throw new AttachmentError('invalid-extraction', 'Word XML 不提供可靠页范围')
    const representations: AttachmentRepresentation[] = [], gaps: AttachmentSnapshot['gaps'] = []
    const assets = new Map(material.assets.map(asset => [asset.id, asset]))
    if (assets.size !== material.assets.length) throw new AttachmentError('invalid-extraction', '提取素材标识重复')
    let outputBytes = 0, textCharacters = 0
    for (const asset of material.assets) {
      if (!(asset.bytes instanceof Uint8Array)) throw new AttachmentError('invalid-extraction', '提取素材不是有效字节')
      outputBytes += asset.bytes.length
    }
    if (outputBytes > MATERIAL_EXTRACTION_LIMITS.outputBytes) throw new AttachmentError('extraction-too-large', '附件提取表示超过容量上限')
    const blobs = new Map<string, Buffer>(), assetRepresentations = new Map<string, string>()
    for (const fragment of material.fragments) {
      abort(options.signal)
      if (!fragment.locator || typeof fragment.locator.part !== 'string' || (selectedPages && (!fragment.locator.page || fragment.locator.page < selectedPages.from || fragment.locator.page > selectedPages.to))) throw new AttachmentError('invalid-extraction', '提取片段缺少实际来源')
      const provenance = {
        originalDigest: original.digest, originalByteLength: original.byteLength,
        producer: material.format === 'pdf' ? 'pdfjs-v1' as const : 'office-xml-v1' as const,
        complete: !material.gaps.some(gap => gap.locator.part === fragment.locator.part && gap.locator.page === fragment.locator.page),
        downsampled: false, locator: fragment.locator,
        ...(fragment.locator.page && totalPages ? { range: { unit: 'pages' as const, from: fragment.locator.page, to: fragment.locator.page, total: totalPages } } : {}),
      }
      const id = `extracted-${representations.length + 1}`
      if (fragment.kind === 'image') {
        const asset = fragment.assetId && assets.get(fragment.assetId)
        if (!asset) throw new AttachmentError('invalid-extraction', '提取图片没有关联字节')
        const assetBytes = Buffer.from(asset.bytes), mediaType = imageType(assetBytes)
        if (!mediaType || mediaType !== asset.mime) { gaps.push({ code: 'unsupported-image', message: `图片 ${asset.id} 尚无可发送的已验证像素表示（${asset.mime}）`, locator: fragment.locator }); continue }
        let admitted: Awaited<ReturnType<typeof prepareImageResource>>
        try { admitted = await prepareImageResource({ bytes: assetBytes, mimeType: mediaType, filename: asset.id }, randomUUID) }
        catch (cause) { throw new AttachmentError('invalid-extraction', '提取图片无法完整解码', { cause }) }
        const pageImage = extracted.pageImages.find(image => image.assetId === asset.id)
        if (material.format === 'pdf' && (!pageImage || pageImage.width !== admitted.meta.width || pageImage.height !== admitted.meta.height)) throw new AttachmentError('invalid-extraction', 'PDF 页图尺寸与实际像素不一致')
        const blobRef = { digest: hash(assetBytes), byteLength: assetBytes.length }
        representations.push({ id, kind: 'image', mediaType, blobRef, width: admitted.meta.width!, height: admitted.meta.height!, provenance: { ...provenance, downsampled: pageImage?.downsampled ?? false } })
        blobs.set(blobRef.digest, assetBytes); assetRepresentations.set(asset.id, id)
      } else {
        if (!['text', 'table', 'formula'].includes(fragment.kind) || typeof fragment.text !== 'string') throw new AttachmentError('invalid-extraction', '提取文本片段无效')
        textCharacters += fragment.text.length
        if (textCharacters > MATERIAL_EXTRACTION_LIMITS.textCharacters) throw new AttachmentError('extraction-too-large', '附件提取文本超过容量上限')
        const textBytes = Buffer.from(fragment.text), blobRef = { digest: hash(textBytes), byteLength: textBytes.length }
        representations.push({ id, kind: 'text', mediaType: 'text/plain', characters: fragment.text.length, blobRef, provenance })
        blobs.set(blobRef.digest, textBytes)
      }
    }
    for (const gap of material.gaps) {
      const resolutionRepresentationId = gap.resolution && assetRepresentations.get(gap.resolution.assetId)
      gaps.push({ code: gap.resolution?.kind === 'read-page-image' ? 'scanned-page' : 'extraction-gap', message: gap.reason, locator: gap.locator, ...(resolutionRepresentationId ? { resolutionRepresentationId } : {}) })
    }
    const snapshot = attachmentSnapshotSchema.parse({ ...original, id: randomUUID(), derivedFrom: original.id, capturedAt: Date.now(), representations, gaps,
      coverage: { format: material.format, complete: !gaps.length && (!selectedPages || selectedPages.from === 1 && selectedPages.to === totalPages), ...(totalPages ? { totalPages, selectedPages } : {}) },
    })
    await this.serialStorage(async () => {
      await this.ensureDirectories()
      for (const [digest, data] of blobs) { abort(options.signal); await this.install(path.join(this.directory, 'blobs', digest), data) }
      abort(options.signal)
      await this.install(path.join(this.directory, 'snapshots', `${snapshot.id}.json`), Buffer.from(JSON.stringify(snapshot)))
    })
    return structuredClone(snapshot)
  }

  async readRepresentation(attachmentId: string, representationId: string) {
    const snapshot = await this.readSnapshot(attachmentId)
    const representation = snapshot.representations.find(item => item.id === representationId)
    if (!representation) throw new AttachmentError('representation-unavailable', snapshot.gaps[0]?.message ?? '附件表示不存在')
    if (representation.provenance.originalDigest !== snapshot.digest || representation.provenance.originalByteLength !== snapshot.byteLength) throw new AttachmentError('corrupt-snapshot', '附件来源不一致')
    const bytes = await this.readFile(path.join(this.directory, 'blobs', representation.blobRef.digest))
    if (bytes.length !== representation.blobRef.byteLength || hash(bytes) !== representation.blobRef.digest) throw new AttachmentError('corrupt-blob', '附件快照内容已损坏')
    return { snapshot, representation, bytes: Uint8Array.from(bytes) }
  }

  private async ensureDirectories() {
    for (const directory of [this.directory, path.join(this.directory, 'blobs'), path.join(this.directory, 'snapshots'), path.join(this.directory, 'releases')]) {
      await fs.mkdir(directory, { recursive: true })
      const stat = await fs.lstat(directory)
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new AttachmentError('unsafe-store', '附件存储目录无效')
    }
  }
  private async readFile(filename: string) {
    const stat = await fs.lstat(filename)
    if (!stat.isFile() || stat.isSymbolicLink()) throw new AttachmentError('unsafe-store', '附件存储文件无效')
    return fs.readFile(filename)
  }
  private async install(filename: string, bytes: Buffer) {
    const temporary = `${filename}.${randomUUID()}.tmp`
    const handle = await fs.open(temporary, 'wx')
    try {
      try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
      try { await fs.link(temporary, filename) }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        if (!(await this.readFile(filename)).equals(bytes)) throw new AttachmentError('corrupt-blob', '附件存储中已有不同内容')
      }
    } finally { await fs.unlink(temporary) }
  }
}
