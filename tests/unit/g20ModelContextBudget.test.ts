import { expect, it, vi } from 'vitest'
import { estimateSerializedTokens, modelContextBudget, isContextLengthFailure, PreparedPayloadTokenEstimator } from '../../src/core/execution/modelContextBudget'
import type { ModelSelection } from '../../src/shared/workbench/modelProvider'
const selection = { model: 'fixture', connection: {} } as ModelSelection
it('separates explicit model window, output reservation and an unknown window without a guessed cap', () => {
  expect(modelContextBudget(selection)).toMatchObject({ window: null, inputTokens: Infinity, source: 'unknown' })
  expect(modelContextBudget({ ...selection, contextWindow: 8000, parameters: { max_tokens: 2000 } })).toMatchObject({ window: 8000, outputReserve: 2000, inputTokens: 5400 })
  expect(modelContextBudget({ ...selection, contextWindow: 200000 }).inputTokens).toBeGreaterThan(150000)
})

it('measures prepared JSON exactly like the legacy wire estimate across escaping, UTF16 and both image forms', () => {
  const estimator = new PreparedPayloadTokenEstimator()
  const samples = ['', 'plain', '中文😀', '\ud800', '\udfff', 'quote"\\\n\t\u0000', 'data:image/png;base64,abc==',
    'data:image/jpeg;base64,abc==\ncontinued', 'data:image/webp;base64,abc\\def', 'data:image/gif;base64,abc中文']
  const values: unknown[] = [null, true, false, 1.25, -0, Infinity, [undefined, null, NaN],
    { omitted: undefined, actual: null }, ...samples,
    ...samples.map((sample, index) => ({ [sample]: sample, nested: [index, null, sample, { text: sample }] })),
    ...['png', 'jpeg', 'webp', 'gif', 'svg+xml'].flatMap(type => ['abc==', '', 'not valid', '中文'].map(data => ({
      before: 'data:image/png;base64,YQ==', type: 'image', source: { type: 'base64', media_type: `image/${type}`, data, extra: '中文' }, after: 'end',
    }))),
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc', nested: { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'def' } } } },
  ]
  for (const value of values) expect(estimator.estimate(value)).toBe(estimateSerializedTokens(JSON.stringify(value)))
})

it('reuses accepted long scalars and image metadata across cloned prepared bodies while new facts are measured', () => {
  const estimator = new PreparedPayloadTokenEstimator(), text = '冻结历史中文'.repeat(30_000), pixels = 'a'.repeat(300_000)
  const image = `data:image/png;base64,${pixels}`
  estimator.retain({ role: 'user', content: [{ type: 'text', text }, { type: 'image_url', image_url: { url: image } }] })
  const body = { messages: [{ role: 'user', content: [{ type: 'text', text },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: pixels } }] }] }
  const expected = estimateSerializedTokens(JSON.stringify(body)), stringify = vi.spyOn(JSON, 'stringify'), test = vi.spyOn(RegExp.prototype, 'test')
  try {
    for (let round = 0; round < 4; round++) expect(estimator.estimate(structuredClone(body))).toBe(expected)
    expect(stringify.mock.calls.filter(([value]) => value === text)).toHaveLength(1)
    expect(test.mock.calls.filter(([value]) => value === pixels)).toHaveLength(1)
    const fact = '新文档版本'.repeat(9000)
    estimator.retain({ role: 'user', content: fact })
    const changed = { ...body, fact }
    expect(estimator.estimate(changed)).toBe(estimateSerializedTokens(JSON.stringify(changed)))
    expect(stringify.mock.calls.filter(([value]) => value === text)).toHaveLength(1)
    // Changing transient candidate wrappers are never retained as run history.
    for (let round = 0; round < 2; round++) estimator.estimate({ candidate: 'temporary summary prefix' })
    expect(stringify.mock.calls.filter(([value]) => value === 'temporary summary prefix')).toHaveLength(2)
  } finally { stringify.mockRestore(); test.mockRestore() }
})
it('does not charge base64 characters as language tokens and distinguishes an explicit context rejection', () => {
  expect(estimateSerializedTokens(JSON.stringify({ image: 'data:image/png;base64,' + 'a'.repeat(300000) }))).toBeLessThan(3000)
  expect(estimateSerializedTokens('中文'.repeat(1000))).toBeGreaterThan(estimateSerializedTokens('ab'.repeat(1000)))
  expect(isContextLengthFailure({ outcome: 'rejected', kind: 'server', code: 'context_length_exceeded', message: 'maximum context window', httpStatus: 400 })).toBe(true)
  expect(isContextLengthFailure({ outcome: 'unknown', kind: 'transport', code: 'lost', message: 'maximum context window' })).toBe(false)
  expect(isContextLengthFailure({ outcome: 'rejected', kind: 'quota', code: 'quota', message: 'token quota exceeded', httpStatus: 429 })).toBe(false)
})
