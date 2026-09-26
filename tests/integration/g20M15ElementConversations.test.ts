// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { createCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import { createTextNode } from '../../src/core/tools/nativeNodeFactories'
import { sceneNodeToCourseLayerItem } from '../../src/shared/courseProjectModel'
import { courseProjectDocumentSchema } from '../../src/shared/courseProjectSchema'
import type { CourseProjectDocument } from '../../src/shared/courseProjectTypes'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ExecutionDesktopService } from '../../src/main/workbench/execution/ExecutionDesktopService'
import { ExecutionSettingsStore } from '../../src/main/workbench/providers/ExecutionSettingsStore'
import { isExecutionInputError } from '../../src/shared/workbench/executionInputMessages'
import type { ConversationRecord } from '../../src/shared/workbench/conversations'
import type { ExecutionDocumentReference, ExecutionSendResult } from '../../src/shared/workbench/executionDesktop'

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
})

const reply = () => new Response(`data: ${JSON.stringify({ id: randomUUID(), model: 'fixture-model', choices: [{ index: 0,
  delta: { role: 'assistant', content: '好的' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })

/** A course with two texts on its first scene, open in the document host, and one ordinary session. */
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-m15-element-')); roots.push(root)
  const project = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
  const surface = project.surfaces[0]
  if (surface?.type !== 'slide') throw new Error('slide surface')
  surface.scenes[0]!.layerItems = [
    sceneNodeToCourseLayerItem(createTextNode({ id: 'a', text: '标题', x: 40, y: 40 }), 1),
    sceneNodeToCourseLayerItem(createTextNode({ id: 'b', text: '要点', x: 40, y: 160 }), 2),
  ]
  const filename = path.join(root, 'lesson.h5lesson')
  await fs.writeFile(filename, createCourseProjectArchive({ project: courseProjectDocumentSchema.parse(project), assetFiles: {}, componentFiles: {} }))
  const documents = new DocumentHostService(path.join(root, 'documents'))
  const opened = await documents.open(filename)
  const settings = new ExecutionSettingsStore({ directory: path.join(root, 'settings'), encryption: { isEncryptionAvailable: () => true,
    encryptString: text => Buffer.from(text), decryptString: bytes => Buffer.from(bytes).toString() } })
  const connection = await settings.saveConnection({ apiKey: 'fixture', connection: { provider: 'fixture', protocol: 'openai-chat', baseURL: 'https://fixture.invalid/v1',
    accountId: 'account', authKind: 'api-key', billing: { kind: 'token-plan' }, capabilities: { tools: 'supported', stream: 'supported', vision: 'unknown', reasoning: 'unknown' } } })
  await settings.saveProfile({ roles: { conversation: { connectionId: connection.connection.id, model: 'fixture-model' }, vision: null, imageGenerate: null, imageEdit: null } })
  const options = { directory: path.join(root, 'execution'), documents, settings, fetch: vi.fn(async () => reply()) as unknown as typeof fetch,
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
