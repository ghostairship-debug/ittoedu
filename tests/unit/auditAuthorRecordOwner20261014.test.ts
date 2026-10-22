// @vitest-environment node
import { componentSurfaces } from '../../src/shared/contracts/component-platform/project'
import { testContainerInstance } from '../helpers/glxWorkFixture'
import { expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { applyComponentOperation, captureComponentOperation, presentationComponentEdits } from '../../src/core/drivers/courseV10Operations'
import { authorSpotEdits, authorSpotImageEdits } from '../../src/core/components/authoring/componentAuthorEdits'
import { prepareWebAuthoringRecordEdits } from '../../src/components/web/authoringRecords'
import { resolveComponentPresentation, type ComponentAuthorSpot, type JsonValue } from '../../src/shared/contracts/component-platform'
import { planContentApply } from '../../src/main/workbench/contentApply/application/plan'
import { ContentApplyService } from '../../src/main/workbench/contentApply/applyService'
import { patchHtmlAuthoringRecords } from '../../src/shared/html/htmlAuthoringRecords'
import { imageDataSchema, restoreImageOriginal } from '../../src/components/image/data'

const binding = { kind: 'dom' as const, path: [{ tag: 'p', index: 0, attributes: { id: 'title' } }], baseline: '标题' }
const spot: ComponentAuthorSpot = { id: 'spot', instanceId: 'source', mountGeneration: 1, kind: 'text', authorKey: 'title',
  binding, bindingStatus: 'bound', initialValue: '标题', localBounds: { width: 80, height: 20, transform: [1, 0, 0, 1, 0, 0] } }
const resources = { assets: {}, components: {} }
function fixture(data: JsonValue) {
  const project = createBlankCourseProjectV10('作者记录')
  project.definitions.source = { id: 'source', role: 'content', implementation: { kind: 'source', language: 'javascript', source: 'export default {mount(){return {update(){},dispose(){}}}}' } }
  project.instances.source = { id: 'source', definitionId: 'source', data }
  testContainerInstance(project, 0).childIds = ['source']
  return project
}
it('replaces a native image author field with a new recoverable source using only its two source deltas', () => {
  const data = { assetId: 'old', originalAssetId: 'old', alt: '保留题注', fit: 'cover',
    crop: { left: .15, top: 0, right: .05, bottom: 0 }, cropX: .61,
    filters: { brightness: 1.2, contrast: 1, saturation: 1, grayscale: 0, blur: 0 } }
  const project = fixture(data)
  project.definitions.source.implementation = { kind: 'builtin', key: 'guoling.image' }
  project.instances.source = { ...project.instances.source, frame: { width: 240, height: 160, transform: [1, 0, 0, 1, 18, 24] }, style: { margin: '7px' } }
  project.assets.old = { id: 'old', path: 'assets/old.png', mimeType: 'image/png' }
  const original = structuredClone(project), bytes = new Uint8Array([3, 4])
  const image: ComponentAuthorSpot = { id: 'native-image', instanceId: 'source', mountGeneration: 1, kind: 'image',
    dataPath: ['assetId'], initialValue: 'old', localBounds: spot.localBounds }
  const edits = authorSpotImageEdits(project, image, { meta: { id: 'new', path: 'assets/new.png', mimeType: 'image/png' }, bytes })
  expect(edits.filter(edit => edit.type === 'data.set')).toEqual([
    { type: 'data.set', instanceId: 'source', path: ['assetId'], value: 'new' },
    { type: 'data.set', instanceId: 'source', path: ['originalAssetId'], value: 'new' },
  ])
  const changed = new CourseV10Driver().apply({ kind: 'course-v10', project, resources: { assets: { old: new Uint8Array([1, 2]) }, components: {} } },
    captureComponentOperation(project, edits))
  if (changed.kind !== 'course-v10') throw new Error('V10 expected')
  const next = changed.project
  expect(next.instances).toEqual({ ...project.instances, source: { ...project.instances.source, data: { ...data, assetId: 'new', originalAssetId: 'new' } } })
  expect(next.definitions).toEqual(project.definitions)
  expect(next.assets.old).toEqual(project.assets.old)
  expect(changed.resources.assets).toEqual({ old: new Uint8Array([1, 2]), new: bytes })
  expect(restoreImageOriginal(imageDataSchema.parse(next.instances.source.data)).assetId).toBe('new')
  expect(project).toEqual(original)
  expect(() => authorSpotImageEdits(project, { ...image, initialValue: 'stale' }, { meta: { id: 'new', path: 'assets/new.png' }, bytes })).toThrow('可编辑内容已变化')
})
it.each(['professional-source', 'instance-source'] as const)('keeps a %s image asset field on its original generic route', kind => {
  const data = { assetId: 'old', originalAssetId: 'business-original', alt: '保留程序图字段',
    crop: { left: .15, top: 0, right: .05, bottom: 0 } }, project = fixture(data)
  if (kind === 'professional-source') project.definitions.source.professionalBuiltinKey = 'guoling.image'
  else {
    project.instances.source.implementationOverride = project.definitions.source.implementation
    project.definitions.source.implementation = { kind: 'builtin', key: 'guoling.image' }
  }
  const image: ComponentAuthorSpot = { id: 'program-image', instanceId: 'source', mountGeneration: 1, kind: 'image',
    dataPath: ['assetId'], initialValue: 'old', localBounds: spot.localBounds }
  const bytes = new Uint8Array([3, 4]), edits = authorSpotImageEdits(project, image, { meta: { id: 'new', path: 'assets/new.png' }, bytes })
  const changed = new CourseV10Driver().apply({ kind: 'course-v10', project, resources }, captureComponentOperation(project, edits))
  if (changed.kind !== 'course-v10') throw new Error('V10 expected')
  expect(edits.filter(edit => edit.type === 'data.set')).toEqual([{ type: 'data.set', instanceId: 'source', path: ['assetId'], value: 'new' }])
  expect(changed.project.instances).toEqual({ ...project.instances, source: { ...project.instances.source, data: { ...data, assetId: 'new' } } })
})
it.each([7, ['原业务', 2], { title: '严格业务' }])('preserves business data %j while editing text and adding an author image', data => {
  let project = fixture(data)
  project = applyComponentOperation(project, captureComponentOperation(project, authorSpotEdits(project, spot, '新标题', resources)))
  const image: ComponentAuthorSpot = { ...spot, kind: 'image', authorKey: 'photo', initialValue: 'old.png',
    binding: { kind: 'dom', path: [{ tag: 'img', index: 0 }], baseline: 'old.png' } }
  const edits = authorSpotImageEdits(project, image, { meta: { id: 'image', path: 'assets/image.png', mimeType: 'image/png' }, bytes: new Uint8Array([1, 2]) }, resources)
  const driver = new CourseV10Driver()
  const changed = driver.apply({ kind: 'course-v10', project, resources }, captureComponentOperation(project, edits))
  const reopened = driver.load(driver.serialize(changed))
  if (reopened.kind !== 'course-v10') throw new Error('V10 expected')
  expect(reopened.project.instances.source.data).toEqual(data)
  const author = reopened.project.instances.source.authoring!
  expect(author.records!.title.overrides.text).toBe('新标题')
  const token = author.records!.photo.overrides.src!
  expect(token.startsWith('cw-resource:')).toBe(true)
  expect(author.resourceBindings![token]).toBe('image')
})
it('writes an exact source title after a geometry edit without taking over the text property', () => {
  let project = fixture({ html: '<p id="title">标题</p>' })
  project = applyComponentOperation(project, captureComponentOperation(project, prepareWebAuthoringRecordEdits(project, spot, { geometry: { translateX: 15 } })))
  const precise: ComponentAuthorSpot = { ...spot, sourceRegion: { kind: 'data', path: ['html'], start: 14, end: 16, encoding: 'html-text' } }
  project = applyComponentOperation(project, captureComponentOperation(project, authorSpotEdits(project, precise, '新标题', resources)))
  expect(project.instances.source.data).toEqual({ html: '<p id="title">新标题</p>' })
  expect(project.instances.source.authoring!.records!.title.overrides).toEqual({ geometry: { translateX: 15 } })
  expect(project.instances.source.authoring!.records!.title.binding.baseline).toBe('新标题')
  const rebound = structuredClone(project)
  rebound.instances.source.data = { html: '<p id="title">标题</p>' }
  rebound.instances.source.authoring!.records!.title.binding = { ...binding, path: [{ tag: 'p', index: 1, attributes: { id: 'other' } }] }
  expect(() => authorSpotEdits(rebound, precise, '错改', resources)).toThrow('绑定已变化')
})
it('keeps state-local author edits and an explicit empty state separate through serialization', () => {
  let project = fixture(3)
  project = applyComponentOperation(project, captureComponentOperation(project, authorSpotEdits(project, spot, '基础', resources)))
  const surfaceId = componentSurfaces(project)[0].id
  testContainerInstance(project, 0).container.presentation = { states: [{ id: 'local', title: '局部', overrides: {} }, { id: 'empty', title: '清空', overrides: { source: { authoring: {} } } }] }
  const local = resolveComponentPresentation(project, surfaceId, 'local')
  const edits = presentationComponentEdits(project, surfaceId, 'local', authorSpotEdits(local, { ...spot, initialValue: '基础' }, '局部', resources))
  project = applyComponentOperation(project, captureComponentOperation(project, edits))
  const driver = new CourseV10Driver(), reopened = driver.load(driver.serialize({ kind: 'course-v10', project, resources }))
  if (reopened.kind !== 'course-v10') throw new Error('V10 expected')
  expect(reopened.project.instances.source.authoring!.records!.title.overrides.text).toBe('基础')
  expect(resolveComponentPresentation(reopened.project, surfaceId, 'local').instances.source.authoring!.records!.title.overrides.text).toBe('局部')
  expect(resolveComponentPresentation(reopened.project, surfaceId, 'empty').instances.source.authoring).toEqual({})
})
it('adopts known Web records only on archive load and preserves the old empty state semantics', () => {
  const project = fixture({ html: '<p>标题</p>', authoringRecords: { title: { kind: 'text', binding, overrides: { text: '已有改字' } } } })
  project.definitions.source.professionalBuiltinKey = 'guoling.web'
  testContainerInstance(project, 0).container.presentation = { states: [{ id: 'empty', title: '原空状态', overrides: { source: { data: { html: '<p>标题</p>' } } } }] }
  const original = structuredClone(project), driver = new CourseV10Driver(), reopened = driver.load(driver.serialize({ kind: 'course-v10', project, resources }))
  if (reopened.kind !== 'course-v10') throw new Error('V10 expected')
  expect(project).toEqual(original)
  expect(reopened.project.instances.source.authoring!.records!.title.overrides.text).toBe('已有改字')
  expect(reopened.project.instances.source.data).toEqual({ html: '<p>标题</p>' })
  expect(resolveComponentPresentation(reopened.project, componentSurfaces(project)[0].id, 'empty').instances.source.authoring).toEqual({})
  delete project.definitions.source.professionalBuiltinKey
  const generic = driver.load(driver.serialize({ kind: 'course-v10', project, resources }))
  if (generic.kind !== 'course-v10') throw new Error('V10 expected')
  expect(generic.project.instances.source.data).toEqual(original.instances.source.data)
  expect(generic.project.instances.source.authoring).toBeUndefined()
  project.definitions.source.professionalBuiltinKey = 'guoling.web'
  project.instances.source.data = { html: '<p>标题</p>' }
  const emptyBase = driver.load(driver.serialize({ kind: 'course-v10', project, resources }))
  if (emptyBase.kind !== 'course-v10') throw new Error('V10 expected')
  const withBaseEdit = applyComponentOperation(emptyBase.project, captureComponentOperation(emptyBase.project,
    authorSpotEdits(emptyBase.project, spot, '新的基础覆盖', resources)))
  expect(resolveComponentPresentation(withBaseEdit, componentSurfaces(project)[0].id, 'empty').instances.source.authoring).toEqual({})
})
it('replaces author records together with explicit single-object redo and clears old increments', () => {
  const project = fixture({ label: '旧业务' })
  project.instances.source.authoring = { records: { title: { kind: 'text', binding, overrides: { text: '旧覆盖', geometry: { translateX: 20 } } } } }
  for (const authoring of [undefined, { records: { title: { kind: 'text' as const, binding, overrides: { text: '新覆盖' } } } }]) {
    const plan = planContentApply({ project, createId: () => 'unused', request: { intent: 'redo', target: { kind: 'instance', instanceId: 'source' },
      source: { kind: 'objects', objects: [{ definitionId: 'source', data: { label: '新业务' }, ...(authoring ? { authoring } : {}) }] } } })
    const next = applyComponentOperation(project, plan.command)
    expect(next.instances.source.data).toEqual({ label: '新业务' })
    expect(next.instances.source.authoring).toEqual(authoring ?? {})
  }
})
it('keeps human geometry and style when source content supplies only a new text record', async () => {
  const html = '<p id="title">标题</p>', project = fixture({ html })
  project.definitions.source.implementation = { kind: 'builtin', key: 'guoling.web' }
  project.instances.source.authoring = { records: { title: { kind: 'text', binding, overrides: { geometry: { translateX: 20 }, style: { color: 'red' } } } } }
  const service = new ContentApplyService({ session: { project: () => project, dispatch: async () => { throw new Error('Plan only') } }, measure: async () => { throw new Error('No measurement needed') },
    compilation: { compile: async () => { throw new Error('No compile needed') } } })
  const plan = await service.plan({ intent: 'content', target: { kind: 'instance', instanceId: 'source' },
    source: { kind: 'html', html: patchHtmlAuthoringRecords(html, { title: { kind: 'text', binding, overrides: { text: '新覆盖' } } }) } })
  const next = applyComponentOperation(project, plan.command)
  expect(next.instances.source.authoring!.records!.title.overrides).toEqual({ text: '新覆盖', geometry: { translateX: 20 }, style: { color: 'red' } })
})
