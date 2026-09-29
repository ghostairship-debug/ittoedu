// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { HostToolCoordinator } from '../../src/core/tools/HostToolServices'
import { ComputeJobService } from '../../src/main/workbench/compute/ComputeJobService'
import { PINNED_PYTHON_IMAGE_ID, PodmanComputeBackend } from '../../src/main/workbench/compute/PodmanComputeBackend'
import { HostJobService } from '../../src/main/workbench/jobs/HostJobService'
import type { ImageGenerationService } from '../../src/main/workbench/images/ImageGenerationService'
import type { ControlledBuildService } from '../../src/main/workbench/build/ControlledBuildService'
import type { ToolResult } from '../../src/shared/workbench/tools'

const image = process.env.G20_TEST_PODMAN_IMAGE
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) {
  if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected test root')
  await fs.rm(root, { recursive: true, force: true })
} }, 30_000)
const data = (value: ToolResult): any => { if (value.kind !== 'read') throw new Error(JSON.stringify(value)); return value.data }

it.skipIf(!image)('routes a real isolated compute job through coordinator, job wait/logs and verified artifact bytes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-compute-chain-')); roots.push(root)
  const backend = new PodmanComputeBackend({ distro: 'Ubuntu', image: image! })
  if (image === PINNED_PYTHON_IMAGE_ID) expect(await backend.provisionPinnedPython()).toEqual({ available: true })
  const compute = new ComputeJobService({ directory: path.join(root, 'jobs'),
    backend })
  const jobs = new HostJobService({ compute, images: {} as ImageGenerationService, builds: {} as ControlledBuildService })
  const registry = new DocumentRegistry({ drivers: [], createId: () => 'unexpected-document', bindingKey: binding => binding.path,
    persistence: { async append() { throw new Error('No document transaction expected') }, async save() { throw new Error('No document save expected') } } })
  const never = async (): Promise<never> => { throw new Error('Compute must not touch document authority') }
  const host = new HostToolCoordinator({ compute, jobs }, registry, { resolve: never, resolveImage: never, active: never,
    actor: () => 'agent', ownsDocument: () => false, provideImage: never, readImage: never })
  await host.beginRun({ runId: 'compute-run', actor: 'agent', documents: [], fileAccess: { permission: 'workspace', workspaceRoot: root } })
  const submitted = data(await host.runCompute('compute-run', 'tool:compute-chain', { language: 'python',
    code: `from pathlib import Path\nimport csv, json\nvalues = [int(row['score']) for row in csv.DictReader(Path('/job/input/scores.csv').open())]\nPath('/job/output/summary.json').write_text(json.dumps({'sum': sum(values), 'count': len(values)}))\nPath('/job/output/report.html').write_text('<h1>Sum %s</h1>' % sum(values))\nprint('computed', sum(values))`,
    inputs: [{ name: 'scores.csv', bytes: Buffer.from('score\n20\n22\n') }], outputNames: ['summary.json', 'report.html'] }))
  expect(submitted).toMatchObject({ job: expect.stringMatching(/^compute-/), status: expect.stringMatching(/preparing|running|ready/) })
  const waited = data(await host.jobWait('compute-run', { kind: 'compute', jobId: submitted.job, milliseconds: 25_000 }))
  expect(waited).toMatchObject({ kind: 'compute', status: 'ready', terminal: true,
    snapshot: { artifacts: [{ name: 'summary.json' }, { name: 'report.html' }] } })
  const logs = data(await host.jobLogs('compute-run', { kind: 'compute', jobId: submitted.job }))
  expect(JSON.stringify(logs.entries)).toContain('computed 42')
  const json = await host.readComputeArtifact('compute-run', submitted.job, 'summary.json')
  expect(json.artifact.mimeType).toBe('application/json')
  expect(JSON.parse(Buffer.from(json.bytes).toString('utf8'))).toEqual({ sum: 42, count: 2 })
  const html = await host.readComputeArtifact('compute-run', submitted.job, 'report.html')
  expect(Buffer.from(html.bytes).toString('utf8')).toBe('<h1>Sum 42</h1>')
  await expect(host.readComputeArtifact('other-run', submitted.job, 'summary.json')).rejects.toThrow()
  await host.stop('compute-run')
  await expect(host.readComputeArtifact('compute-run', submitted.job, 'summary.json')).rejects.toThrow('停止')
}, 35_000)
