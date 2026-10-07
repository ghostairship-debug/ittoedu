// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { ManagedBrowserMcpService } from '../../../../src/main/workbench/externalTools/ManagedBrowserMcpService'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe fixture cleanup')
    await fs.rm(root, { recursive: true, force: true })
  }
})

// The injected backend proves the service/backend handoff contract; it is not a real-window proof.
it.each([false, true])('restores actual human control after resume observation fails (restoration fails: %s)', async restorationFails => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'T05-takeover-')); roots.push(root)
  let human = false, snapshotFails = false, failRestoration = false, factories = 0, clicks = 0
  const controls: boolean[] = []
  const service = new ManagedBrowserMcpService({ scratchRoot: root,
    approveExternalAction: async () => true,
    embeddedBackend: async options => {
      factories++
      options.onPageChanged('https://example.com/local-fixture')
      return {
        discover: async () => ({ status: 'available', tools: [] }),
        invoke: async input => {
          if (input.name.endsWith('browser_snapshot')) {
            if (snapshotFails) throw new Error('snapshot unavailable')
            return { status: 'returned', service: 'browser', tool: input.name, operationId: input.operationId,
              content: [{ type: 'text', text: '- Page URL: https://example.com/local-fixture', truncated: false }], truncated: false }
          }
          clicks++
          return { status: 'returned', service: 'browser', tool: input.name, operationId: input.operationId, content: [], truncated: false }
        },
        control: async value => {
          controls.push(value)
          if (value && failRestoration) throw new Error('human window unavailable')
          human = value
        },
        viewport: () => ({ embedded: true, visible: human }),
        readResource: async () => { throw new Error('No resource') }, stop: async () => {},
      }
    },
  })
  try {
    await service.beginRun('run', { permission: 'workspace-write', allowPublicNavigation: true })
    await service.discover('run')
    await service.invoke({ runId: 'run', operationId: 'observe', name: 'browser_snapshot', arguments: {} })
    await service.control('run', 'takeover')
    expect(human).toBe(true)
    snapshotFails = true; failRestoration = restorationFails
    await expect(service.control('run', 'resume')).rejects.toThrow()
    expect(controls.slice(-2)).toEqual([false, true])
    expect(service.controlState('run')).toMatchObject({ state: restorationFails ? 'transition' : 'human' })
    expect(service.controlState('run').snapshotId).toBeUndefined()
    if (restorationFails) {
      failRestoration = false
      await service.control('run', 'takeover')
    }
    expect(human).toBe(true)
    snapshotFails = false
    expect(await service.control('run', 'resume')).toMatchObject({ state: 'agent', pageUrl: 'https://example.com/local-fixture' })
    expect(service.controlState('run').snapshotId).toBeTruthy()
    expect(factories).toBe(1)
    expect(clicks).toBe(0)
  } finally { await service.endRun('run') }
})
