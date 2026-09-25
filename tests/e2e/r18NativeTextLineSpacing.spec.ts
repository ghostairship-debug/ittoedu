import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { buildSync } from 'esbuild'
import sharp from 'sharp'
import { chromium, expect, test } from '@playwright/test'

test('Native line geometry keeps legal spacing and rich runs visible in actual Chromium', async () => {
  const root = resolve(process.env.COURSEWARE_R18_TEXT_GEOMETRY_OUTPUT ?? 'output/r18-native-text-geometry', new Date().toISOString().replace(/[:.]/g, '-'))
  mkdirSync(root, { recursive: true })
  const script = buildSync({ stdin: { contents: `export { paintPublishedNativeText as paint } from './src/player/surfaces/publishedNativeText';
    export { createTextNode as create } from './src/core/tools/nativeNodeFactories';
    export { analyzeTextNodeLayout as analyze } from './src/shared/textLayout';`, resolveDir: process.cwd() },
    bundle: true, write: false, format: 'iife', globalName: 'NativeTextGeometry', platform: 'browser' }).outputFiles[0]!.text
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 2300, height: 1800 } })
  try {
    await page.setContent('<body style="margin:0;background:#f1f5f9"></body>')
    await page.addScriptTag({ content: script })
    const facts = await page.evaluate(() => {
      const api = (window as unknown as { NativeTextGeometry: {
        create: (input: unknown) => import('../../src/shared/contracts/native-v1').TextNode
        paint: typeof import('../../src/player/surfaces/publishedNativeText').paintPublishedNativeText
        analyze: typeof import('../../src/shared/textLayout').analyzeTextNodeLayout
      } }).NativeTextGeometry
      const cases = [
        ...(['top', 'middle', 'bottom'] as const).map(verticalAlign => ({ id: `single-${verticalAlign}`, width: 1080, height: 100,
          text: '平均分与分数', style: { fontFamily: 'Microsoft YaHei', fontSize: 40, bold: true, padding: 8, lineSpacing: 120, verticalAlign, overflow: 'shrink' } })),
        { id: 'multiline-middle', width: 1080, height: 210, text: '这是第一行\n这是第二行\n这是第三行',
          style: { fontFamily: 'Microsoft YaHei', fontSize: 24, padding: 8, lineSpacing: 32, verticalAlign: 'middle', overflow: 'fixed' } },
        { id: 'auto-height', width: 1080, height: 0, text: '自动高度第一行\n自动高度第二行',
          style: { fontFamily: 'Microsoft YaHei', fontSize: 32, padding: 8, lineSpacing: 24, overflow: 'auto-height' } },
        { id: 'rich-runs', width: 1080, height: 160, text: '化学 H₂O 与大字\n下划线与强调',
          runs: [{ start: 4, end: 5, style: { fontSize: 18, baseline: -0.3 } },
            { start: 8, end: 10, style: { fontSize: 42, bold: true, color: '#dd2200', highlightColor: '#ffff00' } },
            { start: 11, end: 14, style: { underline: true } }, { start: 15, end: 17, style: { emphasis: true } }],
          style: { fontFamily: 'Microsoft YaHei', fontSize: 28, padding: 8, lineSpacing: 24, verticalAlign: 'middle', overflow: 'fixed' } },
        { id: 'shrink-rich', width: 300, height: 90, text: '这个标题需要缩小后完整显示',
          runs: [{ start: 4, end: 8, style: { fontSize: 52, bold: true, color: '#dd2200' } }],
          style: { fontFamily: 'Microsoft YaHei', fontSize: 40, padding: 8, lineSpacing: 6, verticalAlign: 'middle', overflow: 'shrink' } },
      ]
      const result = []
      let top = 0
      for (const input of cases) {
        const node = api.create(input)
        if (input.id === 'auto-height') node.height = api.analyze(node).requiredHeight
        const section = document.createElement('section'); section.style.cssText = `position:absolute;left:0;top:${top}px;width:${(node.width + 40) * 2}px;white-space:nowrap`
        const label = document.createElement('div'); label.textContent = input.id; label.style.cssText = 'height:28px;font:18px sans-serif'; section.append(label)
        for (const visible of [false, true]) {
          const pane = document.createElement('div'); pane.id = `${input.id}-${visible ? 'visible' : 'clipped'}`
          pane.style.cssText = `position:relative;display:inline-block;background:white;width:${node.width + 40}px;height:${node.height + 40}px`
          const wrap = document.createElement('div'); wrap.style.cssText = `position:absolute;left:20px;top:20px;width:${node.width}px;height:${node.height}px`
          api.paint(wrap, { text: node.text, runs: node.runs, style: node.style }, node)
          if (visible) wrap.style.overflow = 'visible'
          pane.append(wrap); section.append(pane)
        }
        document.body.append(section)
        const first = section.querySelector('div[id] > div') as HTMLElement
        const frame = first.getBoundingClientRect()
        result.push({ id: input.id, node, analysis: api.analyze(node), frame: { x: frame.x, y: frame.y, width: frame.width, height: frame.height },
          lines: [...first.querySelectorAll<HTMLElement>('[data-text-line]')].map(row => ({ text: row.textContent, top: row.style.top, height: row.style.height, lineHeight: row.style.lineHeight })) })
        top += node.height + 76
      }
      document.body.style.height = `${top}px`
      return result
    })
    for (const fact of facts) {
      const clipped = await page.locator(`#${fact.id}-clipped`).screenshot()
      const visible = await page.locator(`#${fact.id}-visible`).screenshot()
      writeFileSync(join(root, `${fact.id}.png`), clipped)
      const left = await sharp(clipped).ensureAlpha().raw().toBuffer(), right = await sharp(visible).ensureAlpha().raw().toBuffer()
      expect(left.equals(right), `${fact.id}: overflow hidden must not remove visible glyph pixels from a fitting layout`).toBe(true)
      expect(fact.analysis.overflowsHeight).toBe(false)
      expect(fact.analysis.overflowsWidth).toBe(false)
    }
    expect(facts.filter(fact => fact.id.startsWith('single')).every(fact => fact.analysis.fontSize === 40)).toBe(true)
    expect(facts.find(fact => fact.id === 'multiline-middle')!.lines).toHaveLength(3)
    expect(facts.find(fact => fact.id === 'shrink-rich')!.analysis.fontSize).toBeLessThan(40)
    writeFileSync(join(root, 'facts.json'), JSON.stringify({ status: 'passed', cases: facts }, null, 2))
  } finally {
    await browser.close()
  }
})
