// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { HTML_PROGRAM_DEFINITION } from '../../src/components/web/data'
import { sourceProgramAssembly } from '../../src/core/contentApply/assembly/htmlAssembly'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { applyComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { ContentApplyService } from '../../src/main/workbench/contentApply/applyService'
import { patchHtmlAuthoringRecords } from '../../src/shared/html/htmlAuthoringRecords'
import type { ComponentAuthorRecord, ComponentInstance, JsonObject } from '../../src/shared/contracts/component-platform'
import type { DocumentResources } from '../../src/shared/workbench/document'
import type { HtmlDesignMeasurementRequest } from '../../src/main/workbench/contentApply/measurement/ElectronHtmlDesignMeasurement'

const html = (body: string) => `<!doctype html><html><head></head><body>${body}</body></html>`
const imageBytes = (color: string) => new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="12"><rect width="16" height="12" fill="${color}"/></svg>`)

function fixture(source: string, record: ComponentAuthorRecord) {
  const project = createBlankCourseProjectV10('Redo current author records')
  project.definitions[HTML_PROGRAM_DEFINITION.id] = structuredClone(HTML_PROGRAM_DEFINITION)
  project.instances = {
    original: { id: 'original', definitionId: HTML_PROGRAM_DEFINITION.id, data: { html: source },
      frame: { width: 300, height: 200, transform: [1, 0, 0, 1, 35, 45] }, authoring: { records: { current: structuredClone(record) } } },
  }
  project.surfaces = [{ id: 'page', kind: 'slide', title: 'Current page', childIds: ['original'], designSize: { width: 800, height: 600 } }]
  project.global = { underlay: [], overlay: [] }
  project.assets = {}
  const resources: DocumentResources = { assets: {}, components: {} }
  const measure = vi.fn(async (request: HtmlDesignMeasurementRequest) => sourceProgramAssembly(request.viewport, { html: request.html }, 'unused-fixture'))
  const dispatch = vi.fn(async () => { throw new Error('This fixture only plans; it cannot submit a Session mutation') })
  const service = new ContentApplyService({ session: { project: () => project, resources: () => resources, dispatch },
    measure, compilation: { compile: vi.fn() } })
  const redo = async (source: string, intent: 'redo' | 'content' = 'redo', resourceNamespace?: 'project') => {
    const before = structuredClone({ project, resources })
    const plan = await service.plan({ intent, target: { kind: 'instance', instanceId: 'original' }, source: { kind: 'html', html: source, resourceNamespace } })
    expect({ project, resources }).toEqual(before)
    expect(dispatch).not.toHaveBeenCalled()
    expect(plan.command.edits.length).toBeGreaterThan(0)
    const next = applyComponentOperation(project, plan.command, structuredClone(resources))
    expect({ project, resources }).toEqual(before)
    expect(next.instances.original!.frame).toEqual(project.instances.original!.frame)
    return { plan, next, instance: next.instances.original! }
  }
  return { project, resources, redo, measure }
}

function bindings(instance: ComponentInstance): Record<string, string> {
  return (instance.data as JsonObject).resourceBindings as Record<string, string>
}

it.each(['redo', 'content'] as const)('keeps current image record aliases and both resource owners on %s without duplicating existing assets', async intent => {
  const source = html('<img id="photo" src="cw-resource:original"><p>Before</p>')
  const record: ComponentAuthorRecord = { kind: 'image',
    binding: { kind: 'dom', path: [{ tag: 'body', index: 1 }, { tag: 'img', index: 0, attributes: { id: 'photo' } }], baseline: 'cw-resource:original' },
    overrides: { src: 'cw-resource:edited', geometry: { translateX: 12 }, style: { opacity: '0.8' } } }
  const f = fixture(source, record)
  const original = f.project.instances.original!
  ;(original.data as JsonObject).resourceBindings = { 'cw-resource:original': 'image-a' }
  original.authoring!.resourceBindings = { 'cw-resource:edited': 'image-b' }
  for (const [id, color] of [['image-a', 'red'], ['image-b', 'blue']]) {
    const bytes = imageBytes(color!)
    f.resources.assets[id!] = bytes
    f.project.assets[id!] = { id: id!, path: `assets/${id}.svg`, filename: `${id}.svg`, kind: 'image', mimeType: 'image/svg+xml',
      width: 16, height: 12, byteLength: bytes.byteLength }
  }
  const { plan, next, instance } = await f.redo(intent === 'content' ? source.replace('Before', 'After') : source, intent)
  if (intent === 'redo') expect(plan.diagnostics.some(issue => issue.code === 'redo-authoring-records-retained')).toBe(true)
  expect(plan.diagnostics.filter(issue => /resource|url-scheme/.test(issue.code) && issue.level !== 'info')).toEqual([])
  expect(plan.command.edits.filter(edit => edit.type === 'asset.add')).toEqual([])
  expect(Object.keys(next.assets).sort()).toEqual(['image-a', 'image-b'])
  const effectiveBindings = { ...bindings(instance), ...instance.authoring!.resourceBindings }
  expect(effectiveBindings).toMatchObject({ 'cw-resource:original': 'image-a', 'cw-resource:edited': 'image-b' })
  expect(instance.authoring!.resourceBindings).toEqual({ 'cw-resource:edited': 'image-b' })
  const retained = instance.authoring!.records!.current!
  expect(retained.overrides).toEqual(record.overrides)
  expect(effectiveBindings[retained.binding.baseline]).toBe('image-a')
  expect(effectiveBindings[retained.overrides.src!]).toBe('image-b')
  expect(f.resources.assets['image-a']).toEqual(imageBytes('red'))
  expect(f.resources.assets['image-b']).toEqual(imageBytes('blue'))
  expect(f.measure).not.toHaveBeenCalled()
})

it('keeps reconciled current text, style and geometry when a redo source carries a stale same-key author wrapper', async () => {
  const source = html('<p id="text">Baseline</p>')
  const current: ComponentAuthorRecord = { kind: 'text', binding: { kind: 'dom',
    path: [{ tag: 'body', index: 1 }, { tag: 'p', index: 0, attributes: { id: 'text' } }], textIndex: 0, baseline: 'Baseline' },
    overrides: { text: 'Current human text', style: { color: 'red', 'font-weight': '700' }, geometry: { translateX: 12, width: 210 } } }
  const f = fixture(source, current)
  const stale = patchHtmlAuthoringRecords(source, { current: { ...structuredClone(current), overrides: { text: 'Older source text' } } })
  const { plan, next, instance } = await f.redo(stale)
  expect(plan.diagnostics.some(issue => issue.code === 'redo-authoring-records-retained')).toBe(true)
  expect(instance.authoring!.records).toEqual({ current })
  expect((instance.data as JsonObject).html).toBe(source)
  expect((instance.data as JsonObject).html).not.toContain('cw-html-authoring-records')
  expect(Object.keys(next.assets)).toEqual([])
  expect(plan.command.edits.some(edit => edit.type === 'asset.add')).toBe(false)
  expect(f.measure).not.toHaveBeenCalled()
})

it('keeps two existing asset identities when their bytes match inside one source program', async () => {
  const source = html('<img id="a" src="cw-resource:image-a"><img id="b" src="cw-resource:image-b">')
  const f = fixture(source, { kind: 'text', binding: { kind: 'dom', path: [], baseline: '' }, overrides: {} })
  delete f.project.instances.original!.authoring
  for (const id of ['image-a', 'image-b']) {
    const bytes = imageBytes('red')
    f.resources.assets[id] = bytes
    f.project.assets[id] = { id, path: `assets/${id}.svg`, mimeType: 'image/svg+xml', width: 16, height: 12 }
  }
  const { plan, instance } = await f.redo(source)
  const adopted = (instance.data as JsonObject).html as string
  const references = [...adopted.matchAll(/src="([^"]+)"/g)].map(match => match[1]!)
  const resolve = (reference: string) => bindings(instance)[reference] ?? reference.replace(/^cw-resource:/, '')
  expect(references.map(resolve)).toEqual(['image-a', 'image-b'])
  expect(plan.command.edits.filter(edit => edit.type === 'asset.add')).toEqual([])
})

it('uses canonical project namespace before a colliding old local alias on redo', async () => {
  const source = html('<img id="photo" src="cw-resource:photo">')
  const f = fixture(source, { kind: 'image', binding: { kind: 'dom', path: [{ tag: 'body', index: 1 }, { tag: 'img', index: 0, attributes: { id: 'photo' } }], baseline: 'cw-resource:photo' }, overrides: { geometry: { translateX: 12 } } })
  ;(f.project.instances.original!.data as JsonObject).resourceBindings = { 'cw-resource:photo': 'image-b', 'cw-resource:image-b': 'image-a' }
  for (const [id, color] of [['image-a', 'red'], ['image-b', 'blue']]) {
    const bytes = imageBytes(color!)
    f.resources.assets[id!] = bytes
    f.project.assets[id!] = { id: id!, path: `assets/${id}.svg`, mimeType: 'image/svg+xml', width: 16, height: 12 }
  }
  const { plan, instance } = await f.redo(source.replace('cw-resource:photo', 'cw-resource:image-b'), 'redo', 'project')
  expect(bindings(instance)['cw-resource:image-b']).toBe('image-b')
  expect(instance.authoring!.records!.current!.overrides.geometry).toEqual({ translateX: 12 })
  expect(plan.command.edits.filter(edit => edit.type === 'asset.add')).toEqual([])
})
