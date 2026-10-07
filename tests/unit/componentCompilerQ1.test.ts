// @vitest-environment node
import { expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { InMemoryComponentCompilation } from '../../src/core/components/compilation/InMemoryComponentCompilation'
import { createEsbuildComponentCompiler } from '../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'
import { projectWebModuleGraph, type WebRuntimeData } from '../../src/components/web/moduleGraph'
import { buildPublishedCourseV3 } from '../../src/core/publish/componentPlatform/buildPublishedCourseV3'
import { extractHtmlResources } from '../../src/main/workbench/htmlImport/extractHtmlResources'

it('prepares only reachable HTML modules and retains unused author files without blocking offline output', async () => {
  const project = createBlankCourseProjectV10('Reachable HTML modules')
  project.definitions.web = { id: 'web', role: 'content', implementation: { kind: 'builtin', key: 'guoling.html-program' } }
  project.instances.web = { id: 'web', definitionId: 'web', data: {
    html: '<script type="module" src="./main.js"></script>',
    modules: {
      'main.js': "import { value } from './shared.js'; export const answer = value + 1;",
      'shared.js': 'export const value = 41;',
      'unused.js': "import './missing.js';",
      'draft.js': 'export const value = (',
    },
  } }
  project.surfaces[0].childIds.push('web')
  const before = structuredClone(project)
  const compilation = new InMemoryComponentCompilation(createEsbuildComponentCompiler())
  const runtime = await projectWebModuleGraph(project.instances.web, input => compilation.compile(input))
  expect(Object.keys((runtime.data as WebRuntimeData).moduleGraph!.modules).sort()).toEqual(['main.js', 'shared.js'])
  const published = await buildPublishedCourseV3({ project, assetBytes: {} }, { compilation })
  expect(published.diagnostics).toEqual([])
  expect(published.offlineComplete).toBe(true)
  expect(published.payload.instances.web.data.modules).toEqual(before.instances.web.data.modules)
  expect(project).toEqual(before)
})

it('reports a missing reachable HTML import while retaining source and usable sibling entries', async () => {
  const project = createBlankCourseProjectV10('Missing used HTML module')
  project.definitions.web = { id: 'web', role: 'content', implementation: { kind: 'builtin', key: 'guoling.html-program' } }
  project.instances.web = { id: 'web', definitionId: 'web', data: {
    html: '<script type="module" src="./main.js"></script><script type="module" src="./healthy.js"></script>',
    modules: { 'main.js': "import './missing.js';", 'healthy.js': 'export const value = 42;' },
  } }
  project.surfaces[0].childIds.push('web')
  const before = structuredClone(project)
  const compilation = new InMemoryComponentCompilation(createEsbuildComponentCompiler())
  const published = await buildPublishedCourseV3({ project, assetBytes: {} }, { compilation })
  expect(published.offlineComplete).toBe(false)
  expect(published.diagnostics).toEqual([expect.objectContaining({ code: 'source-compile-failed', message: expect.stringContaining('missing.js') })])
  const data = published.payload.instances.web.data as WebRuntimeData
  expect(data.moduleGraph!.modules['healthy.js'].code).toContain('42')
  expect(data.modules).toEqual(before.instances.web.data.modules)
  expect(project).toEqual(before)
})

it('does not compile stored HTML module files when the document has no executable module entry', async () => {
  const instance = { id: 'web', definitionId: 'web', data: {
    html: '<h1>Static content</h1>', modules: { 'unused.js': "import './missing.js';" },
  } }
  const runtime = await projectWebModuleGraph(instance, async () => { throw new Error('unused files do not need compilation') })
  expect(runtime).toBe(instance)
})

it('prepares recursive srcdoc entries with their actual local base and CSS module resources', async () => {
  const encode = (value: string) => new TextEncoder().encode(value)
  const closure = extractHtmlResources({
    html: '<!doctype html><html><body><iframe src="child/page.html"></iframe><iframe srcdoc="&lt;base href=&quot;child/assets/&quot;&gt;&lt;script type=&quot;module&quot; src=&quot;main.js&quot;&gt;&lt;/script&gt;"></iframe></body></html>',
    siblingFiles: new Map([
      ['child/page.html', encode('<!doctype html><html><head><base href="assets/"></head><body><iframe srcdoc="&lt;script type=&quot;module&quot; src=&quot;main.js&quot;&gt;&lt;/script&gt;"></iframe><button id="count">0</button><script type="module" src="main.js"></script></body></html>')],
      ['child/assets/main.js', encode('import "./theme.css";document.querySelector("#count")?.addEventListener("click",()=>document.querySelector("#count").textContent="1")')],
      ['child/assets/theme.css', encode('@import "./nested.css";button{background:url(./pixel.png)}')],
      ['child/assets/nested.css', encode('button{color:green}')],
      ['child/assets/pixel.png', Uint8Array.of(137,80,78,71,0)],
    ]),
  })
  expect(closure.diagnostics.filter(item => item.code === 'missing-relative-resource')).toEqual([])
  expect(closure.resources).toHaveLength(1)
  const compiled = await projectWebModuleGraph({ id: 'nested', definitionId: 'web', data: { html: closure.html, modules: closure.modules! } }, input => new InMemoryComponentCompilation(createEsbuildComponentCompiler()).compile(input))
  const graph = (compiled.data as WebRuntimeData).moduleGraph!
  expect(graph.entries).toEqual({ '0:0': 'child/assets/main.js', '0/0:0': 'child/assets/main.js', '1:0': 'child/assets/main.js' })
  expect(graph.modules['child/assets/main.js']!.imports[0]!.path).toBe('child/assets/theme.css')
  expect(graph.modules['child/assets/theme.css']!.code).toContain('cw-resource:')
  expect(graph.modules['child/assets/theme.css']!.code).toContain('green')
})
