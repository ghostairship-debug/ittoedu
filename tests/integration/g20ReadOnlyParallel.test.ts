// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { isIndependentReadTool, runToolRoundInOrder } from '../../src/main/workbench/execution/ReadOnlyToolScheduler'

type Call = { call: { name: string }; id: string }
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

describe('M30 U2 read-only scheduler', () => {
  it('starts two slow reads together and archives their results in provider order', async () => {
    const first = deferred<string>(), second = deferred<string>()
    const started: string[] = [], archived: string[] = []
    const round = runToolRoundInOrder<Call, string>([
      { id: 'first', call: { name: 'file.read' } }, { id: 'second', call: { name: 'material.find' } },
    ], { execute: async call => { started.push(call.id); return call.id === 'first' ? first.promise : second.promise },
      commit: async (call, outcome) => { archived.push(`${call.id}:${outcome.status === 'fulfilled' ? outcome.value : 'failed'}`) } })
    await Promise.resolve()
    expect(started).toEqual(['first', 'second'])
    second.resolve('B')
    await Promise.resolve()
    expect(archived).toEqual([])
    first.resolve('A')
    await round
    expect(archived).toEqual(['first:A', 'second:B'])
  })

  it('keeps writes, approval-like tools and following reads behind the preceding read batch', async () => {
    const slow = deferred<string>()
    const started: string[] = [], archived: string[] = []
    const round = runToolRoundInOrder<Call, string>([
      { id: 'read-1', call: { name: 'read' } }, { id: 'read-2', call: { name: 'inspect' } },
      { id: 'write', call: { name: 'file.patch' } }, { id: 'read-3', call: { name: 'file.grep' } },
    ], { execute: async call => { started.push(call.id); return call.id === 'read-1' ? slow.promise : call.id },
      commit: async call => { archived.push(call.id) } })
    await Promise.resolve()
    expect(started).toEqual(['read-1', 'read-2'])
    slow.resolve('done')
    await round
    expect(started).toEqual(['read-1', 'read-2', 'write', 'read-3'])
    expect(archived).toEqual(started)
  })

  it('limits active reads to four and cannot promote remote or host-mutating reads', async () => {
    for (const name of ['web.open', 'mcp.resource', 'material.extract', 'material.read', 'context.read',
      'view.observe', 'job.status', 'task.note', 'load_tools', 'file.browse']) expect(isIndependentReadTool(name)).toBe(false)
    const gate = deferred<void>()
    let running = 0, peak = 0
    const calls: Call[] = Array.from({ length: 9 }, (_, index) => ({ id: String(index), call: { name: 'read' } }))
    const round = runToolRoundInOrder(calls, { maxParallel: 100,
      execute: async () => { running++; peak = Math.max(peak, running); await gate.promise; running--; return 'ok' },
      commit: async () => undefined })
    await Promise.resolve()
    expect(peak).toBe(4)
    gate.resolve()
    await round
    expect(peak).toBe(4)
  })

  it('stops before a later write but still archives an in-flight serial tool result', async () => {
    const controller = new AbortController(), gate = deferred<string>(), archived: string[] = []
    const round = runToolRoundInOrder<Call, string>([
      { id: 'read', call: { name: 'read' } }, { id: 'write', call: { name: 'file.patch' } },
    ], { signal: controller.signal, execute: async call => call.id === 'read' ? gate.promise : 'wrote',
      commit: async call => { archived.push(call.id) } })
    await Promise.resolve()
    controller.abort()
    gate.resolve('observed')
    await expect(round).rejects.toMatchObject({ name: 'AbortError' })
    expect(archived).toEqual(['read'])
  })
})
