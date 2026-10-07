// Test-only Electron Main carrier. All execution, sandboxing, persistence and artifact delivery use compiled product owners.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')
const { createRequire } = require('node:module')
const config = JSON.parse(require('node:fs').readFileSync(process.argv[2], 'utf8'))
const requireProduct = createRequire(path.join(config.root, 'package.json'))
const load = name => requireProduct(path.join(config.root, 'dist-electron/main/workbench', name))
app.setPath('userData', config.profile)
app.disableHardwareAcceleration()
app.on('window-all-closed', () => {})
const observations = [], networkProbes = []
app.on('web-contents-created', (_event, contents) => {
  const observation = { id: contents.id, loaded: false, destroyed: false }
  observations.push(observation)
  contents.once('destroyed', () => { observation.destroyed = true })
  contents.once('did-finish-load', () => {
    observation.loaded = true; observation.url = contents.getURL()
    const p = contents.getLastWebPreferences()
    observation.preferences = { sandbox: p.sandbox, contextIsolation: p.contextIsolation, nodeIntegration: p.nodeIntegration,
      nodeIntegrationInWorker: p.nodeIntegrationInWorker ?? null, nodeIntegrationInSubFrames: p.nodeIntegrationInSubFrames }
    if (config.networkURL) networkProbes.push(contents.executeJavaScript(`(async () => {
      try { const response = await fetch(${JSON.stringify(config.networkURL)}); return { rejected: false, status: response.status } }
      catch (error) { return { rejected: true, message: String(error) } }
    })()`).then(result => { observation.rendererNetwork = result }, error => { observation.rendererNetwork = { targetLost: String(error) } }))
  })
})
async function checkpoint(phase, facts = {}) {
  await fs.appendFile(config.checkpoint, JSON.stringify({ phase, facts, pid: process.pid, time: new Date().toISOString() }) + '\n')
}
async function storedJob(directory, jobId) {
  for (const name of await fs.readdir(directory)) {
    try {
      const filename = path.join(directory, name, 'state.json'), value = JSON.parse(await fs.readFile(filename, 'utf8'))
      if (value.jobId === jobId) return { folder: path.dirname(filename), relative: name, value }
    } catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error }
  }
  throw new Error('Actual durable compute checkpoint missing')
}
async function waitUntil(read, description, milliseconds = 10_000) {
  const deadline = Date.now() + milliseconds
  while (!await read()) {
    if (Date.now() >= deadline) throw new Error(description)
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}
let backend
async function main() {
  await app.whenReady(); await checkpoint('app.ready')
  const { PyodideComputeBackend } = load('compute/PyodideComputeBackend.js')
  const { ComputeJobService } = load('compute/ComputeJobService.js')
  backend = new PyodideComputeBackend({ preloadPath: path.join(config.root, 'dist-electron/preload/compute.js'),
    rendererFile: path.join(config.root, 'dist-renderer/compute.html'), runtimeDirectory: path.join(config.root, 'dist-renderer/vendor/compute-runtime') })
  let starts = 0
  const outcomes = [], processes = [], start = backend.start.bind(backend)
  // Observe the real process; no backend response, cancellation, Python result or worker is mocked.
  backend.start = async input => {
    starts++; await checkpoint('backend.start', { executionId: input.executionId })
    const process = await start(input)
    processes.push(process.done.then(result => {
      outcomes.push({ exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr, truncated: result.truncated, cancelled: result.cancelled,
        outputs: result.outputs?.map(output => ({ name: output.name, byteLength: output.bytes.byteLength })) })
      return result
    }))
    return process
  }
  const service = new ComputeJobService({ directory: config.jobs, backend })
  const input = { ...config.input, inputs: config.input.inputs.map(file => ({ name: file.name, bytes: new TextEncoder().encode(file.text) })) }
  const facts = { phase: config.phase, starts: 0, observations, outcomes, jobs: config.jobs }
  if (config.phase === 'compute') {
    const availability = await backend.availability(); facts.availability = availability
    if (!availability.available) throw new Error(availability.reason)
    await checkpoint('job.start.before')
    await service.start(input)
    let final = await service.wait(input.runId, input.jobId, 30_000)
    for (let waits = 1; waits < 3 && (final.status === 'preparing' || final.status === 'running'); waits++) {
      await checkpoint('job.still-pending', { status: final.status, completedWaits: waits })
      final = await service.wait(input.runId, input.jobId, 30_000)
    }
    facts.final = final; await checkpoint('job.settled', final)
    facts.logs = await service.logs(input.runId, input.jobId, 0, 100)
    if (final.status !== 'ready') throw new Error(`Actual Python did not finish ready: ${JSON.stringify({ final, logs: facts.logs })}`)
    const stored = await storedJob(config.jobs, input.jobId)
    facts.jobFolder = stored.folder
    facts.inputAfter = await fs.readFile(path.join(stored.folder, 'input', '班级分数.csv'), 'utf8')
    facts.probe = JSON.parse(Buffer.from((await service.readArtifact(input.runId, input.jobId, 'probe.json')).bytes).toString('utf8'))
    facts.summary = Buffer.from((await service.readArtifact(input.runId, input.jobId, 'summary.csv')).bytes).toString('utf8')
    const chart = await service.readArtifact(input.runId, input.jobId, 'charts/班级均分.png')
    const { DocumentHostService } = load('DocumentHostService.js')
    const host = new DocumentHostService(path.join(config.directory, 'delivery-owner'))
    await fs.mkdir(config.delivery, { recursive: true })
    facts.deliveries = []
    for (const [name, sourceName] of [['summary.csv', 'summary.csv'], ['班级均分.png', 'charts/班级均分.png']]) {
      const artifact = await service.readArtifact(input.runId, input.jobId, sourceName)
      facts.deliveries.push(await host.artifactDeliveries.deliver({ runId: input.runId, operationId: `teacher-delivery-${name}`,
        workspaceRoot: config.delivery, permission: 'workspace', destination: name, sourceKind: 'compute',
        sourceId: `${input.jobId}@${sourceName}`, bytes: artifact.bytes, assertActive() {} }))
    }
    facts.chartPath = path.join(config.delivery, '班级均分.png'); facts.chartByteLength = chart.bytes.byteLength
    try { await service.start({ ...input, jobId: 'unsafe-output-name', outputNames: ['../escape.csv'] }); facts.unsafeOutputRejected = false }
    catch (error) { facts.unsafeOutputRejected = true; facts.unsafeOutputReason = String(error) }
  } else if (config.phase === 'ready-reopen') {
    facts.final = await service.start(input)
    facts.summary = Buffer.from((await service.readArtifact(input.runId, input.jobId, 'summary.csv')).bytes).toString('utf8')
  } else if (config.phase === 'stop') {
    await service.start(input)
    await waitUntil(() => observations.some(item => item.loaded), 'Real compute renderer never reached startup')
    await networkProbes[0]
    const stored = await storedJob(config.jobs, input.jobId)
    facts.pending = structuredClone(stored.value)
    await fs.mkdir(config.coldJobs, { recursive: true })
    await fs.cp(stored.folder, path.join(config.coldJobs, stored.relative), { recursive: true })
    const executionId = stored.value.executionId
    facts.beforeStop = await backend.inspectExecution(executionId)
    const began = Date.now()
    facts.cancelled = await service.cancel(input.runId, input.jobId)
    await Promise.all(processes)
    facts.cancelElapsed = Date.now() - began
    await checkpoint('stop.process-settled', { cancelled: facts.cancelled, outcomes })
    await new Promise(resolve => setTimeout(resolve, 100))
    facts.afterStop = await backend.inspectExecution(executionId)
    facts.final = await service.status(input.runId, input.jobId)
    facts.outputNamesAfterStop = await fs.readdir(path.join(stored.folder, 'output'))
    facts.liveWindowsAfterStop = BrowserWindow.getAllWindows().length
  } else if (config.phase === 'pending-reopen') {
    facts.final = await service.status(input.runId, input.jobId)
    facts.sameRequest = await service.start(input)
    facts.liveWindows = BrowserWindow.getAllWindows().length
  } else throw new Error('Unknown narrow test phase')
  await Promise.all(networkProbes)
  facts.starts = starts
  await fs.writeFile(config.result, JSON.stringify(facts, null, 2))
  await checkpoint('complete', { phase: config.phase, starts })
}
main().then(async () => { backend?.dispose(); app.quit() }, async error => {
  await fs.writeFile(config.result, JSON.stringify({ error: String(error), stack: error.stack, observations }, null, 2)).catch(() => {})
  await checkpoint('failure', { error: String(error), stack: error.stack }).catch(() => {})
  backend?.dispose(); app.exit(1)
})
