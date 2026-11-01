// @vitest-environment node
import { expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { componentCompilationInput } from '../../src/core/components/compilation/componentCompilationInput'
import { InMemoryComponentCompilation } from '../../src/core/components/compilation/InMemoryComponentCompilation'
import { createEsbuildComponentCompiler } from '../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'
import { buildPublishedCourseV4 } from '../../src/core/publish/componentPlatform/buildPublishedCourseV3'
import { testContainerInstance } from '../helpers/glxWorkFixture'

it('delivers executable dependency closures without editor maps and preserves the author cache and snapshot', async () => {
  const project = createBlankCourseProjectV10('Source delivery')
  project.definitions.logic = { id: 'logic', role: 'mixed', implementation: { kind: 'source', language: 'javascript',
    source: 'export const calculate = value => value * 7;' } }
  const source = { kind: 'source' as const, language: 'javascript' as const,
    source: "import {calculate} from './logic'; export default {mount(context){context.root.textContent=String(calculate(context.instance.data.value)); return {update(next){context.root.textContent=String(calculate(next.data.value))},dispose(){}}}}",
    moduleBindings: { './logic': 'logic' } }
  project.definitions.view = { id: 'view', role: 'content', implementation: source }
  project.instances.one = { id: 'one', definitionId: 'view', data: { value: 6 } }
  project.instances.two = { id: 'two', definitionId: 'view', data: { value: 9 } }
  testContainerInstance(project, 0).childIds = ['one', 'two']
  const before = structuredClone(project), compiler = new InMemoryComponentCompilation(createEsbuildComponentCompiler())
  const input = componentCompilationInput(project, source, { assets: {}, components: {} })
  const editor = await compiler.compile(input)
  expect(editor.status).toBe('ready')
  if (editor.status !== 'ready') throw new Error('Author compiler unavailable')
  expect(editor.artifact.code).toContain('sourceMappingURL=')
  const result = await buildPublishedCourseV4({ project, assetBytes: {} }, { compilation: compiler })
  expect(result.diagnostics).toEqual([])
  const delivered = result.payload.definitions.view.implementation
  if (delivered.kind !== 'source' || !delivered.compiled) throw new Error('Missing delivery Source')
  expect(delivered.compiled.code).not.toContain('sourceMappingURL=')
  expect(delivered.compiled.code.length).toBeLessThan(editor.artifact.code.length)
  const runtime = await import(`data:text/javascript;base64,${Buffer.from(delivered.compiled.code).toString('base64')}`)
  const first = { textContent: '' }, second = { textContent: '' }
  const mounted = runtime.default.mount({ root: first, instance: project.instances.one })
  runtime.default.mount({ root: second, instance: project.instances.two })
  expect([first.textContent, second.textContent]).toEqual(['42', '63'])
  mounted.update({ data: { value: 8 } })
  expect([first.textContent, second.textContent]).toEqual(['56', '63'])
  expect(project).toEqual(before)
  const editorAgain = await compiler.compile(input)
  expect(editorAgain.cacheHit).toBe(true)
  expect(editorAgain.status === 'ready' && editorAgain.artifact.code).toBe(editor.artifact.code)
})
