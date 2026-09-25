import { describe, expect, it } from 'vitest'
import { mapMarkdownRange } from '../../src/core/tools/ToolTargets'

describe('M10 frozen Markdown targets after independent edits', () => {
  it('keeps an early range through an appended line even when both snapshots end in a newline', () => {
    const source = '# Start\n\nHUMAN segment\n'
    const range = { kind: 'markdown-range' as const, from: source.indexOf('HUMAN'), to: source.indexOf('HUMAN') + 5 }
    expect(mapMarkdownRange(source, `${source}After move manual\n`, range)).toEqual(range)
  })

  it('permits repeated insertions or deletions whose every possible position is after the frozen range', () => {
    const range = { kind: 'markdown-range' as const, from: 0, to: 3 }
    expect(mapMarkdownRange('XYZaaaa', 'XYZaaaaa', range)).toEqual(range)
    expect(mapMarkdownRange('XYZaaaa', 'XYZaaa', range)).toEqual(range)
  })

  it('maps a deletion before the frozen range even when equivalent deletion positions repeat', () => {
    const range = { kind: 'markdown-range' as const, from: 4, to: 7 }
    expect(mapMarkdownRange('aaaaXYZ', 'aaaXYZ', range)).toEqual({ ...range, from: 3, to: 6 })
  })

  it('rejects repeated fragment placements that could shift or overlap a frozen range', () => {
    const range = { kind: 'markdown-range' as const, from: 2, to: 4 }
    expect(() => mapMarkdownRange('abab', 'ababab', range)).toThrow('不唯一')
    expect(() => mapMarkdownRange('ababab', 'abab', range)).toThrow('不唯一')
  })

  it('keeps a conservative conflict for a complex replacement touching the range', () => {
    const range = { kind: 'markdown-range' as const, from: 3, to: 6 }
    expect(() => mapMarkdownRange('abcDEFghi', 'abcDE!Fghi', range)).toThrow('重叠')
  })
})
