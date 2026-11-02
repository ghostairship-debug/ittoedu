import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn, spawnSync, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { goalSummary, mergeGoals, requireTaskEvidence, validateGoals } from './execution-goals.mjs'

// Development recovery only. This never owns product state or replays a command.
const script = fileURLToPath(import.meta.url)
const argv = process.argv.slice(2)
const rootFlag = argv.indexOf('--root')
const root = rootFlag < 0 ? path.resolve(path.dirname(script), '..') : path.resolve(argv.splice(rootFlag, 2)[1])
const stateFile = path.join(root, 'docs/development-plan/EXECUTION_CHECKPOINT.json')
const previousFile = path.join(root, 'output/execution-checkpoints/previous.json')
const lockFile = `${stateFile}.lock`
const states = new Set(['pending', 'in_progress', 'verified', 'blocked'])
const now = () => new Date().toISOString()
const relative = (file) => path.relative(root, file).replaceAll('\\', '/')
const alive = (pid) => { try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' } }
const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms))
const json = (file) => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`
  let fd
  try {
    fd = fs.openSync(temporary, 'wx')
    fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n')
    fs.fsyncSync(fd)
    fs.closeSync(fd); fd = undefined
    fs.renameSync(temporary, file)
    if (process.platform !== 'win32') {
      const dir = fs.openSync(path.dirname(file), 'r')
      try { fs.fsyncSync(dir) } finally { fs.closeSync(dir) }
    }
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
  }
}

function readState() {
  if (!fs.existsSync(stateFile)) throw new Error('Checkpoint missing; run init first.')
  const state = json(stateFile)
  if (state.schemaVersion !== 1 || !state.tasks || !state.runs) throw new Error('Unsupported checkpoint shape.')
  return state
}

async function update(change) {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true })
  const owner = { pid: process.pid, nonce: crypto.randomUUID(), createdAt: now() }
  const deadline = Date.now() + 10000
  while (true) {
    try { fs.writeFileSync(lockFile, JSON.stringify(owner), { flag: 'wx' }); break }
    catch (e) {
      if (e.code !== 'EEXIST') throw e
      try {
        const previous = json(lockFile)
        if (!alive(previous.pid)) {
          const abandoned = `${lockFile}.abandoned-${crypto.randomUUID()}`
          fs.renameSync(lockFile, abandoned)
          fs.unlinkSync(abandoned)
          continue
        }
      } catch (lockError) {
        if (lockError.code === 'ENOENT') continue
        // A partially written live lock is never removed based on its age.
      }
      if (Date.now() >= deadline) throw new Error(`Checkpoint lock busy: ${lockFile}`)
      await pause(40)
    }
  }
  try {
    const state = fs.existsSync(stateFile) ? readState() : null
    // Writers mutate their input; keep the prior snapshot intact for recovery.
    const next = change(state ? structuredClone(state) : null)
    next.lastSavedAt = now()
    if (json(lockFile).nonce !== owner.nonce) throw new Error('Checkpoint writer lost its lock.')
    if (state) atomicJson(previousFile, state)
    atomicJson(stateFile, next)
    return next
  } finally {
    try { if (json(lockFile).nonce === owner.nonce) fs.unlinkSync(lockFile) } catch { /* preserve another writer */ }
  }
}

function workspace() {
  try {
    return {
      checkedAt: now(),
      head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(),
      status: execFileSync('git', ['-c', 'core.quotepath=false', 'status', '--porcelain=v1', '-z'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024 }).split('\0').filter(Boolean),
    }
  } catch (error) { return { checkedAt: now(), unavailable: String(error.message).slice(0, 500) } }
}

function task(state, id) {
  state.tasks[id] ??= { id, status: 'pending', modifiedFiles: [], changes: [], tests: [], blockers: [], nextAction: '' }
  return state.tasks[id]
}

function summary(state) {
  return {
    batchId: state.batchId, lastSavedAt: state.lastSavedAt,
    tasks: Object.values(state.tasks).map(({ id, status, nextAction, blockers }) => ({ id, status, nextAction, blockers })),
    processes: Object.values(state.runs).filter(r => ['starting', 'running', 'orphaned'].includes(r.status)),
    lastSuccessfulOperation: state.lastSuccessfulOperation,
    checkpoint: relative(stateFile),
    ...goalSummary(state),
  }
}

async function supervise(specFile) {
  const spec = json(specFile)
  const logFile = path.resolve(root, spec.log)
  const statusFile = path.resolve(root, spec.statusFile)
  const log = fs.openSync(logFile, 'a')
  let child, terminal = false, timedOut = false, heartbeat, timeout
  const finish = async (exitCode, signal, error) => {
    if (terminal) return
    terminal = true; clearInterval(heartbeat); clearTimeout(timeout)
    const result = { jobId: spec.jobId, taskId: spec.taskId, label: spec.label, status: timedOut ? 'timed_out' : error ? 'failed' : exitCode === 0 ? 'passed' : 'failed', exitCode, signal, error: error ? String(error.message ?? error) : undefined, finishedAt: now(), log: spec.log }
    atomicJson(statusFile, result)
    await update(state => {
      const run = state.runs[spec.jobId]
      Object.assign(run, result, { lastHeartbeatAt: now() })
      const item = task(state, spec.taskId)
      item.tests = [...item.tests.filter(t => t.jobId !== spec.jobId), result]
      item.updatedAt = now()
      item.nextAction = result.status === 'passed' ? (spec.nextAction ?? 'Review command evidence, then verify the task or continue its next unit.') : `Inspect ${spec.log}; reconcile effects before a retry.`
      if (result.status !== 'passed') item.status = 'blocked'
      if (result.status === 'passed') state.lastSuccessfulOperation = result
      state.workspace = workspace()
      return state
    })
    fs.closeSync(log)
  }
  try {
    child = spawn(spec.command[0], spec.command.slice(1), { cwd: path.resolve(root, spec.cwd ?? '.'), stdio: ['ignore', log, log], windowsHide: true, detached: process.platform !== 'win32', shell: false })
    child.once('error', error => { void finish(null, null, error).catch(e => { fs.writeSync(log, `\nSupervisor: ${e.stack}\n`); process.exitCode = 1 }) })
    child.once('exit', (code, signal) => { void finish(code, signal).catch(e => { fs.writeSync(log, `\nSupervisor: ${e.stack}\n`); process.exitCode = 1 }) })
    await update(state => {
      if (!terminal) Object.assign(state.runs[spec.jobId], { supervisorPid: process.pid, childPid: child.pid, status: 'running', startedAt: now(), lastHeartbeatAt: now() })
      return state
    })
    heartbeat = setInterval(() => {
      void update(state => { if (!terminal) state.runs[spec.jobId].lastHeartbeatAt = now(); return state }).catch(e => fs.writeSync(log, `\nCheckpoint heartbeat: ${e.message}\n`))
    }, 10000)
    timeout = setTimeout(() => {
      timedOut = true
      fs.writeSync(log, `\nCommand exceeded ${spec.timeoutMs} ms; stopping its recorded process tree.\n`)
      if (!child.pid) return
      if (process.platform === 'win32') spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      else { try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') } }
    }, spec.timeoutMs)
    // A very fast child may finish while the initial state lock is being acquired.
    if (terminal) { clearInterval(heartbeat); clearTimeout(timeout) }
  } catch (error) { await finish(null, null, error) }
}

async function run(inputFile) {
  const input = json(path.resolve(root, inputFile))
  if (!input.taskId || !Array.isArray(input.command) || !input.command.length || !input.command.every(v => typeof v === 'string')) throw new Error('Run spec needs taskId and an executable/argument array.')
  if (!Number.isFinite(input.timeoutMs) || input.timeoutMs < 100 || input.timeoutMs > 3600000) throw new Error('Specify a timeoutMs from 100 to 3600000.')
  const jobId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
  const folder = path.join(root, 'output/execution-checkpoints', jobId)
  fs.mkdirSync(folder, { recursive: true })
  const spec = { ...input, jobId, label: input.label ?? input.taskId, log: relative(path.join(folder, 'command.log')), statusFile: relative(path.join(folder, 'result.json')) }
  const specFile = path.join(folder, 'spec.json')
  atomicJson(specFile, spec)
  await update(state => {
    const item = task(state, spec.taskId)
    if (Object.values(state.runs).some(r => r.taskId === spec.taskId && ['starting', 'running', 'orphaned'].includes(r.status))) throw new Error(`Task ${spec.taskId} already has an unresolved process; reconcile it first.`)
    item.status = 'in_progress'; item.updatedAt = now()
    item.nextAction = `Observe ${spec.statusFile}; do not replay this command before resolving its outcome.`
    state.runs[jobId] = { jobId, taskId: spec.taskId, label: spec.label, status: 'starting', requestedAt: now(), specFile: relative(specFile), log: spec.log, statusFile: spec.statusFile }
    return state
  })
  const fd = fs.openSync(path.join(folder, 'supervisor.log'), 'a')
  const worker = spawn(process.execPath, [script, '--root', root, '_supervise', specFile], { cwd: root, detached: true, windowsHide: true, stdio: ['ignore', fd, fd] })
  try {
    await new Promise((resolve, reject) => { worker.once('spawn', resolve); worker.once('error', reject) })
    await update(state => { state.runs[jobId].supervisorPid = worker.pid; return state })
    worker.unref()
  } finally { fs.closeSync(fd) }
  console.log(JSON.stringify({ jobId, supervisorPid: worker.pid, statusFile: spec.statusFile, log: spec.log }))
}

function resolutionPath(run) {
  return path.join(path.dirname(path.resolve(root, run.statusFile)), 'resolution.json')
}

function requireStopped(run) {
  if ((run.supervisorPid && alive(run.supervisorPid)) || (run.childPid && alive(run.childPid))) {
    throw new Error('Cannot resolve a run while its recorded supervisor or child is alive.')
  }
}

function applyResolution(state, run, resolution) {
  if (resolution.jobId !== run.jobId || resolution.taskId !== run.taskId || resolution.commandOutcome !== 'unknown') {
    throw new Error('Resolution identity or outcome mismatch.')
  }
  requireStopped(run)
  // Keep original exit/error fields and tests. Human acknowledgement is not a command result.
  Object.assign(run, { status: 'resolved', resolution, resolutionFile: relative(resolutionPath(run)) })
  const item = task(state, run.taskId)
  item.status = 'blocked'; item.updatedAt = now()
  item.nextAction = `Review ${run.resolutionFile} and its evidence; command outcome remains unknown. Explicitly choose the next action; nothing was replayed.`
}

async function resolveRun(inputFile) {
  const input = json(path.resolve(root, inputFile))
  if (typeof input.jobId !== 'string' || !input.jobId.trim() || typeof input.note !== 'string' || !input.note.trim()
    || !Array.isArray(input.evidence) || !input.evidence.length || !input.evidence.every(value => typeof value === 'string' && value.trim())) {
    throw new Error('Run resolution requires jobId, a nonempty note and evidence references.')
  }
  return update(state => {
    const run = state.runs[input.jobId]
    if (!run || !['starting', 'running', 'orphaned'].includes(run.status)) throw new Error('Only an unresolved run can be explicitly resolved.')
    requireStopped(run)
    if (fs.existsSync(path.resolve(root, run.statusFile))) throw new Error('A command result exists; reconcile it instead of resolving an unknown outcome.')
    const resolution = {
      jobId: run.jobId, taskId: run.taskId, commandOutcome: 'unknown', resolvedAt: now(),
      note: input.note.trim(), evidence: input.evidence,
      originalStatus: run.status, originalExitCode: run.exitCode ?? null, originalSignal: run.signal ?? null,
      supervisorPid: run.supervisorPid ?? null, childPid: run.childPid ?? null,
    }
    // Independent receipt survives a failed checkpoint write; never overwrite result.json.
    atomicJson(resolutionPath(run), resolution)
    applyResolution(state, run, resolution)
    state.workspace = workspace()
    return state
  })
}

async function reconcile() {
  return update(state => {
    for (const run of Object.values(state.runs)) {
      if (!['starting', 'running', 'orphaned'].includes(run.status)) continue
      const resultPath = path.resolve(root, run.statusFile)
      if (fs.existsSync(resultPath)) {
        const result = json(resultPath)
        if (result.jobId !== run.jobId) throw new Error('Result identity mismatch.')
        Object.assign(run, result)
        const item = task(state, run.taskId)
        item.tests = [...item.tests.filter(t => t.jobId !== run.jobId), result]
        item.nextAction = `Review recovered result ${run.statusFile}; verify effects before continuing.`
        if (result.status !== 'passed') item.status = 'blocked'
      } else if (fs.existsSync(resolutionPath(run))) {
        applyResolution(state, run, json(resolutionPath(run)))
      } else if (!run.supervisorPid || !alive(run.supervisorPid)) {
        // A surviving child is not evidence that the parent is still progressing.
        run.status = 'orphaned'; run.childAlive = !!run.childPid && alive(run.childPid)
        const item = task(state, run.taskId)
        item.status = 'blocked'
        item.nextAction = `Inspect recorded process ${run.childPid ?? 'unknown'} and ${run.log}; outcome unknown, never auto-replay.`
      }
    }
    state.workspace = workspace()
    return state
  })
}

const [command, input] = argv
try {
  if (command === 'init') {
    const state = await update(existing => existing ?? { schemaVersion: 1, batchId: input ?? 'development', createdAt: now(), tasks: {}, runs: {}, lastSuccessfulOperation: null, workspace: workspace() })
    console.log(JSON.stringify(summary(state)))
  } else if (command === 'task') {
    const patch = json(path.resolve(root, input))
    if (!patch.id || !states.has(patch.status)) throw new Error('Task patch needs id and pending/in_progress/verified/blocked status.')
    if (patch.status === 'verified') requireTaskEvidence(root, patch.evidence)
    const state = await update(state => {
      if (patch.status === 'verified' && Object.values(state.runs).some(r => r.taskId === patch.id && ['starting', 'running', 'orphaned'].includes(r.status))) throw new Error('Cannot verify with an unresolved process.')
      if (state.goals && !patch.supportOnly && !(patch.goalRefs ?? state.tasks[patch.id]?.goalRefs)?.length) throw new Error('New task updates must preserve linked goals, or explicitly declare supportOnly.')
      Object.assign(task(state, patch.id), patch, { updatedAt: now() })
      if (state.goals) validateGoals(state, root, { evidence: false })
      state.workspace = workspace()
      if (patch.status === 'verified') state.lastSuccessfulOperation = { taskId: patch.id, status: 'verified', at: now(), evidence: patch.evidence }
      return state
    })
    console.log(JSON.stringify({ task: state.tasks[patch.id], lastSavedAt: state.lastSavedAt }))
  } else if (command === 'goals') {
    const state = await update(state => mergeGoals(state, json(path.resolve(root, input)), root))
    console.log(JSON.stringify(goalSummary(state)))
  } else if (command === 'goal-audit') {
    console.log(JSON.stringify(validateGoals(readState(), root)))
  } else if (command === 'closeout') {
    if (!['stage', 'product'].includes(input)) throw new Error('closeout needs stage or product')
    const state = await update(state => {
      if (Object.values(state.runs).some(r => ['starting', 'running', 'orphaned'].includes(r.status))) throw new Error('Cannot close a stage with an unresolved process.')
      if (!state.goals) throw new Error('Seed confirmed goals before closeout.')
      const checked = validateGoals(state, root)
      if (input === 'product' && !checked.productComplete) throw new Error('Product goals remain incomplete: ' + checked.incompleteGoalIds.join(', '))
      state.lastCloseout = { at: now(), mode: input, incompleteGoalIds: checked.incompleteGoalIds }
      state.workspace = workspace()
      return state
    })
    console.log(JSON.stringify({ closeout: state.lastCloseout, ...goalSummary(state) }))
  } else if (command === 'run') await run(input)
  else if (command === '_supervise') await supervise(input)
  else if (command === 'resolve-run') console.log(JSON.stringify(summary(await resolveRun(input))))
  else if (command === 'reconcile') console.log(JSON.stringify(summary(await reconcile())))
  else if (command === 'status') console.log(JSON.stringify(summary(readState())))
  else if (command === 'restore-previous') {
    // Explicit repair only; do not hide damage or automatically retry work.
    try { readState(); throw new Error('Primary checkpoint is valid; no restoration needed.') }
    catch (error) { if (error.message.includes('no restoration')) throw error }
    const backup = json(previousFile)
    const damaged = `${stateFile}.damaged-${Date.now()}`
    if (fs.existsSync(stateFile)) fs.renameSync(stateFile, damaged)
    await update(() => ({ ...backup, recovery: { at: now(), source: relative(previousFile), damaged: relative(damaged), instruction: 'Run reconcile and inspect Git/logs; no command has been replayed.' } }))
    console.log(JSON.stringify(summary(await reconcile())))
  } else {
    throw new Error('Usage: node scripts/execution-checkpoint.mjs [--root dir] init <batch> | task <patch.json> | run <spec.json> | resolve-run <resolution.json> | goals <patch.json> | goal-audit | closeout stage|product | status | reconcile | restore-previous')
  }
} catch (error) { console.error(error.stack ?? error); process.exitCode = 1 }

