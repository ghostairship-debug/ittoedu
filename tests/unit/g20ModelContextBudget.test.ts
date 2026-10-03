import { expect, it } from 'vitest'
import { estimateSerializedTokens, modelContextBudget, isContextLengthFailure } from '../../src/core/execution/modelContextBudget'
import type { ModelSelection } from '../../src/shared/workbench/modelProvider'
const selection = { model: 'fixture', connection: {} } as ModelSelection
it('separates explicit model window, output reservation and an unknown window without a guessed cap', () => {
  expect(modelContextBudget(selection)).toMatchObject({ window: null, inputTokens: Infinity, source: 'unknown' })
  expect(modelContextBudget({ ...selection, contextWindow: 8000, parameters: { max_tokens: 2000 } })).toMatchObject({ window: 8000, outputReserve: 2000, inputTokens: 5400 })
  expect(modelContextBudget({ ...selection, contextWindow: 200000 }).inputTokens).toBeGreaterThan(150000)
})
it('does not charge base64 characters as language tokens and distinguishes an explicit context rejection', () => {
  expect(estimateSerializedTokens(JSON.stringify({ image: 'data:image/png;base64,' + 'a'.repeat(300000) }))).toBeLessThan(3000)
  expect(estimateSerializedTokens('中文'.repeat(1000))).toBeGreaterThan(estimateSerializedTokens('ab'.repeat(1000)))
  expect(isContextLengthFailure({ outcome: 'rejected', kind: 'server', code: 'context_length_exceeded', message: 'maximum context window', httpStatus: 400 })).toBe(true)
  expect(isContextLengthFailure({ outcome: 'unknown', kind: 'transport', code: 'lost', message: 'maximum context window' })).toBe(false)
  expect(isContextLengthFailure({ outcome: 'rejected', kind: 'quota', code: 'quota', message: 'token quota exceeded', httpStatus: 429 })).toBe(false)
})
