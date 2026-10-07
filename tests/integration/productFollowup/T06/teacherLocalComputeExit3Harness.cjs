// Narrow real-Electron carrier for the existing Python nonzero-exit contract.
const { app } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')
const { createRequire } = require('node:module')
const config = JSON.parse(require('node:fs').readFileSync(process.argv[2], 'utf8'))
const requireProduct = createRequire(path.join(config.root, 'package.json'))
app.setPath('userData', config.profile)
app.disableHardwareAcceleration()
app.on('window-all-closed', () => {})
let backend
async function main() {
  await app.whenReady()
  const { PyodideComputeBackend } = requireProduct(path.join(config.root, 'dist-electron/main/workbench/compute/PyodideComputeBackend.js'))
  const { ComputeJobService } = requireProduct(path.join(config.root, 'dist-electron/main/workbench/compute/ComputeJobService.js'))
  backend = new PyodideComputeBackend({ preloadPath: path.join(config.root, 'dist-electron/preload/compute.js'),
    rendererFile: path.join(config.root, 'dist-renderer/compute.html'), runtimeDirectory: path.join(config.root, 'dist-renderer/vendor/compute-runtime') })
  const service = new ComputeJobService({ directory: path.join(config.directory, 'jobs'), backend })
  const input = { runId: 'teacher-exit3-run', jobId: 'teacher-exit3', language: 'python',
    code: "import sys\nprint('before normal Python exit 3')\nopen('result-before-exit.txt', 'w').write('failed work must not be delivered')\nsys.exit(3)\nprint('must not run after exit')\n",
    outputNames: ['result-before-exit.txt'] }
  await service.start(input)
  let final = await service.wait(input.runId, input.jobId, 30_000)
  if (final.status === 'preparing' || final.status === 'running') final = await service.wait(input.runId, input.jobId, 30_000)
  const facts = { final, logs: await service.logs(input.runId, input.jobId), readArtifact: undefined }
  try { await service.readArtifact(input.runId, input.jobId, 'result-before-exit.txt'); facts.readArtifact = { rejected: false } }
  catch (error) { facts.readArtifact = { rejected: true, code: error.code, message: String(error) } }
  await fs.writeFile(config.result, JSON.stringify(facts, null, 2))
}
main().then(() => { backend?.dispose(); app.quit() }, async error => {
  await fs.writeFile(config.result, JSON.stringify({ error: String(error), stack: error.stack }, null, 2)).catch(() => {})
  backend?.dispose(); app.exit(1)
})
