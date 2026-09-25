import { beforeEach, describe, expect, it } from 'vitest'
import {
  selectActiveCourseLocationId,
  selectActiveCourseProjectDocument,
  selectSlideAuthoringBackend,
  useEditorStore,
} from '@/renderer/store/editorStore'
import { connectCourseHost, settleCourse } from '../helpers/triage-t2-course'

beforeEach(async () => {
  await connectCourseHost()
})

describe('Mixed try-run location mode', () => {
  it('keeps canvasMode run when activating another surface location', async () => {
    useEditorStore.getState().addCourseContent('flow-page')
    await settleCourse()
    useEditorStore.getState().addCourseContent('spatial-page')
    await settleCourse()
    const project = selectActiveCourseProjectDocument(useEditorStore.getState())
    if (!project) throw new Error('expected course document')
    const slide = project.locations.find((location) => location.kind === 'slide-scene')
    const flow = project.locations.find((location) => location.kind === 'flow-block')
    const spatial = project.locations.find((location) => location.kind === 'spatial-camera')
    if (!slide || !flow || !spatial) throw new Error('expected mixed locations')

    useEditorStore.getState().activateCourseLocation(slide.id)
    expect(useEditorStore.getState().canvasMode).toBe('edit')

    useEditorStore.getState().setCanvasMode('run')
    expect(useEditorStore.getState().canvasMode).toBe('run')

    useEditorStore.getState().activateCourseLocation(flow.id)
    expect(useEditorStore.getState().canvasMode).toBe('run')
    expect(selectActiveCourseLocationId(useEditorStore.getState())).toBe(flow.id)
    expect(selectSlideAuthoringBackend(useEditorStore.getState())).toBeNull()

    useEditorStore.getState().activateCourseLocation(spatial.id)
    expect(useEditorStore.getState().canvasMode).toBe('run')
    expect(selectActiveCourseLocationId(useEditorStore.getState())).toBe(spatial.id)
    expect(selectSlideAuthoringBackend(useEditorStore.getState())).toBeNull()

    useEditorStore.getState().activateCourseLocation(slide.id)
    expect(useEditorStore.getState().canvasMode).toBe('run')
    expect(selectActiveCourseLocationId(useEditorStore.getState())).toBe(slide.id)
    expect(selectSlideAuthoringBackend(useEditorStore.getState())).not.toBeNull()

    useEditorStore.getState().setCanvasMode('edit')
    useEditorStore.getState().activateCourseLocation(flow.id)
    expect(useEditorStore.getState().canvasMode).toBe('edit')
  })

  it('does not drop try-run when clearing the presentation state', () => {
    useEditorStore.getState().setCanvasMode('run')
    useEditorStore.getState().setActivePresentationState(null)
    expect(useEditorStore.getState().canvasMode).toBe('run')
  })
})
