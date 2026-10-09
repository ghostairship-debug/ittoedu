import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  useCourseProjectLifecycle,
  type CourseProjectLifecyclePorts,
  type CourseProjectLifecycleWatch,
} from '../../src/renderer/app/useCourseProjectLifecycle'
import { createCourseDocumentHost, deferred, type CourseDocumentTestHost } from '../helpers/courseDocumentHost'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import type { ComponentFrame } from '../../src/shared/contracts/component-platform/frame'
import { APP_NAME } from '../../src/shared/constants'

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
  it('keeps the browser title fixed while forwarding actual dirty state to main', async () => {
    const host = await createCourseDocumentHost()
    const ports = createPorts(host)
    const watch = { ...WATCH }
    const hook = renderHook(() => useCourseProjectLifecycle(ports, watch))
    await waitFor(() => expect(ports.setWindowDirtyState).toHaveBeenLastCalledWith(false))
    expect(document.title).toBe(APP_NAME)

    watch.projectTitle = '另一个工程名'
    watch.dirty = true
    hook.rerender()
    await waitFor(() => expect(ports.setWindowDirtyState).toHaveBeenLastCalledWith(true))
    expect(document.title).toBe(APP_NAME)

    watch.projectTitle = '未命名工程'
    watch.dirty = false
    hook.rerender()
    await waitFor(() => expect(ports.setWindowDirtyState).toHaveBeenLastCalledWith(false))
    expect(document.title).toBe(APP_NAME)
  })
  it.each([
    ['newProject', 'slide'], ['newFlowProject', 'flow'], ['newSpatialProject', 'spatial'],
  ] as const)('%s creates its real surface in a separate main session', async (method, kind) => {
    const host = await createCourseDocumentHost()
    await host.editTitle('old draft')
    const previous = host.read()
    const { result, ports } = await mount(host)
    await act(async () => { expect(await result.current[method]()).toBe(true) })
    const current = host.read()
    expect(current.documentId).not.toBe(previous.documentId)
    expect(current).toMatchObject({ binding: { kind: 'untitled' }, dirty: true, undoDepth: 0 })
    expect(current.model).toMatchObject({ kind: 'course-v10', project: { schemaVersion: 10, surfaces: [{ kind }] } })
    expect(current.epoch).not.toBe(previous.epoch)
    expect(host.registry.get(previous.documentId).read()).toEqual(previous)
    expect(ports.onProjectReplaced).toHaveBeenCalledOnce()
  })

  it('M21 newProjectFrom opens content built first (e.g. from a PPT) as a separate untitled document', async () => {
    const host = await createCourseDocumentHost()
    const previous = host.read()
    const { result, ports } = await mount(host)
    const project = createBlankCourseProjectV10('第一课')
    await act(async () => { expect(await result.current.newProjectFrom(async () => ({ project, resources: { assets: {}, components: {} } }), { origin: 'lesson' })).toBe(true) })
    const current = host.read()
    expect(current.documentId).not.toBe(previous.documentId)
    expect(current).toMatchObject({ binding: { kind: 'untitled', suggestedName: '第一课.glx' }, dirty: true, undoDepth: 0 })
    expect(current.model).toMatchObject({ project: { title: '第一课' } })
    expect(host.registry.get(previous.documentId).read()).toEqual(previous)
    // Made from the work area: the lesson stays attached.
    expect(ports.onProjectReplaced).not.toHaveBeenCalled()
    // Content that cannot be built (an unreadable PPT) leaves the open document as it was.
    await act(async () => { expect(await result.current.newProjectFrom(async () => { throw new Error('PPTX 无法导入') })).toBe(false) })
    expect(host.read().documentId).toBe(current.documentId)
    expect(ports.reportError).toHaveBeenCalledWith('PPTX 无法导入')
  })

  it('opens the chosen path through main and reselects the same live History for recent opens', async () => {
    const host = await createCourseDocumentHost()
    await host.editTitle('retained before open')
    const previous = host.read()
    await host.seedFile('chosen.h5lesson', 'disk course')
    const { result, ports } = await mount(host, {
      openProjectFile: vi.fn(async () => ({ path: 'chosen.h5lesson', name: 'chosen.h5lesson', confirmationId: 'chosen', bytes: new Uint8Array([0]) })),
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
  })

  it('keeps instance identity and manual frame through formal History, save and a cold reopen', async () => {
    const host = await createCourseDocumentHost()
    const initial = host.read()
    if (initial.model.kind !== 'course-v10') throw new Error('Expected a V10 fixture')
    const instanceId = initial.model.project.global.overlay[0]
    if (!instanceId) throw new Error('Expected the default controller instance')
    const original = initial.model.project.instances[instanceId]
    const frame: ComponentFrame = { width: 333, height: 111, transform: [1, 0, 0, 1, 82, 47] }
    const { result } = await mount(host)
    await act(async () => {
      expect((await host.bridge.edit([{ type: 'frame.set', instanceId, frame }])).status).toBe('applied')
    })
    expect(host.read()).toMatchObject({ documentId: initial.documentId, epoch: initial.epoch, undoDepth: 1, dirty: true,
      model: { project: { instances: { [instanceId]: { id: instanceId, definitionId: original.definitionId, frame } } } } })
    await act(async () => { await host.bridge.undo() })
    expect(host.read()).toMatchObject({ undoDepth: 0, redoDepth: 1,
      model: { project: { instances: { [instanceId]: { frame: original.frame } } } } })
    await act(async () => { await host.bridge.redo() })
    expect(host.read()).toMatchObject({ undoDepth: 1, redoDepth: 0,
      model: { project: { instances: { [instanceId]: { frame } } } } })
    await act(async () => { expect(await result.current.saveProject()).toBe(true) })
    const saved = host.read()
    expect(saved).toMatchObject({ dirty: false, undoDepth: 1, binding: { kind: 'file', path: 'initial.h5lesson' } })
    await act(async () => { await host.restart(); await host.documents.open('initial.h5lesson') })
    const reopened = host.read()
    expect(reopened.documentId).not.toBe(initial.documentId)
    expect(reopened.epoch).not.toBe(initial.epoch)
    expect(reopened).toMatchObject({ revision: saved.revision, dirty: false, undoDepth: 0, redoDepth: 0,
      model: { kind: 'course-v10', project: { id: initial.model.project.id,
        instances: { [instanceId]: { id: instanceId, definitionId: original.definitionId, frame } } } } })
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
  })

  it('cancels a late switch when another main document with the same project identity becomes active', async () => {
    const host = await createCourseDocumentHost(), decision = deferred<boolean>()
    await host.editTitle('original retained draft')
    const original = host.read()
    host.disk.set('same-project-copy.h5lesson', await host.driver.serialize(original.model))
    const { result, ports } = await mount(host, {
      beforeReplace: vi.fn(() => decision.promise),
    })
    let replacement!: Promise<boolean>
    act(() => { replacement = result.current.newProject() })
    await waitFor(() => expect(ports.beforeReplace).toHaveBeenCalledOnce())
    await host.documents.open('same-project-copy.h5lesson')
    const latest = host.read()
    expect(latest.documentId).not.toBe(original.documentId)
    expect(latest.epoch).not.toBe(original.epoch)
    expect(host.identity().projectId).toBe(original.model.kind === 'course-v10' ? original.model.project.id : undefined)
    await act(async () => { decision.resolve(true); expect(await replacement).toBe(false) })
    expect(host.read()).toEqual(latest)
    expect(host.registry.get(original.documentId).read()).toEqual(original)
    expect(host.registry.list()).toHaveLength(2)
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
    const preserve = vi.fn(async () => { await host.documents.drain(); return true })
    await mount(host, { preserveBeforeClose: preserve, subscribePreserveAndCloseRequest: handler => { close = handler; return () => undefined } })
    host.controls.beforeAppend = async () => { entered.resolve(); await release.promise }
    const edit = host.editTitle('pending before closing')
    await entered.promise
    let settled = false
    const closing = close().then(value => { settled = true; return value })
    await Promise.resolve()
    expect(settled).toBe(false)
    release.resolve()
    expect((await edit).status).toBe('applied')
    expect(await closing).toBe(true)
    expect(preserve).toHaveBeenCalledOnce()
    expect(host.durable.get(host.read().documentId)?.model).toMatchObject({ project: { title: 'pending before closing' } })
  })
})
