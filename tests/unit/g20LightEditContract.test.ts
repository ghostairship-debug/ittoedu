import { expect, it } from 'vitest'
import { courseProjectDocumentSchema } from '../../src/shared/contracts/course-project-v9/schema'
import { analyzeCourseAssetReferences } from '../../src/shared/contracts/course-project-v9/assetReferences'
import { runtimeDocumentSchema } from '../../src/shared/contracts/runtime/schema'
import { lightEditTextOverridesSchema, normalizeLightEditText } from '../../src/shared/contracts/runtime/lightEdit'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import type { CourseProjectDocument, LayerItem } from '../../src/shared/courseProjectTypes'

const runtimeItem = (overrides: unknown): LayerItem => ({
  layerItemId: 'runtime-1', label: '互动', kind: 'runtime',
  frame: { mode: 'absolute', x: 0, y: 0, width: 640, height: 360 }, order: 0, visible: true, locked: false,
  rotation: 0, opacity: 1, hitPolicy: 'auto', playbackInitialVisibility: 'inherit',
  runtime: {
    protocol: 'canvas-runtime', runtimeApiVersion: 2, enabled: true, renderMode: 'dom',
    source: 'window.CoursewareRuntime.define({ runtimeApiVersion: 2, create() { return { destroy() {} } } })',
    content: { values: {}, overrides } as never, assets: {},
  },
}) as LayerItem

function withSceneItem(item: LayerItem): CourseProjectDocument {
  const project = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
  const surface = project.surfaces.find(entry => entry.type === 'slide')
  if (surface?.type !== 'slide') throw new Error('slide surface expected')
  surface.scenes[0]!.layerItems.push(item as never)
  return project
}

it('stores Runtime text edits as original text, optional region and replacement', () => {
  const overrides = [{ original: '开始答题', text: '开始练习' }, { original: '下一题', region: 'div.quiz>button', text: '继续' }]
  expect(courseProjectDocumentSchema.safeParse(withSceneItem(runtimeItem(overrides))).success).toBe(true)
  expect(runtimeDocumentSchema.safeParse({ runtimeApiVersion: 2, enabled: true, renderMode: 'dom', source: 'x', content: { values: {}, overrides }, assets: {} }).success).toBe(true)
})

it('rejects rules whose original is not normalized visible text or that repeat an original and region', () => {
  expect(lightEditTextOverridesSchema.safeParse([{ original: '  开始 ', text: 'a' }]).success).toBe(false)
  expect(lightEditTextOverridesSchema.safeParse([{ original: '开始  答题', text: 'a' }]).success).toBe(false)
  expect(lightEditTextOverridesSchema.safeParse([{ original: '开始', text: 'a' }, { original: '开始', text: 'b' }]).success).toBe(false)
  expect(lightEditTextOverridesSchema.safeParse([{ original: '开始', text: 'a' }, { original: '开始', region: 'p', text: 'b' }]).success).toBe(true)
  expect(lightEditTextOverridesSchema.safeParse([{ original: '开始', text: 'a', extra: 1 }]).success).toBe(false)
  expect(normalizeLightEditText('  开始\n  答题 ')).toBe('开始 答题')
})

it('keeps assets that replace Component images referenced', () => {
  const project = withSceneItem({
    layerItemId: 'component-1', label: '卡片', kind: 'component',
    frame: { mode: 'absolute', x: 0, y: 0, width: 320, height: 180 }, order: 0, visible: true, locked: false,
    rotation: 0, opacity: 1, hitPolicy: 'auto', playbackInitialVisibility: 'inherit',
    component: { packageId: 'com.example.card', version: '1.0.0' }, props: {},
    textOverrides: [{ original: '卡片标题', text: '新标题' }],
    assetOverrides: { hero: { assetId: 'asset-new' } },
  } as LayerItem)
  const { graph } = analyzeCourseAssetReferences(project, { componentPackages: {} })
  expect(graph.get('asset-new')?.some(reference => reference.kind === 'component-asset-override')).toBe(true)
})

it('publishes Runtime text rules unchanged so the Player applies the same edits', async () => {
  const { buildPublishedCourseV2Payload } = await import('../../src/renderer/export/course/buildPublishedCourse')
  const { publishedCourseV2Schema } = await import('../../src/shared/contracts/published-course-v2/schema')
  const overrides = [{ original: '开始答题', text: '开始练习' }, { original: '下一题', region: 'div.quiz>button', text: '继续' }]
  const payload = publishedCourseV2Schema.parse(buildPublishedCourseV2Payload({ project: withSceneItem(runtimeItem(overrides)), assetFiles: {}, components: {} }))
  const surface = payload.surfaces.find(entry => entry.type === 'slide')
  const item = surface?.type === 'slide' ? surface.scenes[0]!.layerItems.find(entry => entry.layerItemId === 'runtime-1') : undefined
  expect(item?.kind === 'runtime' && item.runtime.content.overrides).toEqual(overrides)
})
