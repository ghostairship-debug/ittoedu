import { expect, it } from 'vitest'
import { shortJobOutput } from '../../src/core/tools/shortJobOutput'
import { modelToolResult } from '../../src/core/tools/modelToolResult'
const entry = (cursor: number, message = String(cursor)) => ({ cursor, message, stream: 'stdout' })
it('includes short terminal output in the real model receipt, preserving failed status', () => {
  const output = shortJobOutput({ entries: [entry(1, '计算失败的具体原因')] }, 'compute-a')
  expect(output).toMatchObject({ complete: true, nextAfter: 1 })
  expect(modelToolResult('job.wait', { kind: 'read', data: { kind: 'compute', jobId: 'compute-a', status: 'failed', terminal: true,
    snapshot: { status: 'failed', exitCode: 1 }, output } })).toMatchObject({ data: { status: 'failed', output } })
})
it('does not skip the 33rd entry or an oversized multibyte record', () => {
  const raw = { entries: Array.from({ length: 33 }, (_, i) => entry(i + 1)) }, before = structuredClone(raw)
  expect(shortJobOutput(raw, 'compute-a')).toMatchObject({ complete: false, nextAfter: 32, source: { input: { after: 32 } } })
  expect(raw).toEqual(before)
  const output = shortJobOutput({ entries: [entry(1, 'short'), entry(2, '中文'.repeat(2000)), entry(3)] }, 'compute-a')
  expect(output).toMatchObject({ complete: false, nextAfter: 1, entries: [entry(1, 'short')] })
  expect(new TextEncoder().encode(JSON.stringify(output)).length).toBeLessThanOrEqual(6144)
  expect(shortJobOutput({ entries: [entry(1, 'x'.repeat(7000))] }, 'compute-a')).toMatchObject({ complete: false, nextAfter: 0, entries: [] })
})
