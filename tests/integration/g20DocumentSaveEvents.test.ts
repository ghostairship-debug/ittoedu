// @vitest-environment node
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import { DocumentHostService, type DocumentSaveFact } from '../../src/main/workbench/DocumentHostService'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { ConversationStore } from '../../src/main/workbench/conversations/ConversationStore'
import { installDocumentSaveEvents } from '../../src/main/workbench/execution/DocumentSaveEvents'
import type { ExecutionEventInput } from '../../src/shared/workbench/executionEvents'

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('not a temp fixture')
    await fs.rm(root, { recursive: true, force: true })
  }
})
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-save-events-')); roots.push(directory)
  const documents = new DocumentHostService(path.join(directory, 'documents'))
  const events = new ExecutionEventStore({ directory: path.join(directory, 'events') })
  const conversations = new ConversationStore({ directory: path.join(directory, 'conversations') })
  await conversations.registerWorkspace({ workspaceId: 'space', rootPath: directory, managed: true, authorization: 'managed' })
  const conversation = await conversations.createConversation({ workspaceId: 'space' })
  const execution = { events, conversations, appendExternalEvent: vi.fn((input: ExecutionEventInput) => events.append(input)) }
  const document = await documents.internalAPI.create({ kind: 'markdown', source: 'start', resources: { assets: {}, components: {} } }, 'draft.md')
  const apply = async (runId: string, source: 'builtin' | 'external-mcp', content: string, publish = true) => {
    await documents.tools.beginRun({ runId, actor: source === 'builtin' ? 'agent' : 'external', documents: [{ documentId: document.documentId, writable: [{ kind: 'document' }] }] })
    const current = await documents.internalAPI.read(document.documentId)
    if (current.model.kind !== 'markdown') throw new Error('Expected markdown fixture')
    const target = await documents.tools.issueTarget(runId, document.documentId, { kind: 'markdown-range', from: 0, to: current.model.source.length })
    const result = await documents.tools.execute(runId, `${runId}-operation`, { name: 'text.replace', input: { target, content } })
    if (result.kind !== 'document-operation' || result.result.status !== 'applied') throw new Error('fixture must really apply: ' + JSON.stringify(result))
    const receipt = result.result
    const event: ExecutionEventInput = { eventId: `${runId}-commit`, conversationId: conversation.conversationId, runId, taskId: `${runId}-task`, itemId: 'commit', time: Date.now(), source,
      type: 'document.commit', update: 'snapshot', data: { documentId: receipt.documentId, operationId: receipt.operationId, revision: receipt.revision, applicationStatus: 'applied', status: 'applied' } }
    if (publish) await events.append(event)
    return { event, receipt }
  }
  return { directory, documents, document, events, execution, conversation, apply }
}

it('links real disk saves to built-in and external commits after one lazy 5000-record recovery, not to unrelated runs', async () => {
  const f = await fixture()
  await f.events.batchAppend(Array.from({ length: 5000 }, (_, index) => ({ eventId: `history-${index}`, conversationId: f.conversation.conversationId, runId: 'read-only-run', taskId: 'read-only-task', itemId: `text-${index}`, time: index, source: 'builtin' as const, type: 'text' as const, update: 'snapshot' as const, data: { text: 'read only' } })))
  await f.apply('builtin-run', 'builtin', 'builtin content')
  await f.apply('external-run', 'external-mcp', 'external content')
  const readPage = vi.spyOn(f.events, 'readPage'), facts: DocumentSaveFact[] = []
  f.documents.subscribeSaves(fact => facts.push(fact))
  const projection = installDocumentSaveEvents({ documents: f.documents, execution: f.execution })
  const filename = path.join(f.directory, 'saved.md')
  await f.documents.saveToPath(f.document.documentId, filename); await projection.flush()
  expect(await fs.readFile(filename, 'utf8')).toBe('external content')
  expect(facts.map(fact => fact.status)).toEqual(['saving', 'saved'])
  expect(facts[1]).toMatchObject({ savedRevision: 2, currentRevision: 2 })
  const saves = (await f.events.snapshot(f.conversation.conversationId)).items.filter(item => item.type === 'document.save')
  expect(saves).toHaveLength(2)
  expect(saves.map(item => [item.runId, item.source, item.data.saveStatus, item.data.revision])).toEqual([
    ['builtin-run', 'builtin', 'saved', 2], ['external-run', 'external-mcp', 'saved', 2],
  ])
  const initialPages = readPage.mock.calls.length
  expect(initialPages).toBeGreaterThan(1)
  await f.documents.saveToPath(f.document.documentId); await projection.flush()
  expect(readPage).toHaveBeenCalledTimes(initialPages)
  projection.dispose()
})

it('reports a real disk conflict as failed and keeps a successful save successful when timeline persistence fails', async () => {
  const f = await fixture(), failures: unknown[] = []
  await f.apply('original', 'builtin', 'first')
  const projection = installDocumentSaveEvents({ documents: f.documents, execution: f.execution, onError: error => failures.push(error) })
  const filename = path.join(f.directory, 'file.md')
  await f.documents.saveToPath(f.document.documentId, filename); await projection.flush()
  await f.apply('later', 'builtin', 'new content')
  await fs.writeFile(filename, 'outside change')
  await expect(f.documents.saveToPath(f.document.documentId)).rejects.toThrow()
  await projection.flush()
  expect(await fs.readFile(filename, 'utf8')).toBe('outside change')
  const saves = (await f.events.snapshot(f.conversation.conversationId)).items.filter(item => item.type === 'document.save' && item.runId === 'later')
  expect(saves).toHaveLength(1)
  expect(saves[0].data).toMatchObject({ saveStatus: 'failed', revision: 2, error: expect.any(String) })
  f.execution.appendExternalEvent.mockRejectedValue(new Error('timeline disk failure'))
  const newPath = path.join(f.directory, 'recovered.md')
  const saved = await f.documents.saveToPath(f.document.documentId, newPath); await projection.flush()
  expect(saved.dirty).toBe(false)
  expect(await fs.readFile(newPath, 'utf8')).toBe('new content')
  expect(failures.length).toBeGreaterThan(0)
  projection.dispose()
})

it('reports the captured revision while editing continues and joins a late actual commit without marking newer work saved', async () => {
  const f = await fixture(), facts: DocumentSaveFact[] = []
  const first = await f.apply('captured-run', 'builtin', 'captured bytes', false)
  const projection = installDocumentSaveEvents({ documents: f.documents, execution: f.execution })
  f.documents.subscribeSaves(fact => facts.push(fact))
  let release!: () => void, started!: () => void
  const held = new Promise<void>(resolve => { release = resolve }), entered = new Promise<void>(resolve => { started = resolve })
  const filename = path.join(f.directory, 'concurrent.md'), link = fs.link.bind(fs)
  vi.spyOn(fs, 'link').mockImplementation(async (from, to) => { if (String(to) === filename) { started(); await held } return link(from, to) })
  const saving = f.documents.saveToPath(f.document.documentId, filename)
  try {
    await entered
    await f.apply('newer-run', 'external-mcp', 'newer unsaved bytes')
  } finally { release() }
  const returned = await saving; await projection.flush()
  expect(returned).toMatchObject({ revision: 2, dirty: true })
  expect(await fs.readFile(filename, 'utf8')).toBe('captured bytes')
  expect(facts.at(-1)).toMatchObject({ status: 'saved', savedRevision: 1, currentRevision: 2 })
  expect((await f.events.snapshot(f.conversation.conversationId)).items.some(item => item.type === 'document.save')).toBe(false)
  await f.events.append(first.event); await projection.flush()
  const saves = (await f.events.snapshot(f.conversation.conversationId)).items.filter(item => item.type === 'document.save')
  expect(saves).toHaveLength(1)
  expect(saves[0]).toMatchObject({ runId: 'captured-run', data: { saveStatus: 'saved', revision: 1 } })
  expect(saves[0].content).toEqual([{ kind: 'text', text: '已保存版本 1，后续修改仍未保存。' }])
  projection.dispose()
})

