// @vitest-environment node
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { ManagedBrowserMcpService } from '../../src/main/workbench/externalTools/ManagedBrowserMcpService'

it('registers and stops ordinary tasks without preparing any browser dependencies', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'g20-browser-lazy-'))
  const scratchRoot = join(root, 'not-created')
  const service = new ManagedBrowserMcpService({ scratchRoot })
  try {
    await service.beginRun('text', { permission: 'workspace-write' })
    expect(service.controlState('text')).toEqual({ state: 'agent' })
    expect(service.approvalContext('text')).toEqual({})
    await expect(service.control('text', 'takeover')).rejects.toThrow('本任务尚未打开可接管的网页')
    expect(service.controlState('text')).toEqual({ state: 'agent' })
    await expect(fs.stat(scratchRoot)).rejects.toMatchObject({ code: 'ENOENT' })
    await service.stopRun('text')
    expect(await service.discover('text')).toMatchObject({ status: 'stopped' })
    await service.endRun('text')
    await expect(fs.stat(scratchRoot)).rejects.toMatchObject({ code: 'ENOENT' })
  } finally { await service.endRun('text'); await fs.rm(root, { recursive: true, force: true }) }
})

it('contains browser preparation failures to actual browser use, not run registration', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'g20-browser-unavailable-'))
  const unavailable = join(root, 'file-not-directory'); await fs.writeFile(unavailable, 'owned test fixture')
  const service = new ManagedBrowserMcpService({ scratchRoot: unavailable })
  try {
    await expect(service.beginRun('ordinary', { permission: 'read-only' })).resolves.toBeUndefined()
    expect(await service.discover('ordinary')).toMatchObject({ status: 'failed' })
    await expect(service.beginRun('another', { permission: 'read-only' })).resolves.toBeUndefined()
    expect(await fs.readFile(unavailable, 'utf8')).toBe('owned test fixture')
    await service.endRun('ordinary'); await service.endRun('another')
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
