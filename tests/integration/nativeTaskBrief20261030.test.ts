// @vitest-environment node
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
import { DelegationJobService } from '../../src/main/workbench/delegation/DelegationJobService'
import { NativeTaskRunner, type NativeExecutionEnginePort } from '../../src/main/workbench/delegation/NativeTaskRunner'
import { ReadonlyTaskRunner } from '../../src/main/workbench/delegation/ReadonlyTaskRunner'
import { freezeTaskInputs } from '../../src/main/workbench/delegation/freezeTaskInputs'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { AgentFileService } from '../../src/main/workbench/execution/AgentFileService'
import type { ExecutionRunRecord, ExecutionStart } from '../../src/shared/workbench/execution'
import type { ModelProvider, ModelSelection } from '../../src/shared/workbench/modelProvider'
import type { PreparedTaskSource } from '../../src/shared/workbench/toolPorts'

it('starts native long-source reads at the first page while preserving complete provenance and target context', async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'native-task-brief-'))
  const workspaceRoot = path.join(root, 'parent')
  await fs.mkdir(workspaceRoot)
  const originalPath = path.join(workspaceRoot, 'material.md')
  const longText = 'BEGIN-FIRST-PAGE\n' + '首'.repeat(64000) + '\nEND-LAST-PAGE'
  await fs.writeFile(originalPath, longText)
  const host = new DocumentHostService(path.join(root, 'documents')), files = new AgentFileService(host)
  const parentAccess = { runId: 'parent', workspaceRoot, permission: 'workspace' as const }
  const frozen = await freezeTaskInputs([originalPath], {
    assertActive: () => {}, isMaterial: () => false,
    material: async () => { throw new Error('This source is an ordinary file') },
    authorize: source => files.authorizeTaskInput(parentAccess, source), opened: async () => undefined,
    disk: source => files.readAuthorizedFile(parentAccess, source),
  }, { sourceVersion: 'disk' })
  expect(frozen).toHaveLength(1)
  expect(frozen[0]!.modelRepresentation?.read?.offset).toBe(64000)
  const selection: ModelSelection = { model: 'native-brief-fixture', connection: { id: 'native-brief-fixture', revision: 1,
    provider: 'fixture', protocol: 'openai-chat', baseURL: 'https://fixture.invalid', accountId: 'unused',
    auth: { kind: 'api-key', credentialRef: 'unused' }, billing: { kind: 'unknown' },
    capabilities: { tools: 'supported', vision: 'unknown', stream: 'supported', reasoning: 'unknown' } } }
  const record = (runId: string, input: ExecutionStart): ExecutionRunRecord => ({ schemaVersion: 1, runId, version: 1,
    input, status: 'running', createdAt: 1, updatedAt: 1, messages: [], initialMessageCount: 0, requests: [], tools: [] })
  const parent = record('parent', { conversationId: 'parent-conversation', taskId: 'parent-task', instruction: 'Parent work',
    selection, workspaceRoot, documents: [], permission: 'workspace' })
  const targetContext = { project: 'lesson.glx', path: 'pages/scene', revision: 7,
    explanation: 'A frozen observation, not a writer grant', labels: ['保留目标身份', 'source/version unchanged'] }
  const targetText = JSON.stringify(targetContext)
  const sources: PreparedTaskSource[] = [
    { ...frozen[0]!, name: 'unit1/material.md' },
    { source: 'attachment:notes', name: 'unit1/notes.docx', mimeType: 'application/octet-stream', version: 'attachment:notes:v4',
      bytes: new Uint8Array([0x50, 0x4b, 0, 0xff]), modelRepresentation: { mimeType: 'text/plain', text: 'Extracted notes',
        read: { source: 'attachment:notes', version: 'attachment:notes:v4', offset: 0 } } },
    { source: 'task-target:parent', name: '__task_target_context.json', mimeType: 'application/json', version: 'target-context-v7',
      bytes: new TextEncoder().encode(targetText), modelRepresentation: { mimeType: 'application/json', text: targetText } },
  ]
  // The declared output collides with an input, so the real job owner must prefix
  // the complete input tree; the model's advertised path must follow that owner.
  const intent = { goal: '保留来源身份并完成这个独立单元', sharedBrief: '只形成声明候选，不修改父文档', role: '局部作者',
    outputs: ['unit1/material.md'] }
  const beforeSources = structuredClone(sources), beforeIntent = structuredClone(intent)
  let child!: ExecutionRunRecord
  const start = vi.fn<NativeExecutionEnginePort['start']>(async (input, _continuation, onPrepared) => {
    child = record('child', input)
    await onPrepared?.(child)
    const marker = '共享约定、目标、来源版本和成果如下：\n'
    const brief = JSON.parse(input.instruction.slice(input.instruction.indexOf(marker) + marker.length))
    expect(brief).toMatchObject({ goal: intent.goal, sharedBrief: intent.sharedBrief, rolePreference: intent.role,
      parentJob: 'brief-job', outputs: intent.outputs })
    expect(brief.sources).toHaveLength(sources.length)
    for (const source of sources) {
      const item = brief.sources.find((entry: { source: string }) => entry.source === source.source)
      expect(item).toBeDefined()
      expect(item).not.toHaveProperty('name')
      expect(item).not.toHaveProperty('bytes')
      expect(item).toMatchObject({ source: source.source, path: `inputs/${source.name}`, mimeType: source.mimeType,
        version: source.version, byteLength: source.bytes.byteLength })
      expect(item.representation).not.toHaveProperty('read')
      expect(item.representation).toEqual({ mimeType: source.modelRepresentation!.mimeType })
      expect(new Uint8Array(await fs.readFile(path.join(input.workspaceRoot!, item.path)))).toEqual(source.bytes)
    }
    const ordinary = brief.sources.find((entry: { source: string }) => entry.source === originalPath)
    expect(ordinary).not.toHaveProperty('text')
    const readContext = { runId: 'child', workspaceRoot: input.workspaceRoot!, permission: 'workspace' as const }
    let cursor: string | undefined, actualText = '', pages = 0
    do {
      // These are the actual file.read parameters. No invented source/version/offset API.
      const result = await files.execute(readContext, 'file.read', {
        path: ordinary.path, limit: 32000, ...(cursor ? { cursor } : {}),
      }, `read-page-${pages}`)
      const page = result.data as { text: string; offset: number; nextCursor?: string }
      expect(page.offset).toBe(actualText.length)
      if (pages === 0) expect(page.text).toMatch(/^BEGIN-FIRST-PAGE/)
      actualText += page.text; pages++
      cursor = page.nextCursor
    } while (cursor)
    expect(pages).toBeGreaterThan(2)
    expect(actualText).toBe(longText)
    const target = brief.sources.find((entry: { source: string }) => entry.source === 'task-target:parent')
    expect(target.text).toBe(targetText)
    expect(JSON.parse(target.text)).toEqual(targetContext)
    await fs.mkdir(path.join(input.workspaceRoot!, 'unit1'), { recursive: true })
    await fs.writeFile(path.join(input.workspaceRoot!, intent.outputs[0]!), 'reviewable candidate')
    return child
  })
  const engine: NativeExecutionEnginePort = {
    start, resume: async () => { throw new Error('No continuation is exercised') },
    read: async runId => runId === 'parent' ? parent : runId === 'child' ? child : null,
    wait: async () => ({ ...child, status: 'completed' }),
    stop: async () => child ? { ...child, status: 'stopped' } : null,
    subscribe: () => () => {}, message: async () => parent,
  }
  const service = new DelegationJobService({ directory: path.join(root, 'jobs'), copyRootBase: path.join(root, 'copies'),
    nativeRunner: new NativeTaskRunner({ engine: () => engine }) })
  try {
    await service.startNative({ runId: 'parent', jobId: 'brief-job', taskId: 'brief-task', permission: 'workspace', intent, sources })
    const ready = await service.wait('parent', 'brief-job', 5000)
    expect(ready, ready.reason).toMatchObject({ status: 'ready', candidateComplete: true })
    expect(start).toHaveBeenCalledOnce()
    expect(Buffer.from((await service.readArtifact('parent', 'brief-job', intent.outputs[0]!)).bytes).toString('utf8'))
      .toBe('reviewable candidate')
    expect(sources).toEqual(beforeSources)
    expect(intent).toEqual(beforeIntent)
    expect(await fs.readFile(originalPath, 'utf8')).toBe(longText)
    // The source owner and the separate readonly projection still retain the
    // excerpt and its genuine continuation position; only Native's view differs.
    let readonlyCalls = 0
    const provider: ModelProvider = { async *stream(request) {
      readonlyCalls++
      expect(request.tools ?? []).toEqual([])
      const payload = JSON.parse(String(request.messages.find(message => message.role === 'user')?.content))
      const text = payload.sources.find((entry: { source: string }) => entry.source === originalPath)
      expect(text.text).toBe(frozen[0]!.modelRepresentation!.text)
      expect(text.read).toEqual(frozen[0]!.modelRepresentation!.read)
      expect(text.representation.read).toEqual(frozen[0]!.modelRepresentation!.read)
      expect(text.read.offset).toBe(64000)
      yield { type: 'response.completed', requestId: request.requestId, sequence: 1, responseId: 'readonly-brief-proof',
        actualModel: selection.model, assistant: { role: 'assistant', content: 'Readonly source contract retained.' },
        toolCalls: [], finishReason: 'stop', nativeResponse: {} }
    } }
    const readonlyRoot = path.join(root, 'readonly')
    await fs.mkdir(readonlyRoot)
    const readonly = new ReadonlyTaskRunner({ provider, parentSelection: () => selection })
    expect(await readonly.run({ runId: 'parent', taskId: 'readonly-proof', copyRoot: readonlyRoot,
      intent: { goal: 'Keep the separate readonly projection', sources: sources.map(source => source.source) }, sources }))
      .toMatchObject({ status: 'verified' })
    expect(readonlyCalls).toBe(1)
    expect(sources).toEqual(beforeSources)
  } finally {
    await service.cancelRun('parent')
    files.releaseRun('child'); files.releaseRun('parent')
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
  }
})

it('keeps actual target file.read locators valid when the native owner relocates colliding input trees', async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'native-target-locators-'))
  const host = new DocumentHostService(path.join(root, 'documents')), files = new AgentFileService(host)
  const selection: ModelSelection = { model: 'fixture', connection: { id: 'fixture', revision: 1, provider: 'fixture',
    protocol: 'openai-chat', baseURL: 'https://fixture.invalid', accountId: 'unused',
    auth: { kind: 'api-key', credentialRef: 'unused' }, billing: { kind: 'unknown' },
    capabilities: { tools: 'supported', vision: 'unknown', stream: 'supported', reasoning: 'unknown' } } }
  const record = (runId: string, input: ExecutionStart): ExecutionRunRecord => ({ schemaVersion: 1, runId, version: 1,
    input, status: 'running', createdAt: 1, updatedAt: 1, messages: [], initialMessageCount: 0, requests: [], tools: [] })
  const parent = record('parent', { conversationId: 'parent', taskId: 'task', instruction: 'Parent', documents: [],
    permission: 'full', selection, workspaceRoot: root })
  const entry = '__task_target/pages/scene.view.js', dependency = '__task_target/pages/scene.dependencies/helper.view.js'
  const context = { documentId: 'formal-parent', epoch: 'epoch', revision: 7, path: 'pages/scene.view.js', inputs: {
    entry: { projectPath: 'pages/scene.view.js', path: entry, read: { tool: 'file.read', path: entry } },
    files: [{ projectPath: 'pages/scene.view.js', path: entry }, { projectPath: 'pages/scene.dependencies/helper.view.js', path: dependency }],
  } }
  const targetText = JSON.stringify(context)
  const sources: PreparedTaskSource[] = [
    { source: 'facts.md', name: 'facts.md', mimeType: 'text/plain', bytes: new TextEncoder().encode('original input') },
    { source: 'project:formal-parent#project:pages/scene.view.js', name: entry, mimeType: 'text/plain', bytes: new TextEncoder().encode('CURRENT_TARGET_SOURCE') },
    { source: 'project:formal-parent#project:pages/scene.dependencies/helper.view.js', name: dependency, mimeType: 'text/plain', bytes: new TextEncoder().encode('CURRENT_DEPENDENCY') },
    { source: 'task-target:parent', name: '__task_target_context.json', mimeType: 'application/json',
      bytes: new TextEncoder().encode(targetText), version: 'before-relocation', modelRepresentation: { mimeType: 'application/json', text: targetText } },
  ]
  let child!: ExecutionRunRecord
  const start = vi.fn<NativeExecutionEnginePort['start']>(async (input, _continuation, onPrepared) => {
    child = record('child', input); await onPrepared?.(child)
    expect(input.documents).toEqual([])
    expect(input.permission).toBe('full')
    const marker = '共享约定、目标、来源版本和成果如下：\n'
    const brief = JSON.parse(input.instruction.slice(input.instruction.indexOf(marker) + marker.length))
    const target = brief.sources.find((source: { source: string }) => source.source === 'task-target:parent')
    const frozenContext = JSON.parse(target.text)
    expect(frozenContext.path).toBe(context.path)
    expect(frozenContext.inputs.entry.read.path).toBe('inputs/' + entry)
    expect(frozenContext.inputs.files.map((file: { path: string }) => file.path)).toEqual(['inputs/' + entry, 'inputs/' + dependency])
    expect(await fs.readFile(path.join(input.workspaceRoot!, target.path), 'utf8')).toBe(target.text)
    const read = await files.execute({ runId: 'child', workspaceRoot: input.workspaceRoot!, permission: 'workspace' },
      'file.read', { path: frozenContext.inputs.entry.read.path }, 'read-target')
    expect(read).toMatchObject({ data: { text: 'CURRENT_TARGET_SOURCE' } })
    for (const file of frozenContext.inputs.files) expect((await fs.stat(path.join(input.workspaceRoot!, file.path))).isFile()).toBe(true)
    await fs.writeFile(path.join(input.workspaceRoot!, 'facts.md'), 'new candidate')
    return child
  })
  const engine: NativeExecutionEnginePort = { start, resume: async () => { throw new Error('No resume') },
    read: async runId => runId === 'parent' ? parent : runId === 'child' ? child : null,
    wait: async () => ({ ...child, status: 'completed' }), stop: async () => child ? { ...child, status: 'stopped' } : null,
    subscribe: () => () => {}, message: async () => parent }
  const service = new DelegationJobService({ directory: path.join(root, 'jobs'), copyRootBase: path.join(root, 'copies'),
    nativeRunner: new NativeTaskRunner({ engine: () => engine }) })
  try {
    await service.startNative({ runId: 'parent', jobId: 'target-collision', taskId: 'target-collision', permission: 'full',
      intent: { goal: 'Read target, deliver independent candidate', outputs: ['facts.md'] }, sources })
    const result = await service.wait('parent', 'target-collision', 5000)
    expect(result, result.reason).toMatchObject({ status: 'ready', candidateComplete: true })
    expect(start).toHaveBeenCalledOnce()
    expect(new TextDecoder().decode(sources[3]!.bytes)).toBe(targetText)
  } finally {
    await service.cancelRun('parent'); files.releaseRun('child')
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
  }
})
