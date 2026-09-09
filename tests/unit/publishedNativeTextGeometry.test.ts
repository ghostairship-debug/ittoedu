// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { paintPublishedNativeText } from '../../src/player/surfaces/publishedNativeText'
import { createTextNode } from '../../src/renderer/project/nativeNodeFactories'
import { analyzeTextNodeLayout, layoutHorizontalTextNode, renderTextNodeCanvas } from '../../src/shared/textLayout'

afterEach(() => vi.restoreAllMocks())

function paint(node: ReturnType<typeof createTextNode>) {
  const wrap = document.createElement('div')
  paintPublishedNativeText(wrap, { text: node.text, runs: node.runs, style: node.style }, node)
  return wrap
}

describe('Published Native uses the formal horizontal line geometry', () => {
  it.each(['top', 'middle', 'bottom'] as const)('keeps legal large spacing out of a single line and honors %s alignment', verticalAlign => {
    const node = createTextNode({ text: '平均分与分数', width: 1080, height: 100,
      style: { fontSize: 40, padding: 8, lineSpacing: 120, overflow: 'shrink', verticalAlign } })
    const before = structuredClone(node)
    const wrap = paint(node), line = wrap.querySelector<HTMLElement>('[data-text-line]')!
    expect(analyzeTextNodeLayout(node).requiredHeight).toBeCloseTo(64.8)
    expect(wrap.style.fontSize).toBe('40px')
    expect(parseFloat(line.style.top)).toBeCloseTo(verticalAlign === 'top' ? 8 : verticalAlign === 'middle' ? 25.6 : 43.2)
    expect(parseFloat(line.style.height)).toBeCloseTo(48.8)
    expect(line.style.lineHeight).toBe('48.8px')
    expect(node).toEqual(before)
  })

  it.each(['fixed', 'auto-height', 'shrink'] as const)('places spacing only between multiple lines in %s', overflow => {
    const node = createTextNode({ text: '第一行\n\n第三行', width: 300, height: 210,
      style: { fontSize: 20, padding: 8, lineSpacing: 60, overflow } })
    const wrap = paint(node), lines = [...wrap.querySelectorAll<HTMLElement>('[data-text-line]')]
    expect(lines).toHaveLength(3)
    expect(lines.map(line => parseFloat(line.style.top))).toEqual([8, 92.4, 176.8])
    expect(parseFloat(lines[2]!.style.top) + parseFloat(lines[2]!.style.height) + 8).toBeCloseTo(209.2)
    expect(wrap.textContent).toBe(node.text)
    expect(wrap.style.fontSize).toBe('20px')
    expect(node.height).toBe(210)
  })

  it('keeps run styles and baseline through measured wrapping, including an explicit false emphasis override', () => {
    const node = createTextNode({ text: '甲乙丙丁', width: 36, height: 300,
      runs: [{ start: 1, end: 3, style: { fontSize: 30, baseline: 0.3, bold: true,
        color: '#dd2200', highlightColor: '#ffff00', underline: true, emphasis: false } }],
      style: { fontSize: 20, padding: 0, lineSpacing: 20, emphasis: true, overflow: 'fixed' } })
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Native geometry test')
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: () => ({ width: 18 }) } as unknown as CanvasRenderingContext2D)
    const wrap = paint(node), rows = [...wrap.querySelectorAll<HTMLElement>('[data-text-line]')]
    expect(rows.map(row => row.textContent)).toEqual(['甲乙', '丙丁'])
    const styled = [...wrap.querySelectorAll('span')].filter(span => span.textContent === '乙' || span.textContent === '丙')
    expect(styled).toHaveLength(2)
    for (const span of styled) {
      expect(span.style.fontSize).toBe('30px'); expect(span.style.verticalAlign).toBe('0.3em')
      expect(span.style.fontWeight).toBe('700'); expect(span.style.color).toBe('rgb(221, 34, 0)')
      expect(span.style.backgroundColor).toBe('rgb(255, 255, 0)'); expect(span.style.textDecoration).toBe('underline')
      expect(span.style.textEmphasis).toBe('')
    }
  })

  it('retains Canvas placement while sharing the geometry with DOM', () => {
    const calls: [string, number, number][] = []
    const context = { measureText: () => ({ width: 10 }), fillText: (text: string, x: number, y: number) => calls.push([text, x, y]),
      beginPath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {}, closePath() {}, clip() {}, save() {}, restore() {}, scale() {}, fill() {}, stroke() {} }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Native geometry test')
    const node = createTextNode({ text: '甲乙\n丙丁', width: 100, height: 200,
      style: { fontSize: 20, padding: 8, lineSpacing: 60, overflow: 'fixed', align: 'right', verticalAlign: 'bottom' } })
    renderTextNodeCanvas(node)
    expect(calls.map(([text, x]) => [text, x])).toEqual([['甲', 72], ['乙', 82], ['丙', 72], ['丁', 82]])
    calls.forEach(([, , y], index) => expect(y).toBeCloseTo(index < 2 ? 103.2 : 187.6))
    const layout = layoutHorizontalTextNode(node)
    expect(layout.lines.map(line => [line.x, line.baseline])).toEqual(calls.filter(([text]) => text === '甲' || text === '丙').map(([, x, y]) => [x, y]))
  })
})
