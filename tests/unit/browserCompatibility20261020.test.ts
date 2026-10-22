// @vitest-environment node
import { testContainerInstance } from '../helpers/glxWorkFixture'
import { describe, expect, it } from 'vitest'
import { JSDOM, VirtualConsole } from 'jsdom'
import { browserCompatibilityTarget } from '../../src/shared/browser/browserCompatibility'
import { InMemoryComponentCompilation } from '../../src/core/components/compilation/InMemoryComponentCompilation'
import { createEsbuildComponentCompiler } from '../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'
import { prepareBrowserScripts } from '../../src/core/publish/componentPlatform/prepareBrowserScripts'
import { buildCompiledSingleHtml } from '../../src/core/publish/componentPlatform/buildSingleHtml'
import type { CompiledCoursePlayback } from '../../src/core/publish/componentPlatform/compiledContract'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { buildPublishedCourseV3 } from '../../src/core/publish/componentPlatform/buildPublishedCourseV3'
import { componentCompilationInputSchema } from '../../src/shared/workbench/componentCompilation'
import type { ComponentCompilationInput } from '../../src/core/components/compilation/types'

describe('offline Chrome 113 compatibility boundary', () => {
  it('transpiles classic scripts, handlers and nested documents before publication without editing source', async () => {
    const compilation = new InMemoryComponentCompilation(createEsbuildComponentCompiler())
    const compile = (input: ComponentCompilationInput) => compilation.compile(componentCompilationInputSchema.parse(input))
    const child = '<script>class Child { accessor value = 7 };window.childResult=new Child().value;</script>'
    const html = `<script>var count=2;class Counter { accessor value = count };window.result=new Counter().value;</script><script>function add(){return ++count};window.next=add();</script><button onclick="class Answer { accessor value = 9 };window.answer=new Answer().value;return false">answer</button><iframe srcdoc="${child.replace(/</g, '&lt;').replace(/"/g, '&quot;')}"></iframe>`
    const project = createBlankCourseProjectV10('Browser target')
    project.definitions.web = { id: 'web', role: 'content', implementation: { kind: 'builtin', key: 'guoling.html-program' } }
    project.instances.web = { id: 'web', definitionId: 'web', data: { html } }
    testContainerInstance(project, 0).childIds.push('web')
    const published = await buildPublishedCourseV3({ project, assetBytes: {} }, { compilation: { compile } })
    expect(published.diagnostics).toEqual([])
    expect((project.instances.web.data as { html: string }).html).toBe(html)
    const prepared = String((published.payload.instances.web.data as { html: string }).html)
    expect(prepared).not.toContain('accessor value')
    const dom = new JSDOM(prepared, { runScripts: 'dangerously' })
    expect(dom.window.result).toBe(2); expect(dom.window.next).toBe(3)
    dom.window.document.querySelector('button')!.click()
    expect(dom.window.answer).toBe(9)
    expect(dom.window.document.querySelector('iframe')!.srcdoc).toContain('window.childResult')
    dom.window.close()
    const handlerOnly = await prepareBrowserScripts('<button onclick="\'use strict\';class Answer { accessor value = 9 };window.answer=new Answer().value;return false">answer</button>', compile, () => {})
    const handlerDom = new JSDOM(handlerOnly, { runScripts: 'dangerously' })
    handlerDom.window.document.querySelector('button')!.click()
    expect(handlerDom.window.answer).toBe(9)
    handlerDom.window.close()
    const result = await compilation.compile({ entry: 'entry.js', files: { 'entry.js': 'export const value=1' } })
    expect(result.source.options?.target).toBe(browserCompatibilityTarget)
  })

  it('retains a failed script and compiles a healthy sibling with a local diagnostic', async () => {
    const compilation = new InMemoryComponentCompilation(createEsbuildComponentCompiler()), issues: string[] = []
    const html = '<script>let broken = (;</script><script>class Good { accessor value=3 };window.good=new Good().value;</script>'
    const prepared = await prepareBrowserScripts(html, input => compilation.compile(input), issue => issues.push(issue.message))
    expect(prepared).toContain('let broken = (;'); expect(prepared).not.toContain('accessor value')
    expect(issues).toHaveLength(1)
  })

  it('shows bundle parse failures and synchronous entry/JSON failures instead of a blank page', async () => {
    const artifact = { title: 'Compatibility', format: 'compiled-course-v2' } as CompiledCoursePlayback
    for (const [bundle, mutate, expected] of [
      ['const =;', false, /Unexpected token/],
      ['var CoursewareCompiledPlayer={mountCompiledCourse:function(){throw new Error("entry failed")}};', false, /entry failed/],
      ['var CoursewareCompiledPlayer={mountCompiledCourse:function(){return Promise.resolve({})}};', true, /课件加载失败/],
    ] as const) {
      let html = buildCompiledSingleHtml(artifact, bundle)
      if (mutate) html = html.replace(/(<script id="course-data" type="application\/json">)[\s\S]*?(<\/script>)/, '$1{$2')
      const dom = new JSDOM(html, { runScripts: 'dangerously', virtualConsole: new VirtualConsole() })
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(dom.window.document.getElementById('course-diagnostic')!.textContent).toMatch(expected)
      expect(dom.window.document.getElementById('course-diagnostic')!.hidden).toBe(false)
      dom.window.close()
    }
  })
})
