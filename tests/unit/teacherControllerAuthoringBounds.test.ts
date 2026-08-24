import { afterEach, describe, expect, it } from 'vitest'
import { CANVAS_HEIGHT, CANVAS_WIDTH } from '@/shared/constants'
import type { CourseProjectDocument, NativeLayerItem } from '@/shared/courseProjectTypes'
import {
  constrainTeacherControllerAuthoringFrame,
  teacherControllerAuthoringRecoveryBounds,
} from '@/shared/teacherControllerLayout'
import {
  commitTeacherControllerAuthoringFrame,
  createV9TeacherControllerAuthoringController,
} from '@/renderer/authoring/v9TeacherControllerAuthoring'
import {
  createSlideAuthoringBackend,
  openSlideAuthoringSession,
} from '@/renderer/course/slideAuthoringBackend'
import {
  selectSlideAuthoringBackend,
  useEditorStore,
} from '@/renderer/store/editorStore'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import { listCourseProjectV9Fixtures } from '../fixtures/course-project-v9/sources'

const VIEW = {
  viewport: { x: 0, y: 0, width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
  zoom: 1,
  pan: { x: 0, y: 0 },
}

function fixture(): CourseProjectDocument {
  const found = listCourseProjectV9Fixtures().find(
    (entry) => entry.id === 'global-layer-teacher-controller',
  )
  if (!found) throw new Error('missing global controller fixture')
  return structuredClone(found.data.project)
}

function controllerItem(project: CourseProjectDocument): NativeLayerItem {
  const item = project.globalLayerItems.find((entry) => (
    entry.item.kind === 'native' && entry.item.content.nativeType === 'teacher-controller'
  ))?.item
  if (!item || item.kind !== 'native' || item.content.nativeType !== 'teacher-controller') {
    throw new Error('missing global teacher controller')
  }
  return item
}

function expectRecoverable(item: NativeLayerItem): void {
  if (item.content.nativeType !== 'teacher-controller') throw new Error('expected controller')
  const bounds = teacherControllerAuthoringRecoveryBounds(
    item.content.data,
    item.frame,
    item.rotation,
  )
  expect(bounds.left).toBeGreaterThanOrEqual(-0.001)
  expect(bounds.top).toBeGreaterThanOrEqual(-0.001)
  expect(bounds.right).toBeLessThanOrEqual(CANVAS_WIDTH + 0.001)
  expect(bounds.bottom).toBeLessThanOrEqual(CANVAS_HEIGHT + 0.001)
}

afterEach(() => {
  useEditorStore.getState().clearV9SlideCandidateBackend()
})

describe('teacher controller authored bounds and recovery', () => {
  it('keeps the rotated recovery pill visible after moves beyond all four canvas edges', () => {
    const item = controllerItem(fixture())
    if (item.content.nativeType !== 'teacher-controller') throw new Error('expected controller')
    const proposals = [
      { ...item.frame, x: -10_000 },
      { ...item.frame, x: 10_000 },
      { ...item.frame, y: -10_000 },
      { ...item.frame, y: 10_000 },
      { ...item.frame, x: -10_000, y: 10_000 },
    ]

    for (const proposal of proposals) {
      const frame = constrainTeacherControllerAuthoringFrame(
        item.content.data,
        proposal,
        27,
        { width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
      )
      const bounds = teacherControllerAuthoringRecoveryBounds(item.content.data, frame, 27)
      expect(bounds.left).toBeGreaterThanOrEqual(-0.001)
      expect(bounds.top).toBeGreaterThanOrEqual(-0.001)
      expect(bounds.right).toBeLessThanOrEqual(CANVAS_WIDTH + 0.001)
      expect(bounds.bottom).toBeLessThanOrEqual(CANVAS_HEIGHT + 0.001)
    }
  })

  it('clamps direct commits and Store round-trip combination patches in one history step', () => {
    const project = fixture()
    const item = controllerItem(project)
    const session = openSlideAuthoringSession(project, { sessionId: 'controller-bounds' })
    const committed = commitTeacherControllerAuthoringFrame(session, {
      layerItemId: item.layerItemId,
      frame: { x: 50_000, y: -50_000, width: item.frame.width, height: item.frame.height },
      rotation: 27,
    }, { expectedRevision: session.history.present.revision })
    expect(committed.ok).toBe(true)
    expect(committed.historyEntry).toBe(true)
    if (!committed.ok || !committed.nextSession) {
      throw new Error(committed.reason ?? 'controller commit failed')
    }
    const committedItem = controllerItem(committed.nextSession.history.present)
    expectRecoverable(committedItem)

    const backend = createSlideAuthoringBackend(openSlideAuthoringSession(fixture(), {
      sessionId: 'controller-properties-round-trip',
    }))
    useEditorStore.getState().injectV9SlideCandidateBackend(backend)
    useEditorStore.getState().setEditingScope('global')
    const selected = controllerItem(backend.getSession().history.present)
    useEditorStore.getState().selectNode(selected.layerItemId)
    const before = selectSlideAuthoringBackend(useEditorStore.getState())!.getSession()

    useEditorStore.getState().updateNodes([{
      nodeId: selected.layerItemId,
      patch: { x: 50_000, y: -50_000, rotation: 27, opacity: 0.42 },
    }])

    const after = selectSlideAuthoringBackend(useEditorStore.getState())!.getSession()
    const updated = controllerItem(after.history.present)
    expect(updated.opacity).toBe(0.42)
    expectRecoverable(updated)
    expect(after.history.present.revision).toBe(before.history.present.revision + 1)
    expect(after.history.past).toHaveLength(before.history.past.length + 1)
    expect(after.history.future).toHaveLength(0)
    expect(() => courseProjectDocumentSchema.parse(after.history.present)).not.toThrow()
  })

  it('restores old off-canvas data through the Global ensure command in one history step', () => {
    const broken = fixture()
    const existingItem = controllerItem(broken)
    existingItem.frame.x = 1_200
    existingItem.frame.y = 680
    existingItem.rotation = 27
    const backend = createSlideAuthoringBackend(openSlideAuthoringSession(broken, {
      sessionId: 'controller-store-recovery',
    }))
    useEditorStore.getState().injectV9SlideCandidateBackend(backend)
    useEditorStore.getState().setEditingScope('global')
    useEditorStore.getState().selectNode(existingItem.layerItemId)
    const before = selectSlideAuthoringBackend(useEditorStore.getState())!.getSession()

    useEditorStore.getState().ensureTeacherController()

    const after = selectSlideAuthoringBackend(useEditorStore.getState())!.getSession()
    expect(after.scope).toBe('global')
    expect(after.history.present.revision).toBe(before.history.present.revision + 1)
    expect(after.history.past).toHaveLength(before.history.past.length + 1)
    expect(after.history.future).toHaveLength(0)
    const restoredItem = controllerItem(after.history.present)
    expect(restoredItem.frame.x).toBeCloseTo((CANVAS_WIDTH - restoredItem.frame.width) / 2)
    expect(restoredItem.frame.y).toBeCloseTo((CANVAS_HEIGHT - restoredItem.frame.height) / 2)
    expectRecoverable(restoredItem)
    expect(() => courseProjectDocumentSchema.parse(after.history.present)).not.toThrow()
  })

  it('discards an active preview on pointercancel without a project or history write', () => {
    const backend = createSlideAuthoringBackend(openSlideAuthoringSession(fixture(), {
      sessionId: 'controller-cancel',
    }))
    useEditorStore.getState().injectV9SlideCandidateBackend(backend)
    useEditorStore.getState().setEditingScope('global')
    const controller = createV9TeacherControllerAuthoringController()
    const before = selectSlideAuthoringBackend(useEditorStore.getState())!.getSession()

    controller.pointerDown({ x: 640, y: 670 }, VIEW)
    const moved = controller.pointerMove({ x: -10_000, y: -10_000 }, VIEW)
    if (moved.kind !== 'v9-controller-candidate') throw new Error('expected candidate')
    expect(moved.preview).toBeDefined()
    const cancelled = controller.pointerCancel({ x: -10_000, y: -10_000 }, VIEW)
    if (cancelled.kind !== 'v9-controller-candidate') throw new Error('expected candidate')
    expect(cancelled.command).toBeUndefined()
    expect(controller.previewFrame()).toBeNull()

    const after = selectSlideAuthoringBackend(useEditorStore.getState())!.getSession()
    expect(after.history.present).toEqual(before.history.present)
    expect(after.history.past).toEqual(before.history.past)
    expect(after.history.future).toEqual(before.history.future)
  })
})
