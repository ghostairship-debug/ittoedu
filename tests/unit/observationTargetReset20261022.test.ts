import { expect, it, vi } from 'vitest'
import { createTestPublishedFromLegacy } from '../helpers/glxWorkFixture'

type OutputTarget = { surfaceId: string; instanceId?: string; spatialFrameId?: string; staticExport?: true }
const observed = vi.hoisted(() => ({ order: [] as string[], mounts: vi.fn(), prepare: vi.fn(async (_input: OutputTarget) => ({ x: 0, y: 0, width: 320, height: 180 })) }))
vi.mock('../../src/shared/fonts/installBundledFontFaces', () => ({ installBundledFontFaces: vi.fn() }))
vi.mock('../../src/shared/fonts/installedBundledFontFaceCss', () => ({ installedBundledFontFaceCss: () => '' }))
vi.mock('../../src/player/componentPlatform/outputCapture', () => ({ prepareComponentOutputRegion: observed.prepare }))
vi.mock('../../src/player/componentPlatform/publishedPlayer', () => ({
  mountPublishedCourseV3: observed.mounts.mockImplementation(async (_payload, _root, options) => {
    const location = options.initialSurfaceId
    observed.order.push(`mount:${location}`)
    return { navigation: { read: () => ({ locationId: location }), currentStateId: () => options.initialStateId },
      dispose: async () => { observed.order.push(`dispose:${location}`) } }
  }),
}))
import { renderObservationSnapshot } from '../../src/renderer/authoring/generation/observationWorker'

it('disposes the previous noninteractive Player before remounting each requested output target', async () => {
  const published = createTestPublishedFromLegacy({ schemaVersion: 3, id: 'reset-course', title: 'Reset', definitions: {}, instances: {}, assets: {},
    surfaces: [{ id: 'first', kind: 'slide', title: 'First', childIds: [], designSize: { width: 320, height: 180 } },
      { id: 'second', kind: 'spatial', title: 'Second', childIds: [], designSize: { width: 640, height: 360 } }], global: { underlay: [], overlay: [] } })
  await renderObservationSnapshot({ published, locationId: 'first', instanceId: 'local-object', staticExport: true })
  const oldRoot = document.getElementById('observation-root')!
  oldRoot.append(document.createElement('aside'))
  await renderObservationSnapshot({ published, locationId: 'second', stateId: 'named-state', spatialFrameId: 'camera', staticExport: true })
  expect(observed.order).toEqual(['mount:first', 'dispose:first', 'mount:second'])
  expect(oldRoot.isConnected).toBe(false)
  expect(document.getElementById('observation-root')!.style.width).toBe('640px')
  expect(observed.mounts.mock.calls.map(([, , options]) => [options.initialSurfaceId, options.initialStateId, options.capture])).toEqual([
    ['first', null, true], ['second', 'named-state', true],
  ])
  expect(observed.prepare.mock.calls.map(([input]) => [input.surfaceId, input.instanceId, input.spatialFrameId, input.staticExport])).toEqual([
    ['first', 'local-object', undefined, true], ['second', undefined, 'camera', true],
  ])
})
