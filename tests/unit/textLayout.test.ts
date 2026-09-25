import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTextNode } from '@/core/tools/nativeNodeFactories'
import { nativeRenderInputFromV9Item } from '@/player/surfaces/native/publishedNativeRendering'
import { analyzeTextNodeLayout, layoutHorizontalTextNode, renderTextNodeCanvas } from '@/shared/textLayout'
import * as layoutMeasure from '@/shared/layoutMeasure'
import { listCourseProjectV9Fixtures } from '../fixtures/course-project-v9/sources'
import type { NativeLayerItem } from '@/shared/courseProjectTypes'

type FillTextCall = [text: string, x: number, y: number]
type ArcCall = [x: number, y: number, radius: number, start: number, end: number]

function canvasContext(
  fillTextCalls: FillTextCall[],
  arcCalls: ArcCall[] = [],
): CanvasRenderingContext2D {
  return {
    arc: vi.fn((...args: ArcCall) => arcCalls.push(args)),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    clip: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn((...args: FillTextCall) => fillTextCalls.push(args)),
    lineTo: vi.fn(),
    measureText: vi.fn(() => ({ width: 10 })),
    moveTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    restore: vi.fn(),
    save: vi.fn(),
    scale: vi.fn(),
    stroke: vi.fn(),
  } as unknown as CanvasRenderingContext2D
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('direction-aware text layout', () => {
  it('keeps vertical height authored and grows width by the required columns', () => {
    const calls: FillTextCall[] = []
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      canvasContext(calls),
    )
    const node = createTextNode({
      width: 200,
      height: 80,
      text: '甲乙丙丁戊己庚',
      style: {
        writingMode: 'vertical-rl',
        overflow: 'auto-height',
        fontSize: 20,
        lineSpacing: 0,
        letterSpacing: 0,
        padding: 0,
      },
    })

    const compact = renderTextNodeCanvas(node)
    const taller = renderTextNodeCanvas({ ...node, height: 160 })

    expect(compact.height).toBe(80)
    expect(compact.width).toBe(60)
    expect(taller.height).toBe(160)
    expect(taller.width).toBe(40)
  })

  it('draws vertical-rl columns rightward-first and vertical-lr leftward-first', () => {
    const rightToLeftCalls: FillTextCall[] = []
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      canvasContext(rightToLeftCalls),
    )
    const node = createTextNode({
      height: 80,
      text: '甲乙丙丁',
      style: {
        writingMode: 'vertical-rl',
        overflow: 'auto-height',
        fontSize: 20,
        lineSpacing: 0,
        letterSpacing: 0,
        padding: 0,
      },
    })
    renderTextNodeCanvas(node)
    const firstRight = rightToLeftCalls.find(([text]) => text === '甲')!
    const nextRightColumn = rightToLeftCalls.find(([text]) => text === '丁')!
    expect(firstRight[1]).toBeGreaterThan(nextRightColumn[1])

    vi.restoreAllMocks()
    const leftToRightCalls: FillTextCall[] = []
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      canvasContext(leftToRightCalls),
    )
    renderTextNodeCanvas({
      ...node,
      style: { ...node.style, writingMode: 'vertical-lr' },
    })
    const firstLeft = leftToRightCalls.find(([text]) => text === '甲')!
    const nextLeftColumn = leftToRightCalls.find(([text]) => text === '丁')!
    expect(firstLeft[1]).toBeLessThan(nextLeftColumn[1])
  })

  it('reserves line height and draws only run-level horizontal emphasis dots', () => {
    const plainCalls: FillTextCall[] = []
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      canvasContext(plainCalls),
    )
    const plain = createTextNode({
      width: 200,
      text: '重点 文本',
      style: {
        writingMode: 'horizontal',
        overflow: 'auto-height',
        fontSize: 20,
        lineSpacing: 0,
        letterSpacing: 0,
        padding: 0,
      },
    })
    const plainRendered = renderTextNodeCanvas(plain)

    vi.restoreAllMocks()
    const emphasizedCalls: FillTextCall[] = []
    const arcCalls: ArcCall[] = []
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      canvasContext(emphasizedCalls, arcCalls),
    )
    const rendered = renderTextNodeCanvas({
      ...plain,
      runs: [{ start: 0, end: 2, style: { emphasis: true } }],
    })

    expect(rendered.height).toBeGreaterThan(plainRendered.height)
    expect(arcCalls).toHaveLength(2)
    expect(arcCalls[0]![1]).toBeGreaterThan(
      emphasizedCalls.find(([text]) => text === '重')![2],
    )
  })

  it.each(['vertical-rl', 'vertical-lr'] as const)(
    'reserves column width and draws %s emphasis on the character right',
    (writingMode) => {
      const fillTextCalls: FillTextCall[] = []
      const arcCalls: ArcCall[] = []
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
        canvasContext(fillTextCalls, arcCalls),
      )
      const node = createTextNode({
        height: 80,
        text: '甲乙',
        runs: [{ start: 1, end: 2, style: { emphasis: false } }],
        style: {
          writingMode,
          overflow: 'auto-height',
          fontSize: 20,
          lineSpacing: 0,
          letterSpacing: 0,
          padding: 0,
          emphasis: true,
        },
      })

      const rendered = renderTextNodeCanvas(node)
      const firstCharacter = fillTextCalls.find(([text]) => text === '甲')!

      expect(rendered.width).toBeGreaterThan(20)
      expect(arcCalls).toHaveLength(1)
      expect(arcCalls[0]![0]).toBeGreaterThan(firstCharacter[1])
    },
  )
})

describe('Chinese horizontal punctuation boundaries', () => {
  function measuredNode(text: string, width: number, fontSize = 10) {
    const calls: FillTextCall[] = []
    const context = canvasContext(calls)
    context.measureText = vi.fn(() => ({
      width: Number(/(\d+(?:\.\d+)?)px/u.exec(context.font)![1]),
    } as TextMetrics))
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context)
    vi.spyOn(layoutMeasure, 'resolveLayoutMeasureContext').mockReturnValue({ context, mode: 'browser-canvas' })
    const node = createTextNode({ text, width, height: 300,
      style: { fontSize, padding: 0, letterSpacing: 0, lineSpacing: 6,
        writingMode: 'horizontal', overflow: 'auto-height' },
    })
    return { node, calls }
  }
  function texts(node: ReturnType<typeof createTextNode>) {
    return layoutHorizontalTextNode(node).lines.map(line => line.characters.map(character => character.value).join(''))
  }

  it('keeps the material sentence final period with text at its actual 1120px width and 42px size', () => {
    const text = '分数表示把一个整体平均分成若干份，取其中的一份或几份。'
    // Full-width CJK advances reproduce the browser failure: 26 glyphs fit, 27 do not.
    const { node } = measuredNode(text, 1120, 42)
    expect(texts(node)).toEqual([text.slice(0, -2), '份。'])
    expect(node.text).toBe(text)
  })

  it.each(['，', '。', '、', '；', '：', '？', '！', '）', '》', '」', '』', '】', '”', '’'])(
    'moves preceding text with closing punctuation %s', mark => {
      const { node } = measuredNode(`甲乙${mark}丙`, 20)
      expect(texts(node)).toEqual(['甲', `乙${mark}`, '丙'])
    },
  )

  it.each(['（', '《', '「', '『', '【', '“', '‘'])(
    'moves opening punctuation %s with following text', mark => {
      const { node } = measuredNode(`甲${mark}乙丙`, 20)
      expect(texts(node)).toEqual(['甲', `${mark}乙`, '丙'])
    },
  )

  it('preserves explicit newlines, blank lines and ASCII wrapping', () => {
    const { node } = measuredNode('甲（\n。乙\n\nabc,de\n', 30)
    expect(texts(node)).toEqual(['甲（', '。乙', '', 'abc', ',de', ''])
    expect(layoutHorizontalTextNode(node).lines.map(line => [line.start, line.end]))
      .toEqual([[0, 2], [3, 5], [6, 6], [7, 10], [10, 13], [14, 14]])
  })

  it.each([1, 10])('terminates without lost or duplicated characters in a %spx frame', width => {
    const text = '（甲）。，《乙》'
    const { node } = measuredNode(text, width)
    const lines = layoutHorizontalTextNode(node).lines
    expect(lines).toHaveLength(Array.from(text).length)
    expect(lines.flatMap(line => line.characters).map(character => character.value).join('')).toBe(text)
    expect(lines.every(line => line.characters.length > 0)).toBe(true)
  })

  it('keeps indices, run styles, widths and auto height identical for layout, analysis and Canvas', () => {
    const { node, calls } = measuredNode('甲乙。丙', 40)
    node.runs = [{ start: 1, end: 3, style: { fontSize: 20, bold: true } }]
    const layout = layoutHorizontalTextNode(node)
    expect(texts(node)).toEqual(['甲', '乙。', '丙'])
    expect(layout.lines.flatMap(line => line.characters).map(character => character.index)).toEqual([0, 1, 2, 3])
    expect(layout.lines.flatMap(line => line.characters).slice(1, 3).map(character => character.style))
      .toEqual([expect.objectContaining({ fontSize: 20, bold: true }), expect.objectContaining({ fontSize: 20, bold: true })])
    expect(layout.lines.map(line => line.width)).toEqual([10, 40, 10])
    expect(analyzeTextNodeLayout(node).requiredHeight).toBeCloseTo(layout.contentHeight)
    const rendered = renderTextNodeCanvas(node)
    expect(rendered.height).toBeCloseTo(layout.contentHeight)
    expect(calls.map(([text]) => text).join('')).toBe(node.text)
  })
})

describe('V9 NativeRenderInput text layout', () => {
  it('shrinks the same fixture text for authoring input and TextNode analysis', () => {
    const fixture = listCourseProjectV9Fixtures().find((entry) => entry.id === 'slide-native')
    if (!fixture) throw new Error('missing slide-native fixture')
    const project = structuredClone(fixture.data.project)
    const surface = project.surfaces.find((candidate) => candidate.type === 'slide')
    const item = surface?.type === 'slide'
      ? surface.scenes[0]?.layerItems.find((layer) => layer.layerItemId === 'slide-title')
      : undefined
    if (!item || item.kind !== 'native' || item.content.nativeType !== 'text') {
      throw new Error('expected slide-title text')
    }
    item.content.data.style.overflow = 'shrink'
    item.content.data.style.fontSize = 40
    item.content.data.style.padding = 0
    item.content.data.style.lineSpacing = 0
    item.content.data.text = '甲乙丙丁戊己庚辛壬癸'.repeat(6)
    item.frame.width = 120
    item.frame.height = 40
    const input = nativeRenderInputFromV9Item(item as NativeLayerItem)
    expect(input.type).toBe('text')
    if (input.type !== 'text') return
    const fromInput = analyzeTextNodeLayout(input)
    const fromNode = analyzeTextNodeLayout({
      ...input,
    })
    expect(fromInput.fontSize).toBe(fromNode.fontSize)
    expect(fromInput.fontSize).toBeLessThan(40)
    expect(fromInput.fontSize).toBeGreaterThanOrEqual(8)
  })
})
