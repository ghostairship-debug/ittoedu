import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { TEACHER_CONTROLLER_DEFINITION, createTeacherControllerData } from '../../src/components/teacher-controller/data'
import { courseAuthorData } from '../../src/core/course/courseElementInsertion'
import { useComponentLibrary, type ComponentLibraryPorts } from '../../src/renderer/app/useComponentLibrary'
import { createEditorStoreKernel } from '../../src/renderer/store/editorStoreKernel'
import { createCourseProjectContent } from '../../src/renderer/store/slices/courseLifecycleSlice'
import { componentDefinitionBuiltinKey, type CourseProjectV10 } from '../../src/shared/contracts/component-platform/project'
import { createCourseDocumentHost, type CourseDocumentTestHost } from '../helpers/courseDocumentHost'

const hosts: CourseDocumentTestHost[] = []
afterEach(() => { cleanup(); hosts.splice(0).forEach(host => host.dispose()) })

function teacherIds(project: CourseProjectV10) {
  return Object.values(project.instances).filter(instance => componentDefinitionBuiltinKey(project.definitions[instance.definitionId]) === 'guoling.navigation').map(instance => instance.id)
}

async function harness(surface: 'slide' | 'flow' = 'slide', existingTeacher = false) {
  const host = await createCourseDocumentHost()
  hosts.push(host)
  const content = createCourseProjectContent(surface), pageId = content.project.rootIds[0]
  if (existingTeacher) {
    const data = createTeacherControllerData()
    data.title = '人工编辑的教师台'
    data.style.textColor = '#13579b'
    data.style.accentColor = '#ab4567'
    data.buttons = [{ id: 'custom-next', label: '人工下一步', visible: true, action: { type: 'step.next' } }]
    content.project.definitions[TEACHER_CONTROLLER_DEFINITION.id] = structuredClone(TEACHER_CONTROLLER_DEFINITION)
    content.project.instances.teacher = {
      id: 'teacher', definitionId: TEACHER_CONTROLLER_DEFINITION.id, name: '保留我的导航布局', visible: true,
      data: courseAuthorData(data), frame: { width: 777, height: 91, transform: [1, 0, 0, 1, 123, 456] },
    }
    content.project.global.overlay.push('teacher')
  }
  await host.bridge.create({ kind: 'course-v10', ...content })
  const documentId = host.bridge.read().activeDocumentId!, session = host.registry.get(documentId)
  host.bridge.selectSurface(documentId, pageId)
  const kernel = createEditorStoreKernel({ bridge: host.bridge, commit: vi.fn() })
  const editCaptured = vi.spyOn(kernel, 'editCaptured')
  const reportError = vi.fn()
  const ports: ComponentLibraryPorts = {
    kernel, desktopAvailable: () => false, loadCatalog: async () => ({ sources: [], packages: [], issues: [] }),
    selectComponentPackage: async () => null, selectComponentPackages: async () => null,
    readCatalogPackage: vi.fn(async () => { throw new Error('This batch uses built-in entries') }),
    capturePlacement: vi.fn(() => ({ center: { x: 400, y: 300 }, width: 333, height: 222,
      ...(surface === 'flow' ? { destination: 'paper' as const } : {}) })),
    async runBusy(operation) { try { return await operation() } catch (error) { reportError(String(error)); return undefined } },
    commitStatus: vi.fn(), reportError,
  }
  const project = () => {
    const model = session.read().model
    if (model.kind !== 'course-v10') throw new Error('Expected a V10 document')
    return model.project
  }
  return { host, session, documentId, pageId, kernel, ports, editCaptured, project, reportError }
}

it('adds a program and teacher in one real history operation, undoes/redoes both, and saves then cold reopens the editable batch', async () => {
  const h = await harness(), before = structuredClone(h.project())
  const hook = renderHook(() => useComponentLibrary(h.ports))
  await act(async () => expect(await hook.result.current.addCatalogPackages([], {
    builtInAssetIds: ['guoling.work.program'], includeTeacherController: true,
  })).toBe(true))
  expect(h.editCaptured).toHaveBeenCalledTimes(1)
  expect(h.session.read().undoDepth).toBe(1)
  const inserted = structuredClone(h.project()), ids = teacherIds(inserted), children = inserted.instances[h.pageId].childIds!
  expect(ids).toHaveLength(1)
  expect(inserted.global.overlay).toEqual(ids)
  expect(children).toHaveLength(1)
  const program = inserted.instances[children[0]]
  expect(program.data).toMatchObject({ title: '输入、运动与记录', speed: 1 })
  expect(inserted.definitions[program.definitionId].implementation.kind).toBe('source')
  expect(program.frame).toMatchObject({ width: 333, height: 222, transform: [1, 0, 0, 1, 233.5, 189] })
  expect(inserted.instances[ids[0]].frame).not.toEqual(program.frame)
  await act(async () => { await h.host.bridge.undo(h.documentId) })
  expect(h.project().instances).toEqual(before.instances)
  expect(h.project().definitions).toEqual(before.definitions)
  expect(h.project().global).toEqual(before.global)
  expect(h.session.read().undoDepth).toBe(0)
  await act(async () => { await h.host.bridge.redo(h.documentId) })
  expect(h.project().instances).toEqual(inserted.instances)
  expect(h.project().global).toEqual(inserted.global)
  h.host.controls.savePath = 'teacher-library-batch.h5lesson'
  await act(async () => { expect(await h.host.bridge.save(false, undefined, h.documentId)).toBe(true) })
  expect(h.session.read().dirty).toBe(false)
  await act(async () => { expect(await h.host.bridge.close(h.documentId)).toBe(true); await h.host.bridge.open('teacher-library-batch.h5lesson') })
  const reopened = h.host.read()
  expect(reopened.documentId).not.toBe(h.documentId)
  expect(reopened.undoDepth).toBe(0)
  if (reopened.model.kind !== 'course-v10') throw new Error('Expected a reopened V10 document')
  expect(reopened.model.project.instances).toEqual(inserted.instances)
  expect(reopened.model.project.definitions).toEqual(inserted.definitions)
  expect(reopened.model.project.global).toEqual(inserted.global)
  expect(h.reportError).not.toHaveBeenCalled()
})

it.each(['slide', 'flow'] as const)('reuses the single global teacher and preserves manual data/frame during a %s local/center batch', async surface => {
  const h = await harness(surface, true), teacher = structuredClone(h.project().instances.teacher)
  const hook = renderHook(() => useComponentLibrary(h.ports))
  await act(async () => expect(await hook.result.current.addCatalogPackages([], {
    builtInAssetIds: ['guoling.work.program'], includeTeacherController: true, placement: 'local',
  })).toBe(true))
  expect(h.editCaptured).toHaveBeenCalledTimes(1)
  expect(h.session.read().undoDepth).toBe(1)
  const project = h.project(), children = project.instances[h.pageId].childIds!
  expect(teacherIds(project)).toEqual(['teacher'])
  expect(project.global.overlay).toEqual(['teacher'])
  expect(children).toHaveLength(1)
  expect(children).not.toContain('teacher')
  expect(project.instances.teacher.data).toEqual(teacher.data)
  expect(project.instances.teacher.frame).toEqual(teacher.frame)
  expect(project.instances.teacher.flowLayout).toBeUndefined()
  expect(project.instances.teacher.flowPlacement).toBeUndefined()
  const program = project.instances[children[0]]
  expect(program.frame).toMatchObject({ width: 333, height: 222, transform: [1, 0, 0, 1, 233.5, 189] })
  if (surface === 'flow') expect(program.flowPlacement).toEqual({ space: 'paper', plane: 'overlay' })
  await act(async () => { await h.host.bridge.undo(h.documentId) })
  expect(h.project().instances.teacher).toEqual(teacher)
  expect(h.project().instances[h.pageId].childIds).toEqual([])
  expect(h.reportError).not.toHaveBeenCalled()
})

it('rejects the entire transition/program/teacher batch without a captured navigation, with no implicit teacher target or writes', async () => {
  const h = await harness(), before = h.session.read()
  const hook = renderHook(() => useComponentLibrary(h.ports))
  await act(async () => expect(hook.result.current.addCatalogPackages([], {
    builtInAssetIds: ['guoling.work.program', 'guoling.work.transition.fade'], includeTeacherController: true,
  })).rejects.toThrow('请选择实际导航控件或互动规则作为转场目标。'))
  expect(h.editCaptured).not.toHaveBeenCalled()
  expect(h.session.read()).toEqual(before)
  expect(teacherIds(h.project())).toEqual([])
  expect(h.reportError).toHaveBeenCalledWith(expect.stringContaining('请选择实际导航控件或互动规则'))
})
