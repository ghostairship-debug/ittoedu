// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { WEB_DEFINITION } from '../../src/components/web/data'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import { registerRuntimeLightEditDocument } from '../../src/renderer/composition/runtime/runtimeLightEditCommands'
import { RuntimePageTextList } from '../../src/renderer/workbench/RuntimePageText'
import type { ComponentAuthorSpot } from '../../src/shared/contracts/component-platform'
import type { ComponentPlatformRuntime } from '../../src/player/components/ComponentPlatformRuntime'
import type { DocumentHostAPI } from '../../src/shared/workbench/desktop'

const dispose: (() => Promise<unknown> | void)[] = []
afterEach(async () => { cleanup(); for (const stop of dispose.splice(0).reverse()) await stop(); vi.restoreAllMocks() })

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-text-consumer-'))
  // Only this fixture's allocated directory is removed, after its bridge and world close.
  dispose.push(() => fs.rm(root, { recursive: true, force: true }))
  const host = new DocumentHostService(root), project = createBlankCourseProjectV10('页面文字')
  project.definitions[WEB_DEFINITION.id] = WEB_DEFINITION
  const html = '<p id="first">同一文字</p><p id="second">同一文字</p><script>window.laterCopy = ["后来出现"];</script>'
  const spots: ComponentAuthorSpot[] = ['first', 'second'].map((id, index) => ({ id, instanceId: 'web', kind: 'text', mountGeneration: 1,
    authorKey: id, bindingStatus: 'bound', binding: { kind: 'dom', path: [{ tag: 'p', index, attributes: { id } }], baseline: '同一文字' },
    initialValue: '同一文字', localBounds: { width: 200, height: 30, transform: [1, 0, 0, 1, 0, index * 40] } }))
  project.instances.web = { id: 'web', definitionId: WEB_DEFINITION.id, data: JSON.parse(JSON.stringify({ html,
    authoringRecords: Object.fromEntries(spots.map(spot => [spot.authorKey!, { kind: 'text', binding: spot.binding!, overrides: { text: '同一文字' } }])) })) }
  project.surfaces[0].childIds = ['web']
  const snapshot = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'text.h5lesson')
  let release = () => {}, entered = () => {}, delayed = false
  const unavailable = async (): Promise<never> => { throw new Error('Outside Runtime text fixture') }
  const api: DocumentHostAPI = { ...host.internalAPI, bootstrapCourse: async () => snapshot, subscribe: host.subscribeEvents.bind(host),
    saveWithDialog: unavailable, closeWithDialog: unavailable, close: unavailable, discardRecovery: unavailable,
    dispatch: async input => {
      if (delayed) { entered(); await new Promise<void>(resolve => { release = resolve }) }
      return host.internalAPI.dispatch(input)
    } }
  await useEditorStore.getState().connectCourseDocuments(api)
  const bridge = useEditorStore.getState().courseBridge
  dispose.push(() => bridge.dispose())
  const listeners = new Set<() => void>()
  // The observed mount supplies real typed spots; the text owner, bridge, Session,
  // author-record planner and disk journal are production implementations.
  const world = { authorSpots: () => {
    const model = host.registry.get(snapshot.documentId).read().model
    if (model.kind !== 'course-v10') throw new Error('Expected V10')
    const records = (model.project.instances.web.data as { authoringRecords: Record<string, { overrides: { text: string } }> }).authoringRecords
    return spots.map(spot => ({ ...spot, initialValue: records[spot.authorKey!].overrides.text }))
  }, subscribeAuthorSpots: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } } } as unknown as ComponentPlatformRuntime
  dispose.push(registerRuntimeLightEditDocument(snapshot.documentId, world, bridge))
  dispose.push(host.subscribeEvents(() => { for (const listener of listeners) listener() }))
  const onError = vi.fn()
  render(<RuntimePageTextList itemId="web" onError={onError} />)
  return { host, bridge, snapshot, onError, html,
    delay: () => { delayed = true; return new Promise<void>(resolve => { entered = resolve }) }, release: () => { delayed = false; release() } }
}

it('connects the live Runtime page-copy panel to source states and one real rule ACK/Undo without rewriting its source', async () => {
  const value = await fixture(), fields = screen.getAllByRole('textbox', { name: '页面文字：同一文字' })
  expect(fields).toHaveLength(1)
  expect(screen.getByRole('textbox', { name: '页面文字：后来出现' })).toHaveValue('后来出现')
  fireEvent.focus(fields[0]); fireEvent.change(fields[0], { target: { value: '全部同文修改' } })
  const pending = value.delay()
  fireEvent.keyDown(fields[0], { key: 'Enter' })
  await pending
  expect(fields[0]).toBeDisabled(); expect(fields[0]).toHaveValue('全部同文修改')
  expect(value.host.registry.get(value.snapshot.documentId).read().undoDepth).toBe(0)
  await act(async () => value.release())
  await waitFor(() => expect(fields[0]).not.toBeDisabled())
  const saved = value.host.registry.get(value.snapshot.documentId).read()
  expect(saved.undoDepth).toBe(1)
  if (saved.model.kind !== 'course-v10') throw new Error('Expected V10')
  expect(saved.model.project.instances.web.data).toMatchObject({ html: value.html,
    textOverrides: [{ original: '同一文字', text: '全部同文修改' }],
    authoringRecords: { first: { overrides: { text: '同一文字' } }, second: { overrides: { text: '同一文字' } } } })
  expect(value.onError).not.toHaveBeenCalled()
  await act(async () => value.bridge.undo(value.snapshot.documentId))
  const restored = value.host.registry.get(value.snapshot.documentId).read()
  if (restored.model.kind !== 'course-v10') throw new Error('Expected V10')
  expect(restored.model.project.instances.web.data).toMatchObject({ html: value.html,
    authoringRecords: { first: { overrides: { text: '同一文字' } }, second: { overrides: { text: '同一文字' } } } })
})

it('retains the frozen page-copy draft when a human changes that exact rule before blur, with no stale write or extra History', async () => {
  const value = await fixture(), field = screen.getByRole('textbox', { name: '页面文字：同一文字' })
  fireEvent.focus(field); fireEvent.change(field, { target: { value: '迟到的草稿' } })
  await act(async () => value.bridge.edit([{ type: 'data.set', instanceId: 'web', path: ['textOverrides'], value: [{ original: '同一文字', text: '人工更新' }] }]))
  fireEvent.blur(field)
  await waitFor(() => expect(value.onError).toHaveBeenCalled())
  expect(field).toHaveValue('迟到的草稿'); expect(field).not.toBeDisabled()
  const current = value.host.registry.get(value.snapshot.documentId).read()
  expect(current.undoDepth).toBe(1)
  if (current.model.kind !== 'course-v10') throw new Error('Expected V10')
  expect(current.model.project.instances.web.data).toMatchObject({ textOverrides: [{ original: '同一文字', text: '人工更新' }] })
})
