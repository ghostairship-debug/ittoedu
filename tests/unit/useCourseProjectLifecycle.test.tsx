import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  useCourseProjectLifecycle,
  type CanonicalCourseProjectSnapshot,
  type CourseProjectLifecyclePorts,
  type CourseProjectLifecycleWatch,
} from '../../src/renderer/app/useCourseProjectLifecycle'
import * as projectIo from '../../src/renderer/project/courseProjectIo'
import { createCourseProjectArchive } from '../../src/renderer/project/courseProjectArchive'
import { createBlankCourseProject } from '../../src/renderer/project/createCourseProject'
import type { OpenProjectFileResult } from '../../src/shared/ipcTypes'

const IDENTITY = { projectId: 'p1', revision: 1, sessionGeneration: 0 }

const WATCH: CourseProjectLifecycleWatch = {
  dirty: false,
  projectTitle: '课件',
  projectPath: null,
  documentTrigger: null,
  sidecarTrigger: null,
  componentPackagesTrigger: null,
  slideDraftTrigger: null,
  spatialDraftTrigger: null,
  flowDraftTrigger: null,
  textEditTrigger: null,
}

interface Deferred<T> {
  readonly promise: Promise<T>
  resolve(value: T): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

function createSnapshot(): CanonicalCourseProjectSnapshot {
  return {
    project: createBlankCourseProject({ includeDefaultController: false, controls: 'none' }),
    assetFiles: {},
    componentPackages: {},
  }
}

function createPorts(
  overrides: Partial<CourseProjectLifecyclePorts<unknown>> = {},
): CourseProjectLifecyclePorts<unknown> {
  const snapshot = createSnapshot()
  const bytes = createCourseProjectArchive({
    project: snapshot.project,
    assetFiles: {},
    componentFiles: {},
  })
  return {
    captureIdentity: vi.fn(() => ({ ...IDENTITY })),
    prepareDraft: vi.fn(() => ({ ok: true as const, snapshot, token: {} })),
    acknowledgeSaved: vi.fn(() => true),
    captureRecoverySnapshot: vi.fn(() => ({ ok: true as const, snapshot })),
    loadOpenedProject: vi.fn(),
    createBlankProject: vi.fn(),
    createSpatialProject: vi.fn(),
    createFlowProject: vi.fn(),
    hasUnsavedChanges: vi.fn(() => false),
    projectPath: vi.fn(() => null),
    runBusy: ((operation) => operation()) as CourseProjectLifecyclePorts<unknown>['runBusy'],
    commitStatus: vi.fn(),
    reportError: vi.fn(),
    desktopAvailable: vi.fn(() => false),
    openProjectFile: vi.fn(async () => null),
    openRecentProjectFile: vi.fn(async () => ({
      bytes,
      path: 'same.h5lesson',
      name: 'same.h5lesson',
      confirmationId: 'c1',
    })),
    confirmProjectOpen: vi.fn(async () => undefined),
    saveProjectFile: vi.fn(async () => ({ path: 'old.h5lesson' })),
    listRecentProjects: vi.fn(async () => []),
    confirmDiscardChanges: vi.fn(async () => 'discard' as const),
    clearRecoveryProject: vi.fn(async () => undefined),
    writeRecoveryProject: vi.fn(async () => undefined),
    readRecoveryProject: vi.fn(async () => null),
    peekProjectArchive: vi.fn(async () => null),
    setWindowDirtyState: vi.fn(async () => undefined),
    subscribeSaveRequest: vi.fn(() => () => undefined),
    subscribeSaveAndCloseRequest: vi.fn(() => () => undefined),
    ...overrides,
  }
}

async function flushFakeTimers(milliseconds = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds)
  })
}

async function flushUntil(condition: () => boolean, step = 10, limit = 60): Promise<void> {
  for (let attempt = 0; attempt < limit; attempt += 1) {
    if (condition()) return
    await flushFakeTimers(step)
  }
  throw new Error('condition not reached under fake timers')
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useCourseProjectLifecycle stale results', () => {
  it('does not acknowledge a save whose session was replaced by reopening the same project', async () => {
    const saveResult = deferred<{ path: string } | null>()
    const ports = createPorts({ saveProjectFile: vi.fn(() => saveResult.promise) })
    const { result } = renderHook(() => useCourseProjectLifecycle(ports, WATCH))

    let savePromise!: Promise<boolean>
    act(() => {
      savePromise = result.current.saveProject()
    })
    await vi.waitFor(() => expect(ports.saveProjectFile).toHaveBeenCalledTimes(1))

    act(() => {
      result.current.openRecentProject('same.h5lesson')
    })
    await vi.waitFor(() => expect(ports.loadOpenedProject).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(ports.clearRecoveryProject).toHaveBeenCalledTimes(1))
    const clearCallsAfterReopen = vi.mocked(ports.clearRecoveryProject).mock.calls.length

    saveResult.resolve({ path: 'old.h5lesson' })
    const saved = await savePromise

    expect(ports.acknowledgeSaved).toHaveBeenCalledTimes(0)
    expect(saved).toBe(false)
    expect(ports.clearRecoveryProject).toHaveBeenCalledTimes(clearCallsAfterReopen)
  })

  it('drops a recovery write whose session was replaced before the write ran', async () => {
    vi.useFakeTimers()
    const ports = createPorts({ desktopAvailable: vi.fn(() => true) })
    const { result } = renderHook(() => (
      useCourseProjectLifecycle(ports, { ...WATCH, dirty: true })
    ))
    await flushUntil(() => vi.mocked(ports.captureRecoverySnapshot).mock.calls.length === 1)

    act(() => {
      result.current.openRecentProject('same.h5lesson')
    })
    await flushUntil(() => vi.mocked(ports.loadOpenedProject).mock.calls.length === 1)

    await flushFakeTimers(2000)

    expect(ports.writeRecoveryProject).toHaveBeenCalledTimes(0)
  })

  it('does not replace edits made while a recent project is still loading', async () => {
    const snapshot = createSnapshot()
    const bytes = createCourseProjectArchive({
      project: snapshot.project,
      assetFiles: {},
      componentFiles: {},
    })
    const openResult = deferred<OpenProjectFileResult>()
    const identity = { ...IDENTITY }
    const ports = createPorts({
      captureIdentity: vi.fn(() => ({ ...identity })),
      openRecentProjectFile: vi.fn(() => openResult.promise),
    })
    const { result } = renderHook(() => useCourseProjectLifecycle(ports, WATCH))

    act(() => {
      result.current.openRecentProject('delayed.h5lesson')
    })
    await vi.waitFor(() => expect(ports.openRecentProjectFile).toHaveBeenCalledTimes(1))

    identity.revision += 1
    openResult.resolve({
      bytes,
      path: 'delayed.h5lesson',
      name: 'delayed.h5lesson',
      confirmationId: 'delayed-confirmation',
    })

    await vi.waitFor(() => expect(ports.commitStatus).toHaveBeenCalledWith(
      '工程已发生新的编辑，已取消此次替换操作',
    ))
    expect(ports.loadOpenedProject).not.toHaveBeenCalled()
    expect(ports.confirmProjectOpen).not.toHaveBeenCalled()
  })

  it('does not create a blank project over edits made while recovery cleanup is pending', async () => {
    const cleanup = deferred<void>()
    const identity = { ...IDENTITY }
    const ports = createPorts({
      captureIdentity: vi.fn(() => ({ ...identity })),
      clearRecoveryProject: vi.fn(() => cleanup.promise),
    })
    const { result } = renderHook(() => useCourseProjectLifecycle(ports, WATCH))

    act(() => {
      result.current.newProject()
    })
    await vi.waitFor(() => expect(ports.clearRecoveryProject).toHaveBeenCalledTimes(1))

    identity.revision += 1
    cleanup.resolve()

    await vi.waitFor(() => expect(ports.commitStatus).toHaveBeenCalledWith(
      '工程已发生新的编辑，已取消此次新建操作',
    ))
    expect(ports.createBlankProject).not.toHaveBeenCalled()
  })

  it('keeps a successful save successful when the recent-project list refresh fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const ports = createPorts({
      desktopAvailable: vi.fn(() => true),
      listRecentProjects: vi.fn(async () => {
        throw new Error('recent unavailable')
      }),
    })
    const { result } = renderHook(() => useCourseProjectLifecycle(ports, WATCH))

    let saved = false
    await act(async () => {
      saved = await result.current.saveProject()
    })

    expect(saved).toBe(true)
    expect(ports.acknowledgeSaved).toHaveBeenCalledTimes(1)
    expect(ports.reportError).toHaveBeenCalledWith(
      '最近工程列表暂时无法更新，但不影响当前工程。',
    )
  })

  it('still offers a valid recovery when the recent-project list fails at startup', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const snapshot = createSnapshot()
    const bytes = createCourseProjectArchive({
      project: snapshot.project,
      assetFiles: {},
      componentFiles: {},
    })
    const recovery = {
      projectName: '恢复课件',
      bytes,
      savedAt: Date.now(),
    }
    const ports = createPorts({
      desktopAvailable: vi.fn(() => true),
      listRecentProjects: vi.fn(async () => {
        throw new Error('recent unavailable')
      }),
      readRecoveryProject: vi.fn(async () => recovery),
    })

    const { result } = renderHook(() => useCourseProjectLifecycle(ports, WATCH))

    await vi.waitFor(() => expect(result.current.recoveryOffer).toEqual(recovery))
    expect(ports.clearRecoveryProject).not.toHaveBeenCalled()
    expect(ports.reportError).toHaveBeenCalledWith(
      '最近工程列表暂时无法更新，但不影响当前工程。',
    )
  })
})


describe('course replacement and close ownership', () => {
  it('detaches only after a successful standalone replacement and preserves lesson-origin activation', async () => {
    const order: string[] = []
    const ports = createPorts({ beforeReplace: vi.fn(async () => { order.push('flush'); return true }), createFlowProject: vi.fn(() => { order.push('create') }), onProjectReplaced: vi.fn(() => { order.push('detach') }) })
    const { result } = renderHook(() => useCourseProjectLifecycle(ports, WATCH))
    await act(async () => { expect(await result.current.newFlowProject()).toBe(true) })
    expect(order).toEqual(['flush', 'create', 'detach'])
    order.length = 0
    await act(async () => { expect(await result.current.newFlowProject({ origin: 'lesson' })).toBe(true) })
    expect(order).toEqual(['flush', 'create'])
  })
  it('flushes and detaches a toolbar recent-open only after a valid archive is loaded', async () => {
    const order: string[] = []
    const ports = createPorts({ beforeReplace: async () => { order.push('flush'); return true }, loadOpenedProject: () => { order.push('load') }, onProjectReplaced: () => { order.push('detach') } })
    const { result } = renderHook(() => useCourseProjectLifecycle(ports, WATCH))
    await act(async () => { expect(await result.current.openRecentProject('standalone.h5lesson')).toBe(true) })
    expect(order).toEqual(['flush', 'load', 'detach'])
    order.length = 0
    await act(async () => { expect(await result.current.openRecentProject('lesson.h5lesson', { origin: 'lesson' })).toBe(true) })
    expect(order).toEqual(['flush', 'load'])
  })
  it('retains project and lesson binding on flush failure, open cancellation, or edits during flush', async () => {
    const ports = createPorts({ beforeReplace: vi.fn(async () => false), onProjectReplaced: vi.fn() })
    const { result } = renderHook(() => useCourseProjectLifecycle(ports, WATCH))
    await act(async () => { expect(await result.current.newProject()).toBe(false); result.current.openProject() })
    expect(ports.createBlankProject).not.toHaveBeenCalled()
    expect(ports.loadOpenedProject).not.toHaveBeenCalled()
    expect(ports.onProjectReplaced).not.toHaveBeenCalled()
    expect(ports.clearRecoveryProject).not.toHaveBeenCalled()
    const flush = deferred<boolean>()
    ports.beforeReplace = vi.fn(() => flush.promise)
    let replacement!: Promise<boolean>
    act(() => { replacement = result.current.newProject() })
    await vi.waitFor(() => expect(ports.beforeReplace).toHaveBeenCalledTimes(1))
    ports.captureIdentity = vi.fn(() => ({ ...IDENTITY, revision: 2 }))
    await act(async () => { flush.resolve(true); expect(await replacement).toBe(false) })
    expect(ports.createBlankProject).not.toHaveBeenCalled()
    expect(ports.onProjectReplaced).not.toHaveBeenCalled()
  })
  it('keeps save cancellation unbound and reports the real prior path for Save As', async () => {
    const ports = createPorts({ projectPath: () => 'original.h5lesson', saveProjectFile: vi.fn(async () => null), onProjectSaved: vi.fn() })
    const { result } = renderHook(() => useCourseProjectLifecycle(ports, WATCH))
    await act(async () => { expect(await result.current.saveProject(true)).toBe(false) })
    expect(ports.acknowledgeSaved).not.toHaveBeenCalled()
    expect(ports.onProjectSaved).not.toHaveBeenCalled()
    expect(ports.clearRecoveryProject).not.toHaveBeenCalled()
    ports.saveProjectFile = vi.fn(async () => ({ path: 'copy.h5lesson' }))
    await act(async () => { expect(await result.current.saveProject(true)).toBe(true) })
    expect(ports.onProjectSaved).toHaveBeenCalledWith(expect.objectContaining({ previousPath: 'original.h5lesson', path: 'copy.h5lesson', saveAs: true }))
  })
  it('acknowledges discard-close only after all recovery owners durably preserve drafts', async () => {
    let close!: () => Promise<boolean>
    const ports = createPorts({ desktopAvailable: () => true, preserveBeforeClose: vi.fn(async () => false), subscribePreserveAndCloseRequest: handler => { close = handler; return () => undefined } })
    renderHook(() => useCourseProjectLifecycle(ports, WATCH))
    await act(async () => { expect(await close()).toBe(false) })
    ports.preserveBeforeClose = vi.fn(async () => true)
    await act(async () => { expect(await close()).toBe(true) })
    expect(ports.saveProjectFile).not.toHaveBeenCalled()
    expect(ports.clearRecoveryProject).not.toHaveBeenCalled()
  })
})


describe('lesson scope guard with unchanged project identity', () => {
  it.each(['newProject', 'newFlowProject', 'newSpatialProject'] as const)('%s rejects scope changes after each asynchronous replacement boundary', async method => {
    for (const boundary of ['confirm', 'flush', 'clear'] as const) {
      let current = true
      const ports = createPorts({
        hasUnsavedChanges: () => true,
        confirmDiscardChanges: vi.fn(async () => { if (boundary === 'confirm') current = false; return 'discard' as const }),
        beforeReplace: vi.fn(async () => { if (boundary === 'flush') current = false; return true }),
        clearRecoveryProject: vi.fn(async () => { if (boundary === 'clear') current = false }),
      })
      const hook = renderHook(() => useCourseProjectLifecycle(ports, WATCH))
      let saved: boolean | undefined
      await act(async () => { saved = await hook.result.current[method]({ origin: 'lesson', isCurrent: () => current }) })
      expect(saved).toBe(false)
      expect(ports.captureIdentity()).toEqual(IDENTITY)
      expect(ports.createBlankProject).not.toHaveBeenCalled()
      expect(ports.createFlowProject).not.toHaveBeenCalled()
      expect(ports.createSpatialProject).not.toHaveBeenCalled()
      hook.unmount()
    }
  })
  it.each(['flush', 'pack', 'write'] as const)('save rejects a scope change after %s without acknowledging or binding it', async boundary => {
    let current = true
    const original = projectIo.saveCourseProjectDocumentAsync
    if (boundary === 'pack') vi.spyOn(projectIo, 'saveCourseProjectDocumentAsync').mockImplementation(async data => { const bytes = await original(data); current = false; return bytes })
    const ports = createPorts({
      beforeSave: vi.fn(async () => { if (boundary === 'flush') current = false; return true }),
      saveProjectFile: vi.fn(async () => { if (boundary === 'write') current = false; return { path: 'scope.h5lesson' } }),
      onProjectSaved: vi.fn(async () => undefined),
    })
    const hook = renderHook(() => useCourseProjectLifecycle(ports, WATCH))
    let saved: boolean | undefined
    await act(async () => { saved = await hook.result.current.saveProject(false, { isCurrent: () => current }) })
    expect(saved).toBe(false)
    expect(ports.captureIdentity()).toEqual(IDENTITY)
    expect(ports.saveProjectFile).toHaveBeenCalledTimes(boundary === 'write' ? 1 : 0)
    expect(ports.acknowledgeSaved).not.toHaveBeenCalled()
    expect(ports.onProjectSaved).not.toHaveBeenCalled()
    hook.unmount()
  })
  it('preserves successful guarded creation and save', async () => {
    const ports = createPorts({ onProjectSaved: vi.fn(async () => undefined) })
    const hook = renderHook(() => useCourseProjectLifecycle(ports, WATCH))
    await act(async () => {
      expect(await hook.result.current.newProject({ origin: 'lesson', isCurrent: () => true })).toBe(true)
      expect(await hook.result.current.newFlowProject({ origin: 'lesson', isCurrent: () => true })).toBe(true)
      expect(await hook.result.current.newSpatialProject({ origin: 'lesson', isCurrent: () => true })).toBe(true)
      expect(await hook.result.current.saveProject(false, { isCurrent: () => true })).toBe(true)
    })
    expect(ports.createBlankProject).toHaveBeenCalledOnce()
    expect(ports.createFlowProject).toHaveBeenCalledOnce()
    expect(ports.createSpatialProject).toHaveBeenCalledOnce()
    expect(ports.acknowledgeSaved).toHaveBeenCalledOnce()
    expect(ports.onProjectSaved).toHaveBeenCalledOnce()
    hook.unmount()
  })
})
