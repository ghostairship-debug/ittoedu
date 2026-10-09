import { describe, expect, it, vi } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { ObservationImageStore } from '../../src/main/workbench/observation/ObservationImageStore'
import { ViewObservationService } from '../../src/main/workbench/observation/ViewObservationService'
import { executeViewObserveTool } from '../../src/core/tools/ViewObserveTools'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'

const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'))
const identity = { documentId: 'd', epoch: 'e', revision: 3, locationId: 'second' }
const project = createBlankCourseProjectV10('观察'); project.id = 'project'
project.surfaces = ['first', 'second'].map(id => ({ id, kind: 'slide', title: id, childIds: [] }))
project.global.overlay = []; project.instances = {}; project.definitions = {}
const snapshot: DocumentSnapshot = { documentId: 'd', epoch: 'e', revision: 3,
  model: { kind: 'course-v10', project, resources: { assets: {}, components: {} } },
  binding: { kind: 'untitled', suggestedName: 'test' }, dirty: true, saving: false, recoverable: true,
  undoDepth: 2, redoDepth: 0 }
const input = { runId: 'run', requestId: 'call', documentId: 'd', epoch: 'e', revision: 3,
  projectId: 'project', locationId: 'second' }
const captured = { identity, png, width: 1, height: 1, structure: ['Second'], diagnostics: [] }

describe('view.observe', () => {
  it('captures a non-current page in an isolated frozen snapshot, without changing the document', async () => {
    const images = new ObservationImageStore(), original = structuredClone(snapshot)
    const live = vi.fn(async () => ({ ...captured, identity: { ...identity, locationId: 'first', viewGeneration: 'generation-7' } }))
    const isolated = vi.fn(async ({ snapshot: frozen }: { snapshot: DocumentSnapshot }) => {
      expect(frozen).not.toBe(snapshot)
      expect(frozen).toEqual(original)
      return { ...captured, identity: { ...identity, viewGeneration: 'generation-7' } }
    })
    const service = new ViewObservationService({ snapshot: async () => snapshot, captureLive: live,
      captureIsolated: isolated as never, images })
    const receipt = await service.observe({ ...input, viewGeneration: 'generation-7' })
    expect(receipt.source).toBe('isolated-published')
    expect(receipt.identity).toEqual({ ...identity, viewGeneration: 'generation-7' })
    expect(isolated).toHaveBeenCalledOnce()
    expect(snapshot).toEqual(original)
    expect((await service.readResource({ runId: 'run', resourceId: receipt.image.resourceId })).bytes).toEqual(png)
    await expect(service.readResource({ runId: 'foreign', resourceId: receipt.image.resourceId })).rejects.toThrow()
  })

  it('accepts live pixels only for the exact mounted identity', async () => {
    const isolated = vi.fn()
    const liveIdentity = { ...identity, viewGeneration: 'generation-7' }
    const service = new ViewObservationService({ snapshot: async () => snapshot,
      captureLive: async () => ({ ...captured, identity: liveIdentity }), captureIsolated: isolated,
      images: new ObservationImageStore() })
    expect((await service.observe({ ...input, viewGeneration: 'generation-7' })).source).toBe('live')
    expect(isolated).not.toHaveBeenCalled()
  })

  it('rejects a late frame after revision changes, and does not retain its bytes', async () => {
    const images = new ObservationImageStore()
    let revision = 3
    const service = new ViewObservationService({ snapshot: async () => ({ ...snapshot, revision }),
      captureIsolated: async () => { revision++; return captured }, images })
    await expect(service.observe(input)).rejects.toThrow('已改变')
    await expect(service.readResource({ runId: 'run', resourceId: 'unknown' })).rejects.toThrow()
  })

  it('resolves an authorized handle; invalid and stale handles never capture', async () => {
    const observe = vi.fn(async () => ({ source: 'isolated-published' as const, identity,
      coverage: { width: 1, height: 1 }, structure: [], diagnostics: [],
      image: { resourceId: 'r', mimeType: 'image/png', width: 1, height: 1, byteLength: png.byteLength } }))
    const service = { observe, readResource: vi.fn() }
    const context = { runId: 'run', operationId: 'call', resolveTarget: async (handle: string) => handle === 'valid'
      ? { ...input, runId: undefined, requestId: undefined } as never : null }
    expect((await executeViewObserveTool(service, context, { target: 'stale' })).kind).toBe('error')
    expect((await executeViewObserveTool(service, context, { target: 'valid' })).kind).toBe('read')
    expect(observe).toHaveBeenCalledOnce()
  })
})
