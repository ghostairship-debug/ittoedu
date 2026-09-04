import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  useCourseProjectLifecycle,
  type CanonicalCourseProjectSnapshot,
  type CourseProjectLifecyclePorts,
  type CourseProjectLifecycleWatch,
} from '../../src/renderer/app/useCourseProjectLifecycle'
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
    project: createBlankCourseProject(),
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
