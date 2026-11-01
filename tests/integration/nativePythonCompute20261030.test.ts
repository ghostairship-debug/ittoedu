// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { NativePythonComputeBackend } from '../../src/main/workbench/compute/NativePythonComputeBackend'
import { ComputeJobService } from '../../src/main/workbench/compute/ComputeJobService'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
const roots: string[] = [], backends: NativePythonComputeBackend[] = []
// Real process acceptance is opt-in; ordinary unit runs must not install into a developer's Python.
const realPython = process.env.GUOLING_TEST_PYTHON
const realTest = it.skipIf(!realPython)
afterEach(async () => { for (const backend of backends.splice(0)) backend.dispose(); for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }) })
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-compute-')); roots.push(root)
  const backend = new NativePythonComputeBackend({ directory: path.join(root, 'runtime'),
    candidates: [{ executable: realPython! }] })
  backends.push(backend)
  return { root, backend, service: new ComputeJobService({ directory: path.join(root, 'jobs'), backend }) }
}
realTest('runs actual native analysis with Unicode chart, delivers artifacts, and reopens ready without replay', async () => {
  const { root, backend, service } = await fixture(), start = vi.spyOn(backend, 'start')
  const request = { runId: 'run', jobId: 'analysis', language: 'python' as const,
    inputs: [{ name: '成绩.csv', bytes: Buffer.from('班级,分数\n一班,80\n一班,100\n二班,70\n二班,90\n') }],
    code: `import os,json,sys,asyncio\nfrom pathlib import Path\nimport numpy as np,pandas as pd\nfrom matplotlib import pyplot as plt\nassert __name__=='__main__'\nassert Path.cwd()==Path(os.environ['GUOLING_OUTPUT_DIR'])\nassert 'GUOLING_TEST_PROVIDER_SECRET' not in os.environ\nawait asyncio.sleep(0)\ndata=pd.read_csv(Path(os.environ['GUOLING_INPUT_DIR'])/'成绩.csv')\nmeans=data.groupby('班级')['分数'].mean()\nPath('结果.json').write_text(json.dumps({'means':means.to_dict(),'total':float(np.mean(data['分数']))},ensure_ascii=False),encoding='utf-8')\nmeans.plot.bar(title='班级均分')\nplt.tight_layout()\nplt.savefig('均分.png')\nprint('计算完成85')\nsys.exit(0)` }
  process.env.GUOLING_TEST_PROVIDER_SECRET = 'private'
  try {
    await service.start(request)
    const final = await service.wait('run', 'analysis', 30_000)
    expect(final).toMatchObject({ status: 'ready', exitCode: 0 })
    expect(final.artifacts.map(a => a.name).sort()).toEqual(['均分.png', '结果.json'])
    const json = await service.readArtifact('run', 'analysis', '结果.json')
    expect(JSON.parse(Buffer.from(json.bytes).toString('utf8'))).toEqual({ means: { 一班: 90, 二班: 80 }, total: 85 })
    const host = new DocumentHostService(path.join(root, 'host'))
    const saved = await host.artifactDeliveries.deliver({ runId: 'run', operationId: 'delivery', workspaceRoot: root,
      permission: 'workspace', destination: '交付.json', sourceKind: 'compute', sourceId: 'analysis@结果.json', bytes: json.bytes, assertActive() {} })
    expect(saved.status).toBe('written')
    expect(JSON.parse(await fs.readFile(path.join(root, '交付.json'), 'utf8')).total).toBe(85)
    const reopened = new ComputeJobService({ directory: path.join(root, 'jobs'), backend })
    expect((await reopened.start(request)).status).toBe('ready'); expect(start).toHaveBeenCalledOnce()
    expect(JSON.stringify(await service.logs('run', 'analysis'))).not.toMatch(/Glyph.*missing from font/)
  } finally { delete process.env.GUOLING_TEST_PROVIDER_SECRET }
}, 40_000)
realTest('keeps a real nonzero exit failed and prevents delivery', async () => {
  const { service } = await fixture()
  await service.start({ runId: 'run', jobId: 'failed', language: 'python', code: "open('bad.txt','w').write('incomplete')\nraise SystemExit(3)" })
  expect(await service.wait('run', 'failed', 30_000)).toMatchObject({ status: 'failed', exitCode: 3, artifacts: [] })
  await expect(service.readArtifact('run', 'failed', 'bad.txt')).rejects.toThrow('未准备好')
}, 40_000)
realTest('stops the native process tree and keeps an interrupted job unknown without replay', async () => {
  const { root, service, backend } = await fixture()
  await service.start({ runId: 'run', jobId: 'stop', language: 'python', code:
    "import subprocess,sys,time\nfrom pathlib import Path\np=subprocess.Popen([sys.executable,'-c','import time;time.sleep(120)'])\nPath('child.pid').write_text(str(p.pid))\ntime.sleep(120)" })
  const current = await service.status('run', 'stop'), output = current.locations!.output
  await expect.poll(async () => fs.readFile(path.join(output, 'child.pid'), 'utf8').catch(() => ''), { timeout: 20_000 }).not.toBe('')
  const pid = Number(await fs.readFile(path.join(output, 'child.pid'), 'utf8'))
  const interrupted = path.join(root, 'interrupted'); await fs.cp(path.join(root, 'jobs'), interrupted, { recursive: true })
  expect((await service.cancel('run', 'stop')).status).toBe('cancelled')
  expect(() => process.kill(pid, 0)).toThrow()
  const coldBackend = new NativePythonComputeBackend({ directory: path.join(root, 'unused') }); backends.push(coldBackend)
  const cold = new ComputeJobService({ directory: interrupted, backend: coldBackend })
  expect(await cold.status('run', 'stop')).toMatchObject({ status: 'unknown' })
}, 30_000)
