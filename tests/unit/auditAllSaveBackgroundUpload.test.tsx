// @vitest-environment jsdom
import { setRootContainers } from '../helpers/glxWorkFixture'
import { componentSurfaces } from '../../src/shared/contracts/component-platform/project'
import { testContainerInstance } from '../helpers/glxWorkFixture'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { usePropertiesAuthoringBinding } from '../../src/renderer/composition/properties/usePropertiesAuthoringBinding'
import { PropertiesPanelRouter } from '../../src/renderer/ui/properties/PropertiesPanelRouter'
import { discardPropertiesDrafts, hasPropertiesDrafts, preservePropertiesDrafts } from '../../src/renderer/ui/properties/PropertyControls'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import { createV10StoreHost, deferred } from '../helpers/courseV10StoreHost'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'

const documentIds = new Set<string>()
afterEach(() => {
  cleanup()
  for (const id of documentIds) discardPropertiesDrafts(id)
  documentIds.clear()
  useEditorStore.getState().courseBridge.dispose()
  useEditorStore.setState({ slideContentEdit: null })
})
function BackgroundPanel() {
  return <PropertiesPanelRouter context={usePropertiesAuthoringBinding({ onReplaceImage() {} })} />
}
async function fixture(flow: boolean) {
  const project = createBlankCourseProjectV10()
  if (flow) { testContainerInstance(project, 0).container.kind = 'flow'; delete testContainerInstance(project, 0).container.designSize }
  const host = await createV10StoreHost(project, undefined, false)
  await useEditorStore.getState().connectCourseDocuments(host.api)
  const otherProject = createBlankCourseProjectV10()
  if (flow) { testContainerInstance(otherProject, 0).container.kind = 'flow'; delete testContainerInstance(otherProject, 0).container.designSize }
  // Copied/opened documents may share their scoped surface ID. This also keeps
  // the native file input mounted while the canonical document target changes.
  setRootContainers(otherProject, [{ ...componentSurfaces(otherProject)[0], id: componentSurfaces(project)[0].id }])
  const other = await host.api.create({ kind: 'course-v10', project: otherProject, resources: { assets: {}, components: {} } }, 'B.glx')
  documentIds.add(host.first.documentId); documentIds.add(other.documentId)
  const model = (id: string) => {
    const model = host.registry.get(id).read().model
    if (model.kind !== 'course-v10') throw new Error('expected course')
    return model
  }
  return { host, a: host.first.documentId, b: other.documentId, model,
    inputId: `${flow ? 'flow-surface' : 'scene'}-background-properties-asset-file-input` }
}
function delayedPng(input: HTMLInputElement) {
  const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='), character => character.charCodeAt(0))
  const gate = deferred(), file = new File([bytes], 'A.png', { type: 'image/png' })
  const read = vi.fn(async () => { await gate.promise; return bytes.slice().buffer })
  Object.defineProperty(file, 'arrayBuffer', { value: read })
  // JSDOM does not populate native fakepath. Observe the actual input clear call.
  let selectedValue = 'C:\\fakepath\\A.png'
  const clear = vi.fn((value: string) => { selectedValue = value })
  Object.defineProperty(input, 'value', { configurable: true, get: () => selectedValue, set: clear })
  fireEvent.change(input, { target: { files: [file] } })
  return { bytes, file, read, gate, clear, selectedValue: () => selectedValue }
}

it.each([false, true])('CA266 %s freezes A before PNG reading, commits only A and clears input after its ACK', async flow => {
  const f = await fixture(flow), ack = deferred()
  f.host.controls.after = async () => { await ack.promise }
  render(<BackgroundPanel />)
  const input = screen.getByTestId(f.inputId) as HTMLInputElement, selected = delayedPng(input)
  await waitFor(() => expect(selected.read).toHaveBeenCalledTimes(1))
  await act(async () => { await useEditorStore.getState().courseBridge.activate(f.b) })
  expect(selected.clear).not.toHaveBeenCalled()
  await act(async () => { selected.gate.resolve() })
  await waitFor(() => expect(Object.keys(f.model(f.a).resources.assets)).toHaveLength(1))
  expect(Object.keys(f.model(f.b).resources.assets)).toHaveLength(0)
  expect(f.host.operations.every(operation => operation.documentId === f.a)).toBe(true)
  expect(input.files?.[0]).toBe(selected.file)
  expect(selected.selectedValue()).toBe('C:\\fakepath\\A.png')
  expect(selected.clear).not.toHaveBeenCalled()
  await act(async () => { ack.resolve() })
  await waitFor(() => expect(selected.clear).toHaveBeenCalledExactlyOnceWith(''))
  expect(Array.from(Object.values(f.model(f.a).resources.assets)[0])).toEqual(Array.from(selected.bytes))
  expect(componentSurfaces(f.model(f.b).project)[0].background?.assetId ?? null).toBeNull()
  expect(hasPropertiesDrafts(f.a)).toBe(false)
})

it('CA266 early remount resumes the original pending PNG read and frozen A commit, clearing the recovered input only after ACK', async () => {
  const f = await fixture(false), ack = deferred()
  f.host.controls.after = async () => { await ack.promise }
  const first = render(<BackgroundPanel />)
  const selected = delayedPng(screen.getByTestId(f.inputId) as HTMLInputElement)
  await waitFor(() => expect(selected.read).toHaveBeenCalledTimes(1))
  expect(JSON.parse(preservePropertiesDrafts(f.a).find(record => record.label.endsWith(':图片上传'))!.raw))
    .toMatchObject({ name: 'A.png', bytes: null })
  first.unmount()
  render(<BackgroundPanel />)
  const recoveredInput = screen.getByTestId(f.inputId) as HTMLInputElement
  const recoveredClear = vi.fn()
  Object.defineProperty(recoveredInput, 'value', { configurable: true, get: () => '', set: recoveredClear })
  await screen.findByText('A.png：正在读取并上传…')
  expect(hasPropertiesDrafts(f.a)).toBe(true)
  expect(selected.read).toHaveBeenCalledTimes(1)
  expect(f.host.operations).toHaveLength(0)
  await act(async () => { await useEditorStore.getState().courseBridge.activate(f.b) })
  await act(async () => { selected.gate.resolve() })
  await waitFor(() => expect(Object.keys(f.model(f.a).resources.assets)).toHaveLength(1))
  expect(f.host.operations).toHaveLength(1)
  expect(f.host.operations[0].documentId).toBe(f.a)
  expect(Object.keys(f.model(f.b).resources.assets)).toHaveLength(0)
  expect(selected.read).toHaveBeenCalledTimes(1)
  expect(selected.clear).not.toHaveBeenCalled()
  expect(recoveredClear).not.toHaveBeenCalled()
  expect(hasPropertiesDrafts(f.a)).toBe(true)
  await act(async () => { ack.resolve() })
  await waitFor(() => expect(recoveredClear).toHaveBeenCalledExactlyOnceWith(''))
  expect(hasPropertiesDrafts(f.a)).toBe(false)
  expect(screen.queryByText('A.png：正在读取并上传…')).not.toBeInTheDocument()
  expect(Array.from(Object.values(f.model(f.a).resources.assets)[0])).toEqual(Array.from(selected.bytes))
  expect(componentSurfaces(f.model(f.b).project)[0].background?.assetId ?? null).toBeNull()
  expect(f.host.operations).toHaveLength(1)
})

it('CA266 rejects a real A background CAS change and retains the original File and recoverable PNG bytes', async () => {
  const f = await fixture(false), first = render(<BackgroundPanel />)
  const input = screen.getByTestId(f.inputId) as HTMLInputElement, selected = delayedPng(input)
  await waitFor(() => expect(selected.read).toHaveBeenCalledTimes(1))
  await act(async () => {
    await useEditorStore.getState().courseBridge.activate(f.b)
    const current = f.host.registry.get(f.a).read()
    await f.host.api.dispatch({ documentId: f.a, epoch: current.epoch, baseRevision: current.revision, operationId: 'external-background', actor: 'human',
      mutation: { type: 'command', command: captureComponentOperation(f.model(f.a).project,
        [{ type: 'surface.background.set', surfaceId: componentSurfaces(f.model(f.a).project)[0].id, background: { mode: 'own', color: '#123456' } }]) } })
    selected.gate.resolve()
  })
  await screen.findByRole('button', { name: '重试上传' })
  expect(Object.keys(f.model(f.b).resources.assets)).toHaveLength(0)
  expect(Object.keys(f.model(f.a).resources.assets)).toHaveLength(0)
  expect(componentSurfaces(f.model(f.a).project)[0].background).toEqual({ mode: 'own', color: '#123456' })
  expect(f.host.registry.get(f.a).read().revision).toBe(1)
  expect(input.files?.[0]).toBe(selected.file); expect(selected.clear).not.toHaveBeenCalled()
  const kept = preservePropertiesDrafts(f.a).find(record => record.label.endsWith(':图片上传'))!
  expect(JSON.parse(kept.raw)).toMatchObject({ name: 'A.png', mimeType: 'image/png', bytes: Array.from(selected.bytes) })
  first.unmount()
  await act(async () => { await useEditorStore.getState().courseBridge.activate(f.a) })
  render(<BackgroundPanel />)
  await screen.findByRole('button', { name: '重试上传' })
  expect(hasPropertiesDrafts(f.a)).toBe(true)
  expect(selected.read).toHaveBeenCalledTimes(1)
  expect(Object.keys(f.model(f.b).resources.assets)).toHaveLength(0)
  expect(JSON.parse(preservePropertiesDrafts(f.a).find(record => record.label.endsWith(':图片上传'))!.raw).bytes).toEqual(Array.from(selected.bytes))
})
