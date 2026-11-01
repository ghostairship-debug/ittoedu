// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { zipSync } from 'fflate'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
const runner = vi.hoisted(() => ({ run: vi.fn() }))
const processes = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: processes.spawn }))
vi.mock('../../src/main/workbench/compute/nativePythonProcess', () => ({
  pythonEnvironment: (extra: NodeJS.ProcessEnv = {}) => extra, runPythonProcess: runner.run,
}))
import { NativePythonRuntime } from '../../src/main/workbench/compute/NativePythonRuntime'
import { NativePythonComputeBackend } from '../../src/main/workbench/compute/NativePythonComputeBackend'
const roots: string[] = []
afterEach(async () => { runner.run.mockReset(); processes.spawn.mockReset(); vi.useRealTimers(); for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }) })
async function fixture() { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-python-')); roots.push(root); return root }
it('reuses an existing usable Python including its user site without downloading', async () => {
  const directory = await fixture(), executable = path.join(directory, 'existing/python.exe'), download = vi.fn()
  runner.run.mockResolvedValue({ code: 0, stdout: JSON.stringify({ executable, version: [3, 12], missing: [] }), stderr: '' })
  expect(await new NativePythonRuntime({ directory, candidates: [{ executable }], download }).ensure(new AbortController().signal, () => {})).toBe(executable)
  expect(download).not.toHaveBeenCalled()
  expect(runner.run.mock.calls[0][1]).toContain('-E')
  expect(runner.run.mock.calls[0][1]).not.toContain('-I')
})
it('supplements the selected environment with missing packages and constrains existing versions, without creating a venv', async () => {
  const directory = await fixture(), executable = path.join(directory, 'existing/python.exe')
  await fs.mkdir(path.join(directory, 'uv-0.13.6')); await fs.writeFile(path.join(directory, 'uv-0.13.6/uv.exe'), 'fixture')
  let installed = false, constraints = ''
  runner.run.mockImplementation(async (command: string, args: string[]) => {
    if (args.includes('install')) { constraints = await fs.readFile(args[args.indexOf('--constraint') + 1], 'utf8'); installed = true; return { code: 0, stdout: '', stderr: '' } }
    if (args.at(-1)?.includes('distributions()')) return { code: 0, stdout: 'numpy==2.4.0\n', stderr: '' }
    if (command !== executable) throw new Error('missing')
    return { code: 0, stdout: JSON.stringify({ executable, version: [3, 12], missing: installed ? [] : ['pandas'] }), stderr: '' }
  })
  expect(await new NativePythonRuntime({ directory, candidates: [{ executable }] }).ensure(new AbortController().signal, () => {})).toBe(executable)
  const commands = runner.run.mock.calls.map(call => call[1] as string[])
  expect(commands.some(args => args.includes('venv'))).toBe(false)
  expect(commands.find(args => args.includes('install'))).toEqual(expect.arrayContaining(['--python', executable, 'pandas', '--constraint']))
  expect(commands.find(args => args.includes('install'))).not.toContain('numpy')
  expect(constraints).toContain('numpy==2.4.0')
})
it('cancels a queued caller promptly but waits for the active download cleanup', async () => {
  const directory = await fixture(), a = new AbortController(), b = new AbortController()
  let enter!: () => void, cleanup!: () => void
  const entered = new Promise<void>(resolve => { enter = resolve }), release = new Promise<void>(resolve => { cleanup = resolve })
  runner.run.mockRejectedValue(new Error('no Python'))
  const runtime = new NativePythonRuntime({ directory, candidates: [], download: async (_url, signal) => {
    enter(); await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true })); await release; signal.throwIfAborted(); return new Response()
  } })
  const first = runtime.ensure(a.signal, () => {}), firstResult = first.catch(error => error)
  await entered
  const second = runtime.ensure(b.signal, () => {}); const secondResult = second.catch(error => error)
  b.abort(); expect(await secondResult).toBe(b.signal.reason)
  let settled = false; void firstResult.then(() => { settled = true })
  a.abort(); await new Promise(resolve => setTimeout(resolve, 0)); expect(settled).toBe(false)
  cleanup(); expect(await firstResult).toBe(a.signal.reason)
})
it('rejects a corrupted downloaded executable before launching it', async () => {
  const directory = await fixture(), archive = zipSync({ 'uv.exe': new Uint8Array([1, 2, 3]) })
  runner.run.mockRejectedValue(new Error('missing'))
  const download = vi.fn(async (url: string) => new Response(url.endsWith('.sha256') ? createHash('sha256').update('other').digest('hex') : archive))
  await expect(new NativePythonRuntime({ directory, candidates: [], download }).ensure(new AbortController().signal, () => {})).rejects.toThrow('下载不完整')
  expect(runner.run).not.toHaveBeenCalled()
})

// Model the real exit/close split without launching or killing any OS process.
function processFixture() {
  const pipe = () => {
    const events = new EventEmitter()
    return Object.assign(events, {
      destroyed: false, setEncoding: vi.fn(),
      destroy(): void { if (!this.destroyed) { this.destroyed = true; events.emit('close') } },
    })
  }
  const child = Object.assign(new EventEmitter(), { pid: 12345, exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null, stdout: pipe(), stderr: pipe() })
  let closed = false
  const close = () => { if (!closed) { closed = true; child.emit('close', child.exitCode) } }
  const closeIfReleased = () => { if (child.exitCode !== null && child.stdout.destroyed && child.stderr.destroyed) close() }
  child.stdout.on('close', closeIfReleased); child.stderr.on('close', closeIfReleased)
  processes.spawn.mockReturnValue(child)
  return { child, close, exit: () => { child.exitCode = 0; child.emit('exit', 0, null); closeIfReleased() } }
}
async function actualRunner() {
  return (await vi.importActual<typeof import('../../src/main/workbench/compute/nativePythonProcess')>(
    '../../src/main/workbench/compute/nativePythonProcess')).runPythonProcess
}
it('settles native cancellation after parent exit without waiting for inherited pipes', async () => {
  const run = await actualRunner(), fixture = processFixture(), controller = new AbortController()
  const onStop = vi.fn()
  const result = run('owned-fixture', [], { signal: controller.signal, onStop }).catch(error => error)
  fixture.exit(); controller.abort()
  expect(await result).toBe(controller.signal.reason)
  expect(fixture.child.stdout.destroyed).toBe(true); expect(fixture.child.stderr.destroyed).toBe(true)
  expect(processes.spawn).toHaveBeenCalledOnce()
  expect(onStop).toHaveBeenCalledWith(false)
})
it('settles native timeout after parent exit as failure rather than incomplete success', async () => {
  vi.useFakeTimers()
  const run = await actualRunner(), fixture = processFixture()
  const result = run('owned-fixture', [], { timeoutMs: 100 }).catch(error => error)
  fixture.exit(); await vi.advanceTimersByTimeAsync(100)
  expect(await result).toMatchObject({ name: 'TimeoutError' })
  expect(fixture.child.stdout.destroyed).toBe(true); expect(fixture.child.stderr.destroyed).toBe(true)
  expect(processes.spawn).toHaveBeenCalledOnce()
})
it('collects normal native output until pipe close even after parent exit', async () => {
  const run = await actualRunner(), fixture = processFixture(), log = vi.fn(), onStop = vi.fn()
  let settled = false
  const result = run('owned-fixture', [], { log, onStop }).then(value => { settled = true; return value })
  fixture.child.stdout.emit('data', 'parent output\n'); fixture.exit()
  await Promise.resolve(); expect(settled).toBe(false)
  fixture.child.stdout.emit('data', 'descendant output\n'); fixture.child.stderr.emit('data', 'descendant error\n')
  fixture.close()
  expect(await result).toEqual({ code: 0, stdout: 'parent output\ndescendant output\n', stderr: 'descendant error\n' })
  expect(log.mock.calls.map(call => call[0])).toEqual(['parent output\n', 'descendant output\n', 'descendant error\n'])
  expect(fixture.child.stdout.destroyed).toBe(false); expect(fixture.child.stderr.destroyed).toBe(false)
  expect(onStop).not.toHaveBeenCalled()
})
it.skipIf(process.platform !== 'win32').each([0, 1, 'error'])('reports Windows taskkill confirmation for %s', async outcome => {
  const run = await actualRunner(), fixture = processFixture(), killer = new EventEmitter(), controller = new AbortController(), onStop = vi.fn()
  processes.spawn.mockReturnValueOnce(fixture.child).mockReturnValueOnce(killer)
  const result = run('owned-fixture', [], { signal: controller.signal, onStop }).catch(error => error)
  controller.abort()
  if (outcome === 'error') killer.emit('error', new Error('owned taskkill fixture failed'))
  else killer.emit('close', outcome)
  fixture.exit()
  expect(await result).toBe(controller.signal.reason)
  expect(onStop).toHaveBeenCalledWith(outcome === 0)
})
it.each([false, true])('preserves native stop confirmation %s in backend cancellation', async confirmed => {
  const directory = await fixture(), executable = path.join(directory, 'python.exe')
  let enter!: () => void
  const entered = new Promise<void>(resolve => { enter = resolve })
  runner.run.mockResolvedValueOnce({ code: 0, stdout: JSON.stringify({ executable, version: [3, 13], missing: [] }), stderr: '' })
  runner.run.mockImplementationOnce((_command: string, _args: string[], options: { signal: AbortSignal; onStop?(value: boolean): void }) => {
    enter()
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => { options.onStop?.(confirmed); reject(options.signal.reason) }, { once: true }))
  })
  const backend = new NativePythonComputeBackend({ directory: path.join(directory, 'runtime'), candidates: [{ executable }] })
  const process = await backend.start({ directory, program: 'python3', argv: [], executionId: 'owned-stop', code: 'print(1)' })
  await entered
  expect(await process.cancel()).toBe(confirmed)
  expect(await process.done).toMatchObject({ exitCode: null, cancelled: confirmed })
  backend.dispose()
})
