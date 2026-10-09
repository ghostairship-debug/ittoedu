// @vitest-environment node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { compileFunction, constants } from 'node:vm'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { ComponentPlatformRuntime } from '../../src/player/components/ComponentPlatformRuntime'
import { CHART_DEFINITION, createChartData } from '../../src/components/chart'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV10DocumentBridge } from '../../src/renderer/documents/CourseV10DocumentBridge'
import { authorSpotEdits } from '../../src/renderer/componentPlatform/surfaces/slide/authorSpots'
import { componentCompilationInput } from '../../src/core/components/compilation/componentCompilationInput'
import { createEsbuildComponentCompiler } from '../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'
import type { ComponentAuthorSpot, ComponentRuntimeImplementation, CourseProjectV10, JsonValue } from '../../src/shared/contracts/component-platform'
import type { DocumentEvent, DocumentResources } from '../../src/shared/workbench/document'
import type { DocumentHostAPI } from '../../src/shared/workbench/desktop'

const emptyResources = (): DocumentResources => ({ assets: {}, components: {} })
const projectFor = (definitions: CourseProjectV10['definitions'], instances: CourseProjectV10['instances']): CourseProjectV10 => ({
  schemaVersion: 10, id: 'professional-fields', revision: 0, title: '专业字段', definitions, instances,
  surfaces: [{ id: 'page', kind: 'slide', title: '页', childIds: Object.keys(instances), designSize: { width: 1280, height: 720 } }],
  global: { underlay: [], overlay: [] }, assets: {},
})
let dom: JSDOM
beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body></body></html>')
  vi.stubGlobal('document', dom.window.document)
  vi.stubGlobal('Element', dom.window.Element)
  Object.defineProperty(dom.window.SVGElement.prototype, 'getBBox', { configurable: true, value: () => ({ x: 35, y: 45, width: 160, height: 28 }) })
  Object.defineProperty(dom.window.SVGElement.prototype, 'getCTM', { configurable: true, value: () => ({ a: 0.8, b: 0, c: 0, d: 0.8, e: 2, f: 3 }) })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); dom.window.close() })
function measureFields() {
  // JSDOM has no layout engine. Registration geometry is supplied here; the
  // real runtime, data parser, author edit planner and saved format are used.
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const root = this.hasAttribute('data-test-professional-root')
    return { x: root ? 0 : 30, y: root ? 0 : 40, left: root ? 0 : 30, top: root ? 0 : 40,
      width: root ? 1120 : 160, height: root ? 400 : 28, right: root ? 1120 : 190, bottom: root ? 400 : 68, toJSON() {} }
  })
}
function preset(kind: string) {
  const directory = path.resolve('resources/built-in-components/components', kind)
  const manifest = JSON.parse(readFileSync(path.join(directory, 'manifest.json'), 'utf8'))
  const source = Uint8Array.from(readFileSync(path.join(directory, 'runtime.js')))
  const entry = manifest.entry
  const resources: DocumentResources = { assets: {}, components: Object.fromEntries(Object.keys(manifest.resources.components)
    .map(owner => [owner, { 'runtime.js': source }])) }
  return { project: projectFor(entry.definitions, entry.example.instances), resources, id: entry.example.rootIds[0] as string }
}
async function fixture(project: CourseProjectV10, resources = emptyResources()) {
  measureFields()
  const driver = new CourseV10Driver(), listeners = new Set<(event: DocumentEvent) => void>()
  const registry = new DocumentRegistry({ drivers: [driver], createId: () => 'professional-document', bindingKey: value => value.path,
    persistence: { async append() {}, async save() { throw new Error('No file dialog in this field check') } } })
  const session = await registry.create({ kind: 'course-v10', project, resources }, 'fields.h5lesson')
  session.subscribe(event => listeners.forEach(listener => listener(event)))
  const bridge = new CourseV10DocumentBridge()
  const unavailable = async (): Promise<never> => { throw new Error('No file service in this author-field fixture') }
  const api: DocumentHostAPI = {
    list: async () => [session.read()], create: unavailable, open: unavailable, save: unavailable, saveWithDialog: unavailable,
    observeFile: unavailable, reconcileFile: unavailable, close: unavailable, closeWithDialog: unavailable,
    recoverable: unavailable, restore: unavailable, discardRecovery: unavailable,
    readAuthoringDrafts: async () => null, writeAuthoringDrafts: unavailable, clearAuthoringDrafts: unavailable,
    bootstrapCourse: async () => session.read(), read: async () => session.read(),
    dispatch: async operation => session.execute(operation), lookup: async (_id, operationId) => session.lookupOperation(operationId),
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  await bridge.connect(api)
  const compiler = createEsbuildComponentCompiler(), diagnostics: string[] = []
  const load = compileFunction('return import(url)', ['url'], { importModuleDynamically: constants.USE_MAIN_CONTEXT_DEFAULT_LOADER })
  const world = new ComponentPlatformRuntime('professional-fields', { mode: 'edit', report: message => diagnostics.push(message),
    resolveSource: async implementation => {
      const compiled = await compiler.compile(componentCompilationInput(bridge.read().project!, implementation, resources))
      if (compiled.status !== 'ready') throw new Error(JSON.stringify(compiled.diagnostics))
      const module = await load('data:text/javascript;base64,' + Buffer.from(compiled.artifact.code).toString('base64')) as { default: ComponentRuntimeImplementation }
      return { implementation: module.default }
    },
  })
  const roots = new Map<string, HTMLElement>()
  for (const id of Object.keys(project.instances)) {
    const root = document.createElement('div'); root.dataset.testProfessionalRoot = ''; document.body.append(root)
    roots.set(id, root); world.bind(id, root)
  }
  const sync = async () => { const model = session.read().model; if (model.kind !== 'course-v10') throw new Error('Expected V10'); await world.sync(model.project, model.resources); expect(diagnostics).toEqual([]) }
  await sync()
  const spot = (id: string, field: string[]): ComponentAuthorSpot => {
    const found = world.authorSpots().find(value => value.instanceId === id && JSON.stringify(value.dataPath) === JSON.stringify(field))
    expect(found, `Missing registered ${id}:${field.join('.')}`).toBeDefined()
    return found!
  }
  const roundtrip = () => {
    const saved = driver.serialize(session.read().model), reopened = driver.load(saved)
    if (reopened.kind !== 'course-v10') throw new Error('Expected V10')
    expect(reopened.project.instances).toEqual(bridge.read().project!.instances)
    return reopened
  }
  const edit = async (registered: ComponentAuthorSpot, value: JsonValue) => {
    await bridge.edit(authorSpotEdits(bridge.read().project!, registered, value, resources))
    await sync()
  }
  return { world, bridge, session, roots, spot, sync, edit, roundtrip, async dispose() { await world.dispose(); bridge.dispose(); roots.forEach(root => root.remove()); expect(world.authorSpots()).toEqual([]) } }
}

it('registers chart title, category and full series names and saves edits to professional data', async () => {
  const data = createChartData(); data.style.legendPosition = 'right'; data.series[0].name = '不能被截断覆盖的完整系列名称'
  const project = projectFor({ [CHART_DEFINITION.id]: CHART_DEFINITION }, { chart: { id: 'chart', definitionId: CHART_DEFINITION.id, data,
    frame: { width: 640, height: 400, transform: [1, 0, 0, 1, 10, 20] } } })
  const h = await fixture(project)
  try {
    expect(h.roots.get('chart')!.querySelector('[data-chart-series-id]')!.textContent).not.toBe(data.series[0].name)
    const title = h.spot('chart', ['title']), category = h.spot('chart', ['categories', '0', 'label']), series = h.spot('chart', ['series', '0', 'name'])
    expect(series.initialValue).toBe(data.series[0].name)
    expect(title.localBounds.transform).toEqual([0.8, 0, 0, 0.8, 30, 39])
    await h.bridge.edit([title, category, series].flatMap((field, index) => authorSpotEdits(h.bridge.read().project!, field, ['新的标题', '新的分类', '新的完整系列名称'][index], emptyResources())))
    await h.sync()
    const reopened = h.roundtrip(), actual = reopened.project.instances.chart.data as typeof data
    expect(actual.title).toBe('新的标题'); expect(actual.categories[0].label).toBe('新的分类'); expect(actual.series[0].name).toBe('新的完整系列名称')
    expect(actual.series[0].points).toEqual(data.series[0].points)
    expect(reopened.project.instances.chart.frame).toEqual(project.instances.chart.frame)
    expect(h.roots.get('chart')!.querySelector('[data-chart-text="title"]')!.textContent).toBe('新的标题')
    expect(h.session.read().undoDepth).toBe(1)
    await h.bridge.undo(); await h.sync(); expect(h.spot('chart', ['series', '0', 'name']).initialValue).toBe(data.series[0].name)
  } finally { await h.dispose() }
})

it('edits reading markup and pinyin pairs as source data and remounts the saved renderer', async () => {
  for (const [kind, key, replacement] of [['language/reading-annotation', 'markup', '**重点** // ~连读~'], ['language/pinyin-annotation', 'pairs', '新|xin 字|zi']]) {
    const original = preset(kind), h = await fixture(original.project, original.resources)
    try {
      const field = h.spot(original.id, ['content', key]), node = h.roots.get(original.id)!.querySelector(`[data-courseware-edit-key="content.${key}"]`)!
      expect(node.textContent).not.toBe(field.initialValue)
      await h.edit(field, replacement)
      expect(h.spot(original.id, ['content', key]).initialValue).toBe(replacement)
      const reopened = h.roundtrip()
      const cold = await fixture(reopened.project, reopened.resources)
      try {
        expect(cold.spot(original.id, ['content', key]).initialValue).toBe(replacement)
        const rendered = cold.roots.get(original.id)!
        if (key === 'markup') {
          expect(rendered.querySelector('.emphasis')!.textContent).toBe('重点')
          expect(rendered.querySelector('.liaison')!.textContent).toBe('连读')
        } else {
          expect([...rendered.querySelectorAll('rb')].map(node => node.textContent)).toEqual(['新', '字'])
          expect([...rendered.querySelectorAll('rt')].map(node => node.textContent)).toEqual(['xin', 'zi'])
        }
      }
      finally { await cold.dispose() }
      expect(reopened.resources.components).toEqual(original.resources.components)
    } finally { await h.dispose() }
  }
})

it('registers container body and image caption, saves updates and retires hidden fields', async () => {
  for (const [kind, key, visibility] of [['visual/text-container', 'body', 'showBody'], ['visual/image-frame', 'caption', 'showCaption']]) {
    const original = preset(kind), h = await fixture(original.project, original.resources)
    try {
      await h.edit(h.spot(original.id, ['content', key]), '保存后的画面文字')
      expect(h.roundtrip().project.instances[original.id].data).toMatchObject({ content: { [key]: '保存后的画面文字' } })
      expect(h.roots.get(original.id)!.querySelector(`[data-courseware-edit-key="content.${key}"]`)!.textContent).toBe('保存后的画面文字')
      await h.bridge.edit([{ type: 'data.set', instanceId: original.id, path: [visibility], value: false }]); await h.sync()
      expect(h.world.authorSpots().some(field => field.instanceId === original.id && field.dataPath?.join('.') === `content.${key}`)).toBe(false)
    } finally { await h.dispose() }
  }
})
