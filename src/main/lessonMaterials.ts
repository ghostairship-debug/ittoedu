import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { MATERIAL_EXTRACTION_LIMITS as limits, type MaterialExtraction, type LessonMaterialTarget, type LessonMaterialRecord, type LessonMaterialRead } from '../shared/materialExtraction'

const locator = z.object({ part: z.string().min(1).max(32767), page: z.number().int().positive().optional(), paragraph: z.number().int().positive().optional() }).strict()
const fragment = z.object({ id: z.string().min(1).max(1024), kind: z.enum(['text', 'table', 'image', 'formula']), locator, text: z.string().max(limits.textCharacters).optional(), assetId: z.string().min(1).max(32767).optional() }).strict()
const format = z.enum(['pdf', 'docx', 'pptx', 'text'])
const gap = z.object({ locator, reason: z.string().min(1).max(4096), resolution: z.object({ kind: z.literal('read-page-image'), assetId: z.string().min(1).max(32767) }).strict().optional() }).strict()
const extractionSchema = z.object({ version: z.literal(1), extractorVersion: z.string().min(1).max(100), format, fragments: z.array(fragment).min(1).max(100000), assets: z.array(z.object({ id: z.string().min(1).max(32767), mime: z.string().min(1).max(100), bytes: z.instanceof(Uint8Array) }).strict()).max(10000), gaps: z.array(gap).max(100000) }).strict()
const relative = z.string().min(1).max(32767).refine(value => !value.includes('\\') && !value.includes('\0') && !path.isAbsolute(value) && value.split('/').every(part => part !== '..' && part !== '.' && part !== ''))
const recordSchema = z.object({ version: z.literal(1), id: z.uuid(), lessonId: z.string().min(1), title: z.string().min(1).max(300), createdAt: z.number().int().nonnegative(), sourceVersion: z.string().regex(/^[a-f0-9]{64}$/), extractionVersion: z.string().regex(/^[a-f0-9]{64}$/), sourcePath: relative, format, extractorVersion: z.string().min(1).max(100), fragments: z.array(fragment).min(1).max(100000), assets: z.array(z.object({ id: z.string().min(1), mime: z.string().min(1), path: relative, version: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).max(10000), gaps: z.array(gap).max(100000) }).strict()
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')
const assetExtension = (mime: string): string => ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/svg+xml': 'svg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/bmp': 'bmp', 'image/tiff': 'tiff', 'image/emf': 'emf', 'image/wmf': 'wmf' } as Record<string, string>)[mime] ?? 'bin'

/** Real lesson files own material content; the injected identity owner rejects stale targets. */
export class LessonMaterials {
  private queue: Promise<unknown> = Promise.resolve()
  constructor(private readonly validateLesson: (target: LessonMaterialTarget) => Promise<void>) {}
  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.queue.then(operation, operation)
    this.queue = task.then(() => undefined, () => undefined)
    return task
  }
  private async directory(target: LessonMaterialTarget): Promise<string> {
    await this.validateLesson(target)
    const root = await fs.realpath(target.rootPath)
    const directory = path.join(root, 'materials')
    await fs.mkdir(directory, { recursive: true })
    if (await fs.realpath(directory) !== directory) throw new Error('材料目录不能指向课例外部')
    return directory
  }
  private async closed(directory: string, relativePath: string): Promise<string> {
    relative.parse(relativePath)
    const resolved = await fs.realpath(path.join(directory, relativePath))
    const rel = path.relative(directory, resolved)
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('材料文件超出课例目录')
    return resolved
  }
  import(target: LessonMaterialTarget, input: { title: string; original: Uint8Array; extraction: MaterialExtraction }): Promise<LessonMaterialRecord> {
    return this.serialized(async () => {
      const title = z.string().trim().min(1).max(300).parse(input.title)
      if (!(input.original instanceof Uint8Array) || !input.original.length || input.original.length > limits.sourceBytes) throw new Error('原材料须为非空且不超过 32 MiB')
      const extraction = extractionSchema.parse(input.extraction)
      if (extraction.assets.reduce((n, a) => n + a.bytes.length, 0) > limits.outputBytes || extraction.fragments.reduce((n, f) => n + (f.text?.length ?? 0), 0) > limits.textCharacters) throw new Error('材料提取结果超过容量上限')
      const assets = new Set(extraction.assets.map(asset => asset.id))
      if (assets.size !== extraction.assets.length || new Set(extraction.fragments.map(f => f.id)).size !== extraction.fragments.length) throw new Error('材料片段或图片标识重复')
      for (const f of extraction.fragments) {
        if (f.kind === 'image' ? !f.assetId || !assets.has(f.assetId) : !f.text?.trim()) throw new Error('材料片段正文或图像缺失')
      }
      const directory = await this.directory(target)
      const id = randomUUID()
      const temp = path.join(directory, `.pending-${id}`)
      const sourcePath = `materials/${id}/original.${extraction.format === 'text' ? 'txt' : extraction.format}`
      const record: LessonMaterialRecord = recordSchema.parse({ version: 1, id, lessonId: target.lessonId, title, createdAt: Date.now(), sourceVersion: hash(input.original), extractionVersion: hash(JSON.stringify({ ...extraction, assets: extraction.assets.map(asset => ({ id: asset.id, mime: asset.mime, version: hash(asset.bytes) })) })), sourcePath, format: extraction.format, extractorVersion: extraction.extractorVersion, fragments: extraction.fragments, assets: extraction.assets.map((asset, index) => ({ id: asset.id, mime: asset.mime, path: `materials/${id}/assets/${index}.${assetExtension(asset.mime)}`, version: hash(asset.bytes) })), gaps: extraction.gaps })
      await fs.mkdir(path.join(temp, 'assets'), { recursive: true })
      try {
        await fs.writeFile(path.join(temp, path.basename(sourcePath)), input.original, { flag: 'wx' })
        for (let index = 0; index < extraction.assets.length; index++) await fs.writeFile(path.join(temp, 'assets', `${index}.${assetExtension(extraction.assets[index].mime)}`), extraction.assets[index].bytes, { flag: 'wx' })
        await fs.writeFile(path.join(temp, 'extraction.json'), JSON.stringify(record), { flag: 'wx' })
        await this.validateLesson(target)
        await fs.rename(temp, path.join(directory, id))
      } catch (error) {
        const actual = await fs.realpath(temp).catch(() => null)
        if (actual === temp && path.dirname(actual) === directory) await fs.rm(temp, { recursive: true, force: true })
        throw error
      }
      return record
    })
  }
  private async record(target: LessonMaterialTarget, directory: string, id: string): Promise<LessonMaterialRecord> {
    z.uuid().parse(id)
    const filename = await this.closed(directory, `${id}/extraction.json`)
    const record = recordSchema.parse(JSON.parse(await fs.readFile(filename, 'utf8')))
    if (record.lessonId !== target.lessonId || record.id !== id) throw new Error('材料不属于当前课例')
    const currentVersion = hash(JSON.stringify({ version: 1, extractorVersion: record.extractorVersion, format: record.format, fragments: record.fragments, assets: record.assets.map(asset => ({ id: asset.id, mime: asset.mime, version: asset.version })), gaps: record.gaps }))
    if (currentVersion !== record.extractionVersion) throw new Error('材料提取内容已变化，请重新提取')
    const prefix = `materials/${id}/`
    if (!record.sourcePath.startsWith(prefix) || record.assets.some(asset => !asset.path.startsWith(prefix))) throw new Error('材料文件归属错误')
    return record
  }
  list(target: LessonMaterialTarget): Promise<LessonMaterialRecord[]> {
    return this.serialized(async () => {
      const directory = await this.directory(target)
      const result: LessonMaterialRecord[] = []
      for (const name of await fs.readdir(directory)) if (z.uuid().safeParse(name).success) result.push(await this.record(target, directory, name))
      return result.sort((a, b) => a.createdAt - b.createdAt)
    })
  }
  read(target: LessonMaterialTarget, input: { id: string; extractionVersion: string; fragmentIds: string[] }): Promise<LessonMaterialRead> {
    return this.serialized(async () => {
      const directory = await this.directory(target)
      const record = await this.record(target, directory, input.id)
      if (record.extractionVersion !== input.extractionVersion) throw new Error('材料提取版本已变化，请重新读取目录')
      const ids = new Set(z.array(z.string().min(1)).min(1).max(100000).parse(input.fragmentIds))
      const fragments = record.fragments.filter(f => ids.has(f.id))
      if (fragments.length !== ids.size) throw new Error('材料片段不存在')
      const root = path.dirname(directory)
      const original = await fs.readFile(await this.closed(root, record.sourcePath))
      if (hash(original) !== record.sourceVersion) throw new Error('材料原件版本已变化，请重新提取')
      const assetIds = new Set(fragments.map(f => f.assetId).filter(Boolean))
      const assets: MaterialExtraction['assets'] = []
      for (const asset of record.assets.filter(a => assetIds.has(a.id))) {
        const bytes = new Uint8Array(await fs.readFile(await this.closed(root, asset.path)))
        if (hash(bytes) !== asset.version) throw new Error('材料图示已变化，请重新提取')
        assets.push({ id: asset.id, mime: asset.mime, bytes })
      }
      const receipt: LessonMaterialRead = { materialId: record.id, sourceVersion: record.sourceVersion, extractionVersion: record.extractionVersion, readAt: Date.now(), fragments, assets }
      // The caller stores this receipt with its conversation; no chat trace is written into the lesson.
      return receipt
    })
  }
}

/** Rebind only copied extraction metadata; source/assets and their content versions stay untouched. */
export async function withCopiedMaterialOwnership<T>(directory: string, previousLessonId: string, lessonId: string, commitIdentity: () => Promise<T>): Promise<T> {
  const owner = new LessonMaterials(async () => {})
  const target = { lessonId: previousLessonId, rootPath: directory }
  const records = await owner.list(target)
  const prepared: { filename: string; temporary: string; before: Uint8Array; applied: boolean }[] = []
  try {
    // Read every independent saved resource before changing any ownership.
    for (const record of records) {
      await owner.read(target, { id: record.id, extractionVersion: record.extractionVersion, fragmentIds: record.fragments.map(fragment => fragment.id) })
      const filename = path.join(directory, 'materials', record.id, 'extraction.json')
      const before = new Uint8Array(await fs.readFile(filename))
      const temporary = `${filename}.copy-${randomUUID()}.pending`
      prepared.push({ filename, temporary, before, applied: false })
      await fs.writeFile(temporary, JSON.stringify(recordSchema.parse({ ...record, lessonId })), { flag: 'wx' })
    }
    for (const entry of prepared) { await fs.rename(entry.temporary, entry.filename); entry.applied = true }
    return await commitIdentity()
  } catch (error) {
    const failures: unknown[] = [error]
    for (const entry of prepared.reverse()) if (entry.applied) {
      try { await fs.writeFile(entry.temporary, entry.before, { flag: 'wx' }); await fs.rename(entry.temporary, entry.filename) }
      catch (rollbackError) { failures.push(rollbackError) }
    }
    if (failures.length > 1) throw new AggregateError(failures, '课例副本创建失败，材料归属回滚失败；保留暂存文件供恢复')
    throw error
  } finally {
    // A rollback failure retains the bytes in its pending file for recovery.
    for (const entry of prepared) if (!entry.applied || await fs.readFile(entry.filename).then(bytes => bytes.equals(Buffer.from(entry.before)), () => false)) await fs.rm(entry.temporary, { force: true })
  }
}
