import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  addSpatialCameraFrameFromSession,
  reorderSpatialCameraFramesInSession,
} from '@/renderer/course/spatialCameraCommands'
import { COURSE_LAST_LOCATION_REASON } from '@/core/tools/courseLocations'
import { buildCourseTreeView } from '@/renderer/course/courseTreeView'
import {
  selectActiveCourseProjectDocument,
  useEditorStore,
} from '@/renderer/store/editorStore'
import { planCourseTreeReorder, ScenePanel } from '@/renderer/ui/ScenePanel'
import {
  connectAssignedCourse,
  settleAssignedCourse,
  undoAssignedCourse,
} from '../helpers/triage-t5-courseHost'

function courseDocument() {
  const document = selectActiveCourseProjectDocument(useEditorStore.getState())
  if (!document) throw new Error('expected course document')
  return document
}

function slideSurfaceId() {
  const surface = courseDocument().surfaces.find((candidate) => candidate.type === 'slide')
  if (!surface) throw new Error('expected slide surface')
  return surface.id
}

function firstSlideLocationId() {
  const location = courseDocument().locations.find((candidate) => candidate.kind === 'slide-scene')
  if (!location) throw new Error('expected slide location')
  return location.id
}

beforeEach(async () => {
  await connectAssignedCourse()
})

afterEach(() => {
  cleanup()
})

describe('ScenePanel course tree reorder', () => {
  it('keeps existing tree testids, page/scene/camera grips, and leaves flow headings unsortable', async () => {
    const store = useEditorStore.getState()
    store.addCourseContent('flow-page')
    await settleAssignedCourse()
    store.addCourseContent('spatial-page')
    await settleAssignedCourse()
    store.runSpatialCommand((session) => addSpatialCameraFrameFromSession(session, { name: '远景' }))
    await settleAssignedCourse()
    store.activateCourseLocation(firstSlideLocationId())
    await settleAssignedCourse()
    store.addCourseContent('scene', { surfaceId: slideSurfaceId() })
    await settleAssignedCourse()

    render(<ScenePanel />)
    expect(screen.getByTestId('course-page-tree')).toBeTruthy()
    expect(screen.getByTestId('add-content-primary')).toBeTruthy()
    expect(screen.getByTestId('global-layer-entry')).toBeTruthy()
    expect(screen.getByText('本页镜头')).toBeTruthy()

    const document = courseDocument()
    const tree = buildCourseTreeView(document)
    for (const page of tree.pages) {
      expect(screen.getByTestId(`course-page-node-${page.id}`)).toBeTruthy()
      expect(screen.getByLabelText(`拖动“${page.label}”`)).toBeTruthy()
      if (page.kind === 'slide-page') {
        for (const scene of page.children) {
          expect(screen.getByTestId(`scene-item-${scene.id}`)).toBeTruthy()
          expect(screen.getByLabelText(`拖动“${scene.label}”`)).toBeTruthy()
        }
      }
      if (page.kind === 'flow-page') {
        expect(screen.getByTestId(`flow-page-${page.surfaceId}`)).toBeTruthy()
        for (const heading of page.children) {
          expect(screen.getByTestId(`flow-heading-${heading.locationId}`)).toBeTruthy()
          expect(screen.queryByLabelText(`拖动“${heading.label}”`)).toBeNull()
        }
      }
      if (page.kind === 'spatial-page') {
        const cameras = page.children.flatMap((group) => group.children)
        for (const camera of cameras) {
          expect(screen.getByTestId(`spatial-camera-${camera.id}`)).toBeTruthy()
          expect(screen.getByLabelText(`拖动“${camera.label}”`)).toBeTruthy()
        }
      }
    }

    const heading = tree.pages.find((page) => page.kind === 'flow-page')?.children[0]
    expect(heading).toBeTruthy()
    expect(planCourseTreeReorder(
      document,
      tree.pages,
      heading!.id,
      tree.pages[0]!.id,
    )).toBeNull()
  })

  it('rejects cross-parent drops and writes same-parent page/scene reorder into V9 history that undo restores', async () => {
    const store = useEditorStore.getState()
    store.addCourseContent('flow-page')
    await settleAssignedCourse()
    store.addCourseContent('spatial-page')
    await settleAssignedCourse()
    store.activateCourseLocation(firstSlideLocationId())
    await settleAssignedCourse()
    store.addCourseContent('scene', { surfaceId: slideSurfaceId() })
    await settleAssignedCourse()

    const before = courseDocument()
    const tree = buildCourseTreeView(before)
    const slidePage = tree.pages.find((page) => page.kind === 'slide-page')
    const flowPage = tree.pages.find((page) => page.kind === 'flow-page')
    expect(slidePage?.children.length).toBeGreaterThan(1)
    expect(flowPage).toBeTruthy()

    expect(planCourseTreeReorder(
      before,
      tree.pages,
      slidePage!.children[0]!.id,
      flowPage!.id,
    )).toBeNull()

    const surfacePlan = planCourseTreeReorder(
      before,
      tree.pages,
      tree.pages[0]!.id,
      tree.pages[tree.pages.length - 1]!.id,
    )
    expect(surfacePlan?.kind).toBe('surfaces')
    if (surfacePlan?.kind !== 'surfaces') throw new Error('expected surface plan')
    const surfaceOrderBefore = before.surfaces.map((surface) => surface.id)
    store.reorderCourseSurfaces(surfacePlan.surfaceIds)
    await settleAssignedCourse()
    expect(courseDocument().surfaces.map((surface) => surface.id)).toEqual(surfacePlan.surfaceIds)
    expect(courseDocument().revision).toBe(before.revision + 1)
    await undoAssignedCourse()
    expect(courseDocument().surfaces.map((surface) => surface.id)).toEqual(surfaceOrderBefore)

    const afterUndo = courseDocument()
    const sceneTree = buildCourseTreeView(afterUndo)
    const scenes = sceneTree.pages.find((page) => page.kind === 'slide-page')?.children ?? []
    const scenePlan = planCourseTreeReorder(
      afterUndo,
      sceneTree.pages,
      scenes[0]!.id,
      scenes[1]!.id,
    )
    expect(scenePlan?.kind).toBe('scenes')
    if (scenePlan?.kind !== 'scenes') throw new Error('expected scene plan')
    const slide = afterUndo.surfaces.find((surface) => surface.type === 'slide')
    if (!slide || slide.type !== 'slide') throw new Error('expected slide surface')
    expect(scenePlan.sceneIds).toHaveLength(slide.scenes.length)
    expect(new Set(scenePlan.sceneIds)).toEqual(new Set(slide.scenes.map((scene) => scene.id)))
    store.reorderScenes(scenePlan.sceneIds)
    await settleAssignedCourse()
    const reorderedSlide = courseDocument().surfaces.find((surface) => surface.type === 'slide')
    if (!reorderedSlide || reorderedSlide.type !== 'slide') throw new Error('expected slide surface')
    expect(reorderedSlide.scenes.map((scene) => scene.id)).toEqual(scenePlan.sceneIds)
    await undoAssignedCourse()
    const restoredSlide = courseDocument().surfaces.find((surface) => surface.type === 'slide')
    if (!restoredSlide || restoredSlide.type !== 'slide') throw new Error('expected slide surface')
    expect(restoredSlide.scenes.map((scene) => scene.id)).toEqual(slide.scenes.map((scene) => scene.id))
  })

  it('deletes a same-page slide scene from the danger button after confirm, and disables the last remaining scene', async () => {
    const store = useEditorStore.getState()
    store.addCourseContent('scene', { surfaceId: slideSurfaceId() })
    await settleAssignedCourse()
    render(<ScenePanel />)

    const dangerButtons = screen.getAllByRole('button', { name: /删除“/ })
    expect(dangerButtons).toHaveLength(2)
    expect(dangerButtons.every((button) => !(button as HTMLButtonElement).disabled)).toBe(true)

    fireEvent.click(dangerButtons[1]!)
    fireEvent.click(screen.getByRole('button', { name: '删除场景' }))
    await settleAssignedCourse()

    const slide = courseDocument().surfaces.find((surface) => surface.type === 'slide')
    if (!slide || slide.type !== 'slide') throw new Error('expected slide surface')
    expect(slide.scenes).toHaveLength(1)

    const remaining = screen.getByRole('button', { name: /删除“/ })
    expect((remaining as HTMLButtonElement).disabled).toBe(true)
    expect(remaining.getAttribute('title')).toBe(COURSE_LAST_LOCATION_REASON)
  })

  it('lets the original first slide be deleted after mixed pages exist, even if it is the only scene on that page', async () => {
    const store = useEditorStore.getState()
    const originalSceneId = courseDocument().locations.find(
      (location) => location.kind === 'slide-scene',
    )?.sceneId
    expect(originalSceneId).toBeTruthy()
    store.addCourseContent('flow-page')
    await settleAssignedCourse()
    store.reorderCourseSurfaces(
      [...courseDocument().surfaces.map((surface) => surface.id)].reverse(),
    )
    await settleAssignedCourse()
    expect(courseDocument().startLocationId).toBe(courseDocument().locations[0]!.id)
    expect(courseDocument().startLocationId).not.toBe(
      courseDocument().locations.find(
        (location) => location.kind === 'slide-scene' && location.sceneId === originalSceneId,
      )?.id,
    )

    render(<ScenePanel />)
    const originalScene = courseDocument().surfaces.flatMap((surface) =>
      surface.type === 'slide' ? surface.scenes : [],
    ).find((scene) => scene.id === originalSceneId)
    expect(originalScene).toBeTruthy()
    const deleteOriginal = screen.getByRole('button', { name: `删除“${originalScene!.name}”` })
    expect((deleteOriginal as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(deleteOriginal)
    fireEvent.click(screen.getByRole('button', { name: '删除场景' }))
    await settleAssignedCourse()
    expect(courseDocument().surfaces.some((surface) => surface.type === 'slide')).toBe(false)
    expect(courseDocument().startLocationId).toBe(courseDocument().locations[0]!.id)
  })

  it('maps same-group camera drops onto the existing spatial reorder command and keeps label clicks activating', async () => {
    const store = useEditorStore.getState()
    store.createNewSpatialProject()
    await settleAssignedCourse()
    store.runSpatialCommand((session) => addSpatialCameraFrameFromSession(session, { name: '远景' }))
    await settleAssignedCourse()
    const document = courseDocument()
    const tree = buildCourseTreeView(document)
    const cameras = tree.pages[0]?.children[0]?.children ?? []
    expect(cameras.length).toBeGreaterThan(1)
    const plan = planCourseTreeReorder(document, tree.pages, cameras[1]!.id, cameras[0]!.id)
    expect(plan?.kind).toBe('cameras')
    if (plan?.kind !== 'cameras') throw new Error('expected camera plan')
    expect(plan.toIndex).toBe(0)

    const revisionBefore = document.revision
    store.runSpatialCommand((session) =>
      reorderSpatialCameraFramesInSession(session, plan.frameId, plan.toIndex),
    )
    await settleAssignedCourse()
    const reordered = courseDocument()
    const spatial = reordered.surfaces.find((surface) => surface.type === 'spatial-2d')
    if (!spatial || spatial.type !== 'spatial-2d') throw new Error('expected spatial surface')
    expect(spatial.camera.frames[0]?.id).toBe(plan.frameId)
    expect(reordered.revision).toBeGreaterThan(revisionBefore)
    await undoAssignedCourse()
    // 2.0 文档会话的 revision 是单调提交计数（src/core/documents/DocumentSession.ts:182），
    // 撤销不回退 revision，因此以镜头顺序验证撤销结果。
    const restored = courseDocument()
    const restoredSpatial = restored.surfaces.find((surface) => surface.type === 'spatial-2d')
    if (!restoredSpatial || restoredSpatial.type !== 'spatial-2d') {
      throw new Error('expected spatial surface')
    }
    expect(restoredSpatial.camera.frames[0]?.id).toBe(cameras[0]!.id)

    render(<ScenePanel />)
    fireEvent.click(screen.getByTestId(`spatial-camera-${cameras[1]!.id}`))
    expect(useEditorStore.getState().spatialSession?.selection.locationId).toBe(cameras[1]!.locationId)
  })

  it('keeps a delayed camera delete bound to the captured revision', async () => {
    const store = useEditorStore.getState()
    store.createNewSpatialProject()
    await settleAssignedCourse()
    store.runSpatialCommand((session) => addSpatialCameraFrameFromSession(session, { name: '远景' }))
    await settleAssignedCourse()
    render(<ScenePanel />)

    fireEvent.click(screen.getByRole('button', { name: '删除镜头 远景' }))
    store.addTextNode()
    await settleAssignedCourse()
    const beforeConfirm = useEditorStore.getState()
    const frameCount = courseDocument().surfaces.flatMap((surface) => (
      surface.type === 'spatial-2d' ? surface.camera.frames : []
    )).length
    fireEvent.click(screen.getByRole('button', { name: '删除镜头' }))
    // 确认被拒绝时不应有任何提交，因此不 drain：store 身份必须保持不变。

    expect(courseDocument().surfaces.flatMap((surface) => (
      surface.type === 'spatial-2d' ? surface.camera.frames : []
    ))).toHaveLength(frameCount)
    expect(useEditorStore.getState().spatialSession).toBe(beforeConfirm.spatialSession)
    expect(useEditorStore.getState().courseAssetSidecarPast).toBe(beforeConfirm.courseAssetSidecarPast)
    expect(useEditorStore.getState().courseComponentPackagesPast)
      .toBe(beforeConfirm.courseComponentPackagesPast)
  })

  it('rejects a delayed camera delete when a content draft opens after the dialog', async () => {
    const store = useEditorStore.getState()
    store.createNewSpatialProject()
    await settleAssignedCourse()
    store.addTextNode()
    await settleAssignedCourse()
    const textId = useEditorStore.getState().spatialSession?.selection.selectionIds[0]
    if (!textId) throw new Error('expected Spatial text layer')
    store.runSpatialCommand((session) => addSpatialCameraFrameFromSession(session, { name: '远景' }))
    await settleAssignedCourse()
    render(<ScenePanel />)

    const revisionAtOpen = courseDocument().revision
    fireEvent.click(screen.getByRole('button', { name: '删除镜头 远景' }))
    store.beginTextEdit(textId, 'properties')
    store.updateTextEditDraft(textId, '弹窗后打开的草稿', [])
    const beforeConfirm = useEditorStore.getState()
    const frameCount = courseDocument().surfaces.flatMap((surface) => (
      surface.type === 'spatial-2d' ? surface.camera.frames : []
    )).length
    expect(courseDocument().revision).toBe(revisionAtOpen)
    expect(beforeConfirm.spatialContentEdit?.kind).toBe('text')
    if (beforeConfirm.spatialContentEdit?.kind !== 'text') throw new Error('expected text draft')
    if (!('text' in beforeConfirm.spatialContentEdit.draft)) throw new Error('expected text draft data')
    expect(beforeConfirm.spatialContentEdit.draft.text).toBe('弹窗后打开的草稿')

    fireEvent.click(screen.getByRole('button', { name: '删除镜头' }))
    // 确认被拒绝时不应有任何提交，因此不 drain：本地草稿身份必须保持不变。

    expect(courseDocument().surfaces.flatMap((surface) => (
      surface.type === 'spatial-2d' ? surface.camera.frames : []
    ))).toHaveLength(frameCount)
    expect(useEditorStore.getState().spatialContentEdit).toBe(beforeConfirm.spatialContentEdit)
    expect(useEditorStore.getState().spatialSession).toBe(beforeConfirm.spatialSession)
    expect(useEditorStore.getState().spatialSession?.history).toBe(beforeConfirm.spatialSession?.history)
    expect(useEditorStore.getState().courseAssetSidecarPast).toBe(beforeConfirm.courseAssetSidecarPast)
    expect(useEditorStore.getState().courseComponentPackagesPast)
      .toBe(beforeConfirm.courseComponentPackagesPast)
  })

  it('labels flow and spatial primary add actions without 新增页面', async () => {
    const store = useEditorStore.getState()
    store.createNewFlowProject()
    await settleAssignedCourse()
    render(<ScenePanel />)
    expect(screen.getByTestId('add-content-primary')).toHaveTextContent('新增流式讲义')
    expect(screen.getByTestId('add-content-primary').textContent).not.toContain('新增页面')
    cleanup()

    store.createNewSpatialProject()
    await settleAssignedCourse()
    render(<ScenePanel />)
    expect(screen.getByTestId('add-content-primary')).toHaveTextContent('新增无限画布')
    expect(screen.getByTestId('add-content-primary').textContent).not.toContain('新增页面')
  })

  it('deletes a whole flow group from the tree and disables deleting the last course location', async () => {
    const store = useEditorStore.getState()
    store.addCourseContent('flow-page')
    await settleAssignedCourse()
    store.addCourseContent('slide-page')
    await settleAssignedCourse()
    store.addCourseContent('spatial-page')
    await settleAssignedCourse()
    render(<ScenePanel />)
    const first = courseDocument()
    const flow = first.surfaces.find((surface) => surface.type === 'flow')
    const extraSlide = first.surfaces.filter((surface) => surface.type === 'slide')[1]
    const spatial = first.surfaces.find((surface) => surface.type === 'spatial-2d')
    if (!flow || !extraSlide || !spatial) throw new Error('expected mixed groups')

    fireEvent.click(screen.getByRole('button', { name: `删除页面“${flow.title}”` }))
    fireEvent.click(screen.getByRole('button', { name: '删除页面' }))
    await settleAssignedCourse()
    expect(courseDocument().surfaces.some((surface) => surface.id === flow.id)).toBe(false)

    cleanup()
    render(<ScenePanel />)
    fireEvent.click(screen.getByRole('button', { name: `删除页面“${extraSlide.title}”` }))
    fireEvent.click(screen.getByRole('button', { name: '删除页面' }))
    await settleAssignedCourse()
    expect(courseDocument().surfaces.some((surface) => surface.id === extraSlide.id)).toBe(false)

    cleanup()
    render(<ScenePanel />)
    fireEvent.click(screen.getByRole('button', { name: `删除页面“${spatial.title}”` }))
    fireEvent.click(screen.getByRole('button', { name: '删除页面' }))
    await settleAssignedCourse()
    expect(courseDocument().surfaces.some((surface) => surface.id === spatial.id)).toBe(false)

    cleanup()
    render(<ScenePanel />)
    const slide = courseDocument().surfaces.find((surface) => surface.type === 'slide')
    if (!slide) throw new Error('expected slide surface')
    const slideDelete = screen.getByRole('button', { name: `删除页面“${slide.title}”` })
    expect((slideDelete as HTMLButtonElement).disabled).toBe(true)
    expect(slideDelete.getAttribute('title')).toBe(COURSE_LAST_LOCATION_REASON)
  })

  it('plans migrating a slide scene onto a different slide-page group instead of returning null', async () => {
    const store = useEditorStore.getState()
    store.addCourseContent('slide-page')
    await settleAssignedCourse()
    const secondSurface = courseDocument().surfaces.filter((surface) => surface.type === 'slide')[1]
    if (!secondSurface || secondSurface.type !== 'slide') throw new Error('expected second slide page')
    const secondLocation = courseDocument().locations.find((location) =>
      location.kind === 'slide-scene' && location.surfaceId === secondSurface.id,
    )
    if (!secondLocation) throw new Error('expected second-page scene')
    store.activateCourseLocation(secondLocation.id)
    await settleAssignedCourse()
    store.addCourseContent('scene', { surfaceId: secondSurface.id })
    await settleAssignedCourse()

    const before = courseDocument()
    const tree = buildCourseTreeView(before)
    const slidePages = tree.pages.filter((page) => page.kind === 'slide-page')
    expect(slidePages).toHaveLength(2)
    const fromScene = slidePages[1]!.children[1] ?? slidePages[1]!.children[0]!
    const ontoPage = slidePages[0]!
    const ontoScene = slidePages[0]!.children[0]!

    expect(planCourseTreeReorder(
      before,
      tree.pages,
      fromScene.id,
      ontoPage.id,
    )).toMatchObject({
      kind: 'migrate-scene',
      locationId: fromScene.id,
      targetSurfaceId: ontoPage.surfaceId,
      toIndex: ontoPage.children.length,
    })

    const ontoScenePlan = planCourseTreeReorder(
      before,
      tree.pages,
      fromScene.id,
      ontoScene.id,
    )
    expect(ontoScenePlan?.kind).toBe('migrate-scene')
    if (ontoScenePlan?.kind !== 'migrate-scene') throw new Error('expected migrate plan')
    expect(ontoScenePlan.targetSurfaceId).toBe(ontoScene.surfaceId)
    expect(ontoScenePlan.toIndex).toBe(0)

    store.moveCourseSlideScene(
      ontoScenePlan.locationId,
      ontoScenePlan.targetSurfaceId,
      ontoScenePlan.toIndex,
    )
    await settleAssignedCourse()
    const after = courseDocument()
    const relocated = after.locations.find((location) => location.id === fromScene.id)
    expect(relocated?.kind === 'slide-scene' && relocated.surfaceId).toBe(ontoPage.surfaceId)
    const target = after.surfaces.find((surface) => surface.id === ontoPage.surfaceId)
    if (!target || target.type !== 'slide') throw new Error('expected target slide')
    expect(target.scenes[0]?.id).toBe(
      relocated && relocated.kind === 'slide-scene' ? relocated.sceneId : undefined,
    )
    expect(after.surfaces.some((surface) => surface.id === secondSurface.id)).toBe(true)
  })
})
