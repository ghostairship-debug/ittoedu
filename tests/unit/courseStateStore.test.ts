import { describe, expect, it } from 'vitest'
import { CourseStateStore } from '@/player/CourseStateStore'

describe('CourseStateStore', () => {
  it('advances the host observation version only after actual successful writes', () => {
    const store = new CourseStateStore()
    expect(store.version).toBe(0)
    store.get('missing'); store.snapshot(); store.delete('missing'); store.clear(); store.setMany([])
    expect(store.version).toBe(0)
    store.set('answer', 1)
    expect(store.version).toBe(1)
    expect(() => store.set('answer', () => undefined)).toThrow()
    expect(() => store.setMany([{ key: 'same', value: 1 }, { key: 'same', value: 2 }])).toThrow()
    expect(store.version).toBe(1)
    store.setMany([{ key: 'answer', value: 2 }, { key: 'progress', value: 3 }])
    expect(store.version).toBe(2)
    store.delete('answer'); store.clear()
    expect(store.version).toBe(4)
  })
  it('set、get 和 snapshot 都不会泄露可变引用', () => {
    const store = new CourseStateStore()
    const input = {
      score: 10,
      progress: [1, 2],
      nested: { completed: false },
    }

    store.set('lesson', input)
    input.progress.push(3)
    input.nested.completed = true

    const first = store.get<typeof input>('lesson')!
    expect(first).toEqual({
      score: 10,
      progress: [1, 2],
      nested: { completed: false },
    })

    first.progress.push(4)
    first.nested.completed = true
    expect(store.get('lesson')).toEqual({
      score: 10,
      progress: [1, 2],
      nested: { completed: false },
    })

    const snapshot = store.snapshot() as { lesson: typeof input }
    snapshot.lesson.progress.push(5)
    expect(store.get('lesson')).toEqual({
      score: 10,
      progress: [1, 2],
      nested: { completed: false },
    })
  })

  it('接受基本值、普通对象、数组和非循环共享引用', () => {
    const store = new CourseStateStore()
    const shared = { value: 1 }
    store.set('data', {
      empty: null,
      missing: undefined,
      bigint: 12n,
      first: shared,
      second: shared,
    })

    const data = store.get<{
      bigint: bigint
      first: { value: number }
      second: { value: number }
    }>('data')!
    expect(data.bigint).toBe(12n)
    expect(data.first).toBe(data.second)
  })

  it.each([
    ['函数', () => undefined],
    ['Symbol', Symbol('state')],
    ['Date', new Date()],
    ['Map', new Map([['score', 1]])],
    ['DOM 节点', document.createElement('div')],
  ])('拒绝非纯数据：%s', (_label, value) => {
    const store = new CourseStateStore()
    expect(() => store.set('invalid', value)).toThrow('可结构化克隆纯数据')
  })

  it('拒绝循环引用，且失败写入不会覆盖旧状态', () => {
    const store = new CourseStateStore()
    store.set('progress', { step: 1 })

    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => store.set('progress', cyclic)).toThrow('循环引用')
    expect(store.get('progress')).toEqual({ step: 1 })
  })

  it('支持 delete 和 clear，缺失键返回 undefined', () => {
    const store = new CourseStateStore()
    store.set('one', 1)
    store.set('two', 2)
    store.delete('one')
    expect(store.get('one')).toBeUndefined()
    expect(store.snapshot()).toEqual({ two: 2 })

    store.clear()
    expect(store.get('two')).toBeUndefined()
    expect(store.snapshot()).toEqual({})
  })
})
