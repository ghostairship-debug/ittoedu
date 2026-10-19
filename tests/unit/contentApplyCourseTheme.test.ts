// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { checkComponentExpectations } from '../../src/core/drivers/courseV10Operations'
import { sourceProgramAssembly } from '../../src/core/contentApply/assembly/htmlAssembly'
import { ContentApplyService } from '../../src/main/workbench/contentApply/applyService'
import type { HtmlDesignMeasurementRequest } from '../../src/main/workbench/contentApply/measurement/ElectronHtmlDesignMeasurement'

it('measures with the current course theme without copying it into source CSS and captures its CAS dependencies', async () => {
  const project = createBlankCourseProjectV10('Theme measurement')
  const assetId = '纸 张一'
  project.theme = { css: '.panel{color:red;background-image:url("../assets/paper.png")}', assets: { 'assets/paper.png': { assetId } } }
  project.assets[assetId] = { id: assetId, path: 'assets/paper.png', mimeType: 'image/png' }
  const sourceCss = '.panel{color:blue}'
  const measure = vi.fn(async (request: HtmlDesignMeasurementRequest) => {
    const assembly = sourceProgramAssembly(request.viewport, { html: request.html, themeCss: request.themeCss }, 'fixture')
    assembly.root.kind = 'web'
    delete assembly.root.program
    assembly.root.retainedSource = { html: request.html, reason: 'fixture' }
    return assembly
  })
  const service = new ContentApplyService({ measure, compilation: { compile: vi.fn() }, resourceUrls: () => ({ 'theme-asset-0': 'data:existing' }),
    session: { project: () => project, resources: () => ({ assets: { [assetId]: new Uint8Array([1, 2, 3]) }, components: {} }), dispatch: vi.fn() } })
  const plan = await service.plan({ intent: 'insert', target: { kind: 'container', container: { kind: 'surface', surfaceId: project.surfaces[0]!.id } },
    source: { kind: 'html', html: '<main class="panel">Theme</main>', themeCss: sourceCss } })
  const measured = measure.mock.calls[0]![0]
  expect(measured.courseThemeCss).toContain('@layer guoling-theme')
  expect(measured.courseThemeCss).toContain('color:red')
  expect(measured.themeCss).toBe(sourceCss)
  expect(Object.values(measured.resourceUrls ?? {})).toContain('data:image/png;base64,AQID')
  const themeReference = Object.entries(measured.resourceUrls!).find(([, url]) => url === 'data:image/png;base64,AQID')![0]
  expect(themeReference).toMatch(/^cw-resource:[a-zA-Z0-9_.-]+$/)
  expect(themeReference).not.toBe('cw-resource:theme-asset-0')
  expect(measured.courseThemeCss).toContain(themeReference)
  const inserted = plan.command.edits.flatMap(edit => edit.type === 'instance.insert' ? edit.instances : [])
  expect(inserted[0]!.data).toMatchObject({ css: sourceCss, resourceBindings: { [themeReference]: assetId } })
  expect(JSON.stringify(inserted)).not.toContain('color:red')
  expect(plan.command.expected).toEqual(expect.arrayContaining([
    expect.objectContaining({ path: ['theme'], value: project.theme }),
    expect.objectContaining({ path: ['designTokens'] }),
  ]))
  checkComponentExpectations(project, plan.command)
  const changed = structuredClone(project)
  changed.theme!.css = '.panel{color:green}'
  expect(() => checkComponentExpectations(changed, plan.command)).toThrow('theme')
})

it.each(['unavailable', 'program'] as const)('keeps a raw %s source usable without unrelated theme CAS dependencies', async kind => {
  const project = createBlankCourseProjectV10('Raw source')
  project.theme = { css: '.panel{color:red}' }
  const measure = vi.fn(async (request: HtmlDesignMeasurementRequest) => {
    if (kind === 'unavailable') throw new Error('Measurement worker unavailable')
    return sourceProgramAssembly(request.viewport, { html: request.html }, 'script')
  })
  const service = new ContentApplyService({ measure, compilation: { compile: vi.fn() }, session: { project: () => project, dispatch: vi.fn() } })
  const plan = await service.plan({ intent: 'redo', target: { kind: 'container', container: { kind: 'surface', surfaceId: project.surfaces[0]!.id } },
    source: { kind: 'html', html: '<main class="panel">Retained source</main><script>console.log("retained")</script>' } })
  expect(plan.command.expected.some(value => ['theme', 'designTokens'].includes(value.path[0]!))).toBe(false)
})

it('declares a bound remote theme image only to the restricted measurement resource context', async () => {
  const project = createBlankCourseProjectV10('Remote theme')
  project.theme = { css: '.panel{background-image:url("../assets/paper.png")}', assets: { 'assets/paper.png': { assetId: 'paper' } } }
  project.assets.paper = { id: 'paper', path: 'assets/paper.png', mimeType: 'image/png', remote: { url: 'https://example.test/paper.png' } }
  const measure = vi.fn(async (request: HtmlDesignMeasurementRequest) => sourceProgramAssembly(request.viewport, { html: request.html }, 'script'))
  const service = new ContentApplyService({ measure, compilation: { compile: vi.fn() }, session: { project: () => project, dispatch: vi.fn() } })
  await service.plan({ intent: 'insert', target: { kind: 'container', container: { kind: 'surface', surfaceId: project.surfaces[0]!.id } },
    source: { kind: 'html', html: '<main class="panel">Remote theme</main>' } })
  const measured = measure.mock.calls[0]![0]
  expect(Object.values(measured.resourceUrls ?? {})).toContain('https://example.test/paper.png')
  expect(measured.resourceSources).toEqual([expect.objectContaining({ url: 'https://example.test/paper.png', usage: 'image' })])
})
