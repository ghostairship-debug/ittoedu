import { createRequire } from 'node:module'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { courseProjectV11Schema } from '../../src/shared/contracts/component-platform/schema'
import { createTextComponentData } from '../../src/components/text/data'
import { buildComponentDocx } from '../../src/renderer/export/componentPlatform/document'
import { buildComponentPrintHtml, composeComponentPrintHtml } from '../../src/renderer/export/componentPlatform/print'
import { scaleWordInheritedText } from '../../src/renderer/export/componentPlatform/document/wordTextScale'
import { registerBundledFontEmbedPreparer, registerBundledFontEmbedSource } from '../../src/renderer/export/bundledFontEmbedding'
import { BUNDLED_TEXT_FONT_FAMILY } from '../../src/shared/fonts/bundledFontFamilies'

const { PNG } = createRequire(import.meta.url)('pngjs')
const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

function project() {
  return courseProjectV11Schema.parse({ schemaVersion: 11, id: 'reading-regressions', revision: 0, title: '输出回退',
    rootIds: ['flow'], entry: { rootInstanceId: 'flow' }, global: { underlay: [], overlay: [] }, assets: {},
    definitions: Object.fromEntries(['container.flow', 'group', 'text'].map(key => [key,
      { id: key, role: 'content', implementation: { kind: 'builtin', key: `guoling.${key}` } }])),
    instances: {
      flow: { id: 'flow', definitionId: 'container.flow', data: {}, childIds: ['group'], container: { kind: 'flow' } },
      group: { id: 'group', definitionId: 'group', data: {}, childIds: ['text'], frame: { width: 400, height: 100, transform: [1, 0, 0, 1, 0, 0] } },
      text: { id: 'text', definitionId: 'text', data: { ...createTextComponentData({ inlines: [
        { type: 'text', text: '原字号' }, { type: 'text', text: '局部字号', style: { fontSize: 20, italic: true, baseline: 0.25 } },
        { type: 'text', text: '半点舍入', style: { fontSize: 17 } },
      ] }), appearance: { fontSize: 16 } }, frame: { width: 180, height: 40, transform: [2, 0, 0, 2, 0, 0] } },
    } })
}

afterEach(() => { registerBundledFontEmbedSource(null); registerBundledFontEmbedPreparer(null) })

describe('reading output consumes the actual author scale, capture extent and fonts', () => {
  it('keeps scaled free-group text native with both default and explicitly styled run sizes', async () => {
    const input = project(), original = structuredClone(input), capture = vi.fn()
    const result = await buildComponentDocx(input, { surfaceId: 'flow', captureInstance: capture })
    const word = new DOMParser().parseFromString(strFromU8(unzipSync(result.bytes)['word/document.xml']!), 'application/xml')
    expect(word.querySelector('parsererror')).toBeNull()
    const runs = Array.from(word.getElementsByTagNameNS(w, 'r'))
    const size = (text: string) => runs.find(run => run.textContent === text)?.getElementsByTagNameNS(w, 'sz')[0]?.getAttributeNS(w, 'val')
    expect(size('原字号')).toBe('48') // 16px ×2 ×1.5 Word half-points.
    expect(size('局部字号')).toBe('60')
    expect(size('半点舍入')).toBe('51')
    expect(runs.find(run => run.textContent === '局部字号')?.getElementsByTagNameNS(w, 'position')[0]?.getAttributeNS(w, 'val')).toBe('15')
    expect(capture).not.toHaveBeenCalled()
    expect(result.diagnostics.some(item => item.code === 'word-layout-capture')).toBe(false)
    expect(input).toEqual(original)
  })

  it('scales inherited Word paragraph styles from the reused writer, leaving unrelated formatting intact', () => {
    const styles = '<w:docDefaults><w:sz w:val="22"/></w:docDefaults><w:style w:styleId="Heading1"><w:sz w:val="34"/></w:style>'
    const fragment = '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>标题</w:t></w:r>'
      + '<w:r><w:rPr><w:sz w:val="20"/><w:color w:val="123456"/></w:rPr><w:t>显式</w:t></w:r></w:p>'
    const scaled = scaleWordInheritedText(fragment, 0.5, styles)
    expect(scaled).toContain('<w:sz w:val="17"/>')
    expect(scaled).toContain('<w:sz w:val="20"/>') // Explicit metrics arrived already scaled from the semantic node.
    expect(scaled).toContain('<w:color w:val="123456"/>')
    expect(scaled).toContain('<w:b/>')
    expect(scaleWordInheritedText(fragment, 1, styles)).toBe(fragment)
  })

  it('keeps a tall local capture at reading width in fragmentable page flow and embeds its pixels only once', async () => {
    const input = project()
    input.instances.flow!.childIds = ['nested']
    input.instances.nested = { id: 'nested', definitionId: 'container.flow', data: {}, childIds: [], container: { kind: 'flow' },
      frame: { width: 800, height: 10000, transform: [1, 0, 0, 1, 0, 0] } }
    const bytes = new Uint8Array(PNG.sync.write({ width: 800, height: 10000, data: Buffer.alloc(800 * 10000 * 4, 255) }))
    const captureInstance = vi.fn(async () => ({ bytes, mimeType: 'image/png', width: 800, height: 10000 }))
    const output = await buildComponentPrintHtml(input, { surfaceId: 'flow', captureInstance })
    const parsed = new DOMParser().parseFromString(composeComponentPrintHtml('组合', [output.html]), 'text/html')
    const capture = parsed.querySelector('[data-output-capture]') as HTMLElement
    expect(capture.style.width).toBe('642px')
    expect(capture.style.height).toBe('8025px')
    expect(capture.style.breakInside).toBe('auto')
    expect(capture.style.boxDecorationBreak).toBe('slice')
    expect(capture.style.backgroundImage).toContain('data:image/png;base64,')
    expect(capture.style.backgroundSize).toBe('100% 100%')
    expect(capture.getAttribute('role')).toBe('img')
    expect((parsed.querySelector('[data-component-output="nested"]') as HTMLElement).style.height).toBe('auto')
    expect(output.html.match(/data:image\/png;base64,/g)).toHaveLength(1)
    const files = unzipSync((await buildComponentDocx(input, { surfaceId: 'flow', captureInstance })).bytes)
    const word = strFromU8(files['word/document.xml']!)
    expect(word.match(/<a:srcRect\b/g)?.length).toBeGreaterThan(5)
    expect(word.match(/<w:pageBreakBefore\/>/g)?.length).toBeGreaterThan(4)
    expect(word).not.toContain('<w:p><w:r><w:br w:type="page"/></w:r></w:p>')
    expect(Object.keys(files).filter(file => file.startsWith('word/media/'))).toHaveLength(1)
    const sourceRects = [...word.matchAll(/<a:srcRect l="0" t="(\d+)" r="0" b="(\d+)"\/>/g)]
    expect(sourceRects[0]?.[1]).toBe('0')
    expect(sourceRects.at(-1)?.[2]).toBe('0')
    sourceRects.slice(1).forEach((rect, index) => expect(Math.abs(Number(rect[1]) - (100000 - Number(sourceRects[index]![2])))).toBeLessThanOrEqual(1))
  })

  it('uses the shared font embedding preparation and carries actual font bytes and license into print HTML', async () => {
    const prepare = vi.fn(async () => {})
    registerBundledFontEmbedPreparer(prepare)
    registerBundledFontEmbedSource(families => families.includes(BUNDLED_TEXT_FONT_FAMILY) ? [{
      family: BUNDLED_TEXT_FONT_FAMILY, style: 'normal', weight: '100 900', display: 'swap',
      license: { type: 'OFL-1.1', attribution: 'Test font attribution', noticePath: 'fonts/OFL.txt', packageName: 'test-font', packageVersion: '1' },
      licenseText: 'Test OFL notice', faces: [{ file: 'text.woff2', specifier: 'test/text.woff2', bytes: new Uint8Array([1, 2, 3]) }],
    }] : [])
    const result = await buildComponentPrintHtml(project(), { surfaceId: 'flow' })
    expect(prepare).toHaveBeenCalledOnce()
    expect(result.html).toContain('@font-face')
    expect(result.html).toContain('data:font/woff2;base64,AQID')
    expect(result.html).toContain('Test OFL notice')
    expect(result.diagnostics.some(item => item.code === 'bundled-font-unavailable')).toBe(false)
  })
})
