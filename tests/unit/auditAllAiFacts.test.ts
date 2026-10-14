// @vitest-environment node
import { expect, it } from 'vitest'
import { CardTextEdits, sourceTextCodec } from '../../src/main/workbench/execution/CardTextEdits'
import { serviceToolOutcome, toolFailed } from '../../src/core/tools/modelToolResult'
import { executionExitDecision } from '../../src/main/workbench/execution/executionOutcome'
it('CA-228 creates the confirmed new own inverse against current human content, never the invalid old baseline', () => {
  const edits = new CardTextEdits(sourceTextCodec, 'one', { from: 0, to: 3 })
  edits.advance('one', 'two', true)
  edits.advance('two', 'human', false)
  expect(edits.prepare('human', 'undo')).toBeNull()
  // The canonical grant owner confirms currentDraft before this new owned commit is possible.
  edits.advance('human', 'final', true)
  expect(edits.prepare('final', 'undo')?.value).toBe('human')
})
it.each(['save', 'import', 'delete'])('CA-033 reports real asset.%s rejection and a completed persisted success', operation => {
  const name = `asset.${operation}`, status = { save: 'saved', import: 'imported', delete: 'deleted' }[operation]!
  const result = { kind: 'read', data: { status } } as any
  expect(toolFailed(name, { kind: 'read', data: { status: 'rejected' } })).toBe(true)
  expect(serviceToolOutcome(name, result)?.status).toBe('saved')
  const record = { input: { documents: [] }, tools: [{ callId: 'a', call: { name, input: {} }, state: 'returned', result }], messages: [] } as any
  expect(executionExitDecision(record).status).toBe('completed')
})
