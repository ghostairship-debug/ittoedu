import { afterEach, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { MarkdownDriver } from '../../src/core/drivers/MarkdownDriver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { createDocumentJournal } from '../../src/main/workbench/documentJournal'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { EditSessionService } from '../../src/main/workbench/execution/EditSessionService'
import { ExecutionSettingsStore } from '../../src/main/workbench/providers/ExecutionSettingsStore'
import { bodyStreamingLabel, bodyStreamingRecord, configuredBodyStreamingAlternatives, type BodyStreamingObservation } from '../../src/shared/workbench/bodyStreaming'
import type { ModelProvider, ModelSelection } from '../../src/shared/workbench/modelProvider'
import { EditPreviewProjection } from '../../src/renderer/workbench/EditPreviewProjection'
import { parseDocumentMarkdown } from '../../src/shared/document/markdown'
import { toEditorDocument } from '../../src/renderer/document/documentAdapter'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { layoutPreviewKey, layoutPreviewPlugin, layoutPreviewRange, sourcePreviewRange } from '../../src/renderer/document/editPreviewWidgets'

const directories: string[] = []
afterEach(async () => { vi.unstubAllGlobals(); for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true }) })
async function directory() { const value = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-body-stream-')); directories.push(value); return value }
const selection: ModelSelection = { model: 'configured', connection: { id: 'connection', revision: 1, provider: 'fixture', protocol: 'openai-chat',
  baseURL: 'https://fixture.invalid/v1', accountId: 'fixture', auth: { kind: 'api-key', credentialRef: 'secret-ref' },
  billing: { kind: 'unknown' }, capabilities: { tools: 'supported', vision: 'supported', stream: 'supported', reasoning: 'unknown' } } }

it('observes only actual committed body-tool progression; chat and complete arguments never imply incremental body support', async () => {
  for (const mode of ['chat', 'complete-delta', 'final', 'progressive'] as const) {
    const dir = await directory(), driver = new MarkdownDriver(), observations: BodyStreamingObservation[] = []
    const registry = new DocumentRegistry({ drivers: [driver], persistence: createDocumentJournal({ directory: path.join(dir, 'docs') }), createId: randomUUID, bindingKey: value => value.path })
    const gateway = new DocumentToolGateway(registry, [driver], randomUUID), edits = new EditSessionService(registry, gateway)
    const session = await registry.create(driver.load(new TextEncoder().encode('OLD')), 'draft.md')
    let requests = 0
    const provider: ModelProvider = { async *stream(request) {
      requests++
      const target = JSON.parse(String(request.messages[1].content).split('：')[1])[0].writable[0].target
      const argumentsText = JSON.stringify({ target, content: 'NEW text' })
      const calls = requests === 1 && mode !== 'chat' ? [{ id: 'provider-operation', name: 'text.replace', argumentsText }] : []
      yield { type: 'text.delta', requestId: request.requestId, sequence: 0, text: '普通聊天流' }
      if (calls.length && mode !== 'final') {
        const parts = mode === 'progressive' ? [argumentsText.slice(0, -5), argumentsText.slice(-5)] : [argumentsText]
        for (const [index, argumentsDelta] of parts.entries()) yield { type: 'tool.delta', requestId: request.requestId, sequence: index + 1, index: 0, id: 'provider-operation', name: 'text.replace', argumentsDelta }
      }
      yield { type: 'response.completed', requestId: request.requestId, sequence: 10, responseId: 'response', actualModel: 'fixture',
        assistant: { role: 'assistant', content: 'done' }, toolCalls: calls, finishReason: calls.length ? 'tool_calls' : 'stop', nativeResponse: {} }
    } }
    const engine = new ExecutionEngine({ registry, gateway, edits, provider, runs: new ExecutionRunStore(path.join(dir, 'runs')), events: new ExecutionEventStore({ directory: path.join(dir, 'events') }),
      observeBodyStreaming: async (_selection, value) => { observations.push(value) } })
    const run = await engine.start({ conversationId: 'conversation', taskId: mode, instruction: 'edit', selection,
      documents: [{ documentId: session.documentId, writable: [{ kind: 'markdown-range', from: 0, to: 3 }] }] })
    expect((await engine.wait(run.runId)).status).toBe('completed')
    expect(observations.map(value => value.result)).toEqual(mode === 'chat' ? [] : [mode === 'progressive' ? 'progressive' : 'operation-only'])
    expect(session.read().model).toMatchObject({ source: mode === 'chat' ? 'OLD' : 'NEW text' })
  }
})

it('persists exact revision/model/parameters evidence and offers only configured observed alternatives', async () => {
  const dir = await directory()
  const options = { directory: dir, encryption: { isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(value), decryptString: (value: Uint8Array) => Buffer.from(value).toString() } }
  const store = new ExecutionSettingsStore(options)
  const { id: _id, revision: _revision, auth: _auth, ...config } = selection.connection
  const saved = await store.saveConnection({ connection: { ...config, authKind: 'api-key' }, apiKey: 'fixture' })
  const frozen = { ...selection, connection: saved.connection, parameters: { b: 2, a: 1 } }
  expect(bodyStreamingLabel(bodyStreamingRecord((await store.read()).bodyStreamingObservations!, frozen))).toContain('尚未验证')
  await store.recordBodyStreaming(frozen, { requestId: 'request', operationId: 'op', observedAt: 1, result: 'progressive' })
  await store.recordBodyStreaming(frozen, { requestId: 'request2', operationId: 'op2', observedAt: 2, result: 'operation-only' })
  let records = (await new ExecutionSettingsStore(options).read()).bodyStreamingObservations!
  expect(bodyStreamingLabel(bodyStreamingRecord(records, { ...frozen, parameters: { a: 1, b: 2 } }))).toContain('此前观察到')
  expect(bodyStreamingRecord(records, { ...frozen, model: 'other' })).toBeUndefined()
  expect(bodyStreamingRecord(records, { ...frozen, parameters: { a: 2, b: 2 } })).toBeUndefined()
  await store.saveProfile({ roles: { conversation: { connectionId: saved.connection.id, model: 'other' }, vision: { connectionId: saved.connection.id, model: frozen.model, parameters: frozen.parameters }, imageEdit: null, imageGenerate: null } })
  expect(configuredBodyStreamingAlternatives(await store.read(), { ...frozen, model: 'other' })).toHaveLength(1)
  const newer = await store.saveConnection({ id: saved.connection.id, expectedRevision: 1, connection: { ...config, authKind: 'api-key' } })
  records = (await store.read()).bodyStreamingObservations!
  expect(bodyStreamingRecord(records, { ...frozen, connection: newer.connection })).toBeUndefined()
  expect(configuredBodyStreamingAlternatives(await store.read())).toEqual([])
})

it('shows begin as a cancellable point status while original Markdown stays visible, then withdraws on abort', () => {
  vi.stubGlobal('requestAnimationFrame', () => 1); vi.stubGlobal('cancelAnimationFrame', () => undefined)
  const projection = new EditPreviewProjection({ edits: async () => [], subscribeEdits: () => () => undefined, stop: async () => null })
  const snapshot = { editId: 'edit', runId: 'run', documentId: 'doc', epoch: 'epoch', baseRevision: 0, revision: 0,
    targetHandle: 'handle', target: { kind: 'markdown-range' as const, from: 0, to: 6 }, value: '', sequence: -1, status: 'active' as const }
  projection.receive({ type: 'edit.changed', snapshot })
  expect(projection.read('doc')).toMatchObject({ sequence: -1 })
  const parsed = parseDocumentMarkdown('# Old\n', { target: 'file', createId: () => randomUUID() }); if (parsed.status !== 'valid') throw new Error(JSON.stringify(parsed))
  const doc = toEditorDocument(parsed.document.content), cancel = vi.fn(), preview = { ...snapshot, cancel }
  const range = layoutPreviewRange(doc, preview, parsed.sourceMap)!
  expect(range.from).toBe(range.to); expect(range.blockNodes).toBeUndefined()
  expect(sourcePreviewRange(preview, parsed.sourceMap)).toMatchObject({ from: 0, to: 0 })
  const host = document.createElement('div'); document.body.append(host)
  const view = new EditorView(host, { state: EditorState.create({ doc, plugins: [layoutPreviewPlugin(() => undefined)] }) })
  try {
    view.dispatch(view.state.tr.setMeta(layoutPreviewKey, range))
    expect(view.dom.querySelector('.document-generation-hidden')).toBeNull()
    expect(view.dom.textContent).toContain('Old'); expect(view.dom.textContent).toContain('正在准备正文')
    view.dom.querySelector('[data-edit-preview]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(cancel).toHaveBeenCalledOnce()
    projection.receive({ type: 'edit.aborted', snapshot: { ...snapshot, status: 'aborted' }, reason: 'cancel' })
    expect(projection.read('doc')).toBeNull()
  } finally { view.destroy(); host.remove() }
})
