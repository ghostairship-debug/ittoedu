// @vitest-environment node
import { promises as fs } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { PodmanComputeBackend } from '../../src/main/workbench/compute/PodmanComputeBackend'
import { ComputeJobService } from '../../src/main/workbench/compute/ComputeJobService'

const image = process.env.G20_TEST_PODMAN_IMAGE
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })))
}, 30_000)
async function job() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guoling-podman-'))
  roots.push(root)
  for (const name of ['input', 'work', 'output']) await fs.mkdir(path.join(root, name))
  return root
}
const backend = () => new PodmanComputeBackend({ distro: 'Ubuntu', image: image! })
const containerName = () => `guoling-compute-${randomUUID().replaceAll('-', '')}`

it.skipIf(!image)('runs a fresh Python program with real file, network and child process boundaries', async () => {
  const root = await job(), sentinel = path.join(root, 'outside.txt')
  const linuxSentinel = execFileSync('wsl.exe', ['-d', 'Ubuntu', '--exec', 'wslpath', '-a', sentinel], { encoding: 'utf8' }).trim()
  await fs.writeFile(sentinel, 'untouched')
  await fs.writeFile(path.join(root, 'input', 'grades.csv'), 'score\n20\n22\n')
  await fs.writeFile(path.join(root, 'input', 'program.py'), `
from pathlib import Path
import json, socket, subprocess
rows = Path('/job/input/grades.csv').read_text().splitlines()[1:]
result = {'sum': sum(map(int, rows)), 'child': subprocess.check_output(['python3', '-c', 'print(6*7)'], text=True).strip()}
try: Path('/job/input/grades.csv').write_text('tampered'); result['input_writable'] = True
except OSError: result['input_writable'] = False
try: Path(${JSON.stringify(linuxSentinel)}).read_text(); result['outside_visible'] = True
except OSError: result['outside_visible'] = False
try: socket.create_connection(('1.1.1.1', 80), 1); result['network_open'] = True
except OSError: result['network_open'] = False
Path('/job/output/summary.json').write_text(json.dumps(result))
print('completed')
`)
  expect(await backend().availability()).toEqual({ available: true })
  const process = await backend().start({ directory: root, program: 'python3', argv: ['/job/input/program.py'], timeoutMs: 10_000, containerName: containerName() })
  expect(await process.done).toMatchObject({ exitCode: 0, cancelled: false, timedOut: false, stdout: expect.stringContaining('completed') })
  expect(JSON.parse(await fs.readFile(path.join(root, 'output', 'summary.json'), 'utf8')))
    .toEqual({ sum: 42, child: '42', input_writable: false, outside_visible: false, network_open: false })
  expect(await fs.readFile(path.join(root, 'input', 'grades.csv'), 'utf8')).toBe('score\n20\n22\n')
  expect(await fs.readFile(sentinel, 'utf8')).toBe('untouched')
}, 30_000)

it.skipIf(!image)('stops a spawned descendant before it can produce a late output', async () => {
  const root = await job()
  await fs.writeFile(path.join(root, 'input', 'program.py'), `
from pathlib import Path
import subprocess, time
subprocess.Popen(['python3', '-c', "import time; from pathlib import Path; time.sleep(3); Path('/job/output/late.txt').write_text('bad')"])
Path('/job/output/started.txt').write_text('yes')
time.sleep(30)
`)
  const process = await backend().start({ directory: root, program: 'python3', argv: ['/job/input/program.py'], timeoutMs: 15_000, containerName: containerName() })
  let reached = false
  for (let n = 0; n < 100; n++) {
    try { await fs.access(path.join(root, 'output', 'started.txt')); reached = true; break } catch { await new Promise(resolve => setTimeout(resolve, 50)) }
  }
  expect(reached).toBe(true)
  expect(await process.cancel()).toBe(true)
  expect((await process.done).cancelled).toBe(true)
  await new Promise(resolve => setTimeout(resolve, 3200))
  await expect(fs.access(path.join(root, 'output', 'late.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
}, 30_000)

it.skipIf(!image)('persists an async compute receipt, waits, reopens verified artifacts and never replays a job id', async () => {
  const root = await job()
  const directory = path.join(root, 'jobs')
  const service = new ComputeJobService({ directory, backend: backend() })
  const input = { runId: 'run', jobId: 'calculation-1', language: 'python' as const,
    code: "from pathlib import Path; Path('/job/output/summary.json').write_text('{\"total\":42}')",
    outputNames: ['summary.json'], timeoutMs: 10_000 }
  const accepted = await service.start(input)
  expect(accepted).toMatchObject({ status: 'preparing', artifacts: [] })
  const folders = await fs.readdir(directory)
  expect(folders).toHaveLength(1)
  expect((await fs.stat(path.join(directory, folders[0]!, 'state.json'))).size).toBeGreaterThan(0)
  expect(await service.start(input)).toMatchObject({ jobId: 'calculation-1' })
  const completed = await service.wait('run', input.jobId, 30_000)
  expect(completed).toMatchObject({ status: 'ready', exitCode: 0, artifacts: [{ name: 'summary.json', mimeType: 'application/json' }] })
  expect(JSON.parse(Buffer.from((await service.readArtifact('run', input.jobId, 'summary.json')).bytes).toString())).toEqual({ total: 42 })
  const reopened = new ComputeJobService({ directory, backend: backend() })
  expect(await reopened.start(input)).toEqual(completed)
  await expect(reopened.status('another-run', input.jobId)).rejects.toMatchObject({ code: 'job-not-authorized' })
  await expect(reopened.start({ ...input, code: 'print(999)' })).rejects.toMatchObject({ code: 'job-conflict' })
  expect(await reopened.cancel('run', input.jobId)).toEqual(completed)
}, 40_000)

it.skipIf(!image)('cancels an active compute job without delivering its late declared output', async () => {
  const root = await job(), directory = path.join(root, 'jobs')
  const service = new ComputeJobService({ directory, backend: backend() })
  const input = { runId: 'run', jobId: 'calculation-stop', language: 'python' as const,
    code: "from pathlib import Path; import time; Path('/job/output/started.txt').write_text('yes'); time.sleep(5); Path('/job/output/late.json').write_text('{\"bad\":true}')",
    outputNames: ['late.json'], timeoutMs: 15_000 }
  expect(await service.start(input)).toMatchObject({ status: 'preparing' })
  const folder = path.join(directory, (await fs.readdir(directory))[0]!)
  let reached = false
  for (let n = 0; n < 200; n++) {
    try { await fs.access(path.join(folder, 'output', 'started.txt')); reached = true; break } catch { await new Promise(resolve => setTimeout(resolve, 50)) }
  }
  expect(reached).toBe(true)
  expect(await service.cancel('run', input.jobId)).toMatchObject({ status: 'cancelled', stopped: true })
  expect(await service.wait('run', input.jobId, 20_000)).toMatchObject({ status: 'cancelled', artifacts: [] })
  await expect(service.readArtifact('run', input.jobId, 'late.json')).rejects.toMatchObject({ code: 'artifact-not-ready' })
  await new Promise(resolve => setTimeout(resolve, 5200))
  await expect(fs.access(path.join(folder, 'output', 'late.json'))).rejects.toMatchObject({ code: 'ENOENT' })
}, 40_000)

it.skipIf(!image)('retains process exit and logs when a declared output is missing', async () => {
  const root = await job()
  const service = new ComputeJobService({ directory: path.join(root, 'jobs'), backend: backend() })
  const input = { runId: 'run', jobId: 'missing-output', language: 'python' as const,
    code: "print('calculated 42 but failed to write summary')", outputNames: ['summary.json'], timeoutMs: 10_000 }
  await service.start(input)
  expect(await service.wait('run', input.jobId, 30_000)).toMatchObject({ status: 'failed', exitCode: 0, artifacts: [] })
  expect(await service.logs('run', input.jobId)).toMatchObject({ entries: expect.arrayContaining([
    expect.objectContaining({ stream: 'stdout', message: 'calculated 42 but failed to write summary' }),
  ]) })
  await expect(service.readArtifact('run', input.jobId, 'summary.json')).rejects.toMatchObject({ code: 'artifact-not-ready' })
}, 40_000)
