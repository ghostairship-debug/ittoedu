import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react'
import { createRef, useSyncExternalStore } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { useDocumentTabsController, type CourseDocumentsPort } from '../../src/renderer/lessonWorkspace/controller/useDocumentTabsController'
import { LessonWorkspaceShell, type LessonWorkspaceShellHandle } from '../../src/renderer/lessonWorkspace/LessonWorkspaceShell'
import { useLessonWorkspaceController } from '../../src/renderer/lessonWorkspace/controller/useLessonWorkspaceController'
import { useCourseProjectLifecycle, type CourseProjectLifecyclePorts, type CourseProjectLifecycleWatch } from '../../src/renderer/app/useCourseProjectLifecycle'
import type { RecoverableDocumentFilePort } from '../../src/renderer/documentFiles/documentFileSession'
import type { DocumentModel, DocumentSnapshot } from '../../src/shared/workbench/document'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { createCourseDocumentHost, deferred } from '../helpers/courseDocumentHost'

vi.mock('../../src/renderer/lessonWorkspace/view/LessonWorkspaceView', () => ({ LessonWorkspaceView: () => null }))
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks() })

function snapshot(documentId: string, model: DocumentModel): DocumentSnapshot {
  return { documentId, epoch: 'epoch', revision: 0, sequence: 0, model, binding: { kind: 'untitled', suggestedName: documentId },
    dirty: false, saving: false, recoverable: true, undoDepth: 0, redoDepth: 0 }
}
const course = (id: string) => snapshot(id, { kind: 'course-v10', project: createBlankCourseProjectV10(id), resources: { assets: {}, components: {} } })
function tabFixture() {
  let count = 0
  const port = { documents: {
    subscribe: () => () => {},
    create: async (model: DocumentModel) => snapshot(`file-${++count}`, model),
    open: async () => snapshot(`file-${++count}`, { kind: 'text', source: '<p>HTML</p>', resources: { assets: {}, components: {} } }),
  } } as unknown as RecoverableDocumentFilePort
  const courses: CourseDocumentsPort = { documents: [course('a')], activeDocumentId: 'a', activation: 1,
    activate: vi.fn(async () => {}), close: async () => true }
  return { port, courses }
}

it('keeps an HTML tab during background course publication but honors an explicit course selection', async () => {
  const f = tabFixture()
  const hook = renderHook(({ courses }) => useDocumentTabsController({ documentPort: f.port, courseDocuments: courses }), { initialProps: { courses: f.courses } })
  await act(async () => { await hook.result.current.openTab({ kind: 'document', path: 'C:/lesson.html', name: 'lesson.html', lesson: null }) })
  const html = hook.result.current.activeTab, intent = hook.result.current.captureNavigationIdentity()
  await act(async () => hook.rerender({ courses: { ...f.courses, documents: [...f.courses.documents, course('b')], activeDocumentId: 'b', activation: 2 } }))
  expect(hook.result.current.activeTab).toBe(html)
  expect(hook.result.current.captureNavigationIdentity()).toBe(intent)
  expect(hook.result.current.tabs.some(tab => tab.id === 'b')).toBe(true)
  await act(async () => hook.result.current.setActiveTab('course'))
  expect(hook.result.current.activeTab).toBe('b')
})

it('continues following the current course without treating its own publication as a new tab request', async () => {
  const f = tabFixture()
  const hook = renderHook(({ courses }) => useDocumentTabsController({ documentPort: f.port, courseDocuments: courses }), { initialProps: { courses: f.courses } })
  await waitFor(() => expect(hook.result.current.activeTab).toBe('a'))
  const intent = hook.result.current.captureNavigationIdentity()
  await act(async () => hook.rerender({ courses: { ...f.courses, documents: [...f.courses.documents, course('b')], activeDocumentId: 'b', activation: 2 } }))
  expect(hook.result.current.activeTab).toBe('b')
  expect(hook.result.current.captureNavigationIdentity()).toBe(intent)
})

it('releases only a failed course request and preserves the later file selection', async () => {
  const f = tabFixture()
  let fail!: (error: Error) => void
  f.courses.documents = [...f.courses.documents, course('b')]
  f.courses.activate = vi.fn(() => new Promise<void>((_resolve, reject) => { fail = reject }))
  const hook = renderHook(({ courses }) => useDocumentTabsController({ documentPort: f.port, courseDocuments: courses }), { initialProps: { courses: f.courses } })
  act(() => hook.result.current.setActiveTab('b'))
  await act(async () => { await hook.result.current.createText('keep') })
  const file = hook.result.current.activeTab
  await act(async () => { fail(new Error('activation refused')); await Promise.resolve() })
  await act(async () => hook.rerender({ courses: { ...f.courses, activeDocumentId: 'b', activation: 2 } }))
  expect(hook.result.current.activeTab).toBe(file)
})

it('reads current navigation through a stable shell getter and invalidates it on remount', async () => {
  const f = tabFixture(), ref = createRef<LessonWorkspaceShellHandle>()
  const props = { lessonOperation: vi.fn(async () => ({ recent: [] })), documentPort: f.port, courseDocuments: f.courses,
    projectPath: null, onOpenProject: async () => true, onNewProject: async () => true, children: null }
  const view = render(<LessonWorkspaceShell {...props} ref={ref} />)
  await act(async () => { await Promise.resolve() })
  const getter = ref.current!.captureNavigationIdentity, original = getter()
  view.rerender(<LessonWorkspaceShell {...props} ref={ref} />)
  expect(ref.current!.captureNavigationIdentity).toBe(getter)
  expect(getter()).toBe(original)
  await act(async () => { await ref.current!.openFile('C:/lesson.html') })
  expect(getter()).not.toBe(original)
  const beforeUnmount = getter()
  view.unmount()
  render(<LessonWorkspaceShell {...props} ref={ref} />)
  await act(async () => { await Promise.resolve() })
  expect(ref.current!.captureNavigationIdentity).not.toBe(getter)
  expect(ref.current!.captureNavigationIdentity()).not.toBe(beforeUnmount)
})

it.each(['new', 'open'] as const)('foreground %s still selects the completed course from an ordinary file tab', async operation => {
  const host = await createCourseDocumentHost(), f = tabFixture()
  let completedForeground: (() => boolean) | undefined
  await host.seedFile('opened.glx', 'opened')
  const subscribe = (listener: () => void) => host.bridge.subscribe(listener), read = () => host.bridge.read()
  const lessonOperation = async () => ({ recent: [] })
  const hook = renderHook(() => {
    const view = useSyncExternalStore(subscribe, read)
    const tabs = useDocumentTabsController({ documentPort: f.port, courseDocuments: {
      documents: view.documents, activeDocumentId: view.activeDocumentId, activation: view.activation,
      activate: id => host.bridge.activate(id), close: async () => false,
    } })
    const workspace = useLessonWorkspaceController({ lessonOperation, projectPath: null, tabs,
      onNewProject: async foreground => { completedForeground = foreground; await host.documents.create('slide'); return true },
      onOpenProject: async (path, foreground) => { completedForeground = foreground; await host.documents.open(path); return true },
    })
    return { tabs, workspace }
  })
  await act(async () => { await hook.result.current.tabs.createText('notes') })
  expect(hook.result.current.tabs.isCourseActive).toBe(false)
  const before = Number(hook.result.current.tabs.captureNavigationIdentity())
  await act(async () => {
    if (operation === 'new') await hook.result.current.workspace.actions.newStandaloneProject()
    else await hook.result.current.workspace.actions.openFile({ name: 'opened.glx', path: 'opened.glx', kind: 'file' })
  })
  expect(hook.result.current.tabs.activeTab).toBe(host.read().documentId)
  expect(hook.result.current.tabs.isCourseActive).toBe(true)
  expect(Number(hook.result.current.tabs.captureNavigationIdentity())).toBe(before + 1)
  expect(completedForeground?.()).toBe(true)
})

it.each(['tab-activate', 'focus-read', 'focus-activate'] as const)('invalidates the existing tab request on workspace navigation during %s', async phase => {
  const f = tabFixture(), gate = deferred<void>(), reading = deferred<DocumentSnapshot>()
  f.courses.documents = [...f.courses.documents, course('b')]
  f.courses.activate = vi.fn(async (_id, activateIf) => { await gate.promise; return activateIf?.() !== false })
  const read = vi.fn(async () => phase === 'focus-read' ? reading.promise : course('b'))
  const port = { ...f.port, documents: { ...f.port.documents!, read } }
  const lessonOperation = async (request: { operation: string; directory?: string }) => request.operation === 'open-workspace'
    ? { directory: request.directory } : { recent: [], lessons: [], projects: [] }
  const hook = renderHook(() => {
    const tabs = useDocumentTabsController({ documentPort: port, courseDocuments: f.courses })
    const workspace = useLessonWorkspaceController({ lessonOperation, projectPath: null, tabs,
      onNewProject: async () => true, onOpenProject: async () => true })
    return { tabs, workspace }
  })
  let focusing: Promise<void | boolean> | undefined
  act(() => {
    if (phase === 'tab-activate') hook.result.current.tabs.setActiveTab('b')
    else focusing = hook.result.current.tabs.focusDocument('b')
  })
  if (phase === 'focus-read') await waitFor(() => expect(read).toHaveBeenCalledTimes(1))
  else await waitFor(() => expect(f.courses.activate).toHaveBeenCalledTimes(1))
  await act(async () => hook.result.current.workspace.actions.openWorkspace('C:/new-workspace'))
  if (phase !== 'focus-read') expect(vi.mocked(f.courses.activate).mock.calls[0]![1]?.()).toBe(false)
  await act(async () => { reading.resolve(course('b')); gate.resolve(); await focusing })
  expect(hook.result.current.tabs.activeTab).toBe('a')
  if (phase === 'focus-read') expect(f.courses.activate).not.toHaveBeenCalled()
})

it.each([true, false])('qualifies the earliest focus read by its captured course view, changed=%s', async changed => {
  const f = tabFixture(), reading = deferred<DocumentSnapshot>()
  let view = 0
  f.courses.documents = [...f.courses.documents, course('b')]
  f.courses.captureScope = vi.fn(() => { const captured = view; return () => captured === view })
  f.courses.activate = vi.fn(async (_id, activateIf) => {
    expect(activateIf?.()).toBe(true)
    view++ // Completing this activation changes the original course scope itself.
    return true
  })
  const read = vi.fn(() => reading.promise)
  const port = { ...f.port, documents: { ...f.port.documents!, read } }
  const hook = renderHook(() => useDocumentTabsController({ documentPort: port, courseDocuments: f.courses }))
  let focusing!: Promise<void | boolean>
  act(() => { focusing = hook.result.current.focusDocument('b') })
  expect(f.courses.captureScope).toHaveBeenCalledTimes(1)
  expect(read).toHaveBeenCalledTimes(1)
  if (changed) view++
  await act(async () => { reading.resolve(course('b')); await focusing })
  if (changed) {
    expect(f.courses.activate).not.toHaveBeenCalled()
    expect(hook.result.current.activeTab).toBe('a')
  } else {
    expect(f.courses.activate).toHaveBeenCalledTimes(1)
    expect(hook.result.current.activeTab).toBe('b')
  }
})

const watch: CourseProjectLifecycleWatch = { dirty: false, projectTitle: '', projectPath: null, documentTrigger: null,
  sidecarTrigger: null, componentPackagesTrigger: null, slideDraftTrigger: null, spatialDraftTrigger: null, flowDraftTrigger: null, textEditTrigger: null }
async function lifecycleFixture() {
  const host = await createCourseDocumentHost()
  const ports: CourseProjectLifecyclePorts = { documents: host.documents, captureIdentity: () => host.identity(),
    hasUnsavedChanges: () => false, projectPath: () => null, runBusy: async work => work(),
    commitStatus: vi.fn(), reportError: vi.fn(), desktopAvailable: () => true, openProjectFile: vi.fn(async () => null),
    openRecentProjectFile: async () => { throw new Error('Retired byte path') }, confirmProjectOpen: vi.fn(async () => {}),
    listRecentProjects: vi.fn(async () => []), setWindowDirtyState: async () => {}, subscribeSaveAndCloseRequest: () => () => {}, onProjectReplaced: vi.fn() }
  const hook = renderHook(() => useCourseProjectLifecycle(ports, watch))
  await act(async () => { await Promise.resolve() })
  return { host, ports, hook }
}

it('does not report replacement or change the active course when the native open picker is cancelled', async () => {
  const { host, ports, hook } = await lifecycleFixture(), previous = host.read().documentId
  act(() => hook.result.current.openProject())
  await waitFor(() => expect(ports.openProjectFile).toHaveBeenCalledTimes(1))
  await act(async () => { await Promise.resolve() })
  expect(ports.onProjectReplaced).not.toHaveBeenCalled()
  expect(host.read().documentId).toBe(previous)
})

it.each(['caller', 'foreground'] as const)('does not create content after %s navigation changes while it is being prepared', async source => {
  const { host, ports, hook } = await lifecycleFixture(), previous = host.read().documentId
  const prepared = deferred<{ project: ReturnType<typeof createBlankCourseProjectV10>; resources: { assets: {}; components: {} } }>()
  const make = vi.fn(() => prepared.promise)
  let current = true, result!: Promise<boolean>
  if (source === 'foreground') ports.beginForeground = () => () => current
  act(() => { result = hook.result.current.newProjectFrom(make, source === 'caller' ? { isCurrent: () => current } : undefined) })
  await waitFor(() => expect(make).toHaveBeenCalledTimes(1))
  current = false
  await act(async () => { prepared.resolve({ project: createBlankCourseProjectV10('import'), resources: { assets: {}, components: {} } }); expect(await result).toBe(false) })
  expect(host.read().documentId).toBe(previous)
  expect(ports.onProjectReplaced).not.toHaveBeenCalled()
})

it('captures foreground before an operation waits in the existing action queue', async () => {
  const { host, ports, hook } = await lifecycleFixture(), previous = host.read().documentId
  const queue = deferred<void>()
  let navigation = 1
  ports.beginForeground = vi.fn(() => { const clicked = navigation; return () => clicked === navigation })
  ports.runBusy = async work => { await queue.promise; return work() }
  let result!: Promise<boolean>
  act(() => { result = hook.result.current.newProject() })
  expect(ports.beginForeground).toHaveBeenCalledTimes(1)
  navigation++
  await act(async () => { queue.resolve(); expect(await result).toBe(false) })
  expect(host.read().documentId).toBe(previous)
  expect(ports.onProjectReplaced).not.toHaveBeenCalled()
})

it('reuses a caller foreground without claiming it again and supplies it to completion', async () => {
  const { host, ports, hook } = await lifecycleFixture(), previous = host.read().documentId
  const foreground = vi.fn(() => true)
  ports.beginForeground = vi.fn(() => { throw new Error('Caller already owns this navigation') })
  let completionForeground: (() => boolean) | undefined
  ports.onProjectReplaced = captured => { completionForeground = captured }
  await act(async () => { expect(await hook.result.current.newProjectFrom(async () => ({ project: createBlankCourseProjectV10('one intent'), resources: { assets: {}, components: {} } }), { foreground })).toBe(true) })
  expect(host.read().documentId).not.toBe(previous)
  expect(ports.beginForeground).not.toHaveBeenCalled()
  expect(completionForeground?.()).toBe(true)
})

it('keeps a completed creation truthful when its foreground navigation expires before the ACK returns', async () => {
  const { host, ports, hook } = await lifecycleFixture(), previous = host.read().documentId
  const written = deferred<void>(), acknowledge = deferred<void>()
  let navigation = 1
  ports.beginForeground = () => { const clicked = navigation; return () => clicked === navigation }
  const create = host.documents.createFrom!
  ports.documents = { ...host.documents, createFrom: async (content, activateIf) => {
    expect(activateIf?.()).toBe(true)
    await create(content)
    written.resolve()
    await acknowledge.promise
  } }
  let result!: Promise<boolean>
  act(() => { result = hook.result.current.newProjectFrom(async () => ({ project: createBlankCourseProjectV10('background'), resources: { assets: {}, components: {} } })) })
  await written.promise
  navigation++
  await act(async () => { acknowledge.resolve(); expect(await result).toBe(true) })
  expect(host.read().documentId).not.toBe(previous)
  expect(ports.onProjectReplaced).not.toHaveBeenCalled()
})

it('does not open the native picker result after its captured foreground expires', async () => {
  const { host, ports, hook } = await lifecycleFixture(), previous = host.read().documentId
  const picked = deferred<Awaited<ReturnType<CourseProjectLifecyclePorts['openProjectFile']>>>()
  let navigation = 1, completion!: Promise<unknown>
  ports.beginForeground = () => { const clicked = navigation; return () => clicked === navigation }
  ports.openProjectFile = vi.fn(() => picked.promise)
  ports.runBusy = work => { const pending = work(); completion = pending; return pending }
  act(() => hook.result.current.openProject())
  await waitFor(() => expect(ports.openProjectFile).toHaveBeenCalledTimes(1))
  navigation++
  await act(async () => { picked.resolve({ path: 'stale.glx', name: 'stale.glx', bytes: new Uint8Array(), confirmationId: 'stale' }); await completion })
  expect(host.read().documentId).toBe(previous)
  expect(ports.confirmProjectOpen).not.toHaveBeenCalled()
  expect(ports.onProjectReplaced).not.toHaveBeenCalled()
})

it('preserves a createFrom admission refusal instead of reporting a replacement', async () => {
  const { host, ports, hook } = await lifecycleFixture(), previous = host.read().documentId
  const createFrom = vi.fn(async () => false)
  ports.documents = { ...host.documents, createFrom }
  await act(async () => { expect(await hook.result.current.newProjectFrom(async () => ({ project: createBlankCourseProjectV10('not admitted'), resources: { assets: {}, components: {} } }))).toBe(false) })
  expect(createFrom).toHaveBeenCalledTimes(1)
  expect(host.read().documentId).toBe(previous)
  expect(ports.onProjectReplaced).not.toHaveBeenCalled()
})

it('does not confirm a picker result when the original open was not admitted', async () => {
  const { host, ports, hook } = await lifecycleFixture(), previous = host.read().documentId
  let completion!: Promise<unknown>
  ports.runBusy = work => { const pending = work(); completion = pending; return pending }
  ports.documents = { ...host.documents, open: vi.fn(async () => false) }
  ports.openProjectFile = vi.fn(async () => ({ path: 'not-admitted.glx', name: 'not-admitted.glx', bytes: new Uint8Array(), confirmationId: 'not-admitted' }))
  act(() => hook.result.current.openProject())
  await waitFor(() => expect(ports.openProjectFile).toHaveBeenCalledTimes(1))
  await act(async () => { await completion })
  expect(host.read().documentId).toBe(previous)
  expect(ports.confirmProjectOpen).not.toHaveBeenCalled()
  expect(ports.onProjectReplaced).not.toHaveBeenCalled()
})
