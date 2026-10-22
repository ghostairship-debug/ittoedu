// @vitest-environment node
import { componentSurfaces } from '../../src/shared/contracts/component-platform/project'
import { expect, it } from 'vitest'
import sharp from 'sharp'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { executeViewObserveTool } from '../../src/core/tools/ViewObserveTools'
import { ObservationImageStore } from '../../src/main/workbench/observation/ObservationImageStore'
import { ViewObservationService } from '../../src/main/workbench/observation/ViewObservationService'
import type { ObservationResult } from '../../src/shared/workbench/toolPorts'
import type { ViewObservationSnapshot } from '../../src/shared/workbench/viewObservation'

it('crops actual PNG pixels in viewport CSS coordinates, preserves the original and leaves action coordinates unchanged', async () => {
  const project = createBlankCourseProjectV10('局部观察')
  const locationId = componentSurfaces(project)[0]!.id
  const identity = { documentId: 'document', epoch: 'epoch', revision: 0, locationId }
  const snapshot: ViewObservationSnapshot = { ...identity, model: { kind: 'course-v10', project, resources: { assets: {}, components: {} } },
    binding: { kind: 'untitled', suggestedName: 'clip.glx' }, dirty: true, saving: false, recoverable: true, undoDepth: 0, redoDepth: 0 }
  const source = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#234567' } }).png().toBuffer()
  const images = new ObservationImageStore()
  const image = await images.put('run', source, 200, 100)
  const originalRect = { x: 25, y: 10, width: 10, height: 12 }
  const full: ObservationResult = { source: 'isolated-published', identity: { ...identity, viewGeneration: 'host' }, generation: 2,
    coverage: { width: 200, height: 100, viewport: { width: 100, height: 50 } }, structure: ['反馈42'], diagnostics: [], image,
    elements: [{ handle: 'inside', tag: 'button', role: '', label: '继续', text: '继续', editable: false, rect: originalRect },
      { handle: 'outside', tag: 'button', role: '', label: '其他', text: '其他', editable: false, rect: { x: 80, y: 30, width: 10, height: 10 } }] }
  const service = new ViewObservationService({ images, snapshot: async () => snapshot, observeInteractive: async () => full,
    captureIsolated: async () => { throw new Error('Must reuse the interactive capture') } })
  const clip = { x: 20, y: 5, width: 30, height: 20 }
  try {
    const result = await executeViewObserveTool(service, { runId: 'run', operationId: 'observe',
      resolveTarget: async () => ({ ...identity, projectId: project.id }) }, { target: 'page', clip })
    expect(result.kind).toBe('read')
    if (result.kind !== 'read') throw new Error('Expected clipped observation')
    const observation = result.data as ObservationResult
    const retained = (result.data as ObservationResult & { fullObservation: ObservationResult & { imageDataUrl: string } }).fullObservation
    expect(retained.elements).toHaveLength(2)
    expect(retained.imageDataUrl).toBe(`data:image/png;base64,${Buffer.from(source).toString('base64')}`)
    expect(observation.coverage).toEqual({ width: 60, height: 40, viewport: { width: 100, height: 50 },
      clip, scale: { x: 2, y: 2 }, coordinateSpace: 'preview-viewport-css-pixels' })
    expect(observation.originalImage).toEqual(image)
    expect(observation.elements).toHaveLength(1)
    expect(observation.elements![0]).toMatchObject({ handle: 'inside', rect: originalRect })
    const cropped = await service.readResource({ runId: 'run', resourceId: observation.image.resourceId })
    expect(await sharp(cropped.bytes).metadata()).toMatchObject({ format: 'png', width: 60, height: 40 })
    expect(await sharp(cropped.bytes).raw().toBuffer().then(pixels => [...pixels.subarray(0, 3)])).toEqual([35, 69, 103])
    const original = await service.readResource({ runId: 'run', resourceId: observation.originalImage!.resourceId })
    expect(await sharp(original.bytes).metadata()).toMatchObject({ width: 200, height: 100 })
    expect(full.elements![0]!.rect).toBe(originalRect)
    await expect(service.observe({ runId: 'run', requestId: 'offscreen', ...identity, projectId: project.id,
      clip: { x: 200, y: 200, width: 10, height: 10 } })).rejects.toThrow('当前viewport')
  } finally { await service.stopRun('run') }
})
