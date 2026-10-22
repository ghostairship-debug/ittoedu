import { expect, it } from 'vitest'
import type { ComponentDefinition, CourseProjectV10 } from '../../src/shared/contracts/component-platform/project'
import type { ComponentLibraryEntry } from '../../src/shared/contracts/component-platform/library'
import type { DocumentResources } from '../../src/shared/workbench/document'
import { inspectComponentLibraryUpdate } from '../../src/core/components/library/updateSource'
import { planCourseComponentPackageReplacement } from '../../src/core/components/library/replacement'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'

const source = 'export default {mount(){return {update(){},dispose(){}}}}'
const updatedSource = 'export default {mount(){return {update(){},dispose(){},version:2}}}'
const bytes = (value: string) => new TextEncoder().encode(value)
const resources = (): DocumentResources => ({ assets: {}, components: {} })

function fixture(): { project: CourseProjectV10; entry: ComponentLibraryEntry; resources: DocumentResources } {
  const implementation = { kind: 'source', language: 'javascript', source } as const
  const definition: ComponentDefinition = { id: 'widget', role: 'content', version: '1.0.0', implementation,
    dataSchema: { type: 'object', properties: { text: { type: 'string' } } },
    library: { packageId: 'widget-library', version: '1.0.0', baseline: { implementation: structuredClone(implementation),
      dataSchema: { type: 'object', properties: { text: { type: 'string' } } }, sourceFiles: { '[inline source]': source } } } }
  const project: CourseProjectV10 = { schemaVersion: 11, id: 'program-work', revision: 0, title: '程序工程',
    definitions: { widget: definition }, instances: { app: { id: 'app', definitionId: 'widget', data: { text: '人工正文' },
      frame: { width: 320, height: 180, transform: [1, 0, 0, 1, 12, 24] } } }, rootIds: ['app'], entry: { rootInstanceId: 'app' },
    assets: {}, global: { underlay: [], overlay: [] } }
  const entry: ComponentLibraryEntry = { schemaVersion: 2, id: 'widget-library', title: '新版组件',
    definitions: { next: { id: 'next', role: 'content', version: '2.0.0',
      dataSchema: structuredClone(definition.dataSchema), implementation: { kind: 'source', language: 'javascript', source: updatedSource } } },
    example: { rootIds: ['sample'], instances: { sample: { id: 'sample', definitionId: 'next', data: { text: '默认正文' } } } },
    assets: {}, resources: resources() }
  return { project, entry, resources: resources() }
}

it('shows actual baseline/current/incoming source without changing a pure program project', () => {
  const value = fixture(), before = structuredClone(value)
  const review = inspectComponentLibraryUpdate(value.project, 'widget', value.entry, value.resources)
  expect(review.baselineAvailable).toBe(true)
  expect(review.localSourceModified).toBe(false)
  expect(review.sourceDiff).toContain(`- ${source}`)
  expect(review.sourceDiff).toContain(`+ ${updatedSource}`)
  expect(value).toEqual(before)
})

it('requires an explicit decision before replacing locally changed shared source', () => {
  const value = fixture()
  value.project.definitions.widget.implementation = { kind: 'source', language: 'javascript', source: `${source}\n// 人工深改` }
  const review = inspectComponentLibraryUpdate(value.project, 'widget', value.entry, value.resources)
  expect(review.localSourceModified).toBe(true)
  expect(review.sourceDiff).toContain('人工深改')
  expect(() => planCourseComponentPackageReplacement(value.project, 'widget', value.entry, {}, value.resources)).toThrow('本地修改')
  const edits = planCourseComponentPackageReplacement(value.project, 'widget', value.entry, { replaceLocalSource: true }, value.resources)
  expect(edits).toContainEqual(expect.objectContaining({ type: 'definition.set', definition: expect.objectContaining({ id: 'widget', version: '2.0.0' }) }))
})

it('detects changed workspace bytes against their retained origin material', () => {
  const value = fixture(), implementation = { kind: 'source', language: 'javascript', workspace: { ownerId: 'origin', entry: 'main.js' } } as const
  value.project.definitions.widget.implementation = implementation
  value.project.definitions.widget.library!.baseline = { implementation: structuredClone(implementation),
    dataSchema: structuredClone(value.project.definitions.widget.dataSchema), sourceFiles: { 'main.js': source } }
  value.resources.components.origin = { 'main.js': bytes(`${source}\n// 本地文件修改`) }
  const review = inspectComponentLibraryUpdate(value.project, 'widget', value.entry, value.resources)
  expect(review.localSourceModified).toBe(true)
  expect(review.differences).toContainEqual(expect.objectContaining({ path: 'main.js', baseline: source, current: `${source}\n// 本地文件修改` }))
  expect(() => planCourseComponentPackageReplacement(value.project, 'widget', value.entry, {}, value.resources)).toThrow('本地修改')
})

it('updates a compatible definition without a fabricated surface and retains instance data, frame and private source', () => {
  const value = fixture()
  value.project.instances.private = { id: 'private', definitionId: 'widget', data: { text: '独立正文' },
    implementationOverride: { kind: 'source', language: 'javascript', source: '// 独立实现\n' + source } }
  value.project.rootIds.push('private')
  const before = structuredClone(value.project.instances)
  const review = inspectComponentLibraryUpdate(value.project, 'widget', value.entry, value.resources)
  expect(review.privateInstanceCount).toBe(1)
  expect(review.localSourceModified).toBe(false)
  const edits = planCourseComponentPackageReplacement(value.project, 'widget', value.entry, {}, value.resources)
  const model = new CourseV10Driver().apply({ kind: 'course-v10', project: value.project, resources: value.resources },
    captureComponentOperation(value.project, edits))
  if (model.kind !== 'course-v10') throw new Error('Expected the formal work model')
  expect(model.project.definitions.widget.version).toBe('2.0.0')
  expect(model.project.instances).toEqual(before)
  expect(model.project.rootIds).toEqual(['app', 'private'])
  expect(model.project).not.toHaveProperty('surfaces')
})

it('reports missing historical origin honestly while retaining a current-to-update difference', () => {
  const value = fixture()
  delete value.project.definitions.widget.library!.baseline
  const review = inspectComponentLibraryUpdate(value.project, 'widget', value.entry, value.resources)
  expect(review.baselineAvailable).toBe(false)
  expect(review.localSourceModified).toBe(false)
  expect(review.summary).toContain('无法判定')
  expect(review.sourceDiff).toContain(updatedSource)
})

it('rejects workspace edits made after the update source was reviewed', () => {
  const value = fixture(), implementation = { kind: 'source', language: 'javascript', workspace: { ownerId: 'origin', entry: 'main.js' } } as const
  value.project.definitions.widget.implementation = implementation
  value.project.definitions.widget.library!.baseline = { implementation: structuredClone(implementation),
    dataSchema: structuredClone(value.project.definitions.widget.dataSchema), sourceFiles: { 'main.js': source } }
  value.resources.components.origin = { 'main.js': bytes(source) }
  const edits = planCourseComponentPackageReplacement(value.project, 'widget', value.entry, {}, value.resources)
  const concurrentResources = structuredClone(value.resources)
  concurrentResources.components.origin['main.js'] = bytes(`${source}\n// 模态之后人工修改`)
  expect(() => new CourseV10Driver().apply({ kind: 'course-v10', project: value.project, resources: concurrentResources },
    captureComponentOperation(value.project, edits))).toThrow('源码')
  expect(concurrentResources.components.origin['main.js']).toEqual(bytes(`${source}\n// 模态之后人工修改`))
})
