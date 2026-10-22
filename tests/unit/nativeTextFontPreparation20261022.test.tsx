import { useState } from 'react'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createTestProjectFromLegacy } from '../helpers/glxWorkFixture'
import { createV10StoreHost, deferred } from '../helpers/courseV10StoreHost'
import { TEXT_DEFINITION, createTextComponentData, textComponentDataSchema } from '../../src/components/text'
import { createInitialSlideOwnedState, createSlideAuthoringSlice } from '../../src/renderer/store/slices/slideAuthoringSlice'
import { useSlideNativeTextEditor } from '../../src/renderer/ui/workspaces/useSlideNativeTextEditor'
import type { ProfessionalContentEditorProps } from '../../src/renderer/ui/workspaces/ProfessionalContentEditor'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform'

const probe = vi.hoisted(() => ({ props: undefined as ProfessionalContentEditorProps | undefined,
  measure: vi.fn((element: HTMLElement, frame: { width: number }) => ({ width: frame.width, height: 180, scale: 1, overflows: false })) }))
vi.mock('../../src/renderer/ui/workspaces/ProfessionalContentEditor', () => ({ ProfessionalContentEditor: (props: ProfessionalContentEditorProps) => { probe.props = props; return null } }))
vi.mock('../../src/components/text', async original => ({ ...await original<typeof import('../../src/components/text')>(), measureTextComponent: probe.measure }))

const fixtures: { bridge: { dispose(): void }; stop(): void }[] = []
beforeEach(() => { probe.props = undefined; probe.measure.mockClear() })
afterEach(() => { cleanup(); for (const f of fixtures.splice(0)) { f.stop(); f.bridge.dispose() } })
function project(): CourseProjectV10 {
  return createTestProjectFromLegacy({ schemaVersion: 10, id: 'font-draft', revision: 0, title: '字形尺寸', definitions: { [TEXT_DEFINITION.id]: TEXT_DEFINITION },
    instances: { text: { id: 'text', definitionId: TEXT_DEFINITION.id, data: JSON.parse(JSON.stringify(createTextComponentData('old'))), frame: { width: 400, height: 80, transform: [1, 0, 0, 1, 0, 0] } } },
    surfaces: [{ id: 'slide', kind: 'slide', title: '页', childIds: ['text'] }], global: { underlay: [], overlay: [] }, assets: {} })
}
async function fixture(load: (font: string, text: string) => Promise<void>) {
  const h = await createV10StoreHost(project())
  const iframe = document.createElement('iframe'); document.body.append(iframe)
  const dom = iframe.contentDocument!, stage = dom.createElement('div'); dom.body.append(stage)
  const fonts = { check: () => false, load: vi.fn((font: string, text = '') => load(font, text)) }
  Object.defineProperty(dom, 'fonts', { configurable: true, value: fonts })
  let owned = createInitialSlideOwnedState(), refresh = () => {}
  const slice = createSlideAuthoringSlice(h.kernel, { read: () => owned, patch: next => { owned = { ...owned, ...next }; refresh() } })
  slice.beginSlideDataEdit('text')
  function Harness() {
    const [, tick] = useState(0); refresh = () => tick(value => value + 1)
    const view = h.bridge.read()
    return useSlideNativeTextEditor({ project: view.editingProject!, readProject: () => h.bridge.read().editingProject!, surfaceId: 'slide',
      edit: owned.slideContentEdit, begin: slice.beginSlideDataEdit, update: slice.updateSlideDataDraft,
      commit: slice.commitTextEdit, commitInput: slice.commitSlideContentInput, cancel: slice.cancelTextEdit,
      undo() {}, redo() {}, host: () => stage, report: message => { throw new Error(message) },
    }, view.activeDocumentId + ':' + view.snapshot!.epoch + ':slide').editor
  }
  const ui = render(<Harness />)
  fixtures.push({ bridge: h.bridge, stop: () => { ui.unmount(); iframe.remove(); refresh = () => {} } })
  const update = async (text: string, composing = false) => act(async () => probe.props!.update(createTextComponentData(text), composing))
  return { ...h, slice, fonts, dom, update, read: () => owned.slideContentEdit }
}

it('keeps semantic input synchronous and lets direct Save completion await actual-document fonts before persisting a frame', async () => {
  const gate = deferred(), h = await fixture(() => gate.promise)
  await h.update('A字')
  expect(textComponentDataSchema.parse(h.read()!.data).content.inlines).toEqual([{ type: 'text', text: 'A字' }])
  expect(() => structuredClone(h.read())).not.toThrow()
  const completing = h.slice.commitTextEdit()
  expect(h.operations).toHaveLength(0); expect(probe.measure).not.toHaveBeenCalled()
  expect(h.fonts.load).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('A字'))
  await act(async () => { gate.resolve(); await completing })
  expect(probe.measure).toHaveBeenCalledOnce()
  expect(probe.measure.mock.calls[0][0].ownerDocument).toBe(h.dom)
  expect(h.operations).toHaveLength(1)
  expect(h.model().project.instances.text.frame?.height).toBe(180)
})

it('supersedes old font results and accepts only the latest batch across concurrent input and explicit completions', async () => {
  const a = deferred(), b = deferred(), h = await fixture((_font, text) => text.includes('B') ? b.promise : a.promise)
  await h.update('A')
  const input = h.slice.commitSlideContentInput(), complete = h.slice.commitTextEdit(), duplicate = h.slice.commitTextEdit()
  await h.update('B')
  await act(async () => { a.resolve(); await a.promise })
  expect(h.operations).toHaveLength(0); expect(probe.measure).not.toHaveBeenCalled()
  await act(async () => { b.resolve(); await Promise.all([input, complete, duplicate]) })
  expect(h.operations).toHaveLength(1); expect(probe.measure).toHaveBeenCalledOnce()
  expect(textComponentDataSchema.parse(h.model().project.instances.text.data).content.inlines).toEqual([{ type: 'text', text: 'B' }])
})

it('keeps IME synchronous and records its completion preparation even when semantic data is unchanged', async () => {
  const gate = deferred(), h = await fixture(() => gate.promise)
  await h.update('输入法', true)
  expect(h.read()?.composing).toBe(true)
  expect(h.fonts.load).not.toHaveBeenCalled()
  await h.slice.commitSlideContentInput()
  expect(h.operations).toHaveLength(0)
  await h.update('输入法', false)
  const complete = h.slice.commitTextEdit()
  expect(h.operations).toHaveLength(0)
  await act(async () => { gate.resolve(); await complete })
  expect(h.operations).toHaveLength(1); expect(probe.measure).toHaveBeenCalledOnce()
})

it('diagnoses a rejected font load while saving text with its authored frame and no fallback measurement', async () => {
  const h = await fixture(async () => { throw new Error('font slice unavailable') }), feedback = vi.spyOn(h.kernel, 'setFeedback')
  await h.update('missing字')
  await act(async () => h.slice.commitTextEdit())
  expect(h.operations).toHaveLength(1); expect(probe.measure).not.toHaveBeenCalled()
  expect(h.model().project.instances.text.frame?.height).toBe(80)
  expect(textComponentDataSchema.parse(h.model().project.instances.text.data).content.inlines).toEqual([{ type: 'text', text: 'missing字' }])
  expect(feedback).toHaveBeenCalledWith({ statusMessage: expect.stringContaining('字体准备失败') })
})

it('does not submit a cancelled draft or follow a reopened editor at the same instance into its new font batch', async () => {
  const a = deferred(), b = deferred(), h = await fixture((_font, text) => text.includes('B') ? b.promise : a.promise)
  await h.update('A')
  const old = h.slice.commitTextEdit()
  await act(async () => { h.slice.cancelTextEdit(); h.slice.beginSlideDataEdit('text') })
  await h.update('B')
  await act(async () => { a.resolve(); await old })
  expect(h.operations).toHaveLength(0)
  expect(textComponentDataSchema.parse(h.read()!.data).content.inlines).toEqual([{ type: 'text', text: 'B' }])
  const current = h.slice.commitTextEdit()
  await act(async () => { b.resolve(); await current })
  expect(h.operations).toHaveLength(1); expect(probe.measure).toHaveBeenCalledOnce()
})

it('joins same-preparation completions through a flag successor without self-await when the frame does not grow', async () => {
  const gate = deferred(), h = await fixture(() => gate.promise)
  probe.measure.mockReturnValueOnce({ width: 400, height: 80, scale: 1, overflows: false })
  await h.update('same preparation')
  const first = h.slice.commitTextEdit()
  await act(async () => { h.slice.setSlideTextEditComposing(true); h.slice.setSlideTextEditComposing(false) })
  const second = h.slice.commitTextEdit()
  await act(async () => { gate.resolve(); await Promise.all([first, second]) })
  expect(h.operations).toHaveLength(1)
  expect(h.model().project.instances.text.frame?.height).toBe(80)
  expect(h.read()).toBeNull()
})

it('does not apply an old narrow-frame preparation after an explicit frame change', async () => {
  const gate = deferred(), h = await fixture(() => gate.promise)
  await h.update('width change')
  const completing = h.slice.commitTextEdit()
  await act(async () => h.slice.updateSlideFrameDraft({ ...h.model().project.instances.text.frame!, width: 800 }))
  await act(async () => { gate.resolve(); await completing })
  expect(h.operations).toHaveLength(1)
  expect(h.model().project.instances.text.frame).toMatchObject({ width: 800, height: 80 })
})
