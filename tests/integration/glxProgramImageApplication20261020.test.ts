// @vitest-environment node
import { beforeAll as prepareProgramSourceForTests } from 'vitest'
import { loadBuiltinComponentSource } from '../../src/core/components/source/builtinSources'
prepareProgramSourceForTests(async () => { await loadBuiltinComponentSource('guoling.html-program') })
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ConversationStore } from '../../src/main/workbench/conversations/ConversationStore'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { ImageGenerationService } from '../../src/main/workbench/images/ImageGenerationService'
import { ImageResultsDesktopService } from '../../src/main/workbench/images/ImageResultsDesktopService'
import { imageProvenance } from '../../src/main/workbench/images/imageRoute'
import { createBlankCourseProjectV10, createBlankProgramProject } from '../../src/core/course/createCourseProjectV10'
import { componentSurfaces } from '../../src/shared/contracts/component-platform/project'
import type { ImageModelSelection } from '../../src/shared/workbench/images'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'

function model(snapshot: DocumentSnapshot) {
  if (snapshot.model.kind !== 'course-v10') throw new Error('Expected component project')
  return snapshot.model
}
const selection: ImageModelSelection = { imageModel: 'local-fixture', connection: { id: 'fixture', revision: 1, provider: 'openai', protocol: 'chatgpt-responses',
  baseURL: 'https://chatgpt.com/backend-api/codex', accountId: 'fixture', auth: { kind: 'oauth', credentialRef: 'fixture' }, billing: { kind: 'unknown' },
  capabilities: { tools: 'unknown', vision: 'unknown', stream: 'unknown', reasoning: 'unknown' } } }

async function fixture(program = true) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'glx-program-image-')), documents = new DocumentHostService(path.join(root, 'documents'))
  const project = program ? createBlankProgramProject('程序图片') : createBlankCourseProjectV10('幻灯片图片')
  const rootId = project.rootIds[0]!
  if (program) project.instances[rootId].data = { html: '<!doctype html><html><body><button id="go">保持互动</button><script>document.querySelector("#go").onclick=()=>document.body.dataset.clicked="yes"</script></body></html>' }
  const snapshot = await documents.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'images.glx')
  const conversations = new ConversationStore({ directory: path.join(root, 'conversations') })
  await conversations.registerWorkspace({ workspaceId: 'workspace', rootPath: root, managed: false, authorization: 'user-selected' })
  const conversation = await conversations.createConversation({ workspaceId: 'workspace', conversationId: 'conversation' })
  await conversations.updateConversation({ workspaceId: 'workspace', conversationId: 'conversation', expectedRevision: conversation.revision,
    patch: { runIndex: { builtinRunIds: [], externalRunIds: ['images'], externalPortIds: [] } } })
  const runs = new ExecutionRunStore(path.join(root, 'runs')), events = new ExecutionEventStore({ directory: path.join(root, 'events') })
  const bytes = await sharp({ create: { width: 32, height: 24, channels: 4, background: '#3377bb' } }).png().toBuffer()
  const images = new ImageGenerationService({ directory: path.join(root, 'images'), provider: { async generate(request, references) {
    return { status: 'completed', images: [{ bytes, mimeType: 'image/png', filename: 'fixture.png' }], provenance: imageProvenance(request, references) }
  } } })
  const service = new ImageResultsDesktopService({ directory: path.join(root, 'actions'), images, documents,
    execution: { conversations, runs, events, appendExternalEvent: async input => { await events.append(input) } }, selection: async () => selection })
  const owner = { workspaceId: 'workspace', conversationId: 'conversation', runId: 'images', jobId: 'generated' }
  const generated = await images.run({ jobId: owner.jobId, runId: owner.runId, documentId: snapshot.documentId, operation: 'generate', prompt: 'local fixture', selection })
  return { root, documents, project, snapshot, rootId, service, owner, resourceId: generated.resources[0]!.resourceId,
    async cleanup() { await service.flush(); service.dispose(); await fs.rm(root, { recursive: true, force: true }) } }
}

it('applies a ready image into the actual Source program native plane with one History entry and preserved program source', async () => {
  const h = await fixture()
  try {
    const input = { type: 'apply', ...h.owner, actionId: crypto.randomUUID(), resourceId: h.resourceId, frame: { x: 28, y: 41, width: 160, height: 120 },
      target: { documentId: h.snapshot.documentId, epoch: h.snapshot.epoch, revision: h.snapshot.revision, label: '程序根', address: { kind: 'course-instance', instanceId: h.rootId } } }
    const result = await h.service.operate(input)
    expect(result).toMatchObject({ status: 'applied' }); expect(await h.service.operate(input)).toEqual(result)
    const after = await h.documents.internalAPI.read(h.snapshot.documentId), project = model(after).project, original = h.project.instances[h.rootId]
    expect(after.undoDepth).toBe(1); expect(project.rootIds).toEqual([h.rootId]); expect(componentSurfaces(project)).toEqual([])
    const { childIds, ...root } = project.instances[h.rootId]
    expect(root).toEqual(original); expect(root).not.toHaveProperty('frame'); expect(childIds).toHaveLength(1)
    expect(project.definitions[original.definitionId]).toEqual(h.project.definitions[original.definitionId])
    const image = project.instances[childIds![0]!]
    expect(image.frame).toEqual({ width: 160, height: 120, transform: [1, 0, 0, 1, 28, 41] })
    expect(project.definitions[image.definitionId].implementation).toMatchObject({ kind: 'builtin', key: 'guoling.image' })
    expect(Object.keys(model(after).resources.assets)).toHaveLength(1)
    await h.documents.tools.beginRun({ runId: 'program-edit', actor: 'agent', documents: [{ documentId: after.documentId,
      writable: [{ kind: 'course-instance', surfaceId: h.rootId, instanceId: h.rootId }] }] })
    try {
      const selector = await h.documents.tools.issueTarget('program-edit', after.documentId, { kind: 'course-instance', surfaceId: h.rootId, instanceId: h.rootId })
      expect(await h.documents.tools.execute('program-edit', 'read-entry', { name: 'project.read', input: { project: selector, path: 'entry.html' } })).toMatchObject({ kind: 'read' })
      const edit = await h.documents.tools.execute('program-edit', 'edit-entry', { name: 'project.apply', input: { project: selector, path: 'entry.html', edits: [{ old: '保持互动', new: '继续互动' }] } })
      expect(edit, JSON.stringify(edit)).toMatchObject({ kind: 'read', data: { commit: 'committed' } })
      const edited = await h.documents.internalAPI.read(after.documentId)
      expect(model(edited).project.instances[h.rootId].childIds).toEqual(childIds)
      expect(model(edited).project.instances[image.id]).toEqual(image)
      expect(model(edited).project.instances[h.rootId].data).toMatchObject({ html: expect.stringContaining('继续互动') })
      expect(await h.documents.internalAPI.dispatch({ documentId: edited.documentId, epoch: edited.epoch, baseRevision: edited.revision,
        actor: 'human', operationId: 'undo-program-text', mutation: { type: 'undo' } })).toMatchObject({ status: 'applied' })
    } finally { await h.documents.tools.stop('program-edit') }
    const savedSnapshot = await h.documents.internalAPI.read(after.documentId)
    const saved = path.join(h.root, 'saved.glx'); await h.documents.internalAPI.save(after.documentId, saved)
    const cold = await new DocumentHostService(path.join(h.root, 'cold')).internalAPI.open(saved)
    expect(cold.model).toEqual(savedSnapshot.model)
    expect(await h.documents.internalAPI.dispatch({ documentId: after.documentId, epoch: after.epoch, baseRevision: savedSnapshot.revision,
      actor: 'human', operationId: 'undo-image', mutation: { type: 'undo' } })).toMatchObject({ status: 'applied' })
    const undone = model(await h.documents.internalAPI.read(after.documentId))
    expect(undone.project.instances).toEqual(model(h.snapshot).project.instances)
    expect(undone.resources).toEqual(model(h.snapshot).resources)
  } finally { await h.cleanup() }
})

it('retains the existing explicit Slide image insertion behavior', async () => {
  const h = await fixture(false)
  try {
    const result = await h.service.operate({ type: 'apply', ...h.owner, actionId: crypto.randomUUID(), resourceId: h.resourceId, frame: { x: 80, y: 60, width: 320, height: 240 },
      target: { documentId: h.snapshot.documentId, epoch: h.snapshot.epoch, revision: h.snapshot.revision, label: '幻灯片', address: { kind: 'course-surface', surfaceId: h.rootId } } })
    expect(result).toMatchObject({ status: 'applied' })
    const after = await h.documents.internalAPI.read(h.snapshot.documentId)
    expect(componentSurfaces(model(after).project)[0].childIds).toHaveLength(1)
    expect(after.undoDepth).toBe(1)
  } finally { await h.cleanup() }
})
