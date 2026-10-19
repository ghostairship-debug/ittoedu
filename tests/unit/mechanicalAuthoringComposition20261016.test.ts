// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { componentProjectFiles } from '../../src/core/projectFiles/componentPlatform/projection'
import { ContentApplyService } from '../../src/main/workbench/contentApply/applyService'
import { InMemoryComponentCompilation } from '../../src/core/components/compilation/InMemoryComponentCompilation'
import { createEsbuildComponentCompiler } from '../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'
import { WEB_DEFINITION } from '../../src/components/web/data'
import { interactionBehavior, interactionRules } from '../../src/shared/componentInteractionData'
import type { ContentApplyRequest } from '../../src/core/contentApply/planning/types'
import type { ComponentProjectSnapshot } from '../../src/core/projectFiles/componentPlatform/coordinator'
import { contentApplyFact, committedFact, modelToolResult, serviceToolOutcome, reconciledToolResult } from '../../src/core/tools/modelToolResult'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform'
import type { DocumentResources } from '../../src/shared/workbench/document'

async function harness(configure?: (project: CourseProjectV10, resources: DocumentResources) => void, sources: Record<string, string> = {}) {
  const project = createBlankCourseProjectV10('Assembly'), surfaceId = project.surfaces[0]!.id
  project.surfaces.push({ ...structuredClone(project.surfaces[0]!), id: 'destination', title: 'Destination', childIds: [] })
  project.definitions[WEB_DEFINITION.id] = WEB_DEFINITION
  project.definitions.source = { id: 'source', role: 'content', implementation: { kind: 'source', language: 'javascript',
    source: 'export default { mount() { return { update() {}, dispose() {} }; } };' } }
  project.instances.html = { id: 'html', definitionId: WEB_DEFINITION.id, data: { html: '<h1>Before</h1>' },
    frame: { width: 300, height: 100, transform: [1, 0, 0, 1, 50, 70] } }
  project.instances.code = { id: 'code', definitionId: 'source', data: {},
    frame: { width: 200, height: 100, transform: [1, 0, 0, 1, 400, 70] } }
  project.surfaces[0]!.childIds = ['html', 'code']
  const resources: DocumentResources = { assets: {}, components: {} }
  configure?.(project, resources)
  const driver = new CourseV10Driver(), registry = new DocumentRegistry({ drivers: [driver], createId: randomUUID,
    bindingKey: binding => binding.path, persistence: { async append() {}, async save() { throw new Error('No save in this test') } } })
  const session = await registry.create({ kind: 'course-v10', project, resources }, 'assembly.h5lesson')
  const compilation = new InMemoryComponentCompilation(createEsbuildComponentCompiler())
  const service = (baseline: ComponentProjectSnapshot, request: ContentApplyRequest) => new ContentApplyService({
    compilation, session: { project: () => baseline.model.project, resources: () => baseline.model.resources,
      async dispatch() { throw new Error('Batch planning must never dispatch an item') } },
    async measure() { throw new Error('Existing content/source must keep its frame') },
  }).plan(request)
  let beforePlan: (() => Promise<void>) | undefined
  const gateway = new DocumentToolGateway(registry, [driver], randomUUID, { componentContent: {
    async source(from) { const text = sources[from]; if (text === undefined) throw new Error('No external file in this test'); return { filename: from, bytes: new TextEncoder().encode(text), text } },
    async apply() { throw new Error('Batch must use one final Session command') },
    async plan(input) { await beforePlan?.(); return service(input.baseline, input.request) },
  } })
  await gateway.beginRun({ runId: 'assembly', actor: 'agent', documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }] })
  const call = (name: string, input: Record<string, unknown>) => gateway.execute('assembly', randomUUID(), { name, input })
  const model = () => { const value = session.read().model; if (value.kind !== 'course-v10') throw new Error('Expected course'); return value }
  const files = componentProjectFiles(project, resources)
  const html = files.find(file => file.kind === 'html' && file.target?.kind === 'instance' && file.target.instanceId === 'html')!
  const source = files.find(file => file.binding?.kind === 'instance-source' && file.binding.instanceId === 'code' && !file.authorSource?.dependencyId)!
  await call('project.list', { limit: 1000 })
  return { project, resources, files, surfaceId, session, driver, gateway, call, model, html, source, stopDuringPlan() { beforePlan = () => gateway.stop('assembly') }, beforeNextPlan(action: () => Promise<void>) { beforePlan = async () => { beforePlan = undefined; await action() } } }
}

it('inserts a button and its formal click navigation in the same batch and undo', async () => {
  const h = await harness()
  const page = await h.gateway.issueTarget('assembly', h.session.documentId, { kind: 'course-surface', surfaceId: h.surfaceId })
  const destination = await h.gateway.issueTarget('assembly', h.session.documentId, { kind: 'course-surface', surfaceId: 'destination' })
  const before = h.session.read()
  const result = await h.call('batch', { operations: [
    { name: 'object.insert', input: { target: page, kind: 'shape', text: 'Continue', click: { action: 'location-go', value: destination } } },
    { name: 'object.insert', input: { target: page, kind: 'text', text: 'Caption' } },
  ] })
  expect(result, JSON.stringify(result)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const rules = interactionRules(interactionBehavior(h.model().project, { kind: 'surface', surfaceId: h.surfaceId }))
  expect(rules).toHaveLength(1)
  expect(rules[0]!.trigger.type).toBe('node.click')
  expect(rules[0]!.actions[0]!.action).toEqual({ type: 'location.go', locationId: 'destination' })
  expect(h.session.read().undoDepth).toBe(before.undoDepth + 1)
  const current = h.session.read()
  expect(await h.session.execute({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision,
    operationId: randomUUID(), actor: 'human', mutation: { type: 'undo' } })).toMatchObject({ status: 'applied' })
  expect(h.model().project.instances).toEqual(h.project.instances)
})

it('applies existing HTML and Source paths in one command, preserving frames and one undo', async () => {
  const h = await harness(), before = h.session.read()
  const source = 'export default { mount() { return { update() {}, dispose() {} }; }, value: 42 };'
  const result = await h.call('project.apply', { operations: [
    { path: h.html.path, content: '<h1>After</h1>' }, { path: h.source.path, content: source },
  ] })
  expect(result, JSON.stringify(result)).toMatchObject({ kind: 'read', data: { commit: 'committed', receipt: { status: 'applied' }, operations: [
    { kind: 'read', data: { commit: 'committed' } }, { kind: 'read', data: { commit: 'committed' } },
  ] } })
  expect(contentApplyFact('project.apply', result)?.commit).toBe('committed')
  expect(committedFact('project.apply', result)?.documentId).toBe(h.session.documentId)
  expect(JSON.stringify(modelToolResult('project.apply', result))).toContain(source)
  expect(JSON.stringify(modelToolResult('project.apply', result))).not.toContain('<h1>After</h1>')
  expect(h.model().project.instances.html.data).toMatchObject({ html: '<h1>After</h1>' })
  expect(h.model().project.instances.code.implementationOverride).toMatchObject({ source })
  expect(h.model().project.instances.html.frame).toEqual(h.project.instances.html.frame)
  expect(h.model().project.instances.code.frame).toEqual(h.project.instances.code.frame)
  expect(h.session.read().undoDepth).toBe(before.undoDepth + 1)
  const reopened = h.driver.load(h.driver.serialize(h.model()))
  expect(reopened.kind === 'course-v10' && reopened.project.instances).toEqual(h.model().project.instances)
  const current = h.session.read()
  expect(await h.session.execute({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision,
    operationId: randomUUID(), actor: 'human', mutation: { type: 'undo' } })).toMatchObject({ status: 'applied' })
  expect(h.model().project.instances).toEqual(h.project.instances)
})

it.each(['content', 'from', 'edits'] as const)('applies style intent to existing .content.html through %s, preserving its identity and one undo', async mode => {
  const content = '<style>h1{color:blue}</style><h1>After</h1><script>window.styleEdit=true</script>'
  const h = await harness(undefined, { 'style-edit.html': content }), before = h.session.read()
  const operation = { path: h.html.path, intent: 'style', ...(mode === 'from' ? { from: 'style-edit.html' }
    : mode === 'edits' ? { edits: [{ old: '<h1>Before</h1>', new: content }] } : { content }) }
  const result = await h.call('project.apply', { operations: [operation] })
  expect(result, JSON.stringify(result)).toMatchObject({ kind: 'read', data: { commit: 'committed', receipt: { status: 'applied' }, operations: [
    { kind: 'read', data: { commit: 'committed' } },
  ] } })
  const current = h.model(), edited = current.project.instances.html
  expect(edited).toMatchObject({ id: 'html', definitionId: h.project.instances.html.definitionId,
    frame: h.project.instances.html.frame, data: { html: expect.stringContaining('<h1>After</h1>') } })
  expect(edited.data).toMatchObject({ html: expect.stringContaining('h1{color:blue}') })
  expect(edited.data).toMatchObject({ html: expect.stringContaining('window.styleEdit=true') })
  expect(Object.keys(current.project.instances)).toEqual(Object.keys(h.project.instances))
  expect(current.project.instances.code).toEqual(h.project.instances.code)
  expect(current.project.surfaces).toEqual(h.project.surfaces)
  expect(h.session.read().undoDepth).toBe(before.undoDepth + 1)
  const reopened = h.driver.load(h.driver.serialize(current))
  expect(reopened.kind === 'course-v10' && reopened.project.instances).toEqual(current.project.instances)
  const applied = h.session.read()
  expect(await h.session.execute({ documentId: applied.documentId, epoch: applied.epoch, baseRevision: applied.revision,
    operationId: randomUUID(), actor: 'human', mutation: { type: 'undo' } })).toMatchObject({ status: 'applied' })
  expect(h.model().project.instances).toEqual(h.project.instances)
  expect(h.session.read().undoDepth).toBe(before.undoDepth)
})

it('returns current professional data and Source paths when a group HTML edit cannot represent its children', async () => {
  const h = await harness(project => {
    project.instances.html.childIds = ['code']
    project.surfaces[0]!.childIds = ['html']
  }), before = h.session.read()
  const source = h.files.find(file => file.binding?.kind === 'instance-source' && file.binding.instanceId === 'code' && !file.authorSource?.dependencyId)!
  const data = h.files.find(file => file.kind === 'data' && file.target?.kind === 'instance' && file.target.instanceId === 'code')!
  const result = await h.call('project.apply', { path: h.html.path, content: '<h1>Replacement</h1>' })
  expect(result, JSON.stringify(result)).toMatchObject({ kind: 'error', code: 'professional-target-required', data: {
    commit: 'not_committed', files: expect.arrayContaining([
      expect.objectContaining({ path: data.path, type: 'data' }), expect.objectContaining({ path: source.path, type: 'source' }),
    ]), repair: { read: expect.arrayContaining([
      { tool: 'project.read', input: { path: data.path } }, { tool: 'project.read', input: { path: source.path } },
    ]) },
  } })
  expect(h.model().project.instances).toEqual(h.project.instances)
  expect(h.session.read().revision).toBe(before.revision)
  expect(h.session.read().undoDepth).toBe(before.undoDepth)
})

it('keeps a failed group HTML repair on its observed alias after same-definition siblings exchange paths', async () => {
  const h = await harness(project => {
    project.instances.other = { ...structuredClone(project.instances.html), id: 'other', data: { html: '<h1>Object B</h1>' } }
    project.instances.html.data = { html: '<h1>Object A</h1>' }
    project.instances.html.childIds = ['code']
    project.surfaces[0]!.childIds = ['html', 'other']
  })
  const other = h.files.find(file => file.kind === 'html' && file.target?.kind === 'instance' && file.target.instanceId === 'other')!
  const observed = h.session.read()
  expect(await h.session.execute({ documentId: observed.documentId, epoch: observed.epoch, baseRevision: observed.revision,
    operationId: randomUUID(), actor: 'human', mutation: { type: 'command', command: captureComponentOperation(h.model().project, [
      { type: 'instance.move', instanceId: 'other', container: { kind: 'surface', surfaceId: h.surfaceId }, index: 0 },
    ]) } })).toMatchObject({ status: 'applied' })
  const before = h.session.read()
  const current = componentProjectFiles(h.model().project, h.model().resources)
    .find(file => file.kind === 'html' && file.target?.kind === 'instance' && file.target.instanceId === 'html')!
  expect(current.path).toBe(other.path)
  const result = await h.call('project.apply', { path: h.html.path, intent: 'style', content: '<h1>Replacement</h1>' })
  expect(result, JSON.stringify(result)).toMatchObject({ kind: 'error', code: 'professional-target-required', data: {
    commit: 'not_committed', files: expect.arrayContaining([expect.objectContaining({ path: h.html.path, type: 'html' })]),
  } })
  if (result.kind !== 'error') throw new Error(JSON.stringify(result))
  const repair = result.data as { repair: { read: { tool: string; input: { path: string } }[] } }
  const htmlReads = repair.repair.read.filter(item => item.input.path.endsWith('.content.html'))
  expect(htmlReads).toEqual([{ tool: 'project.read', input: { path: h.html.path } }])
  expect(repair.repair.read.some(item => item.input.path === other.path)).toBe(false)
  expect(await h.call('project.read', htmlReads[0]!.input)).toMatchObject({ kind: 'read', data: {
    path: h.html.path, content: '<h1>Object A</h1>',
  } })
  expect(h.session.read().model).toEqual(before.model)
  expect(h.session.read().revision).toBe(before.revision)
  expect(h.session.read().undoDepth).toBe(before.undoDepth)
})

it('keeps old observed CAS for every file and commits none when one is stale', async () => {
  const h = await harness(), before = h.session.read()
  expect(await h.session.execute({ documentId: before.documentId, epoch: before.epoch, baseRevision: before.revision,
    operationId: randomUUID(), actor: 'human', mutation: { type: 'command', command: captureComponentOperation(h.model().project,
      [{ type: 'data.set', instanceId: 'html', path: ['html'], value: '<h1>Human</h1>' }]) } })).toMatchObject({ status: 'applied' })
  const result = await h.call('project.apply', { operations: [
    { path: h.html.path, content: '<h1>Stale</h1>' }, { path: h.source.path, content: 'export default { value: 9 };' },
  ] })
  expect(result, JSON.stringify(result)).toMatchObject({ kind: 'read', data: { commit: 'not_committed', receipt: { status: 'conflict' } } })
  expect(h.model().project.instances.html.data).toMatchObject({ html: '<h1>Human</h1>' })
  expect(h.model().project.instances.code).toEqual(h.project.instances.code)
  expect(h.session.read().undoDepth).toBe(before.undoDepth + 1)
})

it('retains broken Source with its local diagnostic and applies valid HTML beside an unresolved path', async () => {
  const h = await harness()
  const result = await h.call('project.apply', { operations: [
    { path: 'missing.html', content: 'unresolved' }, { path: h.html.path, content: '<h1>Usable</h1>' },
    { path: h.source.path, content: 'export default {' },
  ] })
  expect(result, JSON.stringify(result)).toMatchObject({ kind: 'read', data: { commit: 'committed', usability: 'partial', operations: [
    { kind: 'error', code: 'target-not-found' }, { kind: 'read', data: { commit: 'committed' } },
    { kind: 'read', data: { commit: 'committed', diagnostics: expect.arrayContaining([expect.objectContaining({ level: 'error', repairable: true })]) } },
  ] } })
  expect(serviceToolOutcome('project.apply', result)).toMatchObject({ status: 'failed' })
  expect(h.model().project.instances.html.data).toMatchObject({ html: '<h1>Usable</h1>' })
  expect(h.model().project.instances.code.implementationOverride).toMatchObject({ source: 'export default {' })
})

it('reports an unresolved file as failed even beside usable committed HTML', async () => {
  const h = await harness()
  const result = await h.call('project.apply', { operations: [
    { path: 'missing.html', content: 'unresolved' }, { path: h.html.path, content: '<h1>Usable</h1>' },
  ] })
  expect(contentApplyFact('project.apply', result)).toMatchObject({ commit: 'committed', usability: 'partial' })
  expect(serviceToolOutcome('project.apply', result)).toMatchObject({ status: 'failed' })
  expect(h.model().project.instances.html.data).toMatchObject({ html: '<h1>Usable</h1>' })
})

it('stops between file preparation and final commit without changing formal content', async () => {
  const h = await harness(), before = h.session.read()
  h.stopDuringPlan()
  const stopped = await h.call('project.apply', { operations: [{ path: h.html.path, content: '<h1>Stopped</h1>' }] })
  expect(stopped).toMatchObject({ kind: 'error', message: expect.stringContaining('已停止') })
  expect(h.gateway.runIdsForDocument(h.session.documentId)).toEqual([])
  expect(await h.call('project.list', {})).toMatchObject({ kind: 'error', code: 'run-stopped' })
  expect(h.model().project.instances).toEqual(h.project.instances)
  expect(h.session.read().undoDepth).toBe(before.undoDepth)
})

it('settles an unknown batch from its original receipt without replaying content or hiding local failures', async () => {
  const h = await harness(), execute = h.session.execute.bind(h.session), before = h.session.read()
  h.session.execute = async operation => {
    const receipt = await execute(operation)
    if (operation.runId === 'assembly') throw new Error('Lost ACK after the Session committed')
    return receipt
  }
  const call = { name: 'project.apply', input: { operations: [
    { path: 'missing.html', content: 'unresolved' }, { path: h.html.path, content: '<h1>Committed once</h1>' },
  ] } }
  const unknown = await h.gateway.execute('assembly', 'lost-ack', call)
  expect(contentApplyFact('project.apply', unknown)?.commit).toBe('unknown')
  expect(serviceToolOutcome('project.apply', unknown)?.status).toBe('unknown')
  const receipt = await h.gateway.lookup('assembly', 'lost-ack', call)
  expect(receipt).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const reconciled = reconciledToolResult('project.apply', unknown, receipt!)
  expect(committedFact('project.apply', reconciled)?.status).toBe('applied')
  expect(serviceToolOutcome('project.apply', reconciled)?.status).toBe('failed')
  expect(reconciled).toMatchObject({ kind: 'read', data: { operations: [
    { kind: 'error' }, { kind: 'read', data: { commit: 'committed' } },
  ] } })
  expect(h.session.read().undoDepth).toBe(before.undoDepth + 1)
  expect(h.model().project.instances.html.data).toMatchObject({ html: '<h1>Committed once</h1>' })
})

it('retains a known Source compile error when an unknown commit is later confirmed', async () => {
  const h = await harness(), execute = h.session.execute.bind(h.session)
  h.session.execute = async operation => {
    const receipt = await execute(operation)
    if (operation.runId === 'assembly') throw new Error('Lost ACK')
    return receipt
  }
  const call = { name: 'project.apply', input: { operations: [{ path: h.source.path, content: 'export default {' }] } }
  const unknown = await h.gateway.execute('assembly', 'source-lost-ack', call)
  expect(serviceToolOutcome('project.apply', unknown)?.status).toBe('unknown')
  const receipt = await h.gateway.lookup('assembly', 'source-lost-ack', call)
  const reconciled = reconciledToolResult('project.apply', unknown, receipt!)
  expect(contentApplyFact('project.apply', reconciled)?.commit).toBe('committed')
  expect(serviceToolOutcome('project.apply', reconciled)?.status).toBe('failed')
  expect(h.model().project.instances.code.implementationOverride).toMatchObject({ source: 'export default {' })
})

it('keeps usable HTML when a sibling professional-data file has an invalid field', async () => {
  const h = await harness()
  const page = await h.gateway.issueTarget('assembly', h.session.documentId, { kind: 'course-surface', surfaceId: h.surfaceId })
  const inserted = await h.call('object.insert', { target: page, kind: 'text', text: 'Professional text' })
  expect(inserted).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  await h.call('project.list', { limit: 1000 })
  const file = componentProjectFiles(h.model().project, h.model().resources).find(file => file.kind === 'data' && file.target?.kind === 'instance'
    && file.target.instanceId !== 'code')!
  const data = JSON.parse(file.content!)
  data.appearance = { ...data.appearance, fontSize: 'huge' }
  const result = await h.call('project.apply', { operations: [
    { path: file.path, content: JSON.stringify(data) }, { path: h.html.path, content: '<h1>Still usable</h1>' },
  ] })
  expect(result, JSON.stringify(result)).toMatchObject({ kind: 'read', data: { commit: 'committed', usability: 'partial', operations: [
    { kind: 'read', data: { commit: 'not_committed', usability: 'unusable' } }, { kind: 'read', data: { commit: 'committed' } },
  ] } })
  expect(h.model().project.instances.html.data).toMatchObject({ html: '<h1>Still usable</h1>' })
  expect(serviceToolOutcome('project.apply', result)?.status).toBe('failed')
})

it('combines two existing files of one shared Source workspace without overwriting either or its neighbor', async () => {
  const encode = (text: string) => new TextEncoder().encode(text)
  const originalMain = "import { value } from './module.js'; export default { value, mount() { return { update() {}, dispose() {} }; } };"
  const h = await harness((project, resources) => {
    project.definitions.source.implementation = { kind: 'source', language: 'javascript', workspace: { ownerId: 'shared', entry: 'main.js' } }
    resources.components.shared = { 'main.js': encode(originalMain), 'module.js': encode('export const value = 1;') }
    project.instances.neighbor = { ...structuredClone(project.instances.code), id: 'neighbor' }
    project.surfaces[0]!.childIds.push('neighbor')
  })
  const files = h.files.filter(file => file.binding?.kind === 'instance-source' && file.binding.instanceId === 'code')
  const main = files.find(file => file.sourceFile?.path === 'main.js')!
  const module = files.find(file => file.sourceFile?.path === 'module.js')!
  expect(main, JSON.stringify(files.map(file => ({ path: file.path, sourceFile: file.sourceFile?.path, author: !!file.authorSource })))).toBeDefined()
  expect(module).toBeDefined()
  const before = h.session.read()
  await h.session.execute({ documentId: before.documentId, epoch: before.epoch, baseRevision: before.revision,
    operationId: randomUUID(), actor: 'human', mutation: { type: 'command', command: captureComponentOperation(h.model().project,
      [{ type: 'project.title.set', title: 'Human title' }]) } })
  await h.call('project.read', { path: module.path })
  const changedMain = originalMain.replace('value, mount()', 'value, title: "Changed", mount()')
  const result = await h.call('project.apply', { operations: [
    { path: main.path, content: changedMain }, { path: module.path, content: 'export const value = 9;' },
  ] })
  expect(result, JSON.stringify(result)).toMatchObject({ kind: 'read', data: { commit: 'committed', operations: [
    { kind: 'read', data: { commit: 'committed' } }, { kind: 'read', data: { commit: 'committed' } },
  ] } })
  const implementation = h.model().project.instances.code.implementationOverride
  expect(implementation?.kind).toBe('source')
  const owner = implementation?.kind === 'source' ? implementation.workspace!.ownerId : ''
  expect(new TextDecoder().decode(h.model().resources.components[owner]!['main.js'])).toBe(changedMain)
  expect(new TextDecoder().decode(h.model().resources.components[owner]!['module.js'])).toBe('export const value = 9;')
  expect(h.model().resources.components.shared).toEqual(h.resources.components.shared)
  expect(h.model().project.instances.neighbor).toEqual(h.project.instances.neighbor)
  expect(h.model().project.title).toBe('Human title')
})

it.each(['entry-first', 'dependency-first'])('combines an author entry and its dependency (%s), preserving both and the shared neighbor', async order => {
  const original = "import { value } from './dep'; export default { value, mount() { return { update() {}, dispose() {} }; } };"
  const h = await harness(project => {
    project.definitions.source.implementation = { kind: 'source', language: 'javascript', source: original, moduleBindings: { './dep': 'dep' } }
    project.definitions.dep = { id: 'dep', role: 'content', implementation: { kind: 'source', language: 'javascript', source: 'export const value = 1;' } }
    project.instances.neighbor = { ...structuredClone(project.instances.code), id: 'neighbor' }
    project.surfaces[0]!.childIds.push('neighbor')
  })
  const entry = h.files.find(file => file.binding?.kind === 'instance-source' && file.binding.instanceId === 'code' && file.authorSource && !file.authorSource.dependencyId)!
  const dependency = h.files.find(file => file.binding?.kind === 'instance-source' && file.binding.instanceId === 'code' && file.authorSource?.dependencyId === 'dep')!
  const changed = original.replace('value, mount()', 'value, title: "Changed", mount()')
  const operations = [
    { path: entry.path, content: changed }, { path: dependency.path, content: 'export const value = 9;' },
  ]
  const result = await h.call('project.apply', { operations: order === 'entry-first' ? operations : operations.reverse() })
  expect(result, JSON.stringify(result)).toMatchObject({ kind: 'read', data: { commit: 'committed', operations: [
    { kind: 'read', data: { commit: 'committed' } }, { kind: 'read', data: { commit: 'committed' } },
  ] } })
  const implementation = h.model().project.instances.code.implementationOverride
  expect(implementation).toMatchObject({ source: changed })
  const dependencyId = implementation?.kind === 'source' ? implementation.moduleBindings!['./dep'] : ''
  expect(h.model().project.definitions[dependencyId].implementation).toMatchObject({ source: 'export const value = 9;' })
  expect(h.model().project.definitions.dep).toEqual(h.project.definitions.dep)
  expect(h.model().project.instances.neighbor).toEqual(h.project.instances.neighbor)
})


it('uses observed page paths for insertion and destination after titles change, with relative clicks in the same batch', async () => {
  const h = await harness()
  const page = h.files.find(file => file.kind === 'structure' && file.target?.kind === 'container'
    && file.target.container.kind === 'surface' && file.target.container.surfaceId === h.surfaceId)!.path
  const destination = h.files.find(file => file.kind === 'structure' && file.target?.kind === 'container'
    && file.target.container.kind === 'surface' && file.target.container.surfaceId === 'destination')!.path
  const before = h.session.read()
  await h.session.execute({ documentId: before.documentId, epoch: before.epoch, baseRevision: before.revision,
    operationId: randomUUID(), actor: 'human', mutation: { type: 'command', command: captureComponentOperation(h.model().project,
      [{ type: 'surface.title.set', surfaceId: 'destination', title: 'Human title' }]) } })
  const result = await h.call('batch', { operations: [
    { name: 'object.insert', input: { path: page, kind: 'shape', text: 'Destination', click: { action: 'location-go', value: destination } } },
    { name: 'object.insert', input: { target: page, kind: 'shape', text: 'Next', click: { action: 'scene.next' } } },
    { name: 'object.insert', input: { path: page, kind: 'shape', text: 'Previous', click: { action: 'scene.previous' } } },
  ] })
  expect(result, JSON.stringify(result)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const rules = interactionRules(interactionBehavior(h.model().project, { kind: 'surface', surfaceId: h.surfaceId }))
  expect(rules.map(rule => rule.actions[0].action)).toEqual([
    { type: 'location.go', locationId: 'destination' }, { type: 'scene.next' }, { type: 'scene.previous' },
  ])
  expect(h.model().project.surfaces[1].title).toBe('Human title')
  expect(h.session.read().undoDepth).toBe(before.undoDepth + 2)
})

it('never rebinds an observed deleted page path to the later same-name page', async () => {
  const h = await harness()
  const path = h.files.find(file => file.kind === 'structure' && file.target?.kind === 'container'
    && file.target.container.kind === 'surface' && file.target.container.surfaceId === 'destination')!.path
  const before = h.session.read()
  await h.session.execute({ documentId: before.documentId, epoch: before.epoch, baseRevision: before.revision,
    operationId: randomUUID(), actor: 'human', mutation: { type: 'command', command: captureComponentOperation(h.model().project,
      [{ type: 'surface.remove', surfaceId: 'destination' }, { type: 'surface.insert', index: 1,
        surface: { id: 'replacement', kind: 'slide', title: 'Destination', childIds: [] } }]) } })
  const current = h.session.read()
  expect(await h.call('object.insert', { path, kind: 'text', text: 'Wrong page' })).toMatchObject({ kind: 'error' })
  const page = h.files.find(file => file.kind === 'structure' && file.target?.kind === 'container'
    && file.target.container.kind === 'surface' && file.target.container.surfaceId === h.surfaceId)!.path
  expect(await h.call('object.insert', { path: page, kind: 'text', text: 'Wrong destination', click: { action: 'location-go', value: path } })).toMatchObject({ kind: 'error' })
  expect(h.session.read().revision).toBe(current.revision)
  expect(h.model().project.surfaces[1].childIds).toEqual([])
})

it('keeps read-only page targets read-only when addressed by path', async () => {
  const h = await harness()
  await h.gateway.beginRun({ runId: 'readonly', actor: 'agent', documents: [{ documentId: h.session.documentId, writable: [] }] })
  await h.gateway.execute('readonly', randomUUID(), { name: 'project.list', input: {} })
  const path = h.files.find(file => file.kind === 'structure')!.path
  const before = h.session.read()
  expect(await h.gateway.execute('readonly', randomUUID(), { name: 'object.insert', input: { path, kind: 'text', text: 'Denied' } })).toMatchObject({ kind: 'error' })
  expect(h.session.read().revision).toBe(before.revision)
})

it('adds multiple pages and their content/from drafts in one commit and undo, preserving existing pages', async () => {
  const h = await harness(undefined, { 'draft.html': '<p>From file</p>' }), before = h.session.read()
  let commits = 0
  const execute = h.session.execute.bind(h.session)
  h.session.execute = async operation => { if (operation.actor === 'agent') commits++; return execute(operation) }
  const result = await h.call('project.apply', { path: 'pages', intent: 'surface.add', pages: [
    { kind: 'slide', title: 'Literal', content: '<p>Literal draft</p>' },
    { kind: 'flow', title: 'File', from: 'draft.html' },
  ] })
  expect(result, JSON.stringify(result)).toMatchObject({ kind: 'read', data: { commit: 'committed', targets: [{ title: 'Literal' }, { title: 'File' }] } })
  expect(commits).toBe(1)
  expect(h.session.read().undoDepth).toBe(before.undoDepth + 1)
  expect(h.model().project.surfaces.slice(0, 2)).toEqual(h.project.surfaces)
  expect(h.model().project.surfaces.slice(2).every(surface => surface.childIds.length > 0)).toBe(true)
  expect(JSON.stringify(h.model().project)).toContain('Literal draft')
  expect(JSON.stringify(h.model().project)).toContain('From file')
  const current = h.session.read()
  await h.session.execute({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision,
    operationId: randomUUID(), actor: 'human', mutation: { type: 'undo' } })
  expect({ ...h.model().project, revision: h.project.revision }).toEqual(h.project)
})

it('preserves a concurrent human edit and does not partially commit a stale new-page draft', async () => {
  const h = await harness(), before = h.session.read()
  h.beforeNextPlan(async () => {
    const current = h.session.read()
    await h.session.execute({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision,
      operationId: randomUUID(), actor: 'human', mutation: { type: 'command', command: captureComponentOperation(h.model().project,
        [{ type: 'project.title.set', title: 'Human title during plan' }]) } })
  })
  const result = await h.call('project.apply', { path: 'pages', intent: 'surface.add', kind: 'spatial', title: 'Single', content: '<p>Single draft</p>' })
  expect(result, JSON.stringify(result)).toMatchObject({ kind: 'read', data: { commit: 'not_committed', receipt: { status: 'conflict' } } })
  expect(h.model().project.title).toBe('Human title during plan')
  expect(h.model().project.surfaces).toHaveLength(2)
  expect(h.session.read().undoDepth).toBe(before.undoDepth + 1)
})


it('adds a single page with its first draft without adopting the existing empty page', async () => {
  const h = await harness(), before = h.session.read()
  const result = await h.call('project.apply', { path: 'pages', intent: 'surface.add', kind: 'spatial', title: 'New scene', content: '<p>New scene draft</p>' })
  expect(result, JSON.stringify(result)).toMatchObject({ kind: 'read', data: { commit: 'committed', targets: [{ title: 'New scene', kind: 'spatial' }] } })
  expect(h.model().project.surfaces.slice(0, 2)).toEqual(h.project.surfaces)
  expect(h.model().project.surfaces[2].childIds.length).toBeGreaterThan(0)
  expect(h.session.read().undoDepth).toBe(before.undoDepth + 1)
})

it('preserves an explicitly read-only page selector even with a wider document grant', async () => {
  const h = await harness()
  const project = await h.gateway.issueTarget('assembly', h.session.documentId, { kind: 'course-surface', surfaceId: h.surfaceId }, { readOnly: true })
  await h.call('project.list', { project })
  const path = h.files.find(file => file.kind === 'structure' && file.target?.kind === 'container'
    && file.target.container.kind === 'surface' && file.target.container.surfaceId === h.surfaceId)!.path
  const before = h.session.read()
  expect(await h.call('object.insert', { project, path, kind: 'text', text: 'Denied' })).toMatchObject({ kind: 'error' })
  expect(h.session.read().revision).toBe(before.revision)
})

it('updates a shortcut click to relative navigation without leaving the previous navigation action', async () => {
  const h = await harness()
  const page = await h.gateway.issueTarget('assembly', h.session.documentId, { kind: 'course-surface', surfaceId: h.surfaceId })
  await h.call('object.insert', { target: page, kind: 'shape', text: 'Next', click: { action: 'scene.next' } })
  const rule = interactionRules(interactionBehavior(h.model().project, { kind: 'surface', surfaceId: h.surfaceId }))[0]
  if (rule.trigger.type !== 'node.click') throw new Error('Expected click')
  const target = await h.gateway.issueTarget('assembly', h.session.documentId, { kind: 'course-instance', surfaceId: h.surfaceId, instanceId: rule.trigger.nodeId })
  expect(await h.call('interaction.update', { target, change: { kind: 'click', action: 'scene.previous' } })).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  expect(interactionRules(interactionBehavior(h.model().project, { kind: 'surface', surfaceId: h.surfaceId }))[0].actions.map(step => step.action)).toEqual([{ type: 'scene.previous' }])
})


it('freezes navigation paths with the authorized batch even if a later directory refresh introduces the same name', async () => {
  const h = await harness()
  const page = h.files.find(file => file.kind === 'structure' && file.target?.kind === 'container'
    && file.target.container.kind === 'surface' && file.target.container.surfaceId === h.surfaceId)!.path
  const destination = h.files.find(file => file.kind === 'structure' && file.target?.kind === 'container'
    && file.target.container.kind === 'surface' && file.target.container.surfaceId === 'destination')!.path
  const call = { name: 'batch', input: { operations: [
    { name: 'object.insert', input: { path: page, kind: 'shape', text: 'Go', click: { action: 'location-go', value: destination } } },
  ] } }
  expect(await h.gateway.effectTargets('assembly', call)).toHaveLength(1)
  const before = h.session.read()
  await h.session.execute({ documentId: before.documentId, epoch: before.epoch, baseRevision: before.revision,
    operationId: randomUUID(), actor: 'human', mutation: { type: 'command', command: captureComponentOperation(h.model().project,
      [{ type: 'surface.remove', surfaceId: 'destination' }, { type: 'surface.insert', index: 1,
        surface: { id: 'replacement', kind: 'slide', title: 'Destination', childIds: [] } }]) } })
  await h.call('project.list', {})
  const current = h.session.read()
  expect(await h.gateway.execute('assembly', randomUUID(), call)).toMatchObject({ kind: 'error' })
  expect(h.session.read().revision).toBe(current.revision)
  expect(h.model().project.surfaces[0].childIds).toEqual(h.project.surfaces[0].childIds)
})
