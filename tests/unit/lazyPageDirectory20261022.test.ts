// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { parse, serializeOuter } from 'parse5'
import { formulaComponentHtml, textComponentHtml } from '../../src/components/text/render'
import { createTextComponentData, formulaComponentDataSchema } from '../../src/components/text/data'
import { createImageData } from '../../src/components/image/data'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { componentProjectFiles, copyComponentProjectFile, projectHtmlProjection } from '../../src/core/projectFiles/componentPlatform/projection'
import { testContainerInstance } from '../helpers/glxWorkFixture'

vi.mock('parse5', async importOriginal => {
  const actual = await importOriginal<typeof import('parse5')>()
  return { ...actual, parse: vi.fn(actual.parse), serializeOuter: vi.fn(actual.serializeOuter) }
})
vi.mock('../../src/components/text/render', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/components/text/render')>()
  return { ...actual, textComponentHtml: vi.fn(actual.textComponentHtml), formulaComponentHtml: vi.fn(actual.formulaComponentHtml) }
})

afterEach(() => vi.clearAllMocks())
const resources = () => ({ assets: {}, components: {} })
function fixture() {
  const project = createBlankCourseProjectV10('Lazy page directory')
  for (const key of ['text', 'formula', 'image', 'web', 'html-program', 'chart']) project.definitions[key] = {
    id: key, title: key, role: 'content', implementation: { kind: 'builtin', key: `guoling.${key}` },
  }
  return { project, page: testContainerInstance(project, 0) }
}
const frame = () => ({ width: 240, height: 160, transform: [1, 0, 0, 1, 40, 60] as [number, number, number, number, number, number] })

it('lists native pages and their summaries without rendering or parsing, then materializes one shared capture value', () => {
  const { project, page } = fixture()
  project.instances.text = { id: 'text', definitionId: 'text', data: JSON.parse(JSON.stringify(createTextComponentData('Current <text> & content'))), frame: frame() }
  project.assets.photo = { id: 'photo', path: 'assets/photo.png', width: 600, height: 400, mimeType: 'image/png' }
  project.instances.photo = { id: 'photo', definitionId: 'image', data: createImageData('photo', 'Current image'), frame: frame() }
  page.childIds = ['text', 'photo']
  vi.clearAllMocks()

  const files = componentProjectFiles(project, resources())
  const file = files.find(file => file.kind === 'page')!
  expect(file.summary).toContain('2 个顶层对象')
  expect(files.map(file => file.summary).length).toBe(files.length)
  expect(textComponentHtml).not.toHaveBeenCalled()
  expect(parse).not.toHaveBeenCalled()
  expect(serializeOuter).not.toHaveBeenCalled()

  const alias = copyComponentProjectFile(file, { path: 'observed-page.html' })
  expect(alias.content).toContain('Current &lt;text&gt; &amp; content')
  expect(alias.content).toContain('cw-resource:photo')
  const calls = vi.mocked(serializeOuter).mock.calls.length
  expect(calls).toBeGreaterThan(0)
  expect(file.projection!.entries.map(entry => entry.instanceId)).toEqual(['text', 'photo'])
  expect(file.projection!.html).toBe(alias.content)
  expect(file.content).toBe(alias.content)
  expect(serializeOuter).toHaveBeenCalledTimes(calls)
})

it.each([
  ['fragment', '<section><p>Current &amp; text</p><table>before<tr><td>cell</td></tr>after</table><script>const value = "<&"</script></section>', true],
  ['multiple roots', '<h1>First</h1><p>Second</p>', false],
  ['fostered text', '<table>outside<tr><td>cell</td></tr></table>', false],
  ['raw script', '<script>const markup = "<section>";</script><p>Body</p>', true],
  ['explicit document', '<!doctype html><html><head><title>Title</title></head><body>Text<h1>A</h1><p>B</p></body></html>', true],
])('keeps the original exact web projection decision for %s', (_label, html, available) => {
  const { project, page } = fixture()
  project.instances.web = { id: 'web', definitionId: 'web', data: { html, css: '.authored{color:red}' }, frame: frame() }
  page.childIds = ['web']
  vi.clearAllMocks()
  const file = componentProjectFiles(project, resources()).find(file => file.kind === 'page')
  expect(Boolean(file)).toBe(available)
  expect(serializeOuter).not.toHaveBeenCalled()
  if (file) {
    const preflightParses = vi.mocked(parse).mock.calls.length
    expect(file.summary).toContain('1 个顶层对象')
    expect(parse).toHaveBeenCalledTimes(preflightParses)
    const projection = file.projection!
    expect(projection.entries.map(entry => entry.instanceId)).toEqual(['web'])
    if (_label === 'explicit document') expect(projection).toEqual({ html, entries: [{ instanceId: 'web', sourcePath: [] }] })
    if (_label === 'fragment') {
      expect(projection.html).toContain('beforeafter<table>')
      expect(projection.html).toContain('const value = "<&"')
    }
    const after = vi.mocked(parse).mock.calls.length
    expect(file.content).toBe(projection.html)
    expect(parse).toHaveBeenCalledTimes(after)
  }
})

it('does not list pages with unsupported descendants, Source overrides or unprojectable image treatment', () => {
  for (const unsupported of ['chart', 'source', 'feather', 'missing-size']) {
    const { project, page } = fixture()
    project.instances.parent = { id: 'parent', definitionId: 'web', data: { html: '<section>Parent</section>' }, childIds: ['child'] }
    project.instances.child = { id: 'child', definitionId: 'text', data: JSON.parse(JSON.stringify(createTextComponentData('Child'))) }
    if (unsupported === 'chart') project.instances.child = { id: 'child', definitionId: 'chart', data: {} }
    if (unsupported === 'source') project.instances.child.implementationOverride = { kind: 'source', language: 'javascript', source: 'export default {}' }
    if (unsupported === 'feather' || unsupported === 'missing-size') {
      project.assets.photo = { id: 'photo', path: 'assets/photo.png', ...(unsupported === 'feather' ? { width: 600, height: 400 } : {}) }
      project.instances.child = { id: 'child', definitionId: 'image', frame: frame(), data: { ...createImageData('photo'),
        ...(unsupported === 'feather' ? { feather: { amount: 12, mode: 'rectangle' } } : {}) } }
    }
    page.childIds = ['parent']
    const files = componentProjectFiles(project, resources())
    expect(files.some(file => file.kind === 'page')).toBe(false)
    expect(files.some(file => file.target?.kind === 'instance' && file.target.instanceId === 'child' && file.kind === 'data')).toBe(true)
  }
})

it('keeps the program leaf shortcut, nested mappings and resource-projected qualification', () => {
  const { project, page } = fixture()
  project.instances.program = { id: 'program', definitionId: 'html-program', data: { html: '<h1>One</h1><p>Two</p>' } }
  page.childIds = ['program']
  expect(componentProjectFiles(project, resources()).find(file => file.kind === 'page')?.projection).toEqual({
    html: '<h1>One</h1><p>Two</p>', entries: [{ instanceId: 'program', sourcePath: [] }],
  })
  project.instances.program.childIds = ['child']
  project.instances.child = { id: 'child', definitionId: 'text', data: JSON.parse(JSON.stringify(createTextComponentData('Child'))) }
  expect(componentProjectFiles(project, resources()).some(file => file.kind === 'page')).toBe(false)

  project.assets.image = { id: 'image', path: 'assets/image.png', mimeType: 'image/png' }
  project.instances.web = { id: 'web', definitionId: 'web', frame: frame(), data: {
    html: '<section id="authored"><img src="./assets/image.png"><span>Parent</span></section>', css: '.authored{background:url(./assets/image.png)}',
  }, childIds: ['child'] }
  page.childIds = ['web']
  const actual = componentProjectFiles(project, resources()).find(file => file.kind === 'page')!.projection!
  expect(actual.entries.map(entry => entry.instanceId)).toEqual(['web', 'child'])
  expect(actual.html).toContain('cw-resource:image')
  expect(actual.html).toContain('.authored{background:url("cw-resource:image")}')
  expect(actual.html).toContain('transform:matrix(1,0,0,1,40,60)')
  expect(projectHtmlProjection(project, page.childIds, page.container.designSize)).toEqual(actual)

  // The existing raw-style resource projection can change parser structure;
  // availability must use its actual result rather than the unprojected source.
  delete project.assets.image
  const assetId = 'image</style><p>extra</p><style>'
  project.assets[assetId] = { id: assetId, path: 'assets/image.png', mimeType: 'image/png' }
  project.instances.web.data = { html: '<style>.x{background:url(./assets/image.png)}</style><section>Body</section>' }
  delete project.instances.web.childIds
  expect(componentProjectFiles(project, resources()).some(file => file.kind === 'page')).toBe(false)
})

it('keeps current math renderer failures at availability preparation and reuses successful markup', () => {
  for (const native of ['formula', 'text']) {
    const { project, page } = fixture()
    const formula = { type: 'math' as const, formulaId: 'formula', latex: '\\text{a#b}', accessibleText: 'a#b' }
    const data = native === 'formula' ? formulaComponentDataSchema.parse({ formula }) : createTextComponentData({ inlines: [formula] })
    project.instances.math = { id: 'math', definitionId: native, data: JSON.parse(JSON.stringify(data)) }
    page.childIds = ['math']
    expect(() => componentProjectFiles(project, resources())).toThrow()
  }
  const { project, page } = fixture()
  project.instances.formula = { id: 'formula', definitionId: 'formula', data: JSON.parse(JSON.stringify(formulaComponentDataSchema.parse({
    formula: { type: 'math', formulaId: 'formula', latex: 'x^2', accessibleText: 'x squared' },
  }))) }
  page.childIds = ['formula']
  vi.clearAllMocks()
  const file = componentProjectFiles(project, resources()).find(file => file.kind === 'page')!
  expect(formulaComponentHtml).toHaveBeenCalledOnce()
  expect(parse).not.toHaveBeenCalled()
  expect(serializeOuter).not.toHaveBeenCalled()
  expect(file.content).toContain('<math')
  expect(file.projection!.entries).toEqual([{ instanceId: 'formula', sourcePath: [0] }])
  expect(formulaComponentHtml).toHaveBeenCalledOnce()
})

it('reuses parsed web roots for an immediate projection or explicit page read', () => {
  const { project, page } = fixture()
  for (const id of ['one', 'two']) project.instances[id] = { id, definitionId: 'web', data: { html: `<section>${id}</section>` } }
  page.childIds = ['one', 'two']
  const path = componentProjectFiles(project, resources()).find(file => file.kind === 'page')!.path
  vi.clearAllMocks()
  const direct = projectHtmlProjection(project, page.childIds, page.container.designSize)!
  expect(parse).toHaveBeenCalledTimes(3) // two actual root parses and one empty page body
  expect(direct.entries.map(entry => entry.instanceId)).toEqual(['one', 'two'])
  vi.clearAllMocks()
  const file = componentProjectFiles(project, resources(), path).find(file => file.path === path)!
  expect(parse).toHaveBeenCalledTimes(2)
  expect(serializeOuter).not.toHaveBeenCalled()
  expect(file.content).toBe(direct.html)
  expect(parse).toHaveBeenCalledTimes(3)
})
