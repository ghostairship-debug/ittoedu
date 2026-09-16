import { describe, expect, it } from 'vitest'
import { applyDocumentRanges, revertDocumentRanges } from '../../src/main/lessonDocumentCoauthoring'

describe('lessonDocumentCoauthoring', () => {
  const spacer = '\n' + '独立段落'.repeat(20) + '\n'
  it('applies only nonoverlapping AI changes and preserves teacher edits', () => {
    const base = `原稿甲${spacer}原稿乙`
    const edits = [{ from: 0, to: 3, before: '原稿甲', after: 'AI甲' }, { from: base.length - 3, to: base.length, before: '原稿乙', after: 'AI乙' }]
    const result = applyDocumentRanges(base, base.replace('原稿乙', '教师乙'), edits)
    expect(result.source).toBe(`AI甲${spacer}教师乙`)
    expect(result.applied).toHaveLength(1)
    expect(result.conflicts).toHaveLength(1)
  })
  it('selectively reverts after a teacher edit without restoring the whole document', () => {
    const base = `原稿甲${spacer}原稿乙`
    const applied = applyDocumentRanges(base, base, [{ from: 0, to: 3, before: '原稿甲', after: 'AI甲' }, { from: base.length - 3, to: base.length, before: '原稿乙', after: 'AI乙' }])
    const result = revertDocumentRanges(applied.source, applied.source.replace('AI乙', '教师乙'), applied.applied)
    expect(result.source).toBe(`原稿甲${spacer}教师乙`)
    expect(result.applied).toHaveLength(1)
    expect(result.conflicts).toHaveLength(1)
  })
  it('rejects invalid and overlapping ranges', () => {
    expect(applyDocumentRanges('abcd', 'abcd', [{ from: 0, to: 3, before: 'abc', after: 'A' }, { from: 2, to: 4, before: 'cd', after: 'B' }]).conflicts).toHaveLength(1)
  })
})
