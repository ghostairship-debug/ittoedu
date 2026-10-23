// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { createV10StoreHost, deferred } from '../helpers/courseV10StoreHost'
import { nestedFlowSizingFixture } from '../helpers/nestedFlowSizingFixture'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'

const dispose: Array<() => void> = []
afterEach(() => { dispose.splice(0).forEach(work => work()); vi.restoreAllMocks() })
async function fixture(project = nestedFlowSizingFixture()) {
  const h = await createV10StoreHost(project)
  dispose.push(() => h.bridge.dispose())
  return h
}
const model = () => ({ kind: 'course-v10' as const, project: createBlankCourseProjectV10('Late Main result'), resources: { assets: {}, components: {} } })
async function savedOpenTarget(h: Awaited<ReturnType<typeof fixture>>) {
  const snapshot = await h.api.create(model(), 'late.glx')
  await h.api.save(snapshot.documentId, 'late.glx')
  await h.api.close(snapshot.documentId, true)
}

it.each(['create', 'open'] as const)('keeps a completed %s attached in the background after foreground ownership expires', async kind => {
  const h = await fixture(), started = deferred(), release = deferred(), before = h.bridge.read()
  let created: DocumentSnapshot | undefined, foreground = true
  if (kind === 'open') await savedOpenTarget(h)
  if (kind === 'create') {
    const create = h.api.create.bind(h.api)
    vi.spyOn(h.api, 'create').mockImplementationOnce(async (...args) => {
      created = await create(...args); started.resolve(); await release.promise; return created
    })
  } else {
    const open = h.api.open.bind(h.api)
    vi.spyOn(h.api, 'open').mockImplementationOnce(async path => {
      created = await open(path); started.resolve(); await release.promise; return created
    })
  }
  const pending = kind === 'create' ? h.bridge.create(model(), () => foreground) : h.bridge.open('late.glx', () => foreground)
  await started.promise; foreground = false; release.resolve()
  expect(await pending).toEqual({ documentId: created!.documentId, activated: false })
  expect(h.bridge.read().documents.some(value => value.documentId === created!.documentId)).toBe(true)
  expect(h.bridge.read().activeDocumentId).toBe(before.activeDocumentId)
  expect(h.bridge.read().activation).toBe(before.activation)
  expect(h.bridge.read().surfaceId).toBe(before.surfaceId)
  expect(h.first.read().undoDepth).toBe(0)
})

it('checks foreground ownership after the attachment read as well as after the Main create', async () => {
  const h = await fixture(), started = deferred(), release = deferred(), before = h.bridge.read()
  const read = h.api.read.bind(h.api)
  let foreground = true
  vi.spyOn(h.api, 'read').mockImplementation(async id => {
    const snapshot = await read(id)
    if (id !== before.activeDocumentId) { started.resolve(); await release.promise }
    return snapshot
  })
  const pending = h.bridge.create(model(), () => foreground)
  await started.promise; foreground = false; release.resolve()
  const result = await pending
  expect(result.activated).toBe(false)
  expect(result.documentId).not.toBe(before.activeDocumentId)
  expect(h.bridge.read().documents).toHaveLength(2)
  expect(h.bridge.read().activeDocumentId).toBe(before.activeDocumentId)
  expect(h.bridge.read().activation).toBe(before.activation)
})

it('does not override a newer container activation while Main creation is pending', async () => {
  const h = await fixture(), started = deferred(), release = deferred(), documentId = h.bridge.read().activeDocumentId!
  const create = h.api.create.bind(h.api)
  vi.spyOn(h.api, 'create').mockImplementationOnce(async (...args) => {
    const snapshot = await create(...args); started.resolve(); await release.promise; return snapshot
  })
  const pending = h.bridge.create(model(), () => true)
  await started.promise
  h.bridge.enterContainer(documentId, 'child')
  const current = h.bridge.read()
  release.resolve(); expect((await pending).activated).toBe(false)
  expect(h.bridge.read()).toMatchObject({ activeDocumentId: documentId, activation: current.activation, editingContainerId: 'child' })
  expect(h.bridge.read().documents).toHaveLength(2)
})

it('keeps ordinary unguarded creation and guarded opening foreground behavior', async () => {
  const h = await fixture()
  await savedOpenTarget(h)
  const before = h.bridge.read().activeDocumentId
  const created = await h.bridge.create(model())
  const createdId = h.bridge.read().activeDocumentId
  expect(created).toEqual({ documentId: createdId, activated: true })
  expect(createdId).not.toBe(before)
  const opened = await h.bridge.open('late.glx', () => true)
  expect(opened).toEqual({ documentId: h.bridge.read().activeDocumentId, activated: true })
  expect(h.bridge.read().activeDocumentId).not.toBe(createdId)
  expect(h.bridge.read().documents).toHaveLength(3)
  expect(h.bridge.read().error).toBeNull()
})

it('checks an explicit focus predicate after its attachment read without altering unguarded activation', async () => {
  const h = await fixture(), started = deferred(), release = deferred(), before = h.bridge.read()
  const other = await h.api.create(model(), 'focus.glx'), read = h.api.read.bind(h.api)
  let foreground = true
  const pendingRead = vi.spyOn(h.api, 'read').mockImplementation(async id => {
    const snapshot = await read(id)
    if (id === other.documentId) { started.resolve(); await release.promise }
    return snapshot
  })
  const focusing = h.bridge.activate(other.documentId, () => foreground)
  await started.promise; foreground = false; release.resolve(); await focusing
  expect(h.bridge.read().activeDocumentId).toBe(before.activeDocumentId)
  expect(h.bridge.read().documents).toHaveLength(2)
  pendingRead.mockRestore()
  await h.bridge.activate(other.documentId)
  expect(h.bridge.read().activeDocumentId).toBe(other.documentId)
})

it.each([['create', 'surface'], ['open', 'state'], ['create', 'selection']] as const)(
  'keeps an ordinary %s result in the background after the current %s changes without an activation change', async (kind, changed) => {
    const project = nestedFlowSizingFixture()
    project.instances.next = { id: 'next', definitionId: 'slide', data: {}, childIds: [],
      container: { kind: 'slide', presentation: { states: [{ id: 'named', title: 'Named state', overrides: {} }] } } }
    project.rootIds.push('next')
    const h = await fixture(project), started = deferred(), release = deferred(), documentId = h.bridge.read().activeDocumentId!
    if (changed === 'state') h.bridge.selectSurface(documentId, 'next')
    if (kind === 'open') await savedOpenTarget(h)
    const before = h.bridge.read()
    if (kind === 'create') {
      const create = h.api.create.bind(h.api)
      vi.spyOn(h.api, 'create').mockImplementationOnce(async (...args) => {
        const snapshot = await create(...args); started.resolve(); await release.promise; return snapshot
      })
    } else {
      const open = h.api.open.bind(h.api)
      vi.spyOn(h.api, 'open').mockImplementationOnce(async path => {
        const snapshot = await open(path); started.resolve(); await release.promise; return snapshot
      })
    }
    const pending = kind === 'create' ? h.bridge.create(model()) : h.bridge.open('late.glx')
    await started.promise
    if (changed === 'surface') h.bridge.selectSurface(documentId, 'next')
    else if (changed === 'state') h.bridge.selectPresentationState(documentId, 'named', 'next')
    else h.bridge.selectInstances(documentId, ['after'])
    const current = h.bridge.read()
    expect(current.activation).toBe(before.activation)
    release.resolve()
    const result = await pending
    expect(result.activated).toBe(false)
    expect(h.bridge.read().documents.some(value => value.documentId === result.documentId)).toBe(true)
    expect(h.bridge.read()).toMatchObject({ activeDocumentId: documentId, activation: current.activation,
      surfaceId: current.surfaceId, activeStateId: current.activeStateId, selectedInstanceIds: current.selectedInstanceIds })
    expect(h.bridge.read().documents).toHaveLength(2)
    expect(h.first.read().undoDepth).toBe(0)
  },
)

it('still activates the first created course when there was no original foreground document', async () => {
  const h = await createV10StoreHost(nestedFlowSizingFixture(), undefined, false)
  dispose.push(() => h.bridge.dispose())
  vi.spyOn(h.api, 'list').mockResolvedValueOnce([])
  await h.bridge.connect(h.api)
  expect(h.bridge.read().activeDocumentId).toBeNull()
  const result = await h.bridge.create(model())
  expect(result).toEqual({ documentId: h.bridge.read().activeDocumentId, activated: true })
  expect(h.bridge.read().project!.title).toBe('Late Main result')
  expect(h.bridge.read().documents).toHaveLength(1)
  expect(h.bridge.read().error).toBeNull()
})

it('reports a completed old-host creation as background when the Renderer host was replaced', async () => {
  const h = await fixture(), started = deferred(), release = deferred(), create = h.api.create.bind(h.api)
  const next = await createV10StoreHost(createBlankCourseProjectV10('New host'))
  dispose.push(() => next.bridge.dispose())
  vi.spyOn(h.api, 'create').mockImplementationOnce(async (...args) => {
    const snapshot = await create(...args); started.resolve(); await release.promise; return snapshot
  })
  const pending = h.bridge.create(model())
  await started.promise; await h.bridge.connect(next.api)
  const foreground = h.bridge.read()
  release.resolve()
  const result = await pending
  expect(result.activated).toBe(false)
  expect(h.registry.get(result.documentId).read().model).toMatchObject({ kind: 'course-v10', project: { title: 'Late Main result' } })
  expect(h.bridge.read()).toMatchObject({ activeDocumentId: foreground.activeDocumentId, activation: foreground.activation,
    project: { title: 'New host' } })
})

it('captures a read-only view scope before a caller claims navigation, with no original document restriction', async () => {
  const h = await createV10StoreHost(nestedFlowSizingFixture(), undefined, false)
  dispose.push(() => h.bridge.dispose())
  const emptyScope = h.bridge.captureViewScope()
  expect(emptyScope()).toBe(true)
  await h.bridge.connect(h.api)
  expect(emptyScope()).toBe(true)
  const read = vi.spyOn(h.api, 'read'), scope = h.bridge.captureViewScope(), started = deferred(), release = deferred()
  expect(scope()).toBe(true)
  expect(read).not.toHaveBeenCalled()
  const create = h.api.create.bind(h.api)
  vi.spyOn(h.api, 'create').mockImplementationOnce(async (...args) => {
    const snapshot = await create(...args); started.resolve(); await release.promise; return snapshot
  })
  const pending = h.bridge.create(model())
  await started.promise
  expect(scope()).toBe(true) // This caller's navigation claim is not a new course view.
  h.bridge.selectInstances(h.first.documentId, ['after'])
  expect(scope()).toBe(false)
  release.resolve()
  expect((await pending).activated).toBe(false)
})

it('returns the actual explicit activation result so a refused foreground cannot be projected as a successful focus', async () => {
  const h = await fixture(), before = h.bridge.read(), other = await h.api.create(model(), 'focus-result.glx')
  expect(await h.bridge.activate(other.documentId, () => false)).toBe(false)
  expect(h.bridge.read().activeDocumentId).toBe(before.activeDocumentId)
  expect(h.bridge.read().documents.some(value => value.documentId === other.documentId)).toBe(true)
  expect(await h.bridge.activate(other.documentId, () => true)).toBe(true)
  expect(h.bridge.read().activeDocumentId).toBe(other.documentId)
})
