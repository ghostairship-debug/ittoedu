// @vitest-environment node
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { hostToolCatalog } from '../../src/core/tools/HostToolServices'
import { describeTools } from '../../src/core/tools/ToolCatalog'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import type { DocumentModel } from '../../src/shared/workbench/document'
import type { ExecutionStart } from '../../src/shared/workbench/execution'
import type { ModelEvent, ModelProvider, ModelSelection } from '../../src/shared/workbench/modelProvider'
import type { ToolResult, ToolTarget } from '../../src/shared/workbench/tools'

const driver = new CourseV9Driver()
function fixture() {
  const model = driver.load(new Uint8Array(readFileSync('tests/fixtures/course-project-v9/slide-native.h5lesson'))) as Extract<DocumentModel, { kind: 'course-v9' }>
  const slide = model.project.surfaces.find(surface => surface.type === 'slide')!
  if (slide.type !== 'slide') throw new Error('slide fixture')
  const mixed = driver.load(new Uint8Array(readFileSync('tests/fixtures/course-project-v9/mixed.h5lesson'))) as typeof model
  model.project.surfaces.push(...mixed.project.surfaces.filter(surface => surface.type !== 'slide'))
  model.project.locations.push(...mixed.project.locations.filter(location => location.kind !== 'slide-scene'))
  model.project.mixedPrintPlan = { pageSize: 'surface-native', orientation: 'auto', entries: [
    ...model.project.surfaces.filter(surface => surface.type === 'slide').map(surface => ({ id: `print-${surface.id}`, kind: 'slide-scenes' as const, surfaceId: surface.id, sceneIds: surface.scenes.map(scene => scene.id) })),
    ...mixed.project.mixedPrintPlan!.entries.filter(entry => entry.kind !== 'slide-scenes'),
  ] }
  const scene = slide.scenes[0]
  const location = model.project.locations.find(entry => entry.kind === 'slide-scene' && entry.sceneId === scene.id)!
  const stateId = 'producer-state'
  scene.presentation = { initialStateId: stateId, states: [
    { id: stateId, name: 'Default', layerItemOverrides: {} },
    { id: 'other-state', name: 'Other', layerItemOverrides: {} },
  ] }
  return { model, slide, scene, location, stateId, otherSurface: model.project.surfaces.find(surface => surface.type === 'flow')! }
}
async function harness(writable: ToolTarget[], configure?: (value: ReturnType<typeof fixture>) => void) {
  let id = 0
  const registry = new DocumentRegistry({ drivers: [driver], createId: () => `doc-${++id}`, bindingKey: binding => binding.path,
    persistence: { async append() {}, async save() { throw new Error('unused') } } })
  const f = fixture()
  configure?.(f)
  const session = await registry.create(f.model, 'producer.h5lesson')
  const gateway = new DocumentToolGateway(registry, [driver], () => String(++id))
  await gateway.beginRun({ runId: 'producer', actor: 'agent', documents: [{ documentId: session.documentId, writable }] })
  const call = (id: string, name: string, input: unknown) => gateway.execute('producer', id, { name, input })
  const issue = (target: ToolTarget, readOnly = false) => gateway.issueTarget('producer', session.documentId, target, { readOnly })
  return { ...f, registry, gateway, session, call, issue }
}
type Child = { target: string; kind: ToolTarget['kind']; label: string }
async function children(f: Awaited<ReturnType<typeof harness>>, target: string): Promise<Child[]> {
  const result = await f.call(`children-${target}`, 'listChildren', { target, limit: 100 })
  if (result.kind !== 'read') throw new Error(JSON.stringify(result))
  return result.data as Child[]
}
function child(items: Child[], kind: ToolTarget['kind'], label?: string) {
  const matches = items.filter(item => item.kind === kind && (!label || item.label === label))
  expect(matches).toHaveLength(1)
  return matches[0].target
}
function status(result: ToolResult) { return result.kind === 'document-operation' ? result.result.status : result.kind }

it('discovers course, surface, scene and named-state backgrounds from the document tree and commits one scene edit', async () => {
  const f = await harness([{ kind: 'document' }])
  const root = await f.issue({ kind: 'document' })
  const rootChildren = await children(f, root)
  const courseBackground = child(rootChildren, 'course-background', '课程背景')
  expect((await f.call('course-inspect', 'inspect', { target: courseBackground }))).toMatchObject({ kind: 'read', data: { writable: true, tools: expect.arrayContaining(['owner.background', 'media.apply']) } })
  const surface = child(rootChildren, 'course-surface', f.slide.title)
  child(await children(f, surface), 'course-background', '表面背景')
  const location = child(rootChildren, 'course-location', f.location.label)
  const sceneBackground = child(await children(f, location), 'course-background', '场景背景')
  const owner = child(await children(f, location), 'course-owner')
  child(await children(f, owner), 'course-background', '场景背景')
  const state = child(await children(f, location), 'course-state', 'Default')
  child(await children(f, state), 'course-background', '命名态背景')
  expect(status(await f.call('scene-background', 'owner.background', { target: sceneBackground, properties: { backgroundColor: '#123456' } }))).toBe('applied')
  expect(f.session.read().undoDepth).toBe(1)
  const changed = f.session.read().model
  if (changed.kind !== 'course-v9') throw new Error('course')
  const changedSlide = changed.project.surfaces.find(surface => surface.id === f.slide.id)
  if (changedSlide?.type !== 'slide') throw new Error('slide')
  expect(changedSlide.scenes[0].backgroundColor).toBe('#123456')
})

it('keeps location, owner, named-state and read-only background handles inside their frozen grants', async () => {
  const f = await harness([{ kind: 'course-location', locationId: fixture().location.id }])
  const sceneTarget: ToolTarget = { kind: 'course-background', owner: 'scene', surfaceId: f.slide.id, sceneId: f.scene.id }
  const surfaceTarget: ToolTarget = { kind: 'course-background', owner: 'surface', surfaceId: f.otherSurface.id }
  const namedTarget: ToolTarget = { ...sceneTarget, stateId: f.stateId }
  const root = await f.issue({ kind: 'document' })
  const location = child(await children(f, root), 'course-location', f.location.label)
  const discovered = child(await children(f, location), 'course-background', '场景背景')
  expect((await f.call('location-inspect', 'inspect', { target: discovered }))).toMatchObject({ kind: 'read', data: { writable: true, tools: expect.arrayContaining(['owner.background']) } })
  expect((await f.gateway.describeRun('producer')).map(tool => tool.name)).toContain('owner.background')
  const readonly = await f.issue(sceneTarget, true)
  expect(await f.call('readonly', 'owner.background', { target: readonly, properties: { backgroundColor: '#abcdef' } })).toMatchObject({ kind: 'error', code: 'not-authorized' })
  const unrelated = await f.issue(surfaceTarget)
  expect(await f.call('unrelated', 'owner.background', { target: unrelated, properties: { backgroundColor: '#abcdef' } })).toMatchObject({ kind: 'error', code: 'not-authorized' })
  const named = await f.issue(namedTarget)
  expect(await f.call('named', 'owner.background', { target: named, properties: { backgroundColor: '#abcdef' } })).toMatchObject({ kind: 'error', code: 'not-authorized' })
  expect(f.session.read().undoDepth).toBe(0)
  expect(status(await f.call('location-scene', 'owner.background', { target: discovered, properties: { backgroundColor: '#abcdef' } }))).toBe('applied')
})

it('maps state and owner scope to their exact background without exposing sibling state or course background', async () => {
  const baseline = fixture(), f = await harness([{ kind: 'course-owner', owner: 'scene', locationId: baseline.location.id, stateId: baseline.stateId }])
  const owner = await f.issue({ kind: 'course-owner', owner: 'scene', locationId: f.location.id, stateId: f.stateId })
  const stateTarget: ToolTarget = { kind: 'course-background', owner: 'scene', surfaceId: f.slide.id, sceneId: f.scene.id, stateId: f.stateId }
  const otherTarget: ToolTarget = { ...stateTarget, stateId: 'other-state' }
  const baseTarget: ToolTarget = { kind: 'course-background', owner: 'scene', surfaceId: f.slide.id, sceneId: f.scene.id }
  expect((await f.call('state-describe', 'inspect', { target: await f.issue(stateTarget) }))).toMatchObject({ kind: 'read', data: { writable: true } })
  expect(await f.call('other-state', 'owner.background', { target: await f.issue(otherTarget), properties: { backgroundColor: '#abcdef' } })).toMatchObject({ kind: 'error', code: 'not-authorized' })
  expect(await f.call('base-state', 'owner.background', { target: await f.issue(baseTarget), properties: { backgroundColor: '#abcdef' } })).toMatchObject({ kind: 'error', code: 'not-authorized' })
  expect(await f.call('course', 'owner.background', { target: await f.issue({ kind: 'course-background', owner: 'course' }), properties: { backgroundColor: '#abcdef' } })).toMatchObject({ kind: 'error', code: 'not-authorized' })
  const background = child(await children(f, owner), 'course-background', '命名态背景')
  expect((await f.call('scoped-background-inspect', 'inspect', { target: background }))).toMatchObject({ kind: 'read', data: { writable: true } })
  expect(f.session.read().undoDepth).toBe(0)
})

it('allows a surface grant only within its surface and keeps course background separate', async () => {
  const baseline = fixture(), f = await harness([{ kind: 'course-surface', surfaceId: baseline.slide.id }])
  const root = await f.issue({ kind: 'document' })
  const rootChildren = await children(f, root)
  const slide = child(rootChildren, 'course-surface', f.slide.title)
  const background = child(await children(f, slide), 'course-background', '表面背景')
  expect((await f.call('surface-inspect', 'inspect', { target: background }))).toMatchObject({ kind: 'read', data: { writable: true } })
  const other = await f.issue({ kind: 'course-background', owner: 'surface', surfaceId: f.otherSurface.id })
  const course = child(rootChildren, 'course-background', '课程背景')
  for (const target of [other, course]) {
    expect(await f.call(`denied-${target}`, 'owner.background', { target, properties: { backgroundColor: '#abcdef' } })).toMatchObject({ kind: 'error', code: 'not-authorized' })
  }
  expect(status(await f.call('surface-write', 'owner.background', { target: background, properties: { backgroundColor: '#123456', backgroundMode: 'own' } }))).toBe('applied')
  expect(f.session.read().undoDepth).toBe(1)
})

it('lists a state background under an exact state grant without granting the sibling', async () => {
  const baseline = fixture(), f = await harness([{ kind: 'course-state', locationId: baseline.location.id, stateId: baseline.stateId }])
  const state = await f.issue({ kind: 'course-state', locationId: f.location.id, stateId: f.stateId })
  const background = child(await children(f, state), 'course-background', '命名态背景')
  expect((await f.call('state-inspect', 'inspect', { target: background }))).toMatchObject({ kind: 'read', data: { writable: true } })
  const sibling = await f.issue({ kind: 'course-background', owner: 'scene', surfaceId: f.slide.id, sceneId: f.scene.id, stateId: 'other-state' })
  expect(await f.call('sibling', 'owner.background', { target: sibling, properties: { backgroundColor: '#abcdef' } })).toMatchObject({ kind: 'error', code: 'not-authorized' })
})

it('publishes only frozen OAuth image request options and gives native layout guidance', () => {
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
  const descriptions = Object.fromEntries(describeTools(['native.insert', 'object.update', 'media.insert']).map(tool => [tool.name, tool.description]))
  expect(descriptions['native.insert']).toMatch(/padding.*shrink.*backgroundOpacity/)
  expect(descriptions['native.insert']).toMatch(/batch.*read\/inspect.*data.target/)
  expect(describeTools(['batch'])[0].description).toMatch(/同一轮.*batch.*短句柄过期/)
  expect(descriptions['object.update']).toMatch(/padding.*shrink.*backgroundOpacity/)
  expect(descriptions['media.insert']).toMatch(/frame.*遮挡/)
})

it('advises on transparent Native text against a known flat Slide background without assuming image or dark backgrounds', async () => {
  const description = describeTools(['native.insert', 'object.update']).map(tool => tool.description).join(' ')
  expect(description).toMatch(/文字颜色.*有效.*Slide.*背景/)
  for (const [name, backgroundColor, backgroundAssetId, textColor, lowContrast] of [
    ['white-title', '#ffffff', null, '#FFFFFF', true],
    ['pale-blue-label', '#ffffff', null, '#BFE9FF', true],
    ['dark-scene', '#13263a', null, '#FFFFFF', false],
    ['image-scene', '#ffffff', 'badge', '#FFFFFF', false],
  ] as const) {
    const f = await harness([{ kind: 'document' }], value => {
      value.scene.backgroundColor = backgroundColor
      value.scene.backgroundAssetId = backgroundAssetId
    })
    const owner = await f.issue({ kind: 'course-owner', owner: 'scene', locationId: f.location.id })
    const result = await f.call(name, 'native.insert', { target: owner, template: {
      nativeType: 'text', text: name, x: 600, y: 500, width: 400, height: 70,
      style: { color: textColor, fontSize: 30, backgroundOpacity: 0 },
    } })
    expect(result).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    if (result.kind !== 'document-operation') throw new Error(JSON.stringify(result))
    expect(result.advisories?.some(item => item.code === 'native-text-low-contrast') ?? false).toBe(lowContrast)
    if (lowContrast) expect(result.advisories?.find(item => item.code === 'native-text-low-contrast')?.message)
      .toMatch(/文字颜色.*场景背景.*透明/)
    expect(f.session.read().undoDepth).toBe(1)
  }
})

it('does not infer white scene pixels beneath text when a black Native card occupies the same area', async () => {
  for (const [name, cardX, cardY, overlaps] of [
    ['black-card-behind', 580, 480, true],
    ['distant-card', 20, 20, false],
  ] as const) {
    const f = await harness([{ kind: 'document' }], value => { value.scene.backgroundColor = '#ffffff' })
    const owner = await f.issue({ kind: 'course-owner', owner: 'scene', locationId: f.location.id })
    const card = await f.call(`${name}-card`, 'native.insert', { target: owner, template: {
      nativeType: 'shape', shapeType: 'rectangle', x: cardX, y: cardY, width: 500, height: 100,
      style: { fillColor: '#000000', fillOpacity: 1 },
    } })
    expect(status(card)).toBe('applied')
    const textOwner = await f.issue({ kind: 'course-owner', owner: 'scene', locationId: f.location.id })
    const text = await f.call(`${name}-text`, 'native.insert', { target: textOwner, template: {
      nativeType: 'text', text: '白色标题', x: 600, y: 500, width: 400, height: 70,
      style: { color: '#FFFFFF', fontSize: 34, backgroundOpacity: 0 },
    } })
    expect(status(text)).toBe('applied')
    if (text.kind !== 'document-operation') throw new Error(JSON.stringify(text))
    expect(text.advisories?.some(item => item.code === 'native-text-low-contrast') ?? false).toBe(!overlaps)
    const model = f.session.read().model
    if (model.kind !== 'course-v9') throw new Error('course')
    const scene = model.project.surfaces.find(surface => surface.id === f.slide.id)
    if (scene?.type !== 'slide') throw new Error('slide')
    const shape = scene.scenes[0].layerItems.find(item => item.kind === 'native' && item.content.nativeType === 'shape'
      && item.content.data.style.fillColor === '#000000')
    const title = scene.scenes[0].layerItems.find(item => item.kind === 'native' && item.content.nativeType === 'text'
      && item.content.data.text === '白色标题')
    expect(shape?.order).toBeLessThan(title?.order ?? 0)
  }
})

it('refreshes a scene owner through read after its own insert but keeps external edits conflicting', async () => {
  const f = await harness([{ kind: 'document' }])
  const owner = await f.issue({ kind: 'course-owner', owner: 'scene', locationId: f.location.id })
  const insert = (id: string, target: string, text: string) => f.call(id, 'native.insert', { target, template: {
    nativeType: 'text', text, x: 600, y: 500, width: 250, height: 70,
  } })
  expect(status(await insert('first', owner, '第一次'))).toBe('applied')
  expect(await insert('stale-second', owner, '旧句柄')).toMatchObject({ kind: 'error', code: 'target-conflict',
    message: expect.stringMatching(/read|inspect|batch/) })
  const read = await f.call('read-owner', 'read', { target: owner })
  expect(read).toMatchObject({ kind: 'read', data: { target: expect.any(String), text: expect.any(String) } })
  if (read.kind !== 'read' || typeof read.data !== 'object' || read.data === null || !('target' in read.data)) throw new Error(JSON.stringify(read))
  const refreshed = read.data.target as string
  expect(refreshed).not.toBe(owner)
  expect(status(await insert('second', refreshed, '第二次'))).toBe('applied')
  expect(f.session.read().undoDepth).toBe(2)

  const beforeHuman = f.session.read()
  if (beforeHuman.model.kind !== 'course-v9') throw new Error('course')
  const project = structuredClone(beforeHuman.model.project)
  const slide = project.surfaces.find(surface => surface.id === f.slide.id)
  if (slide?.type !== 'slide') throw new Error('slide')
  slide.scenes[0].layerItems[0].label = 'Human edit'
  expect((await f.session.execute({ documentId: beforeHuman.documentId, epoch: beforeHuman.epoch,
    operationId: 'human-scene-edit', baseRevision: beforeHuman.revision, actor: 'human',
    mutation: { type: 'command', command: { type: 'course.replace', project } } })).status).toBe('applied')
  expect(await f.call('external-read', 'read', { target: refreshed })).toMatchObject({ kind: 'error', code: 'target-conflict' })
  expect(await f.call('external-inspect', 'inspect', { target: refreshed })).toMatchObject({ kind: 'error', code: 'target-conflict' })
  expect(await insert('external-write', refreshed, '不能覆盖人工编辑')).toMatchObject({ kind: 'error', code: 'target-conflict' })
})

it('refreshes a scene owner after an unrelated human title edit between task inserts', async () => {
  const f = await harness([{ kind: 'document' }])
  const owner = await f.issue({ kind: 'course-owner', owner: 'scene', locationId: f.location.id })
  const insert = (id: string, target: string, text: string) => f.call(id, 'native.insert', { target, template: {
    nativeType: 'text', text, x: 600, y: 500, width: 250, height: 70,
  } })
  expect(status(await insert('first-title-case', owner, '第一次'))).toBe('applied')
  const beforeHuman = f.session.read()
  if (beforeHuman.model.kind !== 'course-v9') throw new Error('course')
  const project = structuredClone(beforeHuman.model.project)
  project.title = 'Human title edit'
  expect((await f.session.execute({ documentId: beforeHuman.documentId, epoch: beforeHuman.epoch,
    operationId: 'human-title-edit', baseRevision: beforeHuman.revision, actor: 'human',
    mutation: { type: 'command', command: { type: 'course.replace', project } } })).status).toBe('applied')

  const read = await f.call('read-after-title', 'read', { target: owner })
  expect(read).toMatchObject({ kind: 'read', data: { target: expect.any(String) } })
  if (read.kind !== 'read' || typeof read.data !== 'object' || read.data === null || !('target' in read.data)) throw new Error(JSON.stringify(read))
  const refreshed = read.data.target as string
  expect(refreshed).not.toBe(owner)
  expect(status(await insert('second-after-title', refreshed, '第二次'))).toBe('applied')
  const after = f.session.read()
  if (after.model.kind !== 'course-v9') throw new Error('course')
  expect(after.model.project.title).toBe('Human title edit')
  expect(after.undoDepth).toBe(3)
})

it('keeps a legal small Native text edit committed once while reporting shrink, transparency and contrast to the model', async () => {
  const f = await harness([{ kind: 'document' }])
  const owner = await f.issue({ kind: 'course-owner', owner: 'scene', locationId: f.location.id })
  const result = await f.call('small-label', 'native.insert', { target: owner, template: {
    nativeType: 'text', text: '输入一', x: 600, y: 500, width: 200, height: 62,
    style: { fontSize: 24, padding: 24, overflow: 'shrink', color: '#ffffff', backgroundColor: '#ffffff' },
  } })
  expect(result).toMatchObject({ kind: 'document-operation', result: { status: 'applied' }, advisories: [
    { code: 'native-text-shrink', step: 0 }, { code: 'native-text-transparent-background', step: 0 },
    { code: 'native-text-low-contrast', step: 0 },
  ] })
  expect(status(await f.call('small-label', 'native.insert', { target: owner, template: {
    nativeType: 'text', text: '输入一', x: 600, y: 500, width: 200, height: 62,
    style: { fontSize: 24, padding: 24, overflow: 'shrink', color: '#ffffff', backgroundColor: '#ffffff' },
  } }))).toBe('applied')
  expect(f.session.read().undoDepth).toBe(1)

  const root = await mkdtemp(path.join(tmpdir(), 'g20-s14-producer-'))
  try {
    const selection: ModelSelection = { model: 'fixture-model', connection: { id: 'fixture', revision: 1, provider: 'fixture', protocol: 'openai-chat',
      baseURL: 'http://127.0.0.1:1/v1', accountId: 'fixture-account', auth: { kind: 'api-key', credentialRef: 'fixture-ref' }, billing: { kind: 'unknown' },
      capabilities: { tools: 'supported', stream: 'supported', vision: 'supported', reasoning: 'supported' } } }
    const execute = vi.spyOn(f.gateway, 'execute').mockResolvedValue(result)
    let turn = 0, modelSawWarning = false
    const provider: ModelProvider = { async *stream(request) {
      const first = turn++ === 0
      if (!first) {
        const message = request.messages.find(message => message.role === 'tool')
        modelSawWarning = typeof message?.content === 'string' && message.content.includes('native-text-shrink')
          && message.content.includes('native-text-transparent-background')
          && message.content.includes('native-text-low-contrast')
      }
      const call = first ? { id: 'native-call', name: 'native.insert', argumentsText: '{}' } : undefined
      const calls = call ? [call] : []
      yield { requestId: request.requestId, sequence: 1, type: 'response.completed', responseId: `fixture-${turn}`, actualModel: 'fixture-model',
        nativeResponse: {}, finishReason: call ? 'tool_calls' : 'stop', toolCalls: calls,
        assistant: { role: 'assistant', content: call ? '' : 'done', ...(call ? { tool_calls: [{ id: call.id, type: 'function', function: { name: call.name, arguments: call.argumentsText } }] } : {}) },
      } satisfies Extract<ModelEvent, { type: 'response.completed' }>
    } }
    const engine = new ExecutionEngine({ registry: f.registry, gateway: f.gateway, provider,
      runs: new ExecutionRunStore(path.join(root, 'runs')), events: new ExecutionEventStore({ directory: path.join(root, 'events') }) })
    const input: ExecutionStart = { conversationId: 'producer-conversation', taskId: 'producer-task', instruction: 'insert text', selection,
      documents: [{ documentId: f.session.documentId, writable: [{ kind: 'document' }] }] }
    const started = await engine.start(input)
    await engine.wait(started.runId)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(modelSawWarning).toBe(true)
    expect(f.session.read().undoDepth).toBe(1)
  } finally {
    vi.restoreAllMocks()
    if (!path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep)) throw new Error('Unsafe temp directory')
    await rm(root, { recursive: true, force: true })
  }
})
