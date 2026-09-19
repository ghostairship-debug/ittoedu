// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
const state = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({ app: { getPath: () => state.userData }, dialog: {} }))
vi.mock('../../src/main/localAgent/service', () => ({ assertLocalAgentRecordsAvailable: vi.fn() }))
import { operateLessonDesktop } from '../../src/main/lessonDesktopService'
import { LessonConversationRepository } from '../../src/main/localAgent/lessonConversationRepository'
import { createWorkspaceIdentity } from '../../src/main/workspaceIdentity'
import { defaultFrozenEditTarget, resolveSendFrozenTarget } from '../../src/shared/lessonWorkspace'

let root: string
beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'directory-identity-'))
  state.userData = path.join(root, 'app')
})
afterAll(async () => {
  if (!root || !path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe test root')
  await fs.rm(root, { recursive: true, force: true })
})

describe('directory conversation identity', () => {
  it('isolates same-name directory conversations and rejects cross-owner ids', async () => {
    const one = path.join(root, 'one', '课例')
    const two = path.join(root, 'two', '课例')
    await fs.mkdir(one, { recursive: true })
    await fs.mkdir(two, { recursive: true })
    const conversations = new LessonConversationRepository(state.userData)
    const ownerA = { kind: 'workspace' as const, workspaceRoot: createWorkspaceIdentity('w', one).normalizedPath }
    const ownerB = { kind: 'workspace' as const, workspaceRoot: createWorkspaceIdentity('w', two).normalizedPath }
    const a = await conversations.create(ownerA, '目录A')
    const b = await conversations.create(ownerB, '目录B')
    expect((await conversations.list(ownerA)).records.map(item => item.conversationId)).toEqual([a.conversationId])
    expect((await conversations.list(ownerB)).records.map(item => item.conversationId)).toEqual([b.conversationId])
    await expect(conversations.requireOwned({
      version: 1, kind: 'directory', normalizedDirectory: ownerA.workspaceRoot, conversationId: b.conversationId,
    })).rejects.toThrow('当前工作空间对话不存在，请重新打开')
    const owned = await conversations.requireOwned({
      version: 1, kind: 'directory', normalizedDirectory: ownerB.workspaceRoot, conversationId: b.conversationId,
    })
    expect(owned.conversation.conversationId).toBe(b.conversationId)
    expect(owned.owner).toEqual(ownerB)
  })

  it('locates a project conversation after the index is rebuilt', async () => {
    const workspace = path.join(root, 'ws')
    const project = path.join(workspace, '课题')
    await fs.mkdir(project, { recursive: true })
    const conversations = new LessonConversationRepository(state.userData)
    const owner = {
      kind: 'project' as const,
      workspaceRoot: createWorkspaceIdentity('w', workspace).normalizedPath,
      projectPath: createWorkspaceIdentity('w', project).normalizedPath,
    }
    const record = await conversations.create(owner, '项目会话')
    await fs.rm(path.join(state.userData, 'conversation-index-v1.json'), { force: true })
    const owned = await conversations.requireOwned({
      version: 1, kind: 'directory', normalizedDirectory: owner.projectPath, conversationId: record.conversationId,
    })
    expect(owned.owner).toEqual(owner)
    expect(owned.conversation.title).toBe('项目会话')
  })

  it('binds first save and Save As on a directory conversation without a lesson', async () => {
    const window = {} as BrowserWindow
    const workspace = path.join(root, 'save-root')
    await fs.mkdir(workspace, { recursive: true })
    const created = await operateLessonDesktop(window, {
      operation: 'create-conversation',
      owner: { kind: 'workspace', workspaceRoot: createWorkspaceIdentity('w', workspace).normalizedPath },
    })
    const conversation = created.conversation!
    expect(conversation.projectTarget).toBeUndefined()
    const firstPath = path.join(workspace, 'first.h5lesson')
    const savedAsPath = path.join(workspace, 'copy.h5lesson')
    await fs.writeFile(firstPath, 'first')
    await fs.writeFile(savedAsPath, 'copy')
    const first = await operateLessonDesktop(window, {
      operation: 'bind-project',
      owner: conversation.owner,
      conversationId: conversation.conversationId,
      projectId: 'first-project',
      projectPath: firstPath,
      saveAs: false,
    })
    expect(first.conversation!.conversationId).toBe(conversation.conversationId)
    expect(first.conversation!.epoch).toBe(1)
    expect(first.conversation!.projectTarget!.projectId).toBe('first-project')
    expect(first.lesson).toBeUndefined()
    const session = randomUUID()
    const repository = new LessonConversationRepository(state.userData)
    await repository.attachSession(conversation.owner!, conversation.conversationId, session, 1)
    const frozen = await repository.recordFrozenTarget(conversation.owner!, conversation.conversationId, defaultFrozenEditTarget(conversation.owner!))
    expect(frozen.lastFrozenTarget).toEqual(defaultFrozenEditTarget(conversation.owner!))
    const savedAs = await operateLessonDesktop(window, {
      operation: 'bind-project',
      owner: conversation.owner,
      conversationId: conversation.conversationId,
      projectId: 'copy-project',
      projectPath: savedAsPath,
      saveAs: true,
    })
    expect(savedAs.conversation!.conversationId).toBe(conversation.conversationId)
    expect(savedAs.conversation!.epoch).toBe(2)
    expect(savedAs.conversation!.projectTarget!.projectId).toBe('copy-project')
    expect(savedAs.conversation!.sessionIds).toEqual([session])
    await expect(repository.attachSession(conversation.owner!, conversation.conversationId, randomUUID(), 1)).rejects.toThrow('失效')
  })

  it('does not reuse a previous frozen target as an invisible lock', () => {
    const owner = { kind: 'workspace' as const, workspaceRoot: '/workspace/a' }
    const previous = { kind: 'document' as const, path: '/workspace/a/notes.md', version: 'v1' }
    expect(resolveSendFrozenTarget(undefined, owner)).toEqual(defaultFrozenEditTarget(owner))
    expect(resolveSendFrozenTarget(previous, owner)).toEqual(previous)
  })
})
