import { describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { buildComponentPptx } from '../../src/renderer/export/componentPlatform/pptx'
import { createComponentPlatformMixedDeliveryFixture } from '../fixtures/componentPlatformMixedDeliveryFixture'
import type { PublishedCourseV3 } from '../../src/shared/contracts/component-platform/published'

const a = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const p = 'http://schemas.openxmlformats.org/presentationml/2006/main'
function xml(bytes: Uint8Array) {
  const dom = new DOMParser().parseFromString(strFromU8(bytes), 'application/xml')
  expect(dom.getElementsByTagName('parsererror')).toHaveLength(0)
  return dom
}
// A native-only cut of X1's sample isolates the editable semantics from capture.
function nativeCut() {
  const { project } = createComponentPlatformMixedDeliveryFixture()
  project.surfaces = [project.surfaces[0]!]
  project.instances['slide-group']!.childIds = ['slide-data-group', 'slide-styled-text']
  const ids = ['slide-group', 'slide-data-group', 'slide-table', 'slide-chart', 'slide-styled-text']
  project.instances = Object.fromEntries(ids.map(id => [id, project.instances[id]!]))
  return project
}
function named(dom: Document | Element, name: string) {
  const identity = Array.from(dom.getElementsByTagNameNS(p, 'cNvPr')).find(node => node.getAttribute('name') === name)!
  expect(identity).toBeDefined()
  return identity.parentElement!.parentElement!
}

describe('X2 editable PPTX output consumer', () => {
  it('appends attributed asset sources as editable credit text using provenance rather than the media URL', async () => {
    const project = nativeCut(), source = project.assets['circuit-image']!.source!
    Object.assign(source, { attribution: '串联电路示意图 — 果铃工程测试', url: 'https://example.org/circuit-source',
      license: { id: 'CC-BY-4.0', url: 'https://creativecommons.org/licenses/by/4.0/' } })
    const { revision: _revision, ...publishedData } = project
    const { path: _path, ...asset } = project.assets['circuit-image']!
    const published: PublishedCourseV3 = { ...publishedData, schemaVersion: 3, assets: { 'circuit-image': {
      ...asset, url: 'https://media.example.org/circuit.svg',
    } } }
    const before = structuredClone(published), result = await buildComponentPptx(published)
    expect(result.status).toBe('partial'); expect(result.slideCount).toBe(2)
    expect(result.pages).toHaveLength(1); expect(published).toEqual(before)
    const files = unzipSync(result.bytes), credits = xml(files['ppt/slides/slide2.xml']!)
    expect(credits.documentElement.textContent).toContain('素材来源')
    expect(credits.documentElement.textContent).toContain('串联电路示意图 — 果铃工程测试')
    expect(credits.documentElement.textContent).toContain('CC-BY-4.0 https://creativecommons.org/licenses/by/4.0/')
    expect(credits.documentElement.textContent).toContain('出处：https://example.org/circuit-source')
    expect(credits.documentElement.textContent).not.toContain('https://media.example.org/circuit.svg')
    expect(credits.getElementsByTagNameNS(p, 'pic')).toHaveLength(0)
    const output = resolve('output/component-platform-x2'); mkdirSync(output, { recursive: true })
    writeFileSync(resolve(output, 'editable-native-with-credits-diagnosed.pptx'), result.bytes)
    writeFileSync(resolve(output, 'editable-native-with-credits-diagnosed-report.json'), JSON.stringify({
      status: result.status, slideCount: result.slideCount, diagnostics: result.diagnostics,
    }, null, 2))
  })

  it('retains native children and the local diagnostic when a source parent capture fails', async () => {
    const project = nativeCut()
    project.instances['slide-group']!.implementationOverride = { kind: 'source', language: 'javascript', source: 'export default {mount(){}}' }
    const result = await buildComponentPptx(project, { captureInstance: () => { throw new Error('已知父图面捕获失败') } })
    expect(result.status).toBe('partial')
    expect(result.diagnostics.filter(diagnostic => diagnostic.severity === 'error').map(diagnostic => diagnostic.instanceId)).toEqual(['slide-group'])
    const slide = xml(unzipSync(result.bytes)['ppt/slides/slide1.xml']!)
    expect(slide.getElementsByTagNameNS(a, 'tbl')).toHaveLength(1)
    expect(slide.getElementsByTagNameNS('*', 'chart')).toHaveLength(1)
    expect(slide.documentElement.textContent).toContain('原生专业样式')
    expect(named(slide, 'slide-group').localName).toBe('grpSp')
  })

  it('preserves formal appearance, native group coordinates, rotated table/chart and embedded data', async () => {
    const project = nativeCut(), before = structuredClone(project)
    const result = await buildComponentPptx(project)
    // Office preserves editable graphicFrames but renders their grids/axes
    // upright even when its COM Rotation reports 15 degrees (E3 actual probe).
    expect(result.status).toBe('partial')
    expect(result.diagnostics.map(diagnostic => [diagnostic.instanceId, diagnostic.code])).toEqual([
      ['slide-table', 'layout-native-transform-limitation'], ['slide-chart', 'layout-native-transform-limitation'],
    ])
    expect(project).toEqual(before)
    const files = unzipSync(result.bytes), slide = xml(files['ppt/slides/slide1.xml']!)
    const root = named(slide, 'slide-group'), dataGroup = named(slide, 'slide-data-group')
    expect(root.localName).toBe('grpSp'); expect(dataGroup.parentElement).toBe(root)
    const groupTransform = dataGroup.getElementsByTagNameNS(a, 'xfrm')[0]!
    expect(Number(groupTransform.getAttribute('rot'))).toBeCloseTo(15 * 60000, -1)
    expect(groupTransform.getElementsByTagNameNS(a, 'off')[0]!.getAttribute('x')).not.toBe('0')
    expect(dataGroup.getElementsByTagNameNS(a, 'tbl')).toHaveLength(1)
    expect(dataGroup.getElementsByTagNameNS('*', 'chart')).toHaveLength(1)
    expect(slide.getElementsByTagNameNS(p, 'pic')).toHaveLength(0)
    expect(Array.from(dataGroup.getElementsByTagNameNS(a, 'tc')).some(cell => cell.getAttribute('gridSpan') === '3')).toBe(true)
    expect(dataGroup.textContent).toContain('0.20')
    const text = named(slide, 'slide-styled-text · slide-styled-text')
    const run = text.getElementsByTagNameNS(a, 'rPr')[0]!
    expect(run.getAttribute('b')).toBe('1'); expect(run.getAttribute('i')).toBe('1')
    expect(run.getAttribute('u')).toBe('sng'); expect(run.getAttribute('strike')).toBe('sngStrike')
    const body = text.getElementsByTagNameNS(a, 'bodyPr')[0]!
    expect(body.getAttribute('anchor')).toBe('ctr')
    expect(Number(body.getAttribute('lIns'))).toBe(14 * 9525)
    const colors = Array.from(text.getElementsByTagNameNS(a, 'srgbClr')).map(color => color.getAttribute('val'))
    expect(colors).toContain('DBEAFE'); expect(colors).toContain('1D4ED8')
    expect(text.getElementsByTagNameNS(a, 'ln')[0]!.getAttribute('w')).toBe(String(2 * 9525))
    const workbookName = Object.keys(files).find(name => /^ppt\/embeddings\/.+\.xlsx$/.test(name))!
    const workbook = unzipSync(files[workbookName]!)
    const values = Array.from(xml(workbook['xl/worksheets/sheet1.xml']!).getElementsByTagNameNS('*', 'v')).map(node => node.textContent)
    expect(values).toContain('20'); expect(values).toContain('35')
  })

  it('retains individual rotated/reflected native graphicFrames and captures a source body once with editable children', async () => {
    const project = nativeCut()
    project.instances['slide-table']!.frame!.transform = [0, 1, -1, 0, 220, 10]
    project.instances['slide-chart']!.frame!.transform = [1, 0, 0, -1, 470, 230]
    const result = await buildComponentPptx(project)
    expect(result.status).toBe('partial')
    expect(result.diagnostics.some(diagnostic => diagnostic.instanceId === 'slide-table' && diagnostic.code === 'layout-native-transform-limitation')).toBe(true)
    expect(result.diagnostics.some(diagnostic => diagnostic.instanceId === 'slide-chart' && diagnostic.code === 'layout-native-transform-limitation')).toBe(true)
    const slide = xml(unzipSync(result.bytes)['ppt/slides/slide1.xml']!)
    const table = named(slide, 'slide-table transform'), chart = named(slide, 'slide-chart transform')
    expect(table.getElementsByTagNameNS(a, 'xfrm')[0]!.getAttribute('rot')).toBe('5400000')
    expect(chart.getElementsByTagNameNS(a, 'xfrm')[0]!.getAttribute('flipV')).toBe('1')
    expect(table.getElementsByTagNameNS(a, 'tbl')).toHaveLength(1)
    expect(chart.getElementsByTagNameNS('*', 'chart')).toHaveLength(1)
    const captured: string[] = []
    project.instances['slide-group']!.implementationOverride = { kind: 'source', language: 'javascript', source: 'export default {mount(){}}' }
    // This stub proves callback/descendant ownership only, not visual fidelity.
    const capture = await buildComponentPptx(project, { captureInstance: context => {
      captured.push(context.instance.id)
      return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
    } })
    expect(captured).toEqual(['slide-group'])
    const capturedSlide = xml(unzipSync(capture.bytes)['ppt/slides/slide1.xml']!)
    expect(capturedSlide.getElementsByTagNameNS(p, 'pic')).toHaveLength(1)
    expect(capturedSlide.getElementsByTagNameNS(a, 'tbl')).toHaveLength(1)
    expect(capturedSlide.getElementsByTagNameNS('*', 'chart')).toHaveLength(1)
    expect(named(capturedSlide, 'slide-group').localName).toBe('grpSp')
  })

  it('does not diagnose a native rotation when ancestor and child angles cancel', async () => {
    const project = nativeCut(), cosine = Math.cos(Math.PI / 12), sine = Math.sin(Math.PI / 12)
    project.instances['slide-data-group']!.frame!.transform = [cosine, sine, -sine, cosine, 65, 160]
    for (const id of ['slide-table', 'slide-chart']) {
      const frame = project.instances[id]!.frame!, [, , , , x, y] = frame.transform
      frame.transform = [cosine, -sine, sine, cosine, x, y]
    }
    const result = await buildComponentPptx(project)
    expect(result.status).toBe('complete')
    expect(result.diagnostics.some(diagnostic => diagnostic.code === 'layout-native-transform-limitation')).toBe(false)
    const slide = xml(unzipSync(result.bytes)['ppt/slides/slide1.xml']!)
    expect(slide.getElementsByTagNameNS(a, 'tbl')).toHaveLength(1)
    expect(slide.getElementsByTagNameNS('*', 'chart')).toHaveLength(1)
  })
})
