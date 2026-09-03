import { describe, expect, it } from 'vitest'
import type { TextRun } from '@/shared/contracts/native-v1'
import { applyTextRunStyle, remapTextRuns, toggleTextRunBoolean, toggleTextRunEmphasis } from '@/shared/textRuns'

describe('remapTextRuns', () => {
  it('moves formatting with an unchanged suffix after deleting text before it', () => {
    const runs: TextRun[] = [
      { start: 1, end: 4, style: { color: '#ef4444', bold: true } },
    ]

    expect(remapTextRuns('ABCDE', 'BCDE', runs)).toEqual([
      { start: 0, end: 3, style: { color: '#ef4444', bold: true } },
    ])
  })

  it('inherits an unambiguous surrounding style for inserted Unicode text', () => {
    const runs: TextRun[] = [
      {
        start: 0,
        end: 2,
        style: {
          underline: true,
          emphasis: true,
          highlightColor: '#fff3a3',
        },
      },
    ]

    expect(remapTextRuns('重点', '重⭐点', runs)).toEqual([
      {
        start: 0,
        end: 3,
        style: {
          underline: true,
          emphasis: true,
          highlightColor: '#fff3a3',
        },
      },
    ])
  })

  it('preserves explicit false and null overrides', () => {
    const runs: TextRun[] = [
      {
        start: 1,
        end: 3,
        style: {
          bold: false,
          italic: false,
          underline: false,
          strike: false,
          emphasis: false,
          highlightColor: null,
        },
      },
    ]

    expect(remapTextRuns('ABCD', 'XABCD', runs)).toEqual([
      {
        start: 2,
        end: 4,
        style: {
          bold: false,
          italic: false,
          underline: false,
          strike: false,
          emphasis: false,
          highlightColor: null,
        },
      },
    ])
  })

  it('toggles emphasis on one Unicode range without changing adjacent formatting', () => {
    const runs: TextRun[] = [{
      start: 0,
      end: 3,
      style: { color: '#ef4444', bold: true },
    }]

    expect(toggleTextRunEmphasis('春⭐风', runs, 1, 2, false)).toEqual([
      { start: 0, end: 1, style: { color: '#ef4444', bold: true } },
      {
        start: 1,
        end: 2,
        style: { color: '#ef4444', bold: true, emphasis: true },
      },
      { start: 2, end: 3, style: { color: '#ef4444', bold: true } },
    ])
  })

  it('stores an explicit false override when disabling part of an emphasized node', () => {
    const disabled = toggleTextRunEmphasis('重点', [], 0, 1, true)
    expect(disabled).toEqual([
      { start: 0, end: 1, style: { emphasis: false } },
    ])

    expect(toggleTextRunEmphasis('重点', disabled, 0, 1, true)).toEqual([])
  })

  it('applies bold, italic and color to a Unicode range without formatting the whole string', () => {
    const text = '春⭐风'
    const empty: TextRun[] = []

    expect(applyTextRunStyle(text, empty, 1, 1, { bold: true })).toEqual([])
    expect(applyTextRunStyle(text, empty, 0, 0, { italic: true, color: '#ef4444' })).toEqual([])

    const bold = applyTextRunStyle(text, empty, 1, 2, { bold: true })
    expect(bold).toEqual([{ start: 1, end: 2, style: { bold: true } }])

    const italic = applyTextRunStyle(text, bold, 0, 1, { italic: true })
    expect(italic).toEqual([
      { start: 0, end: 1, style: { italic: true } },
      { start: 1, end: 2, style: { bold: true } },
    ])

    const colored = applyTextRunStyle(text, italic, 2, 3, { color: '#2563eb' })
    expect(colored).toEqual([
      { start: 0, end: 1, style: { italic: true } },
      { start: 1, end: 2, style: { bold: true } },
      { start: 2, end: 3, style: { color: '#2563eb' } },
    ])
  })

  it('toggles bold off against a bold node default', () => {
    expect(toggleTextRunBoolean('双击编辑', [], 0, 2, 'bold', true)).toEqual([
      { start: 0, end: 2, style: { bold: false } },
    ])
  })
})
