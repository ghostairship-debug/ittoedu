import { testContainerInstance } from '../helpers/glxWorkFixture'
// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { compileCoursePlayback } from '../../src/core/publish/componentPlatform/compileCoursePlayback'
import type { PublishedCourseV3 } from '../../src/shared/contracts/component-platform/published'

it('selects a native carrier before author code runs, including effective Web states and custom Source', async () => {
  const project = createBlankCourseProjectV10('混合发布', (() => { let id = 0; return () => `hybrid-${++id}` })())
  const html = '<!doctype html><html><head><script>globalThis.__hybridAuthorStarted = true; const worker = new Worker("./worker.js");</script></head><body><button onclick="this.textContent=\'已操作\'">运行</button></body></html>'
  const source = 'export default { mount({root}) { root.textContent = String(document instanceof Document); return {update(){},dispose(){}} } }'
  project.definitions.web = { id: 'web', role: 'content', implementation: { kind: 'builtin', key: 'guoling.web' } }
  project.definitions.source = { id: 'source', role: 'content', implementation: { kind: 'source', language: 'javascript', source } }
  project.instances.web = { id: 'web', definitionId: 'web', data: { html: '<p>静态卡片</p>' }, frame: { width: 420, height: 240, transform: [1, 0, 0, 1, 0, 0] } }
  project.instances.source = { id: 'source', definitionId: 'source', data: {}, frame: { width: 420, height: 240, transform: [1, 0, 0, 1, 440, 0] } }
  testContainerInstance(project, 0).childIds = ['web', 'source']
  testContainerInstance(project, 0).container!.presentation = { initialStateId: 'static', states: [
    { id: 'static', title: '静态', overrides: {} },
    { id: 'program', title: '程序', overrides: { web: { data: { html } } } },
  ] }
  const { revision: _revision, ...author } = project
  const published = { ...author, schemaVersion: 4, definitions: {
    ...author.definitions, source: { ...author.definitions.source, implementation: { ...author.definitions.source.implementation, compiled: { code: source } } },
  } } as PublishedCourseV3
  const before = structuredClone(published)
  const artifact = await compileCoursePlayback(published, { document, renderBuiltin: async () => '' })
  expect(published).toEqual(before)
  expect((globalThis as Record<string, unknown>).__hybridAuthorStarted).toBeUndefined()
  expect(artifact.diagnostics).toEqual([])
  expect(artifact.webPrograms.web.map(entry => Boolean(entry.program.nativeData))).toEqual([false, true])
  expect(artifact.webPrograms.web[1].program.nativeData?.html).toBe(html)
  expect(artifact.nativeSources?.['definition:source'].code).toBe(source)
  expect(artifact.sourceFactories).toEqual({})
  expect(artifact.course.instances.web.data).toEqual({ html: 'compiled-web:0', css: undefined, moduleGraph: undefined, modules: undefined, publishedModuleBundle: undefined, publishedDocumentBundles: undefined })
  expect(testContainerInstance(artifact.course, 0).container!.presentation?.states[1].overrides.web.data).toMatchObject({ html: 'compiled-web:1' })
})
