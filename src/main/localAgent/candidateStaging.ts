import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { generationCandidateSchema, generationMediaFileReferenceSchema, generationProjectDocumentWireInputSchema, generationRequestSchema, generationResourceFileSchema,
  MAX_GENERATION_RESOURCE_BYTES, type GenerationCandidate, type GenerationFailure, type GenerationRequest } from '../../shared/generationContract'
import { MAX_GENERATION_RESULT_BYTES, parseGenerationCandidate } from '../../shared/generationResult'
import { generationRequestForPrompt } from './profile'
import { ensureGenerationCapabilityWorkspace } from './capabilityWorkspace'
import { candidateMediaDeliveryFiles } from './candidateMediaDelivery'
import { generatedImageFormat } from '../../shared/generatedImageFormat'

function decodeResource(file: NonNullable<GenerationRequest['resourceFiles']>[number]): Buffer {
  if (file.encoding === 'utf8') return Buffer.from(file.content, 'utf8')
  const bytes = Buffer.from(file.content, 'base64')
  if (bytes.toString('base64') !== file.content) throw new Error(`资源不是规范 base64: ${file.path}`)
  return bytes
}

async function writeResource(root: string, relative: string, bytes: string | Buffer): Promise<void> {
  generationResourceFileSchema.shape.path.parse(relative)
  const target = path.join(root, ...relative.split('/'))
  if (!within(root, target)) throw new Error('资源必须位于本轮资源根内')
  const parent = path.dirname(target)
  await fs.mkdir(parent, { recursive: true })
  if (await fs.realpath(root) !== root || await fs.realpath(parent) !== parent) throw new Error('资源目录不能包含链接')
  await fs.writeFile(target, bytes, { flag: 'wx', mode: 0o600 })
  if (await fs.realpath(target) !== target) throw new Error('资源文件不能包含链接')
}

function within(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)
}

export class CandidateMediaFileError extends Error {
  constructor(message: string, readonly failure: GenerationFailure) { super(message) }
}

/** Supplied by the existing logical-task owner; staging never owns task state. */
export interface CandidateMediaTask { taskId: string; deadlineAt: number }
const retainedMediaSchema = z.object({ version: z.literal(1), filename: z.string().min(1).max(500),
  mimeType: z.string().min(1).max(120) }).strict()
const deliveredMediaSchema = z.object({ version: z.literal(1), source: generationMediaFileReferenceSchema }).strict()
type RetainedMedia = z.infer<typeof retainedMediaSchema> & { bytes: Buffer }
function assertTaskActive(task: CandidateMediaTask) {
  z.uuid().parse(task.taskId)
  if (!Number.isSafeInteger(task.deadlineAt) || Date.now() >= task.deadlineAt) throw new Error('素材所属逻辑任务已到期')
}

/** A request-specific candidate root, below the stable CLI conversation working directory. */
export class CandidateStaging {
  constructor(private readonly sessionDirectory: string) {}

  private async session(): Promise<string> {
    const resolved = await fs.realpath(this.sessionDirectory)
    const normalize = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value
    if (normalize(resolved) !== normalize(path.resolve(this.sessionDirectory))) throw new Error('会话暂存目录不能重定向到其他位置')
    return resolved
  }

  private async directory(requestId: string): Promise<string> {
    z.uuid().parse(requestId)
    const session = await this.session()
    const target = path.join(session, 'candidates', requestId)
    const resolved = await fs.realpath(target)
    if (!within(session, resolved) || resolved !== target) throw new Error('候选目录不在当前会话内或包含链接')
    return resolved
  }

  async create(raw: GenerationRequest, task?: CandidateMediaTask): Promise<string> {
    const request = generationRequestSchema.parse(raw)
    const session = await this.session()
    const parent = path.join(session, 'candidates')
    await fs.mkdir(parent, { recursive: true })
    if (await fs.realpath(parent) !== parent) throw new Error('候选父目录不能是链接')
    const target = path.join(parent, request.requestId)
    await fs.mkdir(target) // Reusing a request must not pick up old or half-written output.
    try {
      await ensureGenerationCapabilityWorkspace(target)
      for (const resource of request.resourceFiles ?? []) await writeResource(target, `resources/${resource.path}`, decodeResource(resource))
      const reusableMedia: { filename: string; mimeType: string; source: { $candidateFile: string } }[] = []
      if (task) {
        assertTaskActive(task)
        for (const media of await this.retained(task.taskId)) {
          const relative = `resources/reused/${randomUUID()}/${path.basename(media.filename)}`
          await writeResource(target, relative, media.bytes)
          reusableMedia.push({ filename: media.filename, mimeType: media.mimeType, source: { $candidateFile: relative } })
        }
        assertTaskActive(task)
      }
      for (const [filename, source] of Object.entries(candidateMediaDeliveryFiles())) await writeResource(target, filename, source)
      await writeResource(target, 'request.json', JSON.stringify({ ...generationRequestForPrompt(request, target),
        ...(reusableMedia.some(file => file.mimeType !== 'application/json') ? { reusableMedia: reusableMedia.filter(file => file.mimeType !== 'application/json') } : {}),
        ...(reusableMedia.some(file => file.mimeType === 'application/json') ? { reusableArtifacts: reusableMedia.filter(file => file.mimeType === 'application/json') } : {}) }))
      return target
    } catch (error) { await fs.rm(target, { recursive: true, force: true }); throw error }
  }

  async readText(requestId: string): Promise<string | null> {
    const root = await this.directory(requestId)
    const filename = path.join(root, 'candidate.json')
    let real: string
    try { real = await fs.realpath(filename) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
    if (!within(root, real) || real !== filename) throw new Error('只允许摄取当前候选目录内的 candidate.json')
    const handle = await fs.open(real, 'r')
    try {
      const info = await handle.stat()
      if (!info.isFile() || info.size > MAX_GENERATION_RESULT_BYTES) throw new Error('候选文件类型或大小不受支持')
      // Recheck after opening. The native turn must have ended before ingestion.
      if (await fs.realpath(filename) !== real) throw new Error('候选文件位置在摄取期间发生变化')
      const bytes = await handle.readFile()
      if (bytes.byteLength > MAX_GENERATION_RESULT_BYTES) throw new Error('候选文件超过大小上限')
      return bytes.toString('utf8')
    } finally { await handle.close() }
  }

  async read(requestId: string) {
    const text = await this.readText(requestId)
    return text === null ? null : parseGenerationCandidate(JSON.parse(text), requestId)
  }

  /** Only declared media/document artifact fields cross this boundary; canonical tools never
   * receive filesystem paths, and the CLI's public text never carries bytes. */
  async resolveMediaFiles(candidate: GenerationCandidate, task?: CandidateMediaTask): Promise<GenerationCandidate> {
    const resolved = generationCandidateSchema.parse(candidate)
    let totalBytes = 0
    const read = new Map<string, Buffer>()
    for (const step of resolved.steps) {
      if (!['asset.media.import', 'media.apply', 'project.document'].includes(step.tool) || !step.input || typeof step.input !== 'object' || Array.isArray(step.input)) continue
      const field = step.tool === 'project.document' ? 'artifact' : step.tool === 'media.apply' ? 'source' : 'base64'
      const reference = step.input[field]
      if (!reference || typeof reference !== 'object' || Array.isArray(reference) || !Object.hasOwn(reference, '$candidateFile')) continue
      try {
        if (step.tool === 'project.document') generationProjectDocumentWireInputSchema.parse(step.input)
        const relative = generationMediaFileReferenceSchema.parse(reference).$candidateFile
        const root = await this.directory(candidate.requestId)
        let bytes = read.get(relative)
        if (!bytes) {
          bytes = await this.readMedia(root, relative, MAX_GENERATION_RESOURCE_BYTES - totalBytes)
          totalBytes += bytes.length; read.set(relative, bytes)
        }
        const filename = path.basename(relative)
        if (step.tool === 'project.document') {
          step.input.artifact = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
          if (task) await this.retain(task, { version: 1, filename, mimeType: 'application/json', bytes })
          continue
        }
        const mimeType = step.tool === 'media.apply' || step.input.kind === 'image'
          ? generatedImageFormat(bytes).mimeType : typeof step.input.mimeType === 'string' ? step.input.mimeType : 'application/octet-stream'
        if (task) await this.retain(task, { version: 1, filename, mimeType, bytes })
        step.input[field] = field === 'source' ? { base64: bytes.toString('base64'), filename, mimeType } : bytes.toString('base64')
      } catch (error) {
        const message = `候选素材读取失败：${error instanceof Error ? error.message : String(error)}`.slice(0, 4000)
        throw new CandidateMediaFileError(message, { version: 1, stage: 'candidate-parse', requestId: candidate.requestId,
          candidateId: candidate.candidateId, stepId: step.id, tool: step.tool, destination: step.destination,
          diagnostics: [{ code: 'candidate-media-file', message, path: ['steps', resolved.steps.indexOf(step), 'input', field] }], assetIds: [], packageIds: [] })
      }
    }
    return resolved
  }

  /** Native helpers register successful deliveries even when the model's later
   * candidate fails parsing. Unknown/unregistered files are never scanned. */
  async retainDeliveredMedia(requestId: string, task: CandidateMediaTask): Promise<number> {
    assertTaskActive(task)
    const root = await this.directory(requestId)
    let manifest: Buffer
    try { manifest = await this.readMedia(root, 'delivered-media.jsonl', 64 * 1024) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0; throw error }
    const references = [...new Set(manifest.toString('utf8').split('\n').filter(line => line.trim()).map(line =>
      deliveredMediaSchema.parse(JSON.parse(line)).source.$candidateFile))]
    let total = 0
    for (const relative of references) {
      assertTaskActive(task)
      const bytes = await this.readMedia(root, relative, MAX_GENERATION_RESOURCE_BYTES - total)
      total += bytes.length
      await this.retain(task, { version: 1, filename: path.basename(relative), mimeType: generatedImageFormat(bytes).mimeType, bytes })
    }
    assertTaskActive(task)
    return references.length
  }

  private async readMedia(root: string, relative: string, remaining: number): Promise<Buffer> {
    generationResourceFileSchema.shape.path.parse(relative)
    const filename = path.join(root, ...relative.split('/')), real = await fs.realpath(filename)
    if (!within(root, real) || real !== filename) throw new Error('素材文件必须位于当前资源目录内，不能包含链接')
    const handle = await fs.open(real, 'r')
    try {
      const info = await handle.stat()
      if (!info.isFile() || info.size === 0 || info.size > remaining) throw new Error('候选素材必须是非空文件，合计不能超过 12 MiB')
      const bytes = await handle.readFile(), after = await handle.stat()
      if (bytes.length !== info.size || after.size !== info.size || after.mtimeMs !== info.mtimeMs || await fs.realpath(filename) !== real) throw new Error('候选素材在读取期间发生变化')
      return bytes
    } finally { await handle.close() }
  }

  private async taskDirectory(taskId: string, create = false): Promise<string | null> {
    z.uuid().parse(taskId)
    const session = await this.session(), parent = path.join(session, 'task-media'), target = path.join(parent, taskId)
    if (create) {
      await fs.mkdir(parent, { recursive: true })
      if (await fs.realpath(parent) !== parent) throw new Error('任务素材父目录不能是链接')
      await fs.mkdir(target, { recursive: true })
    }
    let real: string
    try { real = await fs.realpath(target) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
    if (!within(session, real) || real !== target) throw new Error('任务素材目录不能包含链接')
    return real
  }

  private async retained(taskId: string): Promise<RetainedMedia[]> {
    const root = await this.taskDirectory(taskId)
    if (!root) return []
    const result: RetainedMedia[] = []
    let total = 0
    for (const entry of await fs.readdir(root)) {
      z.uuid().parse(entry)
      const metadata = retainedMediaSchema.parse(JSON.parse((await this.readMedia(root, `${entry}/metadata.json`, 4096)).toString('utf8')))
      // Original names are labels only, never filesystem paths.
      if (path.basename(metadata.filename) !== metadata.filename || /[\\/:\0]/.test(metadata.filename)) throw new Error('保留素材文件名无效')
      const bytes = await this.readMedia(root, `${entry}/content`, MAX_GENERATION_RESOURCE_BYTES - total)
      total += bytes.length
      result.push({ ...metadata, bytes })
    }
    return result
  }

  private async retain(task: CandidateMediaTask, media: RetainedMedia): Promise<void> {
    assertTaskActive(task)
    const previous = await this.retained(task.taskId)
    if (previous.some(value => value.mimeType === media.mimeType && value.bytes.equals(media.bytes))) return
    if (previous.reduce((sum, value) => sum + value.bytes.length, media.bytes.length) > MAX_GENERATION_RESOURCE_BYTES) throw new Error('本任务保留素材合计超过 12 MiB')
    const root = (await this.taskDirectory(task.taskId, true))!, entry = randomUUID()
    const target = path.join(root, entry)
    try {
      await writeResource(root, `${entry}/content`, media.bytes)
      await writeResource(root, `${entry}/metadata.json`, JSON.stringify({ version: 1, filename: media.filename, mimeType: media.mimeType }))
      assertTaskActive(task)
    } catch (error) {
      // Both paths are application-owned and checked before recursive cleanup.
      if (within(root, target) && await fs.realpath(target).catch(() => null) === target) await fs.rm(target, { recursive: true, force: true })
      throw error
    }
  }

  async releaseTaskMedia(taskId: string): Promise<void> {
    const target = await this.taskDirectory(taskId)
    if (target) await fs.rm(target, { recursive: true, force: true })
  }

  async remove(requestId: string): Promise<void> {
    let target: string
    try { target = await this.directory(requestId) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
    // directory() verifies the resolved target stays below this application-owned session.
    await fs.rm(target, { recursive: true, force: true })
  }
}
