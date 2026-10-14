import { describe, expect, it } from 'vitest'
import { documentSourceEdits, mergedDocumentSource, planDocumentSourceMerge } from '../../src/renderer/documentFiles/documentSourceMerge'

describe('documentSourceMerge', () => {
  it.each([['', '新稿'], ['删除全部', ''], ['甲乙丙', '甲改乙丙增'], ['aaabaa', 'aabba'], ['😀甲乙', '😁甲新乙'], ['a\nb\nc', 'A\nb\nC']])('reconstructs source edits %s -> %s', (base, next) => {
    let source = base
    for (const edit of documentSourceEdits(base, next).reverse()) source = source.slice(0, edit.from) + edit.text + source.slice(edit.to)
    expect(source).toBe(next)
  })
  it('keeps independent ranges on both sides when a separate range conflicts', () => {
    const plan = planDocumentSourceMerge('A原\nB原\nC原', 'A甲\nB乙\nC原', 'A丙\nB原\nC丁')
    expect(plan.conflicts).toHaveLength(1)
    expect(mergedDocumentSource(plan)).toBe('A甲\nB乙\nC丁')
    plan.conflicts[0]!.resolution = '手动'
    expect(mergedDocumentSource(plan)).toBe('A手动\nB乙\nC丁')
  })
  it('merges identical changes once and makes simultaneous insertion explicit', () => {
    expect(mergedDocumentSource(planDocumentSourceMerge('ABC', 'AXBC', 'AXBC'))).toBe('AXBC')
    expect(planDocumentSourceMerge('ABC', 'AXBC', 'AYBC').conflicts).toHaveLength(1)
  })
  it('preserves the Myers edit locations when a common suffix has another possible match', () => {
    expect(documentSourceEdits('aba', 'baa')).toEqual([
      { from: 0, to: 1, text: '' },
      { from: 3, to: 3, text: 'a' },
    ])
  })
  it('keeps the suffix insertion independent of the other side deletion', () => {
    const plan = planDocumentSourceMerge('aba', 'baa', 'aa')
    expect(plan.conflicts).toEqual([])
    expect(mergedDocumentSource(plan)).toBe('aa')
  })
  it.each(['😃', '🈀'])('returns complete UTF-16 ranges when replacing an emoji with %s', replacement => {
    expect(documentSourceEdits('a😀b', `a${replacement}b`)).toEqual([{ from: 1, to: 3, text: replacement }])
  })
  it('keeps both edit ranges around an anchor and a long unchanged tail beyond distance 512', () => {
    const middle = ' | unchanged middle | ', tail = '\nunchanged body'.repeat(4000)
    const base = `${'a'.repeat(160)}${middle}${'b'.repeat(160)}${tail}`
    const next = `${'c'.repeat(160)}${middle}${'d'.repeat(160)}${tail}`
    expect(documentSourceEdits(base, next)).toEqual([
      { from: 0, to: 160, text: 'c'.repeat(160) },
      { from: 160 + middle.length, to: 320 + middle.length, text: 'd'.repeat(160) },
    ])
  })
})
