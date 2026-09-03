import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTextNode } from '@/renderer/project/nativeNodeFactories'
import { nativeRenderInputFromV9Item } from '@/player/surfaces/slide/publishedNativeRendering'
import { analyzeTextNodeLayout, renderTextNodeCanvas } from '@/shared/textLayout'
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
