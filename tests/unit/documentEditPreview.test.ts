import { describe, expect, it } from 'vitest'
import { documentEditPreviews } from '../../src/renderer/documentFiles/documentEditPreview'

describe('readable AI preview', () => {
  it('joins separated diff hunks without dropping unchanged text between them', () => {
    expect(documentEditPreviews('保留段落\n待修改段落。\n', [
      { from: 5, to: 6, before: '待', after: 'AI 已精确' },
      { from: 8, to: 10, before: '段落', after: '' },
    ])).toEqual([{ before: '待修改段落。', after: 'AI 已精确修改。' }])
  })
  it('keeps separate changed lines and rejects a mismatched baseline', () => {
    expect(documentEditPreviews('甲\n不改\n乙', [{ from: 0, to: 1, before: '甲', after: '新甲' }, { from: 5, to: 6, before: '乙', after: '新乙' }])).toEqual([{ before: '甲', after: '新甲' }, { before: '乙', after: '新乙' }])
    expect(() => documentEditPreviews('人工稿', [{ from: 0, to: 3, before: '旧原稿', after: '建议' }])).toThrow('基准')
  })
})
