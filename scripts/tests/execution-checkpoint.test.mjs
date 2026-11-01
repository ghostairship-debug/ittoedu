import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('../execution-checkpoint.mjs', import.meta.url))
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guoling-checkpoint-'))
  const file = path.join(root, 'docs/development-plan/EXECUTION_CHECKPOINT.json')
  const invoke = (...args) => {
    const result = spawnSync(process.execPath, [script, '--root', root, ...args], { encoding: 'utf8', timeout: 15000, windowsHide: true })
    assert.ifError(result.error)
    assert.equal(result.status, 0, result.stderr || result.error?.message)
    return JSON.parse(result.stdout.trim())
  }
  const write = (name, value) => { const file = path.join(root, name); fs.writeFileSync(file, JSON.stringify(value)); return name }
  invoke('init', 'recovery-smoke')
  return { root, file, invoke, write, state: () => JSON.parse(fs.readFileSync(file, 'utf8')) }
}
async function awaitRun(f, jobId) {
  const deadline = Date.now() + 18000
  while (Date.now() < deadline) {
    const run = f.state().runs[jobId]
    if (['passed', 'failed', 'timed_out'].includes(run?.status)) return run
    await pause(80)
  }
  throw new Error(`Timed out reading persisted result: ${f.file}`)
}

test('detached command finishes after launch client exits; recovery never replays it', async () => {
  const f = fixture()
  const spec = f.write('run.json', { taskId: 'success', command: [process.execPath, '-e', "setTimeout(()=>{require('fs').appendFileSync('effects.txt','once\\n');console.log('finished')},350)"], timeoutMs: 10000 })
  const launch = f.invoke('run', spec)
  // invoke has exited. Only its detached supervisor and child remain.
  const run = await awaitRun(f, launch.jobId)
  assert.equal(run.status, 'passed')
  assert.equal(run.exitCode, 0)
  assert.match(fs.readFileSync(path.join(f.root, run.log), 'utf8'), /finished/)
  assert.equal(f.state().tasks.success.status, 'in_progress', 'command success is not semantic acceptance')
  f.invoke('reconcile'); f.invoke('reconcile')
  assert.equal(fs.readFileSync(path.join(f.root, 'effects.txt'), 'utf8'), 'once\n')
  f.invoke('task', f.write('done.json', { id: 'success', status: 'verified', evidence: [run.statusFile] }))
  assert.equal(f.state().tasks.success.status, 'verified')
})

test('nonzero exit and bounded timeout are persisted as failures', async () => {
  const f = fixture()
  const failure = f.invoke('run', f.write('fail.json', { taskId: 'failure', command: [process.execPath, '-e', "console.error('expected failure');process.exit(7)"], timeoutMs: 10000 }))
  assert.equal((await awaitRun(f, failure.jobId)).exitCode, 7)
  assert.equal(f.state().tasks.failure.status, 'blocked')
  const timeout = f.invoke('run', f.write('timeout.json', { taskId: 'timeout', command: [process.execPath, '-e', 'setInterval(()=>{},1000)'], timeoutMs: 400 }))
  assert.equal((await awaitRun(f, timeout.jobId)).status, 'timed_out')
})

test('parallel writers keep both task updates and all checkpoints parse', async () => {
  const f = fixture()
  const patches = ['a', 'b', 'c', 'd'].map(id => f.write(`${id}.json`, { id, status: 'pending', nextAction: `Do ${id}` }))
  await Promise.all(patches.map(patch => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, '--root', f.root, 'task', patch], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''; child.stderr.on('data', b => stderr += b)
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(stderr)))
  })))
  assert.deepEqual(Object.keys(f.state().tasks).sort(), ['a', 'b', 'c', 'd'])
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(path.join(f.root, 'output/execution-checkpoints/previous.json'), 'utf8')))
})

test('lost supervisor is blocked with unknown outcome and cannot be blindly rerun', () => {
  const f = fixture()
  const state = f.state()
  state.tasks.orphan = { id: 'orphan', status: 'in_progress', tests: [], blockers: [] }
  state.runs.lost = { jobId: 'lost', taskId: 'orphan', status: 'running', statusFile: 'missing-result.json', log: 'old.log' }
  fs.writeFileSync(f.file, JSON.stringify(state))
  f.invoke('reconcile')
  assert.equal(f.state().runs.lost.status, 'orphaned')
  assert.match(f.state().tasks.orphan.nextAction, /never auto-replay/)
  const spec = f.write('retry.json', { taskId: 'orphan', command: [process.execPath, '-e', 'process.exit(0)'], timeoutMs: 1000 })
  const replay = spawnSync(process.execPath, [script, '--root', f.root, 'run', spec], { encoding: 'utf8', windowsHide: true })
  assert.notEqual(replay.status, 0)
  assert.match(replay.stderr, /unresolved process/)
})

test('explicit resolution survives checkpoint recovery without replay or claiming success', async () => {
  const f = fixture()
  const state = f.state()
  state.tasks.orphan = { id: 'orphan', status: 'blocked', tests: [], blockers: [] }
  state.runs.lost = { jobId: 'lost', taskId: 'orphan', status: 'orphaned', exitCode: null, statusFile: 'output/execution-checkpoints/lost/result.json', log: 'old.log' }
  fs.writeFileSync(f.file, JSON.stringify(state))
  const evidence = f.write('inspection.json', { processesStopped: true, effectsReviewed: true })
  f.invoke('resolve-run', f.write('resolution-input.json', { jobId: 'lost', note: 'Inspected logs, files and stopped processes; original exit remains unknown.', evidence: [evidence] }))
  let resolved = f.state()
  assert.equal(resolved.runs.lost.status, 'resolved')
  assert.equal(resolved.runs.lost.exitCode, null)
  assert.equal(resolved.runs.lost.resolution.commandOutcome, 'unknown')
  assert.equal(resolved.runs.lost.resolution.originalStatus, 'orphaned')
  assert.deepEqual(resolved.runs.lost.resolution.evidence, [evidence])
  assert.equal(resolved.tasks.orphan.status, 'blocked')
  assert.deepEqual(resolved.tasks.orphan.tests, [])
  assert.equal(resolved.lastSuccessfulOperation, null)
  assert.equal(fs.existsSync(path.join(f.root, state.runs.lost.statusFile)), false, 'manual resolution must not fabricate a command result')
  // Model a lost checkpoint write after the independent resolution receipt was saved.
  fs.writeFileSync(f.file, JSON.stringify(state))
  f.invoke('reconcile'); f.invoke('reconcile')
  resolved = f.state()
  assert.equal(resolved.runs.lost.status, 'resolved')
  assert.equal(resolved.tasks.orphan.status, 'blocked')
  assert.equal(resolved.lastSuccessfulOperation, null)
  assert.equal(fs.existsSync(path.join(f.root, 'effects.txt')), false)
  const retry = f.invoke('run', f.write('explicit-retry.json', { taskId: 'orphan', command: [process.execPath, '-e', "require('fs').appendFileSync('effects.txt','explicit\\n')"], timeoutMs: 10000 }))
  assert.equal((await awaitRun(f, retry.jobId)).status, 'passed')
  assert.equal(fs.readFileSync(path.join(f.root, 'effects.txt'), 'utf8'), 'explicit\n')
  assert.equal(f.state().tasks.orphan.status, 'in_progress', 'explicit retry success still requires task acceptance')
})

test('resolution requires evidence and refuses a live supervisor or child', () => {
  const f = fixture()
  const state = f.state()
  state.tasks.active = { id: 'active', status: 'blocked', tests: [], blockers: [] }
  state.runs.active = { jobId: 'active', taskId: 'active', status: 'orphaned', statusFile: 'output/execution-checkpoints/active/result.json', log: 'active.log' }
  fs.writeFileSync(f.file, JSON.stringify(state))
  const invokeRejected = (input, pattern) => {
    const result = spawnSync(process.execPath, [script, '--root', f.root, 'resolve-run', f.write('resolve.json', input)], { encoding: 'utf8', timeout: 15000, windowsHide: true })
    assert.ifError(result.error)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, pattern)
    assert.equal(f.state().runs.active.status, 'orphaned')
    assert.equal(fs.existsSync(path.join(f.root, 'output/execution-checkpoints/active/resolution.json')), false)
  }
  invokeRejected({ jobId: 'active', note: 'Reviewed', evidence: [] }, /requires jobId/)
  invokeRejected({ jobId: 'active', note: ' ', evidence: ['inspection.json'] }, /requires jobId/)
  for (const field of ['supervisorPid', 'childPid']) {
    state.runs.active[field] = process.pid
    fs.writeFileSync(f.file, JSON.stringify(state))
    invokeRejected({ jobId: 'active', note: 'Reviewed', evidence: ['inspection.json'] }, /supervisor or child is alive/)
    delete state.runs.active[field]
  }
})

test('existing terminal command evidence is reconciled and never replaced by manual resolution', () => {
  const f = fixture()
  const state = f.state()
  state.tasks.known = { id: 'known', status: 'in_progress', tests: [], blockers: [] }
  state.runs.known = { jobId: 'known', taskId: 'known', status: 'orphaned', statusFile: 'known-result.json', log: 'known.log' }
  fs.writeFileSync(f.file, JSON.stringify(state))
  f.write('known-result.json', { jobId: 'known', taskId: 'known', status: 'failed', exitCode: 7, log: 'known.log' })
  const before = fs.readFileSync(path.join(f.root, 'known-result.json'), 'utf8')
  const input = f.write('known-resolution.json', { jobId: 'known', note: 'Reviewed', evidence: ['known.log'] })
  const rejected = spawnSync(process.execPath, [script, '--root', f.root, 'resolve-run', input], { encoding: 'utf8', timeout: 15000, windowsHide: true })
  assert.ifError(rejected.error)
  assert.notEqual(rejected.status, 0)
  assert.match(rejected.stderr, /command result exists/)
  assert.equal(fs.readFileSync(path.join(f.root, 'known-result.json'), 'utf8'), before)
  f.invoke('reconcile')
  assert.equal(f.state().runs.known.status, 'failed')
  assert.equal(f.state().runs.known.exitCode, 7)
})

test('explicit backup restoration recovers the previous state and retains the damaged copy', () => {
  const f = fixture()
  f.invoke('task', f.write('one.json', { id: 'retained', status: 'pending' }))
  const previous = f.state()
  f.invoke('task', f.write('two.json', { id: 'retained', status: 'blocked', nextAction: 'Inspect the latest failure.' }))
  assert.equal(f.state().tasks.retained.status, 'blocked')
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.root, 'output/execution-checkpoints/previous.json'), 'utf8')), previous)
  fs.writeFileSync(f.file, '{broken')
  f.invoke('restore-previous')
  const restored = f.state()
  assert.deepEqual(restored.tasks, previous.tasks)
  assert.deepEqual(restored.runs, previous.runs)
  assert.equal(restored.recovery.source, 'output/execution-checkpoints/previous.json')
  assert.equal(fs.readFileSync(path.join(f.root, restored.recovery.damaged), 'utf8'), '{broken')
})

