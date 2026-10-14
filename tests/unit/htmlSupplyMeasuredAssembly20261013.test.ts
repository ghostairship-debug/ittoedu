// @vitest-environment node
import { expect, it } from 'vitest'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { assembleMeasuredHtml, type HtmlDesignCapture } from '../../src/core/contentApply/assembly/htmlAssembly'
import { assemblyContentDraft } from '../../src/main/workbench/contentApply/application/html'
import { retainedMeasurementScopeHtml } from '../../src/main/workbench/contentApply/measurement/prepareMeasurementDocument'
import { planContentApply } from '../../src/main/workbench/contentApply/application/plan'
import { applyComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { buildPublishedCourseV3 } from '../../src/core/publish/componentPlatform/buildPublishedCourseV3'
import { InMemoryComponentCompilation } from '../../src/core/components/compilation/InMemoryComponentCompilation'
import { createEsbuildComponentCompiler } from '../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'

// Exact first authored supply page: browser layout is the reference, not a new author template.
const html = '<!doctype html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box}html,body{margin:0;width:1280px;height:720px;background:#0b1725;color:#eef5ff;font:20px/1.45 Arial}body{padding:42px 56px}h1{font-size:38px;margin:0 0 8px}.sub{color:#a9bfd1}.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:24px}.card{background:#14283a;border:1px solid #29465a;border-radius:16px;padding:20px}.sun{color:#ffd278}.cyan{color:#70d6c2}.bar{height:16px;background:#243b4d;border-radius:10px;margin:8px 0 16px;overflow:hidden}.bar i{display:block;height:100%;background:#70d6c2;border-radius:10px}.note{margin-top:18px;padding:15px 20px;background:#1b2d3a;border-left:4px solid #ffd278;border-radius:8px}.foot{position:absolute;bottom:28px;color:#9eb2c2;font-size:16px}</style></head><body><h1>值班窗口｜先看供需</h1><div class="sub">把一班次想成一次能量预算；所有数字均为教学用假设，不是航天工程参数。</div><div class="grid"><div class="card"><b class="sun">☀ 太阳能输入</b><p>稳定日照情境：<b>100 能量单位 / 班次</b></p><div class="bar"><i style="width:100%"></i></div><b>低照情境：70 单位 / 班次</b><div class="bar"><i style="width:70%"></i></div></div><div class="card"><b class="cyan">四项可分配用途</b><p>生命保障：最低 40；通信：最低 10</p><p>实验：0–30（可削减）</p><p>电池充电：0–40（留给下一班）</p></div></div><div class="note"><b>规则：</b>总分配不得超过本班输入；生命保障 40 与通信 10 是简化模型里的底线。未分配能量不自动储存。低照只有 70，如何分配由你决定。</div><div class="foot">下一页进入调度台；任何时候都可用上一页返回本说明。</div></body></html>'
const output = 'output/repair-real-authoring-20261013/layout/focused'

it('keeps the original supply grid, subpixel inline labels and editable frames through measurement and real playback', async () => {
  await mkdir(output, { recursive: true })
  const bundle = await build({ stdin: { contents: `export {captureHtmlDesignViewport} from './src/main/workbench/contentApply/measurement/browserCapture';export {cssUsesViewport} from './src/components/web/measuredFragmentBox';export {compileCoursePlayback} from './src/core/publish/componentPlatform/compileCoursePlayback';export {renderCompiledBuiltin} from './src/renderer/export/componentPlatform/renderCompiledBuiltin';export {mountCompiledCourse} from './src/player/componentPlatform/compiledPlayer';`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'SupplyAssembly', target: 'es2022' })
  const browser = await chromium.launch({ headless: true })
  const evidence: { errors: string[]; requests: string[]; actual?: unknown; assemblyDiagnostics?: unknown; draftDiagnostics?: unknown; pass?: boolean; failure?: string } = { errors: [], requests: [] }
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
    page.on('pageerror', error => evidence.errors.push(error.message))
    page.on('request', request => { if (/^https?:/.test(request.url())) evidence.requests.push(request.url()) })
    await page.setContent(html)
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text })
    const capture = await page.evaluate(() => { const api = (window as any).SupplyAssembly; return api.captureHtmlDesignViewport(200, api.cssUsesViewport) }) as HtmlDesignCapture
    for (const scope of capture.sourceScopes ?? []) scope.html = retainedMeasurementScopeHtml({ html }, capture.elements[scope.index]!.sourcePath)
    const sun = capture.elements.find(element => element.attributes.class === 'sun')!
    expect(sun.geometryIssue).toBeUndefined()
    expect(sun.frame?.width).toBeCloseTo(122.421875, 4)
    const assembly = assembleMeasuredHtml(capture, { html })
    expect(assembly.diagnostics).toEqual([])
    const draft = assemblyContentDraft(assembly, {}, { definitions: {}, createFormulaId: () => crypto.randomUUID() })
    const original = createBlankCourseProjectV10('Original supply page')
    const planned = planContentApply({ project: original, createId: () => crypto.randomUUID(), request: { intent: 'insert', target: { kind: 'container', container: { kind: 'surface', surfaceId: original.surfaces[0]!.id } }, source: { kind: 'objects', objects: [draft.draft], definitions: draft.definitions } } })
    const project = applyComponentOperation(original, planned.command)
    const texts = Object.values(project.instances).filter(instance => instance.definitionId === 'guoling.text')
    const textOf = (value: typeof texts[number]) => (value.data as { content: { inlines: Array<{ text?: string }> } }).content.inlines.map(inline => inline.text ?? '').join('')
    const ids = Object.fromEntries(texts.map(value => [textOf(value), value.id]))
    expect(ids['☀ 太阳能输入']).toBeDefined()
    expect(ids['低照情境：70 单位 / 班次']).toBeDefined()
    expect(ids['稳定日照情境：100 能量单位 / 班次']).toBeDefined()
    const stable = texts.find(value => textOf(value) === '稳定日照情境：100 能量单位 / 班次')!
    expect(stable.data).toMatchObject({ content: { inlines: [{ text: '稳定日照情境：' }, { text: '100 能量单位 / 班次', style: { bold: true } }] } })
    const published = await buildPublishedCourseV3({ project, assetBytes: {} }, { compilation: new InMemoryComponentCompilation(createEsbuildComponentCompiler()) })
    await writeFile(`${output}/project.json`, JSON.stringify(project, null, 2))
    await page.setContent('<!doctype html><style>html,body{margin:0;width:100%;height:100%}#root{width:1280px;height:720px}</style><div id="root"></div>')
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text })
    await page.evaluate(async serialized => {
      const api = (window as any).SupplyAssembly, input = JSON.parse(serialized)
      const artifact = await api.compileCoursePlayback(input.payload, { document, renderBuiltin: (instance: any, key: string, value: any) => api.renderCompiledBuiltin(instance, key, value, document) })
      ;(window as any).artifact = artifact
      ;(window as any).player = await api.mountCompiledCourse(artifact, document.getElementById('root'), { report: (message: string) => ((window as any).reports ??= []).push(message) })
    }, JSON.stringify({ payload: published.payload }))
    const actual = await page.evaluate(input => {
      const rect = (value: Element | DOMRect) => { const r = value instanceof Element ? value.getBoundingClientRect() : value; return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom, right: r.right } }
      const scopes = [...document.querySelectorAll('*')].flatMap(node => node.shadowRoot ? [node.shadowRoot] : [])
      const all = (selector: string) => scopes.flatMap(scope => [...scope.querySelectorAll(selector)])
      const text = (key: string) => {
        const owner = document.querySelector(`[data-compiled-runtime-root="${input[key]}"]`)!, content = owner.querySelector('[data-text-component-content]')!
        const range = document.createRange(); range.selectNodeContents(content)
        return { rect: rect(owner), glyphs: [...range.getClientRects()].map(rect), text: owner.textContent }
      }
      return { cards: all('.card').map(rect), bars: all('.bar').map(node => ({ rect: rect(node), fills: [...node.children].map(rect) })), sun: text('☀ 太阳能输入'), stable: text('稳定日照情境：100 能量单位 / 班次'), low: text('低照情境：70 单位 / 班次'), note: all('.note').map(rect), frames: document.querySelectorAll('iframe').length, diagnostics: (window as any).artifact.diagnostics, reports: (window as any).reports ?? [] }
    }, ids)
    evidence.actual = actual; evidence.assemblyDiagnostics = assembly.diagnostics; evidence.draftDiagnostics = draft.diagnostics
    expect(actual.cards).toEqual([{ x: 56, y: 158.09375, width: 575, height: 241, bottom: 399.09375, right: 631 }, { x: 649, y: 158.09375, width: 575, height: 241, bottom: 399.09375, right: 1224 }])
    expect(actual.sun.glyphs).toHaveLength(1)
    expect(actual.low.glyphs).toHaveLength(1)
    expect(Math.max(...actual.stable.glyphs.map(value => value.bottom))).toBeLessThan(Math.min(...actual.low.glyphs.map(value => value.y)))
    expect(actual.bars).toHaveLength(2)
    expect(actual.bars[0]!.rect).toMatchObject({ x: 77, y: 277.09375, width: 533, height: 16 })
    expect(actual.bars[0]!.fills[0]!.width).toBe(533)
    expect(actual.bars[1]!.fills[0]!.width).toBeCloseTo(373.1, 1)
    expect(actual.note[0]!.bottom).toBe(505.09375)
    expect(actual.frames).toBe(0); expect(actual.diagnostics).toEqual([]); expect(actual.reports).toEqual([])
    expect(evidence.errors).toEqual([]); expect(evidence.requests).toEqual([])
    await page.screenshot({ path: `${output}/actual.png` })
    await page.evaluate(() => (window as any).player.dispose())
    expect(await page.locator('#root').evaluate(node => node.childElementCount)).toBe(0)
    evidence.pass = true
  } catch (error) { evidence.failure = String(error); throw error }
  finally { await writeFile(`${output}/facts.json`, JSON.stringify(evidence, null, 2)); await browser.close() }
}, 30000)
