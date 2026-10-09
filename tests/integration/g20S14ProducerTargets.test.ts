// @vitest-environment node
import { expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { hostToolCatalog } from '../../src/core/tools/HostToolServices'
import { describeTools } from '../../src/core/tools/ToolCatalog'
import { objectInsertInputSchema } from '../../src/core/tools/toolSchemas'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { createTextComponentData } from '../../src/components/text/data'
import { SHAPE_DEFINITION, defaultShapeData } from '../../src/components/shape/authoring'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import type { ModelEvent, ModelProvider, ModelSelection } from '../../src/shared/workbench/modelProvider'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform/project'
import type { DocumentResources } from '../../src/shared/workbench/document'
import type { ComponentEdit } from '../../src/shared/contracts/component-platform/operations'
import type { ToolResult, ToolTarget } from '../../src/shared/workbench/tools'

const driver = new CourseV10Driver()
async function harness(writable: ToolTarget[] = [{ kind: 'document' }], setup?: (project: CourseProjectV10, resources: DocumentResources) => void) {
  let id = 0
  const registry = new DocumentRegistry({ drivers: [driver], createId: () => `doc-${++id}`, bindingKey: binding => binding.path,
    persistence: { async append() {}, async save() { throw new Error('unused') } } })
  const project = createBlankCourseProjectV10('制作目标', () => `fixture-${++id}`)
  project.global.overlay = []; project.instances = {}; project.definitions = {}
  project.background = { color: '#eeeeee' }
  project.surfaces = [{ id: 'slide', kind: 'slide', title: '演示页', childIds: [], designSize: { width: 1280, height: 720 },
    background: { color: '#ffffff' }, presentation: { states: [{ id: 'default', title: 'Default', overrides: {} },
      { id: 'other', title: 'Other', overrides: {} }] } }, { id: 'flow', kind: 'flow', title: '讲义', childIds: [] }]
  const resources: DocumentResources = { assets: {}, components: {} }
  setup?.(project, resources)
  const session = await registry.create({ kind: 'course-v10', project, resources }, 'producer.h5lesson')
  const gateway = new DocumentToolGateway(registry, [driver], () => String(++id))
  await gateway.beginRun({ runId: 'producer', actor: 'agent', documents: [{ documentId: session.documentId, writable }] })
  const call = (id: string, name: string, input: unknown) => gateway.execute('producer', id, { name, input })
  const issue = (target: ToolTarget, readOnly = false) => gateway.issueTarget('producer', session.documentId, target, { readOnly })
  const human = async (edits: ComponentEdit[]) => {
    const before = await session.drain()
    if (before.model.kind !== 'course-v10') throw new Error('Expected V10')
    return session.execute({ documentId: before.documentId, epoch: before.epoch, baseRevision: before.revision,
      operationId: `human-${++id}`, actor: 'human', mutation: { type: 'command', command: captureComponentOperation(before.model.project, edits) } })
  }
  const current = () => { const model = session.read().model; if (model.kind !== 'course-v10') throw new Error('Expected V10'); return model.project }
  return { registry, gateway, session, call, issue, human, current }
}
const applied = (result: ToolResult) => expect(result, JSON.stringify(result)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
const textTarget = { kind: 'course-instance', surfaceId: 'slide', instanceId: 'title' } as const
function textFixture(project: CourseProjectV10) {
  project.background = { color: '#ffffff' }
  project.definitions[TEXT_DEFINITION.id] = structuredClone(TEXT_DEFINITION)
  const data = createTextComponentData('白色标题'); data.appearance.color = '#FFFFFF'
  project.instances.title = { id: 'title', definitionId: TEXT_DEFINITION.id, data: JSON.parse(JSON.stringify(data)),
    frame: { width: 400, height: 70, transform: [1, 0, 0, 1, 600, 500] } }
  project.surfaces[0].childIds = ['title']
}
async function refresh(f: Awaited<ReturnType<typeof harness>>, handle: string) {
  const result = await f.call(`read-${handle}`, 'read', { target: handle })
  expect(result, JSON.stringify(result)).toMatchObject({ kind: 'read', data: { target: expect.any(String), text: expect.any(String) } })
  if (result.kind !== 'read') throw new Error('Expected read')
  return (result.data as { target: string }).target
}

it('discovers current V10 surfaces, reads their backgrounds and commits a named-state background in one undoable edit', async () => {
  const f = await harness(), root = await f.issue({ kind: 'document' })
  const children = await f.call('root-tree', 'listChildren', { target: root, limit: 100 })
  expect(children).toMatchObject({ kind: 'read', data: [
    { kind: 'course-surface', label: '演示页' }, { kind: 'course-surface', label: '讲义' },
  ] })
  if (children.kind !== 'read') throw new Error('Expected tree')
  const slide = (children.data as Array<{ target: string }>)[0].target
  const read = await f.call('surface-source', 'read', { target: slide })
  expect(read).toMatchObject({ kind: 'read', data: { text: expect.any(String) } })
  if (read.kind !== 'read') throw new Error('Expected read')
  expect(JSON.parse((read.data as { text: string }).text)).toMatchObject({ background: { color: '#ffffff' }, presentation: { states: [{ title: 'Default' }, { title: 'Other' }] } })
  applied(await f.call('state-background', 'presentation.update', { target: slide, action: 'background', state: 'Default', background: { color: '#123456' } }))
  expect(f.current().surfaces[0].presentation!.states[0].background).toEqual({ color: '#123456' })
  expect(f.current().surfaces[0].background).toEqual({ color: '#ffffff' })
  expect(f.current().surfaces[0].presentation!.states[1].background).toBeUndefined()
  expect(f.session.read().undoDepth).toBe(1)
  const before = f.session.read()
  expect((await f.session.execute({ documentId: before.documentId, epoch: before.epoch, baseRevision: before.revision,
    operationId: 'undo-background', actor: 'human', mutation: { type: 'undo' } })).status).toBe('applied')
  expect(f.current().surfaces[0].presentation!.states[0].background).toBeUndefined()
})

it('keeps surface and read-only handles inside frozen grants and separates whole-course background edits', async () => {
  const f = await harness([{ kind: 'course-surface', surfaceId: 'slide' }])
  const slide = await f.issue({ kind: 'course-surface', surfaceId: 'slide' })
  for (const target of [await f.issue({ kind: 'course-surface', surfaceId: 'slide' }, true), await f.issue({ kind: 'course-surface', surfaceId: 'flow' })]) {
    expect(await f.call(`deny-${target}`, 'surface.configure', { target, settings: { background: { color: '#abcdef' } } }))
      .toMatchObject({ kind: 'error', code: 'not-authorized' })
  }
  expect(await f.call('deny-course', 'course.configure', { target: await f.issue({ kind: 'document' }), settings: { background: { color: '#abcdef' } } }))
    .toMatchObject({ kind: 'error', code: 'not-authorized' })
  expect(f.session.read().undoDepth).toBe(0)
  applied(await f.call('surface-background', 'surface.configure', { target: slide, settings: { background: { color: '#abcdef' } } }))
  expect(f.current().surfaces[0].background).toEqual({ color: '#abcdef' })
  expect(f.current().background).toEqual({ color: '#eeeeee' })
  expect(f.current().surfaces[1].background).toBeUndefined()
})

it('keeps exact named-state grants from changing the base page, sibling state or course settings', async () => {
  const f = await harness([{ kind: 'course-surface', surfaceId: 'slide', stateId: 'default' }])
  const named = await f.issue({ kind: 'course-surface', surfaceId: 'slide', stateId: 'default' })
  expect(await f.call('named-inspect', 'inspect', { target: named })).toMatchObject({ kind: 'read', data: { writable: true } })
  for (const stateId of [null, 'other'] as const) {
    const target = await f.issue({ kind: 'course-surface', surfaceId: 'slide', stateId })
    expect(await f.call(`deny-${stateId}`, 'surface.configure', { target, settings: { background: { color: '#abcdef' } } }))
      .toMatchObject({ kind: 'error', code: 'not-authorized' })
  }
  // State-scoped content edits do not grant management of the whole presentation.
  expect(await f.call('deny-state-management', 'presentation.update', { target: named, action: 'background', state: 'other', background: { color: '#abcdef' } }))
    .toMatchObject({ kind: 'error', code: 'invalid-target' })
  expect(await f.call('deny-base-settings', 'surface.configure', { target: named, settings: { background: { color: '#abcdef' } } }))
    .toMatchObject({ kind: 'error', code: 'invalid-target' })
  expect(f.session.read().undoDepth).toBe(0)
})

it('reuses acknowledged insertion handles but refuses a handle after a human removes an acknowledged child', async () => {
  const f = await harness(), owner = await f.issue({ kind: 'course-surface', surfaceId: 'slide' })
  const insert = (id: string, target: string, text: string) => f.call(id, 'object.insert', { target, kind: 'text', text, x: 600, y: 500, width: 250, height: 70 })
  applied(await insert('first', owner, '第一次'))
  applied(await insert('second', owner, '同柄续插'))
  const next = await refresh(f, owner)
  expect(next).not.toBe(owner)
  applied(await insert('third', next, '第三次'))
  expect(f.session.read().undoDepth).toBe(3)
  const first = f.current().surfaces[0].childIds[0]
  expect((await f.human([{ type: 'instance.remove', instanceId: first }])).status).toBe('applied')
  expect(await insert('deleted', next, '删除后不能续插')).toMatchObject({ kind: 'error', code: 'target-conflict' })
  expect(f.session.read().undoDepth).toBe(4)
})

it('refreshes the current page after an unrelated human title edit and preserves that title when inserting again', async () => {
  const f = await harness(), owner = await f.issue({ kind: 'course-surface', surfaceId: 'slide' })
  applied(await f.call('first', 'object.insert', { target: owner, kind: 'text', text: '第一次' }))
  expect((await f.human([{ type: 'project.title.set', title: '人工标题' }])).status).toBe('applied')
  const next = await refresh(f, owner)
  expect(next).not.toBe(owner)
  applied(await f.call('next', 'object.insert', { target: next, kind: 'text', text: '第二次' }))
  expect(f.current().title).toBe('人工标题')
  expect(f.session.read().undoDepth).toBe(3)
})

it('publishes only frozen OAuth image options and the current professional insertion schema', () => {
  for (const name of ['image.generate', 'image.edit'] as const) {
    const tool = hostToolCatalog.find(tool => tool.name === name)!
    const input = { target: 'document-handle', prompt: 'draw a diagram', ...(name === 'image.edit' ? { references: ['image-handle'] } : {}) }
    for (const quality of ['auto', 'low', 'medium', 'high']) {
      expect(tool.inputSchema.safeParse({ ...input, output: { size: '1536x1024', quality, format: 'png', background: 'opaque' } }).success).toBe(true)
    }
    expect(tool.inputSchema.safeParse({ ...input, output: { size: 'auto', background: 'transparent' } }).success).toBe(true)
    for (const unsupported of [{ moderation: 'auto' }, { format: 'jpeg' }, { format: 'webp' }, { quality: 'xhigh' }, { quality: 'max' }]) {
      expect(tool.inputSchema.safeParse({ ...input, output: unsupported }).success).toBe(false)
    }
    const schema = JSON.stringify(describeTools([name])[0].schema)
    for (const forbidden of ['moderation', 'jpeg', 'webp', 'xhigh', 'max']) expect(schema).not.toContain(`"${forbidden}"`)
    expect(schema).toContain('png')
  }
  expect(objectInsertInputSchema.safeParse({ target: 'page', kind: 'text', text: '文字', x: 10, width: 200 }).success).toBe(true)
  expect(objectInsertInputSchema.safeParse({ target: 'page', nativeType: 'text', template: { text: '旧Native输入' } }).success).toBe(false)
  expect(describeTools(['object.insert', 'object.update', 'media.insert']).map(tool => tool.name).sort())
    .toEqual(['media.insert', 'object.insert', 'object.update'])
  expect(describeTools(['native.insert', 'owner.background'])).toEqual([])
})

it('reports proved professional text risks without rejecting or repeating the edit, and sends the warnings to the model', async () => {
  for (const mode of ['white', 'pale', 'dark', 'image', 'black-card-overlap', 'black-card-outside',
    'named-state-dark', 'opaque-text', 'inline-color', 'inline-font', 'overflow-text', 'overflow-group',
    'unknown-color', 'custom-style', 'custom-source'] as const) {
    const f = await harness([{ kind: 'document' }], (project, resources) => {
      textFixture(project)
      const surface = project.surfaces[0], title = project.instances.title
      const data = title.data as unknown as ReturnType<typeof createTextComponentData>
      if (mode === 'pale') project.background = { color: '#fefefe' }
      if (mode === 'dark') project.background = { color: '#000000' }
      if (mode === 'image') {
        project.background = { color: '#ffffff', assetId: 'background' }
        project.assets.background = { id: 'background', path: 'assets/background.svg', mimeType: 'image/svg+xml', kind: 'image' }
        resources.assets.background = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="black"/></svg>')
      }
      if (mode === 'named-state-dark') surface.presentation!.states[0].background = { mode: 'own', color: '#000000' }
      if (mode === 'opaque-text') { data.appearance.backgroundOpacity = 1; data.appearance.backgroundColor = '#000000' }
      if (mode === 'inline-color') data.content.inlines = [{ type: 'text', text: '黑色标题', style: { color: '#000000' } }]
      if (mode === 'inline-font') {
        data.appearance.color = '#888888'
        data.content.inlines = [{ type: 'text', text: '大号标题', style: { fontSize: 30, bold: true } }]
      }
      if (mode === 'overflow-text') {
        const overflow = createTextComponentData('很高的正文\n'.repeat(30))
        project.instances.overflow = { id: 'overflow', definitionId: TEXT_DEFINITION.id, data: JSON.parse(JSON.stringify(overflow)),
          frame: { width: 400, height: 1, transform: [1, 0, 0, 1, 600, 0] } }
        surface.childIds.unshift('overflow')
      }
      if (mode === 'overflow-group') {
        project.definitions.group = { id: 'group', role: 'content', implementation: { kind: 'builtin', key: 'guoling.group' } }
        project.instances.group = { id: 'group', definitionId: 'group', data: {}, childIds: ['outside-child'],
          frame: { width: 10, height: 10, transform: [1, 0, 0, 1, 0, 0] } }
        project.instances['outside-child'] = { ...structuredClone(title), id: 'outside-child' }
        surface.childIds.unshift('group')
      }
      if (mode === 'unknown-color') data.appearance.color = 'var(--text-color)'
      if (mode === 'custom-style') title.style = { filter: 'invert(1)' }
      if (mode === 'custom-source') title.implementationOverride = { kind: 'source', source: 'export default {}', language: 'javascript' }
      if (mode.startsWith('black-card')) {
        project.definitions[SHAPE_DEFINITION.id] = structuredClone(SHAPE_DEFINITION)
        const shape = defaultShapeData(); shape.style.fillColor = '#000000'
        project.instances.card = { id: 'card', definitionId: SHAPE_DEFINITION.id, data: shape,
          frame: { width: 500, height: 100, transform: [1, 0, 0, 1, mode === 'black-card-overlap' ? 580 : 0, mode === 'black-card-overlap' ? 480 : 0] } }
        surface.childIds.unshift('card')
      }
    })
    const target = await f.issue({ ...textTarget, ...(mode === 'named-state-dark' ? { stateId: 'default' } : {}) })
    const result = await f.call(mode, 'object.update', { target, properties: { data: { appearance: { fontSize: mode === 'inline-font' ? 10 : 34 } } } })
    applied(result)
    if (result.kind !== 'document-operation') throw new Error(JSON.stringify(result))
    expect(result.advisories?.some(item => item.code === 'native-text-low-contrast') ?? false, mode)
      .toBe(['white', 'pale', 'black-card-outside'].includes(mode))
    expect(f.session.read().undoDepth, mode).toBe(1)
  }

  const f = await harness([{ kind: 'document' }], project => { textFixture(project); project.instances.title.frame!.height = 62 })
  const target = await f.issue(textTarget)
  const input = { target, properties: { data: { appearance: { fontSize: 24, padding: 24, backgroundColor: '#ffffff' }, sizing: { mode: 'shrink-text' } } } }
  const receipt = await f.call('small-label', 'object.update', input)
  expect(receipt).toMatchObject({ kind: 'document-operation', result: { status: 'applied' }, advisories: [
    { code: 'native-text-shrink', step: 0 }, { code: 'native-text-transparent-background', step: 0 }, { code: 'native-text-low-contrast', step: 0 },
  ] })
  applied(await f.call('small-label', 'object.update', input))
  expect(f.session.read().undoDepth).toBe(1)
  expect(f.current().instances.title.frame!.height).toBe(62)

  const modelFixture = await harness([{ kind: 'document' }], project => { textFixture(project); project.instances.title.frame!.height = 62 })
  const directory = await mkdtemp(path.join(tmpdir(), 'g20-s14-advisories-'))
  try {
    const selection: ModelSelection = { model: 'local-advisory', connection: { id: 'fixture', revision: 1, provider: 'fixture', protocol: 'openai-chat',
      baseURL: 'https://fixture.invalid/v1', accountId: 'fixture', auth: { kind: 'api-key', credentialRef: 'unused' }, billing: { kind: 'unknown' },
      capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'unsupported' } } }
    const runs = new ExecutionRunStore(path.join(directory, 'runs'))
    const events = new ExecutionEventStore({ directory: path.join(directory, 'events') })
    let turn = 0, modelSawWarning = false
    const provider: ModelProvider = { async *stream(request) {
      const currentTurn = ++turn
      let call: { id: string; name: string; argumentsText: string } | undefined
      if (currentTurn === 1) call = { id: 'load-layout', name: 'tools.load', argumentsText: JSON.stringify({ families: ['layout'] }) }
      else if (currentTurn === 2) {
        const [run] = await runs.list()
        const handle = await modelFixture.gateway.issueTarget(run.runId, modelFixture.session.documentId, textTarget)
        call = { id: 'edit-professional-text', name: 'object.update', argumentsText: JSON.stringify({ ...input, target: handle }) }
      } else {
        const messages = JSON.stringify(request.messages.filter(message => message.role === 'tool'))
        modelSawWarning = ['native-text-shrink', 'native-text-transparent-background', 'native-text-low-contrast'].every(code => messages.includes(code))
      }
      const calls = call ? [call] : []
      yield { requestId: request.requestId, sequence: 1, type: 'response.completed', responseId: `local-${turn}`, actualModel: selection.model,
        nativeResponse: {}, finishReason: call ? 'tool_calls' : 'stop', toolCalls: calls,
        assistant: { role: 'assistant', content: call ? '' : 'done', ...(call ? { tool_calls: [{ id: call.id, type: 'function', function: { name: call.name, arguments: call.argumentsText } }] } : {}) },
      } satisfies Extract<ModelEvent, { type: 'response.completed' }>
    } }
    const engine = new ExecutionEngine({ registry: modelFixture.registry, gateway: modelFixture.gateway, provider, runs, events })
    const started = await engine.start({ conversationId: 'producer', taskId: 'producer', instruction: '调整文字样式并检查反馈', selection,
      documents: [{ documentId: modelFixture.session.documentId, writable: [textTarget] }] })
    const finished = await engine.wait(started.runId)
    await events.flushPending()
    expect(finished.status).toBe('completed')
    expect(finished.tools.filter(tool => tool.call.name === 'object.update')).toHaveLength(1)
    expect(modelSawWarning).toBe(true)
    expect(modelFixture.session.read().undoDepth).toBe(1)
    expect(modelFixture.current().instances.title.frame!.height).toBe(62)
  } finally {
    if (!path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep)) throw new Error('Unsafe temporary directory')
    await rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 })
  }
})
