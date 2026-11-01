// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { HostToolCoordinator, type HostToolServices } from '../../src/core/tools/HostToolServices'
import { workbenchServiceRegistrations } from '../../src/core/tools/WorkbenchServiceTools'
import type { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { assetSourceRegistrations } from '../../src/core/tools/AssetSourceTools'

it('removes unavailable local execution from discovery without hiding native delegation', async () => {
  let available = false
  const prepareLocal = vi.fn(async () => { throw new Error('Not invoked by discovery') })
  const services: HostToolServices = { delegation: {
    availability: () => ({ ready: false, reason: 'No external model configured' }),
    localAvailability: async () => ({ available }), prepareLocal,
    startManaged: async () => { throw new Error('Not invoked') },
    readArtifact: async () => { throw new Error('Not invoked') },
    cancel: async () => { throw new Error('Not invoked') }, cancelRun: async () => undefined,
  } }
  const host = new HostToolCoordinator(services, {} as DocumentRegistry, {} as never)
  const names = () => workbenchServiceRegistrations.filter(tool => tool.supports({ ...host.supportContext(), workbenchServices: true }))
    .map(tool => tool.name)
  await host.beginRun({ runId: 'first', actor: 'agent', documents: [], fileAccess: { permission: 'full', workspaceRoot: '/fixture' } })
  expect(names()).not.toContain('local.run')
  expect(names()).toEqual(expect.arrayContaining(['delegate.agent', 'delegate.message', 'delegate.resume']))
  available = true
  await host.beginRun({ runId: 'second', actor: 'agent', documents: [], fileAccess: { permission: 'full', workspaceRoot: '/fixture' } })
  expect(names()).toContain('local.run')
  expect(prepareLocal).not.toHaveBeenCalled()
  const resourcesOnly = { workbenchServices: true, delegation: true, images: false, openImages: false }
  expect(assetSourceRegistrations.find(tool => tool.name === 'image.preview')!.supports(resourcesOnly)).toBe(true)
  expect(assetSourceRegistrations.find(tool => tool.name === 'image.search')!.supports(resourcesOnly)).toBe(false)
  const unavailable = { workbenchServices: true, delegation: false, compute: false, images: false, openImages: false,
    materials: false, observations: false }
  const imagePreview = assetSourceRegistrations.find(tool => tool.name === 'image.preview')!
  expect(imagePreview.supports(unavailable)).toBe(false)
  expect(imagePreview.supports({ ...unavailable, materials: true })).toBe(true)
  expect(imagePreview.supports({ ...unavailable, observations: true })).toBe(true)
  expect(imagePreview.supports({ ...unavailable, materials: true, workbenchServices: false })).toBe(false)
})
