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
})
