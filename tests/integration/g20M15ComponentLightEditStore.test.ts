import { beforeEach, expect, it } from 'vitest'
import { componentPackagesFromArchive } from '@/renderer/components/componentPackageStore'
import { planComponentAssetReplacement, planComponentTextRule, planStaticFallbackRefresh } from '@/renderer/components/componentLightEditTransactions'
import { emptyCourseAssetSidecar } from '@/renderer/project/v9AssetAdapter'
import { useEditorStore } from '@/renderer/store/editorStore'
import type { ComponentLayerItem, CourseProjectDocument } from '@/shared/courseProjectTypes'
import type { AssetMeta } from '@/shared/contracts/media-v1'
import { createCourseProjectArchive, openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import { listCourseProjectV9Fixtures } from '../fixtures/course-project-v9/sources'
import { bootTriageCourseHost, formalCourse, formalProject, projectCourse, redoCourse, settleCourse, undoCourse, type TriageCourseHost } from '../helpers/triage-t7-courseHost'

// M15: a component's own text becomes rules on its item and a replaced picture a managed asset; its package never changes.
let host: TriageCourseHost
beforeEach(async () => { host = await bootTriageCourseHost() })

const fixture = () => listCourseProjectV9Fixtures().find(value => value.id === 'component')!.data
function quiz(project: CourseProjectDocument): ComponentLayerItem {
  const surface = project.surfaces[0]
  if (surface?.type !== 'slide') throw new Error('slide surface')
  const item = surface.scenes[0]!.layerItems.find(value => value.layerItemId === 'slide-quiz')
  if (item?.kind !== 'component') throw new Error('component item')
  return item
}
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const picture: AssetMeta = { id: 'quiz-new-picture', filename: 'quiz-new-picture.png', mimeType: 'image/png', kind: 'image', path: 'assets/quiz-new-picture.png', byteLength: PNG.byteLength, width: 1, height: 1 }
const NOW = '2026-09-26T12:00:00.000Z'

it('M15 plans a component text rule: add, replace, remove at the original text, refuse a locked component', () => {
  const project = fixture().project
  const added = planComponentTextRule({ project, itemId: 'slide-quiz', rule: { original: '这是幻灯片题', region: 'div>p', text: '改过的题目' }, now: NOW })
  if (!added.ok || added.status !== 'planned') throw new Error('planned')
  expect(quiz(added.plan.nextDocument).textOverrides).toEqual([{ original: '这是幻灯片题', region: 'div>p', text: '改过的题目' }])
  expect(added.plan.nextDocument.revision).toBe(project.revision + 1)
  const replaced = planComponentTextRule({ project: added.plan.nextDocument, itemId: 'slide-quiz', rule: { original: '这是幻灯片题', region: 'div>p', text: '再改' }, now: NOW })
  if (!replaced.ok || replaced.status !== 'planned') throw new Error('planned')
  expect(quiz(replaced.plan.nextDocument).textOverrides).toEqual([{ original: '这是幻灯片题', region: 'div>p', text: '再改' }])
  const removed = planComponentTextRule({ project: replaced.plan.nextDocument, itemId: 'slide-quiz', rule: { original: '这是幻灯片题', region: 'div>p', text: '这是幻灯片题' }, now: NOW })
  if (!removed.ok || removed.status !== 'planned') throw new Error('planned')
  expect(quiz(removed.plan.nextDocument).textOverrides).toBeUndefined()
  expect(planComponentTextRule({ project, itemId: 'slide-quiz', rule: { original: '这是幻灯片题', text: '这是幻灯片题' }, now: NOW })).toEqual({ ok: true, status: 'no-op' })
  const locked = structuredClone(project); quiz(locked).locked = true
  expect(planComponentTextRule({ project: locked, itemId: 'slide-quiz', rule: { original: '这是幻灯片题', text: 'x' }, now: NOW })).toMatchObject({ ok: false, reason: expect.stringContaining('锁定') })
  expect(planComponentAssetReplacement({ project: locked, sidecar: emptyCourseAssetSidecar(), itemId: 'slide-quiz', assetKey: 'icon', asset: picture, bytes: PNG, now: NOW }))
    .toMatchObject({ ok: false, reason: expect.stringContaining('锁定') })
  expect(planComponentTextRule({ project, itemId: 'slide-title', rule: { original: 'a', text: 'b' }, now: NOW })).toMatchObject({ ok: false })
})

it('M15 a component text rule and a replaced picture are one undo step each, survive save and reopen, and leave the package untouched', async () => {
  const archive = fixture()
  await projectCourse(host, archive.project, archive.assetFiles, componentPackagesFromArchive(archive.project, archive.componentFiles))
  await settleCourse()
  const packages = JSON.stringify(useEditorStore.getState().componentPackages)

  expect(useEditorStore.getState().writeComponentTextRule('slide-quiz', { original: '这是幻灯片题', region: 'div>p', text: '改过的题目' })).toEqual({ ok: true, status: 'updated' })
  await settleCourse()
  expect(quiz(formalProject(host)).textOverrides).toEqual([{ original: '这是幻灯片题', region: 'div>p', text: '改过的题目' }])

  // The picture and its asset are one step: undo takes both away, redo brings both back.
  expect(useEditorStore.getState().replaceComponentAssetAtKey('slide-quiz', 'icon', picture, PNG)).toEqual({ ok: true, status: 'updated' })
  await settleCourse()
  expect(quiz(formalProject(host)).assetOverrides).toEqual({ icon: { assetId: picture.id } })
  expect(formalProject(host).assets[picture.id]).toEqual(picture)
  await undoCourse(host)
  expect(quiz(formalProject(host)).assetOverrides).toBeUndefined()
  expect(formalProject(host).assets[picture.id]).toBeUndefined()
  expect(quiz(formalProject(host)).textOverrides).toHaveLength(1)
  await redoCourse(host)
  expect(quiz(formalProject(host)).assetOverrides).toEqual({ icon: { assetId: picture.id } })
  // The text rule is its own step.
  await undoCourse(host); await undoCourse(host)
  expect(quiz(formalProject(host)).textOverrides).toBeUndefined()
  await redoCourse(host); await redoCourse(host)

  // Saved and reopened, the rule and the picture are there; the component package is what it was.
  const snapshot = formalCourse(host)
  if (snapshot.model.kind !== 'course-v9') throw new Error('course')
  const reopened = openCourseProjectArchive(createCourseProjectArchive({ project: snapshot.model.project, assetFiles: snapshot.model.resources.assets ?? {},
    componentFiles: snapshot.model.resources.components ?? {} }))
  expect(quiz(reopened.project)).toMatchObject({ textOverrides: [{ original: '这是幻灯片题', region: 'div>p', text: '改过的题目' }], assetOverrides: { icon: { assetId: picture.id } } })
  expect(reopened.assetFiles[picture.id]).toEqual(PNG)
  expect(JSON.stringify(useEditorStore.getState().componentPackages)).toBe(packages)
  // The edited component's own package files (its source) are byte for byte what they were.
  const { packageId, version } = quiz(archive.project).component
  const bytes = (files: Record<string, Uint8Array> | undefined) => Object.fromEntries(Object.entries(files ?? {}).map(([name, value]) => [name, Array.from(value)]))
  expect(bytes(reopened.componentFiles[`${packageId}@${version}`])).toEqual(bytes(archive.componentFiles[`${packageId}@${version}`]))
})

it('M15 points an existing static fallback at a new capture, keeps its coverage, and leaves items without one alone', () => {
  const captured: AssetMeta = { ...picture, id: 'fallback-captured', filename: 'fallback-captured.png', path: 'assets/fallback-captured.png' }
  const component = fixture().project
  const refreshed = planStaticFallbackRefresh({ project: component, sidecar: emptyCourseAssetSidecar(), itemId: 'slide-quiz', asset: captured, bytes: PNG, now: NOW })
  if (!refreshed.ok || refreshed.status !== 'planned') throw new Error('planned')
  expect(quiz(refreshed.plan.nextDocument).staticFallbackAssetId).toBe(captured.id)
  expect(refreshed.plan.nextDocument.assets[captured.id]).toEqual(captured)
  expect(refreshed.plan.resourceChanges.assetFileChanges?.[0]).toMatchObject({ assetId: captured.id })

  const runtimeProject = listCourseProjectV9Fixtures().find(value => value.id === 'canvas-runtime')!.data.project
  const runtime = planStaticFallbackRefresh({ project: runtimeProject, sidecar: emptyCourseAssetSidecar(), itemId: 'slide-canvas-runtime', asset: captured, bytes: PNG, now: NOW })
  if (!runtime.ok || runtime.status !== 'planned') throw new Error('planned')
  const surface = runtime.plan.nextDocument.surfaces[0]
  if (surface?.type !== 'slide') throw new Error('slide surface')
  const item = surface.scenes[0]!.layerItems.find(value => value.layerItemId === 'slide-canvas-runtime')
  expect(item?.kind === 'runtime' && item.runtime.staticFallback).toEqual({ assetId: captured.id, coverage: 'scene' })

  const without = structuredClone(runtimeProject)
  const plain = without.surfaces[0]
  if (plain?.type !== 'slide') throw new Error('slide surface')
  const bare = plain.scenes[0]!.layerItems.find(value => value.layerItemId === 'slide-canvas-runtime')
  if (bare?.kind !== 'runtime') throw new Error('runtime')
  delete bare.runtime.staticFallback
  expect(planStaticFallbackRefresh({ project: without, sidecar: emptyCourseAssetSidecar(), itemId: 'slide-canvas-runtime', asset: captured, bytes: PNG, now: NOW })).toEqual({ ok: true, status: 'no-op' })
  const locked = structuredClone(component); quiz(locked).locked = true
  expect(planStaticFallbackRefresh({ project: locked, sidecar: emptyCourseAssetSidecar(), itemId: 'slide-quiz', asset: captured, bytes: PNG, now: NOW })).toMatchObject({ ok: false })
})
