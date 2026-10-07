/** @deprecated Historical V9/CLI consumer only; current production uses Project V10 and the canonical Gateway. */
import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { Script } from 'node:vm'
import { serialize, deserialize } from 'node:v8'
import { buildReadSetEntrySchema, buildTargetSchema, buildToolCallSchema, buildCreateTicketSchema, type BuildCreateTicket, type BuildCreateLookup, type BuildAdmissionPort, type BuildImportArtifact, type BuildJobInput, type BuildJobSnapshot, type BuildLogEntry } from '../../../shared/workbench/build'
import { dynamicAdmissionPayloadSchema, dynamicAdmissionResultSchema } from '../../../shared/dynamicAdmissionContract'
import { courseConnectOriginSchema, courseProjectDocumentSchema } from '../../../shared/courseProjectSchema'
import type { DocumentModel } from '../../../shared/workbench/document'
import { validateCourseProjectArchiveData } from '../../../core/drivers/codecs/courseProjectArchive'
import { componentPackageKey } from '../../../core/drivers/codecs/archivePath'
import { parseComponentPackageFiles } from '../../../core/drivers/codecs/importComponentPackage'
import { documentDigest } from '../../../core/documents/documentDigest'
import { projectDynamicTargets } from '../../../shared/projectDynamicTargets'
import { createHtmlDocumentRuntimeSource, unpackHtmlDocumentRuntimeSource } from '../../../shared/runtime/htmlDocumentSource'
import { validateRuntimeSource } from '../../../shared/runtimeSourceValidation'
import { visitProjectDynamicInstances } from '../../../shared/composition/dynamic'
import { collectCourseProjectInteractionHealth } from '../../../shared/courseProjectHealth/interaction'
import { resourcePath } from '../documentJournal'
import { applyDynamicInstanceCaptures, dynamicCaptureRefreshIds } from '../../../core/tools/dynamicCaptureAssets'
import { prepareImageResource } from '../admittedImageResource'
import { waitForHostWork } from '../../../shared/workbench/jobWait'

interface CreateReservation { version: 1; runId: string; ticket: BuildCreateTicket; jobId: string; inputDigest: string; target: BuildJobInput['target']; readSet: BuildJobInput['readSet'] }


type CourseModel = Extract<DocumentModel, { kind: 'course-v9' }>
interface Job extends BuildJobSnapshot {
  allowedOrigins: string[]; logs: BuildLogEntry[]; sourceDigest?: string
  lastCheckDigest?: string; lastCheckOwner?: string; artifact?: BuildImportArtifact; artifactDigest?: string
}
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
export class ControlledBuildError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'ControlledBuildError' }
}

/** Source is data here. No candidate scripts, configs, plugins, shell commands or install hooks run in Main. */
export class ControlledBuildService {
  private readonly directory: string
  private readonly checkOwner = randomUUID()
  private readonly jobs = new Map<string, Job>()
  private readonly baselines = new Map<string, CourseModel>()
  private readonly tails = new Map<string, Promise<unknown>>()
  private readonly controllers = new Map<string, AbortController>()
  private readonly pendingChecks = new Map<string, { input: string; started: Promise<BuildJobSnapshot>; result: Promise<unknown> }>()
  constructor(private readonly options: { directory: string; admission: BuildAdmissionPort }) { this.directory = path.resolve(options.directory) }
  private folder(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new ControlledBuildError('invalid-job', '构建任务编号无效')
    return path.join(this.directory, id)
  }
  private async safeRoot(directory: string) {
    const stat = await fs.lstat(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new ControlledBuildError('unsafe-scratch', '构建目录不是普通受管目录')
    return fs.realpath(directory)
  }
  private async scratch(job: Job) {
    await this.safeRoot(this.directory); await this.safeRoot(this.folder(job.jobId))
    return this.safeRoot(path.join(this.folder(job.jobId), 'files'))
  }
  private serial<T>(id: string, action: () => Promise<T>): Promise<T> {
    const operation = (this.tails.get(id) ?? Promise.resolve()).catch(() => undefined).then(action)
    this.tails.set(id, operation)
    void operation.finally(() => { if (this.tails.get(id) === operation) this.tails.delete(id) }).catch(() => undefined)
    return operation
  }
  private view(job: Job): BuildJobSnapshot {
    const { jobId, runId, target, readSet, sourceRevision, status, createdAt, writes, checks, artifactId } = job
    return structuredClone({ jobId, runId, target, readSet, sourceRevision, status, createdAt, writes, checks, ...(artifactId ? { artifactId } : {}) })
  }
  private async save(job: Job) {
    const filename = path.join(this.folder(job.jobId), 'state.bin'), temporary = `${filename}.${randomUUID()}.tmp`
    const handle = await fs.open(temporary, 'wx')
    try { try { await handle.writeFile(serialize(job)); await handle.sync() } finally { await handle.close() }; await fs.rename(temporary, filename) }
    finally { await fs.rm(temporary, { force: true }).catch(() => undefined) }
  }
  private restoreJob(bytes: Uint8Array): Job {
    const stored = deserialize(bytes) as Record<string, unknown>
    // Reopening existing scratch must not revive the quotas that have been removed.
    // This only restores local state; no admission or document operation is replayed.
    if (stored.status === 'exhausted') stored.status = 'failed'
    for (const field of ['budget', 'budgetSources', 'deadline', 'sameSourceChecks']) delete stored[field]
    return stored as unknown as Job
  }
  private async job(runId: string, id: string): Promise<Job> {
    let job = this.jobs.get(id)
    if (!job) {
      await this.safeRoot(this.directory); await this.safeRoot(this.folder(id))
      const statePath = await resourcePath(this.folder(id), 'state.bin', { rejectSymlinks: true })
      job = this.restoreJob(await fs.readFile(statePath))
      if (job.jobId !== id || !Array.isArray(job.logs) || !job.target) throw new ControlledBuildError('corrupt-job', '构建记录损坏')
      buildTargetSchema.parse(job.target); job.readSet.forEach(entry => buildReadSetEntrySchema.parse(entry))
      if (job.status === 'checking') { job.status = 'failed'; this.log(job, 'admission', 'error', '进程重启中断准入；未重放构建或模型调用'); await this.save(job) }
      this.jobs.set(id, job)
    }
    if (job.runId !== runId) throw new ControlledBuildError('job-not-authorized', '该构建任务不属于当前运行')
    return job
  }
  private live(job: Job) {
    if (job.status === 'cancelled') throw new ControlledBuildError('build-cancelled', '构建已取消，未导入正式文档')
  }
  private log(job: Job, stage: BuildLogEntry['stage'], level: BuildLogEntry['level'], message: string) {
    job.logs.push({ cursor: job.logs.length + 1, time: Date.now(), stage, level, message })
  }
  private async files(job: Job): Promise<Record<string, Uint8Array>> {
    const root = await this.scratch(job), output: Record<string, Uint8Array> = Object.create(null)
    const visit = async (prefix: string) => {
      const directory = prefix ? await resourcePath(root, prefix, { rejectSymlinks: true }) : root
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name
        const filename = await resourcePath(root, relative, { rejectSymlinks: true })
        if (entry.isDirectory()) await visit(relative)
        else {
          const stat = await fs.lstat(filename)
          if (!stat.isFile() || stat.isSymbolicLink()) throw new ControlledBuildError('unsafe-scratch', '构建源码只能包含普通文件')
          const bytes = await fs.readFile(filename)
          if (bytes.length !== stat.size) throw new ControlledBuildError('scratch-changed', '构建文件在读取期间改变')
          output[relative] = Uint8Array.from(bytes)
        }
      }
    }
    await visit(''); return output
  }
  private filesDigest(files: Record<string, Uint8Array>) { return documentDigest(Object.fromEntries(Object.keys(files).sort().map(name => [name, hash(files[name])])) ) }
  private async baseline(job: Job) {
    const loaded = this.baselines.get(job.jobId)
    if (loaded) return loaded
    const filename = await resourcePath(this.folder(job.jobId), 'baseline.bin', { rejectSymlinks: true })
    const baseline = deserialize(await fs.readFile(filename)) as CourseModel
    if (documentDigest(baseline) !== job.target.modelDigest) throw new ControlledBuildError('corrupt-job', '冻结文档基线损坏')
    this.baselines.set(job.jobId, baseline); return baseline
  }
  private requestName(runId: string, ticket: BuildCreateTicket): string {
    return `requests/${documentDigest({ runId, operationId: ticket.operationId })}.bin`
  }
  private async reservation(runId: string, raw: BuildCreateTicket): Promise<CreateReservation | null> {
    const ticket = buildCreateTicketSchema.parse(raw)
    try {
      await this.safeRoot(this.directory)
      const filename = await resourcePath(this.directory, this.requestName(runId, ticket), { rejectSymlinks: true })
      const value = deserialize(await fs.readFile(filename)) as CreateReservation
      if (value.version !== 1 || value.runId !== runId || value.ticket?.operationId !== ticket.operationId || !/^[a-f0-9-]{36}$/.test(value.jobId) || !/^[a-f0-9]{64}$/.test(value.inputDigest)) throw new ControlledBuildError('build-create-record-corrupt', '构建创建票据损坏，未重新创建任务')
      buildTargetSchema.parse(value.target); value.readSet.forEach(entry => buildReadSetEntrySchema.parse(entry))
      if (value.ticket.requestDigest !== ticket.requestDigest) throw new ControlledBuildError('operation-payload-mismatch', '同一构建创建票据不能提交不同内容')
      return value
    } catch (error) {
      if (missing(error)) return null
      if (error instanceof ControlledBuildError) throw error
      throw new ControlledBuildError('build-create-record-corrupt', '构建创建票据无法完整读取，未覆盖或重建任务')
    }
  }
  /** Read-only recovery: incomplete reservation never causes a second scratch or any execution. */
  async lookupCreate(runId: string, ticket: BuildCreateTicket): Promise<BuildCreateLookup | null> {
    const record = await this.reservation(runId, ticket)
    if (!record) return null
    try {
      const folder = this.folder(record.jobId); await this.safeRoot(folder)
      const filename = await resourcePath(folder, 'state.bin', { rejectSymlinks: true })
      const job = this.restoreJob(await fs.readFile(filename))
      if (job.jobId !== record.jobId || job.runId !== runId || documentDigest(job.target) !== documentDigest(record.target) || documentDigest(job.readSet) !== documentDigest(record.readSet) || !['editing', 'checking', 'ready', 'failed', 'cancelled'].includes(job.status)) throw new ControlledBuildError('build-create-record-corrupt', '构建任务记录与创建票据不符，未覆盖原任务')
      return { status: 'created', job: this.view(job) }
    } catch (error) {
      if (missing(error)) return { status: 'unknown', jobId: record.jobId, runId, target: structuredClone(record.target) }
      if (error instanceof ControlledBuildError) throw error
      throw new ControlledBuildError('build-create-record-corrupt', '构建任务记录无法完整读取，未覆盖或重建任务')
    }
  }
  async create(input: BuildJobInput, rawTicket?: BuildCreateTicket): Promise<BuildJobSnapshot> {
    if (!rawTicket) return this.createOnce(input)
    const ticket = buildCreateTicketSchema.parse(rawTicket), frozen = structuredClone(input)
    return this.serial(this.requestName(input.runId, ticket), async () => {
      const prior = await this.reservation(input.runId, ticket)
      if (prior && prior.inputDigest !== documentDigest(frozen)) throw new ControlledBuildError('operation-payload-mismatch', '构建票据已绑定另一冻结前提，未重新创建')
      const known = await this.lookupCreate(input.runId, ticket)
      if (known?.status === 'created') return known.job
      if (known) throw new ControlledBuildError('build-create-unknown', '上次构建创建中断，暂存完成情况未知；已保留原票据，不会自动新建或重放')
      await fs.mkdir(this.directory, { recursive: true }); await this.safeRoot(this.directory)
      const filename = await resourcePath(this.directory, this.requestName(input.runId, ticket), { rejectSymlinks: true })
      await fs.mkdir(path.dirname(filename), { recursive: true }); await this.safeRoot(path.dirname(filename))
      const record: CreateReservation = { version: 1, runId: input.runId, ticket, jobId: randomUUID(), inputDigest: documentDigest(frozen), target: structuredClone(input.target), readSet: structuredClone(input.readSet) }
      let file
      try { file = await fs.open(filename, 'wx') }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        const racedRecord = await this.reservation(input.runId, ticket)
        if (racedRecord && racedRecord.inputDigest !== documentDigest(frozen)) throw new ControlledBuildError('operation-payload-mismatch', '构建票据已绑定另一冻结前提，未重新创建')
        const raced = await this.lookupCreate(input.runId, ticket)
        if (raced?.status === 'created') return raced.job
        throw new ControlledBuildError('build-create-unknown', '该构建创建请求正在进行或已中断；未分配第二个任务')
      }
      try { await file.writeFile(serialize(record)); await file.sync() } finally { await file.close() }
      return this.createOnce(frozen, record.jobId)
    })
  }
  private async createOnce(input: BuildJobInput, reservedJobId?: string): Promise<BuildJobSnapshot> {

    input = structuredClone(input)
    const target = buildTargetSchema.parse(input.target), readSet = input.readSet.map(entry => buildReadSetEntrySchema.parse(entry))
    if (!input.runId || input.baseline.kind !== 'course-v9' || input.baseline.project.id !== target.projectId || input.baseline.project.revision !== target.baseRevision || documentDigest(input.baseline) !== target.modelDigest ||
        !readSet.some(entry => entry.documentId === target.documentId && entry.epoch === target.epoch && entry.revision === target.baseRevision && entry.digest === target.modelDigest)) throw new ControlledBuildError('invalid-baseline', '构建冻结目标与读集合不一致')
    const allowedOrigins = input.allowedOrigins.map(origin => courseConnectOriginSchema.parse(origin))
    const job: Job = { jobId: reservedJobId ?? randomUUID(), runId: input.runId, target, readSet, sourceRevision: 0, status: 'editing', createdAt: Date.now(), writes: 0, checks: 0, allowedOrigins, logs: [] }
    await fs.mkdir(this.directory, { recursive: true }); await this.safeRoot(this.directory)
    await fs.mkdir(this.folder(job.jobId)); await fs.mkdir(path.join(this.folder(job.jobId), 'files'))
    const baselineFile = await fs.open(path.join(this.folder(job.jobId), 'baseline.bin'), 'wx')
    try { await baselineFile.writeFile(serialize(input.baseline)); await baselineFile.sync() } finally { await baselineFile.close() }
    this.jobs.set(job.jobId, job); this.baselines.set(job.jobId, input.baseline)
    const initial: Record<string, Uint8Array> = { 'project.json': Buffer.from(JSON.stringify(input.baseline.project, null, 2)) }
    for (const [id, meta] of Object.entries(input.baseline.project.assets)) initial[meta.path] = input.baseline.resources.assets[id]
    for (const [key, meta] of Object.entries(input.baseline.project.componentPackages)) {
      const files = input.baseline.resources.components[key] ?? input.baseline.resources.components[`${meta.packageId}@${meta.version}`]
      if (!files) throw new ControlledBuildError('invalid-baseline', '冻结工程缺少组件资源')
      const prefix = path.posix.dirname(meta.manifestPath)
      for (const [name, bytes] of Object.entries(files)) initial[`${prefix}/${name}`] = bytes
    }
    validateCourseProjectArchiveData({ project: input.baseline.project, assetFiles: input.baseline.resources.assets, componentFiles: input.baseline.resources.components })
    for (const [name, bytes] of Object.entries(initial)) await this.writeFile(job, name, bytes, false)
    this.log(job, 'scratch', 'info', '已建立只含冻结文档副本的受管 scratch；候选源码不会在具备 OS 权限的构建进程执行')
    await this.save(job); return this.view(job)
  }
  private async writeFile(job: Job, relative: string, bytes: Uint8Array, count = true) {
    this.live(job)
    const root = await this.scratch(job), filename = await resourcePath(root, relative, { rejectSymlinks: true })
    await fs.mkdir(path.dirname(filename), { recursive: true }); await resourcePath(root, relative, { rejectSymlinks: true })
    const temporary = `${filename}.${randomUUID()}.tmp`, handle = await fs.open(temporary, 'wx')
    try { try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }; await fs.rename(temporary, filename) }
    finally { await fs.rm(temporary, { force: true }).catch(() => undefined) }
    this.live(job)
    if (count) { job.writes++; job.sourceRevision++; job.status = 'editing'; delete job.artifact; delete job.artifactId }
  }
  private syntax(source: string, kind: 'component' | 'runtime', filename: string) {
    if (kind === 'runtime') validateRuntimeSource(source)
    // V8 compiles grammar but never executes the candidate. There is deliberately no runInContext/eval/child process.
    new Script(source, { filename: `build-scratch:${filename}` })
  }
  private model(files: Record<string, Uint8Array>, job: Job, baseline: CourseModel): CourseModel {
    const project = courseProjectDocumentSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(files['project.json'])))
    if (project.id !== job.target.projectId || project.revision !== job.target.baseRevision) throw new ControlledBuildError('baseline-conflict', '候选必须保持冻结工程 ID 和基线版本')
    for (const origin of project.network?.connectOrigins ?? []) if (!job.allowedOrigins.includes(origin)) throw new ControlledBuildError('origin-not-authorized', `构建未获准连接该精确来源：${origin}`)
    for (const asset of Object.values(project.assets)) if (asset.remote && !job.allowedOrigins.includes(new URL(asset.remote.url).origin)) throw new ControlledBuildError('origin-not-authorized', '外部素材来源未获当前构建授权')
    const resources: CourseModel['resources'] = { assets: {}, components: {} }
    for (const [id, meta] of Object.entries(project.assets)) resources.assets[id] = files[meta.path]
    for (const [key, meta] of Object.entries(project.componentPackages)) {
      const prefix = `${path.posix.dirname(meta.manifestPath)}/`
      const componentFiles = Object.fromEntries(Object.entries(files).filter(([name]) => name.startsWith(prefix)).map(([name, bytes]) => [name.slice(prefix.length), bytes]))
      const parsed = parseComponentPackageFiles(componentFiles, { expectedId: meta.packageId, expectedVersion: meta.version })
      if (parsed.manifest.content?.kind !== 'composition') this.syntax(parsed.runtimeSource, 'component', `${prefix}${parsed.manifest.entry}`)
      if (parsed.contentSha256 !== meta.contentSha256) throw new ControlledBuildError('component-content-digest-mismatch',
        `组件“${key}”的暂存内容校验值为 ${parsed.contentSha256}；请将 project.json 中该组件的 contentSha256 更新为此值后重新检查`)
      resources.components[componentPackageKey(meta.packageId, meta.version)] = componentFiles
    }
    const managed = new Set<string>()
    visitProjectDynamicInstances(baseline.project, entry => {
      if (entry.kind === 'runtime' && unpackHtmlDocumentRuntimeSource(entry.runtime.source)) managed.add(entry.instanceId)
    })
    visitProjectDynamicInstances(project, entry => {
      if (entry.kind !== 'runtime') return
      const payload = unpackHtmlDocumentRuntimeSource(entry.runtime.source)
      if (payload) {
        // Only payload and cosmetic syntax differ. The factory keeps the supported light-edit lifecycle.
        entry.runtime.source = createHtmlDocumentRuntimeSource(payload)
      } else if (managed.has(entry.instanceId)) {
        throw new ControlledBuildError('managed-html-carrier-changed',
          `受管HTML页面“${entry.instanceId}”的宿主封装发生语义变化，无法保证图文轻编辑。候选源码已保留；请只修改 __htmlDocumentPayload.html / resourceKeys 并保留原宿主，或明确改用独立自定义Runtime，不会静默覆盖自定义逻辑。`)
      }
      this.syntax(entry.runtime.source, 'runtime', entry.instanceId)
    })
    validateCourseProjectArchiveData({ project, assetFiles: resources.assets, componentFiles: resources.components })
    const issues = collectCourseProjectInteractionHealth(project, { assetFiles: resources.assets, componentFiles: resources.components }).filter(issue => issue.severity === 'error')
    if (issues.length) throw new ControlledBuildError('interaction-invalid', issues.map(issue => issue.message).join('\n'))
    return { kind: 'course-v9', project, resources }
  }
  private async check(job: Job, buttonCheck?: Parameters<BuildAdmissionPort['run']>[0]['buttonCheck'], accepted?: (snapshot: BuildJobSnapshot) => void) {
    this.live(job)
    if (job.status === 'ready' && job.artifact && job.artifactId && job.lastCheckOwner === this.checkOwner) {
      const sourceDigest = this.filesDigest(await this.files(job))
      if (sourceDigest === job.sourceDigest
        && job.lastCheckDigest === documentDigest({ sourceDigest, buttonCheck: buttonCheck ?? null })
        && documentDigest(job.artifact.command) === job.artifactDigest) return this.view(job)
    }
    job.checks++; job.status = 'checking'; delete job.artifact; delete job.artifactId
    const controller = new AbortController(); this.controllers.set(job.jobId, controller)
    let abortListener: (() => void) | undefined
    try {
      await this.save(job)
      accepted?.(this.view(job))
      const files = await this.files(job), sourceDigest = this.filesDigest(files)
      // A newly requested button is a new observation intent even when source bytes are unchanged.
      const checkDigest = documentDigest({ sourceDigest, buttonCheck: buttonCheck ?? null })
      job.lastCheckDigest = checkDigest
      job.lastCheckOwner = this.checkOwner
      const baseline = await this.baseline(job)
      let model = this.model(files, job, baseline)
      this.log(job, 'closure', 'info', '普通 JavaScript 语法、正式 Component/Runtime 协议、精确来源和工程资源闭包通过；尚不代表动态准入')
      const targets = projectDynamicTargets(model.project, baseline.project, documentDigest(model.resources) !== documentDigest(baseline.resources))
      let admission: BuildImportArtifact['admission'] = { ok: true, message: '无受影响动态目标；静态资源闭包检查通过' }
      await this.save(job)
      this.live(job); controller.signal.throwIfAborted()
      if (targets.length) {
        const payload = dynamicAdmissionPayloadSchema.parse({ project: model.project, assetFiles: model.resources.assets,
          componentFiles: Object.fromEntries(Object.entries(model.resources.components).map(([key, files]) => [key, Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, Buffer.from(bytes).toString('base64')]))])),
          targets, observeBehavior: true, captureInstances: true, verificationMode: 'full-admission', ...(buttonCheck ? { buttonCheck } : {}),
        })
        const stopped = new Promise<never>((_resolve, reject) => { abortListener = () => reject(controller.signal.reason ?? new Error('构建已取消')); controller.signal.addEventListener('abort', abortListener, { once: true }) })
        admission = dynamicAdmissionResultSchema.parse(await Promise.race([this.options.admission.run(payload, controller.signal), stopped]))
        this.live(job); controller.signal.throwIfAborted()
        if (!admission.ok) throw new ControlledBuildError('admission-failed', admission.message)
        if (!admission.processId || !admission.behaviorEvidence?.length) throw new ControlledBuildError('admission-evidence-missing', '动态准入缺少独立进程与真实行为观察证据')
        if (buttonCheck && !admission.behaviorEvidence.some(evidence => evidence.buttonClick?.instanceId === buttonCheck.instanceId && evidence.buttonClick.label === buttonCheck.label)) throw new ControlledBuildError('interaction-not-observed', '请求的交互未在独立宿主中实际观察')
        const componentPackages = Object.fromEntries(Object.values(model.project.componentPackages).map(meta => [meta.packageId,
          parseComponentPackageFiles(model.resources.components[componentPackageKey(meta.packageId, meta.version)], { expectedId: meta.packageId, expectedVersion: meta.version })]))
        const applied = applyDynamicInstanceCaptures({ project: model.project, assetFiles: model.resources.assets, componentPackages,
          targets, captures: admission.captures ?? [], refreshInstanceIds: dynamicCaptureRefreshIds(model, baseline, componentPackages, targets) })
        // Verify complete PNG pixels before the final artifact is frozen. Metadata/header validation alone is insufficient.
        for (const change of applied.assetFileChanges) if (change.after) {
          const meta = applied.project.assets[change.assetId]
          await prepareImageResource({ bytes: change.after, mimeType: meta.mimeType, filename: meta.filename }, () => change.assetId)
          this.live(job); controller.signal.throwIfAborted()
        }
        model = { ...model, project: applied.project, resources: { ...model.resources, assets: applied.assetFiles } }
        validateCourseProjectArchiveData({ project: model.project, assetFiles: model.resources.assets, componentFiles: model.resources.components })
      } else if (buttonCheck) throw new ControlledBuildError('interaction-not-observed', '请求的交互没有受影响动态目标，不能以静态检查替代')
      this.live(job); controller.signal.throwIfAborted()
      if (this.filesDigest(await this.files(job)) !== sourceDigest) throw new ControlledBuildError('scratch-changed', '准入期间暂存文件已改变，未发布导入制品')
      this.live(job); controller.signal.throwIfAborted()
      const artifactId = randomUUID()
      const artifact: BuildImportArtifact = { artifactId, jobId: job.jobId, runId: job.runId, sourceRevision: job.sourceRevision, target: job.target, readSet: job.readSet,
        command: { type: 'course.replace', project: model.project, resources: model.resources }, admission, semanticVerdict: 'requires-review' }
      const artifactDigest = documentDigest(artifact.command)
      this.live(job); controller.signal.throwIfAborted()
      job.artifact = artifact; job.artifactDigest = artifactDigest
      job.sourceDigest = sourceDigest; job.artifactId = artifactId; job.status = 'ready'
      this.log(job, 'admission', 'info', targets.length ? '真实宿主准入完成；制品可交正式 Gateway 按冻结前提导入，尚未修改文档，语义结果待复核' : '静态制品已准备；尚未修改文档')
    } catch (error) {
      if ((job.status as BuildJobSnapshot['status']) !== 'cancelled') job.status = 'failed'
      this.log(job, 'admission', 'error', error instanceof Error ? error.message : String(error))
    } finally { if (abortListener) controller.signal.removeEventListener('abort', abortListener); this.controllers.delete(job.jobId); await this.save(job) }
    return this.view(job)
  }
  async status(runId: string, jobId: string): Promise<BuildJobSnapshot> { return this.view(await this.job(runId, jobId)) }
  /** Waits only for a check this owner already started; an idle scratch job is returned immediately. */
  async waitCheck(runId: string, jobId: string, milliseconds: number, signal?: AbortSignal): Promise<BuildJobSnapshot> {
    const current = await this.status(runId, jobId)
    if (current.status !== 'checking') return current
    await waitForHostWork(this.pendingChecks.get(jobId)?.result, milliseconds, signal)
    return this.status(runId, jobId)
  }
  startCheck(runId: string, raw: unknown): Promise<BuildJobSnapshot> {
    const call = buildToolCallSchema.parse(raw)
    if (call.type !== 'check') return Promise.reject(new ControlledBuildError('invalid-call', '后台构建入口只接受 check'))
    const input = documentDigest({ runId, call }), existing = this.pendingChecks.get(call.jobId)
    if (existing) return existing.input === input ? existing.started : Promise.reject(new ControlledBuildError('build-check-running', '同一构建已有不同检查运行，请等待、取消或读取状态'))
    let accepted!: (snapshot: BuildJobSnapshot) => void, failed!: (error: unknown) => void
    const started = new Promise<BuildJobSnapshot>((resolve, reject) => { accepted = resolve; failed = reject })
    const result = this.execute(runId, call, accepted).then(value => { accepted(value as BuildJobSnapshot); return value }, error => { failed(error); throw error })
      .finally(() => { this.pendingChecks.delete(call.jobId) })
    this.pendingChecks.set(call.jobId, { input, started, result })
    void started.catch(() => undefined); void result.catch(() => undefined)
    return started.then(snapshot => structuredClone(snapshot))
  }
  async execute(runId: string, raw: unknown, accepted?: (snapshot: BuildJobSnapshot) => void): Promise<unknown> {
    const call = buildToolCallSchema.parse(raw), job = await this.job(runId, call.jobId)
    if (call.type === 'cancel') {
      // A late cancel cannot erase a completed admission or its still-unapplied
      // artifact. A caller may query the ready job after the cancellation race.
      if (job.status !== 'editing' && job.status !== 'checking') return this.view(job)
      job.status = 'cancelled'; delete job.artifact; delete job.artifactId
      this.controllers.get(job.jobId)?.abort(new Error('构建已取消'))
      this.log(job, 'cancel', 'info', '已取消；暂存源码保留，正式文档未由构建服务修改')
      return this.serial(job.jobId, async () => { await this.save(job); return this.view(job) })
    }
    if (call.type === 'logs') return { entries: structuredClone(job.logs.slice(call.after, call.after + call.limit)), nextCursor: Math.min(job.logs.length, call.after + call.limit) }
    return this.serial(job.jobId, async () => {
      if (call.type === 'list') return { job: this.view(job), files: Object.entries(await this.files(job)).map(([name, bytes]) => ({ path: name, bytes: bytes.length })) }
      if (call.type === 'read') { const filename = await resourcePath(await this.scratch(job), call.path, { rejectSymlinks: true }), bytes = await fs.readFile(filename), end = Math.min(bytes.length, call.offset + call.limit); return { path: call.path, encoding: call.encoding, content: bytes.subarray(call.offset, end).toString(call.encoding === 'base64' ? 'base64' : 'utf8'), byteLength: bytes.length, nextOffset: end < bytes.length ? end : null } }
      if (call.type === 'write') {
        if (call.encoding === 'base64' && (call.content.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(call.content))) throw new ControlledBuildError('invalid-bytes', 'base64 素材字节无效')
        await this.writeFile(job, call.path, Buffer.from(call.content, call.encoding)); this.log(job, 'scratch', 'info', `已更新暂存文件 ${call.path}`); await this.save(job); return this.view(job)
      }
      if (call.type === 'syntax') {
        this.live(job)
        job.checks++
        try { const filename = await resourcePath(await this.scratch(job), call.path, { rejectSymlinks: true }); this.syntax(new TextDecoder('utf-8', { fatal: true }).decode(await fs.readFile(filename)), call.kind, call.path); this.log(job, 'syntax', 'info', `${call.path} 语法编译通过；尚未完成协议/闭包/动态准入`); await this.save(job); return { ok: true, stage: 'syntax-checked' } }
        catch (error) { this.log(job, 'syntax', 'error', error instanceof Error ? error.message : String(error)); await this.save(job); return { ok: false, stage: 'syntax-checked', message: job.logs[job.logs.length - 1].message } }
      }
      return this.check(job, call.buttonCheck, accepted)
    })
  }
  async artifact(runId: string, jobId: string, artifactId: string): Promise<BuildImportArtifact> {
    return this.serial(jobId, async () => {
      const job = await this.job(runId, jobId); this.live(job)
      if (job.status !== 'ready' || !job.artifact || job.artifactId !== artifactId || this.filesDigest(await this.files(job)) !== job.sourceDigest
        || documentDigest(job.artifact.command) !== job.artifactDigest) throw new ControlledBuildError('artifact-not-ready', '制品未准入、已改变或已取消，不能导入')
      this.live(job)
      if (!job.artifact) throw new ControlledBuildError('artifact-not-ready', '制品已撤销')
      return structuredClone(job.artifact)
    })
  }
  async cancelRun(runId: string) {
    await Promise.all([...this.jobs.values()].filter(job => job.runId === runId).map(job => this.execute(runId, { type: 'cancel', jobId: job.jobId })))
  }
}
