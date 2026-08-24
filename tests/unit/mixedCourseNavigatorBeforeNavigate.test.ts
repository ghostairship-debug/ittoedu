import { describe, expect, it } from 'vitest'
import {
  MixedCourseNavigator,
  type MixedCourseDefinition,
  type MixedCoursePlayerPort,
  type MixedNavigationTransition,
} from '@/player/surfaces/mixed/MixedCourseNavigator'
import type { SurfaceOperationResult } from '@/player/surfaces/SurfaceHost'

const course: MixedCourseDefinition = {
  id: 'course-mixed',
  title: 'Mixed course',
  startLocationId: 'slide-home',
  locations: [
    { id: 'slide-home', surfaceId: 'surface-slide', kind: 'slide', label: 'Home' },
    { id: 'slide-two', surfaceId: 'surface-slide', kind: 'slide', label: 'Second slide' },
    { id: 'flow-page', surfaceId: 'surface-flow', kind: 'flow', label: 'Flow page' },
  ],
}

class RecordingPlayer implements MixedCoursePlayerPort {
  activeSurfaceId: string | null = null
  readonly calls: string[] = []

  async activateSurface(surfaceId: string): Promise<SurfaceOperationResult> {
    this.calls.push(`activate:${surfaceId}`)
    this.activeSurfaceId = surfaceId
    return { ok: true }
  }

  async releaseSurfaceSession(surfaceId: string): Promise<SurfaceOperationResult> {
    this.calls.push(`release:${surfaceId}`)
    return { ok: true }
  }

  async setSurfaceLocation(surfaceId: string, locationId: string): Promise<SurfaceOperationResult> {
    this.calls.push(`set:${surfaceId}:${locationId}`)
    return { ok: true }
  }

  async resetSurface(surfaceId: string, scope: 'surface' | 'course' = 'surface'): Promise<SurfaceOperationResult> {
    this.calls.push(`resetSurface:${surfaceId}:${scope}`)
    return { ok: true }
  }

  async resetCourse(): Promise<readonly SurfaceOperationResult[]> {
    this.calls.push('resetCourse')
    return [{ ok: true }]
  }
}

describe('MixedCourseNavigator onBeforeNavigate', () => {
  it('runs once before the first start mutates the player', async () => {
    const player = new RecordingPlayer()
    const transitions: MixedNavigationTransition[] = []
    const navigator = new MixedCourseNavigator(course, player, {
      onBeforeNavigate: (transition) => {
        player.calls.push('before')
        transitions.push(transition)
      },
    })

    await navigator.start()

    expect(player.calls).toEqual([
      'before',
      'activate:surface-slide',
      'set:surface-slide:slide-home',
    ])
    expect(transitions).toEqual([{
      current: null,
      next: {
        locationId: 'slide-home',
        surfaceId: 'surface-slide',
        kind: 'slide',
        index: 0,
        total: 3,
      },
      forced: false,
    }])
  })

  it('skips same-location no-ops but reports a forced replay exactly once', async () => {
    const player = new RecordingPlayer()
    const transitions: MixedNavigationTransition[] = []
    const navigator = new MixedCourseNavigator(course, player, {
      onBeforeNavigate: (transition) => {
        player.calls.push('before')
        transitions.push(transition)
      },
    })
    await navigator.start()
    player.calls.length = 0
    transitions.length = 0

    await navigator.goToLocation('slide-home')
    expect(player.calls).toEqual([])
    expect(transitions).toEqual([])

    await navigator.goToLocation('slide-home', { force: true })
    expect(player.calls).toEqual([
      'before',
      'activate:surface-slide',
      'set:surface-slide:slide-home',
    ])
    expect(transitions).toHaveLength(1)
    expect(transitions[0]).toMatchObject({
      current: { locationId: 'slide-home', surfaceId: 'surface-slide' },
      next: { locationId: 'slide-home', surfaceId: 'surface-slide' },
      forced: true,
    })
  })

  it('runs before release on a cross-surface transition', async () => {
    const player = new RecordingPlayer()
    const transitions: MixedNavigationTransition[] = []
    const navigator = new MixedCourseNavigator(course, player, {
      onBeforeNavigate: (transition) => {
        player.calls.push('before')
        transitions.push(transition)
      },
    })
    await navigator.start()
    player.calls.length = 0
    transitions.length = 0

    await navigator.goToLocation('flow-page')

    expect(player.calls).toEqual([
      'before',
      'release:surface-slide',
      'activate:surface-flow',
      'set:surface-flow:flow-page',
    ])
    expect(transitions[0]).toMatchObject({
      current: { locationId: 'slide-home', surfaceId: 'surface-slide', kind: 'slide' },
      next: { locationId: 'flow-page', surfaceId: 'surface-flow', kind: 'flow' },
      forced: false,
    })
  })

  it('leaves player, current location, and back history untouched when rejected', async () => {
    const player = new RecordingPlayer()
    const rejection = new Error('teardown rejected')
    let reject = false
    const navigator = new MixedCourseNavigator(course, player, {
      onBeforeNavigate: () => {
        player.calls.push('before')
        if (reject) throw rejection
      },
    })
    await navigator.start()
    await navigator.goToLocation('slide-two')
    expect(navigator.canGoBack).toBe(true)
    player.calls.length = 0
    reject = true

    await expect(navigator.back()).rejects.toBe(rejection)

    expect(player.calls).toEqual(['before'])
    expect(navigator.current?.locationId).toBe('slide-two')
    expect(navigator.canGoBack).toBe(true)

    reject = false
    await navigator.back()
    expect(navigator.current?.locationId).toBe('slide-home')
    expect(navigator.canGoBack).toBe(false)
  })

  it('tears down once before resetCurrentSurface and suppresses duplicate notification', async () => {
    const player = new RecordingPlayer()
    const transitions: MixedNavigationTransition[] = []
    const navigator = new MixedCourseNavigator(course, player, {
      onBeforeNavigate: (transition) => {
        player.calls.push('before')
        transitions.push(transition)
      },
    })
    await navigator.start()
    await navigator.goToLocation('slide-two')
    player.calls.length = 0
    transitions.length = 0

    await navigator.resetCurrentSurface()

    expect(player.calls).toEqual([
      'before',
      'resetSurface:surface-slide:surface',
      'activate:surface-slide',
      'set:surface-slide:slide-home',
    ])
    expect(transitions).toHaveLength(1)
    expect(transitions[0]).toMatchObject({
      current: { locationId: 'slide-two', surfaceId: 'surface-slide' },
      next: { locationId: 'slide-home', surfaceId: 'surface-slide' },
      forced: true,
    })
  })

  it('tears down once before resetCourse and suppresses duplicate start notification', async () => {
    const player = new RecordingPlayer()
    const transitions: MixedNavigationTransition[] = []
    const navigator = new MixedCourseNavigator(course, player, {
      onBeforeNavigate: (transition) => {
        player.calls.push('before')
        transitions.push(transition)
      },
    })
    await navigator.start()
    await navigator.goToLocation('flow-page')
    player.calls.length = 0
    transitions.length = 0

    await navigator.resetCourse()

    expect(player.calls).toEqual([
      'before',
      'resetCourse',
      'activate:surface-slide',
      'set:surface-slide:slide-home',
    ])
    expect(transitions).toHaveLength(1)
    expect(transitions[0]).toMatchObject({
      current: { locationId: 'flow-page', surfaceId: 'surface-flow' },
      next: { locationId: 'slide-home', surfaceId: 'surface-slide' },
      forced: true,
    })
  })

  it('rejects an aborted queued request before its navigation lifecycle begins', async () => {
    const player = new RecordingPlayer()
    let holdNext = false
    let enterHeldTransition!: () => void
    let releaseHeldTransition!: () => void
    const heldTransitionEntered = new Promise<void>((resolve) => {
      enterHeldTransition = resolve
    })
    const heldTransition = new Promise<void>((resolve) => {
      releaseHeldTransition = resolve
    })
    const navigator = new MixedCourseNavigator(course, player, {
      onBeforeNavigate: async () => {
        player.calls.push('before')
        if (!holdNext) return
        enterHeldTransition()
        await heldTransition
      },
    })
    await navigator.start()
    player.calls.length = 0
    holdNext = true

    const first = navigator.goToLocation('slide-two')
    await heldTransitionEntered
    const controller = new AbortController()
    const stale = navigator.goToLocation('flow-page', { signal: controller.signal })
    controller.abort()
    releaseHeldTransition()

    await first
    await expect(stale).rejects.toMatchObject({ name: 'AbortError' })
    expect(player.calls).toEqual([
      'before',
      'activate:surface-slide',
      'set:surface-slide:slide-two',
    ])
    expect(navigator.current?.locationId).toBe('slide-two')
  })
})
