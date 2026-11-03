import { afterEach, expect, it, vi } from 'vitest'
import { createCourseDocumentHost, deferred } from '../helpers/courseDocumentHost'
import { useEditorStore } from '../../src/renderer/store/editorStore'

const store = () => useEditorStore.getState()
const dispose: Array<() => void> = []
afterEach(() => { vi.restoreAllMocks(); store().courseBridge.dispose(); dispose.splice(0).forEach(stop => stop()) })

async function fixture() {
  const host = await createCourseDocumentHost()
  dispose.push(() => host.bridge.dispose())
  await host.seedFile('retained.glx', 'Explicitly opened file')
  await store().connectCourseDocuments(host.api)
  return host
}

it('admits an explicitly requested GLX after draft preparation when only its foreground expires', async () => {
  const host = await fixture(), entered = deferred(), release = deferred()
  const before = store().courseView
  let foreground = true
  const prepare = store().courseInputs.prepare.bind(store().courseInputs)
  vi.spyOn(store().courseInputs, 'prepare').mockImplementationOnce(async (...args) => {
    const prepared = await prepare(...args); entered.resolve(); await release.promise; return prepared
  })
  const opening = store().openCourseDocument('retained.glx', () => foreground, () => true)
  await entered.promise; foreground = false; release.resolve()
  const opened = await opening
  expect(opened).toMatchObject({ activated: false })
  const target = host.registry.list().find(value => value.binding.kind === 'file' && value.binding.path === 'retained.glx')
  expect(target).toBeDefined()
  expect(store().courseView.documents.some(value => value.documentId === target!.documentId)).toBe(true)
  expect(store().courseView.activeDocumentId).toBe(before.activeDocumentId)
  expect(host.registry.get(before.activeDocumentId!).read()).toEqual(before.snapshot)
})

it('does not admit that file after leaving its originating workspace during draft preparation', async () => {
  const host = await fixture(), entered = deferred(), release = deferred()
  let inWorkspace = true
  const prepare = store().courseInputs.prepare.bind(store().courseInputs)
  vi.spyOn(store().courseInputs, 'prepare').mockImplementationOnce(async (...args) => {
    const prepared = await prepare(...args); entered.resolve(); await release.promise; return prepared
  })
  const open = vi.spyOn(host.api, 'open')
  const opening = store().openCourseDocument('retained.glx', () => false, () => inWorkspace)
  await entered.promise; inWorkspace = false; release.resolve()
  expect(await opening).toBe(false)
  expect(open).not.toHaveBeenCalled()
  expect(store().courseView.documents).toHaveLength(1)
})

it('keeps the legacy foreground-only admission guard for dialog-driven callers', async () => {
  const host = await fixture(), open = vi.spyOn(host.api, 'open')
  expect(await store().openCourseDocument('retained.glx', () => false)).toBe(false)
  expect(open).not.toHaveBeenCalled()
})
