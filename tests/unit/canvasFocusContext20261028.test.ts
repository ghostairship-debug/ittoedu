// @vitest-environment node
import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import type { ExecutionStart } from '../../src/shared/workbench/execution'
import type { ToolTarget } from '../../src/shared/workbench/tools'
import type { ModelEvent, ModelProvider, ModelRequest, ModelSelection } from '../../src/shared/workbench/modelProvider'
import { executionContextToolProfile } from '../../src/main/workbench/execution/ExecutionContextProjection'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { createTextComponentData } from '../../src/components/text/data'
import { MarkdownDriver } from '../../src/core/drivers/MarkdownDriver'
import { componentProjectFiles } from '../../src/core/projectFiles/componentPlatform/projection'
import { componentSurfaces } from '../../src/shared/contracts/component-platform/project'
import { captureCourseDocumentReference, captureCourseInstanceRange, captureSelection, selectionReference, workbenchSelection } from '../../src/renderer/workbench/SelectionContextController'
import { setRootContainers, testContainerInstance } from '../helpers/glxWorkFixture'

const documentId = 'focus-context-document'
const directories: string[] = []
const snapshot = (revision: number, source = 'before focused after'): DocumentSnapshot => ({
  documentId, epoch: 'focus-context-epoch', revision, model: new MarkdownDriver().load(new TextEncoder().encode(source)),
  binding: { kind: 'untitled', suggestedName: 'focused.md' }, dirty: true, saving: false, recoverable: true, undoDepth: 1, redoDepth: 0,
})

afterEach(async () => {
  workbenchSelection.closeDocument(documentId)
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

it.each([false, true])('retains the captured focus revision when draining input advances the document (writable=%s)', async writable => {
  const project = createBlankCourseProjectV10('Focused canvas')
  setRootContainers(project, [{ ...componentSurfaces(project)[0], kind: 'flow' }])
  project.definitions.focusText = { id: 'focusText', role: 'content', implementation: { kind: 'builtin', key: 'guoling.text' } }
  project.instances.focusHeading = { id: 'focusHeading', definitionId: 'focusText', data: JSON.parse(JSON.stringify(createTextComponentData('before focused after'))) }
  const page = testContainerInstance(project, 0)
  page.childIds = ['focusHeading']
  const before: DocumentSnapshot = { documentId, epoch: 'focus-context-epoch', revision: 7, dirty: true,
    binding: { kind: 'file', path: 'focused.glx', version: 'disk-v1', bindingVersion: 1 },
    model: { kind: 'course-v10', project, resources: { assets: {}, components: {} } },
    saving: false, recoverable: true, undoDepth: 1, redoDepth: 0 }
  const captured = captureCourseInstanceRange(before, page.id, 'focusHeading', ['content'], 7, 14)
  workbenchSelection.setManual(documentId, captured)
  const current = structuredClone(before)
  current.revision = 8
  if (current.model.kind === 'course-v10') current.model.project.instances.focusHeading.data = JSON.parse(JSON.stringify(createTextComponentData('human prefix before focused after')))
  const reference = await captureCourseDocumentReference({ documentId, surfaceId: page.id }, writable, async () => current)

  expect(reference).toEqual({ documentId, epoch: before.epoch, revision: 7,
    selection: captured.targets, writable: writable ? [{ kind: 'document' }] : [] })
  expect(reference.selection).not.toBe(captured.targets)
})

it('keeps the original focus while preparation drains input and the user selects elsewhere', async () => {
  const before = snapshot(7)
  const captured = captureSelection(before, [{ kind: 'markdown-range', from: 7, to: 14 }], 'focused')
  workbenchSelection.setManual(documentId, captured)
  let complete!: (value: DocumentSnapshot) => void
  const preparing = new Promise<DocumentSnapshot>(resolve => { complete = resolve })
  const pending = captureCourseDocumentReference({ documentId, surfaceId: null }, true, () => preparing)
  const after = snapshot(8, 'human prefix before focused after')
  const later = captureSelection(after, [{ kind: 'markdown-range', from: 0, to: 5 }], 'human')
  workbenchSelection.setManual(documentId, later)
  complete(after)

  expect(await pending).toMatchObject({ revision: before.revision, selection: captured.targets, writable: [{ kind: 'document' }] })
  expect(workbenchSelection.getManual(documentId)).toEqual(later)
})

it('keeps the same minimal focus independently of an explicit write restriction or read-only authority', () => {
  const captured = captureSelection(snapshot(7), [{ kind: 'markdown-range', from: 7, to: 14 }], 'focused')
  const ordinary = selectionReference(captured, true)
  const restricted = selectionReference(captured, true, true)
  const readOnly = selectionReference(captured, false, true)

  expect(ordinary.selection).toEqual(captured.targets)
  expect(restricted.selection).toEqual(ordinary.selection)
  expect(readOnly.selection).toEqual(ordinary.selection)
  expect(ordinary.writable).toEqual([{ kind: 'document' }])
  expect(restricted.writable).toEqual(captured.targets)
  expect(readOnly.writable).toEqual([])
})

it('chooses disclosure from the precise focus without narrowing or inferring its write grant', () => {
  const target: ToolTarget = { kind: 'course-instance', surfaceId: 'page', instanceId: 'heading', stateId: null }
  for (const writable of [[], [{ kind: 'document' as const }], [target]]) {
    const input: Pick<ExecutionStart, 'documents' | 'contentOutput'> = { documents: [{ documentId, writable, selection: [target] }] }
    const before = structuredClone(input)
    expect(executionContextToolProfile(input)).toBe('content-edit')
    expect(input).toEqual(before)
  }
  expect(executionContextToolProfile({ documents: [{ documentId, writable: [], selection: [{ kind: 'markdown-range', from: 1, to: 4 }] }] })).toBe('text')
  expect(executionContextToolProfile({ documents: [{ documentId, writable: [], selection: [{ ...target, dataPath: ['content'], from: 0, to: 4 }] }] })).toBe('text')
  expect(executionContextToolProfile({ documents: [{ documentId, writable: [], selection: [{ ...target, dataPath: ['content'] }] }] })).toBe('content-edit')
})

it('classifies explicit text fields equally for selection and bound output while retaining object and image scopes', () => {
  const object = { kind: 'course-instance' as const, surfaceId: 'page', instanceId: 'focused', stateId: null }
  const cases: { target: NonNullable<ExecutionStart['contentOutput']>['target']; profile: 'text' | 'content-edit' }[] = [
    { target: object, profile: 'content-edit' },
    { target: { ...object, dataPath: ['title'] }, profile: 'content-edit' },
    { target: { ...object, dataPath: ['title'], from: 0, to: 4 }, profile: 'text' },
    { target: { ...object, authorField: { kind: 'text', dataPath: ['title'], initialValue: '标题' } }, profile: 'text' },
    { target: { ...object, authorField: { kind: 'image', dataPath: ['src'], initialValue: 'image.png' } }, profile: 'content-edit' },
    { target: { kind: 'html-author-field', authorKey: 'title', field: 'text', record: { kind: 'text',
      binding: { kind: 'dom', path: [{ tag: 'p', index: 0 }], baseline: '标题' }, overrides: {} } }, profile: 'text' },
    { target: { kind: 'html-author-field', authorKey: 'image', field: 'src', record: { kind: 'image',
      binding: { kind: 'dom', path: [{ tag: 'img', index: 0 }], baseline: 'image.png' }, overrides: {} } }, profile: 'content-edit' },
    { target: { kind: 'markdown-range', from: 1, to: 4 }, profile: 'text' },
    { target: { kind: 'text-selection', fragments: [{ target: { kind: 'markdown-range', from: 1, to: 4 } }] }, profile: 'text' },
  ]
  for (const { target, profile } of cases) for (const writable of [[], [{ kind: 'document' as const }], [target]]) {
    const selection: Pick<ExecutionStart, 'documents' | 'contentOutput'> = { documents: [{ documentId, writable, selection: [target] }] }
    const output: Pick<ExecutionStart, 'documents' | 'contentOutput'> = {
      documents: [{ documentId, writable, selection: [object] }], contentOutput: { kind: 'content', documentId, target } }
    for (const input of [selection, output]) {
      const before = structuredClone(input)
      expect(executionContextToolProfile(input)).toBe(profile)
      expect(input).toEqual(before)
    }
  }
})

it('keeps default page/document references and multiple targets on the general disclosure path', () => {
  const object: ToolTarget = { kind: 'course-instance', surfaceId: 'page', instanceId: 'heading', stateId: null }
  for (const selection of [undefined, [{ kind: 'course-surface' as const, surfaceId: 'page' }], [{ kind: 'document' as const }], [object, { ...object, instanceId: 'body' }]]) {
    expect(executionContextToolProfile({ documents: [{ documentId, writable: [{ kind: 'document' }], selection }] })).toBe('general')
  }
  expect(executionContextToolProfile({ documents: [
    { documentId, writable: [], selection: [object] }, { documentId: 'reference-document', writable: [] },
  ] })).toBe('general')
})

it.each(['object', 'text-range'] as const)('gives a %s focus the actual model catalog and expands Source and file reads without changing authority', async focus => {
  const directory = await mkdtemp(path.join(tmpdir(), 'canvas-focus-context-'))
  directories.push(directory)
  const host = new DocumentHostService(path.join(directory, 'documents'))
  const project = createBlankCourseProjectV10('Focused model context')
  const source = 'export default { mount() { return { update() {}, dispose() {} }; } }; // focused source fixture'
  project.definitions.focused = { id: 'focused', role: 'content', implementation: { kind: 'source', language: 'javascript', source } }
  project.instances.focused = { id: 'focused', definitionId: 'focused', data: { title: 'Selected object context' } }
  setRootContainers(project, [{ id: 'focus-page', kind: 'flow', title: 'Page', childIds: ['focused'] }])
  const resources = { assets: {}, components: {} }
  const initial = await host.internalAPI.create({ kind: 'course-v10', project, resources }, 'focused.glx')
  const sourceFile = componentProjectFiles(project, resources).find(file => file.binding?.kind === 'instance-source'
    && file.binding.instanceId === 'focused' && !file.authorSource?.dependencyId)!
  expect(sourceFile).toBeDefined()
  await writeFile(path.join(directory, 'reference.txt'), 'Explicit related file context')
  const captured = focus === 'text-range'
    ? captureCourseInstanceRange(initial, 'focus-page', 'focused', ['title'], 0, Array.from('Selected object context').length)
    : captureSelection(initial, [{ kind: 'course-instance', surfaceId: 'focus-page', instanceId: 'focused', stateId: null }], 'Selected object')
  const documents = [selectionReference(captured, true)] // The default card does not restrict the document write grant.
  const requests: ModelRequest[] = []
  let projectTarget = ''
  const provider: ModelProvider = { async *stream(request) {
    const index = requests.length
    requests.push(structuredClone(request))
    if (index === 0) {
      const prefix = '本次固定文档与权限（切换界面不改变它们）：'
      const context = request.messages.find(message => message.role === 'system' && typeof message.content === 'string' && message.content.startsWith(prefix))
      expect(typeof context?.content).toBe('string')
      const references = JSON.parse((context!.content as string).slice(prefix.length))
      projectTarget = references[0].target
      expect(references[0].writable).toMatchObject([{ kind: 'document' }])
      expect(references[0].selection[0]).toMatchObject({ kind: 'course-instance', writableTarget: expect.any(String) })
      expect(references[0].selection[0].content.text).toContain('Selected object context')
      expect(JSON.stringify(request.messages)).not.toContain('focused source fixture')
    }
    const call = index === 0 ? { name: 'tools.load', input: { names: ['project.read', 'project.apply', 'file.read'] } }
      : index === 1 ? { name: 'project.read', input: { project: projectTarget, path: sourceFile.path } }
      : index === 2 ? { name: 'file.read', input: { path: 'reference.txt' } } : undefined
    const toolCalls = call ? [{ id: `focus-${index}`, name: call.name, argumentsText: JSON.stringify(call.input) }] : []
    const completed: Extract<ModelEvent, { type: 'response.completed' }> = { type: 'response.completed', requestId: request.requestId,
      sequence: 1, actualModel: 'fixture', responseId: `focus-${index}`, nativeResponse: {}, finishReason: call ? 'tool_calls' : 'stop', toolCalls,
      assistant: { role: 'assistant', content: call ? '' : '已核对所选对象及显式读取的关联资料。', ...(call ? { tool_calls: toolCalls.map(value => ({
        id: value.id, type: 'function' as const, function: { name: value.name, arguments: value.argumentsText } })) } : {}) } }
    yield completed
  } }
  const model: ModelSelection = { model: 'fixture', connection: { id: 'fixture', revision: 1, provider: 'fixture', protocol: 'openai-chat',
    baseURL: 'http://127.0.0.1:1/v1', accountId: 'fixture', auth: { kind: 'api-key', credentialRef: 'fixture' }, billing: { kind: 'unknown' },
    capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'unknown' } } }
  const engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools, provider, files: host.agentFiles,
    runs: new ExecutionRunStore(path.join(directory, 'runs')), events: new ExecutionEventStore({ directory: path.join(directory, 'events') }) })
  const started = await engine.start({ conversationId: 'focused', taskId: 'focused', instruction: '核对当前对象，再按需读取它的 Source 和 reference.txt；保留当前稿。',
    selection: model, documents, workspaceRoot: directory, permission: 'workspace' })
  const run = await engine.wait(started.runId)
  expect(run.status, JSON.stringify(run.failure)).toBe('completed')
  expect(requests).toHaveLength(4)
  const initialNames = requests[0].tools!.map(tool => tool.name)
  expect(initialNames).toEqual(expect.arrayContaining(['read', 'text.replace', 'tools.load']))
  if (focus === 'object') expect(initialNames).toContain('project.apply')
  else {
    expect(initialNames).not.toContain('project.apply')
    expect(initialNames).not.toContain('project.read')
  }
  expect(initialNames).not.toContain('object.update')
  expect(initialNames).not.toContain('file.read')
  expect(initialNames).not.toContain('programmatic.execute')
  for (const request of requests.slice(1)) expect(request.tools!.map(tool => tool.name)).toEqual(expect.arrayContaining(['project.read', 'project.apply', 'file.read']))
  expect(run.tools.find(tool => tool.call.name === 'tools.load')?.result).toMatchObject({ kind: 'read', data: { unavailable: [] } })
  expect(run.tools.find(tool => tool.call.name === 'project.read')?.result).toMatchObject({ kind: 'read', data: { content: sourceFile.content } })
  expect(JSON.stringify(run.tools.find(tool => tool.call.name === 'file.read')?.result)).toContain('Explicit related file context')
  expect(run.input.documents).toEqual(documents)
  expect(run.input.permission).toBe('workspace')
  expect(run.input.contentOutput).toBeUndefined()
  const after = await host.internalAPI.read(initial.documentId)
  for (const key of ['documentId', 'epoch', 'revision', 'model', 'binding', 'dirty', 'undoDepth', 'redoDepth'] as const)
    expect(after[key], key).toEqual(initial[key])
})

it('allows code-driven typography from a text-range focus through the same component Source and formal edit transaction', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'canvas-code-typography-'))
  directories.push(directory)
  const host = new DocumentHostService(path.join(directory, 'documents'))
  const project = createBlankCourseProjectV10('Editable code typography')
  const oldEffect = "root.style.setProperty('--caption-motion', '0px')"
  const newEffect = "root.style.setProperty('--caption-motion', '12px')"
  const source = `export default { mount(root) { ${oldEffect}; return { update() {}, dispose() {} }; } }`
  project.definitions.kineticText = { id: 'kineticText', role: 'content', implementation: { kind: 'source', language: 'javascript', source } }
  project.instances.kineticText = { id: 'kineticText', definitionId: 'kineticText', data: { title: 'Editable kinetic caption' } }
  setRootContainers(project, [{ id: 'kinetic-page', kind: 'flow', title: 'Page', childIds: ['kineticText'] }])
  const resources = { assets: {}, components: {} }
  const initial = await host.internalAPI.create({ kind: 'course-v10', project, resources }, 'kinetic.glx')
  const file = componentProjectFiles(project, resources).find(candidate => candidate.binding?.kind === 'instance-source'
    && candidate.binding.instanceId === 'kineticText' && !candidate.authorSource?.dependencyId)!
  expect(file.content).toContain(oldEffect)
  const capture = captureCourseInstanceRange(initial, 'kinetic-page', 'kineticText', ['title'], 0, 8)
  const documents = [selectionReference(capture, true)]
  const requests: ModelRequest[] = []
  const provider: ModelProvider = { async *stream(request) {
    const index = requests.length
    requests.push(structuredClone(request))
    const call = index === 0 ? { name: 'tools.load', input: { names: ['project.read', 'project.apply'] } }
      : index === 1 ? { name: 'project.read', input: { path: file.path } }
        : index === 2 ? { name: 'project.apply', input: { path: file.path, edits: [{ old: oldEffect, new: newEffect }] } } : undefined
    const calls = call ? [{ id: `kinetic-${index}`, name: call.name, argumentsText: JSON.stringify(call.input) }] : []
    const completed: Extract<ModelEvent, { type: 'response.completed' }> = {
      type: 'response.completed', requestId: request.requestId, sequence: 1, actualModel: 'fixture', responseId: `kinetic-${index}`,
      nativeResponse: {}, finishReason: call ? 'tool_calls' : 'stop', toolCalls: calls,
      assistant: { role: 'assistant', content: call ? '' : '已沿当前选中的文字组件完成 Source 效果修改。',
        ...(call ? { tool_calls: calls.map(value => ({ id: value.id, type: 'function' as const,
          function: { name: value.name, arguments: value.argumentsText } })) } : {}) },
    }
    yield completed
  } }
  const model: ModelSelection = { model: 'fixture', connection: { id: 'fixture', revision: 1, provider: 'fixture',
    protocol: 'openai-chat', baseURL: 'http://127.0.0.1:1/v1', accountId: 'fixture',
    auth: { kind: 'api-key', credentialRef: 'fixture' }, billing: { kind: 'unknown' },
    capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'unknown' } } }
  const engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools, provider, files: host.agentFiles,
    runs: new ExecutionRunStore(path.join(directory, 'runs')), events: new ExecutionEventStore({ directory: path.join(directory, 'events') }) })
  const started = await engine.start({ conversationId: 'kinetic', taskId: 'kinetic',
    instruction: '当前选中文字需要代码级动效，保持对象身份和原有正文，仅修改该组件的内部 Source。',
    selection: model, documents, workspaceRoot: directory, permission: 'workspace' })
  const run = await engine.wait(started.runId)
  expect(run.status, JSON.stringify(run.failure)).toBe('completed')
  expect(requests).toHaveLength(4)
  expect(requests[0].tools!.map(tool => tool.name)).not.toContain('project.apply')
  for (const request of requests.slice(1)) expect(request.tools!.map(tool => tool.name)).toContain('project.apply')
  expect(run.tools.find(tool => tool.call.name === 'project.read')?.result).toMatchObject({ kind: 'read' })
  const applied = run.tools.find(tool => tool.call.name === 'project.apply')?.result
  expect(applied, JSON.stringify(applied)).toMatchObject({ kind: 'read', data: { commit: 'committed',
    receipt: { status: 'applied', appliedChanges: { affectedTargets: ['kineticText'] } } } })
  const after = await host.internalAPI.read(initial.documentId)
  expect(after.revision).toBe(initial.revision + 1)
  expect(after.undoDepth).toBe(initial.undoDepth + 1)
  expect(after.model.kind).toBe('course-v10')
  if (after.model.kind !== 'course-v10') return
  expect(after.model.project.instances.kineticText.data).toEqual(project.instances.kineticText.data)
  expect(after.model.project.instances.kineticText.definitionId).toBe('kineticText')
  const updated = componentProjectFiles(after.model.project, after.model.resources).find(candidate => candidate.path === file.path)
  expect(updated?.content).toContain(newEffect)
  expect(updated?.content).not.toContain(oldEffect)
})
