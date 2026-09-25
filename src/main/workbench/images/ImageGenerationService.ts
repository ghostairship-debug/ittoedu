import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { HostImageInput } from '../../../core/tools/imageResource'
import type { ImageGenerationRequest, ImageJobSnapshot, ImageJobTimingMark, ImageResourceReference } from '../../../shared/workbench/images'
import { prepareImageResource } from '../admittedImageResource'
import { captureMainTiming } from '../execution/ExecutionEventStore'
import type { ImageProviderPort, ImageProviderReference } from './ImageProviderPort'
import { imageProvenance } from './imageRoute'

export interface ImageGenerationServiceOptions {
  directory: string
  provider: ImageProviderPort
  /** Host-authorized immutable reference; never interpret a model string as a filesystem path. */
  resolveReference?(runId: string, documentId: string, referenceId: string): Promise<HostImageInput>
  now?: () => Date
}
export class ImageGenerationError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'ImageGenerationError' }
}
const hash = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex')
type StoredImageJob = ImageJobSnapshot & { request: ImageGenerationRequest }
const expose = ({ request: _request, ...job }: StoredImageJob): ImageJobSnapshot => structuredClone(job)
const queues = new Map<string, Promise<unknown>>()
const active = new Map<string, { controller: AbortController; promise: Promise<ImageJobSnapshot>; requestDigest: string; sequence: number }>()
function serial<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const result = (queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(operation), tail = result.catch(() => undefined)
  queues.set(key, tail); void tail.finally(() => { if (queues.get(key) === tail) queues.delete(key) }); return result
}

/** Durable generated assets are always unapplied. Only Gateway/document transactions may insert them.
 * Document/History assets are copied into the canonical document transaction; this store owns
 * result cards and their cache until the owning conversation is durably released.
 */
export class ImageGenerationService {
  private readonly directory: string
  private readonly now: () => Date
  private readonly listeners = new Set<(job: ImageJobSnapshot) => void>()
  private readonly settledListeners = new Set<() => void>()
  private maintenance: Promise<void> = Promise.resolve()
  private runSequence = 0
  constructor(private readonly options: ImageGenerationServiceOptions) {
    this.directory = path.resolve(options.directory); this.now = options.now ?? (() => new Date())
  }
  private key(jobId: string) { if (!jobId || jobId.length > 512) throw new ImageGenerationError('invalid-job-id', '图片任务身份无效。'); return path.join(this.directory, 'jobs', `${hash(jobId)}.json`) }
  private retiredKey(jobId: string) { return path.join(this.directory, 'retired', `${hash(jobId)}.json`) }
  subscribe(listener: (job: ImageJobSnapshot) => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  subscribeSettled(listener: () => void): () => void { this.settledListeners.add(listener); return () => { this.settledListeners.delete(listener) } }
  private publish(job: StoredImageJob) { for (const listener of this.listeners) { try { listener(expose(job)) } catch { /* Views never change a durable result. */ } } }
  async list(): Promise<ImageJobSnapshot[]> {
    let names: string[]
    try { names = await fs.readdir(path.join(this.directory, 'jobs')) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
    const results: ImageJobSnapshot[] = []
    for (const name of names.filter(value => /^[a-f0-9]{64}\.json$/.test(value))) {
      const stored = await this.load(path.join(this.directory, 'jobs', name))
      if (stored) results.push(await this.read(stored.jobId))
    }
    return results
  }
  private async atomic(filename: string, value: unknown) {
    await fs.mkdir(path.dirname(filename), { recursive: true })
    const temporary = `${filename}.${randomUUID()}.tmp`
    try { const file = await fs.open(temporary, 'wx', 0o600); try { await file.writeFile(JSON.stringify(value)); await file.sync() } finally { await file.close() }; await fs.rename(temporary, filename) }
    catch { await fs.rm(temporary, { force: true }).catch(() => undefined); throw new ImageGenerationError('image-storage-failed', '图片任务或资源未能完整保存。') }
  }
  private async load(filename: string): Promise<StoredImageJob | undefined> {
    let raw: string
    try { raw = await fs.readFile(filename, 'utf8') } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
    try {
      const value = JSON.parse(raw) as StoredImageJob
      if (value.version !== 1 || typeof value.jobId !== 'string' || this.key(value.jobId) !== filename || !value.request
        || hash(JSON.stringify(value.request)) !== value.requestDigest || value.request.jobId !== value.jobId
        || value.runId !== value.request.runId || value.documentId !== value.request.documentId || !value.provenance
        || !['preparing', 'running', 'ready', 'unapplied', 'stopped', 'unknown', 'failed'].includes(value.status)
        || typeof value.stopped !== 'boolean' || !Array.isArray(value.resources)
        || value.resources.some(ref => !/^image_[a-f0-9]{64}$/.test(ref.resourceId) || ref.digest !== ref.resourceId.slice(6)
          || !['image/png', 'image/jpeg', 'image/webp'].includes(ref.mimeType) || !Number.isSafeInteger(ref.byteLength) || ref.byteLength <= 0
          || !Number.isSafeInteger(ref.width) || ref.width <= 0 || !Number.isSafeInteger(ref.height) || ref.height <= 0)) throw new Error()
      return value
    } catch { throw new ImageGenerationError('image-job-corrupt', '图片任务记录损坏，未覆盖或重新发送请求。') }
  }
  private async update(filename: string, operation: (job: ImageJobSnapshot) => void): Promise<ImageJobSnapshot> {
    return serial(filename, async () => { const job = await this.load(filename); if (!job) throw new ImageGenerationError('unknown-image-job', '图片任务不存在。')
      operation(job); job.updatedAt = this.now().toISOString(); await this.atomic(filename, job); this.publish(job); return expose(job) })
  }
  private timing(filename: string, stage: ImageJobTimingMark['stage'], detail?: ImageJobTimingMark['detail']): void {
    const mark: ImageJobTimingMark = { stage, ...captureMainTiming(), ...(detail ? { detail } : {}) }
    // Capture before scheduling I/O. The same per-job queue places each mark before later job updates.
    // A diagnostic write failure cannot alter the image request or trigger a retry.
    void serial(filename, async () => {
      const job = await this.load(filename)
      if (!job) return
      ;(job.timing ??= []).push(mark)
      await this.atomic(filename, job)
    }).catch(() => undefined)
  }
  /** Diagnostic lookup only; no interrupted-job state change, authority check, or provider retry. */
  async readTiming(jobId: string): Promise<Pick<ImageJobSnapshot, 'jobId' | 'runId' | 'documentId' | 'timing'> | null> {
    const filename = this.key(jobId)
    return serial(filename, async () => {
      const job = await this.load(filename)
      return job ? structuredClone({ jobId: job.jobId, runId: job.runId, documentId: job.documentId, timing: job.timing }) : null
    })
  }
  run(input: ImageGenerationRequest, options: { signal?: AbortSignal } = {}): Promise<ImageJobSnapshot> {
    const request = structuredClone(input), key = this.key(request.jobId), requestDigest = hash(JSON.stringify(request)), existing = active.get(key)
    if (existing) {
      if (existing.requestDigest !== requestDigest) return Promise.reject(new ImageGenerationError('image-job-conflict', '此图片任务身份已绑定其他请求。'))
      return existing.promise.then(value => structuredClone(value))
    }
    const controller = new AbortController(), abort = () => { controller.abort(); void this.stop(request.jobId).catch(() => undefined) }
    options.signal?.addEventListener('abort', abort, { once: true }); if (options.signal?.aborted) controller.abort()
    const sequence = ++this.runSequence
    const promise = this.maintenance.then(() => this.execute(request, key, requestDigest, controller)).finally(() => {
      options.signal?.removeEventListener('abort', abort); active.delete(key)
      for (const listener of this.settledListeners) { try { listener() } catch { /* Cleanup observers cannot change a model result. */ } }
    })
    active.set(key, { controller, promise, requestDigest, sequence })
    return promise.then(value => structuredClone(value))
  }
  private async execute(request: ImageGenerationRequest, filename: string, requestDigest: string, controller: AbortController): Promise<ImageJobSnapshot> {
    const initial = await serial(filename, async () => {
      try {
        const retired = JSON.parse(await fs.readFile(this.retiredKey(request.jobId), 'utf8')) as { jobId?: unknown; requestDigest?: unknown }
        if (retired.jobId !== request.jobId || retired.requestDigest !== requestDigest) throw new ImageGenerationError('image-job-conflict', '已释放的图片任务身份与请求不符。')
        throw new ImageGenerationError('image-job-retired', '已删除会话的图片任务不能再次发送。')
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      const prior = await this.load(filename)
      if (prior) {
        if (prior.requestDigest !== requestDigest) throw new ImageGenerationError('image-job-conflict', '图片任务身份与已保存请求不符。')
        if (prior.status === 'preparing' || prior.status === 'running') {
          prior.status = 'unknown'; prior.updatedAt = this.now().toISOString(); prior.failure = { outcome: 'unknown', kind: 'transport', code: 'image-job-interrupted', message: '上次图片任务中断，结果未知；不会自动重发。' }
          await this.atomic(filename, prior); this.publish(prior)
        }
        return { job: prior, existing: true }
      }
      if (!request.runId || !request.documentId || !request.selection || !request.selection.connection || !request.prompt) throw new ImageGenerationError('invalid-image-request', '图片任务缺少冻结的目标、连接或提示。')
      const now = this.now().toISOString(), job: StoredImageJob = { version: 1, jobId: request.jobId, runId: request.runId, documentId: request.documentId,
        requestDigest, request, operation: request.operation, status: controller.signal.aborted ? 'stopped' : 'preparing', stopped: controller.signal.aborted,
        createdAt: now, updatedAt: now, provenance: imageProvenance(request), resources: [] }
      await this.atomic(filename, job); this.publish(job); return { job, existing: false }
    })
    if (initial.existing || initial.job.stopped) return expose(initial.job)
    const references: ImageProviderReference[] = []
    let providerInvoked = false, providerFinished = false, referencesFinished = false, resourcesStarted = false, resourcesFinished = false
    this.timing(filename, 'image.references.started', { referenceCount: (request.referenceIds ?? []).length })
    try {
      for (const referenceId of request.referenceIds ?? []) {
        if (!this.options.resolveReference) throw new ImageGenerationError('reference-unavailable', '未配置已授权的参考图读取入口。')
        const source = await this.options.resolveReference(request.runId, request.documentId, referenceId)
        references.push({ ...source, bytes: Uint8Array.from(source.bytes), referenceId })
      }
      referencesFinished = true
      this.timing(filename, 'image.references.finished', { outcome: 'completed', referenceCount: references.length })
      if (controller.signal.aborted) return await this.stop(request.jobId)
      await this.update(filename, job => { if (!job.stopped) job.status = 'running' })
      providerInvoked = true
      this.timing(filename, 'image.provider.started', { referenceCount: references.length })
      const result = await this.options.provider.generate(request, references, { signal: controller.signal,
        onTiming: (stage, detail) => this.timing(filename, stage, detail) })
      providerFinished = true
      this.timing(filename, 'image.provider.finished', { outcome: result.status === 'completed' ? 'completed' : result.failure.outcome,
        ...(result.status === 'completed' ? { imageCount: result.images.length } : {}) })
      const resources: ImageResourceReference[] = []
      if (result.status === 'completed') {
        resourcesStarted = true
        this.timing(filename, 'image.resources.started', { imageCount: result.images.length })
        for (const image of result.images) resources.push(await this.storeImage(image))
        resourcesFinished = true
        this.timing(filename, 'image.resources.finished', { outcome: 'completed', imageCount: resources.length })
      }
      return await this.update(filename, job => {
        job.provenance = structuredClone(result.provenance)
        if (result.status === 'completed') { job.resources = resources; job.status = job.stopped || controller.signal.aborted ? 'unapplied' : 'ready'; job.stopped ||= controller.signal.aborted; delete job.failure }
        else { job.failure = result.failure; job.status = result.failure.outcome === 'unknown' ? 'unknown' : job.stopped || controller.signal.aborted ? 'stopped' : 'failed'; job.stopped ||= controller.signal.aborted }
      })
    } catch {
      if (!referencesFinished) this.timing(filename, 'image.references.finished', { outcome: 'failed', referenceCount: references.length })
      if (providerInvoked && !providerFinished) this.timing(filename, 'image.provider.finished', { outcome: 'unknown' })
      if (resourcesStarted && !resourcesFinished) this.timing(filename, 'image.resources.finished', { outcome: 'failed' })
      return await this.update(filename, job => { job.failure = { outcome: providerInvoked ? 'unknown' : 'not-sent', kind: 'protocol', code: 'image-resource-preparation-failed', message: '图片或参考素材未能完整处理，未应用到文档；不会自动重发。' }
        job.status = job.failure.outcome === 'unknown' ? 'unknown' : job.stopped ? 'stopped' : 'failed' })
    }
  }
  async read(jobId: string): Promise<ImageJobSnapshot> {
    const filename = this.key(jobId)
    return serial(filename, async () => {
      const job = await this.load(filename); if (!job) throw new ImageGenerationError('unknown-image-job', '图片任务不存在。')
      if (!active.has(filename) && ['preparing', 'running'].includes(job.status)) {
        job.status = 'unknown'; job.updatedAt = this.now().toISOString(); job.failure = { outcome: 'unknown', kind: 'transport', code: 'image-job-interrupted', message: '图片任务中断，结果未知；不会自动重发。' }
        await this.atomic(filename, job); this.publish(job)
      }
      return expose(job)
    })
  }
  async stop(jobId: string): Promise<ImageJobSnapshot> {
    const filename = this.key(jobId); active.get(filename)?.controller.abort()
    return serial(filename, async () => {
      const job = await this.load(filename)
      if (!job) throw new ImageGenerationError('unknown-image-job', '图片任务不存在。')
      // Gateway also releases runs after normal completion. Cancellation cannot rewrite
      // an already-known outcome or claim that a completed image was stopped by its user.
      if (job.status !== 'preparing' && job.status !== 'running') return expose(job)
      job.stopped = true
      if (job.status === 'preparing') job.status = 'stopped'
      else if (job.status === 'running') { job.status = 'unknown'; job.failure = { outcome: 'unknown', kind: 'aborted', code: 'image-stopped-after-send', message: '图片请求已停止等待，结果和费用未知；未自动重发。' } }
      job.updatedAt = this.now().toISOString(); await this.atomic(filename, job); this.publish(job); return expose(job)
    })
  }
  /** The caller supplies only runs released by a durable conversation deletion. A running
   * request postpones collection; new requests wait for this short disk sweep.
   */
  releaseRunJobs(runIds: readonly string[]): Promise<{ deferred: boolean; jobs: number; resources: number }> {
    const released = new Set(runIds), cutoff = this.runSequence
    const work = this.maintenance.then(async () => {
      if ([...active.entries()].some(([filename, entry]) => filename.startsWith(path.join(this.directory, 'jobs') + path.sep) && entry.sequence <= cutoff))
        return { deferred: true, jobs: 0, resources: 0 }
      const jobsRoot = path.join(this.directory, 'jobs'), resourcesRoot = path.join(this.directory, 'resources')
      const names = await fs.readdir(jobsRoot).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [] as string[]; throw error })
      const jobs: Array<{ filename: string; value: StoredImageJob }> = []
      for (const name of names.filter(value => /^[a-f0-9]{64}\.json$/.test(value))) {
        const filename = path.join(jobsRoot, name), value = await this.load(filename)
        if (value) jobs.push({ filename, value })
      }
      const kept = jobs.filter(({ value }) => !released.has(value.runId))
      const retainedDigests = new Set(kept.flatMap(({ value }) => value.resources.map(ref => ref.digest)))
      for (const { filename, value } of jobs) if (released.has(value.runId)) {
        await this.atomic(this.retiredKey(value.jobId), { jobId: value.jobId, requestDigest: value.requestDigest })
        await fs.rm(filename, { force: true })
      }
      const resourceNames = await fs.readdir(resourcesRoot).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [] as string[]; throw error })
      let removed = 0
      for (const name of resourceNames) {
        const match = /^([a-f0-9]{64})\.(blob|json)$/.exec(name)
        if (!match || retainedDigests.has(match[1]!)) continue
        await fs.rm(path.join(resourcesRoot, name), { force: true }); removed++
      }
      return { deferred: false, jobs: jobs.length - kept.length, resources: removed }
    })
    this.maintenance = work.then(() => undefined, () => undefined)
    return work
  }
  private async storeImage(input: HostImageInput): Promise<ImageResourceReference> {
    const image = await prepareImageResource(input, randomUUID)
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(image.meta.mimeType)) throw new ImageGenerationError('unsupported-image', '生成结果必须是真实栅格图片。')
    const digest = hash(image.bytes), resourceId = `image_${digest}`
    const reference: ImageResourceReference = { resourceId, digest, mimeType: image.meta.mimeType as ImageResourceReference['mimeType'],
      width: image.meta.width!, height: image.meta.height!, byteLength: image.bytes.byteLength }
    const filename = path.join(this.directory, 'resources', `${digest}.blob`)
    await serial(filename, async () => {
      await fs.mkdir(path.dirname(filename), { recursive: true })
      try {
        const existing = await fs.readFile(filename)
        if (hash(existing) !== digest) throw new ImageGenerationError('image-blob-corrupt', '已保存图片资源校验失败。')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        const temporary = `${filename}.${randomUUID()}.tmp`
        try { const file = await fs.open(temporary, 'wx', 0o600); try { await file.writeFile(image.bytes); await file.sync() } finally { await file.close() }; await fs.rename(temporary, filename) }
        finally { await fs.rm(temporary, { force: true }).catch(() => undefined) }
      }
      await this.atomic(path.join(this.directory, 'resources', `${digest}.json`), reference)
    })
    return reference
  }
  /** Main-only bytes port. Caller must grant a new Gateway resource handle for the current run/document. */
  async readResource(resourceId: string): Promise<HostImageInput> {
    if (!/^image_[a-f0-9]{64}$/.test(resourceId)) throw new ImageGenerationError('invalid-image-resource', '图片资源引用无效。')
    const digest = resourceId.slice(6), reference = JSON.parse(await fs.readFile(path.join(this.directory, 'resources', `${digest}.json`), 'utf8')) as ImageResourceReference
    const bytes = await fs.readFile(path.join(this.directory, 'resources', `${digest}.blob`))
    if (reference.resourceId !== resourceId || reference.digest !== digest || bytes.length !== reference.byteLength || hash(bytes) !== digest) throw new ImageGenerationError('image-blob-corrupt', '图片资源与保存记录不一致。')
    return { bytes, mimeType: reference.mimeType, filename: `${resourceId}.${reference.mimeType === 'image/jpeg' ? 'jpg' : reference.mimeType.split('/')[1]}` }
  }

  /** Main-only continuation bridge. The caller must independently prove that sourceRunId is
   * an ancestor of the current run in the same conversation; this service proves that the
   * persisted image belongs to that ancestor and still has complete, ready bytes. */
  async readReadyResourceFromJob(input: { jobId: string; sourceRunId: string; sourceDocumentId: string; resourceId: string }): Promise<HostImageInput> {
    const filename = this.key(input.jobId)
    return serial(filename, async () => {
      const job = await this.load(filename)
      const reference = job?.resources.find(resource => resource.resourceId === input.resourceId)
      if (!job || job.runId !== input.sourceRunId || job.documentId !== input.sourceDocumentId
        || job.status !== 'ready' || job.stopped || !reference) {
        throw new ImageGenerationError('image-continuation-unavailable', '先前图片不属于当前可继续的已完成任务。')
      }
      // A durable reference alone is not enough: verify the actual blob before issuing any
      // current-run handle. Missing or changed bytes fail closed and never call the provider.
      try {
        const image = await this.readResource(input.resourceId)
        if (image.mimeType !== reference.mimeType || image.bytes.byteLength !== reference.byteLength)
          throw new ImageGenerationError('image-blob-corrupt', '图片资源与任务记录不一致。')
        return image
      }
      catch { throw new ImageGenerationError('image-continuation-resource-missing', '先前图片资源缺失或校验失败，不能重新签发。') }
    })
  }
}
