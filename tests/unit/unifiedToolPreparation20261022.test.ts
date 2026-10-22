// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { boundedModelValue, modelJsonBytes, modelJsonFits, modelTextEnd } from '../../src/core/tools/modelDeliveryBudget'
import { componentProjectFiles, copyComponentProjectFile } from '../../src/core/projectFiles/componentPlatform/projection'
import { ComponentProjectFileCoordinator, type ComponentProjectSnapshot, type ComponentProjectFileBatchItem } from '../../src/core/projectFiles/componentPlatform/coordinator'
import type { ContentApplyResult } from '../../src/core/contentApply/planning/types'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { appendRootContainers, testContainerInstance } from '../helpers/glxWorkFixture'

describe('bounded tool delivery prepares only what can be delivered', () => {
  it('matches JSON UTF-8 byte boundaries including escaping, lone surrogates and toJSON', () => {
    const values: unknown[] = [undefined, null, true, false, 0, -0, 1e21, Infinity, '😀\n\\"\u0001\ud800中',
      [undefined, null, 'é😀'], { one: undefined, two: '\t中', three: ['😀'] },
      new Date('2026-10-22T00:00:00Z'), { value: { toJSON: () => undefined } }, { toJSON: () => undefined }]
    for (const value of values) {
      const size = modelJsonBytes(value)
      expect(modelJsonFits(value, size)).toBe(true)
      expect(modelJsonFits(value, size - 1)).toBe(false)
    }
  })

  it('stops counting at the budget before reading later values and preserves source continuation', () => {
    let lateReads = 0
    const source = { body: '大正文😀\n\\"'.repeat(100_000), get late() { lateReads++; return 'unneeded' } }
    expect(modelJsonFits(source, 1024)).toBe(false)
    expect(lateReads).toBe(0)
    const page = boundedModelValue(source.body, { maxBytes: 1500, offset: 37 })
    expect(modelJsonBytes(page)).toBeLessThanOrEqual(1500)
    expect(page.value).toBe(source.body.slice(37, page.nextOffset))
    expect(page.nextOffset).toBeGreaterThan(37)
    expect(String(page.value)).not.toMatch(/[\uD800-\uDBFF]$/u)
  })

  it('finds the largest exact non-split text range without encoding a growing prefix', () => {
    const source = 'a😀\n中\\"\u0001tail'
    for (const budget of [2, 3, 6, 7, 13, 25, 100]) {
      let expected = 0
      for (let end = 0; end <= source.length; end++) {
        if (/[\uD800-\uDBFF]/u.test(source[end - 1] ?? '') && /[\uDC00-\uDFFF]/u.test(source[end] ?? '')) continue
        if (modelJsonBytes(source.slice(0, end)) <= budget) expected = end
      }
      expect(modelTextEnd(source, 0, source.length, budget)).toBe(expected)
    }
  })
})

it('discovers a small project path without serializing unrelated data, and materializes one captured value once', () => {
  const project = createBlankCourseProjectV10('Lazy project files')
  project.definitions.source = { id: 'source', title: 'Source', role: 'content', implementation: {
    kind: 'source', language: 'javascript', source: 'export default { mount() {} }' } }
  let reads = 0
  const data = { get title() { reads++; return '原对象内容' } }
  project.instances.local = { id: 'local', definitionId: 'source', data }
  testContainerInstance(project, 0).childIds.push('local')
  const files = componentProjectFiles(project, { assets: {}, components: {} }, 'theme.css')
  expect(reads).toBe(0)
  expect(files.find(file => file.path === 'theme.css')?.content).toBe('')
  expect(reads).toBe(0)
  const file = files.find(file => file.target?.kind === 'instance' && file.target.instanceId === 'local' && file.path.endsWith('.data.json'))!
  const alias = copyComponentProjectFile(file, { path: 'original-observed-name.data.json' })
  expect(JSON.parse(alias.content!)).toEqual({ title: '原对象内容' })
  expect(file.content).toBe(alias.content)
  expect(reads).toBe(1)
})

it('prepares a file batch from one document capture and reads committed facts once', async () => {
  const project = createBlankCourseProjectV10('File batch')
  project.definitions.source = { id: 'source', title: 'Source', role: 'content', implementation: {
    kind: 'source', language: 'javascript', source: 'export default { mount() {} }' } }
  project.instances.one = { id: 'one', definitionId: 'source', data: { title: 'one' } }
  project.instances.two = { id: 'two', definitionId: 'source', data: { title: 'two' } }
  testContainerInstance(project, 0).childIds = ['one', 'two']
  const snapshot = { documentId: 'project', epoch: 'epoch', revision: 0,
    binding: { kind: 'untitled', suggestedName: 'batch.glx' }, model: { kind: 'course-v10', project, resources: { assets: {}, components: {} } },
    dirty: true, saving: false, recoverable: true, recovered: false, undoDepth: 0, redoDepth: 0 } as ComponentProjectSnapshot
  const document = vi.fn(async () => snapshot)
  const applyBatch = vi.fn(async (_run: string, _operation: string, _digest: string, operations: ComponentProjectFileBatchItem[]): Promise<ContentApplyResult[]> => operations.map(item => ({
    commit: 'unchanged', usability: 'usable', delivery: 'not_requested', diagnostics: [], insertedIds: [], input: item.request,
  })))
  const coordinator = new ComponentProjectFileCoordinator({ document, applyBatch,
    async source() { throw new Error('Only literal JSON') }, async apply() { throw new Error('A batch must use applyBatch') } })
  const files = componentProjectFiles(project, snapshot.model.resources)
  const paths = ['one', 'two'].map(id => files.find(file => file.target?.kind === 'instance' && file.target.instanceId === id && file.path.endsWith('.data.json'))!.path)
  const result = await coordinator.execute('run', 'batch', 'batch', 'project.apply', { operations: paths.map((path, index) => ({ path, content: JSON.stringify({ title: `updated-${index}` }) })) })
  expect(result).toMatchObject({ kind: 'read', data: { commit: 'unchanged' } })
  expect(applyBatch).toHaveBeenCalledOnce()
  expect(document).toHaveBeenCalledTimes(2)
})

it('keeps graph and complete directory requests distinct on the same capture in either order', () => {
  const project = createBlankCourseProjectV10('Scoped directory')
  appendRootContainers(project, { id: 'spatial', title: 'Spatial', kind: 'spatial', childIds: [],
    spatial: { home: { x: 0, y: 0, zoom: 1 }, frames: [], paths: [{ id: 'route', title: 'Route', frameIds: [], instanceIds: [] }] } })
  for (const graphFirst of [true, false]) {
    const snapshot = { documentId: 'scoped', epoch: 'epoch', revision: 0,
      model: { kind: 'course-v10', project, resources: { assets: {}, components: {} } } } as ComponentProjectSnapshot
    const coordinator = new ComponentProjectFileCoordinator({ async document() { return snapshot },
      async source() { throw new Error('Only directories') }, async apply() { throw new Error('Only directories') } })
    const graph = () => coordinator.listScope('run', snapshot, { kind: 'graph', surfaceId: 'spatial', graph: 'path', graphId: 'route' })
    const complete = () => coordinator.listScope('run', snapshot, { kind: 'document' })
    const first = graphFirst ? graph() : complete(), second = graphFirst ? complete() : graph()
    const graphFiles = graphFirst ? first.files : second.files, allFiles = graphFirst ? second.files : first.files
    expect(allFiles.some(file => file.type === 'page')).toBe(true)
    expect(graphFiles.some(file => file.type === 'page')).toBe(false)
  }
})
