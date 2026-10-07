// @vitest-environment node
import { execFileSync, spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'
import { expect, it } from 'vitest'

const root = path.resolve(__dirname, '../../../..'), requireProduct = createRequire(path.join(root, 'package.json'))
const csv = '班级,分数\n一班,80\n一班,100\n二班,70\n二班,90\n'
const python = `import os, json, sys
from pathlib import Path
import numpy as np
import pandas as pd
import matplotlib
from matplotlib import pyplot as plt, font_manager
from pyodide.http import pyfetch
import js

assert __name__ == '__main__'
assert os.getcwd() == '/job/output'
assert os.environ['GUOLING_INPUT_DIR'] == '/job/input'
assert os.environ['GUOLING_OUTPUT_DIR'] == '/job/output'
assert not hasattr(js, 'process') and not hasattr(js, 'require') and not hasattr(js, 'computeWorkerAPI')
assert 'TEACHER_COMPUTE_HOST_ONLY' not in os.environ
probe_input = json.loads(Path('/job/input/probe-input.json').read_text())
original_csv = Path('/job/input/班级分数.csv').read_text()
try:
    Path('/job/input/班级分数.csv').write_text('must not replace teacher input')
except OSError:
    input_read_only = True
else:
    raise AssertionError('Teacher input accepted a write')
assert Path('/job/input/班级分数.csv').read_text() == original_csv
assert not Path(probe_input['sentinelPath']).exists()
try:
    Path(probe_input['sentinelPath']).read_text()
except OSError:
    host_file_hidden = True
else:
    raise AssertionError('Worker read a host sentinel')
blocked = {}
for name, url in [('http', probe_input['url']), ('host_file', probe_input['sentinelURL'])]:
    try:
        response = await pyfetch(url)
        await response.string()
    except Exception as error:
        blocked[name] = type(error).__name__
    else:
        raise AssertionError('Worker fetched ' + name)
Path('/job/work/alias-check.txt').write_text('same output owner')
assert Path('alias-check.txt').read_text() == 'same output owner'
Path('alias-check.txt').unlink()
assert str(Path('/job/work').resolve()) == '/job/output'
data = pd.read_csv('/job/input/班级分数.csv')
means = data.groupby('班级')['分数'].mean()
total = float(np.mean(data['分数'].to_numpy()))
assert means.to_dict() == {'一班': 90.0, '二班': 80.0} and total == 85.0
summary = pd.DataFrame({'班级': list(means.index) + ['总均分'], '平均分': list(means.values) + [total]})
summary.to_csv('summary.csv', index=False, encoding='utf-8')
font_path = font_manager.findfont(font_manager.FontProperties(family='Noto Sans SC'), fallback_to_default=False)
font = font_manager.FontProperties(fname=font_path)
assert font.get_name() == 'Noto Sans SC'
assert matplotlib.get_backend().lower() == 'agg'
Path('charts').mkdir()
fig, axis = plt.subplots(figsize=(5, 3), dpi=120)
axis.bar(list(means.index), list(means.values), color=['#1188cc', '#24a070'])
axis.set_title('班级成绩均分', fontproperties=font)
axis.set_xlabel('班级', fontproperties=font)
axis.set_ylabel('平均分', fontproperties=font)
for label in axis.get_xticklabels(): label.set_fontproperties(font)
fig.tight_layout()
fig.savefig('charts/班级均分.png')
plt.close(fig)
Path('probe.json').write_text(json.dumps({'inputReadOnly': input_read_only, 'hostFileHidden': host_file_hidden,
    'workerNetworkBlocked': blocked, 'cwd': os.getcwd(), 'workAlias': str(Path('/job/work').resolve()),
    'env': {key: os.environ[key] for key in ['GUOLING_INPUT_DIR', 'GUOLING_OUTPUT_DIR']},
    'numpyVersion': np.__version__, 'pandasVersion': pd.__version__, 'fontFamily': font.get_name(),
    'means': {key: float(value) for key, value in means.items()}, 'total': total}, ensure_ascii=False))
print('一班均分90，二班均分80，总均分85')
sys.exit(0)
`
async function directory(prefix: string) {
  const base = path.join(root, 'output/productFollowup/T06/teacherLocalCompute'); await fs.mkdir(base, { recursive: true })
  return fs.mkdtemp(path.join(base, prefix))
}
async function runElectron(directory: string, phase: string, config: Record<string, unknown>) {
  const result = path.join(directory, `${phase}-facts.json`), checkpoint = path.join(directory, `${phase}-checkpoint.jsonl`)
  const profile = path.join(directory, `${phase}-profile`), requestFile = path.join(directory, `${phase}-request.json`)
  await fs.mkdir(profile, { recursive: true })
  await fs.writeFile(requestFile, JSON.stringify({ root, directory, phase, profile, result, checkpoint, ...config }))
  const executable = requireProduct('electron') as string
  const env: NodeJS.ProcessEnv = { ...process.env, TEACHER_COMPUTE_HOST_ONLY: 'must not enter Python' }; delete env.ELECTRON_RUN_AS_NODE
  const profileArgument = `--user-data-dir=${profile}`
  const child = spawn(executable, [path.join(__dirname, 'teacherLocalComputeHarness.cjs'), requestFile, profileArgument],
    { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  let stdout = '', stderr = ''
  child.stdout!.on('data', chunk => { stdout += String(chunk) }); child.stderr!.on('data', chunk => { stderr += String(chunk) })
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Actual Electron ${phase} did not settle in 100s; see ${checkpoint}`)), 100_000)
      child.once('error', error => { clearTimeout(timer); reject(error) })
      child.once('close', code => { clearTimeout(timer); resolve(code) })
    })
    const facts = JSON.parse(await fs.readFile(result, 'utf8'))
    expect(code, JSON.stringify({ result, facts, stderr })).toBe(0)
    expect(facts.error, JSON.stringify(facts)).toBeUndefined()
    return facts
  } finally {
    await fs.writeFile(path.join(directory, `${phase}-electron.log`), JSON.stringify({ stdout, stderr }, null, 2))
    if (child.pid && child.exitCode === null && child.signalCode === null && child.spawnargs.includes(profileArgument)) {
      if (process.platform === 'win32') {
        try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'pipe', windowsHide: true }) }
        catch (error) { await fs.writeFile(path.join(directory, `${phase}-cleanup-error.txt`), String(error)) }
      } else child.kill()
    }
  }
}
async function loopback() {
  let requests = 0
  const server = http.createServer((_request, response) => { requests++; response.end('Host sentinel: this request must not occur') })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return { url: `http://127.0.0.1:${(server.address() as { port: number }).port}/teacher-private`, count: () => requests,
    async close() { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) } }
}
it('real sandbox worker computes Chinese class means with numpy pandas and a Chinese PNG while preserving readonly input host isolation and offline execution', async () => {
  const output = await directory('grades-'), network = await loopback()
  try {
    const sentinel = path.join(output, 'host-sentinel.txt'); await fs.writeFile(sentinel, 'Host-only teacher sentinel')
    const input = { runId: 'teacher-grades-run', jobId: 'teacher-grades', language: 'python', code: python,
      inputs: [{ name: '班级分数.csv', text: csv }, { name: 'probe-input.json', text: JSON.stringify({ url: network.url,
        sentinelPath: sentinel, sentinelURL: pathToFileURL(sentinel).href }) }], outputNames: ['summary.csv', 'charts/班级均分.png', 'probe.json'] }
    const jobs = path.join(output, 'jobs'), delivery = path.join(output, 'delivered')
    const facts = await runElectron(output, 'compute', { input, jobs, delivery, networkURL: network.url })
    expect(facts.final).toMatchObject({ status: 'ready', exitCode: 0, stopped: false })
    expect(facts.probe).toMatchObject({ means: { 一班: 90, 二班: 80 }, total: 85, inputReadOnly: true, hostFileHidden: true,
      cwd: '/job/output', workAlias: '/job/output', env: { GUOLING_INPUT_DIR: '/job/input', GUOLING_OUTPUT_DIR: '/job/output' }, fontFamily: 'Noto Sans SC' })
    expect(facts.probe.workerNetworkBlocked).toEqual({ http: expect.any(String), host_file: expect.any(String) })
    expect(facts.probe.numpyVersion).toMatch(/^\d+\./); expect(facts.probe.pandasVersion).toMatch(/^\d+\./)
    expect(network.count()).toBe(0)
    expect(facts.observations.length).toBeGreaterThan(0)
    expect(facts.observations[0]).toMatchObject({ loaded: true, preferences: { sandbox: true, contextIsolation: true,
      nodeIntegration: false, nodeIntegrationInSubFrames: false }, rendererNetwork: { rejected: true } })
    // Electron's actual getter can omit this false preference. The Python probe above separately requires no worker Node/preload globals.
    expect(facts.observations[0].preferences.nodeIntegrationInWorker).not.toBe(true)
    const rows = facts.summary.trim().split(/\r?\n/).map((row: string) => row.split(','))
    expect(rows[0]).toEqual(['班级', '平均分'])
    expect(Object.fromEntries(rows.slice(1).map(([name, mean]: string[]) => [name, Number(mean)]))).toEqual({ 一班: 90, 二班: 80, 总均分: 85 })
    expect(facts.inputAfter).toBe(csv)
    expect(await fs.readFile(sentinel, 'utf8')).toBe('Host-only teacher sentinel')
    expect(facts.starts).toBe(1); expect(facts.unsafeOutputRejected).toBe(true)
    expect(facts.final.artifacts.map((artifact: { name: string }) => artifact.name).sort()).toEqual(['charts/班级均分.png', 'probe.json', 'summary.csv'])
    expect(facts.deliveries).toEqual([expect.objectContaining({ status: 'written', sourceKind: 'compute' }), expect.objectContaining({ status: 'written', sourceKind: 'compute' })])
    expect(await fs.readFile(path.join(delivery, 'summary.csv'), 'utf8')).toBe(facts.summary)
    expect(await sharp(await fs.readFile(facts.chartPath)).metadata()).toMatchObject({ format: 'png', width: 600, height: 360 })
    expect(facts.logs.entries.filter((entry: { stream: string }) => entry.stream === 'stderr').map((entry: { message: string }) => entry.message).join('\n')).not.toMatch(/Glyph.*missing from font/i)
    const cold = await runElectron(output, 'ready-reopen', { input, jobs, delivery, networkURL: network.url })
    expect(cold.final.status).toBe('ready'); expect(cold.summary).toBe(facts.summary)
    expect(cold.starts).toBe(0); expect(cold.observations).toEqual([]); expect(network.count()).toBe(0)
  } finally { await network.close() }
}, 120_000)
it('Stop terminates a real starting worker and a fresh Electron owner keeps the captured pending job unknown without replay or late output', async () => {
  const output = await directory('stop-'), network = await loopback()
  try {
    const input = { runId: 'teacher-stop-run', jobId: 'teacher-stop', language: 'python',
      code: "import time\nend = time.monotonic() + 10\nwhile time.monotonic() < end: pass\nopen('late.txt', 'w').write('must never be handed off after Stop')\n",
      inputs: [], outputNames: ['late.txt'] }
    const jobs = path.join(output, 'jobs'), coldJobs = path.join(output, 'cold-pending')
    const facts = await runElectron(output, 'stop', { input, jobs, coldJobs, networkURL: network.url })
    expect(['preparing', 'running']).toContain(facts.pending.status)
    expect(facts.beforeStop).toBe('running'); expect(facts.afterStop).toBe('missing')
    expect(facts.cancelled).toMatchObject({ status: 'cancelled', stopped: true })
    expect(facts.final).toMatchObject({ status: 'cancelled', stopped: true, artifacts: [] })
    expect(facts.outcomes).toEqual([expect.objectContaining({ cancelled: true })])
    expect(facts.cancelElapsed).toBeLessThan(5000)
    expect(facts.liveWindowsAfterStop).toBe(0); expect(facts.outputNamesAfterStop).toEqual([])
    expect(facts.observations).toEqual([expect.objectContaining({ loaded: true, destroyed: true })])
    expect(facts.starts).toBe(1); expect(network.count()).toBe(0)
    const cold = await runElectron(output, 'pending-reopen', { input, jobs: coldJobs })
    expect(cold.final).toMatchObject({ status: 'unknown', artifacts: [] })
    expect(cold.sameRequest).toMatchObject({ status: 'unknown', artifacts: [] })
    expect(cold.starts).toBe(0); expect(cold.observations).toEqual([]); expect(cold.liveWindows).toBe(0)
  } finally { await network.close() }
}, 120_000)
