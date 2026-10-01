import { expect, it } from 'vitest'
import { matchTextPatch } from '../../src/main/workbench/execution/textPatchMatch'

it('maps LF request offsets back to exact CRLF source offsets and preserves BOM and outside mixed endings', () => {
  const source = '\uFEFF前\r\n目标甲\r\n目标乙\r\n尾\n'
  const match = matchTextPatch(source, '目标甲\n目标乙', '新甲\n新乙\n增补')
  const next = source.slice(0, match.from) + match.text + source.slice(match.to)
  expect(next).toBe('\uFEFF前\r\n新甲\r\n新乙\r\n增补\r\n尾\n')
  expect(source.slice(match.from, match.to)).toBe('目标甲\r\n目标乙')
})
it('uses unique exact matches before newline equivalence and refuses ambiguous equivalent matches', () => {
  const exact = matchTextPatch('甲\r\n乙/甲\n乙', '甲\n乙', 'A\nB')
  expect(exact).toEqual({ from: 5, to: 8, text: 'A\nB', equivalent: false })
  expect(() => matchTextPatch('甲\r\n乙/甲\r\n乙', '甲\n乙', 'X')).toThrow('匹配多处')
  expect(() => matchTextPatch('甲 乙', '甲乙', 'X')).toThrow('不存在')
})
it('never widens a supplied range and preserves intended exact replacement bytes', () => {
  expect(matchTextPatch('x甲\r\n乙z', '甲\n乙', '新甲\n新乙', { from: 1, to: 5 }))
    .toMatchObject({ from: 1, to: 5, text: '新甲\r\n新乙', equivalent: true })
  expect(() => matchTextPatch('x甲\r\n乙z', '甲\n乙', 'X', { from: 0, to: 5 })).toThrow('已改变')
  expect(matchTextPatch('甲\r\n乙', '甲\r\n乙', '新甲\n新乙').text).toBe('新甲\n新乙')
})
