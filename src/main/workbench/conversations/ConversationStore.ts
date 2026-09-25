import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { inputAttachmentReferenceSchema } from '../../../shared/workbench/attachments'
import {
  CONVERSATION_STORE_SCHEMA_VERSION,
  type ConversationDeletionPorts,
  type ConversationHome,
  type ConversationMessage,
  type ConversationPatch,
  type ConversationRecord,
  type ConversationRunIndex,
  type ConversationStoreState,
  type FrozenConversationContextRef,
  type ReleasedConversationReferences,
  type WorkspaceRecord,
  rebaseHome,
  validConversationHome,
} from '../../../shared/workbench/conversations'

const MAX_ID = 256
const MAX_TEXT = 1024 * 1024
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'

function clone<T>(value: T): T { return structuredClone(value) }
function validId(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID }
function validText(value: unknown, maximum = MAX_TEXT): value is string { return typeof value === 'string' && value.length <= maximum }
function validRootPath(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 32767 }
function validTime(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 }
function validRevision(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 }
function validDocumentRevision(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 }
function uniqueIds(values: readonly string[]): boolean { return values.every(validId) && new Set(values).size === values.length }
function validMessage(value: unknown): value is ConversationMessage {
  if (!value || typeof value !== 'object') return false
  const item = value as ConversationMessage
  return validId(item.messageId) && ['user', 'assistant', 'system', 'tool'].includes(item.role) && validText(item.text)
    && validTime(item.createdAt) && Array.isArray(item.attachmentIds) && uniqueIds(item.attachmentIds)
    && (item.runId === undefined || validId(item.runId))
}
function validContextRef(value: unknown): value is FrozenConversationContextRef {
  if (!value || typeof value !== 'object') return false
  const item = value as FrozenConversationContextRef
  return validId(item.contextRefId) && validId(item.documentId) && validDocumentRevision(item.revision) && validId(item.epoch)
    && (item.selectionId === undefined || validId(item.selectionId))
}
function validRunIndex(value: unknown): value is ConversationRunIndex {
  if (!value || typeof value !== 'object') return false
  const item = value as ConversationRunIndex
  return ['builtinRunIds', 'externalRunIds', 'externalPortIds'].every(key => Array.isArray(item[key as keyof ConversationRunIndex]) && uniqueIds(item[key as keyof ConversationRunIndex]))
}
function validWorkspace(value: unknown, workspaceId: string): value is WorkspaceRecord {
  if (!value || typeof value !== 'object') return false
  const item = value as WorkspaceRecord
  return item.workspaceId === workspaceId && validId(item.workspaceId) && validRootPath(item.rootPath)
    && typeof item.managed === 'boolean' && (item.authorization === 'user-selected' || item.authorization === 'managed')
    && validRevision(item.revision) && validTime(item.createdAt) && validTime(item.updatedAt)
}
function validConversation(value: unknown, conversationId: string): value is ConversationRecord {
  if (!value || typeof value !== 'object') return false
  const item = value as ConversationRecord
  return item.conversationId === conversationId && validId(item.conversationId) && validId(item.workspaceId) && validText(item.title, 1024)
    && Array.isArray(item.messages) && item.messages.every(validMessage) && new Set(item.messages.map(message => message.messageId)).size === item.messages.length
    && Array.isArray(item.attachmentIds) && uniqueIds(item.attachmentIds) && validRunIndex(item.runIndex)
    && validText(item.inputDraft) && Array.isArray(item.frozenContextRefs) && item.frozenContextRefs.every(validContextRef)
    && Array.isArray(item.inputAttachments) && item.inputAttachments.length <= 1000 && item.inputAttachments.every(ref => inputAttachmentReferenceSchema.safeParse(ref).success)
    && new Set(item.inputAttachments.map(ref => `${ref.attachmentId}:${ref.representationId}`)).size === item.inputAttachments.length
    && new Set(item.frozenContextRefs.map(reference => reference.contextRefId)).size === item.frozenContextRefs.length
    && (item.home === undefined || validConversationHome(item.home))
    && validRevision(item.revision) && validTime(item.createdAt) && validTime(item.updatedAt)
}
function emptyState(): ConversationStoreState { return { schemaVersion: CONVERSATION_STORE_SCHEMA_VERSION, workspaces: {}, conversations: {} } }
function validState(value: unknown): value is ConversationStoreState {
  if (!value || typeof value !== 'object') return false
  const state = value as ConversationStoreState
  return state.schemaVersion === CONVERSATION_STORE_SCHEMA_VERSION && !!state.workspaces && typeof state.workspaces === 'object'
    && !!state.conversations && typeof state.conversations === 'object'
    && Object.entries(state.workspaces).every(([workspaceId, item]) => validWorkspace(item, workspaceId))
    && Object.entries(state.conversations).every(([conversationId, item]) => validConversation(item, conversationId))
    && Object.values(state.conversations).every(conversation => !!state.workspaces[conversation.workspaceId])
}
async function syncDirectory(directory: string) {
  if (process.platform === 'win32') return
  const handle = await fs.open(directory, 'r')
  try { await handle.sync() } finally { await handle.close() }
}

export class ConversationStoreError extends Error {
  constructor(readonly code: 'workspace-not-found' | 'conversation-not-found' | 'revision-conflict' | 'store-corrupt' | 'identity-conflict' | 'home-conflict', message: string) {
    super(message); this.name = 'ConversationStoreError'
  }
}

export interface ConversationStoreOptions {
  directory: string
  createId?: () => string
  now?: () => number
}

/**
 * Owns only app-managed space/conversation records. It does not read old chat
 * caches, execute runs on restore, own document bytes, or touch user files.
 */
export class ConversationStore {
  private tail: Promise<unknown> = Promise.resolve()
  private readonly directory: string
  private readonly filename: string
  private readonly createId: () => string
  private readonly now: () => number

  constructor(options: ConversationStoreOptions) {
    this.directory = path.resolve(options.directory)
    this.filename = path.join(this.directory, 'conversations-v2.json')
    this.createId = options.createId ?? randomUUID
    this.now = options.now ?? Date.now
  }

  private serial<T>(action: () => Promise<T>): Promise<T> {
    const operation = this.tail.catch(() => undefined).then(action)
    this.tail = operation
    return operation
  }
  private async readState(): Promise<ConversationStoreState> {
    let contents: string
    try { contents = await fs.readFile(this.filename, 'utf8') }
    catch (error) { if (missing(error)) return emptyState(); throw error }
    let parsed: unknown
    try { parsed = JSON.parse(contents) } catch { throw new ConversationStoreError('store-corrupt', '会话存储无法解析') }
    if (!validState(parsed)) throw new ConversationStoreError('store-corrupt', '会话存储不符合当前合同')
    return clone(parsed)
  }
  private async writeState(state: ConversationStoreState): Promise<void> {
    if (!validState(state)) throw new ConversationStoreError('store-corrupt', '拒绝写入无效会话记录')
    await fs.mkdir(this.directory, { recursive: true })
    const temporary = path.join(this.directory, `.conversations-v2.${randomUUID()}.tmp`)
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined
    try {
      handle = await fs.open(temporary, 'wx')
      await handle.writeFile(JSON.stringify(state))
      await handle.sync()
      await handle.close(); handle = undefined
      await fs.rename(temporary, this.filename)
      await syncDirectory(this.directory)
    } finally {
      await handle?.close().catch(() => undefined)
      await fs.rm(temporary, { force: true }).catch(() => undefined)
    }
  }
  private workspace(state: ConversationStoreState, workspaceId: string): WorkspaceRecord {
    const value = state.workspaces[workspaceId]
    if (!value) throw new ConversationStoreError('workspace-not-found', '工作空间不存在')
    return value
  }
  private conversation(state: ConversationStoreState, workspaceId: string, conversationId: string): ConversationRecord {
    this.workspace(state, workspaceId)
    const value = state.conversations[conversationId]
    if (!value || value.workspaceId !== workspaceId) throw new ConversationStoreError('conversation-not-found', '当前工作空间中不存在该会话')
    return value
  }
  private assertExpected(actual: number, expected: number) {
    if (!validRevision(expected) || actual !== expected) throw new ConversationStoreError('revision-conflict', '会话已被较新的草稿或操作更新')
  }

  registerWorkspace(input: { workspaceId: string; rootPath: string; managed: boolean; authorization: WorkspaceRecord['authorization'] }): Promise<WorkspaceRecord> {
    return this.serial(async () => {
      if (!validId(input.workspaceId) || !validRootPath(input.rootPath) || typeof input.managed !== 'boolean'
        || (input.authorization !== 'user-selected' && input.authorization !== 'managed')) throw new TypeError('工作空间身份或根路径无效')
      const state = await this.readState(), existing = state.workspaces[input.workspaceId]
      if (existing) {
        if (existing.rootPath !== input.rootPath || existing.managed !== input.managed || existing.authorization !== input.authorization) throw new ConversationStoreError('identity-conflict', '稳定工作空间身份已绑定到不同根路径或管理方式')
        return clone(existing)
      }
      const time = this.now(), workspace: WorkspaceRecord = {
        workspaceId: input.workspaceId, rootPath: input.rootPath, managed: input.managed, authorization: input.authorization,
        revision: 1, createdAt: time, updatedAt: time,
      }
      state.workspaces[workspace.workspaceId] = workspace
      await this.writeState(state)
      return clone(workspace)
    })
  }
  rebindWorkspaceRoot(input: { workspaceId: string; expectedRevision: number; rootPath: string }): Promise<WorkspaceRecord> {
    return this.serial(async () => {
      if (!validRootPath(input.rootPath)) throw new TypeError('工作空间根路径无效')
      const state = await this.readState(), previous = this.workspace(state, input.workspaceId)
      this.assertExpected(previous.revision, input.expectedRevision)
      const next: WorkspaceRecord = { ...previous, rootPath: input.rootPath, revision: previous.revision + 1, updatedAt: this.now() }
      state.workspaces[input.workspaceId] = next
      await this.writeState(state)
      return clone(next)
    })
  }
  readWorkspace(workspaceId: string): Promise<WorkspaceRecord | null> {
    return this.serial(async () => clone((await this.readState()).workspaces[workspaceId] ?? null))
  }
  /** Read-only identity lookup for canonical root registration; callers compare rootPath themselves. */
  listWorkspaces(): Promise<WorkspaceRecord[]> {
    return this.serial(async () => Object.values((await this.readState()).workspaces)
      .sort((a, b) => b.updatedAt - a.updatedAt || a.workspaceId.localeCompare(b.workspaceId)).map(clone))
  }
  createConversation(input: { workspaceId: string; conversationId?: string; title?: string; inputDraft?: string; home?: ConversationHome }): Promise<ConversationRecord> {
    return this.serial(async () => {
      const state = await this.readState(); this.workspace(state, input.workspaceId)
      const conversationId = input.conversationId ?? this.createId()
      if (!validId(conversationId)) throw new TypeError('会话身份无效')
      if (state.conversations[conversationId]) throw new ConversationStoreError('identity-conflict', '会话身份已存在')
      const title = input.title ?? '', inputDraft = input.inputDraft ?? ''
      if (!validText(title, 1024) || !validText(inputDraft)) throw new TypeError('会话标题或草稿无效')
      if (input.home !== undefined && (!validConversationHome(input.home) || input.home.missing)) throw new TypeError('会话所属位置无效')
      const time = this.now(), record: ConversationRecord = {
        conversationId, workspaceId: input.workspaceId, title, messages: [], attachmentIds: [],
        runIndex: { builtinRunIds: [], externalRunIds: [], externalPortIds: [] }, inputDraft, inputAttachments: [], frozenContextRefs: [],
        ...(input.home ? { home: { kind: input.home.kind, path: input.home.path } } : {}),
        revision: 1, createdAt: time, updatedAt: time,
      }
      state.conversations[conversationId] = record
      await this.writeState(state)
      return clone(record)
    })
  }
  readConversation(input: { workspaceId: string; conversationId: string }): Promise<ConversationRecord | null> {
    return this.serial(async () => {
      const state = await this.readState(); this.workspace(state, input.workspaceId)
      const record = state.conversations[input.conversationId]
      return clone(record?.workspaceId === input.workspaceId ? record : null)
    })
  }
  listConversations(workspaceId: string): Promise<ConversationRecord[]> {
    return this.serial(async () => {
      const state = await this.readState(); this.workspace(state, workspaceId)
      return Object.values(state.conversations).filter(record => record.workspaceId === workspaceId).sort((a, b) => b.updatedAt - a.updatedAt || a.conversationId.localeCompare(b.conversationId)).map(clone)
    })
  }
  updateConversation(input: { workspaceId: string; conversationId: string; expectedRevision: number; patch: ConversationPatch }): Promise<ConversationRecord> {
    return this.serial(async () => {
      const state = await this.readState(), previous = this.conversation(state, input.workspaceId, input.conversationId)
      this.assertExpected(previous.revision, input.expectedRevision)
      const patch = clone(input.patch)
      const knownPatchKeys = ['title', 'messages', 'attachmentIds', 'runIndex', 'inputDraft', 'inputAttachments', 'frozenContextRefs']
      if (Object.keys(patch).some(key => !knownPatchKeys.includes(key))) throw new TypeError('会话更新包含未声明字段')
      const next: ConversationRecord = {
        ...previous,
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.messages !== undefined ? { messages: patch.messages } : {}),
        ...(patch.attachmentIds !== undefined ? { attachmentIds: patch.attachmentIds } : {}),
        ...(patch.runIndex !== undefined ? { runIndex: patch.runIndex } : {}),
        ...(patch.inputDraft !== undefined ? { inputDraft: patch.inputDraft } : {}),
        ...(patch.inputAttachments !== undefined ? { inputAttachments: patch.inputAttachments } : {}),
        ...(patch.frozenContextRefs !== undefined ? { frozenContextRefs: patch.frozenContextRefs } : {}),
        revision: previous.revision + 1, updatedAt: this.now(),
      }
      if (!validConversation(next, next.conversationId)) throw new TypeError('会话更新不符合合同')
      state.conversations[next.conversationId] = next
      await this.writeState(state)
      return clone(next)
    })
  }
  /** Assign a newly empty conversation once. The serialized check prevents a late explorer click from moving an active task. */
  setConversationHome(input: { workspaceId: string; conversationId: string; home: ConversationHome | null }): Promise<ConversationRecord> {
    return this.serial(async () => {
      const state = await this.readState(), previous = this.conversation(state, input.workspaceId, input.conversationId)
      if (input.home !== null && (!validConversationHome(input.home) || input.home.missing)) throw new TypeError('会话所属位置无效')
      if (JSON.stringify(previous.home ?? null) === JSON.stringify(input.home)) return clone(previous)
      const empty = !previous.title && !previous.inputDraft && !previous.messages.length && !previous.attachmentIds.length
        && !previous.inputAttachments.length && !previous.frozenContextRefs.length
        && !previous.runIndex.builtinRunIds.length && !previous.runIndex.externalRunIds.length && !previous.runIndex.externalPortIds.length
      if (!empty || previous.home || !input.home) throw new ConversationStoreError('home-conflict', '已有内容或所属位置的会话不会自动改归属')
      const next: ConversationRecord = { ...previous, home: { kind: input.home.kind, path: input.home.path } }
      state.conversations[next.conversationId] = next
      await this.writeState(state)
      return clone(next)
    })
  }
  /** Follow in-app renames/moves (`to` a path) and removals (`to` null) under this workspace; returns the changed conversations. */
  relocateHomes(input: { workspaceId: string; changes: readonly { from: string; to: string | null; targetWorkspaceId?: string }[] }): Promise<string[]> {
    return this.serial(async () => {
      const state = await this.readState(); this.workspace(state, input.workspaceId)
      const changed: string[] = []
      for (const record of Object.values(state.conversations)) {
        if (!record.home || (record.home.workspaceId ?? record.workspaceId) !== input.workspaceId) continue
        let home: ConversationHome = record.home
        for (const change of input.changes) {
          const moved = rebaseHome(home, change.from, change.to ?? change.from)
          if (moved) {
            if (change.targetWorkspaceId && change.targetWorkspaceId !== input.workspaceId) {
              if (!state.workspaces[change.targetWorkspaceId]) throw new ConversationStoreError('workspace-not-found', '移动目标工作空间不存在')
            }
            const targetWorkspaceId = change.targetWorkspaceId ?? input.workspaceId
            const { workspaceId: _previousLocation, ...atTarget } = moved
            home = change.to === null ? { ...home, missing: true }
              : { ...atTarget, ...(targetWorkspaceId !== record.workspaceId ? { workspaceId: targetWorkspaceId } : {}) }
          }
        }
        if (JSON.stringify(home) === JSON.stringify(record.home)) continue
        if (!validConversationHome(home)) continue
        state.conversations[record.conversationId] = { ...record, home }
        changed.push(record.conversationId)
      }
      if (changed.length) await this.writeState(state)
      return changed
    })
  }
  deleteConversation(input: { workspaceId: string; conversationId: string; expectedRevision: number; ports: ConversationDeletionPorts }): Promise<ReleasedConversationReferences> {
    return this.serial(async () => {
      const state = await this.readState(), record = this.conversation(state, input.workspaceId, input.conversationId)
      this.assertExpected(record.revision, input.expectedRevision)
      // Both barriers precede the durable delete. A failing barrier leaves this record intact.
      await input.ports.stopBuiltinRuns({ workspaceId: record.workspaceId, conversationId: record.conversationId, runIds: clone(record.runIndex.builtinRunIds) })
      await input.ports.revokeExternalPorts({ workspaceId: record.workspaceId, conversationId: record.conversationId, portIds: clone(record.runIndex.externalPortIds) })
      await input.ports.prepareResourceRelease?.({ workspaceId: record.workspaceId, conversationId: record.conversationId,
        runIds: [...record.runIndex.builtinRunIds, ...record.runIndex.externalRunIds] })
      delete state.conversations[record.conversationId]
      await this.writeState(state)
      return {
        attachmentIds: clone(record.attachmentIds), contextRefIds: record.frozenContextRefs.map(reference => reference.contextRefId),
        builtinRunIds: clone(record.runIndex.builtinRunIds), externalRunIds: clone(record.runIndex.externalRunIds), externalPortIds: clone(record.runIndex.externalPortIds),
      }
    })
  }
}
