// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { expect, it, vi } from 'vitest'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { discoverDynamicContentTargets } from '../../src/core/tools/DynamicContentEditPlanner'
import { prepareDynamicContentFallbackCapture } from '../../src/main/workbench/observation/DynamicContentFallbackCaptureService'
import { capturePublishedCourseV2Stage } from '../../src/renderer/export/playerCapture'
import { renderDynamicFallbackCandidate } from '../../src/renderer/authoring/generation/dynamicFallbackWorker'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'

vi.mock('../../src/renderer/export/playerCapture', () => ({ capturePublishedCourseV2Stage: vi.fn()
  .mockResolvedValue('data:image/png;base64,AA==') }))
vi.mock('../../src/shared/fonts/installBundledFontFaces', () => ({ installBundledFontFaces: vi.fn() }))
vi.mock('../../src/shared/fonts/ensureBundledFonts', () => ({ ensureBundledFonts: vi.fn().mockResolvedValue(undefined) }))

it('M27-T03 worker sends the candidate to Published capture for the exact location and layer', async () => {
  const driver = new CourseV9Driver()
  const model = driver.load(new Uint8Array(readFileSync('tests/fixtures/course-project-v9/surface-runtime.h5lesson')))
  if (model.kind !== 'course-v9') throw new Error('Runtime fixture missing')
  const snapshot: DocumentSnapshot = { documentId: 'worker-runtime', epoch: 'worker-epoch', revision: model.project.revision,
    binding: { kind: 'untitled', suggestedName: 'runtime.h5lesson' }, model, dirty: false, saving: false,
    recoverable: true, undoDepth: 0, redoDepth: 0 }
  const target = discoverDynamicContentTargets(snapshot, { target: { kind: 'course-object',
    locationId: 'location-scene-1', itemId: 'slide-surface-runtime' } }).find(value => value.field.kind === 'runtime.value')
  if (!target) throw new Error('Runtime target missing')
  const request = prepareDynamicContentFallbackCapture({ target, candidate: model })
  const result = await renderDynamicFallbackCandidate(request)
  expect(result).toMatchObject({ projectId: model.project.id, revision: model.project.revision,
    locationId: target.locationId, surfaceId: target.surfaceId, itemId: target.itemId,
    dataUrl: 'data:image/png;base64,AA==' })
  expect(vi.mocked(capturePublishedCourseV2Stage)).toHaveBeenCalledWith(expect.objectContaining({
    locationId: target.locationId, surfaceId: target.surfaceId, layerItemId: target.itemId,
    includeGlobalLayerItems: true,
  }))
  await expect(renderDynamicFallbackCandidate({ ...request, itemId: 'wrong-item' })).rejects.toThrow(/身份/)
  expect(vi.mocked(capturePublishedCourseV2Stage)).toHaveBeenCalledTimes(1)
})
