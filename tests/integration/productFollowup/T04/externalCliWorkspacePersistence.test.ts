// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { DocumentHostService } from '../../../../src/main/workbench/DocumentHostService'
import { residentMcpFixture, type ResidentToolReply } from '../../../helpers/residentMcpFixture'

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

// Current public schemas expose the business fields directly in MCP arguments.
// The historical helper's additional { arguments: ... } envelope is not part of them.
async function callTool(client: Client, name: string, args: Record<string, unknown> = {}): Promise<ResidentToolReply> {
  return await client.callTool({ name, arguments: args }) as unknown as ResidentToolReply
}

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'T04-cli-workspace-'))
  cleanups.push(() => fs.rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 }))
  const workspaceA = path.join(directory, 'teacher-workspace')
  const workspaceB = path.join(directory, 'gui-managed-workspace')
  await fs.mkdir(workspaceA); await fs.mkdir(workspaceB)
  await fs.writeFile(path.join(workspaceA, 'notes.md'), 'Teacher A original')
  await fs.writeFile(path.join(workspaceB, 'notes.md'), 'GUI B original')
  const host = new DocumentHostService(path.join(directory, 'documents'))
  const f = await residentMcpFixture({ host, directory, workspaceRoot: workspaceA })
  cleanups.push(f.close)
  await f.conversations.registerWorkspace({ workspaceId: 'managed-b', rootPath: workspaceB, managed: true, authorization: 'managed' })
  return { ...f, host, workspaceA: await fs.realpath(workspaceA), workspaceB: await fs.realpath(workspaceB) }
}

const data = (reply: Awaited<ReturnType<typeof callTool>>) => {
  expect(reply.isError, JSON.stringify(reply.structuredContent?.result)).toBe(false)
  return reply.structuredContent.result.data
}

// Only the uiState report is supplied by this fixture. HTTP, sessions, handles,
// canonical edits and file authorization all use the production services.
it('an explicit CLI workspace remains the connection and new-session default after the GUI reports a managed workspace', async () => {
  const f = await fixture()
  await f.service.setInitialWorkspace('space')
  const first = await f.connect('CLI before GUI')
  expect(data(await callTool(first, 'workspace.list')).current).toBe('space')
  f.ui.state = { workspaceId: 'managed-b' }
  expect(await f.service.connectionInfo()).toMatchObject({ workspaceId: 'space', workspace: f.workspaceA })
  const afterPromotion = await f.connect('CLI after GUI')
  expect(data(await callTool(afterPromotion, 'workspace.list')).current).toBe('space')
  expect(JSON.stringify(data(await callTool(afterPromotion, 'file.read', { path: 'notes.md' })))).toContain('Teacher A original')
  expect(JSON.stringify(data(await callTool(first, 'file.read', { path: 'notes.md' })))).toContain('Teacher A original')
})

it('an explicit session switch changes only that session and revokes its old handles while peer and future sessions retain CLI workspace A', async () => {
  const f = await fixture()
  await f.service.setInitialWorkspace('space')
  const switching = await f.connect('Switching client'), peer = await f.connect('Peer A')
  const opened = data(await callTool(switching, 'file.open', { path: 'notes.md' }))
  const peerOpened = data(await callTool(peer, 'file.open', { path: 'notes.md' }))
  expect(peerOpened.documentId).toBe(opened.documentId)
  const peerRange = data(await callTool(peer, 'listChildren', { target: peerOpened.target }))[0].target
  f.ui.state = { workspaceId: 'managed-b' }
  expect(data(await callTool(switching, 'workspace.switch', { workspaceId: 'managed-b' }))).toMatchObject({ workspaceId: 'managed-b', rootPath: f.workspaceB })
  const switchedOpened = data(await callTool(switching, 'file.open', { path: 'notes.md' }))
  expect(switchedOpened.documentId).not.toBe(opened.documentId)
  data(await callTool(switching, 'read', { target: switchedOpened.target }))
  expect((await callTool(switching, 'read', { target: opened.target })).isError).toBe(true)
  expect(JSON.stringify(data(await callTool(switching, 'file.read', { path: 'notes.md' })))).toContain('GUI B original')
  data(await callTool(switching, 'file.write', { mode: 'create', path: 'switched.md', content: 'Only B receives this write' }))
  expect(await fs.readFile(path.join(f.workspaceB, 'switched.md'), 'utf8')).toBe('Only B receives this write')
  await expect(fs.stat(path.join(f.workspaceA, 'switched.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  const changed = await callTool(peer, 'text.replace', { target: peerRange, content: 'Peer A still writable' })
  expect(changed.structuredContent.result).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  expect(f.host.registry.get(peerOpened.documentId).read().model).toMatchObject({ source: 'Peer A still writable' })
  expect(data(await callTool(peer, 'workspace.list')).current).toBe('space')
  expect(await f.service.connectionInfo()).toMatchObject({ workspaceId: 'space', workspace: f.workspaceA })
  const later = await f.connect('Later default A')
  expect(data(await callTool(later, 'workspace.list')).current).toBe('space')
  const laterOpened = data(await callTool(later, 'file.open', { path: 'notes.md' }))
  expect(laterOpened.documentId).toBe(peerOpened.documentId)
  expect(data(await callTool(switching, 'workspace.list')).current).toBe('managed-b')
})

it('a GUI-only owner without an explicit CLI workspace retains the foreground managed workspace default', async () => {
  const f = await fixture()
  f.ui.state = { workspaceId: 'managed-b' }
  expect(await f.service.connectionInfo()).toMatchObject({ workspaceId: 'managed-b', workspace: f.workspaceB })
  const client = await f.connect('GUI-only client')
  expect(data(await callTool(client, 'workspace.list')).current).toBe('managed-b')
  expect(JSON.stringify(data(await callTool(client, 'file.read', { path: 'notes.md' })))).toContain('GUI B original')
})
