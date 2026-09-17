import { createHash, randomUUID } from 'node:crypto'
import { promises as fs, watch } from 'node:fs'
import path from 'node:path'
import { documentRelativePathSchema } from '../shared/document/resources'
import { documentRefKey, type DocumentAiEditRecord, type DocumentFilePort, type DocumentFileRef, type DocumentFileVersion, type DocumentSaveRequest, type DocumentSaveResult, type OpenDocumentResult } from '../shared/document/ports'
import { applyDocumentRanges, revertDocumentRanges } from './lessonDocumentCoauthoring'
import { parseDocumentMarkdown } from '../shared/document/markdown'
import { resolveFileDocumentImage } from '../shared/document/fileImageReference'

const hash = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex')
const same = (a: DocumentFileVersion | null, b: DocumentFileVersion | null) => JSON.stringify(a) === JSON.stringify(b)
interface Recovery { schemaVersion: 1; request: DocumentSaveRequest; phase: 'prepared' | 'written' | 'recorded'; result?: DocumentSaveResult }
export interface LessonDocumentFilesOptions {
  recoveryDirectory: string
  validateTarget: (ref: DocumentFileRef, epoch?: number) => Promise<void>
}

export function createLessonDocumentFiles(options: LessonDocumentFilesOptions) {
  const queues = new Map<string, Promise<unknown>>()
  const prepared = new Map<string, { disk: OpenDocumentResult; epoch: number; ranges: { from: number; to: number }[] }>()
  const invalidatedEpochs = new Map<string, number>()
  const issuedEpochs = new Map<string, number>()
  const generations = new Map<string, number>()
  const key = (ref: DocumentFileRef) => hash(documentRefKey(ref))
  const refLabel = (ref: DocumentFileRef) => ref.kind === 'lesson' ? ref.relativePath : (ref.path.split(/[\\/]/).pop() ?? ref.path)
  const refBaseLabel = (ref: DocumentFileRef) => {
    const label = ref.kind === 'lesson' ? ref.relativePath : ref.path.replace(/\\/g, '/')
    return path.posix.dirname(label.split(/[\\/]/).join('/'))
  }
  async function rootDir(ref: DocumentFileRef): Promise<string> {
    return ref.kind === 'lesson' ? await fs.realpath(ref.lessonDirectory) : path.dirname(await fs.realpath(ref.path))
  }
  const local = (ref: DocumentFileRef, name: string) => path.join(options.recoveryDirectory, key(ref), name)
  async function atomic(filename: string, bytes: string | Uint8Array, validate?: () => void | Promise<void>) {
    await fs.mkdir(path.dirname(filename), { recursive: true })
    const temporary = `${filename}.${randomUUID()}.tmp`
    try { await fs.writeFile(temporary, bytes); await validate?.(); await fs.rename(temporary, filename) }
    finally { await fs.rm(temporary, { force: true }).catch(() => {}) }
  }
  async function resolve(ref: DocumentFileRef, relativePath?: string) {
    const relative = relativePath ?? refLabel(ref)
    documentRelativePathSchema.parse(relative)
    await options.validateTarget(ref)
    const root = await rootDir(ref)
    const target = path.resolve(root, relative)
    let ancestor = target
    for (;;) {
      try {
        const real = await fs.realpath(ancestor)
        const relative = path.relative(root, real)
        if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('文件引用越出课例目录')
        break
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        ancestor = path.dirname(ancestor)
      }
    }
    return target
  }
  function serial<T>(ref: DocumentFileRef, action: () => Promise<T>): Promise<T> {
    const id = key(ref), previous = queues.get(id) ?? Promise.resolve()
    const next = previous.catch(() => {}).then(action)
    queues.set(id, next)
    void next.finally(() => { if (queues.get(id) === next) queues.delete(id) }).catch(() => {})
    return next
  }
  async function inspect(ref: DocumentFileRef, candidateSource?: string): Promise<OpenDocumentResult> {
    const source = candidateSource ?? await fs.readFile(await resolve(ref), 'utf8')
    const refs = new Set<string>()
    const add = (href: string) => {
      if (/^(https?:|data:|mailto:|#)/i.test(href)) return
      const decoded = decodeURIComponent(href.split(/[?#]/)[0]!)
      const relative = path.posix.normalize(path.posix.join(refBaseLabel(ref), decoded))
      documentRelativePathSchema.parse(relative); refs.add(relative)
    }
    const { Lexer } = await import('marked')
    const tokens = Lexer.lex(source)
    const visit = (values: unknown[]) => { for (const value of values) {
      if (!value || typeof value !== 'object') continue
      const token = value as Record<string, unknown>
      if ((token.type === 'image' || token.type === 'link') && typeof token.href === 'string') add(token.href)
      for (const child of Object.values(token)) if (Array.isArray(child)) visit(child)
    } }
    visit(tokens)
    for (const match of source.matchAll(/(`{3,})cw-object-v1\s*\n([\s\S]*?)\n\1/g)) {
      try {
        const object = JSON.parse(match[2]!) as { resources?: { assets?: { source: { kind: string; path?: string } }[]; components?: { source: { kind: string; path?: string } }[] } }
        for (const resource of [...(object.resources?.assets ?? []), ...(object.resources?.components ?? [])]) {
          if (resource.source.kind === 'project') throw new Error('真实 Markdown 不能保留 project 资源引用')
          if (resource.source.path) { documentRelativePathSchema.parse(resource.source.path); refs.add(resource.source.path) }
        }
      } catch (error) { if (!(error instanceof SyntaxError)) throw error }
    }
    const parsed = parseDocumentMarkdown(source, { target: 'file', createId: () => randomUUID(), resolveImage: href => resolveFileDocumentImage(refLabel(ref), href) })
    const diagnostics: OpenDocumentResult['diagnostics'] = [...parsed.diagnostics]
    const attachments: DocumentFileVersion['attachments'] = []
    for (const relativePath of [...refs].sort()) {
      try { attachments.push({ relativePath, contentVersion: hash(await fs.readFile(await resolve(ref, relativePath))) }) }
      catch (error) { attachments.push({ relativePath, contentVersion: 'missing' }); diagnostics.push({ message: `附件不可读取：${relativePath} (${(error as Error).message})`, offset: 0, endOffset: 0, line: 1, column: 1 }) }
    }
    return { ref, source, version: { contentVersion: hash(source), attachments }, diagnostics }
  }
  async function readOptional(ref: DocumentFileRef) {
    try { return await inspect(ref) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
  }
  async function hasPendingDraftContent(ref: DocumentFileRef, source: string, attachments: DocumentSaveRequest['attachments']) {
    const disk = await readOptional(ref).catch(() => null)
    if (!disk || disk.source !== source) return true
    for (const attachment of attachments) {
      try { if (hash(await fs.readFile(await resolve(ref, attachment.relativePath))) !== hash(attachment.bytes)) return true }
      catch { return true }
    }
    return false
  }
  async function persistDraft(ref: DocumentFileRef, source: string, expectedVersion: DocumentFileVersion | null, attachments: DocumentSaveRequest['attachments'] = []) {
    if (!await hasPendingDraftContent(ref, source, attachments)) { await fs.rm(local(ref, 'draft.json'), { force: true }); return }
    let baseSource: string | undefined
    try {
      const disk = await readOptional(ref)
      if (disk && same(disk.version, expectedVersion)) baseSource = disk.source
    } catch { /* Recovery still preserves the draft when the original file is unavailable. */ }
    if (baseSource === undefined) {
      try {
        const previous = JSON.parse(await fs.readFile(local(ref, 'draft.json'), 'utf8')) as { expectedVersion: DocumentFileVersion | null; baseSource?: string }
        if (same(previous.expectedVersion, expectedVersion)) baseSource = previous.baseSource
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    }
    await atomic(local(ref, 'draft.json'), JSON.stringify({ schemaVersion: 1, ref, source, expectedVersion, baseSource, attachments: attachments.map(attachment => ({ ...attachment, bytes: Array.from(attachment.bytes) })) }))
  }
  async function save(request: DocumentSaveRequest, validate?: () => void | Promise<void>): Promise<DocumentSaveResult> {
    const { ref, operationId } = request
    const journal = local(ref, `operation-${hash(operationId)}.json`)
    const persist = (record: Recovery) => atomic(journal, JSON.stringify(record, (_key, value) => value instanceof Uint8Array ? [...value] : value))
    try {
      const filename = await resolve(ref)
      await validate?.()
      if (!refLabel(ref).toLowerCase().endsWith('.md')) throw new Error('文档必须是 Markdown 文件')
      let previous: Recovery | undefined
      try { previous = JSON.parse(await fs.readFile(journal, 'utf8')) as Recovery } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      const attachmentIdentity = (items: DocumentSaveRequest['attachments']) => JSON.stringify(items.map(item => ({ path: item.relativePath, digest: hash(new Uint8Array(item.bytes)) })).sort((a, b) => a.path.localeCompare(b.path)))
      if (previous && (previous.request.source !== request.source || !same(previous.request.expectedVersion, request.expectedVersion) || attachmentIdentity(previous.request.attachments) !== attachmentIdentity(request.attachments))) throw new Error('操作标识已用于其他修改')
      if (previous?.result) return previous.result
      let disk = await readOptional(ref)
      if (previous && disk?.source === request.source) {
        const result: DocumentSaveResult = { status: 'saved', operationId, version: disk.version }
        await persist({ ...previous, phase: 'recorded', result }); return result
      }
      if (!same(request.expectedVersion, disk?.version ?? null)) {
        await persistDraft(ref, request.source, request.expectedVersion, request.attachments)
        if (disk) return { status: 'conflict', operationId, disk }
        throw new Error('磁盘文档已删除；当前稿已保留')
      }
      await persist({ schemaVersion: 1, request, phase: 'prepared' })
      // New resources may not overwrite existing assets referenced by another draft.
      for (const attachment of request.attachments) {
        const target = await resolve(ref, attachment.relativePath)
        let existing: Buffer | undefined
        try { existing = await fs.readFile(target) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
        if (existing && hash(existing) !== hash(attachment.bytes)) throw new Error('附件已存在，请使用新的文件名')
        if (!existing) await atomic(target, attachment.bytes)
      }
      const candidate = await inspect(ref, request.source)
      if (candidate.version.attachments.some(attachment => attachment.contentVersion === 'missing')) throw new Error('正文引用的本地附件不可读取')
      disk = await readOptional(ref)
      const expectedAfterPreparation = request.expectedVersion && {
        ...request.expectedVersion,
        attachments: request.expectedVersion.attachments.map(attachment => {
          const preparedAttachment = request.attachments.find(item => item.relativePath === attachment.relativePath)
          return preparedAttachment && attachment.contentVersion === 'missing' ? { ...attachment, contentVersion: hash(preparedAttachment.bytes) } : attachment
        }),
      }
      if (!same(expectedAfterPreparation, disk?.version ?? null)) {
        if (disk) return { status: 'conflict', operationId, disk }
        throw new Error('写入前文件已被删除')
      }
      await atomic(filename, request.source, validate)
      await persist({ schemaVersion: 1, request, phase: 'written' })
      const result: DocumentSaveResult = { status: 'saved', operationId, version: (await inspect(ref)).version }
      await persist({ schemaVersion: 1, request, phase: 'recorded', result })
      try {
        const draft = JSON.parse(await fs.readFile(local(ref, 'draft.json'), 'utf8')) as { source: string }
        if (draft.source === request.source) await fs.rm(local(ref, 'draft.json'), { force: true })
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      return result
    } catch (error) {
      let recovery: 'saved' | 'failed' = 'saved'
      try { await persistDraft(ref, request.source, request.expectedVersion, request.attachments) } catch { recovery = 'failed' }
      return { status: 'failed', operationId, message: (error as Error).message, recovery }
    }
  }
  async function recoverAiEditRecord(ref: DocumentFileRef, operationId: string) {
    await options.validateTarget(ref)
    const prior = JSON.parse(await fs.readFile(local(ref, `ai-${hash(operationId)}.json`), 'utf8')) as { record?: DocumentAiEditRecord; source: string; conflicts: DocumentAiEditRecord['applied']; intent?: { baseVersion: DocumentFileVersion; applied: DocumentAiEditRecord['applied'] } }
    if (!prior.record) {
      if (!prior.intent) throw new Error('AI 改动记录不可用')
      const actual = await inspect(ref)
      const journal = JSON.parse(await fs.readFile(local(ref, `operation-${hash(operationId)}.json`), 'utf8')) as Recovery
      const version = journal.result?.status === 'saved' ? journal.result.version : actual.source === prior.source ? actual.version : null
      if (!version) throw new Error('AI 写入结果待核实，恢复稿已保留，未重复改稿')
      prior.record = { id: operationId, ref, baseVersion: prior.intent.baseVersion, savedVersion: version, applied: prior.intent.applied }
      await atomic(local(ref, `ai-${hash(operationId)}.json`), JSON.stringify(prior))
    }
    return { status: prior.conflicts.length ? 'partial' as const : 'applied' as const, record: prior.record, conflicts: prior.conflicts }
  }
  const port: DocumentFilePort = {
    openDocument: ref => inspect(ref),
    saveDocument: request => serial(request.ref, () => save(request)),
    watchDocument(ref, listener) {
      let disposed = false, timer: ReturnType<typeof setTimeout> | undefined, watcher: ReturnType<typeof watch> | undefined, last = ''
      const refresh = async () => { try {
        const disk = await readOptional(ref), version = JSON.stringify(disk?.version ?? null)
        if (!disposed && last !== version) { last = version; listener(disk ? { type: 'changed', disk } : { type: 'deleted' }) }
      } catch { /* Transient replacement is rechecked on the next watch event. */ } }
      void rootDir(ref).then(directory => { if (!disposed) { watcher = watch(directory, { recursive: true }, () => { clearTimeout(timer); timer = setTimeout(() => { void refresh() }, 40) }); void refresh() } }).catch(() => {})
      return () => { disposed = true; clearTimeout(timer); watcher?.close() }
    },
    async prepareAiEdit(ref, ranges, epoch) {
      const id = key(ref), generation = generations.get(id) ?? 0
      issuedEpochs.set(id, Math.max(epoch, issuedEpochs.get(id) ?? -Infinity))
      try {
        await options.validateTarget(ref, epoch)
        if (epoch <= (invalidatedEpochs.get(key(ref)) ?? -Infinity)) throw new Error('该 AI 任务已停止，请开始新的修改任务')
        const disk = await inspect(ref)
        if ((generations.get(id) ?? 0) !== generation) throw new Error('该 AI 任务已停止')
        if (ranges.some(range => disk.source.slice(range.from, range.to) !== range.before)) throw new Error('目标范围已改变')
        prepared.set(key(ref), { disk, epoch, ranges })
        return { status: 'ready', document: disk, epoch, ranges }
      } catch (error) { return { status: 'failed', message: (error as Error).message } }
    },
    applyAiEdit(request) { return serial(request.ref, async () => {
      try {
        await options.validateTarget(request.ref, request.epoch)
        const baseline = prepared.get(key(request.ref))
        const validatePrepared = () => {
          if (!baseline || prepared.get(key(request.ref)) !== baseline || baseline.epoch !== request.epoch || !same(baseline.disk.version, request.baseVersion)) throw new Error('AI 修改基准已失效')
        }
        validatePrepared()
        try {
          const prior = await recoverAiEditRecord(request.ref, request.operationId)
          if (!same(prior.record.baseVersion, request.baseVersion)) throw new Error('操作标识已用于其他 AI 修改')
          return prior
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
        if (!baseline) throw new Error('AI 修改基准已失效')
        if (request.edits.some(edit => !baseline.ranges.some(range => edit.from >= range.from && edit.to <= range.to))) throw new Error('AI 修改超出准备范围')
        const disk = await inspect(request.ref)
        const merged = applyDocumentRanges(baseline.disk.source, disk.source, request.edits)
        if (!merged.applied.length) return { status: 'conflict' as const, conflicts: merged.conflicts }
        await atomic(local(request.ref, `ai-${hash(request.operationId)}.json`), JSON.stringify({ source: merged.source, conflicts: merged.conflicts, intent: { baseVersion: request.baseVersion, applied: merged.applied } }))
        const result = await save({ ref: request.ref, expectedVersion: disk.version, source: merged.source, operationId: request.operationId, attachments: [] }, validatePrepared)
        if (result.status !== 'saved') return { status: 'failed' as const, message: result.status === 'failed' ? result.message : '保存前磁盘稿发生变化' }
        const record: DocumentAiEditRecord = { id: request.operationId, ref: request.ref, baseVersion: request.baseVersion, savedVersion: result.version, applied: merged.applied }
        await atomic(local(request.ref, `ai-${hash(record.id)}.json`), JSON.stringify({ record, source: merged.source, conflicts: merged.conflicts }))
        return { status: merged.conflicts.length ? 'partial' as const : 'applied' as const, record, conflicts: merged.conflicts }
      } catch (error) { return { status: 'failed' as const, message: (error as Error).message } }
    }) },
    revertAiEdit(record, currentVersion) { return serial(record.ref, async () => {
      const operationId = randomUUID()
      try {
        const stored = JSON.parse(await fs.readFile(local(record.ref, `ai-${hash(record.id)}.json`), 'utf8')) as { record: DocumentAiEditRecord; source: string }
        const disk = await inspect(record.ref)
        if (!same(currentVersion, disk.version)) return { reverted: [], unreverted: record.applied, save: { status: 'conflict' as const, operationId, disk } }
        const merged = revertDocumentRanges(stored.source, disk.source, stored.record.applied)
        const result = await save({ ref: record.ref, expectedVersion: disk.version, source: merged.source, operationId, attachments: [] })
        return { reverted: result.status === 'saved' ? merged.applied : [], unreverted: result.status === 'saved' ? merged.conflicts : record.applied, save: result }
      } catch (error) { return { reverted: [], unreverted: record.applied, save: { status: 'failed' as const, operationId, message: (error as Error).message, recovery: 'failed' as const } } }
    }) },
  }
  const api = { ...port,
    saveDocumentIfNoRecovery(request: DocumentSaveRequest, validate?: () => void | Promise<void>): Promise<DocumentSaveResult> {
      return serial(request.ref, async () => {
        if (await api.readRecovery(request.ref)) return { status: 'failed', operationId: request.operationId, message: '当前输出文件有未保存稿或冲突恢复稿，请先处理；候选未写入', recovery: 'saved' }
        return save(request, validate)
      })
    },
    async readAiRecords(ref: DocumentFileRef): Promise<DocumentAiEditRecord[]> {
      await options.validateTarget(ref)
      const directory = path.dirname(local(ref, 'index'))
      let names: string[]
      try { names = await fs.readdir(directory) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
      const hidden = new Set<string>(await fs.readFile(local(ref, 'hidden-ai-records.json'), 'utf8').then(value => JSON.parse(value) as string[]).catch(error => { if (error.code === 'ENOENT') return []; throw error }))
      const records: DocumentAiEditRecord[] = []
      for (const name of names.filter(name => /^ai-[a-f0-9]+\.json$/.test(name))) {
        const value = JSON.parse(await fs.readFile(path.join(directory, name), 'utf8')) as { record?: DocumentAiEditRecord }
        if (value.record && documentRefKey(value.record.ref) === documentRefKey(ref) && !hidden.has(value.record.id)) records.push({ ...value.record, ref })
      }
      return records
    },
    async clearAiRecords(ref: DocumentFileRef, ids: string[]): Promise<void> {
      await options.validateTarget(ref)
      const filename = local(ref, 'hidden-ai-records.json')
      const prior: string[] = await fs.readFile(filename, 'utf8').then(value => JSON.parse(value)).catch(error => { if (error.code === 'ENOENT') return []; throw error })
      await atomic(filename, JSON.stringify([...new Set([...prior, ...ids])]))
    },
    async readResource(ref: DocumentFileRef, relativePath: string) {
      const filename = await resolve(ref, relativePath)
      const bytes = new Uint8Array(await fs.readFile(filename))
      const extension = path.extname(filename).toLowerCase()
      const types: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.webm': 'video/webm', '.pdf': 'application/pdf', '.zip': 'application/zip', '.woff2': 'font/woff2' }
      return { bytes, mime: types[extension] ?? 'application/octet-stream', filename: path.basename(filename) }
    },
    recoverAiEditRecord,
    async invalidateAiEdits(ref: DocumentFileRef) {
      const id = key(ref), previous = prepared.get(id)
      invalidatedEpochs.set(id, Math.max(previous?.epoch ?? -Infinity, issuedEpochs.get(id) ?? -Infinity, invalidatedEpochs.get(id) ?? -Infinity))
      generations.set(id, (generations.get(id) ?? 0) + 1)
      prepared.delete(id)
      await queues.get(id)?.catch(() => {})
    },
    async readRecovery(ref: DocumentFileRef): Promise<{ source: string; expectedVersion: DocumentFileVersion | null; baseSource?: string; attachments?: DocumentSaveRequest['attachments'] } | null> {
      await options.validateTarget(ref)
      try {
        const recovery = JSON.parse(await fs.readFile(local(ref, 'draft.json'), 'utf8')) as { source: string; expectedVersion: DocumentFileVersion | null; baseSource?: string; attachments?: { relativePath: string; bytes: number[] }[] }
        const attachments = recovery.attachments?.map(attachment => ({ ...attachment, bytes: new Uint8Array(attachment.bytes) })) ?? []
        if (await hasPendingDraftContent(ref, recovery.source, attachments)) return { ...recovery, attachments }
      }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      let names: string[]
      try { names = await fs.readdir(path.dirname(local(ref, 'draft.json'))) }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
      const pending = await Promise.all(names.filter(name => name.startsWith('operation-')).map(async name => {
        const filename = local(ref, name)
        return { record: JSON.parse(await fs.readFile(filename, 'utf8')) as Recovery, modified: (await fs.stat(filename)).mtimeMs }
      }))
      const latest = pending.filter(item => item.record.phase !== 'recorded').sort((a, b) => b.modified - a.modified)[0]?.record
      if (!latest) return null
      const attachments = latest.request.attachments.map(attachment => ({ ...attachment, bytes: new Uint8Array(attachment.bytes) }))
      if (!await hasPendingDraftContent(ref, latest.request.source, attachments)) return null
      return { source: latest.request.source, expectedVersion: latest.request.expectedVersion, attachments }
    },
    async preserveDraft(ref: DocumentFileRef, source: string, expectedVersion: DocumentFileVersion | null, attachments: DocumentSaveRequest['attachments'] = []) {
      await serial(ref, async () => {
        await options.validateTarget(ref)
        await persistDraft(ref, source, expectedVersion, attachments)
      })
    },
  }
  return api
}
