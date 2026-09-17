import { describe, expect, it } from 'vitest'
import type { TextRun } from '@/shared/contracts/native-v1'
import {
  applyTextRunEdits,
  applyTextRunStyle,
  locateTextRunReplacements,
  planTextRunRemap,
  remapTextRuns,
  toggleTextRunBoolean,
  toggleTextRunEmphasis,
} from '@/shared/textRuns'

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

  it('U01-separated-edits preserves the emphasized middle across simultaneous edge rewrites', () => {
    const runs: TextRun[] = [{ start: 2, end: 4, style: { bold: true, highlightColor: '#fff3a3' } }]

    const result = planTextRunRemap('旧头强调旧尾', '新头强调新尾', runs)

    expect(result).toMatchObject({ ok: true, text: '新头强调新尾' })
    if (!result.ok) throw new Error(result.reason)
    expect(result.edits).toEqual([
      { start: 0, end: 1, original: '旧', replacement: '新' },
      { start: 4, end: 5, original: '旧', replacement: '新' },
    ])
    expect(result.runs).toEqual([{ start: 2, end: 4, style: { bold: true, highlightColor: '#fff3a3' } }])
  })

  it('U01-ambiguity-unicode rejects style-changing repeated matches and stale or overlapping exact edits', () => {
    const runs: TextRun[] = [{ start: 0, end: 1, style: { bold: true } }]
    const ambiguous = planTextRunRemap('甲甲', '甲', runs)
    expect(ambiguous).toMatchObject({ ok: false, code: 'ambiguous', sourceText: '甲甲', draftText: '甲' })

    expect(locateTextRunReplacements('甲甲', runs, [{ original: '甲', replacement: '乙' }])).toMatchObject({ ok: false, code: 'ambiguous' })
    expect(locateTextRunReplacements('甲甲', runs, [{ original: '甲', replacement: '乙', contextAfter: '甲' }])).toMatchObject({ ok: true, text: '乙甲' })
    expect(applyTextRunEdits('甲乙', runs, [{ start: 0, end: 1, original: '旧', replacement: '新' }])).toMatchObject({ ok: false, code: 'stale-original' })
    expect(applyTextRunEdits('甲乙', runs, [
      { start: 0, end: 2, original: '甲乙', replacement: '一' },
      { start: 1, end: 2, original: '乙', replacement: '二' },
    ])).toMatchObject({ ok: false, code: 'overlap' })

    const family = '👨‍👩‍👧‍👦'
    expect(applyTextRunEdits(`${family}好`, [], [{
      start: 1,
      end: Array.from(family).length,
      original: Array.from(family).slice(1).join(''),
      replacement: '坏',
    }])).toMatchObject({ ok: false, code: 'invalid-range' })
  })

  it('U01-ambiguity-unicode uses code-point ranges, grapheme boundaries and unambiguous insertion inheritance', () => {
    const combined = 'e\u0301'
    const source = `甲${combined}乙`
    const runs: TextRun[] = [{ start: 1, end: 4, style: { italic: false, underline: true, highlightColor: null } }]
    const result = applyTextRunEdits(source, runs, [{
      start: 3,
      end: 3,
      original: '',
      replacement: '⭐',
    }])
    expect(result).toMatchObject({ ok: true, text: `甲${combined}⭐乙` })
    if (!result.ok) throw new Error(result.reason)
    expect(result.runs).toEqual([{ start: 1, end: 5, style: { italic: false, underline: true, highlightColor: null } }])
  })

  it('U01-ambiguity-unicode keeps oversized repeated styled text when uniqueness cannot be proven', () => {
    const source = '甲'.repeat(1_001)
    const draft = '甲'.repeat(1_000)
    const styled = planTextRunRemap(source, draft, [{ start: 500, end: 501, style: { bold: false, highlightColor: null } }])

    expect(styled).toMatchObject({
      ok: false,
      code: 'too-complex',
      sourceText: source,
      draftText: draft,
    })
    expect(planTextRunRemap(source, draft, [])).toMatchObject({ ok: true, text: draft, runs: [] })
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
