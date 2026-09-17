import { app } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { lessonBuildFailureSchema, lessonAuthoringDesktopRequestSchema, validateLessonBuilderModule, type LessonAuthoringDesktopRequest, type LessonAuthoringDesktopResult, type LessonAssemblyInput, type LessonBuildFailure } from '../shared/lessonAuthoringDesktop'
import { lessonAuthoringTicketSchema, lessonDocumentVersionSchema, type LessonAuthoringTicket } from '../shared/lessonAuthoring'
import { lessonIdentityKey, type LessonIdentity } from '../shared/lessonWorkspace'
import type { LocalAgentRequest, LocalAgentResponse, LocalAgentId } from '../shared/localAgentContract'
import type { DocumentDiagnostic, DocumentFileVersion } from '../shared/document/ports'
import { LessonAuthoring } from './lessonAuthoring'
import { LessonWorkspaceService } from './lessonWorkspace'
import { LessonMaterials } from './lessonMaterials'
import { lessonDocumentFiles } from './lessonDocumentDesktopService'
import { operateLocalAgent } from './localAgent/service'
import { assertProjectFileCurrent } from './projectFileObservation'
import { lessonBuildTargetSchema, type LessonBuildTarget } from '../shared/lessonAuthoringDesktop'
import { DesktopOperationError } from './errors'
import { validateLessonMarkdownSource } from './lessonMarkdownValidation'
import { buildLessonAuthoringPrompt } from './lessonAuthoringPrompt'
class LessonBuildRepairError extends DesktopOperationError {
  constructor(message: string) { super('LESSON_BUILD_REPAIR', '无法继续构建修复', message, '请保留当前成果并按提示继续。') }
}

interface Run {
  schemaVersion: 1; ticket: LessonAuthoringTicket; adapter: LocalAgentId; instruction: string; sessionId: string
  candidatePath: string; relativePath: string; expectedVersion: DocumentFileVersion | null
  failure?: LessonBuildFailure
  buildRepair?: { baselineCandidatePath: string; observedTarget: LessonBuildTarget }
  repairTicket?: LessonAuthoringTicket
  application?: 'applying' | 'retryable' | 'has-changes'
  status: NonNullable<LessonAuthoringDesktopResult['run']>['status']; message: string
}
const runSchema = z.object({ schemaVersion: z.literal(1), ticket: lessonAuthoringTicketSchema, adapter: z.enum(['codex', 'claude', 'opencode']), instruction: z.string().min(1).max(20000), sessionId: z.uuid(),
  candidatePath: z.string().min(1), relativePath: z.string().min(1), expectedVersion: lessonDocumentVersionSchema.nullable(),
  failure: lessonBuildFailureSchema.optional(),
  buildRepair: z.object({ baselineCandidatePath: z.string().min(1), observedTarget: lessonBuildTargetSchema }).strict().optional(),
  repairTicket: lessonAuthoringTicketSchema.optional(),
  application: z.enum(['applying', 'retryable', 'has-changes']).optional(),
  status: z.enum(['running', 'waiting-confirmation', 'ready-to-build', 'completed', 'failed', 'stopped']), message: z.string().max(20000) }).strict()
export interface LessonAuthoringDesktopDependencies {
  userData: string; editorRoot: string; workspace: LessonWorkspaceService
  files: ReturnType<typeof lessonDocumentFiles>; authoring: LessonAuthoring
  agent(request: LocalAgentRequest): Promise<LocalAgentResponse>
}
const roleLabels = { 'teaching-brief': '教学简报', 'teaching-plan': '教学策划', 'presentation-brief': '呈现简报', 'presentation-script': '呈现脚本', build: '课件构建模块' }
const defaultPaths = { 'teaching-brief': 'teaching-brief.md', 'teaching-plan': '01-teaching-plan.md', 'presentation-brief': 'presentation-brief.md', 'presentation-script': '02-presentation-script.md' }
/** Product stage sequencing only. All model/tool execution remains in the existing native harness. */
export class LessonAuthoringDesktopService {
  private readonly queues = new Map<string, Promise<unknown>>()
  constructor(private readonly deps: LessonAuthoringDesktopDependencies) {}
  private key(lesson: LessonIdentity, conversationId: string) { return createHash('sha256').update(lessonIdentityKey(lesson) + conversationId).digest('hex') }
  private filename(lesson: LessonIdentity, conversationId: string) { return path.join(this.deps.userData, 'lesson-authoring-runs', 'v1', `${this.key(lesson, conversationId)}.json`) }
  private async load(lesson: LessonIdentity, conversationId: string): Promise<Run | undefined> {
    try { const run = runSchema.parse(JSON.parse(await fs.readFile(this.filename(lesson, conversationId), 'utf8'))); if (lessonIdentityKey(run.ticket.lesson) !== lessonIdentityKey(lesson)) throw new Error('阶段任务不属于当前课例'); return run }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
  }
  private async save(lesson: LessonIdentity, conversationId: string, run: Run) {
    const filename = this.filename(lesson, conversationId), temporary = `${filename}.${randomUUID()}.tmp`
    await fs.mkdir(path.dirname(filename), { recursive: true })
    try { await fs.writeFile(temporary, JSON.stringify(run), { flag: 'wx' }); await fs.rename(temporary, filename) }
    finally { await fs.rm(temporary, { force: true }) }
  }
  private scope(lesson: LessonIdentity, conversationId: string) { return { version: 1 as const, kind: 'lesson' as const, lessonId: lesson.lessonId, normalizedDirectory: lesson.normalizedDirectory, conversationId } }
  private async prompt(lesson: LessonIdentity, run: Run, sessionDiagnostics?: readonly DocumentDiagnostic[]): Promise<string> {
    return buildLessonAuthoringPrompt({ editorRoot: this.deps.editorRoot, stage: run.ticket.stage, roleLabel: roleLabels[run.ticket.stage], mode: run.ticket.mode,
      instruction: run.instruction, candidatePath: run.candidatePath, lessonDirectory: lesson.normalizedDirectory, materials: run.ticket.materials, sessionDiagnostics })
  }
  private async begin(lesson: LessonIdentity, conversationId: string, adapter: LocalAgentId, instruction: string): Promise<Run> {
    const view = await this.deps.authoring.read(lesson), stage = view.currentStage
    if (stage === 'build' && (await this.deps.workspace.read(lesson)).manifest.coursePath) throw new Error('本课例已有工程，请在当前工程继续编辑；重建需使用新课例')
    const ticket = await this.deps.authoring.beginTask(lesson, stage)
    const workspace = await this.deps.workspace.read(lesson)
    const relativePath = stage === 'build' ? `implementation/build-${ticket.id}.mjs` : workspace.manifest.documents[stage] ?? defaultPaths[stage]
    let expectedVersion: DocumentFileVersion | null = null
    if (stage !== 'build') {
      await this.deps.authoring.assertOutputWritable(lesson, relativePath)
      try { expectedVersion = (await this.deps.files.openDocument({ kind: 'lesson' as const, lessonId: lesson.lessonId, lessonDirectory: lesson.normalizedDirectory, relativePath })).version }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    }
    const root = path.join(this.deps.userData, 'lesson-authoring-candidates', 'v1', ticket.id)
    await fs.mkdir(root, { recursive: true })
    const run: Run = { schemaVersion: 1, ticket, adapter, instruction, sessionId: '', candidatePath: path.join(root, stage === 'build' ? 'build.mjs' : 'stage.md'), relativePath,
      expectedVersion, status: 'running', message: `正在准备${roleLabels[stage]}` }
    const reply = await this.deps.agent({ operation: 'lesson-start', workspace: this.scope(lesson, conversationId), adapter, intent: 'plan', prompt: await this.prompt(lesson, run), userMessage: instruction })
    if (!reply.sessionId) throw new Error('原生任务未启动')
    run.sessionId = reply.sessionId; await this.save(lesson, conversationId, run); return run
  }
  private async assembly(lesson: LessonIdentity, run: Run): Promise<LessonAssemblyInput> {
    const check = await this.deps.authoring.validateTask(lesson, run.ticket)
    if (!check.allowed) throw new Error(check.issues.join('；'))
    const moduleSource = await this.readCandidate(run)
    validateLessonBuilderModule(moduleSource)
    const read = async (role: 'teaching-plan' | 'presentation-script') => {
      const baseline = run.ticket.inputs.find(input => input.role === role)!
      const disk = await this.deps.files.openDocument({ kind: 'lesson' as const, lessonId: lesson.lessonId, lessonDirectory: lesson.normalizedDirectory, relativePath: baseline.relativePath })
      return { path: path.join(lesson.normalizedDirectory, baseline.relativePath), content: disk.source }
    }
    return { ticket: run.ticket, modulePath: run.candidatePath, moduleSource, ...(run.buildRepair ? { expectedInitialTarget: run.buildRepair.observedTarget } : {}), documents: { teachingPlan: await read('teaching-plan'), presentationScript: await read('presentation-script') } }
  }
  private async readCandidate(run: Run): Promise<string> {
    const expectedRoot = path.join(this.deps.userData, 'lesson-authoring-candidates', 'v1', run.ticket.id)
    if (path.resolve(path.dirname(run.candidatePath)) !== path.resolve(expectedRoot)) throw new Error('阶段候选不属于本轮目录')
    const root = await fs.realpath(expectedRoot), target = await fs.realpath(run.candidatePath)
    if (path.dirname(target) !== root) throw new Error('阶段候选越出本轮目录')
    const file = await fs.open(target, 'r')
    try { if ((await file.stat()).size > 1024 * 1024) throw new Error('阶段候选超过1 MiB'); const source = await file.readFile('utf8'); if (!source.trim()) throw new Error('阶段候选为空'); return source }
    finally { await file.close() }
  }
  private async resumeInvalidStageCandidate(lesson: LessonIdentity, conversationId: string, run: Run, diagnostics: readonly DocumentDiagnostic[]) {
    const reply = await this.deps.agent({ operation: 'lesson-resume', workspace: this.scope(lesson, conversationId), sessionId: run.sessionId,
      prompt: await this.prompt(lesson, run, diagnostics), userMessage: '请根据当前校验诊断修正候选，修好后重新提交当前阶段', preserveTaskBudget: true })
    if (!reply.sessionId) throw new Error('原生阶段修正任务未启动')
    run.sessionId = reply.sessionId
    run.message = '当前候选未写入正式文档，已回原生会话修正格式或附件'
    await this.save(lesson, conversationId, run)
  }
  private async assertStageOutputCurrent(lesson: LessonIdentity, run: Run) {
    const ref = { kind: 'lesson' as const, lessonId: lesson.lessonId, lessonDirectory: lesson.normalizedDirectory, relativePath: run.relativePath }
    let current: { version: DocumentFileVersion } | undefined
    try { current = await this.deps.files.openDocument(ref) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (JSON.stringify(current?.version ?? null) !== JSON.stringify(run.expectedVersion)) throw new Error('教师已修改当前稿，候选未覆盖；请处理文档冲突')
  }
  operate(raw: LessonAuthoringDesktopRequest): Promise<LessonAuthoringDesktopResult> {
    const input = lessonAuthoringDesktopRequestSchema.parse(raw), key = this.key(input.lesson, input.conversationId)
    const pending = (this.queues.get(key) ?? Promise.resolve()).then(() => this.perform(input))
    this.queues.set(key, pending.catch(() => {})); return pending
  }
  private async perform(input: z.output<typeof lessonAuthoringDesktopRequestSchema>): Promise<LessonAuthoringDesktopResult> {
    const { lesson, conversationId } = input
    await this.deps.workspace.read(lesson)
    if (input.operation === 'validate') {
      const current = await this.load(lesson, conversationId), validation = await this.deps.authoring.validateTask(lesson, input.ticket)
      if (current && current.ticket.id !== input.ticket.id) { validation.allowed = false; validation.issues.push('当前构建任务已变化') }
      return { view: await this.deps.authoring.read(lesson), validation }
    }
    if (input.operation === 'read-asset') {
      const validation = await this.deps.authoring.validateTask(lesson, input.ticket)
      if (!validation.allowed) throw new Error(validation.issues.join('；'))
      const filename = await fs.realpath(path.join(lesson.normalizedDirectory, input.relativePath)), relative = path.relative(lesson.normalizedDirectory, filename)
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('素材越出当前课例')
      const file = await fs.open(filename, 'r')
      try { if ((await file.stat()).size > 32 * 1024 * 1024) throw new Error('素材超过32 MiB'); return { view: await this.deps.authoring.read(lesson), asset: new Uint8Array(await file.readFile()) } }
      finally { await file.close() }
    }
    let run = await this.load(lesson, conversationId), assembly: LessonAssemblyInput | undefined, projectPath: string | undefined
    if (input.operation === 'repair-build') {
      if (!run || run.ticket.stage !== 'build' || run.ticket.id !== input.ticketId || run.status === 'running' || run.status === 'completed' || run.application === 'applying' || run.repairTicket || (run.failure && run.failure.committedStepCount > 0) || (run.application === 'has-changes' && !run.failure?.target)) throw new Error('当前工程已有内容或任务仍在运行，请保存并继续编辑当前课件')
      const failureMessage = run.failure?.message ?? (run.status === 'failed' && !run.application ? run.message : undefined)
      if (!failureMessage) throw new LessonBuildRepairError('没有可用的实际构建诊断，请先执行当前候选以取得真实结果')
      const target = run.buildRepair?.observedTarget ?? run.failure?.target
      if (target && JSON.stringify(target) !== JSON.stringify(input.currentTarget)) throw new LessonBuildRepairError('当前工程已变化，不能修复后重新运行整个模块')
      const ticket = await this.deps.authoring.beginTask(lesson, 'build')
      if (JSON.stringify(ticket.inputs) !== JSON.stringify(run.ticket.inputs) || JSON.stringify(ticket.materials) !== JSON.stringify(run.ticket.materials) || ticket.mode !== run.ticket.mode) throw new LessonBuildRepairError('当前教学稿或材料已变化，请先重新核实当前稿')
      const source = await this.readCandidate(run.buildRepair && (run.status === 'stopped' || run.status === 'failed') ? { ...run, candidatePath: run.buildRepair.baselineCandidatePath } : run)
      const archive = path.join(this.deps.userData, 'lesson-authoring-runs', 'v1', 'history', `${run.ticket.id}.json`)
      await fs.mkdir(path.dirname(archive), { recursive: true }); await fs.writeFile(archive, JSON.stringify(run), { flag: 'wx' }).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error })
      const candidatePath = path.join(this.deps.userData, 'lesson-authoring-candidates', 'v1', ticket.id, 'build.mjs')
      const baselineCandidatePath = path.join(path.dirname(candidatePath), 'baseline.mjs')
      await fs.mkdir(path.dirname(candidatePath), { recursive: true }); await fs.writeFile(baselineCandidatePath, source, { flag: 'wx' }); await fs.writeFile(candidatePath, source, { flag: 'wx' })
      const next: Run = { ...run, ticket, candidatePath, relativePath: `implementation/build-${ticket.id}.mjs`, status: 'running', application: run.application ?? 'retryable', buildRepair: { baselineCandidatePath, observedTarget: input.currentTarget }, failure: run.failure ?? { committedStepCount: 0, message: failureMessage }, message: '正在根据实际构建问题修复当前模块，已有教学稿保持不变' }
      const prompt = `${await this.prompt(lesson, next)}\n教师本次修复要求：${input.instruction}\n实际宿主失败：${JSON.stringify(next.failure)}\n只修复当前模块。基准模块：${baselineCandidatePath}。保留既有教学内容与互动目标，不修改四份教学稿或材料。修复后由宿主重新核验原空工程并执行，不自行构建或写工程。`
      const reply = await this.deps.agent({ operation: 'lesson-resume', workspace: this.scope(lesson, conversationId), sessionId: run.sessionId, prompt, userMessage: input.instruction })
      if (!reply.sessionId) throw new Error('原生修复任务未启动')
      next.sessionId = reply.sessionId; run = next; await this.save(lesson, conversationId, run)
    }
    if (input.operation === 'set-mode') { if (run?.status === 'running') throw new Error('请先停止当前阶段'); await this.deps.authoring.setMode(lesson, input.mode, input.materials) }
    if (input.operation === 'confirm') await this.deps.authoring.confirm(lesson, input.role, input.expectedVersion)
    if (input.operation === 'start') {
      if (run?.status === 'running') throw new Error('当前阶段正在运行')
      if (run?.application) throw new Error('已有构建应用记录，请重试未写入的当前候选，或在当前工程继续编辑')
      run = await this.begin(lesson, conversationId, input.adapter, input.instruction)
    }
    if (input.operation === 'stop') {
      await this.deps.authoring.stop(lesson)
      const current = await this.deps.workspace.read(lesson)
      await Promise.all(Object.values(current.manifest.documents).map(relativePath => this.deps.files.invalidateAiEdits({ kind: 'lesson' as const, lessonId: lesson.lessonId, lessonDirectory: lesson.normalizedDirectory, relativePath })))
      if (run?.status === 'running') await this.deps.agent({ operation: 'lesson-cancel', workspace: this.scope(lesson, conversationId), sessionId: run.sessionId })
      if (run) { run.status = 'stopped'; run.message = '已停止，已保存文档保留'; await this.save(lesson, conversationId, run) }
    }
    if (input.operation === 'poll' && run?.status === 'running') {
      try {
        const reply = await this.deps.agent({ operation: 'lesson-read', workspace: this.scope(lesson, conversationId), sessionId: run.sessionId, after: 0 })
        const record = reply.records?.find(record => record.id === run!.sessionId)
        if (!record) throw new Error('原生任务记录不可用，不能假定阶段已完成')
        if (record.status === 'failed' || record.status === 'cancelled') throw new Error('原生阶段任务已中断，请查看对话后继续')
        if (record.status === 'completed') {
          const check = await this.deps.authoring.validateTask(lesson, run.ticket)
          if (!check.allowed) throw new Error(check.issues.join('；'))
          if (run.ticket.stage === 'build') {
            assembly = await this.assembly(lesson, run); run.status = 'ready-to-build'; run.message = run.buildRepair ? '模块修复完成，请继续当前构建' : '构建模块已准备，正在应用到当前工程'
            if (run.buildRepair) assembly = undefined
          } else {
            const source = await this.readCandidate(run)
            await this.deps.authoring.assertOutputWritable(lesson, run.relativePath)
            await this.assertStageOutputCurrent(lesson, run)
            const validation = validateLessonMarkdownSource(source, path.join(lesson.normalizedDirectory, run.relativePath), lesson.normalizedDirectory)
            if (validation.status === 'invalid') {
              await this.resumeInvalidStageCandidate(lesson, conversationId, run, validation.diagnostics)
            } else if (validation.status === 'unreadable') {
              throw new Error(validation.diagnostics[0]?.message ?? '阶段候选或资源目录不可读取')
            } else {
              const ref = { kind: 'lesson' as const, lessonId: lesson.lessonId, lessonDirectory: lesson.normalizedDirectory, relativePath: run.relativePath }
              const stageRun = run
              const validateBeforeWrite = async () => {
                const current = await this.deps.authoring.validateTask(lesson, stageRun.ticket)
                if (!current.allowed) throw new Error(current.issues.join('；'))
                const latest = validateLessonMarkdownSource(source, path.join(lesson.normalizedDirectory, stageRun.relativePath), lesson.normalizedDirectory)
                if (latest.status !== 'valid') throw new Error(latest.diagnostics[0]?.message ?? '阶段候选在写入前已失效')
              }
              const saved = await this.deps.files.saveDocumentIfNoRecovery({ ref, operationId: run.ticket.id, source, expectedVersion: run.expectedVersion, attachments: [] }, validateBeforeWrite)
              if (saved.status !== 'saved') throw new Error(saved.status === 'conflict' ? '教师已修改当前稿，候选未覆盖；请处理文档冲突' : saved.message)
              await this.deps.workspace.registerDocument(lesson, run.ticket.stage, run.relativePath)
              await this.deps.authoring.completeTask(lesson, run.ticket, saved.version)
              run.status = 'waiting-confirmation'; run.message = `${roleLabels[run.ticket.stage]}已实际保存，请查看当前文件`
            }
          }
          await this.save(lesson, conversationId, run)
          if (run.status === 'waiting-confirmation' && run.ticket.mode === 'automatic') run = await this.begin(lesson, conversationId, run.adapter, run.instruction)
        }
      } catch (error) { run.status = 'failed'; run.message = (error as Error).message; if (run.ticket.stage === 'build' && !run.application) run.failure = { committedStepCount: 0, message: run.message }; await this.save(lesson, conversationId, run) }
    }
    if (input.operation === 'begin-document-repair') {
      if (!run || run.status === 'running' || run.application === 'applying' || (run.application === 'has-changes' && !(run.failure?.committedStepCount === 0 && run.failure.target))) throw new Error('请先完成或停止当前任务，并保留已应用工程')
      const view = await this.deps.authoring.read(lesson)
      if (view.currentStage !== input.role) throw new Error('请按当前阶段修复，保留前置当前稿')
      run.repairTicket = await this.deps.authoring.beginTask(lesson, input.role)
      run.message = `正在修复${roleLabels[input.role]}，保留现有教学内容`
      await this.save(lesson, conversationId, run)
    }
    if (input.operation === 'cancel-document-repair') {
      if (!run?.repairTicket || run.repairTicket.id !== input.ticketId) throw new Error('文档修复任务已变化')
      await this.deps.authoring.stop(lesson)
      const current = await this.deps.workspace.read(lesson)
      const relativePath = current.manifest.documents[run.repairTicket.stage as keyof typeof defaultPaths]
      if (relativePath) await this.deps.files.invalidateAiEdits({ kind: 'lesson' as const, lessonId: lesson.lessonId, lessonDirectory: lesson.normalizedDirectory, relativePath })
      delete run.repairTicket; run.message = '本次文档修复已结束，已保存内容和原构建模块保留'
      await this.save(lesson, conversationId, run)
    }
    if (input.operation === 'complete-document-repair') {
      if (!run?.repairTicket || JSON.stringify(run.repairTicket) !== JSON.stringify(input.ticket)) throw new Error('修复回执不属于当前文档任务')
      await this.deps.authoring.completeTask(lesson, input.ticket, input.expectedVersion)
      delete run.repairTicket
      await this.save(lesson, conversationId, run)
    }
    if (input.operation === 'reprepare-existing-build') {
      const resumeEmpty = run?.application === 'has-changes' && run.failure?.committedStepCount === 0 && !!run.failure.target
      if (!run || run.ticket.stage !== 'build' || run.status !== 'ready-to-build' || run.application === 'applying' || (run.application === 'has-changes' && !resumeEmpty) || run.repairTicket) throw new Error('当前成果不能重新创建工程，请先完成文档修复或继续编辑当前工程')
      if ((await this.deps.workspace.read(lesson)).manifest.coursePath && !resumeEmpty) throw new Error('本课例已有工程，请打开当前工程继续编辑')
      const ticket = await this.deps.authoring.beginTask(lesson, 'build')
      const source = await this.readCandidate(run); validateLessonBuilderModule(source)
      const archive = path.join(this.deps.userData, 'lesson-authoring-runs', 'v1', 'history', `${run.ticket.id}.json`)
      await fs.mkdir(path.dirname(archive), { recursive: true }); await fs.writeFile(archive, JSON.stringify(run), { flag: 'wx' }).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error })
      const candidatePath = path.join(this.deps.userData, 'lesson-authoring-candidates', 'v1', ticket.id, 'build.mjs')
      await fs.mkdir(path.dirname(candidatePath), { recursive: true }); await fs.writeFile(candidatePath, source, { flag: 'wx' })
      run = { ...run, ticket, candidatePath, relativePath: `implementation/build-${ticket.id}.mjs`, message: '当前四稿已重新校验，复用原构建模块，无新模型生成' }
      if (run.buildRepair) {
        const baselineCandidatePath = path.join(path.dirname(candidatePath), 'baseline.mjs')
        await fs.writeFile(baselineCandidatePath, source, { flag: 'wx' })
        run.buildRepair = { ...run.buildRepair, baselineCandidatePath }
      }
      if (!resumeEmpty) delete run.application
      else run.message = '当前四稿已重新核实，原模块与现有空工程目标已保留；请继续当前构建'
      await this.save(lesson, conversationId, run); if (!resumeEmpty) assembly = await this.assembly(lesson, run)
    }
    if (input.operation === 'begin-application') {
      if (run?.buildRepair && JSON.stringify(input.currentTarget) !== JSON.stringify(run.buildRepair.observedTarget)) throw new LessonBuildRepairError('当前工程已变化，不能应用修复模块')
      if (!run || run.ticket.id !== input.ticketId || run.status !== 'ready-to-build' || (run.application && run.application !== 'retryable')) throw new Error('当前构建已经开始应用，请保留当前工程继续编辑')
      assembly = await this.assembly(lesson, run)
      run.application = 'applying'; run.message = '正在应用构建，重启后请检查当前工程，不能自动覆盖'
      await this.save(lesson, conversationId, run)
    }
    if (input.operation === 'continue-application') {
      if (run?.buildRepair && JSON.stringify(input.currentTarget) !== JSON.stringify(run.buildRepair.observedTarget)) throw new LessonBuildRepairError('当前工程已变化，不能应用修复模块')
      if (!run || run.ticket.id !== input.ticketId || run.status !== 'ready-to-build' || run.application !== 'has-changes' || run.failure?.committedStepCount !== 0 || !run.failure.target) throw new Error('当前成果已有构建写入或缺少精确目标，请在工程内继续编辑，不能重新运行整个模块')
      assembly = { ...await this.assembly(lesson, run), resumeTarget: run.failure.target }
      run.application = 'applying'; run.message = '正在原有空工程上继续构建，不新建或重置工程'
      await this.save(lesson, conversationId, run)
    }
    if (input.operation === 'fail-application') {
      const observedEmptyFailure = run?.status === 'ready-to-build' && (!run.application || run.application === 'has-changes') && !run.failure && input.hasCommittedChanges && input.failure?.committedStepCount === 0 && !!input.failure.target
      if (!run || run.ticket.id !== input.ticketId || (run.application !== 'applying' && !observedEmptyFailure)) throw new Error('构建失败回执不属于当前应用')
      run.application = input.hasCommittedChanges ? 'has-changes' : 'retryable'
      run.failure = input.failure
      delete run.buildRepair
      run.message = input.hasCommittedChanges ? input.failure?.committedStepCount === 0 && input.failure.target ? '当前空工程已保留，修正模块后可继续当前构建' : '当前工程已开始创建或写入，请保留成果继续编辑' : '构建在写入前失败，可以重试当前候选，无需重新生成'
      if (run.failure?.message) run.message += `：${run.failure.message}`
      await this.save(lesson, conversationId, run)
    }
    if ((input.operation === 'read' || input.operation === 'poll') && run?.status === 'ready-to-build' && !run.application && !run.repairTicket) {
      const validation = await this.deps.authoring.validateTask(lesson, run.ticket)
      if (validation.allowed) assembly = await this.assembly(lesson, run)
      else {
        const current = await this.deps.authoring.read(lesson)
        run.message = current.currentStage === 'build' ? '当前稿已变化，请重新准备原构建模块；不会重新生成模块' : `请修复或复核当前${roleLabels[current.currentStage]}，原构建模块已保留`
      }
    }
    if (input.operation === 'accept-build') {
      if (!run || run.ticket.id !== input.ticketId || run.status !== 'ready-to-build' || run.application !== 'applying') throw new Error('构建回执不属于当前阶段')
      const check = await this.deps.authoring.validateTask(lesson, run.ticket); if (!check.allowed) throw new Error(check.issues.join('；'))
      const real = await fs.realpath(input.projectPath)
      if (!real.toLowerCase().endsWith('.h5lesson') || !(await fs.stat(real)).isFile()) throw new Error('课件尚未实际保存')
      await assertProjectFileCurrent(real)
      delete run.failure; delete run.buildRepair
      run.status = 'completed'; run.application = 'has-changes'; run.message = '课件已保存，可继续编辑和运行检查'; projectPath = real
      await this.save(lesson, conversationId, run)
    }
    return { view: await this.deps.authoring.read(lesson), ...(run ? { run: { ticketId: run.ticket.id, stage: run.ticket.stage, sessionId: run.sessionId, status: run.status, message: run.message } } : {}), ...(run?.buildRepair ? { repairTarget: run.buildRepair.observedTarget } : {}), ...(run?.failure ? { failure: run.failure } : {}), ...(run?.repairTicket ? { repairTicket: run.repairTicket } : {}), ...(run?.application ? { application: run.application } : {}), ...(assembly ? { assembly } : {}), ...(projectPath ? { projectPath } : {}) }
  }
}
let service: LessonAuthoringDesktopService | undefined
export async function operateLessonAuthoringDesktop(request: LessonAuthoringDesktopRequest): Promise<LessonAuthoringDesktopResult> {
  if (!service) {
    const workspace = new LessonWorkspaceService(app.getPath('userData')), files = lessonDocumentFiles()
    const materials = new LessonMaterials(async target => { await workspace.read({ schemaVersion: 1, lessonId: target.lessonId, normalizedDirectory: target.rootPath }) })
    const authoring = new LessonAuthoring({ workspace, files, materials })
    service = new LessonAuthoringDesktopService({ userData: app.getPath('userData'), editorRoot: app.getAppPath(), workspace, files, authoring, agent: operateLocalAgent })
  }
  return service.operate(request)
}
