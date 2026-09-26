// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { createCourseProjectArchive, type CourseProjectArchiveData } from '../../src/core/drivers/codecs/courseProjectArchive'
import { createTextNode } from '../../src/core/tools/nativeNodeFactories'
import { findFlowBlockRecursive } from '../../src/core/tools/flowDocumentModel'
import { listCourseProjectV9Fixtures } from '../fixtures/course-project-v9/sources'
import { sceneNodeToCourseLayerItem } from '../../src/shared/courseProjectModel'
import { courseProjectDocumentSchema } from '../../src/shared/courseProjectSchema'
import type { CourseProjectDocument } from '../../src/shared/courseProjectTypes'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ExecutionDesktopService } from '../../src/main/workbench/execution/ExecutionDesktopService'
import { ExecutionSettingsStore } from '../../src/main/workbench/providers/ExecutionSettingsStore'
import { isExecutionInputError } from '../../src/shared/workbench/executionInputMessages'
import type { ConversationRecord } from '../../src/shared/workbench/conversations'
import type { ElementChangeView, ElementRevertResult, ExecutionDocumentReference, ExecutionSendResult } from '../../src/shared/workbench/executionDesktop'

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
})

const reply = () => new Response(`data: ${JSON.stringify({ id: randomUUID(), model: 'fixture-model', choices: [{ index: 0,
  delta: { role: 'assistant', content: '好的' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })

/** A course with texts on its first scene, open in the document host, and one ordinary session. */
async function fixture(model: (request: { instruction: string }) => Promise<void> = async () => {}, archive?: CourseProjectArchiveData) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-m15-element-')); roots.push(root)
  const project = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
  const surface = project.surfaces[0]
  if (surface?.type !== 'slide') throw new Error('slide surface')
  surface.scenes[0]!.layerItems = [
    sceneNodeToCourseLayerItem(createTextNode({ id: 'a', text: '标题', x: 40, y: 40 }), 1),
    sceneNodeToCourseLayerItem(createTextNode({ id: 'b', text: '要点', x: 40, y: 160 }), 2),
    sceneNodeToCourseLayerItem(createTextNode({ id: 'c', text: '结语', x: 40, y: 280 }), 3),
  ]
  const filename = path.join(root, 'lesson.h5lesson')
  await fs.writeFile(filename, createCourseProjectArchive(archive ?? { project: courseProjectDocumentSchema.parse(project), assetFiles: {}, componentFiles: {} }))
  const documents = new DocumentHostService(path.join(root, 'documents'))
  const opened = await documents.open(filename)
  const settings = new ExecutionSettingsStore({ directory: path.join(root, 'settings'), encryption: { isEncryptionAvailable: () => true,
    encryptString: text => Buffer.from(text), decryptString: bytes => Buffer.from(bytes).toString() } })
  const connection = await settings.saveConnection({ apiKey: 'fixture', connection: { provider: 'fixture', protocol: 'openai-chat', baseURL: 'https://fixture.invalid/v1',
    accountId: 'account', authKind: 'api-key', billing: { kind: 'token-plan' }, capabilities: { tools: 'supported', stream: 'supported', vision: 'unknown', reasoning: 'unknown' } } })
  await settings.saveProfile({ roles: { conversation: { connectionId: connection.connection.id, model: 'fixture-model' }, vision: null, imageGenerate: null, imageEdit: null } })
  // The model's turn: `model` may change the document the way a run's tools would, then the model replies.
  const respond = async (_url: unknown, init?: { body?: unknown }) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { messages?: Array<{ role: string; content: unknown }> }
    const last = body.messages?.filter(message => message.role === 'user').at(-1)?.content
    await model({ instruction: typeof last === 'string' ? last : JSON.stringify(last ?? '') })
    return reply()
  }
  const options = { directory: path.join(root, 'execution'), documents, settings, fetch: vi.fn(respond) as unknown as typeof fetch,
    authorizeWorkspaceRoot: async (value: string) => ({ resolvedPath: value }) }
  const service = new ExecutionDesktopService(options)
  const space = await service.operate({ type: 'workspace', root }) as { workspace: { workspaceId: string } }
  const workspaceId = space.workspace.workspaceId
  const session = await service.operate({ type: 'create-conversation', workspaceId }) as ConversationRecord
  return { root, documents, opened, options, service, workspaceId, session }
}

const locationOf = (snapshot: DocumentSnapshot) => {
  if (snapshot.model.kind !== 'course-v9') throw new Error('course')
  return snapshot.model.project.locations[0]!.id
}
/** The object an element card edits, as its reference: readable and the only writable target. */
function objectReference(snapshot: DocumentSnapshot, itemId: string): ExecutionDocumentReference {
  const target = { kind: 'course-object' as const, locationId: locationOf(snapshot), itemId }
  return { documentId: snapshot.documentId, epoch: snapshot.epoch, revision: snapshot.revision, writable: [target], selection: [target] }
}
/** A human edit of the course that does not touch `keep`. */
async function edit(documents: DocumentHostService, documentId: string, change: (project: CourseProjectDocument) => void) {
  const session = documents.registry.get(documentId), snapshot = await session.drain()
  if (snapshot.model.kind !== 'course-v9') throw new Error('course')
  const project = structuredClone(snapshot.model.project); change(project)
  const result = await session.execute({ documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision, operationId: randomUUID(), actor: 'human',
    mutation: { type: 'command', command: { type: 'course.replace', project } } })
  expect(result.status).toBe('applied')
}
const sceneItems = (project: CourseProjectDocument) => {
  const surface = project.surfaces[0]
  if (surface?.type !== 'slide') throw new Error('slide surface')
  return surface.scenes[0]!.layerItems
}

it('M15 an element card conversation is not listed with the sessions and ends with its document and with the app', async () => {
  const f = await fixture()
  const element = { kind: 'element', documentId: f.opened.documentId, label: '标题' } as const
  const card = await f.service.operate({ type: 'create-conversation', workspaceId: f.workspaceId, title: '标题', element }) as ConversationRecord
  expect(card.element).toEqual(element)
  const other = await f.service.operate({ type: 'create-conversation', workspaceId: f.workspaceId,
    element: { kind: 'element', documentId: 'another-document', label: '图片' } }) as ConversationRecord
  // The session list shows the ordinary session only; Main keeps all of them.
  const listed = await f.service.operate({ type: 'conversations', workspaceId: f.workspaceId }) as ConversationRecord[]
  expect(listed.map(record => record.conversationId)).toEqual([f.session.conversationId])
  const space = await f.service.operate({ type: 'workspace', root: f.root }) as { conversations: ConversationRecord[] }
  expect(space.conversations.map(record => record.conversationId)).toEqual([f.session.conversationId])
  expect((await f.service.conversations.listConversations(f.workspaceId)).length).toBe(3)
  await expect(f.service.operate({ type: 'create-conversation', workspaceId: f.workspaceId,
    element: { kind: 'element', documentId: f.opened.documentId, label: '' } })).rejects.toThrow()

  // A queued request of a card is cancelled when its document closes, and nothing of the card remains.
  await f.service.operate({ type: 'pause-queue', workspaceId: f.workspaceId, conversationId: card.conversationId })
  const queued = await f.service.operate({ type: 'send', workspaceId: f.workspaceId, conversationId: card.conversationId, submissionId: randomUUID(),
    expectedRevision: card.revision, text: '改成红色', documents: [objectReference(f.opened, 'a')], attachments: [] }) as ExecutionSendResult
  expect(queued.submission.state).toBe('queued')
  await f.service.clearElementConversations(f.opened.documentId)
  expect(await f.service.conversations.readConversation({ workspaceId: f.workspaceId, conversationId: card.conversationId })).toBeNull()
  expect(await f.service.submissions.read(queued.submission.submissionId)).toMatchObject({ state: 'cancelled', failure: { code: 'element-card-closed' } })
  expect(await f.service.conversations.readConversation({ workspaceId: f.workspaceId, conversationId: other.conversationId })).not.toBeNull()

  // After a restart no card survives; ordinary sessions do.
  const restarted = new ExecutionDesktopService(f.options)
  await restarted.operate({ type: 'conversations', workspaceId: f.workspaceId })
  expect(await restarted.conversations.readConversation({ workspaceId: f.workspaceId, conversationId: other.conversationId })).toBeNull()
  expect(await restarted.conversations.readConversation({ workspaceId: f.workspaceId, conversationId: f.session.conversationId })).not.toBeNull()
})

it('M15 the document host tells its listeners when a document closes', async () => {
  const f = await fixture()
  const closed: string[] = []
  const stop = f.documents.subscribeClosed(documentId => closed.push(documentId))
  await f.documents.operate({ type: 'close', documentId: f.opened.documentId })
  expect(closed).toEqual([f.opened.documentId])
  stop()
})

it('M15 a request for an object is judged by that object: other edits do not refuse it, deleting it does', async () => {
  const f = await fixture()
  const card = await f.service.operate({ type: 'create-conversation', workspaceId: f.workspaceId,
    element: { kind: 'element', documentId: f.opened.documentId, label: '标题' } }) as ConversationRecord
  const captured = await f.documents.registry.get(f.opened.documentId).drain()
  const reference = objectReference(captured, 'a')
  // Someone changes another object after the card captured "a"; the whole document's revision moves on.
  await edit(f.documents, f.opened.documentId, project => {
    const b = sceneItems(project).find(item => item.layerItemId === 'b')!
    if (b.kind !== 'native' || b.content.nativeType !== 'text') throw new Error('text')
    b.content.data.text = '要点（已改）'
  })
  const accepted = await f.service.operate({ type: 'send', workspaceId: f.workspaceId, conversationId: card.conversationId, submissionId: randomUUID(),
    expectedRevision: card.revision, text: '改成红色', documents: [reference], attachments: [] }) as ExecutionSendResult
  expect(['accepted', 'queued']).toContain(accepted.submission.state)
  if (accepted.run) await f.service.engine.wait(accepted.run.runId)
  // Main records the reply in the conversation just after the run ends; the next send names the revision after it.
  await vi.waitFor(async () => expect((await f.service.conversations.readConversation({ workspaceId: f.workspaceId, conversationId: card.conversationId }))!
    .messages.some(message => message.role === 'assistant')).toBe(true))

  // Once "a" is gone, a request captured before is refused as changed.
  await edit(f.documents, f.opened.documentId, project => {
    const surface = project.surfaces[0]
    if (surface?.type !== 'slide') throw new Error('slide surface')
    surface.scenes[0]!.layerItems = surface.scenes[0]!.layerItems.filter(item => item.layerItemId !== 'a')
  })
  const latest = await f.service.conversations.readConversation({ workspaceId: f.workspaceId, conversationId: card.conversationId })
  const refused = await f.service.operate({ type: 'send', workspaceId: f.workspaceId, conversationId: card.conversationId, submissionId: randomUUID(),
    expectedRevision: latest!.revision, text: '再改大一点', documents: [reference], attachments: [] }).then(() => null, error => error)
  expect(isExecutionInputError(refused, 'document-range-changed')).toBe(true)
})

/** A text object's words, colour and place on the course's first scene. */
function textOf(project: CourseProjectDocument, itemId: string) {
  const item = sceneItems(project).find(value => value.layerItemId === itemId)!
  if (item.kind !== 'native' || item.content.nativeType !== 'text') throw new Error('text')
  return { text: item.content.data.text, color: item.content.data.style.color, x: item.frame.x }
}

it('M15 a card undoes only what its request changed, asks before overwriting later edits of the same fields, and every step is one ordinary edit', async () => {
  let releaseA!: () => void
  const aRunning = new Promise<void>(resolve => { releaseA = resolve })
  let f!: Awaited<ReturnType<typeof fixture>>
  const recolor = (itemId: string, color: string, text?: string) => edit(f.documents, f.opened.documentId, project => {
    const item = sceneItems(project).find(value => value.layerItemId === itemId)!
    if (item.kind !== 'native' || item.content.nativeType !== 'text') throw new Error('text')
    item.content.data.style.color = color
    if (text !== undefined) item.content.data.text = text
  })
  // What each request's run does to the course while the model works.
  f = await fixture(async ({ instruction }) => {
    if (instruction.includes('A-慢')) await aRunning
    if (instruction.includes('B-改红')) await recolor('b', '#dc2626', '要点（AI）')
    if (instruction.includes('C-改蓝')) await recolor('c', '#2563eb')
  })
  const current = async (itemId: string) => {
    const snapshot = await f.documents.registry.get(f.opened.documentId).drain()
    if (snapshot.model.kind !== 'course-v9') throw new Error('course')
    return textOf(snapshot.model.project, itemId)
  }
  const original = { b: await current('b'), c: await current('c') }
  const card = (label: string) => f.service.operate({ type: 'create-conversation', workspaceId: f.workspaceId,
    element: { kind: 'element', documentId: f.opened.documentId, label } }) as Promise<ConversationRecord>
  const send = async (conversation: ConversationRecord, itemId: string, text: string) => {
    const snapshot = await f.documents.registry.get(f.opened.documentId).drain()
    const latest = await f.service.conversations.readConversation({ workspaceId: f.workspaceId, conversationId: conversation.conversationId })
    return f.service.operate({ type: 'send', workspaceId: f.workspaceId, conversationId: conversation.conversationId, submissionId: randomUUID(),
      expectedRevision: latest!.revision, text, documents: [objectReference(snapshot, itemId)], attachments: [] }) as Promise<ExecutionSendResult>
  }
  const change = (result: ExecutionSendResult) => f.service.operate({ type: 'element-change', submissionId: result.submission.submissionId }) as Promise<ElementChangeView>
  const settle = async (result: ExecutionSendResult) => {
    if (result.run) await f.service.engine.wait(result.run.runId)
    await vi.waitFor(async () => expect((await change(result)).state).not.toBe('pending'))
    return change(result)
  }
  const revert = (result: ExecutionSendResult, direction: 'undo' | 'redo', force?: boolean) => f.service.operate({ type: 'element-revert',
    submissionId: result.submission.submissionId, direction, ...(force ? { force } : {}) }) as Promise<ElementRevertResult>
  const [a, b, c] = [await card('标题'), await card('要点'), await card('结语')]

  // A is still working when B's request arrives; B runs beside it and is not refused.
  const slow = await send(a, 'a', 'A-慢')
  const toB = await send(b, 'b', 'B-改红')
  expect(toB.submission.state).toBe('accepted')
  expect(await settle(toB)).toMatchObject({ state: 'applied', fields: expect.arrayContaining(['文字', '文字颜色']) })
  releaseA()
  expect(await settle(slow)).toMatchObject({ state: 'none', fields: [] })

  // The teacher moves B; undoing B's request restores its words and colour and keeps the move. C stays.
  await edit(f.documents, f.opened.documentId, project => { sceneItems(project).find(value => value.layerItemId === 'b')!.frame.x = 300 })
  expect(await revert(toB, 'undo')).toMatchObject({ status: 'applied', change: { state: 'undone' } })
  expect(await current('b')).toEqual({ ...original.b, x: 300 })
  expect(await current('c')).toEqual(original.c)
  expect(await revert(toB, 'undo')).toMatchObject({ status: 'unavailable' })
  // The card's undo is one ordinary edit: the document's undo takes it back and its redo repeats it.
  const session = f.documents.registry.get(f.opened.documentId)
  const history = async (type: 'undo' | 'redo') => {
    const snapshot = await session.drain()
    return session.execute({ documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision, operationId: randomUUID(), actor: 'human', mutation: { type } })
  }
  expect((await history('undo')).status).toBe('applied')
  expect(await current('b')).toEqual({ text: '要点（AI）', color: '#dc2626', x: 300 })
  expect((await history('redo')).status).toBe('applied')
  expect(await current('b')).toEqual({ ...original.b, x: 300 })
  // The card redoes its request.
  expect(await revert(toB, 'redo')).toMatchObject({ status: 'applied', change: { state: 'applied' } })
  expect(await current('b')).toEqual({ text: '要点（AI）', color: '#dc2626', x: 300 })

  // C's colour is changed again by hand: the card's undo asks first and overwrites only when confirmed.
  const toC = await send(c, 'c', 'C-改蓝')
  expect(await settle(toC)).toMatchObject({ state: 'applied', fields: ['文字颜色'] })
  await recolor('c', '#16a34a')
  expect(await revert(toC, 'undo')).toEqual({ status: 'conflict', fields: ['文字颜色'] })
  expect((await current('c')).color).toBe('#16a34a')
  expect(await revert(toC, 'undo', true)).toMatchObject({ status: 'applied', change: { state: 'undone' } })
  expect(await current('c')).toEqual(original.c)
  expect(await current('b')).toEqual({ text: '要点（AI）', color: '#dc2626', x: 300 })
})

it('M15 a document block card undoes only the fields its request changed and asks before overwriting', async () => {
  const source = listCourseProjectV9Fixtures().find(value => value.id === 'flow')!.data
  let f!: Awaited<ReturnType<typeof fixture>>
  const media = (project: CourseProjectDocument) => {
    const surface = project.surfaces.find(item => item.type === 'flow')
    if (surface?.type !== 'flow') throw new Error('flow surface')
    const found = findFlowBlockRecursive(surface.blocks, 'flow-media')
    if (found?.block.type !== 'media') throw new Error('media block')
    return { surfaceId: surface.id, block: found.block }
  }
  const change = (apply: (block: ReturnType<typeof media>['block']) => void) => edit(f.documents, f.opened.documentId, project => apply(media(project).block))
  f = await fixture(async ({ instruction }) => {
    if (instruction.includes('图片-改')) await change(block => { block.altText = '新插图'; block.layout = 'wide' })
  }, source)
  const current = async () => {
    const snapshot = await f.documents.registry.get(f.opened.documentId).drain()
    if (snapshot.model.kind !== 'course-v9') throw new Error('course')
    const { block } = media(snapshot.model.project)
    return { altText: block.altText, layout: block.layout, caption: JSON.stringify(block.caption) }
  }
  const original = await current()
  const card = await f.service.operate({ type: 'create-conversation', workspaceId: f.workspaceId,
    element: { kind: 'element', documentId: f.opened.documentId, label: '图片' } }) as ConversationRecord
  const snapshot = await f.documents.registry.get(f.opened.documentId).drain()
  if (snapshot.model.kind !== 'course-v9') throw new Error('course')
  const target = { kind: 'flow-block' as const, surfaceId: media(snapshot.model.project).surfaceId, blockId: 'flow-media', parentId: null }
  const sent = await f.service.operate({ type: 'send', workspaceId: f.workspaceId, conversationId: card.conversationId, submissionId: randomUUID(), expectedRevision: card.revision,
    text: '图片-改', documents: [{ documentId: snapshot.documentId, epoch: snapshot.epoch, revision: snapshot.revision, writable: [target], selection: [target] }], attachments: [] }) as ExecutionSendResult
  if (sent.run) await f.service.engine.wait(sent.run.runId)
  const read = () => f.service.operate({ type: 'element-change', submissionId: sent.submission.submissionId }) as Promise<ElementChangeView>
  await vi.waitFor(async () => expect((await read()).state).not.toBe('pending'))
  expect(await read()).toMatchObject({ state: 'applied', fields: ['替代文字', '排版'] })

  // The teacher rewrites the caption; undoing the request restores the alt text and the layout and keeps the caption.
  await change(block => { block.caption = { inlines: [{ type: 'text', text: '老师的说明' }] } })
  const caption = (await current()).caption
  const revert = (direction: 'undo' | 'redo', force?: boolean) => f.service.operate({ type: 'element-revert', submissionId: sent.submission.submissionId, direction, ...(force ? { force } : {}) }) as Promise<ElementRevertResult>
  expect(await revert('undo')).toMatchObject({ status: 'applied', change: { state: 'undone' } })
  expect(await current()).toEqual({ altText: original.altText, layout: original.layout, caption })
  // Redone, then the layout changed by hand: undo asks first.
  expect(await revert('redo')).toMatchObject({ status: 'applied' })
  await change(block => { block.layout = 'full-width' })
  expect(await revert('undo')).toEqual({ status: 'conflict', fields: ['排版'] })
  expect(await revert('undo', true)).toMatchObject({ status: 'applied' })
  expect(await current()).toEqual({ altText: original.altText, layout: original.layout, caption })
})

it('M15 a Markdown text card follows its text through follow-ups and undoes and redoes it where the text is now', async () => {
  let f!: Awaited<ReturnType<typeof fixture>>
  let documentId = ''
  const splice = async (find: string, text: string) => {
    const session = f.documents.registry.get(documentId), snapshot = await session.drain()
    if (snapshot.model.kind !== 'markdown') throw new Error('markdown')
    const from = snapshot.model.source.indexOf(find)
    const result = await session.execute({ documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision, operationId: randomUUID(), actor: 'human',
      mutation: { type: 'command', command: { type: 'markdown.splice', from, to: from + find.length, text } } })
    expect(result.status).toBe('applied')
  }
  f = await fixture(async ({ instruction }) => {
    if (instruction.includes('改写-1')) await splice('第二句。', '改写后的第二句。')
    if (instruction.includes('改写-2')) await splice('改写后的第二句。', '再改的第二句。')
  })
  const file = path.join(f.root, 'notes.md')
  await fs.writeFile(file, '# 标题\n\n第一句。第二句。第三句。\n')
  documentId = (await f.documents.open(file)).documentId
  const source = async () => { const snapshot = await f.documents.registry.get(documentId).drain(); if (snapshot.model.kind !== 'markdown') throw new Error('markdown'); return snapshot.model.source }
  const card = await f.service.operate({ type: 'create-conversation', workspaceId: f.workspaceId, element: { kind: 'element', documentId, label: '第二句' } }) as ConversationRecord
  const send = async (text: string, target: { kind: 'markdown-range'; from: number; to: number }) => {
    const snapshot = await f.documents.registry.get(documentId).drain()
    const latest = await f.service.conversations.readConversation({ workspaceId: f.workspaceId, conversationId: card.conversationId })
    const sent = await f.service.operate({ type: 'send', workspaceId: f.workspaceId, conversationId: card.conversationId, submissionId: randomUUID(), expectedRevision: latest!.revision,
      text, documents: [{ documentId, epoch: snapshot.epoch, revision: snapshot.revision, writable: [target], selection: [target] }], attachments: [] }) as ExecutionSendResult
    if (sent.run) await f.service.engine.wait(sent.run.runId)
    const read = () => f.service.operate({ type: 'element-change', submissionId: sent.submission.submissionId }) as Promise<ElementChangeView>
    await vi.waitFor(async () => expect((await read()).state).not.toBe('pending'))
    return { submissionId: sent.submission.submissionId, change: await read() }
  }
  const start = (await source()).indexOf('第二句。')
  const first = await send('改写-1', { kind: 'markdown-range', from: start, to: start + 4 })
  expect(first.change).toMatchObject({ state: 'applied', fields: ['文字'], content: '改写后的第二句。', target: { kind: 'markdown-range', from: start, to: start + 8 } })
  // The follow-up goes to the text the first request left.
  const second = await send('改写-2', first.change.target as { kind: 'markdown-range'; from: number; to: number })
  expect(second.change).toMatchObject({ state: 'applied', content: '再改的第二句。', target: { from: start, to: start + 7 } })

  // Someone adds text before it; the card still finds its text, undoes and redoes it there.
  await splice('# 标题', '# 新的标题')
  const revert = (submissionId: string, direction: 'undo' | 'redo') => f.service.operate({ type: 'element-revert', submissionId, direction }) as Promise<ElementRevertResult>
  expect(await revert(second.submissionId, 'undo')).toMatchObject({ status: 'applied', change: { state: 'undone', content: '改写后的第二句。', target: { from: start + 2, to: start + 10 } } })
  expect(await source()).toBe('# 新的标题\n\n第一句。改写后的第二句。第三句。\n')
  expect(await revert(second.submissionId, 'redo')).toMatchObject({ status: 'applied', change: { state: 'applied', content: '再改的第二句。' } })
  expect(await source()).toBe('# 新的标题\n\n第一句。再改的第二句。第三句。\n')
  // Once its text is gone, the card says so instead of guessing.
  await splice('再改的第二句。', '别的内容')
  expect(await revert(second.submissionId, 'undo')).toMatchObject({ status: 'unavailable' })
})

it('M15 a Flow text card traces its range in the paragraph and undoes the paragraph text only', async () => {
  const source = listCourseProjectV9Fixtures().find(value => value.id === 'flow')!.data
  let f!: Awaited<ReturnType<typeof fixture>>
  const paragraph = (project: CourseProjectDocument) => {
    const surface = project.surfaces.find(item => item.type === 'flow')
    if (surface?.type !== 'flow') throw new Error('flow surface')
    const found = findFlowBlockRecursive(surface.blocks, 'flow-paragraph')
    if (found?.block.type !== 'paragraph') throw new Error('paragraph')
    return { surfaceId: surface.id, block: found.block }
  }
  f = await fixture(async ({ instruction }) => {
    if (instruction.includes('一段-改')) await edit(f.documents, f.opened.documentId, project => { paragraph(project).block.content = { inlines: [{ type: 'text', text: '这是两段文字可编辑正文。' }] } })
  }, source)
  const snapshot = await f.documents.registry.get(f.opened.documentId).drain()
  if (snapshot.model.kind !== 'course-v9') throw new Error('course')
  const target = { kind: 'flow-range' as const, surfaceId: paragraph(snapshot.model.project).surfaceId, blockId: 'flow-paragraph', parentId: null,
    slot: { kind: 'field' as const, field: 'content' as const }, from: 2, to: 4 }
  const card = await f.service.operate({ type: 'create-conversation', workspaceId: f.workspaceId, element: { kind: 'element', documentId: f.opened.documentId, label: '一段' } }) as ConversationRecord
  const sent = await f.service.operate({ type: 'send', workspaceId: f.workspaceId, conversationId: card.conversationId, submissionId: randomUUID(), expectedRevision: card.revision,
    text: '一段-改', documents: [{ documentId: snapshot.documentId, epoch: snapshot.epoch, revision: snapshot.revision, writable: [target], selection: [target] }], attachments: [] }) as ExecutionSendResult
  if (sent.run) await f.service.engine.wait(sent.run.runId)
  const read = () => f.service.operate({ type: 'element-change', submissionId: sent.submission.submissionId }) as Promise<ElementChangeView>
  await vi.waitFor(async () => expect((await read()).state).not.toBe('pending'))
  const changed = await read()
  expect(changed).toMatchObject({ state: 'applied', fields: ['文字'], target: { ...target, from: 2, to: 6 } })
  expect(JSON.parse(changed.content!)).toMatchObject({ inlines: [{ type: 'text', text: '两段文字' }] })
  const undone = await f.service.operate({ type: 'element-revert', submissionId: sent.submission.submissionId, direction: 'undo' }) as ElementRevertResult
  expect(undone).toMatchObject({ status: 'applied', change: { state: 'undone', target: { from: 2, to: 4 } } })
  const after = await f.documents.registry.get(f.opened.documentId).drain()
  if (after.model.kind !== 'course-v9') throw new Error('course')
  expect(paragraph(after.model.project).block.content).toEqual(paragraph(snapshot.model.project).block.content)
})

it('M15 a Runtime card names the earlier text edits whose original text its request took out of the source', async () => {
  const quiz = (heading: string) => `CoursewareRuntime.define({ runtimeApiVersion: 3, create(ctx) {
    var question = 1;
    ctx.dom.root.innerHTML = '<h2>${heading}</h2><p>第 ' + question + ' 题</p>';
    return { destroy: function () { ctx.dom.root.innerHTML = ''; } };
  } });`
  let f!: Awaited<ReturnType<typeof fixture>>
  const rewrite = (heading: string) => edit(f.documents, f.opened.documentId, project => {
    const item = sceneItems(project).find(value => value.layerItemId === 'quiz')!
    if (item.kind !== 'runtime') throw new Error('runtime')
    item.runtime.source = quiz(heading)
  })
  f = await fixture(async ({ instruction }) => {
    if (instruction.includes('换题目')) await rewrite('看图说话')
    if (instruction.includes('只改样式')) await rewrite('听录音，选图片')
  })
  // The teacher edited the heading (text in the source) and the question number (computed by the program).
  await edit(f.documents, f.opened.documentId, project => {
    sceneItems(project).push({
      layerItemId: 'quiz', label: '小测验', order: 4, visible: true, locked: false, rotation: 0, opacity: 1, hitPolicy: 'auto',
      playbackInitialVisibility: 'inherit', frame: { mode: 'absolute', x: 40, y: 40, width: 640, height: 360 }, kind: 'runtime',
      runtime: { protocol: 'surface-runtime', runtimeApiVersion: 3, enabled: true, renderMode: 'dom', source: quiz('听录音，选图片'), assets: {},
        content: { values: {}, overrides: [{ original: '听录音，选图片', region: 'h2', text: '听录音，选出正确的图片' }, { original: '第 1 题', text: '第一题' }] } },
    })
  })
  const card = await f.service.operate({ type: 'create-conversation', workspaceId: f.workspaceId,
    element: { kind: 'element', documentId: f.opened.documentId, label: '小测验' } }) as ConversationRecord
  const send = async (text: string) => {
    const snapshot = await f.documents.registry.get(f.opened.documentId).drain()
    const latest = await f.service.conversations.readConversation({ workspaceId: f.workspaceId, conversationId: card.conversationId })
    const result = await f.service.operate({ type: 'send', workspaceId: f.workspaceId, conversationId: card.conversationId, submissionId: randomUUID(),
      expectedRevision: latest!.revision, text, documents: [objectReference(snapshot, 'quiz')], attachments: [] }) as ExecutionSendResult
    if (result.run) await f.service.engine.wait(result.run.runId)
    const view = () => f.service.operate({ type: 'element-change', submissionId: result.submission.submissionId }) as Promise<ElementChangeView>
    await vi.waitFor(async () => expect((await view()).state).not.toBe('pending'))
    return view()
  }
  // The new source no longer has the heading: that edit no longer applies. The computed number is not reported.
  expect(await send('换题目')).toMatchObject({ state: 'none', lostTexts: ['听录音，选图片'] })
  // A request that keeps the text reports nothing.
  expect((await send('只改样式')).lostTexts).toBeUndefined()
})
