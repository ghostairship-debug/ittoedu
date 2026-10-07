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
import { mapHtmlAuthorFieldTarget, prepareExecutionContentOutput, readEditableTargetContent, targetFootprint } from '../../src/core/tools/ToolTargets'
import type { ToolTarget } from '../../src/shared/workbench/tools'
import { JSDOM } from 'jsdom'
import { createInputData, inputDataSchema, INPUT_DEFINITION } from '../../src/components/input/data'
import { buildInputRuleFamily, inspectInputRuleFamily } from '../../src/core/tools/inputRuleFamily'
import { inputAuthoringContent } from '../../src/components/input/authoring'
import { createComponentInteractionRuntime } from '../../src/renderer/interactions/componentInteractionRuntime'
import { interactionBehavior, interactionRules } from '../../src/renderer/interactions/componentInteractionAuthoring'
import type { ComponentRuntimeContext } from '../../src/shared/contracts/component-platform/runtime'
import type { JsonValue } from '../../src/shared/contracts/component-platform/project'
import type { InteractionRule } from '../../src/shared/interactionTypes'

it('updates managed text answers through an object-only Gateway grant with live grading and one undo', async () => {
  const project = createBlankCourseProjectV10('局部改判题答案'), driver = new CourseV10Driver(), surfaceId = project.surfaces[0].id
  project.definitions[INPUT_DEFINITION.id] = INPUT_DEFINITION
  project.definitions[WEB_DEFINITION.id] = WEB_DEFINITION
  project.definitions.interactions = { id: 'interactions', role: 'behavior', implementation: { kind: 'builtin', key: 'guoling.interactions' } }
  const motion = (nodeId: string, show: boolean): InteractionRule['actions'][number]['action'] => ({ type: show ? 'node.enter' : 'node.exit', nodeId,
    effect: 'none', durationMs: 0, easing: 'linear' })
  let id = 0
  const config = { answerType: 'text' as const, answers: ['42'], correct: [motion('yes', true), motion('no', false)], error: [motion('yes', false), motion('no', true)] }
  const keys = { stateKey: 'input:answer:value', validityKey: 'input:answer:valid' }
  const family = buildInputRuleFamily('answer', keys, config, () => `original-${++id}`)
  project.instances.answer = { id: 'answer', definitionId: INPUT_DEFINITION.id, data: createInputData({ placeholder: '保留提示', acceptedAnswers: ['42'],
    answer: { type: 'text', ...keys, ruleFamilyRuleIds: family.map(rule => rule.id) } }) as unknown as JsonValue }
  for (const nodeId of ['yes', 'no']) project.instances[nodeId] = { id: nodeId, definitionId: WEB_DEFINITION.id, data: { html: nodeId }, visible: false }
  const other: InteractionRule = { id: 'other', enabled: true, trigger: { type: 'node.click', nodeId: 'yes' }, conditions: [],
    actions: [{ id: 'other-action', start: 'after-previous', delayMs: 0, action: motion('no', true) }] }
  project.instances.behavior = { id: 'behavior', definitionId: 'interactions', data: { rules: [...family, other] } as unknown as JsonValue,
    attachments: [{ instanceId: 'behavior', target: { kind: 'surface', surfaceId } }] }
  project.surfaces[0].childIds = ['answer', 'yes', 'no', 'behavior']
  project.logic = { courseState: [{ key: keys.stateKey, valueType: 'string', defaultValue: '' }, { key: keys.validityKey, valueType: 'boolean', defaultValue: false }], navigationGuards: [] }
  const registry = new DocumentRegistry({ drivers: [driver], createId: () => crypto.randomUUID(), bindingKey: binding => binding.path,
    persistence: { async append() {}, async save() { throw new Error('unused') } } })
  const session = await registry.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, '判题.h5lesson')
  const gateway = new DocumentToolGateway(registry, [driver], () => crypto.randomUUID())
  const target = { kind: 'course-instance' as const, surfaceId, instanceId: 'answer' }
  await gateway.beginRun({ runId: 'answer-ai', actor: 'agent', documents: [{ documentId: session.documentId, writable: [target] }] })
  const handle = await gateway.issueTarget('answer-ai', session.documentId, target)
  expect(await gateway.execute('answer-ai', 'answer-only', { name: 'object.update', input: { target: handle, properties: { data: { acceptedAnswers: ['84'] } } } }))
    .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const snapshot = session.read()
  if (snapshot.model.kind !== 'course-v10') throw new Error('Expected V10')
  const updated = snapshot.model.project, input = inputDataSchema.parse(updated.instances.answer.data)
  const behavior = interactionBehavior(updated, { kind: 'surface', surfaceId })!, rules = interactionRules(behavior)
  expect(input.placeholder).toBe('保留提示'); expect(input.acceptedAnswers).toEqual(['84'])
  expect(inspectInputRuleFamily('answer', inputAuthoringContent(updated.instances.answer), rules))
    .toMatchObject({ conflict: false, managed: true, config: { ...config, answers: ['84'] } })
  expect(rules.find(rule => rule.id === 'other')).toEqual(other)
  expect(updated.instances.yes).toEqual(project.instances.yes); expect(updated.instances.no).toEqual(project.instances.no)
  const values = new Map<string, unknown>([[keys.stateKey, '84'], [keys.validityKey, true]]), visible = new Map<string, boolean>()
  let submit: (() => unknown) | undefined
  const runtime = createComponentInteractionRuntime(() => ({ currentSurfaceId: () => surfaceId, currentStateId: () => null,
    courseState: { get: key => values.get(key), set: (key, value) => { values.set(key, value) } },
    subscribeTrigger(trigger, listener) { if (trigger.type === 'input.submit' && trigger.nodeId === 'answer') submit = listener; return () => {} },
    executeAction(action) { if (action.type === 'node.enter' || action.type === 'node.exit') visible.set(action.nodeId, action.type === 'node.enter'); return true },
    report(message) { throw new Error(message) } }))
  const mounted = await runtime.mount({ instance: behavior, scope: { signal: new AbortController().signal, isActive: () => true, cleanup() {} } } as unknown as ComponentRuntimeContext)
  try {
    submit?.(); await new Promise(resolve => setTimeout(resolve, 0))
    expect(visible.get('yes')).toBe(true); expect(visible.get('no')).toBe(false)
    values.set(keys.stateKey, '42'); submit?.(); await new Promise(resolve => setTimeout(resolve, 0))
    expect(visible.get('yes')).toBe(false); expect(visible.get('no')).toBe(true)
  } finally { await mounted.dispose() }
  const reopened = driver.load(driver.serialize(snapshot.model))
  expect(reopened.kind === 'course-v10' && reopened.project.instances.answer.data).toEqual(updated.instances.answer.data)
  expect(snapshot.undoDepth).toBe(1)
  expect(await session.execute({ documentId: snapshot.documentId, epoch: snapshot.epoch, operationId: 'undo-answer', actor: 'human', baseRevision: snapshot.revision,
    mutation: { type: 'undo' } })).toMatchObject({ status: 'applied' })
  const restored = session.read().model
  expect(restored.kind === 'course-v10' && restored.project.instances).toEqual(project.instances)
})

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

it('conflicts a delayed dynamic HTML reply after undo removes the human text record', async () => {
  const driver = new TextDriver(), original = '<body><div id="app"></div><script>app.textContent="Original"</script></body>'
  const registry = new DocumentRegistry({ drivers: [driver], createId: () => crypto.randomUUID(), bindingKey: binding => binding.path,
    persistence: { async append() {}, async save() { throw new Error('unused') } } })
  const session = await registry.create(driver.load(new TextEncoder().encode(original)), 'undo-dynamic.html')
  const target: Extract<ToolTarget, { kind: 'html-author-field' }> = { kind: 'html-author-field', authorKey: 'a', field: 'text',
    record: { kind: 'text', binding: { kind: 'dom', path: [{ tag: 'body', index: 1 }, { tag: 'div', index: 0, attributes: { id: 'app' } }], baseline: 'Original' },
      overrides: { text: 'Human prior', geometry: { translateX: 40 } } } }
  const before = session.read()
  expect(await session.execute({ documentId: before.documentId, epoch: before.epoch, baseRevision: before.revision, operationId: 'human-text', actor: 'human',
    mutation: { type: 'command', command: { type: 'markdown.replace', source: patchHtmlAuthoringRecords(original, { a: target.record }) } } })).toMatchObject({ status: 'applied' })
  const gateway = new DocumentToolGateway(registry, [driver], () => crypto.randomUUID())
  await gateway.beginRun({ runId: 'undo-ai', actor: 'agent', documents: [{ documentId: session.documentId, writable: [target] }] })
  const handle = await gateway.issueTarget('undo-ai', session.documentId, target), human = session.read()
  expect(await session.execute({ documentId: human.documentId, epoch: human.epoch, baseRevision: human.revision, operationId: 'undo-human', actor: 'human',
    mutation: { type: 'undo' } })).toMatchObject({ status: 'applied' })
  const undone = session.read()
  expect(readEditableTargetContent(undone.model, target)).toEqual({ text: 'Original', format: 'text' })
  expect(await gateway.execute('undo-ai', 'stale-reply', { name: 'text.replace', input: { target: handle, content: 'AI stale' } }))
    .toMatchObject({ kind: 'error', code: 'target-conflict' })
  expect(session.read().revision).toBe(undone.revision)
  expect(session.read().model).toEqual(driver.load(new TextEncoder().encode(original)))
  // A fresh first edit remains legal and must not resurrect the undone geometry.
  const fresh = await gateway.issueTarget('undo-ai', session.documentId, target)
  expect(await gateway.execute('undo-ai', 'fresh-reply', { name: 'text.replace', input: { target: fresh, content: 'Fresh edit' } }))
    .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const current = session.read()
  if (current.model.kind !== 'text') throw new Error('Expected text')
  expect(readHtmlAuthoringRecords(current.model.source).a.overrides).toEqual({ text: 'Fresh edit' })
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

it('keeps static HTML text and image attributes literal while mapping a concurrent edit before the exact field', async () => {
  const driver = new TextDriver(), source = '<!doctype html><html><body><header>B</header><p>same</p><p>same</p><img src="old.png"></body></html>'
  const registry = new DocumentRegistry({ drivers: [driver], createId: () => crypto.randomUUID(), bindingKey: binding => binding.path,
    persistence: { async append() {}, async save() { throw new Error('unused') } } })
  const session = await registry.create(driver.load(new TextEncoder().encode(source)), 'literal.html')
  const gateway = new DocumentToolGateway(registry, [driver], () => crypto.randomUUID())
  const from = source.lastIndexOf('same'), target: Extract<ToolTarget, { kind: 'html-author-field' }> = { kind: 'html-author-field', authorKey: 'selected-second', field: 'text',
    source: { from, to: from + 4 }, record: { kind: 'text', binding: { kind: 'dom', path: [{ tag: 'body', index: 1 }, { tag: 'p', index: 2 }], baseline: 'same' }, overrides: {} } }
  await gateway.beginRun({ runId: 'static', actor: 'agent', documents: [{ documentId: session.documentId, writable: [target] }] })
  const handle = await gateway.issueTarget('static', session.documentId, target), snapshot = session.read()
  expect(await session.execute({ documentId: snapshot.documentId, epoch: snapshot.epoch, operationId: 'human-b', actor: 'human', baseRevision: snapshot.revision,
    mutation: { type: 'command', command: { type: 'markdown.replace', source: source.replace('<header>B</header>', '<header>Human longer B</header>') } } })).toMatchObject({ status: 'applied' })
  const content = 'show <img src=x> & "fun"'
  expect(await gateway.execute('static', 'literal-text', { name: 'text.replace', input: { target: handle, content } })).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  let current = session.read()
  if (current.model.kind !== 'text') throw new Error('Expected text')
  const dom = new JSDOM(current.model.source)
  expect([...dom.window.document.querySelectorAll('p')].map(node => node.textContent)).toEqual(['same', content])
  expect(dom.window.document.querySelectorAll('img')).toHaveLength(1)
  expect(dom.window.document.querySelector('header')?.textContent).toBe('Human longer B')
  expect(readHtmlAuthoringRecords(current.model.source)).toEqual({})
  const imageFrom = current.model.source.indexOf('old.png'), imageTarget: Extract<ToolTarget, { kind: 'html-author-field' }> = {
    kind: 'html-author-field', authorKey: 'image', field: 'src', source: { from: imageFrom, to: imageFrom + 7, quote: '"' },
    record: { kind: 'image', binding: { kind: 'dom', path: [{ tag: 'body', index: 1 }, { tag: 'img', index: 3 }], baseline: 'old.png' }, overrides: {} },
  }
  await gateway.beginRun({ runId: 'image', actor: 'agent', documents: [{ documentId: session.documentId, writable: [imageTarget] }] })
  const imageHandle = await gateway.issueTarget('image', session.documentId, imageTarget), value = 'photo "quoted" & path.png'
  expect(await gateway.execute('image', 'literal-image', { name: 'text.replace', input: { target: imageHandle, content: value } })).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  current = session.read()
  if (current.model.kind !== 'text') throw new Error('Expected text')
  const reopened = driver.load(driver.serialize(current.model))
  if (reopened.kind !== 'text') throw new Error('Expected text')
  const parsed = new JSDOM(reopened.source).window.document
  expect(parsed.querySelector('img')?.getAttribute('src')).toBe(value)
  expect(parsed.querySelector('img')?.attributes.length).toBe(1)
  expect(parsed.querySelectorAll('p')[1]?.textContent).toBe(content)
})

it('retains a first static drag while a source-field AI reply is in flight and keeps its continuation on that object', async () => {
  const driver = new TextDriver(), source = '<!doctype html><html><body><p>Original</p><p>B</p></body></html>'
  const registry = new DocumentRegistry({ drivers: [driver], createId: () => crypto.randomUUID(), bindingKey: binding => binding.path,
    persistence: { async append() {}, async save() { throw new Error('unused') } } })
  const session = await registry.create(driver.load(new TextEncoder().encode(source)), 'first-drag.html')
  const gateway = new DocumentToolGateway(registry, [driver], () => crypto.randomUUID()), from = source.indexOf('Original')
  const target: Extract<ToolTarget, { kind: 'html-author-field' }> = { kind: 'html-author-field', authorKey: 'a', field: 'text', source: { from, to: from + 8 },
    record: { kind: 'text', binding: { kind: 'dom', path: [{ tag: 'body', index: 1 }, { tag: 'p', index: 0 }], baseline: 'Original' }, overrides: {} } }
  await gateway.beginRun({ runId: 'static-drag', actor: 'agent', documents: [{ documentId: session.documentId, writable: [target] }] })
  const handle = await gateway.issueTarget('static-drag', session.documentId, target), snapshot = session.read()
  const geometry = { translateX: 40, translateY: 30, width: 250 }
  // The existing HtmlSourceEditService's first geometry transaction adds this exact
  // software anchor and record together, without changing the selected body field.
  const moved = patchHtmlAuthoringRecords(source.replace('<p>Original', '<p data-cw-author-key="a">Original').replace('<p>B</p>', '<p>Human B</p>'), {
    a: { ...target.record, binding: { ...target.record.binding, path: [{ tag: 'body', index: 1 }, { tag: 'p', index: 0, attributes: { 'data-cw-author-key': 'a' } }] }, overrides: { geometry } },
  })
  expect(await session.execute({ documentId: snapshot.documentId, epoch: snapshot.epoch, operationId: 'human-first-drag', actor: 'human', baseRevision: snapshot.revision,
    mutation: { type: 'command', command: { type: 'markdown.replace', source: moved } } })).toMatchObject({ status: 'applied' })
  const result = await gateway.execute('static-drag', 'reply', { name: 'text.replace', input: { target: handle, content: 'AI <safe> & text' } })
  expect(result, JSON.stringify(result)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const current = session.read()
  if (current.model.kind !== 'text') throw new Error('Expected text')
  const records = readHtmlAuthoringRecords(current.model.source)
  expect(records.a.overrides).toEqual({ geometry })
  expect(records.a.binding.baseline).toBe('AI <safe> & text')
  expect([...new JSDOM(current.model.source).window.document.querySelectorAll('p')].map(node => node.textContent)).toEqual(['AI <safe> & text', 'Human B'])
  const followed = mapHtmlAuthorFieldTarget(moved, current.model.source, mapHtmlAuthorFieldTarget(source, moved, target), true)
  expect(readEditableTargetContent(current.model, followed).text).toBe('AI <safe> & text')
  const fresh = await gateway.issueTarget('static-drag', session.documentId, followed)
  expect(await gateway.execute('static-drag', 'continue', { name: 'text.replace', input: { target: fresh, content: 'Continued' } })).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
})
