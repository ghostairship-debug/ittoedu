// @vitest-environment node
import { expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { applyComponentOperation, captureComponentOperation, presentationComponentEdits, resizeComponentSurfacesEdits, componentParentMatrix } from '../../src/core/drivers/courseV10Operations'
import { composeMatrices } from '../../src/core/components/geometry'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { prepareCourseObjectPaste } from '../../src/renderer/composition/crossSurfaceCommands'
import { componentDefinitionPresentation, componentFieldPresentation } from '../../src/renderer/ui/properties/componentDefinitionPresentation'
import { WEB_DEFINITION, webDataSchema } from '../../src/components/web/data'
import { componentDefinitionBuiltinKey, resolveComponentPresentation, type JsonObject, type JsonValue } from '../../src/shared/contracts/component-platform/project'
import type { CapturedCourseTarget } from '../../src/renderer/documents/CourseV10DocumentBridge'
import type { InteractionRule } from '../../src/shared/interactionTypes'
import { createInputData, inputDataSchema, INPUT_DEFINITION } from '../../src/components/input/data'
import { buildInputRuleFamily } from '../../src/core/tools/inputRuleFamily'
import { createComponentInteractionRuntime } from '../../src/renderer/interactions/componentInteractionRuntime'
import { interactionBehavior, interactionRules } from '../../src/renderer/interactions/componentInteractionAuthoring'
import type { ComponentRuntimeContext } from '../../src/shared/contracts/component-platform/runtime'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { ContentApplyService } from '../../src/main/workbench/contentApply/applyService'
import { inspectComponentInputRules } from '../../src/components/input/authoring'
import { createChartData } from '../../src/components/chart/data'
import { createTableData, parseTableData } from '../../src/components/table/data'
import { buildCourseGlobalPropertiesOwner } from '../../src/renderer/ui/properties/CourseGlobalPropertiesContextBuilder'
import type { PropertiesOwnerReadModel } from '../../src/renderer/composition/properties/PropertiesAuthoringReadModel'
import type { ComponentEdit } from '../../src/shared/contracts/component-platform/operations'

async function semanticGateway(project: ReturnType<typeof fixture>) {
  const driver = new CourseV10Driver(), registry = new DocumentRegistry({ drivers: [driver], createId: () => crypto.randomUUID(), bindingKey: binding => binding.path,
    persistence: { async append() {}, async save() { throw new Error('unused') } } })
  const session = await registry.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'semantic.h5lesson')
  const gateway = new DocumentToolGateway(registry, [driver], () => crypto.randomUUID())
  await gateway.beginRun({ runId: 'semantic', actor: 'agent', documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }] })
  const handle = (target: Parameters<typeof gateway.issueTarget>[2]) => gateway.issueTarget('semantic', session.documentId, target)
  const call = async (name: string, input: Record<string, unknown>) => {
    const result = await gateway.execute('semantic', crypto.randomUUID(), { name, input })
    if (result.kind === 'error' && name !== 'read') throw new Error(JSON.stringify(result))
    return result
  }
  const model = () => { const value = session.read().model; if (value.kind !== 'course-v10') throw new Error('Expected V10'); return value }
  return { driver, session, gateway, handle, call, model }
}

it('maps scoped authoring files for identical components, captures pagination and applies the observed identity', async () => {
  const project = fixture(), surfaceId = project.surfaces[0].id
  project.instances.b = { ...project.instances.a, id: 'b', data: { html: 'Other' } }
  project.surfaces[0].childIds.push('b')
  project.surfaces[0].presentation = { states: [{ id: 'answer', title: '答案', overrides: { b: { data: { html: 'State before' }, style: { color: 'red' } } } }] }
  project.definitions[WEB_DEFINITION.id] = { ...WEB_DEFINITION, professionalBuiltinKey: 'guoling.web', implementation: {
    kind: 'source', language: 'javascript', source: 'export default {}', moduleBindings: { helper: 'helper' },
  } }
  project.definitions.helper = { id: 'helper', title: 'Helper', role: 'content', implementation: {
    kind: 'source', language: 'javascript', source: 'export default {}', moduleBindings: { nested: 'nested' },
  } }
  project.definitions.nested = { id: 'nested', title: 'Nested', role: 'content', implementation: { kind: 'source', language: 'javascript', source: 'export default { value: 7 }' } }
  const driver = new CourseV10Driver(), registry = new DocumentRegistry({ drivers: [driver], createId: () => crypto.randomUUID(), bindingKey: binding => binding.path,
    persistence: { async append() {}, async save() { throw new Error('unused') } } })
  const session = await registry.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'scoped.h5lesson')
  let pendingInput = true
  const gateway = new DocumentToolGateway(registry, [driver], () => crypto.randomUUID(), {
    async prepareInput() {
      if (!pendingInput) return
      pendingInput = false
      const current = session.read()
      if (current.model.kind !== 'course-v10') throw new Error('Expected V10')
      await session.execute({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision, operationId: 'input-ack', actor: 'human',
        mutation: { type: 'command', command: captureComponentOperation(current.model.project, [{ type: 'data.set', instanceId: 'b', path: ['html'], value: 'Input ACK' }]) } })
    },
    componentContent: {
      async source() { throw new Error('No external source') },
      async apply(input) {
        input.assertActive()
        return new ContentApplyService({ session: { project: () => input.baseline.model.project, resources: () => input.baseline.model.resources,
          dispatch: command => session.execute({ documentId: input.baseline.documentId, epoch: input.baseline.epoch, baseRevision: input.baseline.revision,
            operationId: input.operationId, requestDigest: input.requestDigest, runId: input.runId, runLeaseId: input.runLeaseId, actor: input.actor,
            mutation: { type: 'command', command } }) }, compilation: { async compile() { throw new Error('Data does not compile') } },
          async measure() { throw new Error('Data does not measure') } }).apply(input.request)
      },
    },
  })
  await gateway.beginRun({ runId: 'scope', actor: 'agent', documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }] })
  const call = (name: string, input: Record<string, unknown>) => gateway.execute('scope', crypto.randomUUID(), { name, input })
  const selected = await gateway.issueTarget('scope', session.documentId, { kind: 'course-instance', surfaceId, instanceId: 'b' })
  const read = await call('read', { target: selected })
  if (read.kind !== 'read') throw new Error(JSON.stringify(read))
  const data = read.data as { text: string; authoring: { project: string; files: { path: string; type: string }[]; revision: number } }
  expect(JSON.parse(data.text).data.html).toBe('Input ACK')
  expect(data.authoring.revision).toBe(session.read().revision)
  const ownFiles = data.authoring.files.filter(file => file.path.startsWith('pages/'))
  expect(ownFiles.length).toBeGreaterThan(0)
  expect(ownFiles.every(file => /\/02-/.test(file.path))).toBe(true)
  expect(data.authoring.files.some(file => file.path.includes('Helper.view'))).toBe(true)
  expect(data.authoring.files.some(file => file.path.includes('Nested.view'))).toBe(true)
  const dataPath = ownFiles.find(file => file.type === 'data')!.path
  expect(await call('project.read', { project: data.authoring.project, path: dataPath })).toMatchObject({ kind: 'read', data: { content: JSON.stringify({ html: 'Input ACK' }, null, 2) } })
  const listed = await call('project.list', { project: data.authoring.project, limit: 1 })
  if (listed.kind !== 'read') throw new Error(JSON.stringify(listed))
  const listing = listed.data as { nextOffset: number; revision: number }
  const before = session.read()
  if (before.model.kind !== 'course-v10') throw new Error('Expected V10')
  expect(await session.execute({ documentId: before.documentId, epoch: before.epoch, baseRevision: before.revision, operationId: 'human-order', actor: 'human',
    mutation: { type: 'command', command: captureComponentOperation(before.model.project, [{ type: 'instance.move', instanceId: 'b', container: { kind: 'surface', surfaceId }, index: 0 }]) } }))
    .toMatchObject({ status: 'applied' })
  const continuation = await call('project.list', { project: data.authoring.project, offset: listing.nextOffset, limit: 100 })
  expect(continuation).toMatchObject({ kind: 'read', data: { revision: listing.revision } })
  const neighbor = await call('read', { target: await gateway.issueTarget('scope', session.documentId, { kind: 'course-instance', surfaceId, instanceId: 'a' }) })
  if (neighbor.kind !== 'read') throw new Error(JSON.stringify(neighbor))
  const neighborAuthoring = (neighbor.data as typeof data).authoring
  expect(neighborAuthoring.files.find(file => file.path.startsWith('pages/') && file.type === 'data')?.path).toBe(dataPath)
  expect(await call('project.read', { project: neighborAuthoring.project, path: dataPath })).toMatchObject({ kind: 'read', data: { content: JSON.stringify({ html: 'Base' }, null, 2) } })
  // Refresh the original identity after a human reorder; its old natural path now names its neighbor.
  expect(await call('project.read', { project: data.authoring.project, path: dataPath })).toMatchObject({ kind: 'read', data: { content: JSON.stringify({ html: 'Input ACK' }, null, 2) } })
  const applied = await call('project.apply', { project: data.authoring.project, path: dataPath, content: JSON.stringify({ html: 'Selected changed' }) })
  expect(applied, JSON.stringify(applied)).toMatchObject({ kind: 'read', data: { commit: 'committed' } })
  const changed = session.read()
  if (changed.model.kind !== 'course-v10') throw new Error('Expected V10')
  expect(changed.model.project.instances.a.data).toEqual({ html: 'Base' })
  expect(changed.model.project.instances.b.data).toEqual({ html: 'Selected changed' })
  const stateRead = await call('read', { target: await gateway.issueTarget('scope', session.documentId, { kind: 'course-instance', surfaceId, instanceId: 'b' }), state: 'answer' })
  if (stateRead.kind !== 'read') throw new Error(JSON.stringify(stateRead))
  const stateAuthoring = (stateRead.data as typeof data).authoring
  const stateDataPath = stateAuthoring.files.find(file => file.path.startsWith('pages/') && file.type === 'data')!.path
  const stateStylePath = stateAuthoring.files.find(file => file.path.startsWith('pages/') && file.type === 'style')!.path
  expect(await call('project.read', { project: stateAuthoring.project, path: stateDataPath })).toMatchObject({ kind: 'read', data: { content: JSON.stringify({ html: 'State before' }, null, 2) } })
  expect(await call('project.apply', { project: stateAuthoring.project, path: stateDataPath, content: JSON.stringify({ html: 'State after' }) })).toMatchObject({ kind: 'read', data: { commit: 'committed' } })
  expect(await call('project.apply', { project: stateAuthoring.project, path: stateStylePath, content: JSON.stringify({ color: 'blue' }) })).toMatchObject({ kind: 'read', data: { commit: 'committed' } })
  const stateChanged = session.read()
  if (stateChanged.model.kind !== 'course-v10') throw new Error('Expected V10')
  expect(stateChanged.model.project.instances.b.data).toEqual({ html: 'Selected changed' })
  expect(stateChanged.model.project.instances.b.style).toBeUndefined()
  expect(resolveComponentPresentation(stateChanged.model.project, surfaceId, 'answer').instances.b).toMatchObject({ data: { html: 'State after' }, style: { color: 'blue' } })
  const page = await gateway.issueTarget('scope', session.documentId, { kind: 'course-surface', surfaceId })
  const pageRead = await call('read', { target: page })
  if (pageRead.kind !== 'read') throw new Error(JSON.stringify(pageRead))
  const pageFiles = (pageRead.data as typeof data).authoring.files
  expect(pageFiles.filter(file => file.path.startsWith('pages/') && file.type === 'data')).toHaveLength(2)
  const whole = await call('read', { target: await gateway.issueTarget('scope', session.documentId, { kind: 'document' }) })
  expect(whole.kind === 'read' && (whole.data as typeof data).authoring.files.some(file => file.path === 'project.json')).toBe(true)
})

it('shares live global settings and explicit state content through Gateway, preserving state order and one undo', async () => {
  const project = fixture(), surface = project.surfaces[0]
  project.instances.b = { ...project.instances.a, id: 'b', data: { html: 'Neighbor' } }; surface.childIds.push('b')
  surface.presentation = { states: [{ id: 'state', title: '答案', order: ['b', 'a'], overrides: {} }] }
  const { session, call, handle, model, driver } = await semanticGateway(project)
  let submitted: ComponentEdit[] = []
  const owner = buildCourseGlobalPropertiesOwner({ read: { project, surface, editingGlobal: true, selectedInstanceIds: [], selectedIsGlobal: false, selectedInstance: null, error: null } as unknown as PropertiesOwnerReadModel,
    selectedContext: null, assets: {}, key: 'global', liveTarget: () => ({ project, surfaceId: surface.id } as CapturedCourseTarget),
    submit: edits => { submitted = edits }, preview() {}, async ensureTeacherController() {}, editSource() {}, openAutomation() {}, report(error) { throw error } })!
  owner.commands.updatePlayback({ controls: 'none' })
  const before = session.read()
  expect(await session.execute({ documentId: before.documentId, epoch: before.epoch, baseRevision: before.revision, operationId: 'manual-playback', actor: 'human',
    mutation: { type: 'command', command: captureComponentOperation(project, submitted) } })).toMatchObject({ status: 'applied' })
  expect(await call('course.configure', { target: await handle({ kind: 'document' }), settings: { playback: { keyboardNavigation: false } } }))
    .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  expect(model().project.playback).toMatchObject({ controls: 'none', keyboardNavigation: false })
  const page = await handle({ kind: 'course-surface', surfaceId: surface.id })
  const observed = await call('listChildren', { target: page, state: '答案' })
  expect(observed.kind).toBe('read')
  if (observed.kind !== 'read') throw new Error('Expected state children')
  const children = observed.data as { target: string; label: string }[]
  const second = await call('read', { target: children[1].target })
  expect(second.kind === 'read' && JSON.parse((second.data as { text: string }).text).id).toBe('a')
  const undoDepth = session.read().undoDepth
  expect(await call('object.update', { target: children[1].target, properties: { data: { html: 'State answer' }, playbackInitialVisibility: 'hidden' } }))
    .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  expect(model().project.instances.a.data).toEqual({ html: 'Base' })
  expect(resolveComponentPresentation(model().project, surface.id, 'state').instances.a).toMatchObject({ data: { html: 'State answer' }, playbackInitialVisibility: 'hidden' })
  expect(session.read().undoDepth).toBe(undoDepth + 1)
  const reopened = driver.load(driver.serialize(model()))
  expect(reopened.kind === 'course-v10' && reopened.project.surfaces[0].presentation).toEqual(model().project.surfaces[0].presentation)
  const current = session.read()
  expect(await session.execute({ documentId: current.documentId, epoch: current.epoch, operationId: 'undo-state', actor: 'human', baseRevision: current.revision, mutation: { type: 'undo' } }))
    .toMatchObject({ status: 'applied' })
  expect(model().project.surfaces[0].presentation?.states[0].overrides).toEqual({})
  // Human undo changes the observed content; consume that current object before the next mutation.
  expect(await call('read', { target: await handle({ kind: 'course-instance', surfaceId: surface.id, instanceId: 'a', stateId: 'state' }) })).toMatchObject({ kind: 'read' })
  const stateRead = await call('read', { target: await handle({ kind: 'course-surface', surfaceId: surface.id }), state: 'state' })
  if (stateRead.kind !== 'read') throw new Error('Expected state read')
  expect(await call('presentation.update', { target: await handle({ kind: 'course-surface', surfaceId: surface.id }), action: 'delete', state: 'state' }))
    .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  expect(await call('read', { target: (stateRead.data as { target: string }).target })).toMatchObject({ kind: 'error' })
})

it('routes public input authoring and actual ContentApply data through managed grading with one undo', async () => {
  const project = fixture(), surfaceId = project.surfaces[0].id
  project.definitions[INPUT_DEFINITION.id] = INPUT_DEFINITION
  project.instances.answer = { id: 'answer', definitionId: INPUT_DEFINITION.id, data: createInputData({ acceptedAnswers: ['42'] }) as unknown as JsonValue }
  project.surfaces[0].childIds.push('answer')
  const { session, call, handle, model, driver } = await semanticGateway(project)
  const motion = (show: boolean): InteractionRule['actions'][number]['action'] => ({ type: show ? 'node.enter' : 'node.exit', nodeId: 'a', effect: 'none', durationMs: 0, easing: 'linear' })
  expect(await call('object.author', { target: await handle({ kind: 'course-instance', surfaceId, instanceId: 'answer' }), change: { kind: 'input-rules', request: { mode: 'apply', config: {
    answerType: 'text', answers: ['42'], correct: [motion(true)], error: [motion(false)],
  } } } })).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const captured = session.read(), baseline = model()
  const service = new ContentApplyService({ session: { project: () => baseline.project, resources: () => baseline.resources,
    dispatch: command => session.execute({ documentId: captured.documentId, epoch: captured.epoch, baseRevision: captured.revision, operationId: 'data-apply', actor: 'agent', mutation: { type: 'command', command } }) },
    compilation: { async compile() { throw new Error('Data edit must not compile') } }, async measure() { throw new Error('Data edit must not remeasure') } })
  expect(await service.apply({ intent: 'content', target: { kind: 'instance', instanceId: 'answer' }, source: { kind: 'data', fields: [{ path: ['acceptedAnswers'], value: ['84'] }] } }))
    .toMatchObject({ commit: 'committed', receipt: { status: 'applied' } })
  expect(inspectComponentInputRules(model().project, surfaceId, 'answer')).toMatchObject({ managed: true, conflict: false, config: { answers: ['84'] } })
  expect(model().project.instances.a).toEqual(project.instances.a)
  expect(session.read().undoDepth).toBe(captured.undoDepth + 1)
  const reopened = driver.load(driver.serialize(model()))
  expect(reopened.kind === 'course-v10' && inspectComponentInputRules(reopened.project, surfaceId, 'answer')).toMatchObject({ config: { answers: ['84'] } })
  const current = session.read()
  expect(await session.execute({ documentId: current.documentId, epoch: current.epoch, operationId: 'undo-data-apply', actor: 'human', baseRevision: current.revision, mutation: { type: 'undo' } })).toMatchObject({ status: 'applied' })
  expect(model().project.instances).toEqual(baseline.project.instances)
})

it('commits public professional, interaction, logic and media semantics with software identities', async () => {
  const project = fixture(), surfaceId = project.surfaces[0].id
  for (const key of ['table', 'chart']) project.definitions[key] = { id: key, role: 'content', implementation: { kind: 'builtin', key: `guoling.${key}` } }
  const table = createTableData({ rows: 2, columns: 2 })
  project.instances.table = { id: 'table', definitionId: 'table', data: table as unknown as JsonValue }
  project.instances.chart = { id: 'chart', definitionId: 'chart', data: createChartData() as unknown as JsonValue }
  project.surfaces[0].childIds.push('table', 'chart')
  const { session, call, handle, model, driver } = await semanticGateway(project)
  expect(await call('batch', { operations: [
    { name: 'object.author', input: { target: await handle({ kind: 'course-instance', surfaceId, instanceId: 'table' }), change: { kind: 'table', edit: { kind: 'insert-row', referenceRowId: table.rows[0].id, position: 'after' } } } },
    { name: 'object.author', input: { target: await handle({ kind: 'course-instance', surfaceId, instanceId: 'chart' }), change: { kind: 'chart', edit: { type: 'chart-type', chartType: 'donut' } } } },
  ] })).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  expect(session.read().undoDepth).toBe(1)
  expect(parseTableData(model().project.instances.table.data).rows).toHaveLength(3)
  expect(model().project.instances.chart.data).toMatchObject({ chartType: 'donut' })
  expect(await call('course.logic', { target: await handle({ kind: 'document' }), change: { kind: 'course-state.add', declaration: { key: 'done', valueType: 'boolean', defaultValue: false } } }))
    .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  expect(await call('interaction.update', { target: await handle({ kind: 'course-surface', surfaceId }), change: { kind: 'add', rule: {
    enabled: true, trigger: { type: 'node.click', nodeId: 'a' }, conditions: [], actions: [{ start: 'after-previous', delayMs: 0, action: { type: 'course-state.set', key: 'done', value: true } }],
  } } })).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  expect(await call('course.logic', { target: await handle({ kind: 'document' }), change: { kind: 'course-state.update', key: 'done', declaration: { key: 'complete', valueType: 'boolean', defaultValue: false } } }))
    .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const rules = interactionRules(interactionBehavior(model().project, { kind: 'surface', surfaceId }))
  expect(rules[0].id).toBeTruthy(); expect(rules[0].actions[0].id).toBeTruthy()
  expect(rules[0].actions[0].action).toEqual({ type: 'course-state.set', key: 'complete', value: true })
  expect(await call('course.media', { target: await handle({ kind: 'document' }), change: { kind: 'audio', settings: { channelVolumes: { music: .4 }, narrationDucking: { enabled: true } } } }))
    .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  expect(model().project.media?.audio).toMatchObject({ masterVolume: 1, channelVolumes: { music: .4, narration: 1 }, narrationDucking: { enabled: true } })
  const reopened = driver.load(driver.serialize(model()))
  expect(reopened.kind === 'course-v10' && reopened.project.logic).toEqual(model().project.logic)
  expect(reopened.kind === 'course-v10' && reopened.project.media).toEqual(model().project.media)
})

it('preserves base and named-state world frames in public reparent, and discovers global placement before page copy', async () => {
  const project = fixture(), surfaceId = project.surfaces[0].id
  project.definitions.group = { id: 'group', role: 'content', implementation: { kind: 'builtin', key: 'guoling.group' } }
  for (const [id, x] of [['left', 100], ['right', 400]] as const) project.instances[id] = { id, definitionId: 'group', data: {},
    frame: { width: 300, height: 200, transform: [1, 0, 0, 1, x, 0] }, childIds: id === 'left' ? ['a'] : [] }
  project.surfaces[0].childIds = ['left', 'right']
  project.surfaces[0].presentation = { states: [{ id: 'answer', title: '答案', overrides: {
    left: { frame: { width: 300, height: 200, transform: [1, 0, 0, 1, 200, 0] } },
    right: { frame: { width: 300, height: 200, transform: [1, 0, 0, 1, 700, 0] } },
    a: { frame: { width: 100, height: 30, transform: [1, 0, 0, 1, 30, 50] } },
  } }] }
  project.instances.global = { ...project.instances.a, id: 'global', name: 'Global marker', visibility: { mode: 'include', surfaceIds: [surfaceId] } }
  project.global.underlay.push('global')
  const { session, call, handle, model, driver } = await semanticGateway(project)
  const world = (value: typeof project, state: string | null) => {
    const view = resolveComponentPresentation(value, surfaceId, state)
    return composeMatrices(componentParentMatrix(view, 'a'), view.instances.a.frame!.transform)
  }
  const originalBase = world(project, null), originalState = world(project, 'answer')
  expect(await call('object.structure', { target: await handle({ kind: 'course-instance', surfaceId, instanceId: 'left', stateId: 'answer' }), action: 'move',
    destination: await handle({ kind: 'course-surface', surfaceId, stateId: 'answer' }), index: 1 })).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  expect(model().project.surfaces[0].childIds).toEqual(['left', 'right'])
  expect(model().project.surfaces[0].presentation?.states[0].order).toEqual(['right', 'left'])
  expect(model().project.surfaces[0].presentation?.states[0].overrides.left.frame).toEqual(project.surfaces[0].presentation.states[0].overrides.left.frame)
  expect(await call('object.structure', { target: await handle({ kind: 'course-instance', surfaceId, instanceId: 'a', stateId: 'answer' }), action: 'move',
    destination: await handle({ kind: 'course-instance', surfaceId, instanceId: 'right', stateId: 'answer' }) })).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  expect(model().project.instances.right.childIds).toEqual(['a'])
  expect(world(model().project, null)).toEqual(originalBase); expect(world(model().project, 'answer')).toEqual(originalState)
  expect(session.read().undoDepth).toBe(2)
  const reopened = driver.load(driver.serialize(model()))
  expect(reopened.kind === 'course-v10' && world(reopened.project, 'answer')).toEqual(originalState)
  const current = session.read()
  expect(await session.execute({ documentId: current.documentId, epoch: current.epoch, operationId: 'undo-reparent', actor: 'human', baseRevision: current.revision, mutation: { type: 'undo' } })).toMatchObject({ status: 'applied' })
  expect(model().project.instances).toEqual(project.instances)
  const listed = await call('listChildren', { target: await handle({ kind: 'document' }) })
  if (listed.kind !== 'read') throw new Error('Expected document children')
  const global = (listed.data as { target: string; label: string }[]).find(item => item.label.endsWith('Global marker'))!
  expect(global).toBeTruthy()
  expect(await call('object.place', { target: global.target, placement: { kind: 'global', plane: 'overlay' } })).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  expect(model().project.global.overlay).toContain('global'); expect(model().project.instances.global.visibility).toEqual(project.instances.global.visibility)
  const sourcePage = model().project.surfaces[0]
  expect(await call('surface.duplicate', { target: await handle({ kind: 'course-surface', surfaceId }) })).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const copy = model().project.surfaces[1]
  const copiedState = copy.presentation!.states[0], sourceState = sourcePage.presentation!.states[0]
  expect(copiedState.id).not.toBe(sourceState.id)
  expect(copy.title).toBe(sourcePage.title + ' 副本'); expect(copiedState.title).toBe(sourceState.title)
  expect(copy.childIds).not.toEqual(project.surfaces[0].childIds)
  const [copiedLeft, copiedRight] = copy.childIds, copiedChild = model().project.instances[copiedLeft].childIds![0]
  expect(copiedState.overrides).toEqual({
    [copiedLeft]: sourceState.overrides.left, [copiedRight]: sourceState.overrides.right, [copiedChild]: sourceState.overrides.a,
  })
  expect(copiedState.order).toEqual([copiedRight, copiedLeft])
  expect(model().project.instances[copiedChild].frame).toEqual(model().project.instances.a.frame)
  expect(model().project.instances[copiedRight].childIds).toEqual([])
  expect(model().project.instances.global.visibility?.surfaceIds).toEqual([surfaceId, copy.id])
})

it('passes the measured frame through public nested Flow body to overlay placement and one undo', async () => {
  const project = fixture(), surface = project.surfaces[0], surfaceId = surface.id
  surface.kind = 'flow'; delete surface.designSize
  project.definitions.group = { id: 'group', role: 'content', implementation: { kind: 'builtin', key: 'guoling.group' } }
  project.instances.group = { id: 'group', definitionId: 'group', data: {}, childIds: ['a'] }
  delete project.instances.a.frame
  project.instances.b = { ...project.instances.a, id: 'b' }
  project.instances.floating = { ...project.instances.a, id: 'floating', frame: { width: 100, height: 30, transform: [1, 0, 0, 1, 0, 0] }, flowPlacement: { space: 'paper', plane: 'overlay' } }
  surface.childIds = ['group', 'floating', 'b']
  const { session, call, handle, model } = await semanticGateway(project)
  const frame = { width: 320, height: 180, transform: [1, 0, 0, 1, 20, 30] }
  expect(await call('object.place', { target: await handle({ kind: 'course-instance', surfaceId, instanceId: 'a' }), placement: {
    kind: 'flow-overlay', placement: { space: 'paper', plane: 'overlay', paragraphAnchor: { blockId: 'group', offsetY: 12, xRatio: .5 } }, frame,
  } })).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  expect(model().project.surfaces[0].childIds).toEqual(['group', 'floating', 'b', 'a'])
  expect(model().project.instances.group.childIds).toEqual([])
  expect(model().project.instances.a).toMatchObject({ id: 'a', frame, flowPlacement: { space: 'paper', plane: 'overlay', paragraphAnchor: { blockId: 'group', offsetY: 12, xRatio: .5 } } })
  expect(session.read().undoDepth).toBe(1)
  const current = session.read()
  expect(await session.execute({ documentId: current.documentId, epoch: current.epoch, operationId: 'undo-flow-place', actor: 'human', baseRevision: current.revision, mutation: { type: 'undo' } })).toMatchObject({ status: 'applied' })
  expect(model().project.instances).toEqual(project.instances)
  const reading = () => model().project.surfaces[0].childIds.filter(id => !model().project.instances[id].flowPlacement)
  expect(await call('object.structure', { target: await handle({ kind: 'course-instance', surfaceId, instanceId: 'group' }), action: 'reorder', direction: 'forward' }))
    .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  expect(reading()).toEqual(['b', 'group'])
  expect(await call('object.structure', { target: await handle({ kind: 'course-instance', surfaceId, instanceId: 'group' }), action: 'reorder', direction: 'back' }))
    .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  expect(reading()).toEqual(['group', 'b'])
})

function fixture() {
  const project = createBlankCourseProjectV10('完整作者对象')
  project.definitions[WEB_DEFINITION.id] = WEB_DEFINITION
  project.instances.a = { id: 'a', definitionId: WEB_DEFINITION.id, data: { html: 'Base' }, frame: { width: 100, height: 30, transform: [1, 0, 0, 1, 10, 20] } }
  project.surfaces[0].childIds = ['a']
  return project
}
it('deletes presentation references in one canonical operation without broadening conditions or breaking scene jumps', () => {
  const project = fixture(), surface = project.surfaces[0]!, sid = surface.id
  project.definitions.interactions = { id: 'interactions', role: 'behavior', implementation: { kind: 'builtin', key: 'guoling.interactions' } }
  const rule = (id: string, action: InteractionRule['actions'][number]['action']): InteractionRule => ({ id, enabled: true,
    trigger: { type: 'node.click', nodeId: 'a' }, conditions: [], actions: [{ id: id + '-action', start: 'after-previous', delayMs: 0, action }] })
  const enter = rule('enter', { type: 'scene.next' }); enter.trigger = { type: 'presentation.enter', stateId: 'gone' }
  const set = rule('set', { type: 'presentation.set', stateId: 'gone' })
  const chain = rule('chain', { type: 'scene.next' }); chain.trigger = { type: 'animation.completed', actionId: 'set-action' }
  const condition = rule('condition', { type: 'scene.next' }); condition.conditions = [{ type: 'presentation.in', stateIds: ['gone'] }]
  const mixed = rule('mixed', { type: 'scene.go', sceneId: sid, targetStateId: 'gone' }); mixed.conditions = [{ type: 'presentation.in', stateIds: ['gone', 'stay'] }]
  const continued = rule('continued', { type: 'presentation.set', stateId: 'gone' }); continued.actions.push({ id: 'next-action', start: 'after-previous', delayMs: 0, action: { type: 'scene.next' } })
  const data = (rules: InteractionRule[]) => ({ rules }) as unknown as JsonValue
  project.instances.behavior = { id: 'behavior', definitionId: 'interactions', data: data([enter, set, chain, condition, mixed, continued]),
    attachments: [{ instanceId: 'behavior', target: { kind: 'surface', surfaceId: sid } }] }
  surface.childIds.push('behavior')
  const nav = Object.values(project.instances).find(instance => componentDefinitionBuiltinKey(project.definitions[instance.definitionId]) === 'guoling.navigation')!
  nav.data = { buttons: [{ id: 'go', action: { type: 'scene.go', sceneId: sid, targetStateId: 'gone' } }] }
  surface.presentation = { initialStateId: 'stay', states: [
    { id: 'gone', title: '删除', overrides: {} },
    { id: 'stay', title: '保留', overrides: { behavior: { data: data([mixed]) }, [nav.id]: { data: structuredClone(nav.data) } } },
  ] }
  project.instances.otherBehavior = { id: 'otherBehavior', definitionId: 'interactions', data: data([set, rule('other-jump', { type: 'scene.go', sceneId: sid, targetStateId: 'gone' })]),
    attachments: [{ instanceId: 'otherBehavior', target: { kind: 'surface', surfaceId: 'other' } }] }
  project.surfaces.push({ id: 'other', kind: 'slide', title: '其他页', childIds: ['otherBehavior'],
    presentation: { states: [{ id: 'gone', title: '同名仍存在', overrides: {} }] } })
  const command = captureComponentOperation(project, [{ type: 'surface.presentation.set', surfaceId: sid,
    presentation: { ...surface.presentation, states: surface.presentation.states.filter(state => state.id !== 'gone') } }])
  const result = applyComponentOperation(project, command)
  const rules = (result.instances.behavior.data as unknown as { rules: InteractionRule[] }).rules
  expect(rules.map(value => value.id)).toEqual(['mixed', 'continued'])
  expect(rules[0]).toMatchObject({ conditions: [{ type: 'presentation.in', stateIds: ['stay'] }], actions: [{ action: { type: 'scene.go', sceneId: sid } }] })
  expect(rules[0]!.actions[0]!.action).not.toHaveProperty('targetStateId')
  expect(rules[1]!.actions).toEqual([{ id: 'next-action', start: 'after-previous', delayMs: 0, action: { type: 'scene.next' } }])
  expect(result.instances.nav?.data ?? result.instances[nav.id].data).toEqual({ buttons: [{ id: 'go', action: { type: 'scene.go', sceneId: sid } }] })
  const state = result.surfaces[0]!.presentation!.states[0]!
  expect(state.overrides[nav.id]!.data).toEqual(result.instances[nav.id].data)
  expect((state.overrides.behavior!.data as unknown as { rules: InteractionRule[] }).rules[0]!.conditions).toEqual([{ type: 'presentation.in', stateIds: ['stay'] }])
  expect((result.instances.otherBehavior.data as unknown as { rules: InteractionRule[] }).rules[0]).toEqual(set)
  const stale = structuredClone(project); (stale.instances[nav.id].data as JsonObject).title = 'Human controller title'
  expect(() => applyComponentOperation(stale, command)).toThrow('目标内容或归属已变化')
  const driver = new CourseV10Driver(), model = { kind: 'course-v10' as const, project: result, resources: { assets: {}, components: {} } }
  const reopened = driver.load(driver.serialize(model))
  expect(reopened.kind === 'course-v10' && reopened.project.instances[nav.id].data).toEqual(result.instances[nav.id].data)
})
it('copies ordinary click programs and managed input feedback through the real executor as one undoable author object', async () => {
  const project = fixture(), surface = project.surfaces[0]!, surfaceId = surface.id, resources = { assets: {}, components: {} }
  project.definitions[INPUT_DEFINITION.id] = INPUT_DEFINITION
  project.definitions.interactions = { id: 'interactions', role: 'behavior', implementation: { kind: 'builtin', key: 'guoling.interactions' } }
  const motion = (nodeId: string, show = true): InteractionRule['actions'][number]['action'] => ({ type: show ? 'node.enter' : 'node.exit', nodeId, effect: 'none', durationMs: 0, easing: 'linear' })
  for (const id of ['correct', 'error', 'unrelated']) project.instances[id] = { ...project.instances.a, id, visible: false }
  let serial = 0
  const family = buildInputRuleFamily('input', { stateKey: 'input:input:value', validityKey: 'input:input:valid' }, {
    answerType: 'text', answers: ['42'], correct: [motion('error', false), motion('correct')], error: [motion('correct', false), motion('error')],
  }, () => `family-${++serial}`)
  project.instances.input = { id: 'input', definitionId: INPUT_DEFINITION.id, data: createInputData({ answer: {
    type: 'text', stateKey: 'input:input:value', validityKey: 'input:input:valid', ruleFamilyRuleIds: family.map(rule => rule.id),
  } }) as unknown as JsonValue }
  const click: InteractionRule = { id: 'click', enabled: true, trigger: { type: 'node.click', nodeId: 'a' }, conditions: [],
    actions: [{ id: 'click-action', start: 'after-previous', delayMs: 0, action: motion('correct') }] }
  const complete: InteractionRule = { id: 'complete', enabled: true, trigger: { type: 'animation.completed', actionId: 'click-action' }, conditions: [],
    actions: [{ id: 'complete-action', start: 'after-previous', delayMs: 0, action: motion('error', false) }] }
  const unrelated: InteractionRule = { ...click, id: 'unrelated-rule', trigger: { type: 'node.click', nodeId: 'unrelated' }, actions: [{ ...click.actions[0]!, id: 'unrelated-action', action: { type: 'scene.next' } }] }
  project.instances.behavior = { id: 'behavior', definitionId: 'interactions', data: { rules: [...family, click, complete, unrelated] } as unknown as JsonValue,
    attachments: [{ instanceId: 'behavior', target: { kind: 'surface', surfaceId } }] }
  surface.childIds = ['a', 'input', 'error', 'unrelated', 'behavior']
  project.global.overlay.push('correct')
  project.instances.other = { ...project.instances.a, id: 'other' }
  const otherRule: InteractionRule = { ...unrelated, id: 'other-rule', trigger: { type: 'node.click', nodeId: 'other' },
    actions: [{ ...unrelated.actions[0]!, id: 'other-action' }] }
  project.instances.otherBehavior = { id: 'otherBehavior', definitionId: 'interactions', data: { rules: [otherRule] } as unknown as JsonValue,
    attachments: [{ instanceId: 'otherBehavior', target: { kind: 'surface', surfaceId: 'other-page' } }] }
  project.surfaces.push({ id: 'other-page', kind: 'slide', title: 'Other page', childIds: ['other', 'otherBehavior'],
    presentation: { states: [{ id: 'unrelated-state', title: 'Unrelated state', overrides: { otherBehavior: { data: { rules: [{ ...otherRule, enabled: false }] } as unknown as JsonValue } } }] } })
  project.logic = { courseState: [{ key: 'input:input:value', valueType: 'string', defaultValue: '' }, { key: 'input:input:valid', valueType: 'boolean', defaultValue: false }], navigationGuards: [] }
  surface.presentation = { states: [{ id: 'answer', title: '另一状态', overrides: { behavior: { data: { rules: [...family,
    { ...click, actions: [{ ...click.actions[0]!, action: motion('error') }] }, unrelated] } as unknown as JsonValue } } }] }
  const target: CapturedCourseTarget = { documentId: 'doc', epoch: 'epoch', project, editingProject: project, resources, activeStateId: null, surfaceId, instanceIds: ['a', 'input'], instanceId: 'a' }
  const plan = prepareCourseObjectPaste({ documentId: 'doc', project, roots: ['a', 'input'], resources },
    { capturedTarget: target, container: { kind: 'surface', surfaceId }, index: surface.childIds.length, offset: { x: 20, y: 20 } })
  expect(plan.idMap.has('correct')).toBe(true); expect(plan.idMap.has('error')).toBe(true)
  expect(plan.idMap.has('unrelated')).toBe(false)
  const driver = new CourseV10Driver(), session = await DocumentSession.create({ documentId: 'doc', epoch: 'epoch', model: { kind: 'course-v10', project, resources },
    binding: { kind: 'untitled', suggestedName: 'program-copy.h5lesson' } }, driver, { async append() {}, async save() { throw new Error('unused') } })
  expect(await session.execute({ documentId: 'doc', epoch: 'epoch', operationId: 'copy-semantic', baseRevision: 0, actor: 'human',
    mutation: { type: 'command', command: captureComponentOperation(project, plan.edits) } })).toMatchObject({ status: 'applied' })
  const snapshot = session.read()
  if (snapshot.model.kind !== 'course-v10') throw new Error('Expected V10')
  const copied = snapshot.model.project, inputId = plan.idMap.get('input')!, buttonId = plan.idMap.get('a')!, correctId = plan.idMap.get('correct')!, errorId = plan.idMap.get('error')!
  expect(copied.surfaces[0].presentation?.states.map(state => state.id)).toEqual(['answer'])
  const input = inputDataSchema.parse(copied.instances[inputId].data), copiedRules = interactionRules(interactionBehavior(copied, { kind: 'surface', surfaceId }))
  expect(input.answer!.ruleFamilyRuleIds.every(id => copiedRules.some(rule => rule.id === id) && !family.some(rule => rule.id === id))).toBe(true)
  expect(copiedRules.filter(rule => rule.id === 'unrelated-rule')).toHaveLength(1)
  const execute = async (stateId: string | null) => {
    const effective = resolveComponentPresentation(copied, surfaceId, stateId), behavior = interactionBehavior(effective, { kind: 'surface', surfaceId })!
    const listeners = new Map<string, () => void>(), visible = new Map<string, boolean>(), values = new Map<string, unknown>([[input.answer!.stateKey, '42'], [input.answer!.validityKey, true]])
    const runtime = createComponentInteractionRuntime(() => ({ currentSurfaceId: () => surfaceId, currentStateId: () => stateId,
      courseState: { get: key => values.get(key), set: (key, value) => { values.set(key, value) } },
      subscribeTrigger(trigger, listener) { listeners.set(JSON.stringify(trigger), listener); return () => { listeners.delete(JSON.stringify(trigger)) } },
      executeAction(action) { if (action.type === 'node.enter' || action.type === 'node.exit') { expect(copied.instances[action.nodeId]).toBeDefined(); visible.set(action.nodeId, action.type === 'node.enter') }; return true }, report(message) { throw new Error(message) } }))
    const mounted = await runtime.mount({ instance: behavior, scope: { signal: new AbortController().signal, isActive: () => true,
      events: { subscribe() { return () => {} } }, cleanup() {} } } as unknown as ComponentRuntimeContext)
    const emit = async (type: 'node.click' | 'input.submit', nodeId: string) => { listeners.get(JSON.stringify({ type, nodeId }))?.(); await new Promise(resolve => setTimeout(resolve, 0)) }
    try {
      await emit('node.click', buttonId)
      expect(visible.get(stateId ? errorId : correctId)).toBe(true)
      expect(visible.has('correct') || visible.has('error')).toBe(false)
      if (!stateId) {
        expect(visible.get(errorId)).toBe(false)
        await emit('input.submit', inputId); expect(visible.get(correctId)).toBe(true); expect(visible.get(errorId)).toBe(false)
        values.set(input.answer!.stateKey, 'wrong'); await emit('input.submit', inputId)
        expect(visible.get(correctId)).toBe(false); expect(visible.get(errorId)).toBe(true)
      }
    } finally { await mounted.dispose() }
  }
  await execute(null); await execute('answer')
  expect(driver.load(driver.serialize(snapshot.model)).kind).toBe('course-v10')
  expect(snapshot.undoDepth).toBe(1)
  expect(await session.execute({ documentId: 'doc', epoch: 'epoch', operationId: 'undo-semantic-copy', baseRevision: snapshot.revision, actor: 'human', mutation: { type: 'undo' } })).toMatchObject({ status: 'applied' })
  const restored = session.read().model
  expect(restored.kind === 'course-v10' && restored.project.instances).toEqual(project.instances)
})
it('enforces inherited author locks for data, frame and named-state edits while allowing an explicit unlock', () => {
  const project = fixture()
  project.instances.group = { id: 'group', definitionId: WEB_DEFINITION.id, data: { html: '' }, childIds: ['a'], locked: true }
  project.surfaces[0].childIds = ['group']
  for (const edits of [
    [{ type: 'data.set' as const, instanceId: 'a', path: ['html'], value: 'Changed' }],
    [{ type: 'frame.set' as const, instanceId: 'a', frame: { width: 200, height: 30, transform: [1, 0, 0, 1, 10, 20] as [number, number, number, number, number, number] } }],
    [{ type: 'surface.presentation.set' as const, surfaceId: project.surfaces[0].id, presentation: { states: [{ id: 'answer', title: '答案', overrides: { a: { visible: false } } }] } }],
  ]) expect(() => applyComponentOperation(project, captureComponentOperation(project, edits))).toThrow('已锁定')
  const unlocked = applyComponentOperation(project, captureComponentOperation(project, [
    { type: 'instance.patch', instanceId: 'group', patch: { locked: false } },
    { type: 'data.set', instanceId: 'a', path: ['html'], value: 'Changed' },
  ]))
  expect(webDataSchema.parse(unlocked.instances.a.data).html).toBe('Changed')
  expect(webDataSchema.parse(project.instances.a.data).html).toBe('Base')
})
it('blocks changed interaction rules targeting a locked author object without blocking unrelated rule edits', () => {
  const project = fixture()
  project.instances.a.locked = true
  project.instances.b = { ...project.instances.a, id: 'b', locked: false }
  project.definitions.interactions = { id: 'interactions', role: 'behavior', implementation: { kind: 'builtin', key: 'guoling.interactions' } }
  const rule = (id: string, nodeId: string) => ({ id, enabled: true, trigger: { type: 'node.click', nodeId }, conditions: [],
    actions: [{ id: `${id}-action`, start: 'after-previous', delayMs: 0, action: { type: 'node.enter', nodeId, effect: 'none', durationMs: 0, easing: 'linear' } }] })
  const lockedRule = rule('locked-rule', 'a'), otherRule = rule('other-rule', 'b')
  project.instances.behavior = { id: 'behavior', definitionId: 'interactions', data: { rules: [lockedRule, otherRule] } }
  project.surfaces[0].childIds.push('b', 'behavior')
  const change = (rules: ReturnType<typeof rule>[]) => captureComponentOperation(project,
    [{ type: 'data.set', instanceId: 'behavior', path: ['rules'], value: rules }])
  expect(() => applyComponentOperation(project, change([{ ...lockedRule, enabled: false }, otherRule]))).toThrow('已锁定')
  expect(() => applyComponentOperation(project, change([otherRule]))).toThrow('已锁定')
  const updated = applyComponentOperation(project, change([lockedRule, { ...otherRule, enabled: false }]))
  expect(updated.instances.behavior.data).toEqual({ rules: [lockedRule, { ...otherRule, enabled: false }] })
  expect(updated.instances.a).toEqual(project.instances.a)
})
it('copies base values, all named states and local records in one undoable saved transaction', async () => {
  const project = fixture(), surfaceId = project.surfaces[0].id
  project.instances.a.data = { html: 'Base', authoringRecords: { local: { kind: 'text', scope: { item: 'a' },
    binding: { kind: 'dom', path: [{ tag: 'p', index: 0 }], baseline: 'Original' }, overrides: { text: 'Human', geometry: { translateX: 12 } } } } }
  project.surfaces[0].presentation = { states: [
    { id: 'question', title: '问题', overrides: { a: { visible: false } }, order: ['a'] },
    { id: 'answer', title: '答案', overrides: { a: { data: { html: 'Answer' }, frame: { width: 150, height: 40, transform: [1, 0, 0, 1, 40, 60] } } }, order: ['a'] },
  ] }
  const resources = { assets: {}, components: {} }
  const target: CapturedCourseTarget = { documentId: 'doc', epoch: 'epoch', project, resources,
    editingProject: resolveComponentPresentation(project, surfaceId, 'answer'), activeStateId: 'answer', surfaceId, instanceIds: ['a'], instanceId: 'a' }
  const plan = prepareCourseObjectPaste({ documentId: 'doc', project, roots: ['a'], resources },
    { capturedTarget: target, container: { kind: 'surface', surfaceId }, index: 1, keepOwner: true, offset: { x: 20, y: 20 } })
  const driver = new CourseV10Driver(), session = await DocumentSession.create({ documentId: 'doc', epoch: 'epoch',
    model: { kind: 'course-v10', project, resources }, binding: { kind: 'untitled', suggestedName: 'copy.h5lesson' } }, driver,
  { async append() {}, async save() { throw new Error('Archive check uses the real Driver') } })
  expect(await session.execute({ documentId: 'doc', epoch: 'epoch', operationId: 'copy', baseRevision: 0, actor: 'human',
    mutation: { type: 'command', command: captureComponentOperation(project, plan.edits) } })).toMatchObject({ status: 'applied' })
  const snapshot = session.read(), model = snapshot.model
  if (model.kind !== 'course-v10') throw new Error('Expected V10')
  const id = plan.idMap.get('a')!, copied = model.project.instances[id]
  expect(webDataSchema.parse(copied.data).authoringRecords).toEqual(webDataSchema.parse(project.instances.a.data).authoringRecords)
  expect(webDataSchema.parse(copied.data).html).toBe('Base')
  expect(model.project.surfaces[0].presentation?.states[0].overrides[id]).toEqual({ visible: false })
  expect(model.project.surfaces[0].presentation?.states[1].overrides[id]).toMatchObject({ data: { html: 'Answer' }, frame: { transform: [1, 0, 0, 1, 60, 80] } })
  expect(model.project.surfaces[0].presentation?.states[1].order).toEqual(['a', id])
  const reopened = driver.load(driver.serialize(model))
  if (reopened.kind !== 'course-v10') throw new Error('Expected V10')
  expect(reopened.project.instances.a).toEqual(project.instances.a)
  expect(snapshot.undoDepth).toBe(1)
  expect(await session.execute({ documentId: 'doc', epoch: 'epoch', operationId: 'undo', baseRevision: snapshot.revision, actor: 'human', mutation: { type: 'undo' } })).toMatchObject({ status: 'applied' })
  const restored = session.read().model
  if (restored.kind !== 'course-v10') throw new Error('Expected V10')
  expect(restored.project.instances).toEqual(project.instances)
})
it('rejects stateful Slide object paste into Flow or Spatial before a canonical write', async () => {
  const source = fixture(), resources = { assets: {}, components: {} }
  source.surfaces[0].presentation = { states: [{ id: 'answer', title: '答案', overrides: { a: { data: { html: 'Answer' } } } }] }
  const beforeSource = structuredClone(source)
  for (const kind of ['flow', 'spatial'] as const) {
    const project = createBlankCourseProjectV10('目标'), surface = project.surfaces[0]
    surface.kind = kind
    const target: CapturedCourseTarget = { documentId: 'target', epoch: 'epoch', project, editingProject: project, resources,
      activeStateId: null, surfaceId: surface.id, instanceIds: [], instanceId: null }
    const session = await DocumentSession.create({ documentId: 'target', epoch: 'epoch', model: { kind: 'course-v10', project, resources },
      binding: { kind: 'untitled', suggestedName: 'target.h5lesson' } }, new CourseV10Driver(),
    { async append() {}, async save() { throw new Error('Unused save') } })
    const before = session.read()
    const paste = async () => {
      const plan = prepareCourseObjectPaste({ documentId: 'source', project: source, roots: ['a'], resources },
        { capturedTarget: target, container: { kind: 'surface', surfaceId: surface.id }, index: 0 })
      return session.execute({ documentId: 'target', epoch: 'epoch', operationId: 'paste', baseRevision: before.revision, actor: 'human',
        mutation: { type: 'command', command: captureComponentOperation(project, plan.edits) } })
    }
    await expect(paste()).rejects.toThrow('不支持展示状态，无法完整粘贴这些对象')
    expect(session.read()).toEqual(before)
    expect(project).toEqual(before.model.kind === 'course-v10' && before.model.project)
  }
  expect(source).toEqual(beforeSource)
})
it('canonically pastes an ordinary object into Flow or Spatial despite unrelated page states and an order entry', async () => {
  const source = fixture(), resources = { assets: {}, components: {} }, sourceSurface = source.surfaces[0]
  source.instances.other = { ...source.instances.a, id: 'other' }
  source.definitions.interactions = { id: 'interactions', role: 'behavior', implementation: { kind: 'builtin', key: 'guoling.interactions' } }
  const rule = (nodeId: string): InteractionRule => ({ id: `rule-${nodeId}`, enabled: true, trigger: { type: 'node.click', nodeId }, conditions: [],
    actions: [{ id: `action-${nodeId}`, start: 'after-previous', delayMs: 0, action: { type: 'scene.next' } }] })
  const copiedRule = rule('a'), otherRule = rule('other')
  source.instances.behavior = { id: 'behavior', definitionId: 'interactions', data: { rules: [copiedRule, otherRule] } as unknown as JsonValue,
    attachments: [{ instanceId: 'behavior', target: { kind: 'surface', surfaceId: sourceSurface.id } }] }
  sourceSurface.childIds.push('other', 'behavior')
  sourceSurface.presentation = { states: [{ id: 'unrelated', title: '其他对象状态', order: ['other', 'a', 'behavior'], overrides: {
    other: { visible: false }, behavior: { data: { rules: [copiedRule, { ...otherRule, enabled: false }] } as unknown as JsonValue },
  } }] }
  const beforeSource = structuredClone(source)
  for (const kind of ['flow', 'spatial'] as const) {
    const project = createBlankCourseProjectV10('目标'), surface = project.surfaces[0]
    surface.kind = kind
    const target: CapturedCourseTarget = { documentId: 'target', epoch: 'epoch', project, editingProject: project, resources,
      activeStateId: null, surfaceId: surface.id, instanceIds: [], instanceId: null }
    const plan = prepareCourseObjectPaste({ documentId: 'source', project: source, roots: ['a'], resources },
      { capturedTarget: target, container: { kind: 'surface', surfaceId: surface.id }, index: 0 })
    expect(plan.edits.some(edit => edit.type === 'surface.presentation.set')).toBe(false)
    const session = await DocumentSession.create({ documentId: 'target', epoch: 'epoch', model: { kind: 'course-v10', project, resources },
      binding: { kind: 'untitled', suggestedName: 'target.h5lesson' } }, new CourseV10Driver(),
    { async append() {}, async save() { throw new Error('Unused save') } })
    expect(await session.execute({ documentId: 'target', epoch: 'epoch', operationId: 'paste', baseRevision: 0, actor: 'human',
      mutation: { type: 'command', command: captureComponentOperation(project, plan.edits) } })).toMatchObject({ status: 'applied' })
    const after = session.read()
    if (after.model.kind !== 'course-v10') throw new Error('Expected V10')
    expect(after.model.project.instances[plan.idMap.get('a')!].data).toEqual(source.instances.a.data)
    expect(after.model.project.surfaces[0].presentation).toBeUndefined()
    expect(interactionRules(interactionBehavior(after.model.project, { kind: 'surface', surfaceId: surface.id }))).toHaveLength(1)
    expect(after.undoDepth).toBe(1)
  }
  expect(source).toEqual(beforeSource)
})
it('keeps professional presentation and field metadata for source-customized definitions', () => {
  const definition = { ...WEB_DEFINITION, implementation: { kind: 'source' as const, language: 'javascript' as const, source: 'export default {}' }, professionalBuiltinKey: 'guoling.web', dataSchema: {} as JsonObject }
  expect(componentDefinitionPresentation(definition).builtinKey).toBe('guoling.web')
  expect(componentFieldPresentation(definition, ['html']).label).toBe('HTML 内容')
})

it('keeps pre-playback visibility in the captured named state through normal save and reopen', () => {
  const project = fixture(), surfaceId = project.surfaces[0].id
  project.surfaces[0].presentation = { states: [{ id: 'a', title: 'A', overrides: {} }, { id: 'b', title: 'B', overrides: {} }] }
  const edits = presentationComponentEdits(project, surfaceId, 'b', [{ type: 'instance.patch', instanceId: 'a', patch: { playbackInitialVisibility: 'hidden' } }])
  const result = applyComponentOperation(project, captureComponentOperation(project, edits))
  expect(result.instances.a.playbackInitialVisibility).toBeUndefined()
  expect(resolveComponentPresentation(result, surfaceId, 'a').instances.a.playbackInitialVisibility).toBeUndefined()
  expect(resolveComponentPresentation(result, surfaceId, 'b').instances.a.playbackInitialVisibility).toBe('hidden')
  const driver = new CourseV10Driver(), reopened = driver.load(driver.serialize({ kind: 'course-v10', project: result, resources: { assets: {}, components: {} } }))
  if (reopened.kind !== 'course-v10') throw new Error('Expected V10')
  expect(reopened.project.surfaces[0].presentation?.states[1].overrides.a).toEqual({ playbackInitialVisibility: 'hidden' })
})

it('preserves authored coordinates by default and explicitly refits each page, state and shared branch once', () => {
  const project = fixture(), surfaceId = project.surfaces[0].id
  project.surfaces[0].designSize = { width: 800, height: 400 }
  const groupFrame = { width: 200, height: 100, transform: [0, 1, -1, 0, 20, 30] as [number, number, number, number, number, number] }
  project.instances.group = { id: 'group', definitionId: WEB_DEFINITION.id, data: { html: '' }, frame: groupFrame, childIds: ['a'] }
  project.instances.flat = { id: 'flat', definitionId: WEB_DEFINITION.id, data: { html: '' }, childIds: ['child'] }
  project.instances.child = { ...project.instances.a, id: 'child', frame: { width: 20, height: 10, transform: [1, 0, 0, 1, 40, 10] } }
  project.instances.b = { ...project.instances.a, id: 'b' }
  project.instances.global = { ...project.instances.a, id: 'global' }
  project.global.underlay.push('global')
  project.surfaces[0].childIds = ['group', 'flat']
  project.surfaces.push({ id: 'second', kind: 'slide', title: '第二页', childIds: ['b'], designSize: { width: 400, height: 400 } })
  project.surfaces[0].presentation = { states: [
    { id: 'framed', title: '有父框', overrides: { flat: { frame: { width: 200, height: 100, transform: [1, 0, 0, 1, 30, 20] } } } },
    { id: 'frameless', title: '无父框', overrides: { group: { frame: null }, global: { frame: { width: 30, height: 20, transform: [1, 0, 0, 1, 20, 10] } } } },
  ] }
  const resize = { surfaceIds: [surfaceId, 'second'], designSize: { width: 1200, height: 1200 } }
  const preserve = applyComponentOperation(project, captureComponentOperation(project,
    resizeComponentSurfacesEdits(project, { ...resize, mode: 'preserve' })))
  expect(preserve.instances).toEqual(project.instances)
  expect(preserve.surfaces[0].presentation).toEqual(project.surfaces[0].presentation)
  const edits = resizeComponentSurfacesEdits(project, { ...resize, mode: 'contain', globalReferenceSurfaceId: surfaceId })
  const result = applyComponentOperation(project, captureComponentOperation(project, edits))
  expect(result.instances.group.frame?.transform).toEqual([0, 1.5, -1.5, 0, 30, 345])
  expect(result.instances.a.frame).toEqual(project.instances.a.frame)
  expect(result.instances.b.frame?.transform).toEqual([3, 0, 0, 3, 30, 60])
  expect(result.instances.global.frame?.transform).toEqual([1.5, 0, 0, 1.5, 15, 330])
  for (const id of project.global.overlay) expect(result.instances[id]).toEqual(project.instances[id])
  const framed = resolveComponentPresentation(result, surfaceId, 'framed')
  expect(framed.instances.flat.frame?.transform).toEqual([1.5, 0, 0, 1.5, 45, 330])
  expect(framed.instances.child.frame).toEqual(project.instances.child.frame)
  const frameless = resolveComponentPresentation(result, surfaceId, 'frameless')
  expect(frameless.instances.group.frame).toBeUndefined()
  expect(frameless.instances.a.frame?.transform).toEqual([1.5, 0, 0, 1.5, 15, 330])
  expect(frameless.instances.global.frame?.transform).toEqual([1.5, 0, 0, 1.5, 30, 315])
  const driver = new CourseV10Driver()
  expect(driver.load(driver.serialize({ kind: 'course-v10', project: result, resources: { assets: {}, components: {} } }))).toMatchObject({ project: result })
})
