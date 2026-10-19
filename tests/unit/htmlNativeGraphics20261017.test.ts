// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { professionalHtmlDraft } from '../../src/main/workbench/contentApply/application/professionalHtml'
import { shapeDataSchema } from '../../src/components/shape/data'
import { assembleMeasuredHtml, type HtmlAssemblyObject, type HtmlDesignCapture, type HtmlObjectContent } from '../../src/core/contentApply/assembly/htmlAssembly'
import type { ContentObjectDraft } from '../../src/main/workbench/contentApply/application/types'

const element = (style: Record<string, string>, children: HtmlObjectContent[] = []): Extract<HtmlObjectContent, { kind: 'element' }> =>
  ({ kind: 'element', tagName: 'div', attributes: {}, style, pseudoElements: {}, children })
const box = (style: Record<string, string>, kind: HtmlAssemblyObject['kind'] = 'web'): HtmlAssemblyObject =>
  ({ kind, label: 'box', sourcePath: [0], frame: { width: 200, height: 100, transform: [1, 0, 0, 1, 37, 58] },
    style, pseudoElements: {}, content: element(style), children: [], decorations: [], sourceRegions: [] })
const flatten = (draft: ContentObjectDraft): ContentObjectDraft[] => [draft, ...(draft.children ?? []).flatMap(flatten)]

describe('measured HTML native graphics', () => {
  it('keeps a meaningful group and paints its border without shifting measured child coordinates', () => {
    const style = { 'background-color': 'rgb(20,40,60)', 'border-radius': '16px', opacity: '0.7', overflow: 'hidden',
      ...Object.fromEntries(['top', 'right', 'bottom', 'left'].flatMap(side => [[`border-${side}-width`, '4px'], [`border-${side}-style`, 'solid'], [`border-${side}-color`, 'rgb(1,2,3)']])) }
    const object = box(style, 'group')
    const result = professionalHtmlDraft(object, {}, () => 'formula')!
    expect(result.kind).toBe('native')
    if (result.kind !== 'native') return
    expect(result.definition.implementation).toEqual({ kind: 'builtin', key: 'guoling.group' })
    expect(result.draft.frame).toEqual(object.frame)
    expect(result.draft.style).toMatchObject({ opacity: '0.7', overflow: 'hidden', 'border-radius': '16px' })
    expect(result.draft.style).not.toHaveProperty('border-left-width')
    expect(result.draft.children).toHaveLength(1)
    const background = result.draft.children![0]!, data = shapeDataSchema.parse(background.data)
    expect(background.frame?.transform).toEqual([1, 0, 0, 1, 0, 0])
    expect(data.style).toMatchObject({ fillColor: 'rgb(20,40,60)', borderWidth: 4, cornerRadius: 16 })
    expect(data.pathGeometry?.paths[0]?.commands[0]).toEqual({ kind: 'move', to: [16 / 200, 2 / 100] })
  })

  it('uses editable shape data for a plain color block and retains unsupported CSS locally', () => {
    const result = professionalHtmlDraft(box({ 'background-color': 'rgba(40,80,120,0.5)', 'border-radius': '12px' }), {}, () => 'formula')!
    expect(result.kind).toBe('native')
    if (result.kind === 'native') {
      expect(result.definition.id).toBe('guoling.shape')
      expect(shapeDataSchema.parse(result.draft.data)).toMatchObject({ shapeType: 'rounded-rectangle', style: { fillOpacity: 0.5, borderWidth: 0, cornerRadius: 12 } })
      expect(result.draft.style).not.toHaveProperty('background-color')
    }
    expect(professionalHtmlDraft(box({ 'background-image': 'linear-gradient(red,blue)' }), {}, () => 'formula')).toMatchObject({ kind: 'web', diagnostic: { message: expect.stringContaining('background-image') } })
  })

  it('keeps unsupported sharp SVG stroke joins as a local SVG instead of rounding them', () => {
    const object = box({}, 'svg')
    object.content = { ...element({}), tagName: 'svg', attributes: { viewBox: '0 0 100 100' }, children: [
      { ...element({ fill: 'none', stroke: '#000', 'stroke-width': '12px', 'stroke-linejoin': 'miter' }), tagName: 'path', attributes: { d: 'M10 90L50 10L90 90' } },
      { ...element({ fill: '#f00' }), tagName: 'rect', attributes: { x: '5', y: '5', width: '20', height: '10' } },
    ] }
    const result = professionalHtmlDraft(object, {}, () => 'formula')!
    expect(result.kind).toBe('native')
    if (result.kind !== 'native') return
    expect(result.draft.children?.map(child => child.definitionId)).toEqual(['guoling.web', 'guoling.shape'])
    expect(result.diagnostics?.[0]?.message).toContain('尖角连接')
  })

  it('keeps local SVG definitions, root context and resource bindings with retained parts', () => {
    const object = box({}, 'svg')
    object.content = { ...element({}), tagName: 'svg', attributes: { viewBox: '0 0 100 100', class: 'campus' }, children: [
      { ...element({}), tagName: 'defs', children: [{ ...element({}), tagName: 'linearGradient', attributes: { id: 'paint' } }] },
      { ...element({ fill: 'url("about:blank#paint")' }), tagName: 'rect', attributes: { width: '20', height: '10' } },
      { ...element({}), tagName: 'image', attributes: { href: 'logo.png', width: '10', height: '10' } },
    ] }
    const result = professionalHtmlDraft(object, { 'logo.png': 'admitted-logo' }, () => 'formula')!
    expect(result.kind).toBe('native')
    if (result.kind !== 'native') return
    const parts = result.draft.children!
    expect(parts).toHaveLength(2)
    expect(parts.every(part => part.definitionId === 'guoling.web')).toBe(true)
    expect(parts[0]?.data).toMatchObject({ html: expect.stringContaining('<linearGradient'), resourceBindings: { 'logo.png': 'admitted-logo' } })
    expect((parts[0]!.data as { html: string }).html).toContain('fill:url(#paint)')
    expect((parts[0]!.data as { html: string }).html).toContain('class="campus"')
    expect(parts[1]?.data).toMatchObject({ resourceBindings: { 'logo.png': 'admitted-logo' } })
  })

  it('retains nested SVG definitions and preserves a nonzero SVG box model as Web', () => {
    const object = box({}, 'svg')
    object.content = { ...element({}), tagName: 'svg', attributes: { viewBox: '0 0 100 100' }, children: [
      { ...element({}), tagName: 'g', children: [
        { ...element({}), tagName: 'defs', children: [{ ...element({}), tagName: 'linearGradient', attributes: { id: 'nested-paint' } }] },
        { ...element({ fill: 'url(#nested-paint)' }), tagName: 'rect', attributes: { width: '20', height: '10' } },
      ] },
    ] }
    const result = professionalHtmlDraft(object, {}, () => 'formula')!
    expect(result.kind).toBe('native')
    if (result.kind !== 'native') return
    const web = flatten(result.draft).find(part => part.definitionId === 'guoling.web')!
    expect((web.data as { html: string }).html).toContain('id="nested-paint"')
    object.content.style['padding-left'] = '10px'
    expect(professionalHtmlDraft(object, {}, () => 'formula')).toMatchObject({ kind: 'web', diagnostic: { message: expect.stringContaining('border-box') } })
  })

  it('maps the actual campus SVG to native paths/shapes while retaining only baseline text and round caps', async () => {
    const bundle = await build({ stdin: { contents: `export {captureHtmlDesignViewport} from './src/main/workbench/contentApply/measurement/browserCapture';export {cssUsesViewport} from './src/components/web/measuredFragmentBox';export {renderShape,shapePaintBounds} from './src/components/shape/render';export {applyComponentPaintStyle} from './src/player/components/componentPlacementStyle';`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'NativeGraphics', target: 'es2022' })
    const browser = await chromium.launch({ headless: true })
    const output = 'output/background-native-repair-20261017/native-graphics'
    await mkdir(output, { recursive: true })
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
      await page.setContent(await readFile('tests/fixtures/nativeCampusSvg20261017.html', 'utf8'))
      await page.addScriptTag({ content: bundle.outputFiles[0]!.text })
      const capture = await page.evaluate(() => { const api = (window as any).NativeGraphics; return api.captureHtmlDesignViewport(200, api.cssUsesViewport) }) as HtmlDesignCapture
      const assembly = assembleMeasuredHtml(capture, { html: '' })
      const object = assembly.root.children.find(child => child.kind === 'svg')!
      expect(object.frame).toEqual({ width: 568, height: 440, transform: [1, 0, 0, 1, 646, 123] })
      const result = professionalHtmlDraft(object, {}, () => 'formula')!
      expect(result.kind).toBe('native')
      if (result.kind !== 'native') return
      const objects = flatten(result.draft), shapes = objects.filter(draft => draft.definitionId === 'guoling.shape'), web = objects.filter(draft => draft.definitionId === 'guoling.web')
      expect(shapes).toHaveLength(16)
      expect(web).toHaveLength(3)
      expect(result.diagnostics).toHaveLength(3)
      expect(web.map(draft => (draft.data as { html: string }).html).join('')).toContain('硬化地面')
      const greenWindows = shapes.filter(draft => shapeDataSchema.parse(draft.data).style.fillColor === 'rgb(158,201,206)')
      expect(greenWindows).toHaveLength(4)
      expect(greenWindows[0]!.frame).toMatchObject({ width: 42, height: 35, transform: [1, 0, 0, 1, 76, 150] })
      const lawn = shapes.find(draft => draft.frame?.width === 230 && draft.frame?.height === 302)!
      expect(shapeDataSchema.parse(lawn.data).pathGeometry?.paths[0]?.commands).toEqual([
        { kind: 'move', to: [0, 0] }, { kind: 'line', to: [1, 0] }, { kind: 'line', to: [1, 1] }, { kind: 'line', to: [0, 1] }, { kind: 'close' },
      ])
      const ripple = shapes.find(draft => shapeDataSchema.parse(draft.data).pathGeometry?.paths[0]?.commands.some(command => command.kind === 'quadratic'))!
      expect(shapeDataSchema.parse(ripple.data).style).toMatchObject({ fillOpacity: 0, borderWidth: 3, borderColor: 'rgb(255,253,245)' })
      await page.screenshot({ path: `${output}/campus-source.png` })
      // Paint through the real shared shape renderer and placement-style consumer.
      const facts = await page.evaluate(serialized => {
        const draft = JSON.parse(serialized)
        const api = (window as any).NativeGraphics
        document.body.replaceChildren()
        const draw = (value: any, parent: HTMLElement) => {
          const root = document.createElement('div'), frame = value.frame
          root.dataset.kind = value.definitionId
          api.applyComponentPaintStyle(root, value)
          Object.assign(root.style, { position: 'absolute', left: '0', top: '0', width: `${frame.width}px`, height: `${frame.height}px`, transformOrigin: '0 0', transform: `matrix(${frame.transform.join(',')})` })
          parent.append(root)
          if (value.definitionId === 'guoling.shape') {
            const bounds = api.shapePaintBounds(value.data, frame), canvas = document.createElement('canvas')
            canvas.width = bounds.width; canvas.height = bounds.height
            Object.assign(canvas.style, { position: 'absolute', left: `${bounds.left}px`, top: `${bounds.top}px` })
            const context = canvas.getContext('2d')!; context.translate(-bounds.left, -bounds.top); api.renderShape(context, value.data, frame); root.append(canvas)
          } else if (value.definitionId === 'guoling.web') root.innerHTML = value.data.html
          for (const child of value.children ?? []) draw(child, root)
        }
        draw(draft, document.body)
        return { text: [...document.querySelectorAll('text')].map(node => ({ text: node.textContent, x: node.getBoundingClientRect().x, y: node.getBoundingClientRect().y })), canvases: document.querySelectorAll('canvas').length }
      }, JSON.stringify(result.draft))
      expect(facts.canvases).toBe(16)
      expect(facts.text.map(value => value.text)).toEqual(['硬化地面', '未硬化土壤'])
      expect(facts.text.every(value => Number.isFinite(value.x) && Number.isFinite(value.y))).toBe(true)
      await page.screenshot({ path: `${output}/campus-native.png` })
      await writeFile(`${output}/facts.json`, JSON.stringify({ counts: { nativeShapes: shapes.length, webParts: web.length }, diagnostics: result.diagnostics, facts }, null, 2))
    } finally { await browser.close() }
  }, 30000)
})
