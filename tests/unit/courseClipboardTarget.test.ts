import { afterEach, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import { createV10StoreHost, deferred } from '../helpers/courseV10StoreHost'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { courseAuthorData } from '../../src/core/course/courseElementInsertion'
import { TEXT_DEFINITION, createTextData } from '../../src/components/text'
import { createCrossSurfaceCommands, COURSE_OBJECT_CLIPBOARD_MIME, type CrossSurfaceCommandPorts } from '../../src/renderer/composition/crossSurfaceCommands'
import { COURSE_OBJECT_CLIPBOARD_COMMAND_EVENT } from '../../src/shared/ipcTypes'
import { createCourseStructureSlice } from '../../src/renderer/store/slices/courseStructureSlice'
import { createCourseLifecycleSlice } from '../../src/renderer/store/slices/courseLifecycleSlice'

function project(title: string) {
  const value = createBlankCourseProjectV10(title)
  value.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
  value.instances.text = { id: 'text', definitionId: TEXT_DEFINITION.id, data: courseAuthorData(createTextData(title)),
    frame: { width: 200, height: 80, transform: [1, 0, 0, 1, 20, 20] } }
  value.surfaces[0].childIds.push('text')
  return value
}

function data() {
  const values = new Map<string, string>()
  return { clearData: () => values.clear(), setData: (type: string, value: string) => values.set(type, value),
    getData: (type: string) => values.get(type) ?? '' } as unknown as DataTransfer
}

function emitNative(command: 'copy' | 'cut', clipboardData = data()) {
  const event = new Event(command, { cancelable: true, bubbles: true })
  Object.defineProperty(event, 'clipboardData', { value: clipboardData })
  window.dispatchEvent(event)
  return clipboardData
}

function relay(command: string, requestId?: string) {
  const detail = { command, requestId, handled: false, ok: false, reason: '' }
  window.dispatchEvent(new CustomEvent(COURSE_OBJECT_CLIPBOARD_COMMAND_EVENT, { detail }))
  if (!detail.handled || !detail.ok) throw new Error(detail.reason || 'request owner unavailable')
  return detail
}

const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand')
afterEach(() => {
  if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand)
  else Reflect.deleteProperty(document, 'execCommand')
  vi.restoreAllMocks()
})

async function fixture(requestClipboard: CrossSurfaceCommandPorts['requestClipboard']) {
  const host = await createV10StoreHost(project('A')), feedback = vi.fn()
  const kernel = { ...host.kernel, setFeedback: feedback }
  kernel.selectInstances(['text'])
  const ports: CrossSurfaceCommandPorts = { kernel, slide: {}, flow: {}, spatial: {},
    shell: { read: () => ({ canvasMode: 'edit', editingTextNodeId: null }), patch() {} },
    structure: createCourseStructureSlice(kernel, { readActiveLocationId: () => kernel.readView().surfaceId }),
    lifecycle: createCourseLifecycleSlice(kernel, { bridge: host.bridge,
      read: () => ({ projectPath: null, dirty: host.first.read().dirty }), patch() {} }), requestClipboard }
  const commands = createCrossSurfaceCommands(ports)
  // Production's bubbling listener reads live state only for native shortcuts.
  const native = (event: Event) => {
    if (!event.defaultPrevented && commands.copyCourseClipboard((event as ClipboardEvent).clipboardData, event.type === 'cut')) event.preventDefault()
  }
  window.addEventListener('copy', native)
  window.addEventListener('cut', native)
  const exec = vi.fn((command: string) => { emitNative(command as 'copy' | 'cut'); return true })
  Object.defineProperty(document, 'execCommand', { configurable: true, value: exec })
  return { ...host, commands, feedback, exec,
    async selectB() {
      await host.bridge.create({ kind: 'course-v10', project: project('B'), resources: { assets: {}, components: {} } })
      kernel.selectInstances(['text'])
      return host.bridge.read().snapshot!
    },
    stop() { window.removeEventListener('copy', native); window.removeEventListener('cut', native); host.bridge.dispose() },
  }
}

it('cancels a delayed cut after selecting B, leaving both courses intact', async () => {
  const entered = deferred(), release = deferred()
  const h = await fixture(async (command, requestId) => { entered.resolve(); await release.promise; relay(command, requestId) })
  try {
    h.commands.cutSelectedNodes()
    await entered.promise
    const b = await h.selectB()
    release.resolve()
    await waitFor(() => expect(h.feedback).toHaveBeenCalledWith(expect.objectContaining({ errorMessage: '剪贴板命令的文档或选择已改变，已取消操作' })))
    expect(h.exec).not.toHaveBeenCalled()
    expect(h.model().project.instances.text).toBeDefined()
    expect(h.registry.get(b.documentId).read()).toEqual(b)
    expect(h.first.read().undoDepth).toBe(0)
  } finally { h.stop() }
})

it('cancels a delayed cut when the original object selection changes', async () => {
  const entered = deferred(), release = deferred()
  const h = await fixture(async (command, requestId) => { entered.resolve(); await release.promise; relay(command, requestId) })
  try {
    h.commands.cutSelectedNodes()
    await entered.promise
    h.kernel.selectInstances([])
    release.resolve()
    await waitFor(() => expect(h.feedback).toHaveBeenCalledWith(expect.objectContaining({ errorMessage: expect.stringContaining('选择已改变') })))
    expect(h.exec).not.toHaveBeenCalled()
    expect(h.model().project.instances.text).toBeDefined()
  } finally { h.stop() }
})

it('correlates adjacent copy and cut requests, then pastes the cut identity through the same canonical History', async () => {
  const requests: Array<{ command: string; requestId?: string; release: ReturnType<typeof deferred> }> = []
  const h = await fixture(async (command, requestId) => {
    const release = deferred(); requests.push({ command, requestId, release })
    await release.promise; relay(command, requestId)
  })
  const markers: DataTransfer[] = []
  h.exec.mockImplementation(command => { const marker = emitNative(command as 'copy' | 'cut'); markers.push(marker); return true })
  try {
    h.commands.copySelectedNodes(); h.commands.cutSelectedNodes()
    await waitFor(() => expect(requests).toHaveLength(2))
    const unrelated = { command: 'cut', requestId: 'foreign', handled: false, ok: false, reason: '' }
    window.dispatchEvent(new CustomEvent(COURSE_OBJECT_CLIPBOARD_COMMAND_EVENT, { detail: unrelated }))
    expect(unrelated.handled).toBe(false)
    requests[0].release.resolve()
    await waitFor(() => expect(markers).toHaveLength(1))
    requests[1].release.resolve()
    await waitFor(() => expect(h.model().project.instances.text).toBeUndefined())
    expect(markers).toHaveLength(2)
    expect(markers[0].getData(COURSE_OBJECT_CLIPBOARD_MIME)).not.toBe(markers[1].getData(COURSE_OBJECT_CLIPBOARD_MIME))
    expect(h.first.read().undoDepth).toBe(1)
    expect(h.commands.pasteCourseClipboard(markers[1])).toBe(true)
    await waitFor(() => expect(h.model().project.instances.text).toBeDefined())
    expect(h.first.read().undoDepth).toBe(2)
    await h.bridge.undo()
    expect(h.model().project.instances.text).toBeUndefined()
    await h.bridge.undo()
    expect(h.model().project.instances.text).toBeDefined()
    expect(h.feedback).not.toHaveBeenCalled()
  } finally { h.stop() }
})

it.each([false, true])('releases a native listener when execCommand returns %s without an event, so the next native cut works', async returned => {
  const h = await fixture(async (command, requestId) => { relay(command, requestId) })
  h.exec.mockImplementation(() => returned)
  try {
    h.commands.cutSelectedNodes()
    await waitFor(() => expect(h.feedback).toHaveBeenCalledWith(expect.objectContaining({ errorMessage: '系统剪贴板命令未完成，请重试' })))
    const b = await h.selectB()
    emitNative('cut')
    await waitFor(() => expect(h.registry.get(b.documentId).read().model).toMatchObject({ project: { surfaces: [{ childIds: [] }] } }))
    expect(h.model().project.instances.text).toBeDefined()
    expect(h.first.read().undoDepth).toBe(0)
  } finally { h.stop() }
})

it('releases the matching request listener when IPC refuses before dispatch', async () => {
  let refusedId: string | undefined
  const h = await fixture(async (_command, requestId) => { refusedId = requestId; throw new Error('IPC refused') })
  try {
    h.commands.cutSelectedNodes()
    await waitFor(() => expect(h.feedback).toHaveBeenCalledWith(expect.objectContaining({ errorMessage: 'IPC refused' })))
    const late = { command: 'cut', requestId: refusedId, handled: false, ok: false, reason: '' }
    window.dispatchEvent(new CustomEvent(COURSE_OBJECT_CLIPBOARD_COMMAND_EVENT, { detail: late }))
    expect(late.handled).toBe(false)
    expect(h.exec).not.toHaveBeenCalled()
    expect(h.model().project.instances.text).toBeDefined()
  } finally { h.stop() }
})
