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
})
