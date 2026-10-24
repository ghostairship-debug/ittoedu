import { testContainerInstance } from '../helpers/glxWorkFixture'
import { componentSurfaces } from '../../src/shared/contracts/component-platform/project'
// @vitest-environment node
import { expect, it } from 'vitest'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { WEB_DEFINITION, HTML_PROGRAM_DEFINITION } from '../../src/components/web/data'
import { componentProjectFiles } from '../../src/core/projectFiles/componentPlatform/projection'
import { ComponentProjectFileCoordinator, type ComponentProjectSnapshot } from '../../src/core/projectFiles/componentPlatform/coordinator'
import { publicWriteToolResult } from '../../src/core/tools/publicWriteReceipt'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { estimateSerializedTokens } from '../../src/core/execution/modelContextBudget'
import type { ContentApplyRequest, ContentApplyResult } from '../../src/core/contentApply/planning/types'
import type { ComponentEdit } from '../../src/shared/contracts/component-platform'
import type { ToolResult } from '../../src/shared/workbench/tools'

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8')
const data = (result: ToolResult): Record<string, any> => {
  expect(result.kind).toBe('read')
  if (result.kind !== 'read') throw new Error(JSON.stringify(result))
  return result.data as Record<string, any>
}

/** Only planning is fixed: requests become ordinary data.set commands. The
 * coordinator's public producer, Session, receipts and Undo are the real owners. */
async function fixture(count = 1) {
  const project = createBlankCourseProjectV10('Public write receipt')
  project.definitions[WEB_DEFINITION.id] = WEB_DEFINITION
  project.definitions[HTML_PROGRAM_DEFINITION.id] = HTML_PROGRAM_DEFINITION
  for (let index = 0; index < count; index++) {
    const id = `object-${index}`
    project.instances[id] = { id, definitionId: WEB_DEFINITION.id, data: { html: `<p>old ${index}</p>` } }
    testContainerInstance(project, 0).childIds.push(id)
  }
  const session = await DocumentSession.create({ documentId: 'public-write', epoch: 'epoch', binding: { kind: 'untitled', suggestedName: 'receipt.glx' },
    model: { kind: 'course-v10', project, resources: { assets: {}, components: {} } } }, new CourseV10Driver(),
  { async append() {}, async save() { throw new Error('No file save in receipt fixture') } })
  let current = session.read() as ComponentProjectSnapshot, sequence = 0
  const internalInputs: ContentApplyRequest[] = []
  let afterCommit: (() => Promise<void>) | undefined
  let coordinator!: ComponentProjectFileCoordinator
  const editsFor = (request: ContentApplyRequest): ComponentEdit[] => {
    if (request.intent === 'canonical') return request.edits
    if (!('source' in request)) throw new Error('Unexpected surface operation')
    if (request.target.kind === 'instance' && request.source.kind === 'html')
      return [{ type: 'data.set', instanceId: request.target.instanceId, path: ['html'], value: request.source.html }]
    if (request.intent === 'style' && request.target.kind === 'container') return []
    if (request.intent === 'insert' && request.target.kind === 'container' && request.source.kind === 'html')
      return [{ type: 'instance.insert', container: request.target.container, index: 0, rootIds: ['new-program'],
        instances: [{ id: 'new-program', definitionId: HTML_PROGRAM_DEFINITION.id, data: { html: request.source.html } }] }]
    throw new Error('Unexpected request in receipt fixture')
  }
  const apply = async (operationId: string, requestDigest: string, baseline: ComponentProjectSnapshot, requests: ContentApplyRequest[]): Promise<ContentApplyResult[]> => {
    internalInputs.push(...requests)
    const command = captureComponentOperation(baseline.model.project, requests.flatMap(editsFor))
    const receipt = await session.execute({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision,
      operationId, actor: 'agent', runId: 'run', requestDigest, mutation: { type: 'command', command } })
    current = session.read() as ComponentProjectSnapshot
    if (receipt.status === 'applied' || receipt.status === 'unchanged') {
      coordinator.acknowledge('run', current.documentId, current.epoch, current.revision, command)
      await afterCommit?.()
    }
    return requests.map(request => ({ commit: receipt.status === 'applied' ? 'committed' : receipt.status === 'unchanged' ? 'unchanged' : 'not_committed',
      usability: 'usable', delivery: 'not_requested', input: request, diagnostics: [], receipt,
      insertedIds: 'source' in request && request.intent === 'insert' ? ['new-program'] : [] }))
  }
  coordinator = new ComponentProjectFileCoordinator({ async document() { return current },
    async apply(_run, operationId, digest, baseline, request) { return (await apply(operationId, digest, baseline, [request]))[0] },
    async applyBatch(_run, operationId, digest, operations) { return apply(operationId, digest, operations[0].baseline, operations.map(item => item.request)) },
    async source() { throw new Error('No external source in receipt fixture') } })
  const files = () => componentProjectFiles(current.model.project, current.model.resources)
  const paths = files().filter(file => file.kind === 'html' && file.target?.kind === 'instance').map(file => file.path)
  const call = (name: 'project.read' | 'project.apply', input: object, operationId = `call-${++sequence}`) =>
    coordinator.execute('run', operationId, operationId, name, input)
  const human = async (edits: ComponentEdit[]) => {
    const before = current
    const receipt = await session.execute({ documentId: before.documentId, epoch: before.epoch, baseRevision: before.revision,
      operationId: `human-${++sequence}`, actor: 'human', mutation: { type: 'command', command: captureComponentOperation(before.model.project, edits) } })
    current = session.read() as ComponentProjectSnapshot
    return receipt
  }
  return { session, coordinator, call, paths, files, internalInputs, snapshot: () => current, human,
    onCommit: (callback: () => Promise<void>) => { afterCommit = callback } }
}

it.each([1, 4, 16])('keeps the public operation producer small for %i real Session writes at 1KB, 1MB and 5MB while values and Undo survive', async count => {
  const sizes: number[] = [], tokens: number[] = []
  for (const length of [1024, 1024 * 1024, 5 * 1024 * 1024]) {
    const h = await fixture(count), prefix = '<p>PAYLOAD_SENTINEL_', suffix = '</p>'
    const body = `${prefix}${'x'.repeat(length - prefix.length - suffix.length)}${suffix}`
    const initial = h.snapshot()
    const command = captureComponentOperation(initial.model.project, Array.from({ length: count }, (_, index) => ({
      type: 'data.set' as const, instanceId: `object-${index}`, path: ['html'], value: body,
    })))
    const original = await h.session.execute({ documentId: initial.documentId, epoch: initial.epoch, baseRevision: initial.revision,
      operationId: 'apply', actor: 'agent', mutation: { type: 'command', command } })
    const result = publicWriteToolResult('batch', { kind: 'document-operation', result: original, affected: [] })
    expect(result).toMatchObject({ kind: 'document-operation', result: { status: 'applied', documentId: 'public-write', operationId: 'apply', revision: 1 } })
    if (result.kind !== 'document-operation' || !('appliedChanges' in result.result)) throw new Error('Expected public operation changes')
    expect(result.result.appliedChanges?.changes).toHaveLength(count)
    for (const change of result.result.appliedChanges?.changes ?? []) {
      expect(change.path).toEqual(expect.arrayContaining(['data']))
      expect(change).not.toHaveProperty('value')
    }
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('PAYLOAD_SENTINEL')
    sizes.push(bytes(result)); tokens.push(estimateSerializedTokens(serialized))
    const internal = h.session.lookupOperation('apply')!
    const exact = 'appliedChanges' in internal && internal.appliedChanges?.changes.find(change => JSON.stringify(change.path) === JSON.stringify(['instances', 'object-0', 'data', 'html']))
    expect(exact && exact.value).toBe(body)
    const current = h.session.read() as ComponentProjectSnapshot
    expect(current.undoDepth).toBe(1)
    for (let index = 0; index < count; index++) expect((current.model.project.instances[`object-${index}`].data as { html: string }).html === body).toBe(true)
    expect((await h.session.execute({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision,
      operationId: 'undo', actor: 'human', mutation: { type: 'undo' } })).status).toBe('applied')
    const undone = h.session.read() as ComponentProjectSnapshot
    expect(undone.undoDepth).toBe(0)
    for (let index = 0; index < count; index++) expect(undone.model.project.instances[`object-${index}`].data).toEqual({ html: `<p>old ${index}</p>` })
  }
  expect(Math.max(...sizes)).toBeLessThanOrEqual(Math.min(...sizes) + 128)
  expect(Math.max(...tokens)).toBeLessThanOrEqual(Math.min(...tokens) + 128)
}, 60_000)

it('publishes one shared batch receipt at the coordinator top level and preserves per-item paths and indexes', async () => {
  const h = await fixture(4), body = `<p>BATCH_PAYLOAD_${'b'.repeat(1024)}</p>`
  for (const path of h.paths) await h.call('project.read', { path })
  const result = await h.call('project.apply', { operations: h.paths.map(path => ({ path, content: body })) }, 'batch')
  const receipt = data(result)
  expect(receipt).toMatchObject({ commit: 'committed', receipt: { status: 'applied', operationId: 'batch', revision: 1 } })
  expect(receipt.operations).toHaveLength(4)
  receipt.operations.forEach((operation: ToolResult, index: number) => {
    expect(data(operation)).toMatchObject({ operationIndex: index, path: h.paths[index], commit: 'committed' })
    expect(data(operation)).not.toHaveProperty('receipt')
    expect(data(operation)).not.toHaveProperty('input')
  })
  expect(JSON.stringify(result)).not.toContain('BATCH_PAYLOAD')
  expect(h.internalInputs).toHaveLength(4)
  expect(h.snapshot().undoDepth).toBe(1)
})

it('retains the current global layout viewport in an unchanged content receipt', async () => {
  const h = await fixture(), path = 'global/overlay.json'
  const observed = data(await h.call('project.read', { path }))
  const result = data(await h.call('project.apply', { path, intent: 'style', content: '<style>button { color: red }</style>' }))
  expect(observed.viewport).toEqual({ width: 1280, height: 720 })
  expect(result).toMatchObject({ commit: 'unchanged', path, viewport: observed.viewport })
  expect(h.snapshot().revision).toBe(0)
})

it('completes sixteen 5MB coordinator writes and actual Undo/Redo without discarding source or public receipt facts', async () => {
  const h = await fixture(16), prefix = '<p>LARGEST_PAYLOAD_', suffix = '</p>'
  const body = `${prefix}${'x'.repeat(5 * 1024 * 1024 - prefix.length - suffix.length)}${suffix}`
  for (const path of h.paths) await h.call('project.read', { path })
  const result = data(await h.call('project.apply', { operations: h.paths.map(path => ({ path, content: body })) }, 'largest-batch'))
  expect(result).toMatchObject({ commit: 'committed', receipt: { status: 'applied', revision: 1 } })
  expect(result.operations).toHaveLength(16)
  for (const [index, operation] of result.operations.entries()) {
    expect(data(operation)).toMatchObject({ path: h.paths[index], operationIndex: index, commit: 'committed' })
    expect(data(operation)).not.toHaveProperty('input')
    expect(data(operation)).not.toHaveProperty('receipt')
  }
  expect(bytes(result)).toBeLessThan(24_000)
  expect(JSON.stringify(result)).not.toContain('LARGEST_PAYLOAD')
  const applied = h.session.read() as ComponentProjectSnapshot
  expect(applied.undoDepth).toBe(1)
  for (let index = 0; index < 16; index++) expect((applied.model.project.instances[`object-${index}`].data as { html: string }).html === body).toBe(true)
  expect((await h.session.execute({ documentId: applied.documentId, epoch: applied.epoch, baseRevision: applied.revision,
    operationId: 'undo-largest', actor: 'human', mutation: { type: 'undo' } })).status).toBe('applied')
  const undone = h.session.read() as ComponentProjectSnapshot
  expect(undone.undoDepth).toBe(0)
  for (let index = 0; index < 16; index++) expect(undone.model.project.instances[`object-${index}`].data).toEqual({ html: `<p>old ${index}</p>` })
  expect((await h.session.execute({ documentId: undone.documentId, epoch: undone.epoch, baseRevision: undone.revision,
    operationId: 'redo-largest', actor: 'human', mutation: { type: 'redo' } })).status).toBe('applied')
  const redone = h.session.read() as ComponentProjectSnapshot
  expect(redone.undoDepth).toBe(1)
  for (let index = 0; index < 16; index++) expect((redone.model.project.instances[`object-${index}`].data as { html: string }).html === body).toBe(true)
}, 60_000)

it('does not echo 2MB rejected input, retaining the failing item, path and local repair', async () => {
  const h = await fixture(), file = h.files().find(file => file.kind === 'style' && file.target?.kind === 'instance')!
  await h.call('project.read', { path: file.path })
  const content = `{"bad":${'ERROR_INPUT_SENTINEL'.repeat(110_000)}`
  const result = await h.call('project.apply', { operations: [{ path: file.path, content }] })
  expect(data(result)).toMatchObject({ commit: 'not_committed', operations: [{ kind: 'error', data: { operationIndex: 0, path: file.path } }] })
  expect(data(result).operations[0].data.repair.read).toEqual(expect.arrayContaining([{ tool: 'project.read', input: { path: file.path } }]))
  expect(JSON.stringify(result)).not.toContain('ERROR_INPUT_SENTINEL'.repeat(20))
  expect(bytes(result)).toBeLessThan(content.length / 100)
  expect(h.snapshot().revision).toBe(0)
  expect(h.snapshot().undoDepth).toBe(0)
})

it('retains the useful complete generated Source entry, path and revision without adopting a later unread human value', async () => {
  const h = await fixture(0), page = h.files().find(file => file.kind === 'page')!
  await h.call('project.read', { path: page.path })
  const inserted = data(await h.call('project.apply', { path: page.path, intent: 'insert', content: '<button>Run</button>' }, 'insert'))
  const source = inserted.files.find((file: any) => file.type === 'source' && !file.path.includes('.dependencies/'))
  expect(source).toMatchObject({ complete: true, revision: 1, currentRevision: 1, content: expect.stringContaining('export default') })
  expect(source.path).toMatch(/\.view\.js$/)
  const replacement = source.content.replace('mount(context)', 'mount(context /* model */)')
  h.onCommit(async () => { await h.human([{ type: 'implementation.set', instanceId: 'new-program', implementation: {
    kind: 'source', language: 'javascript', source: 'export default { mount(){ return "UNREAD_HUMAN_VALUE" } }',
  } }]) })
  const edited = data(await h.call('project.apply', { path: source.path, content: replacement }, 'source-edit'))
  expect(edited).toMatchObject({ commit: 'committed', receipt: { revision: 2 }, currentRevision: 3 })
  expect(JSON.stringify(edited)).not.toContain('UNREAD_HUMAN_VALUE')
  const currentSource = edited.files.find((file: any) => file.path === source.path)
  expect(currentSource).toMatchObject({ complete: false, revision: 2, currentRevision: 3, staleSnapshot: true })
  expect(currentSource).not.toHaveProperty('content')
  h.onCommit(async () => {})
  const conflicted = data(await h.call('project.apply', { path: source.path, edits: [{ old: 'export default', new: 'export default /* next */' }] }, 'after-human'))
  expect(conflicted).toMatchObject({ commit: 'not_committed', receipt: { status: 'conflict' } })
  expect(h.snapshot().model.project.instances['new-program'].implementationOverride).toMatchObject({ source: expect.stringContaining('UNREAD_HUMAN_VALUE') })
})

it('keeps full ordinary operation records internally while the public lookup projection strips payload values', async () => {
  const h = await fixture(), path = h.paths[0]
  await h.call('project.read', { path })
  const body = `<p>ORDINARY_OPERATION_PAYLOAD_${'z'.repeat(1024 * 1024)}</p>`
  await h.call('project.apply', { path, content: body }, 'ordinary')
  const original = h.session.lookupOperation('ordinary')!
  const result = publicWriteToolResult('object.update', { kind: 'document-operation', result: original, affected: [] })
  expect(result).toMatchObject({ kind: 'document-operation', result: { documentId: 'public-write', operationId: 'ordinary', revision: 1 } })
  expect(JSON.stringify(result)).not.toContain('ORDINARY_OPERATION_PAYLOAD')
  const retained = h.session.lookupOperation('ordinary')!
  for (const record of [retained, original]) {
    const exact = 'appliedChanges' in record && record.appliedChanges?.changes.find(change => JSON.stringify(change.path) === JSON.stringify(['instances', 'object-0', 'data', 'html']))
    expect(exact && exact.value).toBe(body)
  }
})

it('keeps Gateway execute and lookup compact, reuses the same operation, and never echoes 2MB invalid arguments', async () => {
  const driver = new CourseV10Driver(), registry = new DocumentRegistry({ drivers: [driver],
    createId: () => crypto.randomUUID(), bindingKey: binding => binding.path,
    persistence: { async append() {}, async save() { throw new Error('No save in Gateway receipt fixture') } } })
  const project = createBlankCourseProjectV10('Gateway receipts')
  project.definitions[WEB_DEFINITION.id] = WEB_DEFINITION
  project.instances.web = { id: 'web', definitionId: WEB_DEFINITION.id, data: { html: '<p>old</p>' } }
  testContainerInstance(project, 0).childIds.push('web')
  const session = await registry.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'gateway.glx')
  const gateway = new DocumentToolGateway(registry, [driver], () => crypto.randomUUID())
  await gateway.beginRun({ runId: 'gateway', actor: 'agent', documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }] })
  try {
    const target = await gateway.issueTarget('gateway', session.documentId, { kind: 'course-instance', surfaceId: componentSurfaces(project)[0].id, instanceId: 'web' })
    const body = `<p>GATEWAY_PAYLOAD_${'g'.repeat(1024 * 1024)}</p>`
    const call = { name: 'object.update', input: { target, properties: { data: { html: body } } } }
    const result = await gateway.execute('gateway', 'write', call)
    expect(result).toMatchObject({ kind: 'document-operation', result: { status: 'applied', revision: 1 } })
    expect(bytes(result)).toBeLessThan(4000)
    expect(JSON.stringify(result)).not.toContain('GATEWAY_PAYLOAD')
    if (result.kind !== 'document-operation') throw new Error('Expected operation receipt')
    const lookup = await gateway.lookup('gateway', 'write', call)
    expect(lookup).toMatchObject({ kind: 'document-operation', result: result.result })
    expect(bytes(lookup)).toBeLessThan(4000)
    expect(await gateway.execute('gateway', 'write', call)).toMatchObject({ kind: 'document-operation', result: result.result })
    expect(session.read()).toMatchObject({ revision: 1, undoDepth: 1 })
    const internal = session.lookupOperation(result.result.operationId)!
    expect('appliedChanges' in internal).toBe(true)
    const exact = 'appliedChanges' in internal && internal.appliedChanges?.changes.find(change => JSON.stringify(change.path) === JSON.stringify(['instances', 'web', 'data', 'html']))
    expect(exact && exact.exists).toBe(true)
    expect(exact && exact.value === body).toBe(true)
    const invalid = await gateway.execute('gateway', 'invalid', { name: 'object.update', input: {
      target, epoch: 'model-forged', properties: { data: { html: 'INVALID_GATEWAY_PAYLOAD'.repeat(100_000) } },
    } })
    expect(invalid).toMatchObject({ kind: 'error', code: 'invalid-input' })
    expect(bytes(invalid)).toBeLessThan(20_000)
    expect(JSON.stringify(invalid)).not.toContain('INVALID_GATEWAY_PAYLOAD'.repeat(20))
    expect(session.read()).toMatchObject({ revision: 1, undoDepth: 1 })
  } finally { await gateway.stop('gateway') }
})
