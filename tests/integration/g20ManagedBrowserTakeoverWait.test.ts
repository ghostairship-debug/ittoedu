// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { ManagedBrowserMcpService } from '../../src/main/workbench/externalTools/ManagedBrowserMcpService'

it.each(['read', 'write', 'approval'] as const)('takes over the same page while a %s operation is waiting, without replaying it', async mode => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'browser-takeover-wait-'))
  let started!: () => void
  const entered = new Promise<void>(resolve => { started = resolve })
  let human = false, calls = 0
  const service = new ManagedBrowserMcpService({ scratchRoot: path.join(root, 'runs'),
    approveExternalAction: async () => {
      if (mode === 'approval') { started(); return new Promise<boolean>(() => {}) }
      return true
    },
    embeddedBackend: async options => {
      options.onPageChanged('https://example.com/login')
      return {
        discover: async () => ({ status: 'available', tools: [] }),
        invoke: async input => {
          if (input.name.endsWith('browser_snapshot')) return { status: 'returned', service: 'browser', tool: input.name,
            operationId: input.operationId, content: [{ type: 'text', text: '- Page URL: https://example.com/login', truncated: false }], truncated: false }
          calls++; started()
          // A native command may not react to Abort until it eventually returns.
          return new Promise(() => {})
        },
        control: async value => { human = value },
        viewport: () => ({ embedded: true, visible: human }),
        readResource: async () => { throw new Error('No resource') }, stop: async () => {},
      }
    } })
  try {
    await service.beginRun('run', { permission: 'workspace-write', allowPublicNavigation: true })
    await service.discover('run')
    const snapshot = await service.invoke({ runId: 'run', operationId: 'snapshot', name: 'browser_snapshot', arguments: {} })
    const input = { runId: 'run', operationId: 'pending', name: mode === 'read' ? 'browser_wait_for' : 'browser_click',
      arguments: mode === 'read' ? { text: 'Logged in', time: 3600 } : { target: '#submit' }, snapshotId: snapshot.snapshotId }
    const pending = service.invoke(input)
    await entered
    expect(await service.control('run', 'takeover')).toMatchObject({ state: 'human', pageUrl: 'https://example.com/login' })
    expect(human).toBe(true)
    const result = await pending
    expect(result.status).toBe(mode === 'write' ? 'unknown' : 'rejected')
    expect(await service.invoke(input)).toEqual(result)
    expect(calls).toBe(mode === 'approval' ? 0 : 1)
    expect(await service.control('run', 'resume')).toMatchObject({ state: 'agent', pageUrl: 'https://example.com/login' })
    expect(service.controlState('run').snapshotId).toBeTruthy()
  } finally {
    await service.endRun('run')
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected fixture path')
    await fs.rm(root, { recursive: true, force: true })
  }
})
