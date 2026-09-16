import { buildPublishedFixture as buildPublishedCourseV2Payload } from '../fixtures/teacherController'
import { afterEach, describe, expect, it } from 'vitest'
import { CourseStateStore } from '@/player/CourseStateStore'
import { FlowSurfaceHost } from '@/player/surfaces/flow/FlowSurfaceHost'
import { createPublishedCourseSession } from '@/player/surfaces/publishedDynamicHosts'
import { createBlankFlowCourseProject } from '@/renderer/project/createFlowCourseProject'


afterEach(() => document.body.replaceChildren())

function fixture() {
  const project = createBlankFlowCourseProject()
  const surface = project.surfaces[0]!
  if (surface.type !== 'flow') throw new Error('Flow fixture required')
  surface.blocks.push({ id: 'observation-second', type: 'paragraph', content: { inlines: [{ type: 'text', text: '第二个真实位置' }] } })
  project.locations.push({ id: 'location-observation-second', kind: 'flow-block', surfaceId: surface.id,
    blockId: 'observation-second', label: '第二个位置' })
  return { project, payload: buildPublishedCourseV2Payload({ project, assetFiles: {}, components: {} }) }
}

describe('observation identities from actual host instances', () => {
  it('reads Flow mount, state writes, navigation and suspend without changing the host', async () => {
    const { payload } = fixture(), courseState = new CourseStateStore()
    const host = new FlowSurfaceHost(payload, { courseState })
    const root = document.createElement('div'); document.body.append(root)
    expect(host.readObservationState().ready).toBe(false)
    await host.mount(root); await host.activate()
    try {
      const initial = host.readObservationState()
      expect(initial.ready).toBe(true)
      courseState.set('answer', '保持当前进度')
      const changed = host.readObservationState()
      expect(changed.stateVersion).toBeGreaterThan(initial.stateVersion)
      expect(changed.publicState).toEqual({ courseState: { answer: '保持当前进度' } })
      expect(host.readObservationState()).toEqual(changed)
      await host.setLocationId('location-observation-second')
      expect(host.readObservationState().locationId).toBe('location-observation-second')
      expect(host.readObservationState().stateVersion).toBeGreaterThan(changed.stateVersion)
      await host.suspend()
      expect(host.readObservationState().ready).toBe(false)
    } finally { await host.destroy() }
    expect(host.readObservationState().ready).toBe(false)
  })

  it('reads Published session navigation identity and retires it with the actual session', async () => {
    const { payload } = fixture(), session = createPublishedCourseSession(payload)
    const root = document.createElement('div'); document.body.append(root)
    expect(session.readObservationState().ready).toBe(false)
    await session.mount(root)
    try {
      const initial = session.readObservationState()
      expect(initial.ready).toBe(true)
      await session.goToLocation('location-observation-second')
      const changed = session.readObservationState()
      expect(changed.locationId).toBe('location-observation-second')
      expect(changed.stateVersion).toBeGreaterThan(initial.stateVersion)
      expect(changed.publicState.courseState).toEqual({})
    } finally { await session.destroy() }
    expect(session.readObservationState().ready).toBe(false)
  })
})
