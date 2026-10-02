// @vitest-environment node
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { MarkdownDriver } from '../../src/core/drivers/MarkdownDriver'
import { TextDriver } from '../../src/core/drivers/TextDriver'
import { DocumentToolGateway, type DynamicContentObservationPort } from '../../src/core/tools/DocumentToolGateway'
import { prepareImageResource } from '../../src/main/workbench/admittedImageResource'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import type { ToolResult, ToolRunGrant } from '../../src/shared/workbench/tools'
import { DynamicContentObservationStore } from '../../src/main/workbench/observation/DynamicContentObservationStore'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import type { ModelProvider, ModelSelection } from '../../src/shared/workbench/modelProvider'

/**
 * M27-T03: text.replace accepts a content.targets-discovered Runtime/Component text
 * short handle (runtime.value / runtime.text / component.text) and dispatches into
 * the same admission + CAS + undo pipeline as content.update. One official
 * transaction: applied → undo → redo → save → reopen; the original Runtime source
 * bytes are never rewritten, and a second write through the same stale short handle
 * fails with target-conflict.
 */

const md = new MarkdownDriver(), text = new TextDriver(), course = new CourseV9Driver()
const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('fixture outside temp')
    await fs.rm(directory, { recursive: true, force: true })
  }
})

type PersistenceCall = { kind: 'append' | 'save'; state: unknown }
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64'))
function harness(observations?: DynamicContentObservationPort) {
  let sequence = 0
  const persistenceCalls: PersistenceCall[] = []
  const savedSnapshots: any[] = []
  const persistence = {
    async append(state: any) { persistenceCalls.push({ kind: 'append', state: structuredClone(state) }) },
    async save(input: { documentId: string; revision: number; model: any; binding: any; bytes: Uint8Array }) {
      if (input.binding?.kind !== 'file') throw new Error('file binding required')
      await fs.writeFile(input.binding.path, Buffer.from(input.bytes))
      const binding = { kind: 'file' as const, path: input.binding.path, version: null, bindingVersion: (input.binding.bindingVersion ?? 0) + 1 }
      persistenceCalls.push({ kind: 'save', state: structuredClone({ ...input, binding }) })
      savedSnapshots.push(structuredClone({ ...input, binding }))
      return binding
    },
  }
  const registry = new DocumentRegistry({ persistence: persistence as any, drivers: [md, course, text], createId: () => `id-${++sequence}`, bindingKey: binding => binding.path })
  let fallbackSequence = 0
  const fallbackPort = {
    async capture() {
      fallbackSequence += 1
      const id = `m27-fallback-${fallbackSequence}`
      return { asset: { id, filename: `${id}.png`, mimeType: 'image/png', kind: 'image' as const, path: `assets/${id}.png`, byteLength: PNG.byteLength, width: 1, height: 1 }, bytes: PNG }
    },
  }
  const gateway = new DocumentToolGateway(registry, [md, course, text], () => String(++sequence), {
    prepareImage: prepareImageResource,
    dynamicContentFallback: fallbackPort,
    ...(observations ? { dynamicContentObservations: observations } : {}),
  })
  return { registry, gateway, persistenceCalls, savedSnapshots }
}

function runtimeModel() {
  const model = course.load(new Uint8Array(readFileSync('tests/fixtures/course-project-v9/surface-runtime.h5lesson')))
  if (model.kind !== 'course-v9') throw new Error('fixture must be V9')
  return model
}
function runtimeItem(snapshot: DocumentSnapshot) {
  if (snapshot.model.kind !== 'course-v9') throw new Error('course')
  const surface = snapshot.model.project.surfaces.find(value => value.type === 'slide')
  const scene = surface?.scenes[0]
  const item = scene?.layerItems.find(value => value.layerItemId === 'slide-surface-runtime')
  if (!item || item.kind !== 'runtime') throw new Error('runtime item missing')
  return item
}

describe('M27-T03 text.replace accepted Runtime/Component short handle', () => {
  it('delivers the current object truncation notice to the next model request and removes it on a fresh untruncated publication', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-target-truncation-'))
    directories.push(directory)
    const h = harness({ read: identity => store.read(identity) })
    const store = new DynamicContentObservationStore(async id => h.registry.get(id).read())
    const session = await h.registry.create(runtimeModel(), 'targets.h5lesson')
    let publicationSeq = 0
    const publish = (truncatedItemIds: string[]) => store.publish({ senderId: 1, documentId: session.documentId,
      epoch: session.read().epoch, revision: session.read().revision, locationId: 'location-scene-1',
      viewGeneration: 'view', publicationSeq: ++publicationSeq, source: 'authoring', targets: [], truncatedItemIds })
    expect(await publish(['another-instance'])).toBe(true)
    let turns = 0, objectHandle = ''
    const provider: ModelProvider = { async *stream(request) {
      const calls: { id: string; name: string; argumentsText: string }[] = []
      turns++
      if (turns === 1) {
        const refs = JSON.parse(String(request.messages[1].content).split('：')[1]) as { writable: { target: string }[] }[]
        objectHandle = refs[0]!.writable[0]!.target
      } else {
        const message = request.messages.filter(item => item.role === 'tool').at(-1)!
        const receipt = JSON.parse(String(message.content))
        expect(receipt.kind).toBe('read')
        expect(receipt.data.targets.some((target: { source: string }) => target.source === 'declared')).toBe(true)
        if (turns === 3) expect(receipt.data).toMatchObject({ truncated: true, notice: expect.stringMatching(/400.*按层.*已声明目标/) })
        else expect(receipt.data).not.toHaveProperty('truncated')
        if (turns === 2) expect(await publish(['slide-surface-runtime'])).toBe(true)
        if (turns === 3) expect(await publish([])).toBe(true)
      }
      if (turns < 4) calls.push({ id: `discover-${turns}`, name: 'content.targets', argumentsText: JSON.stringify({ target: objectHandle }) })
      yield { type: 'response.completed', requestId: request.requestId, sequence: 1, responseId: 'fixture', actualModel: 'fixture',
        finishReason: calls.length ? 'tool_calls' : 'stop', nativeResponse: {}, toolCalls: calls,
        assistant: { role: 'assistant', content: calls.length ? null : '完成',
          ...(calls.length ? { tool_calls: calls.map(call => ({ id: call.id, type: 'function' as const,
            function: { name: call.name, arguments: call.argumentsText } })) } : {}) } }
    } }
    const selection: ModelSelection = { model: 'fixture', connection: { id: 'fixture', revision: 1, provider: 'fixture', protocol: 'openai-chat',
      baseURL: 'https://fixture.invalid/v1', accountId: 'fixture', auth: { kind: 'api-key', credentialRef: 'fixture' }, billing: { kind: 'unknown' },
      capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'unknown' } } }
    const engine = new ExecutionEngine({ registry: h.registry, gateway: h.gateway, provider,
      runs: new ExecutionRunStore(path.join(directory, 'runs')), events: new ExecutionEventStore({ directory: path.join(directory, 'events') }) })
    const started = await engine.start({ conversationId: 'targets', taskId: 'targets', instruction: '查看动态图文', selection,
      documents: [{ documentId: session.documentId, writable: [{ kind: 'course-object', locationId: 'location-scene-1', itemId: 'slide-surface-runtime' }] }] })
    expect(await engine.wait(started.runId)).toMatchObject({ status: 'completed' })
    expect(turns).toBe(4)
    expect(session.read().undoDepth).toBe(0)
  })
  it('applies text.replace onto the content.targets runtime.value short handle in one official transaction: undo/redo save/reopen hold the new text and the Runtime source stays intact', async () => {
    const { registry, gateway } = harness()
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-m27-t03-'))
    directories.push(directory)
    const filename = path.join(directory, 'runtime-text-replace.h5lesson')

    const created = await registry.create(runtimeModel(), 'runtime-text-replace.h5lesson')
    const grant: ToolRunGrant = { runId: 'r1', actor: 'agent' as const, documents: [{ documentId: created.documentId, writable: [{ kind: 'document' }] }] }
    await gateway.beginRun(grant)

    // Discover the declared runtime.value text field (original title).
    const objectHandle = await gateway.issueTarget('r1', created.documentId, { kind: 'course-object', locationId: 'location-scene-1', itemId: 'slide-surface-runtime' })
    const discovery = await gateway.execute('r1', 'discover', { name: 'content.targets', input: { target: objectHandle } })
    if (discovery.kind !== 'read') throw new Error(`discovery failed: ${JSON.stringify(discovery)}`)
    const targets = (discovery.data as { targets: { target: string; kind: string; source: string; text?: string }[] }).targets
    const titleTarget = targets.find(value => value.kind === 'text' && value.text !== undefined)
    if (!titleTarget) throw new Error(`no text target discovered: ${JSON.stringify(targets)}`)
    expect(gateway.documentsOfHandles('r1', [titleTarget.target])).toEqual([created.documentId])
    expect(gateway.documentsOfHandles('other-run', [titleTarget.target])).toEqual([])
    const before = runtimeItem(created.read())

    // Single official transaction: text.replace on the discovered short handle.
    const applied = await gateway.execute('r1', 'replace-title', { name: 'text.replace', input: { target: titleTarget.target, content: '听录音，选出你听到的图片' } })
    if (applied.kind === 'error') throw new Error(`text.replace failed: ${JSON.stringify(applied)}`)
    if (applied.kind !== 'document-operation') throw new Error(`unexpected kind: ${applied.kind}`)
    expect(applied.result.status).toBe('applied')
    let snapshot = created.read()
    const edited = runtimeItem(snapshot)
    expect(edited.runtime.source).toBe(before.runtime.source)
    expect(edited.runtime.content.values.title).toBe('听录音，选出你听到的图片')

    // Undo returns the original declared text; redo replays.
    const undoResult = await created.execute({ documentId: snapshot.documentId, epoch: snapshot.epoch, operationId: 'human-undo', baseRevision: snapshot.revision, actor: 'human', mutation: { type: 'undo' } })
    expect(undoResult.status).toBe('applied')
    snapshot = created.read()
    expect(runtimeItem(snapshot).runtime.content.values.title).not.toBe('听录音，选出你听到的图片')
    expect(runtimeItem(snapshot).runtime.content.values.title).toBe(before.runtime.content.values.title)
    const redoResult = await created.execute({ documentId: snapshot.documentId, epoch: snapshot.epoch, operationId: 'human-redo', baseRevision: snapshot.revision, actor: 'human', mutation: { type: 'redo' } })
    expect(redoResult.status).toBe('applied')
    snapshot = created.read()
    expect(runtimeItem(snapshot).runtime.content.values.title).toBe('听录音，选出你听到的图片')
    expect(runtimeItem(snapshot).runtime.source).toBe(before.runtime.source)

    // Save; reopen from disk; the text is there, the source is the same bytes.
    await registry.save(created.documentId, { kind: 'file', path: filename, version: null, bindingVersion: 0 })
    snapshot = created.read()
    const bytes = await fs.readFile(filename)
    const reopenedModel = course.load(new Uint8Array(bytes))
    if (reopenedModel.kind !== 'course-v9') throw new Error('course')
    const reopened = reopenedModel.project.surfaces.find(value => value.type === 'slide')?.scenes[0]?.layerItems.find(value => value.layerItemId === 'slide-surface-runtime')
    if (!reopened || reopened.kind !== 'runtime') throw new Error('runtime in reopened')
    expect(reopened.runtime.source).toBe(before.runtime.source)
    expect(reopened.runtime.content.values.title).toBe('听录音，选出你听到的图片')

    // Stale short handle from the old snapshot cannot silently re-apply. Re-read the object
    // to obtain a fresh handle (per the gateway's standard rule) and discover again.
    expect(await gateway.execute('r1', 'stale-short-handle', { name: 'text.replace', input: { target: titleTarget.target, content: '另一个标题' } }))
      .toMatchObject({ kind: 'error' })
    const refreshedObject = await gateway.execute('r1', 'inspect-object', { name: 'inspect', input: { target: objectHandle } })
    if (refreshedObject.kind !== 'read') throw new Error(`inspect failed: ${JSON.stringify(refreshedObject)}`)
    const freshObjectHandle = (refreshedObject.data as { target: string }).target
    const secondDiscovery = await gateway.execute('r1', 'discover-2', { name: 'content.targets', input: { target: freshObjectHandle } })
    if (secondDiscovery.kind !== 'read') throw new Error(`second discovery failed: ${JSON.stringify(secondDiscovery)}`)
    const secondTargets = (secondDiscovery.data as { targets: { target: string; kind: string; text?: string }[] }).targets
    const secondTitle = secondTargets.find(value => value.kind === 'text' && value.text === '听录音，选出你听到的图片')
    if (!secondTitle) throw new Error(`second title target missing: ${JSON.stringify(secondTargets)}`)
    const secondApplied = await gateway.execute('r1', 'replace-again', { name: 'text.replace', input: { target: secondTitle.target, content: '再改一次：听录音，选出最终答案' } }) as Extract<ToolResult, { kind: 'document-operation' }>
    expect(secondApplied.result.status).toBe('applied')
    snapshot = created.read()
    expect(runtimeItem(snapshot).runtime.content.values.title).toBe('再改一次：听录音，选出最终答案')
    expect(runtimeItem(snapshot).runtime.source).toBe(before.runtime.source)

    await gateway.stop('r1')
  })

  it('rejects text.replace against unknown or image-only short handles; image-only fields must stay on content.update so AI cannot silently coerce image data to plain text', async () => {
    const { registry, gateway } = harness()
    const created = await registry.create(runtimeModel(), 'runtime-text-replace.h5lesson')
    await gateway.beginRun({ runId: 'r2', actor: 'agent' as const, documents: [{ documentId: created.documentId, writable: [{ kind: 'document' }] }] })

    // A forged short handle must not even resolve.
    expect(await gateway.execute('r2', 'forged', { name: 'text.replace', input: { target: 'c-not-a-handle', content: 'BAD' } }))
      .toMatchObject({ kind: 'error', code: 'invalid-target' })

    const objectHandle = await gateway.issueTarget('r2', created.documentId, { kind: 'course-object', locationId: 'location-scene-1', itemId: 'slide-surface-runtime' })
    const discovery = await gateway.execute('r2', 'discover', { name: 'content.targets', input: { target: objectHandle } })
    if (discovery.kind !== 'read') throw new Error(`discovery failed: ${JSON.stringify(discovery)}`)
    const targets = (discovery.data as { targets: { target: string; kind: string }[] }).targets
    const imageTarget = targets.find(value => value.kind === 'image')
    if (imageTarget) {
      // text.replace on an image short handle must refuse with a clear typed error so the
      // model falls back to content.update with an image resource.
      const refused = await gateway.execute('r2', 'image-as-text', { name: 'text.replace', input: { target: imageTarget.target, content: 'BAD' } })
      expect(refused.kind).toBe('error')
      expect((refused as Extract<ToolResult, { kind: 'error' }>).code).toBe('invalid-input')
    }
    await gateway.stop('r2')
  })
})
