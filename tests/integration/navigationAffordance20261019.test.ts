// @vitest-environment node
import { expect, it } from 'vitest'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { JSDOM } from 'jsdom'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { buildPublishedCourseV3 } from '../../src/core/publish/componentPlatform/buildPublishedCourseV3'
import { compileCoursePlayback } from '../../src/core/publish/componentPlatform/compileCoursePlayback'
import { createTextComponentData, type TextComponentData } from '../../src/components/text/data'
import { textComponentHtml } from '../../src/components/text/render'
import { INTERACTIONS_DEFINITION } from '../../src/shared/componentInteractionData'
import type { InteractionRule } from '../../src/shared/interactionTypes'

it('runs ordinary authored page presets and live click affordances in Published and compiled carriers', async () => {
  const project = createBlankCourseProjectV10('导航预置与点击可供性')
  const frame = (y: number) => ({ width: 300, height: 70, transform: [1, 0, 0, 1, 80, y] as [number, number, number, number, number, number] })
  project.surfaces = [{ id: 'A', kind: 'slide', title: '观察', childIds: ['go', 'author'], designSize: { width: 800, height: 600 } },
    { id: 'B', kind: 'slide', title: '验证', childIds: ['back'], designSize: { width: 800, height: 600 } }]
  project.definitions.text = { id: 'text', role: 'content', implementation: { kind: 'builtin', key: 'guoling.text' } }
  project.definitions[INTERACTIONS_DEFINITION.id] = INTERACTIONS_DEFINITION
  for (const [index, id] of ['go', 'author', 'back'].entries()) project.instances[id] = {
    id, definitionId: 'text', data: JSON.parse(JSON.stringify(createTextComponentData(id === 'go' ? '点击前往验证' : id === 'author' ? '作者显式帮助光标' : '返回观察'))),
    frame: frame(120 + index * 90), ...(id === 'author' ? { style: { cursor: 'help' } } : {}),
  }
  const rule = (id: string, nodeId: string, action: InteractionRule['actions'][number]['action']): InteractionRule => ({
    id, name: id, enabled: true, trigger: { type: 'node.click', nodeId }, conditions: [],
    actions: [{ id: id + '-action', start: 'after-previous', delayMs: 0, action }],
  })
  const go = rule('go-rule', 'go', { type: 'location.go', locationId: 'B', transition: { effect: 'slide', direction: 'left', durationMs: 450, easing: 'linear' } })
  go.conditions = [{ type: 'course-state.compare', key: 'ready', operator: 'eq', value: true }]
  project.instances.rules = { id: 'rules', definitionId: INTERACTIONS_DEFINITION.id, data: JSON.parse(JSON.stringify({ rules: [go,
    rule('help-rule', 'author', { type: 'course-state.set', key: 'help', value: true }),
    rule('back-rule', 'back', { type: 'scene.previous', transition: { effect: 'zoom', durationMs: 450 } }),
  ] })) }
  project.global.underlay.push('rules')
  const published = await buildPublishedCourseV3({ project, assetBytes: {} })
  const dom = new JSDOM('<!doctype html>')
  const artifact = await compileCoursePlayback(published.payload, { document: dom.window.document,
    renderBuiltin: async instance => textComponentHtml(instance.data as unknown as TextComponentData) })
  dom.window.close()
  expect(artifact.diagnostics).toEqual([])
  const bundle = await build({ stdin: { contents: `export {mountPublishedCourseV3} from './src/player/componentPlatform/publishedPlayer';export {mountCompiledCourse} from './src/player/componentPlatform/compiledPlayer';`,
    resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'iife', globalName: 'NavigationAffordance', platform: 'browser', target: 'es2022',
    plugins: [{ name: 'fixture-raw', setup(plugin) {
      plugin.onResolve({ filter: /\?raw$/ }, args => ({ path: resolve(args.resolveDir, args.path.slice(0, -4)), namespace: 'raw' }))
      plugin.onLoad({ filter: /.*/, namespace: 'raw' }, async args => ({ contents: await readFile(args.path, 'utf8'), loader: 'text', resolveDir: dirname(args.path) }))
    } }] })
  const browser = await chromium.launch({ headless: true }), evidence: Record<string, unknown> = {}, errors: string[] = []
  const output = resolve('output/architecture-remediation-20261019/current-execution/navigation')
  await mkdir(output, { recursive: true })
  try {
    for (const carrier of ['published', 'compiled'] as const) {
      const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
      page.on('pageerror', error => errors.push(error.message))
      await page.setContent('<!doctype html><style>html,body{margin:0}#root{width:800px;height:600px}</style><main id="root"></main>')
      await page.addScriptTag({ content: bundle.outputFiles[0]!.text })
      await page.evaluate(async serialized => {
        const { carrier, payload, artifact, project } = JSON.parse(serialized)
        const w = window as any, reports: string[] = []
        w.navProbe = { reports, project }
        const api = w.NavigationAffordance, root = document.getElementById('root')!
        w.navProbe.player = await (carrier === 'published' ? api.mountPublishedCourseV3(payload, root, { report: (m: string) => reports.push(m), keyboardNavigation: false })
          : api.mountCompiledCourse(artifact, root, { report: (m: string) => reports.push(m), keyboardNavigation: false }))
      }, JSON.stringify({ carrier, payload: published.payload, artifact, project }))
      const cursor = (id: string) => page.evaluate(id => {
        const element = (window as any).navProbe.player.runtime.targetElement(id)
        return { cursor: getComputedStyle(element).cursor, derived: element.hasAttribute('data-guoling-node-click') }
      }, id)
      const click = async (id: string) => {
        const point = await page.evaluate(id => {
          const rect = (window as any).navProbe.player.runtime.targetElement(id).getBoundingClientRect()
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
        }, id)
        await page.mouse.click(point.x, point.y)
      }
      const hitCursor = (id: string) => page.evaluate(id => {
        const element = (window as any).navProbe.player.runtime.targetElement(id), rect = element.getBoundingClientRect()
        return getComputedStyle(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)!).cursor
      }, id)
      expect((await cursor('go')).derived).toBe(false)
      await click('go')
      expect(await page.evaluate(() => (window as any).navProbe.player.navigation.readLocation())).toBe('A')
      await page.evaluate(() => (window as any).navProbe.player.runtime.setState('ready', true))
      expect(await cursor('go')).toEqual({ cursor: 'pointer', derived: true })
      expect(await cursor('author')).toEqual({ cursor: 'help', derived: true })
      expect(await hitCursor('go')).toBe('pointer')
      expect(await hitCursor('author')).toBe('help')
      await page.evaluate(() => (window as any).navProbe.player.runtime.setPlaying(false))
      expect((await cursor('go')).derived).toBe(false)
      await page.evaluate(() => (window as any).navProbe.player.runtime.setPlaying(true))
      expect((await cursor('go')).derived).toBe(true)
      await click('go')
      await page.waitForFunction(() => (window as any).navProbe.player.navigation.readLocation() === 'B' && document.getAnimations().some(a => (a.effect as KeyframeEffect)?.pseudoElement?.startsWith('::view-transition-old')))
      const slide = await page.evaluate(() => document.getAnimations().filter(a => (a.effect as KeyframeEffect)?.pseudoElement?.startsWith('::view-transition-')).map(a => ({ duration: a.effect!.getTiming().duration, frames: (a.effect as KeyframeEffect).getKeyframes() })))
      expect(slide.some(track => track.duration === 450 && track.frames.some(frame => frame.transform === 'translateX(-8%)'))).toBe(true)
      expect((await cursor('go')).derived).toBe(false)
      await page.screenshot({ path: resolve(output, carrier + '-slide.png') })
      await page.waitForFunction(() => !document.getAnimations().some(a => (a.effect as KeyframeEffect)?.pseudoElement?.startsWith('::view-transition-')))
      await click('back')
      await page.waitForFunction(() => (window as any).navProbe.player.navigation.readLocation() === 'A' && document.getAnimations().some(a => (a.effect as KeyframeEffect)?.pseudoElement?.startsWith('::view-transition-old')))
      const zoom = await page.evaluate(() => document.getAnimations().filter(a => (a.effect as KeyframeEffect)?.pseudoElement?.startsWith('::view-transition-')).map(a => (a.effect as KeyframeEffect).getKeyframes()))
      expect(zoom.some(frames => frames.some(frame => frame.transform === 'scale(1.04)'))).toBe(true)
      const cancellation = await page.evaluate(async () => {
        const p = (window as any).navProbe.player
        const accepted = await p.navigation.execute({ type: 'scene.go', sceneId: 'B', transition: { effect: 'none' } })
        return { accepted, location: p.navigation.readLocation(), visuals: document.getAnimations().filter(a => (a.effect as KeyframeEffect)?.pseudoElement?.startsWith('::view-transition-')).length }
      })
      expect(cancellation).toEqual({ accepted: true, location: 'B', visuals: 0 })
      await page.evaluate(async () => { const p = (window as any).navProbe.player; await p.navigation.execute({ type: 'scene.previous' }); p.runtime.setState('ready', false) })
      expect((await cursor('go')).derived).toBe(false)
      await page.evaluate(async () => {
        const q = (window as any).navProbe
        q.player.runtime.setState('ready', true)
        q.project = structuredClone(q.project)
        q.project.instances.rules.data.rules[0].enabled = false
        await q.player.runtime.sync(q.project, { assets: {}, components: {} })
      })
      expect((await cursor('go')).derived).toBe(false)
      await click('go')
      expect(await page.evaluate(() => (window as any).navProbe.player.navigation.readLocation())).toBe('A')
      await page.evaluate(async () => {
        const q = (window as any).navProbe
        q.project = structuredClone(q.project)
        q.project.instances.rules.data.rules[0].enabled = true
        await q.player.runtime.sync(q.project, { assets: {}, components: {} })
      })
      expect((await cursor('go')).derived).toBe(true)
      const retirement = await page.evaluate(async () => {
        const q = (window as any).navProbe, p = q.player, old = p.runtime.targetElement('go')
        p.runtime.setState('ready', true)
        const replacement = old.cloneNode(true) as HTMLElement; old.replaceWith(replacement); p.runtime.bindTarget('go', replacement)
        const result = { old: old.hasAttribute('data-guoling-node-click'), replacement: replacement.hasAttribute('data-guoling-node-click') }
        p.runtime.bindTarget('go', null)
        const unbound = replacement.hasAttribute('data-guoling-node-click')
        await p.dispose()
        return { ...result, unbound, retainedAfterDispose: document.querySelectorAll('[data-guoling-node-click]').length, reports: q.reports }
      })
      // The deliberately replaced back action reports its existing incomplete outcome.
      expect(retirement).toEqual({ old: false, replacement: true, unbound: false, retainedAfterDispose: 0,
        reports: ['互动“back-rule”的动作 scene.previous 未完成'] })
      evidence[carrier] = { slide, zoom, cancellation, retirement }
      await page.close()
    }
    expect(errors).toEqual([])
  } finally { await writeFile(resolve(output, 'actual.json'), JSON.stringify({ ...evidence, errors }, null, 2)); await browser.close() }
}, 30000)
