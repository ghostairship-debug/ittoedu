// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { documentHostAPI } from '../helpers/documentHostAPI'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { prepareCourseTeacherControllerEdits } from '../../src/core/course/courseElementInsertion'
import { applyComponentOperation, captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { CourseV10DocumentBridge } from '../../src/renderer/documents/CourseV10DocumentBridge'
import { createEditorStoreKernel } from '../../src/renderer/store/editorStoreKernel'
import { AutomationTab } from '../../src/renderer/ui/AutomationTab'
import { ComponentNavigationOwner } from '../../src/renderer/components/ComponentNavigationOwner'
import { ComponentRuntimeWorld } from '../../src/player/components/ComponentRuntimeWorld'
import { createTeacherControllerRuntimeImplementation } from '../../src/components/teacher-controller'

const store = vi.hoisted(() => ({ state: {} as Record<string, unknown> }))
vi.mock('../../src/renderer/store/editorStore', () => ({
  useEditorStore: (select: (state: Record<string, unknown>) => unknown) => select(store.state),
  selectEditingScope: (state: Record<string, unknown>) => state.editingScope,
}))

it('shows a teacher explicitly added from the new none default and preserves an existing disabled teacher when opening its editor', async () => {
  const project = createBlankCourseProjectV10('显式添加教师台'), surface = project.surfaces[0]
  if (!surface || !project.playback) throw new Error('Expected new-course page and playback settings')
  expect(project.playback.controls).toBe('none')
  // teacher.ensure and both manual insertion variants share this exact planner.
  for (const origin of [undefined, 'slide-authoring'] as const) {
    const prepared = prepareCourseTeacherControllerEdits(project, surface.id, origin)
    const added = applyComponentOperation(project, captureComponentOperation(project, prepared.edits))
    expect(added.playback?.controls).toBe('canvas')
    expect(project.playback.controls).toBe('none')
    expect(added.global.overlay).toHaveLength(1)
  }
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'navigation-teacher-'))
  const bridge = new CourseV10DocumentBridge(), host = new DocumentHostService(directory)
  let runtime: ComponentRuntimeWorld | undefined, navigation: ComponentNavigationOwner | undefined
  try {
    await bridge.connect(documentHostAPI(host))
    await bridge.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } })
    const documentId = bridge.read().activeDocumentId
    if (!documentId) throw new Error('Expected created document')
    const kernel = createEditorStoreKernel({ bridge, commit: vi.fn() }), setActiveTab = vi.fn(), setError = vi.fn()
    const edit = vi.spyOn(kernel, 'editCaptured')
    const updateStore = () => { store.state = { courseView: bridge.read(), courseKernel: kernel, editingScope: 'scene', setActiveTab, setError, setCanvasMode: vi.fn() } }
    updateStore()
    const mounted = render(<AutomationTab />)
    fireEvent.click(screen.getByRole('button', { name: '添加教师控制台' }))
    await waitFor(() => expect(bridge.read().project?.playback?.controls).toBe('canvas'))
    expect(edit).toHaveBeenCalledOnce()
    const added = bridge.read().project
    if (!added) throw new Error('Expected current added course')
    const teacherId = added.global.overlay[0]
    if (!teacherId || !added.instances[teacherId]) throw new Error('Expected added global teacher instance')
    expect(added.instances[teacherId].data).toMatchObject({ enabled: true })
    const target = document.createElement('div'); document.body.append(target)
    navigation = new ComponentNavigationOwner({ project: () => added, surfaceId: () => surface.id, select() {} })
    runtime = new ComponentRuntimeWorld('explicit-teacher', { mode: 'play', teacherController: navigation.teacherPort(), studentNavigation: navigation,
      builtins: new Map([['guoling.navigation', createTeacherControllerRuntimeImplementation(undefined)]]) })
    runtime.bind(teacherId, target); runtime.bindTarget(teacherId, target)
    await runtime.sync(added, { assets: {}, components: {} })
    expect(target.hidden).toBe(false)
    const panel = target.querySelector<HTMLElement>('nav[aria-label="教师控制台"]')
    if (!panel) throw new Error('Expected actual mounted teacher controls')
    expect(panel.hidden).toBe(false)
    expect(setError).not.toHaveBeenCalled()
    const captured = kernel.captureTarget(documentId)
    if (!captured.project.playback) throw new Error('Expected authored playback settings')
    await kernel.editCaptured(kernel.capture([
      { type: 'project.playback.set', playback: { ...captured.project.playback, controls: 'none' } },
      { type: 'instance.patch', instanceId: teacherId, patch: { visible: false } },
      { type: 'data.set', instanceId: teacherId, path: ['enabled'], value: false },
    ], captured))
    updateStore(); mounted.rerender(<AutomationTab />); edit.mockClear()
    fireEvent.click(screen.getByRole('button', { name: '编辑教师控制台' }))
    expect(edit).not.toHaveBeenCalled()
    expect(bridge.read().project?.playback?.controls).toBe('none')
    expect(bridge.read().project?.instances[teacherId].visible).toBe(false)
    expect(bridge.read().project?.instances[teacherId].data).toMatchObject({ enabled: false })
    expect(setActiveTab).toHaveBeenLastCalledWith('properties')
  } finally {
    cleanup(); await runtime?.dispose(); navigation?.dispose(); bridge.dispose()
    await fs.rm(directory, { recursive: true, force: true })
  }
})
