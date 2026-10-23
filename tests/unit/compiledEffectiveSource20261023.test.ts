// @vitest-environment node
import { expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { buildPublishedCourseV3 } from '../../src/core/publish/componentPlatform/buildPublishedCourseV3'
import { compileCoursePlayback } from '../../src/core/publish/componentPlatform/compileCoursePlayback'
import { InMemoryComponentCompilation } from '../../src/core/components/compilation/InMemoryComponentCompilation'
import { createEsbuildComponentCompiler } from '../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'

function sourceProject(override: boolean) {
  const project = createBlankCourseProjectV10('Effective source delivery')
  const implementation = { kind: 'source' as const, language: 'javascript' as const,
    source: 'export default { mount({root}) { root.textContent="Delivered program"; return {update(){},dispose(){}} } }' }
  project.definitions.program = { id: 'program', role: 'content', implementation: {
    ...implementation, source: 'export default { mount() { throw new Error("Unused default template") } }',
  } }
  project.instances.program = { id: 'program', definitionId: 'program', data: { label: 'base' },
    frame: { width: 320, height: 180, transform: [1, 0, 0, 1, 20, 20] },
    ...(override ? { implementationOverride: implementation } : {}) }
  const root = project.instances[project.rootIds[0]!]!
  root.childIds = ['program']
  root.container!.presentation = { states: [{ id: 'detail', title: 'Detail',
    overrides: { program: { data: { label: 'detail' } } } }] }
  return project
}

async function compile(payload: Awaited<ReturnType<typeof buildPublishedCourseV3>>['payload']) {
  const dom = new JSDOM('<!doctype html>')
  try {
    return await compileCoursePlayback(payload, { document: dom.window.document,
      renderBuiltin: async () => { throw new Error('Unexpected static builtin') } })
  } finally { dom.window.close() }
}

it('publishes and compiles the effective override without diagnosing its unused default source template', async () => {
  const project = sourceProject(true), before = structuredClone(project)
  const published = await buildPublishedCourseV3({ project, assetBytes: {} }, {
    compilation: new InMemoryComponentCompilation(createEsbuildComponentCompiler()),
  })
  expect(published.diagnostics).toEqual([])
  expect(published.offlineComplete).toBe(true)
  expect(published.payload.definitions.program!.implementation).not.toHaveProperty('compiled')
  expect(published.payload.instances.program!.implementationOverride).toHaveProperty('compiled.code')

  const artifact = await compile(published.payload)
  expect(artifact.diagnostics).toEqual([])
  expect(artifact.sourceFactories['instance:program'] ?? artifact.nativeSources?.['instance:program']).toBeTruthy()
  expect(artifact.sourceFactories).not.toHaveProperty('definition:program')
  expect(artifact.course.definitions.program).toEqual(published.payload.definitions.program)
  expect(artifact.course.instances.program!.implementationOverride).toMatchObject({ kind: 'source', source: 'instance:program' })
  expect(artifact.course.instances[project.rootIds[0]!]!.container!.presentation).toEqual(
    published.payload.instances[project.rootIds[0]!]!.container!.presentation)
  expect(project).toEqual(before)
})

it.each([false, true])('retains missing compiled-source diagnostics for an effective implementation (override=%s)', async override => {
  const published = await buildPublishedCourseV3({ project: sourceProject(override), assetBytes: {} })
  expect(published.diagnostics.some(issue => issue.code === 'source-not-compiled')).toBe(true)
  const artifact = await compile(published.payload)
  expect(artifact.diagnostics).toContainEqual(expect.objectContaining({
    code: 'compiled-native-source-unavailable', ...(override ? { instanceId: 'program' } : {}),
  }))
})
