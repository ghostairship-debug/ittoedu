import { describe, it, expect } from 'vitest'
import { TeacherControllerRuntimeSessionStore } from '../../src/player/teacherControllerRuntimeSession'
describe('component controller session', () => {
  it('shares collapse across surfaces but keeps drag offsets in each surface session', () => {
    const store = new TeacherControllerRuntimeSessionStore()
    const slide = { controllerId: 'control', surfaceSessionId: 'slide', defaultCollapsed: true }
    const flow = { ...slide, surfaceSessionId: 'flow' }
    expect(store.get(slide)).toEqual({ collapsed: true, offset: { dx: 0, dy: 0 } })
    store.set(slide, { collapsed: false, offset: { dx: 35, dy: -10 } })
    expect(store.get(flow)).toEqual({ collapsed: false, offset: { dx: 0, dy: 0 } })
    expect(store.get(slide).offset).toEqual({ dx: 35, dy: -10 })
    store.resetSurface('slide')
    expect(store.get(slide)).toEqual({ collapsed: false, offset: { dx: 0, dy: 0 } })
    store.resetCourse()
    expect(store.get(slide).collapsed).toBe(true)
  })
})
