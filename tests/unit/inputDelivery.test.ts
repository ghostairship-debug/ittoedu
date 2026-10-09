import { describe, expect, it, vi } from 'vitest'
import { buildInputRuleFamily } from '../../src/core/tools/inputRuleFamily'
import { CourseStateStore } from '../../src/player/CourseStateStore'
import { PublishedInteractionController } from '../../src/player/interactions/PublishedInteractionController'

describe('input atomic submission', () => {
  it('rejects an invalid or duplicate entry before any state or notification changes', () => {
    const changes = vi.fn()
    const store = new CourseStateStore(changes)
    store.set('value', 1)
    changes.mockClear()
    expect(() => store.setMany([{ key: 'value', value: 2 }, { key: 'bad', value: () => 3 }])).toThrow()
    expect(() => store.setMany([{ key: 'value', value: 2 }, { key: 'value', value: 3 }])).toThrow()
    expect(store.snapshot()).toEqual({ value: 1 })
    expect(changes).not.toHaveBeenCalled()
  })
  it('normalizes text and numeric submissions, atomically chooses one feedback branch, and unbinds on destruction', async () => {
    const cases = [
    ['text', ' ＡＮＳＷＥＲ  ', true, 'answer', 'correct'], ['text', 'wrong', true, 'wrong', 'error'],
    ['text', '  ', false, '', 'error'], ['number', '１.５', true, 1.5, 'correct'],
    ['number', '1e0', true, 1, 'correct'], ['number', '0', true, 0, 'error'],
    ['number', '3', true, 3, 'error'], ['number', '0x10', false, 0, 'error'],
    ['number', '1,000', false, 0, 'error'], ['number', '', false, 0, 'error'],
    ['number', 'Infinity', false, 0, 'error'], ['number', '12x', false, 0, 'error'],
    ] as const
    for (const [answerType, raw, valid, value, feedback] of cases) {
    const changes = vi.fn()
    const store = new CourseStateStore(changes)
    store.setMany([{ key: 'value', value: answerType === 'text' ? 'old' : 99 }, { key: 'valid', value: true }])
    changes.mockClear()
    let submit: ((raw: string) => void) | undefined
    let sequence = 0
    const actions = { correct: [{ type: 'course-state.set' as const, key: 'feedback', value: 'correct' }], error: [{ type: 'course-state.set' as const, key: 'feedback', value: 'error' }] }
    const rules = buildInputRuleFamily('input', { stateKey: 'value', validityKey: 'valid' }, answerType === 'text'
      ? { answerType, answers: ['answer'], ...actions } : { answerType, min: 1, max: 2, ...actions }, () => String(++sequence))
    const controller = new PublishedInteractionController({ surfaceId: 'surface', rules,
      surface: { bindNodeClick: () => null, executeNodeMotion: () => true,
        describeInput: () => ({ answerType, stateKey: 'value', validityKey: 'valid', defaultValue: answerType === 'text' ? '' : 0 }),
        bindInputSubmit: (_id, listener) => { submit = listener; return () => { submit = undefined } },
      },
      session: { courseState: store, setCourseStateBatch: entries => store.setMany(entries), currentSceneId: () => 'scene',
        goToScene: () => false, nextScene: () => false, previousScene: () => false, replayScene: () => false, restartCourse: () => false },
    })
    submit!(raw)
    await vi.waitFor(() => expect(store.get('feedback')).toBe(feedback))
    expect(store.get('value')).toBe(value)
    expect(store.get('valid')).toBe(valid)
    expect(changes.mock.calls.filter(([change]) => change.type === 'batch')).toHaveLength(1)
    expect(changes.mock.calls.filter(([change]) => change.key === 'feedback')).toHaveLength(1)
    controller.destroy()
    expect(submit).toBeUndefined()
    }
  })
})
