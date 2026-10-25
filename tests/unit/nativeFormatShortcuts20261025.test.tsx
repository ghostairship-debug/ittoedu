import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { TEXT_DEFINITION, createTextComponentData, textComponentDataSchema } from '../../src/components/text'
import { WEB_DEFINITION } from '../../src/components/web/data'
import { CourseEditorChromeContext } from '../../src/renderer/documents/CourseEditorChromeContext'
import { authorFieldIdentity } from '../../src/renderer/documents/interactionSelection'
import { CanvasPlainTextEditor } from '../../src/renderer/ui/CanvasPlainTextEditor'
import { NativeSelectionContext } from '../../src/renderer/workbench/NativeSelectionContext'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import type { ComponentAuthorSpot } from '../../src/shared/contracts/component-platform'
import { createCourseDocumentHost, deferred } from '../helpers/courseDocumentHost'
import { createTestProjectFromLegacy } from '../helpers/glxWorkFixture'
import { ProfessionalContentEditor } from '../../src/renderer/ui/workspaces/ProfessionalContentEditor'
import { createDomAuthoring } from '../../src/components/web/authoringDom'
import { useRef } from 'react'

afterEach(() => { cleanup(); useEditorStore.getState().courseBridge.dispose(); vi.unstubAllGlobals() })

async function fixture() {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  const host = await createCourseDocumentHost(), store = () => useEditorStore.getState()
  await store().connectCourseDocuments(host.api)
  const project = createTestProjectFromLegacy({ schemaVersion: 10, id: 'format-keys', revision: 0, title: 'keys',
    definitions: { [TEXT_DEFINITION.id]: TEXT_DEFINITION, [WEB_DEFINITION.id]: WEB_DEFINITION },
    instances: { text: { id: 'text', definitionId: TEXT_DEFINITION.id, data: JSON.parse(JSON.stringify(createTextComponentData('Neighbor'))),
      frame: { width: 200, height: 50, transform: [1, 0, 0, 1, 0, 0] } },
    web: { id: 'web', definitionId: WEB_DEFINITION.id, data: { html: '<p id="field">Field</p>' },
      frame: { width: 300, height: 100, transform: [1, 0, 0, 1, 250, 0] } } },
    surfaces: [{ id: 'slide', kind: 'slide', title: 'Slide', childIds: ['text', 'web'] }], global: { underlay: [], overlay: [] }, assets: {} })
  await store().courseBridge.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } })
  store().setEditingScope('scene')
  const documentId = store().courseView.activeDocumentId!, surfaceId = store().courseView.surfaceId!
  const spot: ComponentAuthorSpot = { id: 'field', instanceId: 'web', kind: 'text', mountGeneration: 1,
    authorKey: 'field-key', binding: { kind: 'dom', path: [{ tag: 'p', index: 0, attributes: { id: 'field' } }], baseline: 'Field', textIndex: 0 }, bindingStatus: 'bound',
    initialValue: 'Field', textStyle: { 'font-weight': '400', 'font-style': 'normal', 'text-decoration-line': 'none' },
    localBounds: { width: 200, height: 40, transform: [1, 0, 0, 1, 0, 0] },
    geometry: { frame: { width: 200, height: 40, transform: [1, 0, 0, 1, 0, 0] }, parentToInstance: [1, 0, 0, 1, 0, 0], author: {}, boxInsets: { width: 0, height: 0 } } }
  return { host, store, documentId, surfaceId, spot }
}

it('routes a selected native text object through its existing format owner and keeps other inputs in charge', async () => {
  const f = await fixture()
  f.store().selectNodes(['text'])
  function Current() {
    const view = useEditorStore(state => state.courseView)
    return <CourseEditorChromeContext.Provider value={{ documentId: f.documentId, mode: 'light', setMode() {} }}><main tabIndex={0} data-testid="keys-root">
      <NativeSelectionContext documentId={f.documentId} revision={view.snapshot?.revision ?? 0} surfaceId={view.surfaceId} itemIds={view.selectedInstanceIds} enabled />
      <input aria-label="属性文字" /><div className="ProseMirror" contentEditable suppressContentEditableWarning>Rich range</div>
    </main></CourseEditorChromeContext.Provider>
  }
  render(<Current />)
  const root = screen.getByTestId('keys-root'), before = f.host.registry.get(f.documentId).read().undoDepth
  act(() => { root.focus(); fireEvent.keyDown(root, { key: 'b', ctrlKey: true }) })
  await waitFor(() => expect(f.host.registry.get(f.documentId).read().undoDepth).toBe(before + 1))
  expect(textComponentDataSchema.parse(f.store().courseView.project!.instances.text.data).appearance.bold).toBe(true)
  const revision = f.host.registry.get(f.documentId).read().revision
  const input = screen.getByRole('textbox', { name: '属性文字' })
  act(() => { input.focus(); fireEvent.keyDown(input, { key: 'i', ctrlKey: true }) })
  fireEvent.keyDown(root.querySelector('.ProseMirror')!, { key: 'u', ctrlKey: true })
  fireEvent.keyDown(root, { key: 'u', ctrlKey: true, altKey: true })
  fireEvent.keyDown(root, { key: 'i', ctrlKey: true, isComposing: true })
  await act(async () => { await f.store().drainCourseDocument() })
  expect(f.host.registry.get(f.documentId).read().revision).toBe(revision)
})

it('formats only the exact registered plain author field through the same formal record action', async () => {
  const f = await fixture(), identity = authorFieldIdentity('web', f.spot)
  f.store().courseBridge.selectAuthorSpot(f.documentId, f.spot, f.surfaceId)
  function Current() {
    const view = useEditorStore(state => state.courseView)
    return <CourseEditorChromeContext.Provider value={{ documentId: f.documentId, mode: 'light', setMode() {} }}><main data-testid="keys-root">
      <NativeSelectionContext documentId={f.documentId} revision={view.snapshot?.revision ?? 0} surfaceId={view.surfaceId} itemIds={view.selectedInstanceIds}
        stateId={view.activeStateId} enabled textEditing authorSpot={f.spot} />
      <div data-author-field-identity={identity}><CanvasPlainTextEditor presentation="inline" bounds={{ x: 0, y: 0, width: 200, height: 40 }}
        value="Field" label="当前字段" onCommit={() => {}} onCancel={() => {}} /></div>
      <div className="canvas-plain-text-editor" data-author-field-identity="another-field"><textarea aria-label="另一字段" /></div>
    </main></CourseEditorChromeContext.Provider>
  }
  render(<Current />)
  const input = screen.getByRole('textbox', { name: '当前字段' }), before = f.host.registry.get(f.documentId).read().undoDepth
  fireEvent.keyDown(input, { key: 'b', ctrlKey: true })
  await act(async () => { await f.store().drainCourseDocument() })
  await waitFor(() => expect(f.host.registry.get(f.documentId).read().undoDepth).toBe(before + 1))
  expect(f.store().courseView.project!.instances.web.authoring?.records?.['field-key'].overrides.style).toMatchObject({ 'font-weight': '700' })
  expect(f.store().courseView.project!.instances.web.data).toEqual({ html: '<p id="field">Field</p>' })
  expect(input.textContent).toBe('Field'); expect(input.querySelector('b,strong,i,em,u')).toBeNull()
  const revision = f.host.registry.get(f.documentId).read().revision
  const other = screen.getByRole('textbox', { name: '另一字段' })
  act(() => { other.focus(); fireEvent.keyDown(other, { key: 'i', ctrlKey: true }) })
  await act(async () => { await f.store().drainCourseDocument() })
  expect(f.host.registry.get(f.documentId).read().revision).toBe(revision)
  expect(textComponentDataSchema.parse(f.store().courseView.project!.instances.text.data).appearance.bold).toBe(false)
})

it('settles source-field typing and its ACK successor before formatting the accepted range and saving it', async () => {
  const f = await fixture()
  await f.store().courseKernel.edit([{ type: 'data.set', instanceId: 'web', path: ['html'], value: '<p>A<span>B</span>C</p>' }])
  const spot: ComponentAuthorSpot = { ...f.spot, initialValue: 'A', geometry: undefined, bindingStatus: 'source-required',
    binding: { kind: 'dom', path: [{ tag: 'p', index: 0 }], baseline: 'A', textIndex: 0 },
    sourceRegion: { kind: 'data', path: ['html'], start: 3, end: 4, encoding: 'html-text' } }
  f.store().courseBridge.selectAuthorSpot(f.documentId, spot, f.surfaceId)
  expect(await f.store().beginSlideSpotEdit(spot)).not.toBeNull()
  const release = deferred(), entered = deferred()
  let blocked = false
  f.host.controls.beforeAppend = async state => {
    if (!blocked && state.model.kind === 'course-v10' && (state.model.project.instances.web.data as { html: string }).html.includes('Typed')) {
      blocked = true; entered.resolve(); await release.promise
    }
  }
  function Current() {
    const view = useEditorStore(state => state.courseView), draft = useEditorStore(state => state.slideContentEdit)
    const host = useRef<HTMLDivElement>(null)
    return <CourseEditorChromeContext.Provider value={{ documentId: f.documentId, mode: 'light', setMode() {} }}><main>
      <div ref={host} />
      <NativeSelectionContext documentId={f.documentId} revision={view.snapshot?.revision ?? 0} surfaceId={view.surfaceId} itemIds={view.selectedInstanceIds}
        stateId={view.activeStateId} enabled textEditing={Boolean(draft)} authorSpot={spot} />
      {draft && <ProfessionalContentEditor project={view.project!} draft={draft} target={() => host.current}
        update={(...args) => f.store().updateSlideDataDraft(...args)} updateSpot={(...args) => f.store().updateSlideSpotDraft(...args)}
        commit={() => f.store().commitSlideContentEdit(f.documentId)} commitInput={() => f.store().commitSlideContentInput()}
        cancel={() => f.store().cancelTextEdit()} undo={() => {}} redo={() => {}} report={() => {}} />}
    </main></CourseEditorChromeContext.Provider>
  }
  render(<Current />)
  try {
    const input = await screen.findByRole('textbox', { name: '编辑此处文字' })
    fireEvent.input(input, { target: { textContent: 'Typed' } })
    fireEvent.keyDown(input, { key: 'b', ctrlKey: true })
    await entered.promise
    fireEvent.input(input, { target: { textContent: 'Typed latest' } })
    await act(async () => { release.resolve() })
    await waitFor(() => {
      expect(f.store().slideContentEdit).toBeNull()
      expect(f.store().courseView.project!.instances.web.authoring?.records?.['field-key'].overrides.style?.['font-weight']).toBe('700')
    })
    const saved = await f.host.api.saveWithDialog(f.documentId)
    if (!saved || saved.binding.kind !== 'file') throw new Error('Expected saved archive')
    const cold = await f.host.driver.load(f.host.disk.get(saved.binding.path)!)
    if (cold.kind !== 'course-v10') throw new Error('Expected course')
    const instance = cold.project.instances.web, element = document.createElement('div')
    element.innerHTML = (instance.data as { html: string }).html; document.body.append(element)
    const consumer = createDomAuthoring(element, { records: () => instance.authoring?.records ?? {} })
    try {
      expect(element.textContent).toBe('Typed latestBC')
      const field = element.querySelector<HTMLElement>('[data-cw-author-key]')!
      expect(field.textContent).toBe('Typed latest'); expect(getComputedStyle(field).fontWeight).toBe('700')
      expect(element.querySelector('p > span:not([data-cw-author-key])')?.textContent).toBe('B')
      expect(element.querySelector('p')!.lastChild!.textContent).toBe('C')
    } finally { consumer.dispose(); element.remove() }
  } finally { release.resolve(); f.host.controls.beforeAppend = undefined }
})
