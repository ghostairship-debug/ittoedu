import { componentSurfaces } from '../../src/shared/contracts/component-platform/project'
// @vitest-environment node
import { assert, expect, it } from 'vitest'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { assembleMeasuredHtml, type HtmlDesignCapture } from '../../src/core/contentApply/assembly/htmlAssembly'
import { assemblyContentDraft } from '../../src/main/workbench/contentApply/application/html'
import { prepareMeasurementDocument, retainedMeasurementScopeHtml } from '../../src/main/workbench/contentApply/measurement/prepareMeasurementDocument'
import { planContentApply } from '../../src/main/workbench/contentApply/application/plan'
import { applyComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { buildPublishedCourseV3 } from '../../src/core/publish/componentPlatform/buildPublishedCourseV3'
import { InMemoryComponentCompilation } from '../../src/core/components/compilation/InMemoryComponentCompilation'
import { createEsbuildComponentCompiler } from '../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'

// Exact ordinary page from the actual author's project.apply input, not a new template.
const ledgerHtml = "<main style=\"position:relative;width:1280px;height:720px;overflow:hidden;box-sizing:border-box;padding:54px 70px;background:linear-gradient(135deg,#0b1726,#11253a);color:#f4f2ea;font-family:'Noto Sans SC','Microsoft YaHei',sans-serif;\">\n  <div style=\"font-size:14px;letter-spacing:.15em;font-weight:800;color:#55d6be;\">02 / 05　·　READ THE LEDGER</div>\n  <h1 style=\"font-size:43px;line-height:1.15;margin:12px 0 8px;font-weight:900;\">先守底线，再谈实验</h1>\n  <p style=\"font-size:19px;color:#c4d2de;margin:0;\">不是“把所有设备都打开”，而是看清每一度电从哪里来、先交给谁。</p>\n  <div style=\"display:grid;grid-template-columns:440px 1fr;gap:22px;margin-top:34px;\">\n    <section style=\"border:1px solid #3a566d;border-radius:18px;background:#102235;padding:24px 26px;\">\n      <div style=\"font-size:14px;color:#aec0cf;letter-spacing:.08em;\">每个模拟时段 = 1小时</div>\n      <div style=\"font-size:18px;color:#aec0cf;margin-top:20px;\">必须先供能</div>\n      <div style=\"font-size:28px;font-weight:850;line-height:1.35;margin-top:7px;\">生命保障 <span style=\"color:#55d6be\">8</span><br>基础通信 <span style=\"color:#55d6be\">2</span></div>\n      <div style=\"height:1px;background:#31485b;margin:17px 0;\"></div>\n      <div style=\"font-size:18px;color:#dce6ed;\">底线合计</div>\n      <div style=\"font-size:44px;font-weight:900;color:#55d6be;\">10 <span style=\"font-size:18px;\">kWh / 时段</span></div>\n      <div style=\"padding:12px 14px;border-radius:11px;background:#1b362f;color:#d4fff5;font-size:15px;line-height:1.5;margin-top:9px;\">底线可行条件：太阳能 + 本时段可放电电量 ≥ 10 kWh</div>\n    </section>\n    <section style=\"display:flex;flex-direction:column;gap:12px;\">\n      <div style=\"display:grid;grid-template-columns:54px 1fr;gap:14px;align-items:center;border:1px solid #31485b;border-radius:16px;padding:17px 20px;background:#112438;\">\n        <div style=\"width:46px;height:46px;border-radius:14px;background:#49391d;color:#ffc857;display:grid;place-items:center;font-size:23px;font-weight:900;\">1</div>\n        <div><div style=\"font-size:21px;font-weight:850;\">太阳能先到</div><div style=\"font-size:15px;color:#b9c8d4;margin-top:4px;\">本时段新增 0–24 kWh；先给生命保障与基础通信。</div></div>\n      </div>\n      <div style=\"display:grid;grid-template-columns:54px 1fr;gap:14px;align-items:center;border:1px solid #31485b;border-radius:16px;padding:17px 20px;background:#112438;\">\n        <div style=\"width:46px;height:46px;border-radius:14px;background:#173d3a;color:#55d6be;display:grid;place-items:center;font-size:23px;font-weight:900;\">2</div>\n        <div><div style=\"font-size:21px;font-weight:850;\">电池是有限缓冲</div><div style=\"font-size:15px;color:#b9c8d4;margin-top:4px;\">初始 12 kWh · 容量 18 kWh · 每小时最多放电 6 kWh。</div></div>\n      </div>\n      <div style=\"display:grid;grid-template-columns:54px 1fr;gap:14px;align-items:center;border:1px solid #31485b;border-radius:16px;padding:17px 20px;background:#112438;\">\n        <div style=\"width:46px;height:46px;border-radius:14px;background:#342c42;color:#c5a5ff;display:grid;place-items:center;font-size:23px;font-weight:900;\">3</div>\n        <div><div style=\"font-size:21px;font-weight:850;\">弹性目标有先后</div><div style=\"font-size:15px;color:#b9c8d4;margin-top:4px;\">追加通信 0–4 → 实验 0–8 → 充电 0–6；充电只吃实验后的剩余太阳能。</div></div>\n      </div>\n    </section>\n  </div>\n  <div style=\"position:absolute;left:70px;right:70px;bottom:47px;padding:13px 18px;border-left:4px solid #ff7a59;border-radius:0 12px 12px 0;background:#2a2025;font-size:15px;color:#f0d6cf;line-height:1.45;\"><b style=\"color:#ff997e;\">安全说明：</b>底线有缺口＝不可执行；底线满足但弹性请求欠供＝只报告实际完成量。模型忽略损耗、热控与其他负载，是解释取舍的虚构简化模拟，不是工程调度建议。</div>\n</main>"
const overlappingHtml = '<!doctype html><html><head><style>html,body{margin:0;font:20px Arial}#positioned{position:relative;width:200px;height:100px;background:rgb(200,30,60)}#inside{height:60px;background:gold}#outside{height:80px;width:200px;margin-top:-60px;background:blue}</style></head><body><div id="positioned"><div id="inside">inside</div></div><div id="outside">outside</div></body></html>'
const output = 'output/audit-remediation-20261014/remaining-20261014/granularity'

it.each([['ledger', ledgerHtml], ['cross-paint', overlappingHtml]] as const)('keeps the %s source through measurement, editable assembly and real playback', async (name, html) => {
  await mkdir(output, { recursive: true })
  const bundle = await build({ stdin: { contents: "export {captureHtmlDesignViewport} from './src/main/workbench/contentApply/measurement/browserCapture';export {cssUsesViewport} from './src/components/web/measuredFragmentBox';export {compileCoursePlayback} from './src/core/publish/componentPlatform/compileCoursePlayback';export {renderCompiledBuiltin} from './src/renderer/export/componentPlatform/renderCompiledBuiltin';export {mountCompiledCourse} from './src/player/componentPlatform/compiledPlayer';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'Granularity', target: 'es2022' })
  const browser = await chromium.launch({ headless: true })
  const evidence: { errors: string[]; requests: string[]; cases: unknown[]; pass?: boolean; failure?: string } = { errors: [], requests: [], cases: [] }
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
    page.on('pageerror', error => evidence.errors.push(error.message))
    page.on('request', request => { if (/^https?:/.test(request.url())) evidence.requests.push(request.url()) })
    {
      // Install only the software capture API before the real measurement CSP.
      await page.goto('about:blank')
      await page.setContent('<!doctype html><body></body>')
      await page.addScriptTag({ content: bundle.outputFiles[0]!.text })
      const prepared = prepareMeasurementDocument({ html })
      await page.setContent(prepared.html)
      const original = await page.evaluate(() => {
        const rect = (node: Element | null) => { if (!node) return null; const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } }
        const heading = document.querySelector('h1')
        return { heading: rect(heading), headingWeight: heading ? getComputedStyle(heading).fontWeight : undefined, headingColor: heading ? getComputedStyle(heading).color : undefined, main: rect(document.querySelector('main')), paintTarget: document.elementFromPoint(50, 80)?.id, paintColor: getComputedStyle(document.elementFromPoint(50, 80)!).backgroundColor }
      })
      await page.screenshot({ path: output + '/' + name + '-source.png' })
      const capture = await page.evaluate(() => { const api = (window as any).Granularity; return api.captureHtmlDesignViewport(200, api.cssUsesViewport) }) as HtmlDesignCapture
      for (const element of capture.elements) {
        const source = prepared.originalElements.get(element.sourcePath.join('/'))
        if (source) { element.attributes = source.attributes; element.sourceHtml = source.sourceHtml }
      }
      for (const scope of capture.sourceScopes ?? []) scope.html = retainedMeasurementScopeHtml({ html }, capture.elements[scope.index]!.sourcePath)
      const assembly = assembleMeasuredHtml(capture, { html })
      const draft = assemblyContentDraft(assembly, {}, { definitions: {}, createFormulaId: () => crypto.randomUUID() })
      const blank = createBlankCourseProjectV10('Original ' + name)
      const planned = planContentApply({ project: blank, createId: () => crypto.randomUUID(), request: { intent: 'insert', target: { kind: 'container', container: { kind: 'surface', surfaceId: componentSurfaces(blank)[0]!.id } }, source: { kind: 'objects', objects: [draft.draft], definitions: draft.definitions } } })
      const project = applyComponentOperation(blank, planned.command)
      const instances = Object.values(project.instances).filter(instance => !instance.container)
      expect(project.rootIds).toEqual(blank.rootIds)
      expect(Object.values(project.instances).filter(instance => instance.container)).toHaveLength(1)
      const texts = instances.filter(instance => instance.definitionId === 'guoling.text')
      const caseEvidence: any = { name, original, scopeReasons: capture.sourceScopes?.map(scope => ({ sourcePath: capture.elements[scope.index]!.sourcePath, reason: scope.reason })), rootKind: assembly.root.kind, instanceCount: instances.length, textCount: texts.length, assemblyDiagnostics: assembly.diagnostics, draftDiagnostics: draft.diagnostics }
      evidence.cases.push(caseEvidence)
      await writeFile(output + '/' + name + '-capture.json', JSON.stringify(capture, null, 2))
      await writeFile(output + '/' + name + '-project.json', JSON.stringify(project, null, 2))
      if (name === 'ledger') {
        expect(capture.sourceScopes?.some(scope => scope.index === capture.body)).toBeFalsy()
        expect(assembly.root.kind).toBe('group')
        expect(instances.length).toBeGreaterThan(2)
        expect(texts.length).toBeGreaterThan(0)
        const heading = instances.find(instance => {
          const data = instance.data
          return instance.definitionId === 'guoling.web' && data !== null && typeof data === 'object' && !Array.isArray(data)
            && typeof data.html === 'string' && data.html.includes('先守底线，再谈实验')
        })
        expect(heading).toBeDefined()
        assert(heading && heading.frame, 'The extracted heading must have a frame')
        assert(heading.data !== null && typeof heading.data === 'object' && !Array.isArray(heading.data), 'The web heading must retain its HTML data')
        expect(heading.frame.height).toBeLessThan(120)
        expect(heading.data.html).not.toBe(html)
        expect(texts.some(instance => JSON.stringify(instance.data).includes('必须先供能'))).toBe(true)
      } else {
        expect(original.paintTarget).toBe('positioned')
        expect(capture.sourceScopes).toEqual(expect.arrayContaining([expect.objectContaining({ index: capture.body, reason: 'positioned-paint-order' })]))
        expect(assembly.root.kind).toBe('web')
        expect(instances.length).toBe(1)
      }
      const published = await buildPublishedCourseV3({ project, assetBytes: {} }, { compilation: new InMemoryComponentCompilation(createEsbuildComponentCompiler()) })
      // A new document ends the measurement-only CSP before the playback carrier.
      await page.goto('about:blank')
      await page.setContent('<!doctype html><style>html,body{margin:0;width:100%;height:100%}#root{width:1280px;height:720px}</style><div id="root"></div>')
      await page.addScriptTag({ content: bundle.outputFiles[0]!.text })
      await page.evaluate(async serialized => {
        const api = (window as any).Granularity, input = JSON.parse(serialized)
        const artifact = await api.compileCoursePlayback(input.payload, { document, renderBuiltin: (instance: any, key: string, value: any) => api.renderCompiledBuiltin(instance, key, value, document) })
        ;(window as any).artifact = artifact
        ;(window as any).player = await api.mountCompiledCourse(artifact, document.getElementById('root'), { report: (message: string) => ((window as any).reports ??= []).push(message) })
      }, JSON.stringify({ payload: published.payload }))
      const actual = await page.evaluate(() => {
        const rect = (node: Element | null) => { if (!node) return null; const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } }
        const scopes = [...document.querySelectorAll('*')].flatMap(node => node.shadowRoot ? [node.shadowRoot] : [])
        const all = (selector: string) => scopes.flatMap(scope => [...scope.querySelectorAll(selector)])
        const crossing = scopes.find(scope => scope.querySelector('#positioned'))
        const hit = crossing?.elementFromPoint(50, 80)
        const heading = all('h1')[0]
        return { heading: rect(heading ?? null), headingWeight: heading ? getComputedStyle(heading).fontWeight : undefined, headingColor: heading ? getComputedStyle(heading).color : undefined, main: rect(all('main[data-guoling-measured-group]')[0] ?? null), paintTarget: hit?.id, paintColor: hit ? getComputedStyle(hit).backgroundColor : undefined, professionalTexts: [...document.querySelectorAll('[data-text-component-content]')].map(node => ({ text: node.textContent, rect: rect(node) })), frames: document.querySelectorAll('iframe').length, diagnostics: (window as any).artifact.diagnostics, reports: (window as any).reports ?? [] }
      })
      caseEvidence.actual = actual
      await page.screenshot({ path: output + '/' + name + '-actual.png' })
      if (name === 'ledger') {
        expect(actual.heading).toEqual(original.heading)
        expect(actual.headingWeight).toBe(original.headingWeight)
        expect(actual.headingWeight).toBe('900')
        expect(actual.headingColor).toBe(original.headingColor)
        expect(actual.main).toEqual(original.main)
        expect(actual.professionalTexts.some(value => value.text?.includes('必须先供能'))).toBe(true)
      } else {
        expect(actual.paintTarget).toBe(original.paintTarget)
        expect(actual.paintColor).toBe(original.paintColor)
      }
      expect(actual.frames).toBe(0)
      expect(actual.diagnostics).toEqual([])
      expect(actual.reports).toEqual([])
      await page.evaluate(() => (window as any).player.dispose())
      expect(await page.locator('#root').evaluate(node => node.childElementCount)).toBe(0)
    }
    expect(evidence.errors).toEqual([])
    expect(evidence.requests).toEqual([])
    evidence.pass = true
  } catch (error) { evidence.failure = String(error); throw error }
  finally { await writeFile(output + '/' + name + '-facts.json', JSON.stringify(evidence, null, 2)); await browser.close() }
}, 30000)

