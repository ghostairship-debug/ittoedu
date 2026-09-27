import { beforeEach, expect, it } from 'vitest'
import { createBlankFlowCourseProject } from '@/renderer/project/createFlowCourseProject'
import { componentPackagesFromArchive } from '@/renderer/components/componentPackageStore'
import { flowComponentLightEditCommands } from '@/renderer/composition/runtime/flowDynamicLightEditCommands'
import { runtimeLightEditCommands } from '@/renderer/composition/runtime/runtimeLightEditCommands'
import { selectActiveSceneId, useEditorStore } from '@/renderer/store/editorStore'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import type { CourseProjectDocument, RuntimeLayerItem } from '@/shared/courseProjectTypes'
import type { AssetMeta } from '@/shared/contracts/media-v1'
import { createCourseProjectArchive, openCourseProjectArchive } from '@/core/drivers/codecs/courseProjectArchive'
import { listCourseProjectV9Fixtures } from '../fixtures/course-project-v9/sources'
import { bootTriageCourseHost, formalCourse, formalProject, projectCourse, settleCourse, undoCourse, type TriageCourseHost } from '../helpers/triage-t7-courseHost'

let host: TriageCourseHost
beforeEach(async () => { host = await bootTriageCourseHost() })

const ORIGINAL = 'Flow 页面旧文字'
const OLD = Uint8Array.from([1, 2, 3])
const NEW = Uint8Array.from([4, 5, 6])
const oldImage: AssetMeta = { id: 'flow-old-image', filename: 'old.png', mimeType: 'image/png', kind: 'image', path: 'assets/flow-old-image.png', byteLength: 3, width: 1, height: 1 }
const newImage: AssetMeta = { id: 'flow-new-image', filename: 'new.png', mimeType: 'image/png', kind: 'image', path: 'assets/flow-new-image.png', byteLength: 3, width: 1, height: 1 }
const componentFixture = () => listCourseProjectV9Fixtures().find(value => value.id === 'component')!.data

function course(): CourseProjectDocument {
  const project = createBlankFlowCourseProject({ includeDefaultController: false, controls: 'none' })
  const flow = project.surfaces[0]
  if (flow?.type !== 'flow') throw new Error('flow')
  const runtime: RuntimeLayerItem = {
    layerItemId: 'flow-runtime', label: '页面 Runtime', order: 1, visible: true, locked: false, rotation: 0, opacity: 1,
    hitPolicy: 'auto', playbackInitialVisibility: 'inherit', paperSpace: 'paper',
    frame: { mode: 'absolute', x: 30, y: 40, width: 500, height: 300 }, kind: 'runtime',
    runtime: { protocol: 'surface-runtime', runtimeApiVersion: 3, enabled: true, renderMode: 'dom', source: `CoursewareRuntime.define({runtimeApiVersion:3,create(ctx){ctx.dom.root.textContent='${ORIGINAL}';return {destroy(){}}}});`, content: { values: {} }, assets: { hero: { assetId: oldImage.id } } },
  }
  const donor = componentFixture().project.surfaces[0]
  if (donor?.type !== 'slide') throw new Error('component donor')
  const component = structuredClone(donor.scenes[0]!.layerItems.find(item => item.layerItemId === 'slide-quiz'))
  if (component?.kind !== 'component') throw new Error('component')
  component.layerItemId = 'flow-component'
  component.paperSpace = 'paper'
  component.order = 2
  delete component.staticFallbackAssetId
  flow.surfaceLayerItems = [
    { item: runtime, visibility: { mode: 'all', locationIds: [] } },
    { item: component, visibility: { mode: 'all', locationIds: [] } },
  ]
  project.componentPackages = structuredClone(componentFixture().project.componentPackages)
  project.assets[oldImage.id] = oldImage
  return courseProjectDocumentSchema.parse(project)
}

const flowItems = (project: CourseProjectDocument) => {
  const flow = project.surfaces[0]
  if (flow?.type !== 'flow') throw new Error('flow')
  return flow.surfaceLayerItems
}

it('commits Flow paper Runtime text and image via the formal transaction, then undoes and reopens', async () => {
  await projectCourse(host, course(), { [oldImage.id]: OLD }, componentPackagesFromArchive(componentFixture().project, componentFixture().componentFiles))
  await settleCourse()
  const state = () => useEditorStore.getState()
  const base = { projectId: formalProject(host).id, scope: 'scene' as const, sceneId: selectActiveSceneId(state()), nodeId: 'flow-runtime' }
  const text = state().captureRuntimeContentTextTarget({ ...base, targetId: 'auto:text', kind: 'text', key: '', lightEdit: { original: ORIGINAL } })
  expect(text).not.toBeNull()
  expect(state().updateRuntimeContentTextAtTarget(text!, 'Flow 页面新文字')).toMatchObject({ ok: true, status: 'updated' })
  await settleCourse()
  const asset = state().captureRuntimeAssetReplacementTarget({ ...base, targetId: 'auto:asset', kind: 'asset', key: 'hero' })
  expect(asset).not.toBeNull()
  expect(state().replaceRuntimeAssetAtTarget(asset!, newImage, NEW)).toMatchObject({ ok: true, status: 'replaced' })
  await settleCourse()
  expect(flowItems(formalProject(host))[0]!.item).toMatchObject({ runtime: { content: { overrides: [{ original: ORIGINAL, text: 'Flow 页面新文字' }] }, assets: { hero: { assetId: newImage.id } } } })
  await undoCourse(host)
  expect(flowItems(formalProject(host))[0]!.item).toMatchObject({ runtime: { assets: { hero: { assetId: oldImage.id } } } })
  const snapshot = formalCourse(host)
  if (snapshot.model.kind !== 'course-v9') throw new Error('course')
  const reopened = openCourseProjectArchive(createCourseProjectArchive({ project: snapshot.model.project, assetFiles: snapshot.model.resources.assets ?? {}, componentFiles: snapshot.model.resources.components ?? {} }))
  expect(flowItems(reopened.project)[0]!.item).toMatchObject({ runtime: { content: { overrides: [{ original: ORIGINAL, text: 'Flow 页面新文字' }] } } })
  expect(runtimeLightEditCommands.read('flow-runtime')?.overrides).toHaveLength(1)
  expect(await runtimeLightEditCommands.setPageText('flow-runtime', ORIGINAL, '快捷入口文字')).toEqual({ ok: true, changed: true })
  await settleCourse()
  expect(flowItems(formalProject(host))[0]!.item).toMatchObject({ runtime: { content: { overrides: [{ original: ORIGINAL, text: '快捷入口文字' }] } } })
})

it('refuses stale or locked Flow targets and commits component text with frozen paper identity', async () => {
  const project = course()
  await projectCourse(host, project, { [oldImage.id]: OLD }, componentPackagesFromArchive(componentFixture().project, componentFixture().componentFiles))
  await settleCourse()
  const state = () => useEditorStore.getState()
  const target = flowComponentLightEditCommands.captureText('flow-component', '这是幻灯片题', 'div>p')
  expect(target).not.toBeNull()
  expect(flowComponentLightEditCommands.writeText(target!, '改成 Flow 题')).toEqual({ ok: true, status: 'updated' })
  await settleCourse()
  expect(flowComponentLightEditCommands.writeText(target!, '过期修改')).toMatchObject({ ok: false })
  expect(flowItems(formalProject(host))[1]!.item).toMatchObject({ textOverrides: [{ original: '这是幻灯片题', region: 'div>p', text: '改成 Flow 题' }] })
  const base = { projectId: formalProject(host).id, scope: 'scene' as const, sceneId: selectActiveSceneId(state()), nodeId: 'flow-runtime' }
  const stale = state().captureRuntimeContentTextTarget({ ...base, targetId: 'auto:text', kind: 'text', key: '', lightEdit: { original: ORIGINAL } })
  expect(stale).not.toBeNull()
  const current = flowComponentLightEditCommands.captureText('flow-component', '这是幻灯片题', 'div>p')
  expect(flowComponentLightEditCommands.writeText(current!, '再改')).toMatchObject({ ok: true })
  await settleCourse()
  expect(state().updateRuntimeContentTextAtTarget(stale!, '迟到文字')).toMatchObject({ ok: false })
  expect(runtimeLightEditCommands.read('flow-runtime')?.overrides).toEqual([])
})

it('replaces a paper component picture in one undo step and refuses locked targets', async () => {
  await projectCourse(host, course(), { [oldImage.id]: OLD }, componentPackagesFromArchive(componentFixture().project, componentFixture().componentFiles))
  await settleCourse()
  const picture = flowComponentLightEditCommands.captureAsset('flow-component', 'icon')
  expect(picture).not.toBeNull()
  expect(flowComponentLightEditCommands.replaceAsset(picture!, newImage, NEW)).toEqual({ ok: true, status: 'updated' })
  await settleCourse()
  expect(flowItems(formalProject(host))[1]!.item).toMatchObject({ assetOverrides: { icon: { assetId: newImage.id } } })
  const saved = formalCourse(host)
  if (saved.model.kind !== 'course-v9') throw new Error('course')
  const reopened = openCourseProjectArchive(createCourseProjectArchive({ project: saved.model.project, assetFiles: saved.model.resources.assets ?? {}, componentFiles: saved.model.resources.components ?? {} }))
  expect(flowItems(reopened.project)[1]!.item).toMatchObject({ assetOverrides: { icon: { assetId: newImage.id } } })
  expect(reopened.assetFiles[newImage.id]).toEqual(NEW)
  await undoCourse(host)
  expect(flowItems(formalProject(host))[1]!.item).not.toHaveProperty('assetOverrides')
  expect(formalProject(host).assets[newImage.id]).toBeUndefined()
  const locked = course()
  const item = flowItems(locked)[1]!.item
  item.locked = true
  flowItems(locked)[0]!.item.locked = true
  await projectCourse(host, locked, { [oldImage.id]: OLD }, componentPackagesFromArchive(componentFixture().project, componentFixture().componentFiles))
  await settleCourse()
  expect(flowComponentLightEditCommands.captureText('flow-component', '这是幻灯片题')).toBeNull()
  expect(flowComponentLightEditCommands.captureAsset('flow-component', 'icon')).toBeNull()
  const base = { projectId: formalProject(host).id, scope: 'scene' as const, sceneId: selectActiveSceneId(useEditorStore.getState()), nodeId: 'flow-runtime' }
  expect(useEditorStore.getState().captureRuntimeContentTextTarget({ ...base, targetId: 'auto:text', kind: 'text', key: '', lightEdit: { original: ORIGINAL } })).toBeNull()
  expect(useEditorStore.getState().captureRuntimeAssetReplacementTarget({ ...base, targetId: 'auto:asset', kind: 'asset', key: 'hero' })).toBeNull()
})
