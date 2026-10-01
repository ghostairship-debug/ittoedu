// @vitest-environment node
import { expect, it } from 'vitest'
import { CardTextEdits, sourceTextCodec, flowTextCodec } from '../../src/main/workbench/execution/CardTextEdits'

it('maps exact committed source edits and never hunts for identical text elsewhere', () => {
  const trace = new CardTextEdits(sourceTextCodec, 'AAA xx SAME', { from: 0, to: 3 })
  trace.advance('AAA xx SAME', 'SAME xx SAME', true, false, { from: 0, to: 3, inserted: 4 })
  trace.advance('SAME xx SAME', 'USER xx SAME', false, false, { from: 0, to: 4, inserted: 4 })
  expect(trace.prepare('USER xx SAME', 'undo')).toBeNull()
})
it('preserves disjoint manual edits and combines repeated owned edits into a single inverse', () => {
  const trace = new CardTextEdits(sourceTextCodec, 'AAA and BBB', { from: 0, to: 11 })
  trace.advance('AAA and BBB', 'First and BBB', true, false, { from: 0, to: 3, inserted: 5 })
  trace.advance('First and BBB', 'First and USER', false, false, { from: 10, to: 13, inserted: 4 })
  trace.advance('First and USER', 'Better and USER', true, false, { from: 0, to: 5, inserted: 6 })
  trace.advance('Better and USER', 'Prefix Better and USER', false, false, { from: 0, to: 0, inserted: 7 })
  const undo = trace.prepare('Prefix Better and USER', 'undo')!
  expect(undo.value).toBe('Prefix AAA and USER'); undo.accept()
  expect(trace.prepare(undo.value, 'redo')!.value).toBe('Prefix Better and USER')
})
it('reverts two separated owned source edits without touching the gap', () => {
  const trace = new CardTextEdits(sourceTextCodec, 'A gap B', { from: 0, to: 7 })
  trace.advance('A gap B', 'AA gap B', true, false, { from: 0, to: 1, inserted: 2 })
  trace.advance('AA gap B', 'AA gap BB', true, false, { from: 7, to: 8, inserted: 2 })
  trace.advance('AA gap BB', 'AA manual BB', false, false, { from: 3, to: 6, inserted: 6 })
  const undo = trace.prepare('AA manual BB', 'undo')!
  expect(undo.value).toBe('A manual B'); undo.accept()
  expect(trace.prepare(undo.value, 'redo')!.value).toBe('AA manual BB')
})
it('tracks rich text with inline styling and keeps a later disjoint manual paragraph edit', () => {
  const rich = (text: string) => ({ inlines: [{ type: 'text' as const, text }] })
  const trace = new CardTextEdits(flowTextCodec, rich('AA BB CC'), { from: 3, to: 5 })
  trace.advance(rich('AA BB CC'), rich('AA Better CC'), true)
  trace.advance(rich('AA Better CC'), rich('XX Better CC'), false)
  expect(trace.prepare(rich('XX Better CC'), 'undo')!.value).toEqual(rich('XX BB CC'))
})


it('keeps an owned inverse usable when the human editor replaces a disjoint part of the selected paragraph', () => {
  const trace = new CardTextEdits(sourceTextCodec, 'A gap B', { from: 0, to: 7 })
  trace.advance('A gap B', 'AI gap B', true, false, { from: 0, to: 1, inserted: 2 })
  trace.advance('AI gap B', 'AI human B', false)
  expect(trace.prepare('AI human B', 'undo')?.value).toBe('A human B')
  expect(trace.range).toEqual({ from: 0, to: 10 })
})

it('restores rich-text inverse eligibility only after the same-card peer is explicitly undone', () => {
  const rich = (text: string) => ({ inlines: [{ type: 'text' as const, text, style: { bold: true } }] })
  const trace = new CardTextEdits(flowTextCodec, rich('one'), { from: 0, to: 3 })
  trace.advance(rich('one'), rich('second'), true)
  trace.advance(rich('second'), rich('third'), false, false, undefined, { id: 'peer', direction: 'apply' })
  expect(trace.prepare(rich('third'), 'undo')).toBeNull()
  trace.advance(rich('third'), rich('second'), false, false, undefined, { id: 'peer', direction: 'undo' })
  expect(trace.prepare(rich('second'), 'undo')!.value).toEqual(rich('one'))
})
