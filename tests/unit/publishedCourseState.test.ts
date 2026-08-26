import { describe, expect, it, vi } from 'vitest'
import { CourseStateStore } from '../../src/player/CourseStateStore'
import {
  findPublishedNavigationBlock,
  PublishedCarrierSideEffectGate,
  resetPublishedCourseState,
} from '../../src/player/surfaces/publishedCourseState'
import type {
  CourseNavigationGuard,
  CourseStateDeclaration,
} from '../../src/shared/courseProjectTypes'

const declarations: CourseStateDeclaration[] = [
  { key: 'passed', valueType: 'boolean', defaultValue: false },
  { key: 'score', valueType: 'number', defaultValue: 0 },
  { key: 'note', valueType: 'string', defaultValue: '' },
  { key: 'empty', valueType: 'null', defaultValue: null },
]

function guard(
  overrides: Partial<CourseNavigationGuard> = {},
): CourseNavigationGuard {
  return {
    id: 'unlock-advanced',
    effect: 'block',
    toLocationIds: ['advanced'],
    match: 'all',
    conditions: [{
      type: 'compare',
      key: 'passed',
      operator: 'eq',
      value: false,
    }],
    message: '请先完成当前练习。',
    ...overrides,
  }
}

describe('Published course state and navigation guards', () => {
  it('seeds and restores every authored default in the shared store', () => {
    const store = new CourseStateStore()
    resetPublishedCourseState(store, declarations)
    expect(store.snapshot()).toEqual({
      passed: false,
      score: 0,
      note: '',
      empty: null,
    })

    store.set('passed', true)
    store.set('temporary', 1)
    resetPublishedCourseState(store, declarations)
    expect(store.snapshot()).toEqual({
      passed: false,
      score: 0,
      note: '',
      empty: null,
    })
  })

  it('blocks only matching from/to transitions whose conditions match', () => {
    const store = new CourseStateStore()
    resetPublishedCourseState(store, declarations)
    const scoped = guard({ fromLocationIds: ['lesson'] })

    expect(findPublishedNavigationBlock([scoped], store, {
      fromLocationId: 'lesson',
      toLocationId: 'advanced',
    })?.message).toBe('请先完成当前练习。')
    expect(findPublishedNavigationBlock([scoped], store, {
      fromLocationId: 'intro',
      toLocationId: 'advanced',
    })).toBeNull()
    expect(findPublishedNavigationBlock([scoped], store, {
      fromLocationId: 'lesson',
      toLocationId: 'summary',
    })).toBeNull()

    store.set('passed', true)
    expect(findPublishedNavigationBlock([scoped], store, {
      fromLocationId: 'lesson',
      toLocationId: 'advanced',
    })).toBeNull()
  })

  it('supports exists, numeric comparisons, and any matching', () => {
    const store = new CourseStateStore()
    resetPublishedCourseState(store, declarations)
    store.set('score', 3)
    const candidate = guard({
      match: 'any',
      conditions: [
        { type: 'exists', key: 'missing', exists: true },
        { type: 'compare', key: 'score', operator: 'gte', value: 3 },
      ],
    })

    expect(findPublishedNavigationBlock([candidate], store, {
      fromLocationId: null,
      toLocationId: 'advanced',
    })).toBe(candidate)
  })

  it('accepts carrier writes and actions only from the active current generation', () => {
    const store = new CourseStateStore()
    const nextScene = vi.fn(() => true)
    const gate = new PublishedCarrierSideEffectGate({
      courseState: store,
      runtimeActions: {
        goToScene: () => true,
        nextScene,
        previousScene: () => true,
        replayScene: () => true,
        restartCourse: () => true,
      },
    })
    const first = gate.beginGeneration()

    first.courseState?.set('answer', 1)
    expect(first.runtimeActions?.nextScene()).toBe(false)
    expect(store.get('answer')).toBeUndefined()
    expect(nextScene).not.toHaveBeenCalled()

    gate.activate()
    first.courseState?.set('answer', 2)
    expect(first.runtimeActions?.nextScene()).toBe(true)
    expect(store.get('answer')).toBe(2)
    expect(nextScene).toHaveBeenCalledOnce()

    gate.suspend()
    first.courseState?.set('answer', 3)
    expect(first.runtimeActions?.nextScene()).toBe(false)
    expect(store.get('answer')).toBe(2)

    gate.activate()
    const second = gate.beginGeneration()
    first.courseState?.set('answer', 4)
    second.courseState?.set('answer', 5)
    expect(first.runtimeActions?.nextScene()).toBe(false)
    expect(second.runtimeActions?.nextScene()).toBe(true)
    expect(store.get('answer')).toBe(5)

    second.retire()
    second.courseState?.set('answer', 6)
    expect(store.get('answer')).toBe(5)
  })
})
