// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { ComputeJobService } from '../../../../src/main/workbench/compute/ComputeJobService'
import { PodmanComputeBackend, type ComputeBackendRequest } from '../../../../src/main/workbench/compute/PodmanComputeBackend'

// Controlled backend proves software collection/lifecycle only, not Podman availability or Python execution.
it('keeps usable CSV available when an auxiliary declared output is missing and retains complete paginated logs', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'T09-output-'))
  const longLine = `details-${'x'.repeat(2400)}`
  const lines = [...Array.from({ length: 220 }, (_, n) => `record-${n}`), longLine]
  let starts = 0
  const backend = {
    availability: async () => ({ available: true }),
    start: async (request: ComputeBackendRequest) => {
      starts++
      expect(await fs.readFile(path.join(request.directory, 'input', 'teacher.csv'), 'utf8')).toBe('value\n2\n4\n')
      await fs.writeFile(path.join(request.directory, 'output', 'summary.csv'), 'count,mean\n2,3\n')
      return { done: Promise.resolve({ exitCode: 0, stdout: lines.join('\n'), stderr: '', truncated: false, cancelled: false }), cancel: async () => true }
    },
    inspectContainer: async () => 'absent', stopContainer: async () => true,
  } as unknown as PodmanComputeBackend
  try {
    const service = new ComputeJobService({ directory, backend })
    await service.start({ runId: 'run', jobId: 'summary', language: 'python', code: 'controlled fixture',
      inputs: [{ name: 'teacher.csv', bytes: new TextEncoder().encode('value\n2\n4\n') }], outputNames: ['auxiliary.json', 'summary.csv'] })
    const final = await service.wait('run', 'summary', 5000)
    expect(final.status).toBe('ready')
    expect(final.artifacts.map(artifact => artifact.name)).toEqual(['summary.csv'])
    expect(final).toMatchObject({ outputDiagnostics: [expect.objectContaining({ name: 'auxiliary.json', message: expect.any(String) })] })
    expect(new TextDecoder().decode((await service.readArtifact('run', 'summary', 'summary.csv')).bytes)).toBe('count,mean\n2,3\n')
    const retained: string[] = []
    let cursor = 0
    while (true) {
      const page = await service.logs('run', 'summary', cursor, 100)
      retained.push(...page.entries.filter(entry => entry.stream === 'stdout').map(entry => entry.message))
      if (page.nextCursor === cursor) break
      cursor = page.nextCursor
    }
    expect(retained).toEqual(lines)
    const cold = new ComputeJobService({ directory, backend })
    expect((await cold.status('run', 'summary')).status).toBe('ready')
    expect(new TextDecoder().decode((await cold.readArtifact('run', 'summary', 'summary.csv')).bytes)).toBe('count,mean\n2,3\n')
    expect(starts).toBe(1)
  } finally {
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe fixture cleanup')
    await fs.rm(directory, { recursive: true, force: true })
  }
})
