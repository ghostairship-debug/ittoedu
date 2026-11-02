// @vitest-environment node
import { afterEach, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ConversationStore } from '../../src/main/workbench/conversations/ConversationStore'
import { ExternalMcpService } from '../../src/main/workbench/external/ExternalMcpService'
import type { ResidentMcpCall } from '../../src/main/workbench/external/ResidentMcpServer'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { openCourseProjectV10Archive } from '../../src/core/drivers/codecs/courseProjectV10Archive'
import { DocumentDeliveryService } from '../../src/main/workbench/delivery/DocumentDeliveryService'
import { DocumentDeliveryOperationStore } from '../../src/main/workbench/delivery/DocumentDeliveryOperationStore'
import { resolveSaveDestination } from '../../src/main/workbench/workbenchDeliveryAdapters'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
const call = (name: string, args: Record<string, unknown> = {}): ResidentMcpCall => ({ requestId: 1, method: 'tools/call',
  params: { name, arguments: args }, delivery: Promise.resolve(true), notify: () => undefined })
type Reply = { isError: boolean; structuredContent: { result: any } }

it('announces managed capabilities before the prompt without granting read-only, stopped or revoked operations', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'acp-real-host-catalog-'))
  cleanups.push(async () => { await fs.rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 }) })
  const workspace = path.join(directory, 'workspace')
  await fs.mkdir(workspace)
  const host = new DocumentHostService(path.join(directory, 'documents'))
  const deliveries = new DocumentDeliveryService({
    documents: { read: id => host.registry.get(id).drain(), saveWithFact: (...args) => host.saveWithFact(...args),
      lookupSave: (...args) => host.lookupSave(...args),
      withFileLease: (id, work) => host.registry.get(id).withFileLease(lease => work(() => lease.read())) },
    operations: new DocumentDeliveryOperationStore(path.join(directory, 'deliveries')),
    authorize: async () => {},
    resolveSaveDestination: ({ runId, snapshot, requested }) => resolveSaveDestination(runId, snapshot, requested, id => host.tools.runFileAccess(id)),
    resolveExportDestination: async () => { throw new Error('No export requested') },
    build: { build: async () => { throw new Error('No export requested') } },
    writer: { writeNew: async () => { throw new Error('No export requested') }, inspect: async () => null },
  })
  host.tools.configureHostServices({ deliveries })
  const initial = await host.internalAPI.create({ kind: 'course-v10', project: createBlankCourseProjectV10('Before'),
    resources: { assets: {}, components: {} } }, 'lesson.glx')
  const filename = path.join(workspace, 'lesson.glx')
  await host.internalAPI.save(initial.documentId, filename)
  const before = await fs.readFile(filename)
  const conversations = new ConversationStore({ directory: path.join(directory, 'conversations') })
  await conversations.registerWorkspace({ workspaceId: 'space', rootPath: await fs.realpath(workspace), managed: false, authorization: 'user-selected' })
  const conversation = await conversations.createConversation({ workspaceId: 'space', conversationId: 'managed' })
  let permission: 'read-only' | 'workspace' = 'read-only'
  const service = new ExternalMcpService({
    settings: { read: async () => ({ enabled: true, port: 0, permission, closeAction: 'ask' }), update: async () => { throw new Error('No global settings writes') } },
    conversations, registry: host.registry, gateway: host.tools, files: host.agentFiles,
    workspaceRoot: value => fs.realpath(value), uiState: async () => ({ workspaceId: 'space' }),
    appendEvent: async () => undefined, confirm: async () => { throw new Error('No approval expected inside workspace') },
    transportToken: 'test-private-token', managedConversation: { workspaceId: 'space', conversationId: conversation.conversationId,
      linkRun: async () => conversation.conversationId, readHandoff: async () => ({ instructions: [] }) },
  })
  cleanups.push(async () => { await service.close(); await host.settleSaveObservations() })
  await service.start()
  const { sessionId } = await service.initialize({ name: 'actual-managed-host', version: '1' })
  const invoke = async (name: string, input: Record<string, unknown> = {}) => await service.request(sessionId, call(name, input)) as Reply
  const catalog = await service.request(sessionId, { ...call(''), method: 'tools/list' }) as { tools: Array<{ name: string; inputSchema: unknown }> }
  // A strict native MCP client rejects the whole catalog if even one union
  // descriptor (handoff.read) omits MCP's required object inputSchema root.
  expect(() => ListToolsResultSchema.parse(catalog)).not.toThrow()
  const withoutRootFields = catalog.tools.filter(tool => !(tool.inputSchema as Record<string, unknown>).properties).map(tool => tool.name)
  expect(withoutRootFields).toEqual([])
  const names = catalog.tools.map(tool => tool.name)
  expect(names).toEqual(expect.arrayContaining(['file.open', 'file.write', 'project.read', 'project.apply', 'file.save', 'handoff.read']))
  for (const name of ['file.write', 'project.apply', 'file.save']) expect(catalog.tools.find(tool => tool.name === name)?.inputSchema).toBeTruthy()
  await expect(invoke('file.write', { mode: 'create', path: 'idle.txt', content: 'forbidden' })).rejects.toThrow('没有活动任务')
  await expect(fs.stat(path.join(workspace, 'idle.txt'))).rejects.toMatchObject({ code: 'ENOENT' })

  await service.activateManaged()
  const readOnlyOpen = await invoke('file.open', { path: 'lesson.glx' })
  expect(readOnlyOpen.isError).toBe(false)
  expect(readOnlyOpen.structuredContent.result.data.writable).toBe(false)
  const readTarget = readOnlyOpen.structuredContent.result.data.target
  expect((await invoke('project.read', { project: readTarget, path: 'project.json' })).isError).toBe(false)
  const readOnlyBefore = await host.internalAPI.read(initial.documentId)
  const content = JSON.stringify({ title: 'Workspace edit' })
  expect((await invoke('project.apply', { project: readTarget, path: 'project.json', content })).isError).toBe(true)
  expect((await invoke('file.save', { target: readTarget })).isError).toBe(true)
  expect((await invoke('file.write', { mode: 'create', path: 'readonly.txt', content: 'forbidden' })).isError).toBe(true)
  expect(await host.internalAPI.read(initial.documentId)).toEqual(readOnlyBefore)
  expect(await fs.readFile(filename)).toEqual(before)
  await expect(fs.stat(path.join(workspace, 'readonly.txt'))).rejects.toMatchObject({ code: 'ENOENT' })

  await service.suspendManaged()
  permission = 'workspace'
  await service.activateManaged()
  const opened = await invoke('file.open', { path: 'lesson.glx' })
  expect(opened.isError).toBe(false)
  expect(opened.structuredContent.result.data.writable).toBe(true)
  const target = opened.structuredContent.result.data.target
  expect((await invoke('read', { target: readTarget })).isError).toBe(true) // Old read-only run did not acquire a new grant.
  expect((await invoke('project.read', { project: target, path: 'project.json' })).isError).toBe(false)
  const change = { project: target, path: 'project.json', content }
  const applied = await invoke('project.apply', change)
  expect(applied.isError, JSON.stringify(applied.structuredContent.result)).toBe(false)
  expect(applied.structuredContent.result).toMatchObject({ kind: 'read', data: { commit: 'committed' } })
  expect((await host.internalAPI.read(initial.documentId)).dirty).toBe(true)
  const saved = await invoke('file.save', { target })
  expect(saved.isError, JSON.stringify(saved.structuredContent.result)).toBe(false)
  expect(saved.structuredContent.result).toMatchObject({ kind: 'read', data: { status: 'saved', dirty: false } })
  expect((await host.internalAPI.read(initial.documentId)).dirty).toBe(false)
  expect(await fs.readFile(filename)).not.toEqual(before)
  const savedBytes = await fs.readFile(filename)
  expect((await openCourseProjectV10Archive(savedBytes)).project.title).toBe('Workspace edit')
  await service.revokeManaged()
  await expect(invoke('project.apply', change)).rejects.toThrow('没有活动任务')
  await service.settleManaged()
  // A native client can refresh its fixed map between turns, after stop clears
  // the old Gateway run's scoped catalog. Discovery is not a new grant.
  const idleAgain = await service.request(sessionId, { ...call(''), method: 'tools/list' }) as { tools: Array<{ name: string }> }
  expect(idleAgain.tools.map(tool => tool.name)).toEqual(expect.arrayContaining(['file.write', 'project.apply', 'file.save']))
  await expect(invoke('file.write', { mode: 'create', path: 'revoked.txt', content: 'forbidden' })).rejects.toThrow('没有活动任务')
  await expect(fs.stat(path.join(workspace, 'revoked.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await fs.readFile(filename)).toEqual(savedBytes)
})

