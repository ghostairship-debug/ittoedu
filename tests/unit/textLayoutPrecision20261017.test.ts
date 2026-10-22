// @vitest-environment node
import { testContainerInstance } from '../helpers/glxWorkFixture'
import { expect, it } from 'vitest'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform'

const output = 'output/text-layout-precision-20261017'
const fixturePath = 'tests/fixtures/textLayoutPrecision20261017.json'

it('keeps the frozen example on one line through the shared Player runtime, while a real narrower box still wraps', async () => {
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as {
    source: { path: string; projectId: string; revision: number; surfaceId: string }
    exampleId: string; equationId: string; previousId: string; nextId: string; backgroundId: string
    project: CourseProjectV10
  }
  type FrozenFixture = typeof fixture
  const bundle = await build({ stdin: { contents: `export {mountV10Model} from './src/player/componentPlatform/ModelPlayer';`,
    resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'browser', format: 'iife',
    globalName: 'TextPrecision', target: 'es2022' })
  const browser = await chromium.launch({ headless: true })
  await mkdir(output, { recursive: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
    await page.setContent('<!doctype html><style>html,body,#player{margin:0;width:100%;height:100%;overflow:hidden}</style><div id="player"></div>')
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text })
    const facts = await page.evaluate(async (value: unknown) => {
      const fixture = value as FrozenFixture
      const project = structuredClone(fixture.project)
      const original = structuredClone(project)
      const reports: string[] = []
      const model = () => ({ kind: 'course-v10', project, resources: { assets: {}, components: {} } })
      const player = (window as any).TextPrecision.mountV10Model({ root: document.querySelector('#player'),
        model: model(), runScopeId: 'text-layout-precision', initialSurfaceId: testContainerInstance(project, 0).id,
        mode: 'play', report: (message: string) => reports.push(message) })
      const settle = async () => {
        await player.ready
        await document.fonts.ready
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      }
      const object = (id: string) => document.querySelector<HTMLElement>(`[data-component-object="${id}"]`)!
      const rect = (element: Element) => {
        const box = element.getBoundingClientRect()
        return { x: box.x, y: box.y, width: box.width, height: box.height, bottom: box.bottom }
      }
      const text = (id: string) => {
        const outer = object(id)
        const content = outer.querySelector<HTMLElement>('[data-text-component-content]')!
        const range = document.createRange(); range.selectNodeContents(content)
        const ink = range.getBoundingClientRect()
        const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT)
        const tops: number[] = []
        let node: Node | null
        while ((node = walker.nextNode())) for (let i = 0; i < (node.textContent?.length ?? 0); i++) {
          const character = document.createRange(); character.setStart(node, i); character.setEnd(node, i + 1)
          if (node.textContent?.[i] !== '\n') tops.push(Math.round(character.getBoundingClientRect().top * 64) / 64)
        }
        const style = getComputedStyle(content)
        return { outer: rect(outer), content: rect(content), ink: { top: ink.top, bottom: ink.bottom, height: ink.height },
          lineTops: [...new Set(tops)], fontSize: style.fontSize, fontFamily: style.fontFamily,
          text: content.textContent, overflow: outer.querySelector<HTMLElement>('[data-text-component]')!.dataset.textOverflow }
      }
      const siblings = () => Object.fromEntries([fixture.previousId, fixture.equationId, fixture.nextId, fixture.backgroundId]
        .map(id => [id, { frame: structuredClone(project.instances[id].frame), rect: rect(object(id)) }]))
      await settle()
      const before = { example: text(fixture.exampleId), equation: text(fixture.equationId), next: text(fixture.nextId), siblings: siblings() }
      ;(window as any).precisionPlayer = player
      const frame = project.instances[fixture.exampleId].frame!
      const authoredData = structuredClone(project.instances[fixture.exampleId].data)
      frame.width -= 80
      await player.update(model()); await settle()
      const narrow = { example: text(fixture.exampleId), siblings: siblings(), data: structuredClone(project.instances[fixture.exampleId].data),
        frame: structuredClone(frame) }
      frame.width = original.instances[fixture.exampleId].frame!.width
      await player.update(model()); await settle()
      const restored = { example: text(fixture.exampleId), siblings: siblings() }
      return { source: fixture.source, before, narrow, restored, reports,
        authoredData, originalProject: original, resultingProject: structuredClone(project) }
    }, fixture as unknown)
    await page.screenshot({ path: `${output}/player-restored.png` })
    await writeFile(`${output}/player-facts.json`, JSON.stringify(facts, null, 2))
    expect(facts.reports).toEqual([])
    expect(facts.before.example.lineTops).toHaveLength(1)
    expect(facts.before.example.ink.bottom).toBeLessThanOrEqual(facts.before.equation.ink.top)
    expect(facts.before.equation.lineTops).toHaveLength(1)
    expect(facts.before.equation.ink.bottom).toBeLessThanOrEqual(facts.before.next.ink.top)
    expect(facts.before.example.fontSize).toBe('22px')
    expect(facts.before.equation.fontSize).toBe('28px')
    expect(facts.narrow.example.lineTops.length).toBeGreaterThan(1)
    expect(facts.narrow.example.fontSize).toBe(facts.before.example.fontSize)
    expect(facts.narrow.data).toEqual(facts.authoredData)
    expect(facts.narrow.siblings).toEqual(facts.before.siblings)
    expect(facts.restored.example).toEqual(facts.before.example)
    expect(facts.restored.siblings).toEqual(facts.before.siblings)
    expect(facts.resultingProject).toEqual(facts.originalProject)
    await page.evaluate(async () => { await (window as any).precisionPlayer.dispose() })
  } finally { await browser.close() }
}, 30000)
