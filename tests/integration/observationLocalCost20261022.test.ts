// @vitest-environment node
import { expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { componentContainers } from '../../src/shared/contracts/component-platform/project'
import { ObservationImageStore } from '../../src/main/workbench/observation/ObservationImageStore'
import { ViewObservationService } from '../../src/main/workbench/observation/ViewObservationService'
import type { ViewObservationSnapshot } from '../../src/shared/workbench/viewObservation'

it('freezes one source snapshot, checks lightweight canonical heads and crops the just-captured pixels without rereading them', async () => {
  const project = createBlankCourseProjectV10('观察局部成本')
  const locationId = componentContainers(project)[0]!.id
  const identity = { documentId: 'document', epoch: 'epoch', revision: 1, locationId }
  const snapshot: ViewObservationSnapshot = { ...identity, model: { kind: 'course-v10', project, resources: { assets: {}, components: {} } },
    binding: { kind: 'untitled', suggestedName: 'observe.glx' }, dirty: true, saving: false, recoverable: true, undoDepth: 0, redoDepth: 0 }
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#345678' } }).png().toBuffer()
  const images = new ObservationImageStore()
  const read = vi.spyOn(images, 'read')
  const readSnapshot = vi.fn(async () => snapshot)
  const currentIdentity = vi.fn(async () => ({ documentId: identity.documentId, epoch: identity.epoch, revision: identity.revision, kind: 'course-v10' as const }))
  const service = new ViewObservationService({ images, snapshot: readSnapshot, currentIdentity,
    captureIsolated: async () => ({ identity, png, width: 8, height: 8, structure: [], diagnostics: [] }) })
  try {
    const result = await service.observe({ runId: 'run', requestId: 'clip', ...identity, projectId: project.id,
      clip: { x: 2, y: 1, width: 3, height: 4 } })
    expect(readSnapshot).toHaveBeenCalledOnce()
    expect(currentIdentity).toHaveBeenCalledTimes(3)
    expect(read).not.toHaveBeenCalled()
    expect(result.coverage).toMatchObject({ width: 3, height: 4, clip: { x: 2, y: 1, width: 3, height: 4 } })
    const original = await images.read('run', result.originalImage!.resourceId)
    expect(original.bytes).toEqual(Uint8Array.from(png))
    const cropped = await images.read('run', result.image.resourceId)
    expect(await sharp(cropped.bytes).metadata()).toMatchObject({ width: 3, height: 4 })
  } finally { await service.stopRun('run') }
})

it('rejects a changed lightweight canonical head before admitting captured image bytes', async () => {
  const project = createBlankCourseProjectV10('过时观察')
  const identity = { documentId: 'document', epoch: 'epoch', revision: 1, locationId: componentContainers(project)[0]!.id }
  const snapshot: ViewObservationSnapshot = { ...identity, model: { kind: 'course-v10', project, resources: { assets: {}, components: {} } },
    binding: { kind: 'untitled', suggestedName: 'observe.glx' }, dirty: true, saving: false, recoverable: true, undoDepth: 0, redoDepth: 0 }
  const images = new ObservationImageStore(), put = vi.spyOn(images, 'put')
  const service = new ViewObservationService({ images, snapshot: async () => snapshot,
    currentIdentity: async () => ({ documentId: identity.documentId, epoch: identity.epoch, revision: 2, kind: 'course-v10' }),
    captureIsolated: async () => ({ identity, png: new Uint8Array(), width: 1, height: 1, structure: [], diagnostics: [] }) })
  await expect(service.observe({ runId: 'run', requestId: 'stale', ...identity, projectId: project.id })).rejects.toThrow('已改变')
  expect(put).not.toHaveBeenCalled()
})
