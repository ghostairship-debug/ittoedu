// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConversationStore } from '../../src/main/workbench/conversations/ConversationStore'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe fixture root')
    await fs.rm(root, { recursive: true, force: true })
  }
})
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-conversations-'))
  roots.push(directory)
  let time = 100
  const store = new ConversationStore({ directory, now: () => ++time, createId: () => 'generated-conversation' })
  const workspace = await store.registerWorkspace({ workspaceId: 'space-a', rootPath: 'C:/teaching/a', managed: false, authorization: 'user-selected' })
  return { directory, store, workspace }
}

describe('G20 S10 durable conversation metadata', () => {
  it('assigns a home only to an empty new conversation and follows real location changes without moving its owner', async () => {
    const { directory, store } = await fixture()
    await store.registerWorkspace({ workspaceId: 'space-b', rootPath: 'C:/teaching/b', managed: false, authorization: 'user-selected' })
    const created = await store.createConversation({ workspaceId: 'space-a' })
    const home = await store.setConversationHome({ workspaceId: 'space-a', conversationId: created.conversationId,
      home: { kind: 'file', path: 'unit/note.md' } })
    expect(home.revision).toBe(created.revision)
    expect(await store.setConversationHome({ workspaceId: 'space-a', conversationId: created.conversationId,
      home: { kind: 'file', path: 'unit/note.md' } })).toEqual(home)
    await expect(store.setConversationHome({ workspaceId: 'space-a', conversationId: created.conversationId,
      home: { kind: 'file', path: 'other.md' } })).rejects.toMatchObject({ code: 'home-conflict' })
    const written = await store.updateConversation({ workspaceId: 'space-a', conversationId: created.conversationId,
      expectedRevision: home.revision, patch: { inputDraft: 'teacher draft' } })
    await expect(store.setConversationHome({ workspaceId: 'space-a', conversationId: created.conversationId,
      home: { kind: 'file', path: 'unit/note.md' } })).resolves.toEqual(written)
    await store.relocateHomes({ workspaceId: 'space-a', changes: [{ from: 'unit', to: 'renamed' }] })
    await store.relocateHomes({ workspaceId: 'space-a', changes: [{ from: 'renamed/note.md', to: 'moved/note.md', targetWorkspaceId: 'space-b' }] })
    const moved = await store.readConversation({ workspaceId: 'space-a', conversationId: created.conversationId })
    expect(moved).toMatchObject({ workspaceId: 'space-a', home: { kind: 'file', path: 'moved/note.md', workspaceId: 'space-b' } })
    await store.relocateHomes({ workspaceId: 'space-b', changes: [{ from: 'moved/note.md', to: null }] })
    await store.relocateHomes({ workspaceId: 'space-b', changes: [{ from: 'moved', to: 'renamed-again' }] })
    const missing = await store.readConversation({ workspaceId: 'space-a', conversationId: created.conversationId })
    expect(missing?.home).toMatchObject({ kind: 'file', path: 'renamed-again/note.md', workspaceId: 'space-b', missing: true })
    expect((await new ConversationStore({ directory }).listConversations('space-a'))[0]?.home).toEqual(missing?.home)
  })

  it('keeps stable space identity separate from its root binding and keeps conversations orthogonal to files across restart', async () => {
    const { directory, store, workspace } = await fixture()
    const conversation = await store.createConversation({ workspaceId: workspace.workspaceId, title: '讨论', inputDraft: '未发送输入' })
    const updated = await store.updateConversation({
      workspaceId: workspace.workspaceId, conversationId: conversation.conversationId, expectedRevision: conversation.revision,
      patch: { attachmentIds: ['asset-1'], frozenContextRefs: [{ contextRefId: 'ctx-1', documentId: 'document-a', revision: 0, epoch: 'epoch-a', selectionId: 'selection-a' }] },
    })
    await store.registerWorkspace({ workspaceId: 'space-b', rootPath: 'C:/teaching/b', managed: false, authorization: 'user-selected' })
    const rebound = await store.rebindWorkspaceRoot({ workspaceId: workspace.workspaceId, expectedRevision: workspace.revision, rootPath: 'D:/moved/a' })
    expect(rebound).toMatchObject({ workspaceId: 'space-a', rootPath: 'D:/moved/a', revision: 2 })
    expect(updated).toMatchObject({ workspaceId: 'space-a', inputDraft: '未发送输入', attachmentIds: ['asset-1'] })

    const reopened = new ConversationStore({ directory })
    expect(await reopened.readWorkspace('space-a')).toMatchObject({ workspaceId: 'space-a', rootPath: 'D:/moved/a' })
    expect(await reopened.listConversations('space-a')).toEqual([updated])
    expect(await reopened.readConversation({ workspaceId: 'space-b', conversationId: updated.conversationId })).toBeNull()
    expect(await reopened.readConversation({ workspaceId: 'space-a', conversationId: updated.conversationId })).toEqual(updated)
    expect(await reopened.listWorkspaces()).toEqual([
      expect.objectContaining({ workspaceId: 'space-a', rootPath: 'D:/moved/a', revision: 2 }),
      expect.objectContaining({ workspaceId: 'space-b', rootPath: 'C:/teaching/b', revision: 1 }),
    ])
  })

  it('persists only acknowledged revisions and rejects a stale draft instead of overwriting newer context', async () => {
    const { directory, store, workspace } = await fixture()
    const conversation = await store.createConversation({ workspaceId: workspace.workspaceId, inputDraft: 'first draft' })
    const current = await store.updateConversation({
      workspaceId: workspace.workspaceId, conversationId: conversation.conversationId, expectedRevision: conversation.revision,
      patch: { inputDraft: 'new draft', runIndex: { builtinRunIds: ['run-1'], externalRunIds: [], externalPortIds: [] } },
    })
    await expect(store.updateConversation({
      workspaceId: workspace.workspaceId, conversationId: conversation.conversationId, expectedRevision: conversation.revision,
      patch: { inputDraft: 'stale draft' },
    })).rejects.toMatchObject({ code: 'revision-conflict' })
    await expect(store.updateConversation({
      workspaceId: workspace.workspaceId, conversationId: conversation.conversationId, expectedRevision: current.revision,
      patch: { inputDraft: 'cannot inject a credential field', providerCredential: 'forbidden' } as never,
    })).rejects.toThrow('未声明字段')
    const reopened = new ConversationStore({ directory })
    expect(await reopened.readConversation({ workspaceId: workspace.workspaceId, conversationId: conversation.conversationId })).toEqual(current)
  })

  it('does not pretend deletion succeeded when revocation fails, and never deletes user files', async () => {
    const { directory, store, workspace } = await fixture()
    const userFile = path.join(directory, 'teacher-source.md')
    await fs.writeFile(userFile, 'teacher content')
    const conversation = await store.createConversation({ workspaceId: workspace.workspaceId })
    const indexed = await store.updateConversation({
      workspaceId: workspace.workspaceId, conversationId: conversation.conversationId, expectedRevision: conversation.revision,
      patch: {
        attachmentIds: ['managed-asset'], frozenContextRefs: [{ contextRefId: 'managed-context', documentId: 'doc', revision: 3, epoch: 'epoch' }],
        runIndex: { builtinRunIds: ['builtin-run'], externalRunIds: ['external-run'], externalPortIds: ['port-1'] },
      },
    })
    const stopBuiltinRuns = vi.fn(async () => undefined)
    const revokeExternalPorts = vi.fn(async () => { throw new Error('bridge still active') })
    await expect(store.deleteConversation({ workspaceId: workspace.workspaceId, conversationId: indexed.conversationId, expectedRevision: indexed.revision,
      ports: { stopBuiltinRuns, revokeExternalPorts } })).rejects.toThrow('bridge still active')
    expect(stopBuiltinRuns).toHaveBeenCalledBefore(revokeExternalPorts)
    expect(await store.readConversation({ workspaceId: workspace.workspaceId, conversationId: indexed.conversationId })).toEqual(indexed)
    expect(await fs.readFile(userFile, 'utf8')).toBe('teacher content')

    const released = await store.deleteConversation({ workspaceId: workspace.workspaceId, conversationId: indexed.conversationId, expectedRevision: indexed.revision,
      ports: { stopBuiltinRuns: async () => undefined, revokeExternalPorts: async () => undefined } })
    expect(released).toEqual({ attachmentIds: ['managed-asset'], contextRefIds: ['managed-context'], builtinRunIds: ['builtin-run'], externalRunIds: ['external-run'], externalPortIds: ['port-1'] })
    expect(await store.readConversation({ workspaceId: workspace.workspaceId, conversationId: indexed.conversationId })).toBeNull()
    expect(await fs.readFile(userFile, 'utf8')).toBe('teacher content')
  })
})
