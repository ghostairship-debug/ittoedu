import { localAgentMessages } from '../../shared/localAgentText'
import { LessonAuthoring } from '../lessonAuthoring'
import { LessonMaterials } from '../lessonMaterials'
import { lessonDocumentFiles } from '../lessonDocumentDesktopService'
import { readLessonGenerationContext } from './lessonGenerationContext'
import type { GenerationRequest } from '../../shared/generationContract'
import type { ConversationOwner, FrozenEditTarget, LessonIdentity } from '../../shared/lessonWorkspace'
import { assertFrozenTargetMatchesOwner, conversationOwnerOf, conversationWorkingDirectory, resolveSendFrozenTarget } from '../../shared/lessonWorkspace'
import { normalizeWorkspacePath, workspaceIdentityKey, type ConversationAgentWorkspace } from '../../shared/workspaceIdentity'
import { LessonWorkspaceService } from '../lessonWorkspace'
import { LessonConversationRepository } from './lessonConversationRepository'
import { app, session } from 'electron'
import { configureNativeSystemProxy } from './nativeProxy'
import { localAgentRequestSchema, localAgentResponseSchema, type ExternalReferencesScope, type LocalAgentResponse } from '../../shared/localAgentContract'
import { generationExternalReferences, lessonContextReferences, withLessonGenerationContext } from '../../shared/externalAiReferences'
import { createWorkspaceIdentity } from '../workspaceIdentity'
import { LocalAgentHarness } from './harness'
import { LocalAgentRepository } from './repository'
import { directoryConversationSkillPrompt } from './directoryConversationSkillResources'
import { projectFileStatus } from '../projectFileObservation'
import { DesktopOperationError } from '../errors'
import { ZodError } from 'zod'

export type LessonRecordsInvalidationScope =
  | { lesson: LessonIdentity; conversationId?: string }
  | { directoryConversation: { conversationId: string; normalizedDirectory: string } }
  | { all: true }
const lessonRecordsInvalidators = new Set<(scope: LessonRecordsInvalidationScope) => Promise<void>>()
export function registerLessonRecordsInvalidator(callback: (scope: LessonRecordsInvalidationScope) => Promise<void>): () => void {
  lessonRecordsInvalidators.add(callback)
  return () => { lessonRecordsInvalidators.delete(callback) }
}
async function invalidateLessonRecordOwners(scope: LessonRecordsInvalidationScope): Promise<void> {
  const results = await Promise.allSettled([...lessonRecordsInvalidators].map(callback => callback(scope)))
  const failure = results.find(result => result.status === 'rejected')
  if (failure?.status === 'rejected') throw failure.reason
}
let deletingApplicationRecords = false
export function assertLocalAgentRecordsAvailable(): void { if (deletingApplicationRecords) throw new Error('正在删除应用对话记录，请稍后重试') }
let harness: LocalAgentHarness | undefined
let sharedRepository: LocalAgentRepository | undefined
function localAgentRepository(): LocalAgentRepository {
  sharedRepository ??= new LocalAgentRepository(app.getPath('userData'))
  return sharedRepository
}
function localAgentHarness(): LocalAgentHarness {
  harness ??= new LocalAgentHarness(localAgentRepository())
  return harness
}
export async function operateLocalAgent(request: unknown): Promise<LocalAgentResponse> {
  assertLocalAgentRecordsAvailable()
  try { return localAgentResponseSchema.parse(await operate(request)) }
  catch (error) {
    if (error instanceof DesktopOperationError || error instanceof ZodError) throw error
    throw new DesktopOperationError('LOCAL_AGENT_REQUEST_FAILED', 'CLI 操作未完成', error instanceof Error ? error.message.slice(0, 4000) : '当前请求未完成', '请根据提示调整当前任务后重试。')
  }
}
async function operate(request: unknown): Promise<LocalAgentResponse> {
  const input = localAgentRequestSchema.parse(request)
  const repository = localAgentRepository()
  if (input.operation === 'external-notice') {
    const externalNotice = input.confirm
      ? await repository.confirmExternalAiNotice(input.scope, input.adapter)
      : await repository.readExternalAiNotice(input.scope, input.adapter)
    return { enabled: true, externalNotice }
  }
  // Read-only and harness-free: the teacher sees the list before anything is sent.
  if (input.operation === 'external-references') return { enabled: true, externalReferences: await externalReferences(input.scope) }
  configureNativeSystemProxy(url => session.defaultSession.resolveProxy(url))
  const agent = localAgentHarness()
  if (input.operation === 'probe') return { enabled: true, probe: await agent.probe(input.adapter) }
  if (input.operation === 'capabilities') return { enabled: true, capabilities: await agent.capabilities(input.adapter, { refresh: input.refresh,
    ...(input.projectId && input.projectPath ? { workspace: createWorkspaceIdentity(input.projectId, input.projectPath) } : {}) }) }
  if (input.operation === 'configure') return { enabled: true, capabilities: await agent.configure(input.adapter, input.configuration,
    input.projectId && input.projectPath ? createWorkspaceIdentity(input.projectId, input.projectPath) : undefined) }
  if ('workspace' in input) {
    const requested = input.workspace
    const conversationRepository = new LessonConversationRepository(app.getPath('userData'))
    const { owner: conversationOwner, conversation } = await conversationRepository.requireOwned(requested)
    const lesson = conversationOwner.kind === 'lesson' ? conversationOwner.lesson : undefined
    if (requested.kind === 'directory' && conversationOwner.kind === 'lesson') throw new Error('当前工作空间对话不存在，请重新打开')
    const workspace = conversationAgentScope(conversationOwner, conversation.conversationId)
    const currentLesson = lesson ? await new LessonWorkspaceService(app.getPath('userData')).read(lesson) : undefined
    switch (input.operation) {
      case 'lesson-prepare-generation': { if (!lesson) throw new Error('创作生成仅在课例会话中可用'); const current = await readCurrentLesson(lesson, true); return { enabled: true, lessonGeneration: { confirmedDocuments: current.confirmedDocuments! } } }
      case 'lesson-start': {
        // 课例作用域用课例提示词；目录作用域（工作空间/项目会话）是完整 CLI 套皮，
        // 教师消息原样交给 CLI，工作目录即会话目录（harness 对 directory 作用域取 realpath(normalizedDirectory)）。
        if (workspace.kind === 'lesson' && !currentLesson) throw new Error('课例上下文不可用');
        const frozen = resolveSendFrozenTarget(normalizeFrozenTarget(input.frozenTarget), conversationOwner)
        assertFrozenTargetMatchesOwner(conversationOwner, frozen)
        const prompt = currentLesson ? await currentLessonPrompt(currentLesson, input.prompt)
          : await directoryConversationSkillPrompt(app.getPath('userData'), input.prompt)
        const sessionId = await agent.start(workspace, input.adapter, prompt, input.intent, input.userMessage ?? input.prompt)
        try {
          await conversationRepository.attachSession(conversationOwner, workspace.conversationId, sessionId, conversation.epoch)
          await conversationRepository.recordFrozenTarget(conversationOwner, workspace.conversationId, frozen)
        }
        catch (error) { await agent.cancel(workspace, sessionId); throw error }
        return { enabled: true, sessionId }
      }
      case 'lesson-resume': {
        const prior = (await agent.list(workspace)).records.find(record => record.id === input.sessionId)
        if (!prior) throw new Error('当前对话没有这条任务记录')
        if (input.preserveTaskBudget && !prior.externalSessionId) throw new Error('当前阶段缺少可续接的原生会话，未启动新任务')
        if (workspace.kind === 'lesson' && !currentLesson) throw new Error('课例上下文不可用');
        const frozen = resolveSendFrozenTarget(normalizeFrozenTarget(input.frozenTarget), conversationOwner)
        assertFrozenTargetMatchesOwner(conversationOwner, frozen)
        const prompt = currentLesson ? await currentLessonPrompt(currentLesson, input.prompt)
          : await directoryConversationSkillPrompt(app.getPath('userData'), input.prompt)
        const sessionId = 'kind' in prior.workspace && prior.externalSessionId
          ? await agent.resume(workspace, input.sessionId, prompt, input.userMessage ?? input.prompt, input.preserveTaskBudget)
          : await agent.start(workspace, prior.adapter, prompt, 'discuss', input.userMessage ?? input.prompt)
        try {
          await conversationRepository.attachSession(conversationOwner, workspace.conversationId, sessionId, conversation.epoch)
          await conversationRepository.recordFrozenTarget(conversationOwner, workspace.conversationId, frozen)
        }
        catch (error) { await agent.cancel(workspace, sessionId); throw error }
        return { enabled: true, sessionId }
      }
      case 'lesson-cancel': { const record = (await agent.list(workspace)).records.find(record => record.id === input.sessionId); if (record) await agent.cancel(record.workspace, input.sessionId); return { enabled: true } }
      case 'lesson-delete': await agent.delete(workspace, input.sessionId); return { enabled: true }
      case 'lesson-input': { const record = (await agent.list(workspace)).records.find(record => record.id === input.sessionId); if (!record) throw new Error('会话不存在'); return { enabled: true, inputDelivery: await agent.input(record.workspace, input.sessionId, input.input) } }
      case 'lesson-list': { const result = await agent.list(workspace); return { enabled: true, records: result.records.map(record => ({ ...record, events: [] })), damaged: result.damaged } }
      case 'lesson-read': { const result = await agent.read(workspace, input.sessionId); return { enabled: true, records: result.records.map(record => ({ ...record, events: record.events.filter(event => event.sequence > input.after).slice(0, 200) })), damaged: result.damaged } }
    }
  }
  const workspace = createWorkspaceIdentity(input.projectId, input.projectPath)
  switch (input.operation) {
    case 'workspace': return { enabled: true, workspace }
    case 'file-status': return { enabled: true, fileStatus: await projectFileStatus(input.projectPath) }
    case 'start': return { enabled: true, sessionId: await agent.start(workspace, input.adapter, input.prompt) }
    case 'resume': return { enabled: true, sessionId: await agent.resume(workspace, input.sessionId, input.prompt) }
    case 'generate': {
      const conversations = new LessonConversationRepository(app.getPath('userData'))
      const scope = input.lessonWorkspace
      const lesson = scope ? { schemaVersion: 1 as const, lessonId: scope.lessonId, normalizedDirectory: scope.normalizedDirectory } : undefined
      let epoch: number | undefined
      if (scope && lesson) {
        await new LessonWorkspaceService(app.getPath('userData')).read(lesson)
        const conversation = (await conversations.list({ kind: 'lesson', lesson })).records.find(record => record.conversationId === scope.conversationId)
        if (!conversation?.projectTarget || workspaceIdentityKey(conversation.projectTarget) !== workspaceIdentityKey(workspace)) throw new Error('当前对话未绑定此工程，请先完成首次保存绑定或新建另存目标对话')
        if (input.resumeSessionId && !conversation.sessionIds.includes(input.resumeSessionId)) throw new Error('恢复会话不属于当前课例对话')
        epoch = conversation.epoch
      }
      const sessionId = await agent.generate(workspace, input.adapter, lesson ? await refreshLessonRequest(lesson, input.request) : input.request, input.resumeSessionId, input.userMessage, scope)
      if (scope && lesson && epoch !== undefined) {
        try { await conversations.attachSession({ kind: 'lesson', lesson }, scope.conversationId, sessionId, epoch) }
        catch (error) { await agent.cancel(workspace, sessionId); throw error }
      }
      return { enabled: true, sessionId }
    }
    case 'continue': {
      const record = (await agent.list(workspace)).records.find(item => item.id === input.sessionId)
      const scope = record?.lessonWorkspace
      const current = scope ? await refreshLessonRequest({ schemaVersion: 1, lessonId: scope.lessonId, normalizedDirectory: scope.normalizedDirectory }, input.request) : input.request
      return { enabled: true, sessionId: await agent.continue(workspace, input.sessionId, current) }
    }
    case 'candidate': {
      const generationResult = await agent.candidate(workspace, input.sessionId)
      const records = (await agent.list(workspace)).records.filter(record => record.id === input.sessionId)
      return { enabled: true, generationResult, records }
    }
    case 'host-result': return { enabled: true, records: [await agent.hostResult(workspace, input.sessionId, input.result, input.commitReceipt)] }
    case 'cancel': await agent.cancel(workspace, input.sessionId); return { enabled: true }
    case 'input': return { enabled: true, inputDelivery: await agent.input(workspace, input.sessionId, input.input) }
    case 'delete': await agent.delete(workspace, input.sessionId); return { enabled: true }
    case 'list': {
      const result = await agent.list(workspace)
      return { enabled: true, records: result.records.map(record => ({ ...record, events: [] })), damaged: result.damaged }
    }
    case 'read': {
      const result = await agent.read(workspace, input.sessionId)
      return { enabled: true, records: result.records.map(record => ({ ...record, events: record.events.filter(event => event.sequence > input.after).slice(0, 200) })), damaged: result.damaged, fileStatus: await projectFileStatus(input.projectPath) }
    }
  }
}
export async function closeLocalAgents(): Promise<void> { await harness?.close() }
export function localAgentsRunning(): boolean { return harness?.running ?? false }

async function currentLessonTurn(lesson: Awaited<ReturnType<LessonWorkspaceService['read']>>, prompt: string): Promise<{ input: string; context: unknown }> {
  const current = await readCurrentLesson(lesson.identity, false)
  const input = `当前课例真实文件与实际材料读取记录如下；以本轮内容为准，不重放旧候选，不猜测教师已确认。\n${JSON.stringify(current.context)}\n教师请求：\n${prompt}`
  if (Buffer.byteLength(input) > 160000) throw new Error('当前教学文档超过单轮输入预算，请缩小本轮引用范围')
  return { input, context: current.context }
}
async function currentLessonPrompt(lesson: Awaited<ReturnType<LessonWorkspaceService['read']>>, prompt: string): Promise<string> {
  return (await currentLessonTurn(lesson, prompt)).input
}
export async function relocateLocalAgentLesson(previous: LessonIdentity, next: LessonIdentity): Promise<void> {
  const conversations = new LessonConversationRepository(app.getPath('userData'))
  const records = (await conversations.list({ kind: 'lesson', lesson: previous })).records
  harness = localAgentHarness()
  for (const conversation of records) {
    const oldScope = { version: 1 as const, kind: 'lesson' as const, lessonId: previous.lessonId, normalizedDirectory: previous.normalizedDirectory, conversationId: conversation.conversationId }
    for (const record of (await harness.list(oldScope)).records) if (record.status === 'running') await harness.cancel(record.workspace, record.id)
    await harness.repository.relocateLessonWorkspace(oldScope, { ...oldScope, normalizedDirectory: next.normalizedDirectory })
  }
}

/** 由会话归属构造该会话的 agent 作用域（F01：课例/工作空间/项目共用）。 */
export function conversationAgentScope(owner: ConversationOwner, conversationId: string): ConversationAgentWorkspace {
  return owner.kind === 'lesson'
    ? { version: 1, kind: 'lesson', lessonId: owner.lesson.lessonId, normalizedDirectory: owner.lesson.normalizedDirectory, conversationId }
    : { version: 1, kind: 'directory', normalizedDirectory: owner.kind === 'workspace' ? owner.workspaceRoot : owner.projectPath, conversationId }
}

export async function deleteLocalAgentConversationRecords(owner: ConversationOwner, conversationId?: string): Promise<void> {
  harness = localAgentHarness()
  const conversations = new LessonConversationRepository(app.getPath('userData'))
  const records = (await conversations.list(owner)).records.filter(record => !conversationId || record.conversationId === conversationId)
  for (const record of records) await conversations.delete(owner, record.conversationId, async () => {
    if (owner.kind === 'lesson') await invalidateLessonRecordOwners({ lesson: owner.lesson, conversationId: record.conversationId })
    else await invalidateLessonRecordOwners({ directoryConversation: { conversationId: record.conversationId, normalizedDirectory: conversationWorkingDirectory(owner) } })
    await harness!.delete(conversationAgentScope(owner, record.conversationId))
  })
}
/** @deprecated 兼容旧签名；新代码使用 deleteLocalAgentConversationRecords。 */
export async function deleteLocalAgentLessonRecords(lesson: LessonIdentity, conversationId?: string): Promise<void> {
  return deleteLocalAgentConversationRecords({ kind: 'lesson', lesson }, conversationId)
}

function readCurrentLesson(lesson: LessonIdentity, requireBuild: boolean) {
  const workspace = new LessonWorkspaceService(app.getPath('userData')), files = lessonDocumentFiles()
  const materials = new LessonMaterials(async target => { await workspace.read({ schemaVersion: 1, lessonId: target.lessonId, normalizedDirectory: target.rootPath }) })
  const deps = { workspace, files, materials }
  return readLessonGenerationContext(lesson, { ...deps, authoring: new LessonAuthoring(deps) }, requireBuild)
}
async function refreshLessonRequest(lesson: LessonIdentity, request: GenerationRequest): Promise<GenerationRequest> {
  const current = await readCurrentLesson(lesson, request.purpose === 'whole-course')
  // The pre-send explanation uses this same expansion, so it describes this payload and no other.
  //
  // It is NOT the final payload, though: the harness still appends task-context resources to the
  // request after this point — `harness.ts:313` and `:381-382` add `pending-host-results.json` /
  // `host-result.json` (raw `AiHostResult[]`, which may carry base64 PNG frames), `:374` adds
  // `observation/host-feedback.json`, and `:378` adds `repair/component-changes-<requestId>/…`.
  // Those never appear in the explanation. Do not claim the explanation is exhaustive; making it
  // so requires freezing the request after the session exists, inside the harness.
  return withLessonGenerationContext(request, current)
}

/** The teacher confirms the explanation, not the renderer's draft: this computes the
 * list from the same final request the send uses. Never writes anything. */
async function externalReferences(scope: ExternalReferencesScope): Promise<string[]> {
  if (scope.kind === 'generation') {
    const lesson = scope.lessonWorkspace
      ? { schemaVersion: 1 as const, lessonId: scope.lessonWorkspace.lessonId, normalizedDirectory: scope.lessonWorkspace.normalizedDirectory }
      : undefined
    return generationExternalReferences(lesson ? await refreshLessonRequest(lesson, scope.request) : scope.request)
  }
  const requested = scope.workspace
  const { owner } = await new LessonConversationRepository(app.getPath('userData')).requireOwned(requested)
  if (owner.kind !== 'lesson') return [`会话目录：${requested.normalizedDirectory}`, '应用内置课件方法：随提示词发送的当前版本方法文件']
  const lesson = await new LessonWorkspaceService(app.getPath('userData')).read(owner.lesson)
  const { context } = await currentLessonTurn(lesson, scope.prompt)
  return [`会话目录：${requested.normalizedDirectory}`, ...lessonContextReferences(context)]
}


/** Rebuilt from authoritative conversation records and human message events on every search. */
export async function searchLocalAgentConversations(owner: ConversationOwner, query: string): Promise<{ conversationId: string; excerpt: string }[]> {
  assertLocalAgentRecordsAvailable()
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return []
  const conversations = (await new LessonConversationRepository(app.getPath('userData')).list(owner)).records
  harness = localAgentHarness()
  const matches: { conversationId: string; excerpt: string }[] = []
  for (const conversation of conversations) {
    const texts = [conversation.title]
    const scope = conversationAgentScope(owner, conversation.conversationId)
    for (const record of (await harness.list(scope)).records) texts.push(...localAgentMessages(record.events).map(message => message.text))
    const text = texts.find(value => value.toLocaleLowerCase().includes(needle))
    if (text !== undefined) {
      const index = text.toLocaleLowerCase().indexOf(needle)
      matches.push({ conversationId: conversation.conversationId, excerpt: text.slice(Math.max(0, index - 40), index + needle.length + 100) })
    }
  }
  return matches
}
/** @deprecated 兼容旧签名；新代码使用 searchLocalAgentConversations。 */
export async function searchLocalAgentLessonConversations(lesson: LessonIdentity, query: string): Promise<{ conversationId: string; excerpt: string }[]> {
  return searchLocalAgentConversations({ kind: 'lesson', lesson }, query)
}

function normalizeFrozenTarget(target: FrozenEditTarget | undefined): FrozenEditTarget | undefined {
  if (!target) return undefined
  if (target.kind === 'directory') return { kind: 'directory', directory: normalizeWorkspacePath(target.directory) }
  if (target.kind === 'document') return { ...target, path: normalizeWorkspacePath(target.path) }
  return { ...target, path: normalizeWorkspacePath(target.path) }
}

export async function deleteAllLocalAgentApplicationRecords(): Promise<void> {
  assertLocalAgentRecordsAvailable()
  deletingApplicationRecords = true
  const repository = localAgentRepository()
  const conversations = new LessonConversationRepository(app.getPath('userData'))
  const owner = localAgentHarness()
  try {
    // Closing flips the global launch gate before awaiting in-flight work and invalidates running task epochs.
    const stopped = await Promise.allSettled([owner.close(), invalidateLessonRecordOwners({ all: true })])
    const failed = stopped.find(result => result.status === 'rejected')
    if (failed?.status === 'rejected') throw failed.reason
    const scopes = await repository.listStoredWorkspaces()
    for (const scope of scopes) await owner.delete(scope)
    for (const record of await conversations.listAll()) await conversations.delete(conversationOwnerOf(record), record.conversationId, async () => undefined)
    await repository.deleteAllStoredRecords()
    await conversations.clearAllRecords()
  } finally {
    // Closed native owners and all old candidate maps are never reused after this operation.
    sharedRepository = new LocalAgentRepository(app.getPath('userData'))
    harness = new LocalAgentHarness(sharedRepository)
    deletingApplicationRecords = false
  }
}
