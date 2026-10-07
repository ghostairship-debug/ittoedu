// @vitest-environment node
import { expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { WEB_DEFINITION, webDataSchema } from '../../src/components/web/data'
import type { ComponentEdit } from '../../src/shared/contracts/component-platform/operations'
import { TextDriver } from '../../src/core/drivers/TextDriver'
import { readHtmlAuthoringRecords, patchHtmlAuthoringRecords } from '../../src/shared/html/htmlAuthoringRecords'
import { prepareExecutionContentOutput, readEditableTargetContent, targetFootprint } from '../../src/core/tools/ToolTargets'
import type { ToolTarget } from '../../src/shared/workbench/tools'

it('applies a delayed local AI reply through Gateway while preserving human geometry and another object, and retains final CAS', async () => {
  const project = createBlankCourseProjectV10('在途共编'), driver = new CourseV10Driver()
  project.definitions[WEB_DEFINITION.id] = WEB_DEFINITION
  project.instances.a = { id: 'a', definitionId: WEB_DEFINITION.id, data: { html: '<p>Original</p>', authoringRecords: {
    local: { kind: 'text', scope: { item: 'one' }, binding: { kind: 'dom', path: [{ tag: 'p', index: 0 }], baseline: 'Original' }, overrides: { text: 'Human text' } },
  } } }
  project.instances.b = { id: 'b', definitionId: WEB_DEFINITION.id, data: { html: 'Other original' } }
  project.surfaces[0].childIds = ['a', 'b']
  const registry = new DocumentRegistry({ drivers: [driver], createId: () => crypto.randomUUID(), bindingKey: binding => binding.path,
    persistence: { async append() {}, async save() { throw new Error('unused') } } })
  const session = await registry.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, '共编.h5lesson')
  const gateway = new DocumentToolGateway(registry, [driver], () => crypto.randomUUID())
  const target = { kind: 'course-instance' as const, surfaceId: project.surfaces[0].id, instanceId: 'a', dataPath: ['authoringRecords', 'local', 'overrides', 'text'] }
  await gateway.beginRun({ runId: 'ai', actor: 'agent', documents: [{ documentId: session.documentId, writable: [target] }] })
  const handle = await gateway.issueTarget('ai', session.documentId, target)
  let release!: () => void
  const wait = new Promise<void>(resolve => { release = resolve })
  const ai = wait.then(() => gateway.execute('ai', 'reply', { name: 'text.replace', input: { target: handle, content: 'AI continued' } }))
  const human = async (edits: ComponentEdit[]) => {
    const current = session.read()
    if (current.model.kind !== 'course-v10') throw new Error('Expected V10')
    return session.execute({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision,
      operationId: crypto.randomUUID(), actor: 'human', mutation: { type: 'command', command: captureComponentOperation(current.model.project, edits) } })
  }
  expect(await human([{ type: 'data.set', instanceId: 'a', path: ['authoringRecords', 'local', 'overrides', 'geometry'], value: { translateX: 40, width: 220 } },
    { type: 'data.set', instanceId: 'b', path: ['html'], value: 'Human changed B' }])).toMatchObject({ status: 'applied' })
  release()
  expect(await ai).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const current = session.read()
  if (current.model.kind !== 'course-v10') throw new Error('Expected V10')
  expect(webDataSchema.parse(current.model.project.instances.a.data).authoringRecords!.local.overrides).toEqual({ text: 'AI continued', geometry: { translateX: 40, width: 220 } })
  expect(webDataSchema.parse(current.model.project.instances.b.data).html).toBe('Human changed B')
  const stale = await gateway.issueTarget('ai', session.documentId, target)
  expect(await human([{ type: 'data.set', instanceId: 'a', path: target.dataPath, value: 'Human changed same text' }])).toMatchObject({ status: 'applied' })
  expect(await gateway.execute('ai', 'conflicted-reply', { name: 'text.replace', input: { target: stale, content: 'Stale AI' } })).toMatchObject({ kind: 'error', code: 'target-conflict' })
  expect(await session.execute({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision, operationId: 'stale-final-cas', actor: 'agent',
    mutation: { type: 'command', command: captureComponentOperation(current.model.project, [{ type: 'data.set', instanceId: 'a', path: target.dataPath, value: 'Stale AI' }]) } })).toMatchObject({ status: 'conflict', code: 'stale-revision' })
})

it('edits the effective text of a geometry-only author record through its original scoped Gateway target', async () => {
  const project = createBlankCourseProjectV10('先移动后续写'), driver = new CourseV10Driver()
  project.definitions[WEB_DEFINITION.id] = WEB_DEFINITION
  project.instances.a = { id: 'a', definitionId: WEB_DEFINITION.id, data: { html: '<p>Original</p>', authoringRecords: {
    local: { kind: 'text', binding: { kind: 'dom', path: [{ tag: 'p', index: 0 }], baseline: 'Original' }, overrides: { geometry: { translateX: 40 } } },
  } } }
  project.surfaces[0].childIds = ['a']
  const registry = new DocumentRegistry({ drivers: [driver], createId: () => crypto.randomUUID(), bindingKey: binding => binding.path,
    persistence: { async append() {}, async save() { throw new Error('unused') } } })
  const session = await registry.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, '先移动后续写.h5lesson')
  const gateway = new DocumentToolGateway(registry, [driver], () => crypto.randomUUID())
  const target = { kind: 'course-instance' as const, surfaceId: project.surfaces[0].id, instanceId: 'a',
    dataPath: ['authoringRecords', 'local', 'overrides', 'text'] }
  await gateway.beginRun({ runId: 'ai', actor: 'agent', documents: [{ documentId: session.documentId, writable: [target] }] })
  const handle = await gateway.issueTarget('ai', session.documentId, target)
  expect(await gateway.execute('ai', 'reply', { name: 'text.replace', input: { target: handle, content: 'AI continued' } })).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const current = session.read()
  if (current.model.kind !== 'course-v10') throw new Error('Expected V10')
  expect(webDataSchema.parse(current.model.project.instances.a.data).authoringRecords!.local.overrides).toEqual({ geometry: { translateX: 40 }, text: 'AI continued' })
  expect(webDataSchema.parse(current.model.project.instances.a.data).html).toBe('<p>Original</p>')
})

it('edits a dynamic HTML author field through the real Gateway without losing concurrent geometry or another field', async () => {
  const driver = new TextDriver(), original = '<!doctype html><html><body><div id="app"></div><p>Static B</p><script>app.textContent = "Original"</script></body></html>'
  const registry = new DocumentRegistry({ drivers: [driver], createId: () => crypto.randomUUID(), bindingKey: binding => binding.path,
    persistence: { async append() {}, async save() { throw new Error('unused') } } })
  const session = await registry.create(driver.load(new TextEncoder().encode(original)), 'dynamic.html')
  const gateway = new DocumentToolGateway(registry, [driver], () => crypto.randomUUID())
  const target: Extract<ToolTarget, { kind: 'html-author-field' }> = { kind: 'html-author-field', authorKey: 'a', field: 'text',
    record: { kind: 'text', scope: { item: 'one' }, binding: { kind: 'dom', path: [{ tag: 'body', index: 1 }, { tag: 'div', index: 0, attributes: { id: 'app' } }], baseline: 'Original' }, overrides: {} } }
  const before = session.read()
  const contentOutput = prepareExecutionContentOutput(before, target)!
  expect(contentOutput.target).toEqual(target)
  expect(readEditableTargetContent(before.model, target)).toEqual({ text: 'Original', format: 'text' })
  expect(session.read().revision).toBe(0)
  await gateway.beginRun({ runId: 'html-ai', actor: 'agent', documents: [{ documentId: session.documentId, writable: [target] }], contentOutput })
  const handle = await gateway.issueTarget('html-ai', session.documentId, target)
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve }).then(() => gateway.execute('html-ai', 'reply', {
    name: 'text.replace', input: { target: handle, content: 'AI </script> & "continued"' },
  }))
  const human = async (edit: (records: ReturnType<typeof readHtmlAuthoringRecords>) => void) => {
    const snapshot = session.read()
    if (snapshot.model.kind !== 'text') throw new Error('Expected text')
    const records = readHtmlAuthoringRecords(snapshot.model.source); edit(records)
    return session.execute({ documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision,
      operationId: crypto.randomUUID(), actor: 'human', mutation: { type: 'command', command: { type: 'markdown.replace',
        source: patchHtmlAuthoringRecords(snapshot.model.source.replace('<p>Static B</p>', '<p>Human static B</p>'), records) } } })
  }
  expect(await human(records => {
    records.a = { ...target.record, overrides: { geometry: { translateX: 70, width: 260 } } }
    records.b = { ...target.record, scope: { item: 'two' }, overrides: { text: 'Human B' } }
  })).toMatchObject({ status: 'applied' })
  release()
  const result = await pending
  expect(result, JSON.stringify(result)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const current = session.read()
  if (current.model.kind !== 'text') throw new Error('Expected text')
  expect(readHtmlAuthoringRecords(current.model.source).a.overrides).toEqual({ text: 'AI </script> & "continued"', geometry: { translateX: 70, width: 260 } })
  expect(readHtmlAuthoringRecords(current.model.source).b.overrides.text).toBe('Human B')
  expect(current.model.source).toContain('<script>app.textContent = "Original"</script>')
  expect(current.model.source).toContain('<p>Human static B</p>')
  expect(driver.load(driver.serialize(current.model))).toEqual(current.model)
  const stale = await gateway.issueTarget('html-ai', session.documentId, target)
  await human(records => { records.a.overrides.text = 'Human same field' })
  expect(await gateway.execute('html-ai', 'stale', { name: 'text.replace', input: { target: stale, content: 'Stale AI' } })).toMatchObject({ kind: 'error', code: 'target-conflict' })
})

it('does not treat an ambiguous static sibling as the content of a dynamic scoped field', () => {
  const driver = new TextDriver(), source = '<body><p>Original</p><p>Static B</p><script>document.querySelector("p").dataset.itemId="one"</script></body>'
  const target: Extract<ToolTarget, { kind: 'html-author-field' }> = { kind: 'html-author-field', authorKey: 'a', field: 'text',
    record: { kind: 'text', scope: { 'dom:0:data-item-id': 'one' }, binding: { kind: 'dom',
      path: [{ tag: 'body', index: 1 }, { tag: 'p', index: 0 }], baseline: 'Original' }, overrides: {} } }
  const model = driver.load(new TextEncoder().encode(source))
  expect(targetFootprint(driver.load(new TextEncoder().encode(source.replace('Static B', 'Human B'))), target)).toBe(targetFootprint(model, target))
  expect(targetFootprint(driver.load(new TextEncoder().encode(source.replace('="one"', '="two"'))), target)).not.toBe(targetFootprint(model, target))
})
