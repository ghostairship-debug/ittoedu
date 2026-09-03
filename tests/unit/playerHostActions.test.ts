import { describe, expect, it, vi } from 'vitest'
import { CoursePlayer } from '@/player/surfaces/CoursePlayer'
import {
  MixedCourseNavigator,
  type MixedCourseDefinition,
} from '@/player/surfaces/mixed/MixedCourseNavigator'
import type {
  SurfaceCapture,
  SurfaceHost,
  SurfaceKind,
  SurfacePlayerServices,
} from '@/player/surfaces/SurfaceHost'
import { createPlayerComponentHostActions } from '@/player/componentHostActions'

describe('component host actions', () => {
  it('forwards the stable action contract without exposing a renderer scene', () => {
    const target = {
      goToSceneById: vi.fn(() => true),
      nextScene: vi.fn(() => true),
      previousScene: vi.fn(() => false),
      replayScene: vi.fn(() => true),
      restartCourse: vi.fn(() => true),
    }
    const actions = createPlayerComponentHostActions(target)

    expect(actions.goToScene('scene-detail')).toBe(true)
    expect(actions.goToScene('scene-detail', 'state-expanded')).toBe(true)
    expect(actions.nextScene()).toBe(true)
    expect(actions.previousScene()).toBe(false)
    expect(actions.replayScene()).toBe(true)
    expect(actions.restartCourse()).toBe(true)
    expect(target.goToSceneById).toHaveBeenNthCalledWith(
      1,
      'scene-detail',
      undefined,
    )
    expect(target.goToSceneById).toHaveBeenNthCalledWith(
      2,
      'scene-detail',
      'state-expanded',
    )
    expect(Object.isFrozen(actions)).toBe(true)
    expect(actions).not.toHaveProperty('playerScene')
  })
})

const services: SurfacePlayerServices = {
  navigate: vi.fn(),
  getCourseState: vi.fn(),
  setCourseState: vi.fn(),
  resolveAsset: (assetId) => `asset://${assetId}`,
}

class RecordingHost implements SurfaceHost {
  readonly calls: string[] = []
  locationId: string | null = null

  constructor(
    readonly id: string,
    readonly kind: SurfaceKind = 'slide',
  ) {}

  mount(): void { this.calls.push('mount') }
  activate(): void { this.calls.push('activate') }
  suspend(): void { this.calls.push('suspend') }
  resume(): void { this.calls.push('resume') }
  reset(scope: 'surface' | 'course'): void { this.calls.push(`reset:${scope}`) }
  capture(): SurfaceCapture {
    this.calls.push('capture')
    return { format: 'json', content: '{}' }
  }
  destroy(): void { this.calls.push('destroy') }
  setLocationId(locationId: string): void {
    this.calls.push(`setLocationId:${locationId}`)
    this.locationId = locationId
  }
  getLocationId(): string | null {
    return this.locationId
  }
}

const mixedCourse: MixedCourseDefinition = {
  id: 'course-mixed',
  title: '混合课',
  startLocationId: 'slide-home',
  locations: [
    { id: 'slide-home', surfaceId: 'surface-slide', kind: 'slide', label: '导入' },
    { id: 'slide-two', surfaceId: 'surface-slide', kind: 'slide', label: '第二页' },
    { id: 'flow-page', surfaceId: 'surface-flow', kind: 'flow', label: '讲义' },
  ],
}

describe('CoursePlayer host session actions', () => {
  it('releases the previous surface session before activating the next host', async () => {
    const slide = new RecordingHost('surface-slide', 'slide')
    const flow = new RecordingHost('surface-flow', 'flow')
    const player = new CoursePlayer([slide, flow], { services })
    await player.mountSurface('surface-slide', document.createElement('div'))
    await player.mountSurface('surface-flow', document.createElement('div'))
    expect(await player.activateSurface('surface-slide')).toEqual({ ok: true })
    expect(await player.activateSurface('surface-flow')).toEqual({ ok: true })
    expect(slide.calls).toEqual(['mount', 'activate', 'suspend'])
    expect(flow.calls).toEqual(['mount', 'activate'])
    expect(player.activeSurfaceId).toBe('surface-flow')
    expect(player.statusOf('surface-slide')).toBe('suspended')
  })

  it('does not release the host when Mixed next stays on the same surface', async () => {
    const slide = new RecordingHost('surface-slide', 'slide')
    const flow = new RecordingHost('surface-flow', 'flow')
    const player = new CoursePlayer([slide, flow], { services })
    const navigator = new MixedCourseNavigator(mixedCourse, player)
    await player.mountSurface('surface-slide', document.createElement('div'))
    await player.mountSurface('surface-flow', document.createElement('div'))
    await navigator.start()
    expect(slide.calls).toEqual(['mount', 'activate', 'setLocationId:slide-home'])

    expect(await navigator.next()).toMatchObject({ locationId: 'slide-two', index: 1 })
    expect(slide.calls).toEqual([
      'mount',
      'activate',
      'setLocationId:slide-home',
      'setLocationId:slide-two',
    ])
    expect(flow.calls).toEqual(['mount'])

    expect(await navigator.next()).toMatchObject({ locationId: 'flow-page', index: 2, previousSurfaceId: 'surface-slide' })
    expect(slide.calls).toEqual([
      'mount',
      'activate',
      'setLocationId:slide-home',
      'setLocationId:slide-two',
      'suspend',
    ])
    expect(flow.calls).toEqual(['mount', 'activate', 'setLocationId:flow-page'])
  })

  it('destroys every host and does not leave an active session', async () => {
    const slide = new RecordingHost('surface-slide', 'slide')
    const flow = new RecordingHost('surface-flow', 'flow')
    const player = new CoursePlayer([slide, flow], { services })
    await player.mountSurface('surface-slide', document.createElement('div'))
    await player.mountSurface('surface-flow', document.createElement('div'))
    await player.activateSurface('surface-slide')
    const results = await player.destroy()
    expect(results.map((result) => result.ok)).toEqual([true, true])
    expect(slide.calls).toContain('destroy')
    expect(flow.calls).toContain('destroy')
    expect(player.activeSurfaceId).toBeNull()
    expect(player.listSurfaces().map((surface) => surface.status)).toEqual(['destroyed', 'destroyed'])
  })

  it('joins a second destroy onto the in-flight cleanup', async () => {
    const slide = new RecordingHost('surface-slide', 'slide')
    const player = new CoursePlayer([slide], { services })
    await player.mountSurface('surface-slide', document.createElement('div'))
    const first = player.destroy()
    const second = player.destroy()
    const [firstResults, secondResults] = await Promise.all([first, second])
    expect(firstResults.map((result) => result.ok)).toEqual([true])
    expect(secondResults).toBe(firstResults)
    expect(slide.calls.filter((call) => call === 'destroy')).toEqual(['destroy'])
  })
})

describe('MixedCourseNavigator location queue', () => {
  class SlowHost extends RecordingHost {
    async activate(): Promise<void> {
      this.calls.push('activate:enter')
      await new Promise((resolve) => setTimeout(resolve, 20))
      this.calls.push('activate')
    }
  }

  it('does not re-activate when already at the requested location', async () => {
    const slide = new RecordingHost('surface-slide', 'slide')
    const flow = new RecordingHost('surface-flow', 'flow')
    const player = new CoursePlayer([slide, flow], { services })
    const navigator = new MixedCourseNavigator(mixedCourse, player)
    await player.mountSurface('surface-slide', document.createElement('div'))
    await player.mountSurface('surface-flow', document.createElement('div'))
    await navigator.start()
    const calls = slide.calls.slice()
    await navigator.goToLocation('slide-home')
    expect(slide.calls).toEqual(calls)
    expect(navigator.current?.locationId).toBe('slide-home')
  })

  it('serializes overlapping jumps so the last requested location wins', async () => {
    const slide = new SlowHost('surface-slide', 'slide')
    const flow = new SlowHost('surface-flow', 'flow')
    const player = new CoursePlayer([slide, flow], { services })
    const navigator = new MixedCourseNavigator(mixedCourse, player)
    await player.mountSurface('surface-slide', document.createElement('div'))
    await player.mountSurface('surface-flow', document.createElement('div'))
    await navigator.start()
    const first = navigator.goToLocation('flow-page')
    const second = navigator.goToLocation('slide-two')
    await Promise.all([first, second])
    expect(navigator.current?.locationId).toBe('slide-two')
    expect(player.activeSurfaceId).toBe('surface-slide')
    expect(player.statusOf('surface-flow')).toBe('suspended')
    expect(player.statusOf('surface-slide')).toBe('active')
  })
})
