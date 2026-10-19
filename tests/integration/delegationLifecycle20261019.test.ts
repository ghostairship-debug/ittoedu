// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DelegationJobService } from '../../src/main/workbench/delegation/DelegationJobService'
import { CodexDelegationRunner, type CodexDelegationBoundaryPort } from '../../src/main/workbench/delegation/CodexDelegationRunner'
import { LocalToolRunner } from '../../src/main/workbench/delegation/LocalToolRunner'
import type { WindowsCodexSandboxBoundary } from '../../src/main/workbench/delegation/WindowsCodexSandboxBoundary'
import { ReadonlyTaskRunner } from '../../src/main/workbench/delegation/ReadonlyTaskRunner'
import type { ModelProvider, ModelRequest, ModelSelection } from '../../src/shared/workbench/modelProvider'

const roots: string[] = []
afterEach(async () => {
  vi.useRealTimers(); vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })))
})
function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
async function fixture() {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'guoling-delegation-lifecycle-'))
  roots.push(root)
  const copyRootBase = path.join(root, 'copies'), copyRoot = path.join(copyRootBase, 'approved')
  const workspaceRoot = path.join(root, 'workspace')
  await fs.mkdir(copyRoot, { recursive: true }); await fs.mkdir(workspaceRoot)
  return { root, copyRootBase, copyRoot, workspaceRoot, directory: path.join(root, 'jobs') }
}
const input = (copyRoot: string) => ({ runId: 'parent', jobId: 'delegate-task', taskId: 'task',
  goal: 'Create an independently reviewable result', permission: 'workspace' as const, copyRoot, expectedArtifacts: ['answer.txt'] })
const runnerResult = (taskId: string) => ({ taskId, status: 'verified' as const, configuredModel: 'gpt-6-luna' as const,
  configuredSpeed: 'priority' as const, artifacts: [], reason: 'completed fixture', externalChangesPossible: true })

it('closes admission when Stop arrives during the existing-receipt read', async () => {
  const paths = await fixture(), entered = deferred(), release = deferred()
  const readFile = fs.readFile.bind(fs)
  vi.spyOn(fs, 'readFile').mockImplementation((async (filename: any, ...args: any[]) => {
    if (String(filename).endsWith('state.json')) { entered.resolve(); await release.promise }
    return (readFile as any)(filename, ...args)
  }) as typeof fs.readFile)
  const run = vi.fn<CodexDelegationRunner['run']>(async request => runnerResult(request.taskId))
  const service = new DelegationJobService({ ...paths, runner: { run } })
  const starting = service.start(input(paths.copyRoot))
  await entered.promise
  await service.cancelRun('parent')
  release.resolve()
  await expect(starting).rejects.toMatchObject({ code: 'run-stopped' })
  expect(run).not.toHaveBeenCalled()
})

it('registers cancellation before the first durable receipt is published', async () => {
  const paths = await fixture(), entered = deferred(), release = deferred()
  const rename = fs.rename.bind(fs)
  let held = false
  vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
    if (!held && String(to).endsWith('state.json')) { held = true; entered.resolve(); await release.promise }
    return rename(from, to)
  })
  const run = vi.fn<CodexDelegationRunner['run']>(async request => runnerResult(request.taskId))
  const service = new DelegationJobService({ ...paths, runner: { run } })
  const starting = service.start(input(paths.copyRoot))
  await entered.promise
  const stopping = service.cancelRun('parent')
  release.resolve()
  await starting; await stopping
  expect(await service.status('parent', 'delegate-task')).toMatchObject({ status: 'cancelled', stopped: true, artifacts: [] })
  expect(run).not.toHaveBeenCalled()
})

it('owns managed input copying as cancellable preparation and never launches the cancelled job', async () => {
  const paths = await fixture(), entered = deferred(), release = deferred()
  const filename = path.join(paths.workspaceRoot, 'material.txt')
  await fs.writeFile(filename, 'original material')
  const readFile = fs.readFile.bind(fs)
  vi.spyOn(fs, 'readFile').mockImplementation((async (target: any, ...args: any[]) => {
    if (String(target) === filename) { entered.resolve(); await release.promise }
    return (readFile as any)(target, ...args)
  }) as typeof fs.readFile)
  const run = vi.fn<CodexDelegationRunner['run']>(async request => runnerResult(request.taskId))
  const service = new DelegationJobService({ ...paths, runner: { run } })
  const { copyRoot: _copyRoot, ...task } = input(paths.copyRoot)
  const starting = service.startManaged({ ...task, workspaceRoot: paths.workspaceRoot, materials: ['material.txt'] })
  await entered.promise
  expect(await starting).toMatchObject({ status: 'preparing' })
  const stopping = service.cancelRun('parent')
  release.resolve(); await stopping
  expect(await service.status('parent', task.jobId)).toMatchObject({ status: 'cancelled', stopped: true })
  expect(run).not.toHaveBeenCalled()
  expect(await readFile(filename, 'utf8')).toBe('original material')
})

it('uses frozen current source bytes and replays a receipt without rebuilding its missing copy or old source', async () => {
  const paths = await fixture(), bytes = new TextEncoder().encode('unsaved current draft')
  let actualCopy = ''
  const run = vi.fn<CodexDelegationRunner['run']>(async request => {
    actualCopy = request.copyRoot
    expect(await fs.readFile(path.join(actualCopy, 'current.html'), 'utf8')).toBe('unsaved current draft')
    await fs.writeFile(path.join(actualCopy, 'answer.txt'), 'retained candidate')
    return runnerResult(request.taskId)
  })
  const service = new DelegationJobService({ ...paths, runner: { run } })
  const { copyRoot: _copyRoot, ...task } = input(paths.copyRoot)
  const source = { source: 'current.html', name: 'current.html', mimeType: 'text/html', version: 'document:epoch:7', bytes }
  const request = { ...task, workspaceRoot: paths.workspaceRoot, sources: [source] }
  const starting = service.startManaged(request)
  bytes.fill(0)
  await starting
  expect(await service.wait('parent', task.jobId, 5000)).toMatchObject({ status: 'ready' })
  await fs.rm(actualCopy, { recursive: true }); await fs.rm(paths.workspaceRoot, { recursive: true })
  expect(await service.startManaged({ ...request, sources: [{ ...source, bytes: new TextEncoder().encode('unsaved current draft') }] }))
    .toMatchObject({ status: 'ready' })
  expect(run).toHaveBeenCalledOnce()
  expect(Buffer.from((await service.readArtifact('parent', task.jobId, 'answer.txt')).bytes).toString()).toBe('retained candidate')
})

function childFixture() {
  return Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    kill: vi.fn(), exitCode: null }) as unknown as ChildProcessWithoutNullStreams
}

it('does not launch Codex when cancellation arrives during log preparation', async () => {
  const paths = await fixture(), entered = deferred(), release = deferred(), controller = new AbortController()
  const mkdtemp = fs.mkdtemp.bind(fs)
  vi.spyOn(fs, 'mkdtemp').mockImplementation((async (prefix: any, ...args: any[]) => {
    if (String(prefix).includes('guoling-delegation-log-')) { entered.resolve(); await release.promise }
    return (mkdtemp as any)(prefix, ...args)
  }) as typeof fs.mkdtemp)
  const boundary: CodexDelegationBoundaryPort = { assertReady: async () => true,
    launchRestricted: vi.fn(() => childFixture()), stopRestricted: vi.fn(async () => true) }
  const runner = new CodexDelegationRunner({ boundary, inspectCli: async () => ({ ready: true, reason: 'fixture' }) })
  const running = runner.run({ ...input(paths.copyRoot), executablePath: process.execPath },
    { signal: controller.signal, verify: vi.fn() })
  await entered.promise; controller.abort(); release.resolve()
  expect(await running).toMatchObject({ status: 'cancelled', externalChangesPossible: false })
  expect(boundary.launchRestricted).not.toHaveBeenCalled()
  expect(boundary.stopRestricted).not.toHaveBeenCalled()
})

it('hands an already-aborted launch back to process-tree Stop without sending a Codex prompt', async () => {
  const paths = await fixture(), controller = new AbortController(), child = childFixture()
  const prompt = vi.spyOn(child.stdin, 'end'), stop = vi.fn(async () => { queueMicrotask(() => child.emit('close', 0, null)); return true })
  const runner = new CodexDelegationRunner({ inspectCli: async () => ({ ready: true, reason: 'fixture' }), boundary: {
    assertReady: async () => true, launchRestricted: () => { controller.abort(); return child }, stopRestricted: stop } })
  const result = await runner.run({ ...input(paths.copyRoot), executablePath: process.execPath }, { signal: controller.signal, verify: vi.fn() })
  if (result.diagnosticFile) roots.push(path.dirname(result.diagnosticFile))
  expect(result).toMatchObject({ status: 'cancelled', externalChangesPossible: true })
  expect(prompt).not.toHaveBeenCalled(); expect(stop).toHaveBeenCalledOnce()
})

it('does not send local stdin after the launch handoff has been cancelled', async () => {
  const paths = await fixture(), controller = new AbortController(), child = childFixture()
  const stdin = vi.spyOn(child.stdin, 'end'), stop = vi.fn(async () => { queueMicrotask(() => child.emit('close', 0)); return true })
  const boundary = { assertReady: async () => true, launchToolRestricted: () => { controller.abort(); return child }, stopRestricted: stop }
  const runner = new LocalToolRunner({ boundary: boundary as unknown as WindowsCodexSandboxBoundary })
  const result = await runner.run('local', { executable: process.execPath, sandboxExecutable: process.execPath,
    args: [], cwd: paths.copyRoot, stdin: 'must not be sent' }, { signal: controller.signal })
  expect(result.status).toBe('cancelled'); expect(stdin).not.toHaveBeenCalled(); expect(stop).toHaveBeenCalledOnce()
})

const selection: ModelSelection = { model: 'frozen-model', outputLimit: 16_384,
  parameters: { temperature: 0.2, max_tokens: 16_384, thinking: { type: 'enabled', budget_tokens: 8192 } },
  connection: { id: 'parent-connection', revision: 1, provider: 'fixture', protocol: 'anthropic-messages',
    baseURL: 'https://fixture.invalid', accountId: 'account', auth: { kind: 'api-key', credentialRef: 'unused' },
    billing: { kind: 'unknown' }, capabilities: { tools: 'supported', vision: 'unknown', stream: 'supported', reasoning: 'supported' } } }

it('keeps readonly work alive without an added deadline, preserves frozen parameters and cumulative full usage, and marks partial output', async () => {
  const paths = await fixture(), entered = deferred(), release = deferred(), requests: ModelRequest[] = []
  let aborted = false
  const usage = { inputTokens: 80, outputTokens: 30, totalTokens: 110, cachedInputTokens: 60, reasoningTokens: 20,
    raw: { input_tokens: 80, output_tokens: 30, cache_read_input_tokens: 60, cache_creation_input_tokens: 10 } }
  const provider: ModelProvider = { async *stream(request, options) {
    requests.push(request); options?.signal?.addEventListener('abort', () => { aborted = true })
    yield { type: 'usage.reported', requestId: request.requestId, sequence: 1, usage: { ...usage, outputTokens: 2, totalTokens: 82 } }
    entered.resolve(); await release.promise
    yield { type: 'response.completed', requestId: request.requestId, sequence: 2, responseId: 'actual-response', actualModel: 'actual-model',
      assistant: { role: 'assistant', content: 'Useful partial research with a source.' }, toolCalls: [], finishReason: 'length', usage, nativeResponse: {} }
  } }
  const runner = new ReadonlyTaskRunner({ provider, parentSelection: () => selection })
  vi.useFakeTimers()
  let settled = false
  const running = runner.run({ runId: 'parent', taskId: 'readonly', copyRoot: paths.copyRoot,
    intent: { goal: 'Read supplied evidence', sources: [] }, sources: [] }).then(result => { settled = true; return result })
  await entered.promise
  await vi.advanceTimersByTimeAsync(3 * 60 * 60_000)
  expect(settled).toBe(false); expect(aborted).toBe(false)
  release.resolve()
  const result = await running
  expect(requests[0]!.selection).toEqual(selection)
  expect(result).toMatchObject({ status: 'verified', candidateComplete: false, actualModel: 'actual-model', usage, requestId: requests[0]!.requestId })
  expect(await fs.readFile(path.join(paths.copyRoot, 'report.md'), 'utf8')).toContain('Useful partial research')
})
