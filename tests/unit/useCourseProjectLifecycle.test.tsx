import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  useCourseProjectLifecycle,
  type CourseProjectLifecyclePorts,
  type CourseProjectLifecycleWatch,
} from '../../src/renderer/app/useCourseProjectLifecycle'
import { createCourseDocumentHost, deferred, type CourseDocumentTestHost } from '../helpers/courseDocumentHost'

const WATCH: CourseProjectLifecycleWatch = {
  dirty: false, projectTitle: '课件', projectPath: null,
  documentTrigger: null, sidecarTrigger: null, componentPackagesTrigger: null,
  slideDraftTrigger: null, spatialDraftTrigger: null, flowDraftTrigger: null, textEditTrigger: null,
}

function createPorts(host: CourseDocumentTestHost, overrides: Partial<CourseProjectLifecyclePorts> = {}): CourseProjectLifecyclePorts {
  const reportError = vi.fn()
  return {
    documents: host.documents,
    captureIdentity: () => host.identity(),
    hasUnsavedChanges: () => host.read().dirty,
    projectPath: () => { const binding = host.read().binding; return binding.kind === 'file' ? binding.path : null },
    async runBusy(work) { try { return await work() } catch (error) { reportError(error instanceof Error ? error.message : String(error)); return undefined } },
    commitStatus: vi.fn(), reportError,
    desktopAvailable: () => true,
    openProjectFile: vi.fn(async () => null),
    openRecentProjectFile: vi.fn(async () => { throw new Error('Renderer byte loader is retired') }),
    confirmProjectOpen: vi.fn(async () => undefined),
    listRecentProjects: vi.fn(async () => []),
    confirmDiscardChanges: vi.fn(async () => 'discard' as const),
    setWindowDirtyState: vi.fn(async () => undefined),
    subscribeSaveAndCloseRequest: vi.fn(() => () => undefined),
    onProjectReplaced: vi.fn(),
    onProjectSaved: vi.fn(async () => undefined),
    ...overrides,
  }
}

async function mount(host: CourseDocumentTestHost, overrides: Partial<CourseProjectLifecyclePorts> = {}) {
  const ports = createPorts(host, overrides)
  const hook = renderHook(() => useCourseProjectLifecycle(ports, { ...WATCH, dirty: host.read().dirty }))
  await act(async () => { await Promise.resolve() })
  return { ...hook, ports }
}

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('useCourseProjectLifecycle main document sessions', () => {
  it.each([
    ['newProject', 'slide-scene'], ['newFlowProject', 'flow-block'], ['newSpatialProject', 'spatial-camera'],
  ] as const)('%s creates its real surface in a separate main session', async (method, kind) => {
    const host = await createCourseDocumentHost()
    await host.editTitle('old draft')
    const previous = host.read()
    const { result, ports } = await mount(host, { confirmDiscardChanges: vi.fn(async () => 'cancel' as const) })
    await act(async () => { expect(await result.current[method]()).toBe(true) })
    const current = host.read()
    expect(current.documentId).not.toBe(previous.documentId)
    expect(current).toMatchObject({ binding: { kind: 'untitled' }, dirty: true, undoDepth: 0 })
    expect(current.model).toMatchObject({ project: { locations: [{ kind }] } })
    expect(host.registry.get(previous.documentId).read()).toEqual(previous)
    expect(ports.onProjectReplaced).toHaveBeenCalledOnce()
    expect(ports.confirmDiscardChanges).not.toHaveBeenCalled()
  })

  it('opens the chosen path through main and reselects the same live History for recent opens', async () => {
    const host = await createCourseDocumentHost()
    await host.editTitle('retained before open')
    const previous = host.read()
    await host.seedFile('chosen.h5lesson', 'disk course')
    const { result, ports } = await mount(host, {
      openProjectFile: vi.fn(async () => ({ path: 'chosen.h5lesson', name: 'chosen.h5lesson', confirmationId: 'chosen', bytes: new Uint8Array([0]) })),
      confirmDiscardChanges: vi.fn(async () => 'cancel' as const),
    })
    act(() => result.current.openProject())
    await waitFor(() => expect(ports.confirmProjectOpen).toHaveBeenCalledWith('chosen'))
    expect(host.read()).toMatchObject({ dirty: false, model: { project: { title: 'disk course' } } })
    expect(host.registry.get(previous.documentId).read()).toEqual(previous)
    await host.editTitle('live edit')
    const existing = host.read()
    await act(async () => { expect(await result.current.openRecentProject('chosen.h5lesson')).toBe(true) })
    expect(host.read()).toEqual(existing)
    expect(existing.undoDepth).toBe(1)
    expect(ports.openRecentProjectFile).not.toHaveBeenCalled()
    expect(ports.confirmDiscardChanges).not.toHaveBeenCalled()
  })

  it('leaves the same dirty untitled session and journal intact when Save As is cancelled', async () => {
    const host = await createCourseDocumentHost()
    await host.documents.create('flow'); await host.editTitle('keep unsaved')
    host.controls.savePath = null
    const before = host.read(), journal = structuredClone(host.durable.get(before.documentId)), diskCount = host.disk.size
    const { result, ports } = await mount(host)
    await act(async () => { expect(await result.current.saveProject(true)).toBe(false) })
    expect(host.read()).toEqual(before)
    expect(host.durable.get(before.documentId)).toEqual(journal)
    expect(host.disk.size).toBe(diskCount)
    expect(ports.onProjectSaved).not.toHaveBeenCalled()
    expect(ports.commitStatus).not.toHaveBeenCalled()
  })

  it('saves an acknowledged revision without clearing changes made during disk I/O', async () => {
    const host = await createCourseDocumentHost(), entered = deferred(), release = deferred()
    await host.editTitle('version sent to disk')
    host.controls.beforeSave = async () => { entered.resolve(); await release.promise }
    const { result, ports } = await mount(host)
    let save!: Promise<boolean>
    act(() => { save = result.current.saveProject() })
    await entered.promise
    await host.editTitle('typed while saving')
    await act(async () => { release.resolve(); expect(await save).toBe(false) })
    expect(host.driver.load(Uint8Array.from(host.disk.get('initial.h5lesson')!))).toMatchObject({ project: { title: 'version sent to disk' } })
    expect(host.read()).toMatchObject({ dirty: true, model: { project: { title: 'typed while saving' } } })
    expect(ports.commitStatus).toHaveBeenLastCalledWith('已保存启动保存时的版本；后续修改尚未保存')
    host.controls.beforeSave = undefined
    await act(async () => { expect(await result.current.saveProject()).toBe(true) })
    expect(host.read().dirty).toBe(false)
  })

  it('does not acknowledge a late save against a newly selected document', async () => {
    const host = await createCourseDocumentHost(), entered = deferred(), release = deferred()
    await host.editTitle('old file saved')
    const oldId = host.read().documentId
    host.controls.beforeSave = async () => { entered.resolve(); await release.promise }
    const { result, ports } = await mount(host)
    let save!: Promise<boolean>
    act(() => { save = result.current.saveProject() })
    await entered.promise
    await act(async () => { expect(await result.current.newSpatialProject()).toBe(true) })
    await host.editTitle('new draft stays dirty')
    const current = host.read()
    await act(async () => { release.resolve(); expect(await save).toBe(false) })
    expect(host.read()).toEqual(current)
    expect(current.dirty).toBe(true)
    expect(host.registry.get(oldId).read().dirty).toBe(false)
    expect(ports.onProjectSaved).not.toHaveBeenCalled()
    expect(ports.commitStatus).not.toHaveBeenCalled()
  })

  it('preserves the actual session when temporary-input preparation refuses switching or its scope is stale', async () => {
    const host = await createCourseDocumentHost()
    await host.editTitle('protected draft')
    const before = host.read()
    const { result, ports } = await mount(host, { beforeReplace: vi.fn(async () => false) })
    await act(async () => {
      expect(await result.current.newProject()).toBe(false)
      expect(await result.current.openRecentProject('missing.h5lesson')).toBe(false)
      expect(await result.current.newFlowProject({ isCurrent: () => false })).toBe(false)
    })
    expect(host.read()).toEqual(before)
    expect(host.registry.list()).toHaveLength(1)
    expect(ports.onProjectReplaced).not.toHaveBeenCalled()
    expect(ports.reportError).not.toHaveBeenCalled()
    expect(ports.confirmDiscardChanges).not.toHaveBeenCalled()
  })

  it('cancels a late switch when another main document with the same project identity becomes active', async () => {
    const host = await createCourseDocumentHost(), decision = deferred<boolean>()
    await host.editTitle('original retained draft')
    const original = host.read()
    host.disk.set('same-project-copy.h5lesson', await host.driver.serialize(original.model))
    const { result, ports } = await mount(host, {
      beforeReplace: vi.fn(() => decision.promise),
      // Authoring generation belongs to the view and can coincide across document projections.
      captureIdentity: () => ({ ...host.identity(), sessionGeneration: 0 }),
    })
    let replacement!: Promise<boolean>
    act(() => { replacement = result.current.newProject() })
    await waitFor(() => expect(ports.beforeReplace).toHaveBeenCalledOnce())
    await host.documents.open('same-project-copy.h5lesson')
    const latest = host.read()
    await act(async () => { decision.resolve(true); expect(await replacement).toBe(false) })
    expect(host.read()).toEqual(latest)
    expect(host.registry.get(original.documentId).read()).toEqual(original)
    expect(host.registry.list()).toHaveLength(2)
    expect(ports.confirmDiscardChanges).not.toHaveBeenCalled()
  })

  it('allows preparation to commit a same-session draft before switching and retains its acknowledged version', async () => {
    const host = await createCourseDocumentHost()
    const originalId = host.read().documentId
    const { result } = await mount(host, {
      beforeReplace: async () => (await host.editTitle('flushed temporary input')).status === 'applied',
    })
    await act(async () => { expect(await result.current.newFlowProject()).toBe(true) })
    expect(host.read().documentId).not.toBe(originalId)
    expect(host.registry.get(originalId).read()).toMatchObject({
      revision: 1, dirty: true, undoDepth: 1, model: { project: { title: 'flushed temporary input' } },
    })
  })

  it('keeps the active dirty session if main cannot open a file or persist a new session', async () => {
    const host = await createCourseDocumentHost()
    await host.editTitle('retained through failures')
    const before = host.read()
    const { result, ports } = await mount(host)
    await act(async () => { expect(await result.current.openRecentProject('missing.h5lesson')).toBe(false) })
    host.controls.beforeAppend = async () => { throw new Error('Journal unavailable') }
    await act(async () => { expect(await result.current.newProject()).toBe(false) })
    expect(host.read()).toEqual(before)
    expect(host.registry.list()).toHaveLength(1)
    expect(ports.reportError).toHaveBeenCalledTimes(2)
    expect(ports.onProjectReplaced).not.toHaveBeenCalled()
    expect(ports.confirmDiscardChanges).not.toHaveBeenCalled()
  })

  it('leaves recovery journals for the unified workspace entry instead of choosing the first course', async () => {
    const host = await createCourseDocumentHost()
    await host.editTitle('retained recovery')
    const crashedId = host.read().documentId
    await host.restart()
    const active = host.read()
    await mount(host)
    expect(host.durable.has(crashedId)).toBe(true)
    expect(host.read()).toEqual(active)
  })

  it('waits for a real pending main ACK before allowing preserve-and-close', async () => {
    const host = await createCourseDocumentHost(), entered = deferred(), release = deferred()
    let close!: () => Promise<boolean>
    const preserve = vi.fn(async () => true)
    await mount(host, { preserveBeforeClose: preserve, subscribePreserveAndCloseRequest: handler => { close = handler; return () => undefined } })
    host.controls.beforeAppend = async () => { entered.resolve(); await release.promise }
    const edit = host.editTitle('pending before closing')
    await entered.promise
    let settled = false
    const closing = close().then(value => { settled = true; return value })
    await Promise.resolve()
    expect(settled).toBe(false); expect(preserve).not.toHaveBeenCalled()
    release.resolve()
    expect((await edit).status).toBe('applied')
    expect(await closing).toBe(true)
    expect(preserve).toHaveBeenCalledOnce()
    expect(host.durable.get(host.read().documentId)?.model).toMatchObject({ project: { title: 'pending before closing' } })
  })
})
