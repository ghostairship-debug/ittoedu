import { expect, it, vi } from 'vitest'
import { prepareFlowDynamicDrafts, registerFlowDynamicDraft } from '@/renderer/composition/runtime/flowDynamicDraftPreparation'

it('prepares only the requested document and waits for the active port', async () => {
  let settle!: () => void
  const prepare = vi.fn(() => new Promise<void>(resolve => { settle = resolve }))
  const other = vi.fn(async () => {})
  const unregister = registerFlowDynamicDraft({ documentId: 'doc-1', owner: 'card-1', prepare })
  const unregisterOther = registerFlowDynamicDraft({ documentId: 'doc-2', owner: 'card-2', prepare: other })
  try {
    let completed = false
    const pending = prepareFlowDynamicDrafts('doc-1').then(() => { completed = true })
    expect(prepare).toHaveBeenCalledOnce()
    expect(other).not.toHaveBeenCalled()
    await Promise.resolve()
    expect(completed).toBe(false)
    settle()
    await pending
    expect(completed).toBe(true)
  } finally { unregister(); unregisterOther() }
})

it('retains a replacement registration when the old token unregisters and propagates failure', async () => {
  const stale = vi.fn(async () => {})
  const current = vi.fn(async () => { throw new Error('unconfirmed draft') })
  const unregisterStale = registerFlowDynamicDraft({ documentId: 'doc-1', owner: 'card-1', prepare: stale })
  const unregisterCurrent = registerFlowDynamicDraft({ documentId: 'doc-1', owner: 'card-1', prepare: current })
  try {
    unregisterStale()
    await expect(prepareFlowDynamicDrafts('doc-1')).rejects.toThrow('unconfirmed draft')
    expect(stale).not.toHaveBeenCalled()
    expect(current).toHaveBeenCalledOnce()
  } finally { unregisterCurrent() }
  await expect(prepareFlowDynamicDrafts('doc-1')).resolves.toBeUndefined()
})

it('prepares two cards on one document in registration order', async () => {
  let settleFirst!: () => void
  const calls: string[] = []
  const unregisterFirst = registerFlowDynamicDraft({ documentId: 'doc-order', owner: 'card-1',
    prepare: () => { calls.push('first'); return new Promise(resolve => { settleFirst = resolve }) } })
  const unregisterSecond = registerFlowDynamicDraft({ documentId: 'doc-order', owner: 'card-2',
    prepare: async () => { calls.push('second') } })
  try {
    const pending = prepareFlowDynamicDrafts('doc-order')
    expect(calls).toEqual(['first'])
    settleFirst()
    await pending
    expect(calls).toEqual(['first', 'second'])
  } finally { unregisterFirst(); unregisterSecond() }
})
