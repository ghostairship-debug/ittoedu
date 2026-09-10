import { promises as fs } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { generationRequestSchema, generationResourceFileSchema, type GenerationRequest } from '../../shared/generationContract'
import { MAX_GENERATION_RESULT_BYTES, parseGenerationCandidate } from '../../shared/generationResult'
import { generationRequestForPrompt } from './profile'
import { ensureGenerationCapabilityWorkspace } from './capabilityWorkspace'

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

  async create(raw: GenerationRequest): Promise<string> {
    const request = generationRequestSchema.parse(raw)
    const session = await this.session()
    const parent = path.join(session, 'candidates')
    await fs.mkdir(parent, { recursive: true })
    if (await fs.realpath(parent) !== parent) throw new Error('候选父目录不能是链接')
    const target = path.join(parent, request.requestId)
    await fs.mkdir(target) // Reusing a request must not pick up old or half-written output.
    try {
      await ensureGenerationCapabilityWorkspace(target)
      await writeResource(target, 'request.json', JSON.stringify(generationRequestForPrompt(request, target)))
      for (const resource of request.resourceFiles ?? []) await writeResource(target, `resources/${resource.path}`, decodeResource(resource))
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
      // Recheck the path after opening. The child is already terminated before ingestion.
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

  async remove(requestId: string): Promise<void> {
    let target: string
    try { target = await this.directory(requestId) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
    // directory() verifies the resolved target stays below this application-owned session.
    await fs.rm(target, { recursive: true, force: true })
  }
}
