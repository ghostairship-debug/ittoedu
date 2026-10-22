import { describe, expect, it, vi } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { createTextComponentData, createFormulaComponentData } from '../../src/components/text/data'
import { createTableData } from '../../src/components/table/data'
import { courseProjectV11Schema, jsonValueSchema } from '../../src/shared/contracts/component-platform/schema'
import { publishedCourseV4Schema, type PublishedCourseV4 } from '../../src/shared/contracts/component-platform/published'
import { componentSurface, componentSurfaces, type CourseProjectV11 } from '../../src/shared/contracts/component-platform/project'
import { componentDeliveryPages } from '../../src/renderer/export/componentPlatform/deliveryPages'
import { componentOutputPresentation } from '../../src/renderer/export/componentPlatform/presentation'
import { buildComponentReadingProjection } from '../../src/renderer/export/componentPlatform/document/reading'
import { buildComponentDocx } from '../../src/renderer/export/componentPlatform/document'
import { buildComponentPrintHtml } from '../../src/renderer/export/componentPlatform/print'
import { buildComponentPptx } from '../../src/renderer/export/componentPlatform/pptx'
import { createComponentDeliveryCapture } from '../../src/renderer/export/componentPlatform/capture'
import { buildComponentDelivery } from '../../src/renderer/export/componentPlatform/delivery'
import { courseDeliverySnapshot } from '../../src/renderer/app/courseDeliverySnapshot'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'

vi.mock('../../src/renderer/export/loadCompiledPlayerBundle', () => ({ loadCompiledPlayerBundle: () => 'unused-static-test-bundle' }))

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+cN2kAAAAASUVORK5CYII='
const bytes = () => Uint8Array.from(atob(png.split(',')[1]!), character => character.charCodeAt(0))
const xml = (value: Uint8Array) => {
  const document = new DOMParser().parseFromString(strFromU8(value), 'application/xml')
  expect(document.querySelector('parsererror')).toBeNull()
  return document
}

function sample(): CourseProjectV11 {
  let next = 0
  const table = createTableData({ rows: 1, columns: 1, idFactory: () => `cell-${++next}` })
  table.rows[0]!.cells[0]!.text = '仍可编辑的表格'
  const definitions = Object.fromEntries(['container.slide', 'container.flow', 'container.spatial', 'text', 'table', 'formula'].map(key => [key,
    { id: key, role: 'content', implementation: { kind: 'builtin', key: `guoling.${key}` } }]))
  return courseProjectV11Schema.parse({ schemaVersion: 11, id: 'static-work', revision: 7, title: '旧能力与新容器', definitions,
    rootIds: ['flow', 'slide', 'space'], entry: { rootInstanceId: 'slide' }, global: { underlay: [], overlay: [] }, assets: {},
    instances: {
      flow: { id: 'flow', definitionId: 'container.flow', name: '阅读', data: {}, childIds: ['flow-text', 'flow-table', 'formula'],
        container: { kind: 'flow' } },
      slide: { id: 'slide', definitionId: 'container.slide', name: '演示', data: {}, childIds: ['slide-text', 'slide-table'],
        container: { kind: 'slide', designSize: { width: 1280, height: 720 },
          presentation: { initialStateId: 'detail', states: [{ id: 'detail', title: '初态', overrides: {
            'slide-text': { data: createTextComponentData('演示作者初态') },
          } }] } } },
      space: { id: 'space', definitionId: 'container.spatial', name: '空间', data: {}, childIds: [], container: { kind: 'spatial',
        spatial: { home: { x: 0, y: 0, zoom: 1 }, frames: [
          { id: 'overview', title: '总览', pose: { x: 0, y: 0, zoom: 1 } }, { id: 'detail', title: '细看', pose: { x: 100, y: 50, zoom: 2 } },
        ] } } },
      'flow-text': { id: 'flow-text', definitionId: 'text', data: createTextComponentData('共同正文') },
      'flow-table': { id: 'flow-table', definitionId: 'table', data: structuredClone(table) },
      formula: { id: 'formula', definitionId: 'formula', data: createFormulaComponentData('formula-identity', '\\frac{x}{2}') },
      'slide-text': { id: 'slide-text', definitionId: 'text', data: createTextComponentData('演示正文'), frame: { width: 300, height: 80, transform: [1, 0, 0, 1, 40, 40] } },
      'slide-table': { id: 'slide-table', definitionId: 'table', data: table, frame: { width: 600, height: 180, transform: [1, 0, 0, 1, 40, 180] } },
    } })
}

function publication(project: CourseProjectV11): PublishedCourseV4 {
  const { revision: _revision, ...value } = project
  return publishedCourseV4Schema.parse({ ...value, schemaVersion: 4 })
}

describe('Project 11 static format consumers preserve author semantics', () => {
  it('keeps authored root/camera output order and projects initial presentation without a second author structure', () => {
    const source = sample(), before = structuredClone(source)
    expect(componentDeliveryPages(componentSurfaces(source)).map(page => page.id)).toEqual(['flow', 'slide', 'space:overview', 'space:detail'])
    expect(componentDeliveryPages(componentSurfaces(source), ['space:detail', 'slide']).map(page => page.id)).toEqual(['space:detail', 'slide'])
    const initial = componentOutputPresentation(publication(source), 'flow')
    expect(initial.instances['flow-text']!.data).toEqual(createTextComponentData('共同正文'))
    expect(componentOutputPresentation(publication(source), 'slide').instances['slide-text']!.data).toEqual(createTextComponentData('演示作者初态'))
    expect(initial).not.toHaveProperty('surfaces')
    expect(source).toEqual(before)
  })

  it('writes real editable Word text, table and math, PDF text, and native PowerPoint text/table from canonical roots', async () => {
    const source = sample(), before = structuredClone(source)
    const word = await buildComponentDocx(source, { surfaceId: 'flow' })
    const wordBody = xml(unzipSync(word.bytes)['word/document.xml']!)
    expect(wordBody.documentElement.textContent).toContain('共同正文')
    expect(wordBody.documentElement.textContent).toContain('仍可编辑的表格')
    expect(wordBody.getElementsByTagNameNS('*', 'tbl')).toHaveLength(1)
    expect(wordBody.getElementsByTagNameNS('*', 'f')).toHaveLength(1)
    const print = await buildComponentPrintHtml(source, { surfaceId: 'flow' })
    expect(print.html).toContain('共同正文')
    expect(print.html).toContain('仍可编辑的表格')
    const powerpoint = await buildComponentPptx(publication(source), { pageIds: ['slide'] })
    expect(powerpoint.slideCount).toBe(1)
    const slide = xml(unzipSync(powerpoint.bytes)['ppt/slides/slide1.xml']!)
    expect(slide.documentElement.textContent).toContain('演示作者初态')
    expect(slide.getElementsByTagNameNS('*', 'tbl')).toHaveLength(1)
    expect(slide.getElementsByTagNameNS('*', 'pic')).toHaveLength(0)
    expect(source).toEqual(before)
  })

  it('treats a nested container as one captured viewport without reflowing or duplicating its native descendants', async () => {
    const source = sample()
    source.instances.nested = { id: 'nested', definitionId: 'container.spatial', name: '局部探索', data: {}, childIds: ['nested-text'],
      frame: { width: 320, height: 180, transform: [1, 0, 0, 1, 20, 280] },
      container: { kind: 'spatial', spatial: { home: { x: 0, y: 0, zoom: 1 }, frames: [] } } }
    source.instances['nested-text'] = { id: 'nested-text', definitionId: 'text', data: jsonValueSchema.parse(JSON.parse(JSON.stringify(createTextComponentData('局部内部')))), frame: { width: 180, height: 40, transform: [1, 0, 0, 1, 0, 0] } }
    source.instances.slide!.childIds!.push('nested')
    const powerpoint = await buildComponentPptx(source, { pageIds: ['slide'], captureInstance: async ({ instance }) => {
      expect(instance.id).toBe('nested'); return png
    } })
    const slide = xml(unzipSync(powerpoint.bytes)['ppt/slides/slide1.xml']!)
    expect(slide.getElementsByTagNameNS('*', 'pic')).toHaveLength(1)
    expect(slide.documentElement.textContent).not.toContain('局部内部')
    expect(powerpoint.diagnostics.some(issue => issue.code === 'container-static-capture')).toBe(true)
    source.instances.slide!.childIds = source.instances.slide!.childIds!.filter(id => id !== 'nested')
    source.instances.flow!.childIds!.push('nested')
    const reading = buildComponentReadingProjection(source, 'flow')
    expect(reading.blocks.filter(block => block.instance.id.startsWith('nested')).map(block => block.instance.id)).toEqual(['nested'])
  })

  it('captures formal background through a valid Published 4 container and preserves the original publication', async () => {
    const source = sample()
    source.instances.slide!.container!.background = { mode: 'own', color: '#123456' }
    const published = publication(source), before = structuredClone(published)
    const capture = await createComponentDeliveryCapture(published, async input => {
      if (!('kind' in input) || input.kind !== 'published') throw new Error('wrong capture carrier')
      const payload = publishedCourseV4Schema.parse(input.published)
      expect(payload.rootIds).toEqual(['slide'])
      expect(componentSurface(payload, 'slide')?.background?.color).toBe('#123456')
      expect(Object.keys(payload.instances)).toEqual(['slide'])
      return { dataUrl: png, width: 1280, height: 720 }
    })
    expect((await capture.captureBackground?.('slide'))?.dataUrl).toBe(png)
    await capture.dispose()
    expect(published).toEqual(before)
  })

  it('reports the program-root static limitation without manufacturing a slide', async () => {
    const program = courseProjectV11Schema.parse({ schemaVersion: 11, id: 'program', revision: 0, title: '程序入口',
      rootIds: ['app'], entry: { rootInstanceId: 'app' }, global: { underlay: [], overlay: [] }, assets: {},
      definitions: { app: { id: 'app', role: 'content', implementation: { kind: 'source', language: 'javascript', source: 'export default { mount() {} }' } } },
      instances: { app: { id: 'app', definitionId: 'app', data: {} } } })
    const before = structuredClone(program)
    await expect(buildComponentPptx(program)).rejects.toThrow('自主管理程序入口')
    expect(program).toEqual(before)
    expect(componentSurfaces(program)).toEqual([])
  })

  it('discloses an omitted program root in default static delivery and respects an explicit container page selection', async () => {
    const source = sample()
    source.definitions.app = { id: 'app', title: '交互应用', role: 'content', implementation: { kind: 'source', language: 'javascript', source: 'export default { mount() {} }' } }
    source.instances.app = { id: 'app', definitionId: 'app', name: '主程序', data: {} }
    source.rootIds.unshift('app'); source.entry = { rootInstanceId: 'app' }
    const before = structuredClone(source)
    const snapshot: DocumentSnapshot = { documentId: 'mixed-static', epoch: 'epoch', revision: source.revision,
      model: { kind: 'course-v10', project: source, resources: { assets: {}, components: {} } },
      binding: { kind: 'untitled', suggestedName: '混合作品.glx' }, dirty: false, saving: false, recoverable: true, undoDepth: 0, redoDepth: 0 }
    const options = { compile: vi.fn(async () => { throw new Error('静态语义输出不应编译被省略的程序') }) }
    const defaults = await buildComponentDelivery(courseDeliverySnapshot(snapshot)!, 'docx', options)
    expect(defaults.artifacts[0]?.extension).toBe('docx')
    expect(defaults.report.items.filter(issue => issue.code === 'program-root-omitted')).toMatchObject([
      { severity: 'warning', instanceId: 'app', message: expect.stringContaining('主程序') },
    ])
    expect(defaults.report.items.find(issue => issue.code === 'program-root-omitted')?.message).toContain('HTML/Web')
    const selected = await buildComponentDelivery(courseDeliverySnapshot(snapshot, { pageIds: ['flow'] })!, 'docx', options)
    expect(selected.report.items.some(issue => issue.code === 'program-root-omitted')).toBe(false)
    const powerpoint = await buildComponentPptx(source, { captureSurface: async () => png })
    expect(powerpoint.diagnostics.filter(issue => issue.code === 'program-root-omitted')).toHaveLength(1)
    const selectedPowerpoint = await buildComponentPptx(source, { pageIds: ['slide'] })
    expect(selectedPowerpoint.diagnostics.some(issue => issue.code === 'program-root-omitted')).toBe(false)
    expect(options.compile).not.toHaveBeenCalled()
    expect(source).toEqual(before)
  })
})
