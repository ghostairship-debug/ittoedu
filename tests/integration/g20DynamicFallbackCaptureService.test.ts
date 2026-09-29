// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { discoverDynamicContentTargets } from '../../src/core/tools/DynamicContentEditPlanner'
import { prepareDynamicContentFallbackCapture } from '../../src/main/workbench/observation/DynamicContentFallbackCaptureService'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'

const driver = new CourseV9Driver()

function snapshot(name: 'surface-runtime' | 'spatial'): DocumentSnapshot {
  const model = driver.load(new Uint8Array(readFileSync(`tests/fixtures/course-project-v9/${name}.h5lesson`)))
  if (model.kind !== 'course-v9') throw new Error('fixture is not V9')
  return { documentId: name, epoch: `epoch-${name}`, revision: model.project.revision,
    binding: { kind: 'untitled', suggestedName: `${name}.h5lesson` }, model,
    dirty: false, saving: false, recoverable: true, undoDepth: 0, redoDepth: 0 }
}

it('M27-T03 packages the exact V9 Runtime candidate and its managed bytes for isolated layer capture', () => {
  const current = snapshot('surface-runtime')
  if (current.model.kind !== 'course-v9') throw new Error('course fixture missing')
  const object = { kind: 'course-object' as const, locationId: 'location-scene-1', itemId: 'slide-surface-runtime' }
  const target = discoverDynamicContentTargets(current, { target: object }).find(value => value.field.kind === 'runtime.value')
  if (!target) throw new Error('Runtime target missing')
  const candidate = structuredClone(current.model)
  const request = prepareDynamicContentFallbackCapture({ target, candidate })
  expect(request).toMatchObject({ projectId: candidate.project.id, revision: current.revision,
    locationId: object.locationId, surfaceId: 'surface-slide', itemId: object.itemId })
  expect(Buffer.from(request.assets['surface-hero'], 'base64')).toEqual(Buffer.from(candidate.resources.assets['surface-hero']))
  expect(Buffer.from(request.assets['surface-fallback'], 'base64')).toEqual(Buffer.from(candidate.resources.assets['surface-fallback']))
  expect(request.project).toEqual(candidate.project)
  expect(() => prepareDynamicContentFallbackCapture({ target: { ...target, itemId: 'wrong-item' }, candidate })).toThrow(/身份/)
  expect(() => prepareDynamicContentFallbackCapture({ target: { ...target, stateId: 'named-state' }, candidate })).toThrow(/命名状态/)
})

it('M27-T03 rejects Spatial layer capture rather than returning a whole-page fallback', () => {
  const current = snapshot('spatial')
  if (current.model.kind !== 'course-v9') throw new Error('spatial fixture missing')
  const location = current.model.project.locations[0]
  const target = discoverDynamicContentTargets(current, { target: { kind: 'course-object',
    locationId: location!.id, itemId: 'global-teacher-controller' }, observed: [{
      kind: 'component.text', source: 'auto', revision: current.revision, locationId: location!.id,
      itemId: 'global-teacher-controller', original: '控制器', text: '控制器',
    }] }).find(value => value.field.kind === 'component.text')
  if (!target) throw new Error('Spatial component target missing')
  expect(() => prepareDynamicContentFallbackCapture({ target, candidate: current.model as Extract<typeof current.model, { kind: 'course-v9' }> }))
    .toThrow(/Spatial.*图层/)
})
