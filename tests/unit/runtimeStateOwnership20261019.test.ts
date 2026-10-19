import { expect, it, vi } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { ComponentRuntimeWorld } from '../../src/player/components/ComponentRuntimeWorld'
import type { ComponentRuntimeContext, JsonValue } from '../../src/shared/contracts/component-platform'

it('owns committed JSON and isolates native reads, snapshots, and every listener; changing a read requires an explicit set', async () => {
  const project = createBlankCourseProjectV10('state ownership')
  project.definitions.probe = { id: 'probe', role: 'behavior', implementation: { kind: 'builtin', key: 'probe' } }
  project.instances.probe = { id: 'probe', definitionId: 'probe', data: {} }
  project.global.underlay.push('probe')
  let context!: ComponentRuntimeContext
  const world = new ComponentRuntimeWorld('state-ownership', { builtins: new Map([['probe', { mount(value: ComponentRuntimeContext) { context = value; return { update() {}, dispose() {} } } }]]) })
  try {
    await world.sync(project, { assets: {}, components: {} })
    const input = { score: 1, nested: { labels: ['first'] } }, notifications: Array<JsonValue | undefined> = [], events: JsonValue[] = []
    context.scope.state.subscribe('json', value => { (value as typeof input).nested.labels.push('listener mutation') })
    context.scope.state.subscribe('json', value => { notifications.push(value) })
    context.scope.events.subscribe('__runtime.state', event => { ((event as { value: typeof input }).value).score = 500 })
    context.scope.events.subscribe('__runtime.state', event => { events.push(event) })
    context.scope.state.set('json', input)
    input.score = 99; input.nested.labels.push('input mutation')
    expect(world.getState('json')).toEqual({ score: 1, nested: { labels: ['first'] } })
    expect(notifications).toEqual([{ score: 1, nested: { labels: ['first'] } }])
    expect(events).toEqual([{ name: 'json', value: { score: 1, nested: { labels: ['first'] } } }])
    const read = context.scope.state.get('json') as typeof input
    read.score = 2; read.nested.labels.push('explicit edit')
    const snapshot = world.stateSnapshot(); (snapshot.json as typeof input).nested.labels.length = 0
    ;(notifications[0] as typeof input).score = 77
    ;(events[0] as { value: typeof input }).value.score = 88
    expect(world.getState('json')).toEqual({ score: 1, nested: { labels: ['first'] } })
    expect(notifications).toHaveLength(1)
    context.scope.state.set('json', read)
    expect(world.getState('json')).toEqual({ score: 2, nested: { labels: ['first', 'explicit edit'] } })
    expect(notifications).toHaveLength(2)
    expect(project.instances.probe.data).toEqual({})
  } finally { await world.dispose() }
})

it('keeps the scalar fast path free of deep clones and measures explicit large JSON commits without stringify comparisons', async () => {
  const world = new ComponentRuntimeWorld('state-cost', {}), clone = vi.spyOn(globalThis, 'structuredClone')
  try {
    const scalarStart = performance.now()
    let last: JsonValue | undefined
    for (let index = 0; index < 10000; index++) { world.setState('scalar', index); world.setState('scalar', index); last = world.getState('scalar') }
    const scalarMs = performance.now() - scalarStart
    expect(last).toBe(9999)
    expect(clone).not.toHaveBeenCalled()
    const value = { rows: Array.from({ length: 10000 }, (_, id) => ({ id, title: `row ${id}`, values: [1, 2, 3, 4] })) }
    const jsonStart = performance.now()
    for (let index = 0; index < 20; index++) world.setState('json', value)
    const jsonMs = performance.now() - jsonStart
    expect(clone).toHaveBeenCalledTimes(20)
    value.rows[0].title = 'mutated outside'
    expect((world.getState('json') as typeof value).rows[0].title).toBe('row 0')
    console.info('runtime-state-ownership-cost', JSON.stringify({ scalarOperations: 30000, scalarMs, jsonCommits: 20, jsonRows: 10000, jsonMs }))
  } finally { clone.mockRestore(); await world.dispose() }
})
