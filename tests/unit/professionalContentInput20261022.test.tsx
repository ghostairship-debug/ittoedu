import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { createTestProjectFromLegacy } from '../helpers/glxWorkFixture'
import { createV10StoreHost, deferred } from '../helpers/courseV10StoreHost'
import { readAuthorSourceText } from '../../src/core/components/authoring/sourceAuthorText'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { createTextComponentData, textComponentDataSchema } from '../../src/components/text/data'
import { CanvasPlainTextEditor } from '../../src/renderer/ui/CanvasPlainTextEditor'
import { authorFieldTextData, nativeTextSpotFromElement } from '../../src/renderer/authoring/professionalContentFields'
import { createInitialSlideOwnedState, createSlideAuthoringSlice, hasSlideContentDraftChanges, projectWithSlideContentDraft } from '../../src/renderer/store/slices/slideAuthoringSlice'
import type { ComponentAuthorSpot, CourseProjectV10, JsonValue } from '../../src/shared/contracts/component-platform'

const fixtures: Awaited<ReturnType<typeof createV10StoreHost>>[] = []
afterEach(() => { cleanup(); for (const h of fixtures.splice(0)) h.bridge.dispose() })
const frame = { width: 300, height: 140, transform: [1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number] }
function project(source = false): CourseProjectV10 {
  return createTestProjectFromLegacy({ schemaVersion: 10, id: 'professional-input', revision: 0, title: '精确专业输入',
    definitions: source ? { custom: { id: 'custom', title: '源码字段', role: 'content', implementation: { kind: 'source', language: 'javascript', source: 'export default {}' } } } : { [TEXT_DEFINITION.id]: TEXT_DEFINITION },
    instances: { text: { id: 'text', definitionId: source ? 'custom' : TEXT_DEFINITION.id, frame, data: source ? { html: '<p>old</p><p>neighbor</p>' } : JSON.parse(JSON.stringify(createTextComponentData('old'))) } },
    surfaces: [{ id: 'slide', kind: 'slide', title: '页', childIds: ['text'] }], global: { underlay: [], overlay: [] }, assets: {} })
}
async function fixture(source = false) {
  const h = await createV10StoreHost(project(source)); fixtures.push(h)
  let owned = createInitialSlideOwnedState()
  const slice = createSlideAuthoringSlice(h.kernel, { read: () => owned, patch: value => { owned = { ...owned, ...value } } })
  const content = textComponentDataSchema.safeParse(h.model().project.instances.text.data)
  const spot: ComponentAuthorSpot = { id: 'live-field', instanceId: 'text', mountGeneration: 1, kind: 'text', localBounds: frame,
    ...(source ? { initialValue: 'old', sourceRegion: { kind: 'data' as const, path: ['html'], start: 3, end: 6, encoding: 'html-text' as const } }
      : { dataPath: ['content'], initialValue: content.success ? content.data.content as unknown as JsonValue : '' }) }
  await slice.beginSlideSpotEdit(spot)
  return { ...h, slice, read: () => owned.slideContentEdit!, spot }
}

it('keeps the latest rich field through a delayed canonical ACK and groups accepted typing', async () => {
  const h = await fixture(), gate = deferred()
  let first = true
  h.controls.after = async () => { if (first) { first = false; await gate.promise } }
  const initialAppearance = textComponentDataSchema.parse(h.model().project.instances.text.data).appearance
  const update = (text: string) => h.slice.updateSlideDataDraft(createTextComponentData({ inlines: [{ type: 'text', text, style: { bold: true } },
    { type: 'math', formulaId: 'inline-formula', latex: 'x^2', accessibleText: 'x squared' }] }), false, undefined, undefined, undefined, 'typing-group')
  update('first')
  const pending = h.slice.commitSlideContentInput()
  await waitFor(() => expect(h.operations).toHaveLength(1))
  update('latest')
  gate.resolve(); await pending
  expect(h.operations).toHaveLength(2)
  expect(h.read().spotValue).toEqual(textComponentDataSchema.parse(h.model().project.instances.text.data).content)
  expect(hasSlideContentDraftChanges(h.read())).toBe(false)
  expect(h.first.read().undoDepth).toBe(1)
  expect(textComponentDataSchema.parse(h.model().project.instances.text.data).appearance).toEqual(initialAppearance)
  await h.slice.commitTextEdit()
  expect(h.operations).toHaveLength(2)
  const cold = h.driver.load(h.driver.serialize(h.model()))
  if (cold.kind !== 'course-v10') throw new Error('V10 required')
  expect(textComponentDataSchema.parse(cold.project.instances.text.data).content.inlines).toEqual([
    { type: 'text', text: 'latest', style: { bold: true } }, { type: 'math', formulaId: 'inline-formula', latex: 'x^2', accessibleText: 'x squared' } ])
})

it('retains source typing and IME in the draft and reloads once at completion', async () => {
  const h = await fixture(true)
  h.slice.updateSlideSpotDraft('composing', true)
  await h.slice.commitSlideContentInput()
  h.slice.updateSlideSpotDraft('final & kept', false)
  await h.slice.commitSlideContentInput()
  expect(h.operations).toHaveLength(0)
  expect(h.read().data).toEqual({ html: '<p>old</p><p>neighbor</p>' })
  const current = h.model().project
  expect(projectWithSlideContentDraft(current, h.read(), { documentId: h.read().target.documentId, epoch: h.read().target.epoch, surfaceId: h.read().target.surfaceId, activeStateId: h.read().target.activeStateId })).toBe(current)
  await h.slice.commitTextEdit()
  expect(h.operations).toHaveLength(1)
  expect(h.model().project.instances.text.data).toEqual({ html: '<p>final &amp; kept</p><p>neighbor</p>' })
})

it('opens a collapsed caret, commits ordinary Escape and resolves native slots by exact path', async () => {
  const values: string[] = [], bounds = { x: 0, y: 0, width: 200, height: 40 }
  const ui = render(<CanvasPlainTextEditor bounds={bounds} label="正文" value="old" initialCaret={1} onCommit={value => values.push(value)} onCancel={() => values.push('cancel')} />)
  const input = ui.getByLabelText('正文') as HTMLInputElement
  await waitFor(() => expect(input.selectionStart).toBe(1))
  expect(input.selectionEnd).toBe(1)
  fireEvent.change(input, { target: { value: 'kept' } })
  await act(async () => fireEvent.keyDown(input, { key: 'Escape' }))
  expect(values).toEqual(['kept'])
  const owner = document.createElement('div'); owner.dataset.componentInstance = 'text'
  const slot = document.createElement('span'); slot.dataset.documentPath = JSON.stringify(['content']); slot.textContent = 'unrelated observation'
  owner.append(slot); document.body.append(owner)
  const p = project(), spot = nativeTextSpotFromElement(p, 'text', slot, frame)!
  expect(spot.dataPath).toEqual(['content'])
  expect(authorFieldTextData(spot)?.content).toEqual(textComponentDataSchema.parse(p.instances.text.data).content)
  owner.remove()
})

it.each(['data', 'workspace'] as const)('advances an accepted %s source range while preserving typing during its ACK', async carrier => {
  const p = project(true), source = 'export default {title:"old"}', start = source.indexOf('old')
  const originalBytes = new TextEncoder().encode(source)
  const resources = carrier === 'workspace' ? { assets: {}, components: { shared: { 'entry.js': originalBytes } } } : undefined
  if (carrier === 'workspace') {
    p.definitions.custom.implementation = { kind: 'source', language: 'javascript', workspace: { ownerId: 'shared', entry: 'entry.js' } }
  }
  const h = await createV10StoreHost(p, resources); fixtures.push(h)
  let owned = createInitialSlideOwnedState()
  const slice = createSlideAuthoringSlice(h.kernel, { read: () => owned, patch: next => { owned = { ...owned, ...next } } })
  const spot: ComponentAuthorSpot = { id: 'source-field', instanceId: 'text', mountGeneration: 1, kind: 'text', initialValue: 'old', localBounds: frame,
    sourceRegion: carrier === 'data' ? { kind: 'data', path: ['html'], start: 3, end: 6, encoding: 'html-text' }
      : { kind: 'implementation', path: ['entry.js'], start, end: start + 3 } }
  await slice.beginSlideSpotEdit(spot)
  slice.updateSlideSpotDraft('longer & accepted', false)
  const gate = deferred(); let first = true
  h.controls.after = async () => { if (first) { first = false; await gate.promise } }
  const completion = slice.commitTextEdit()
  await waitFor(() => expect(h.operations).toHaveLength(1))
  slice.updateSlideSpotDraft('latest " & kept', false)
  gate.resolve(); await completion
  expect(owned.slideContentEdit).toBeNull()
  expect(h.operations).toHaveLength(2)
  if (carrier === 'data') expect(h.model().project.instances.text.data).toEqual({ html: '<p>latest " &amp; kept</p><p>neighbor</p>' })
  else {
    const implementation = h.model().project.instances.text.implementationOverride
    if (implementation?.kind !== 'source' || !implementation.workspace) throw new Error('Workspace required')
    expect(implementation.workspace.ownerId).not.toBe('shared')
    const acceptedSource = new TextDecoder().decode(h.model().resources.components[implementation.workspace.ownerId]['entry.js'])
    expect(readAuthorSourceText(acceptedSource, { kind: 'implementation', start, end: start + 3 + acceptedSource.length - source.length })).toBe('latest " & kept')
    expect(h.model().resources.components.shared['entry.js']).toEqual(originalBytes)
  }
})

it('advances only its accepted author binding baseline before the next input batch', async () => {
  const p = project(true), binding = { kind: 'dom' as const, path: [{ tag: 'p', index: 0 }], textIndex: 0, baseline: 'old' }, scope = { item: 'one' }
  p.instances.text.data = { title: 'old' }
  p.instances.text.authoring = { records: { title: { kind: 'text', scope, binding, overrides: { style: { color: 'red' } } } } }
  const h = await createV10StoreHost(p); fixtures.push(h)
  let owned = createInitialSlideOwnedState()
  const slice = createSlideAuthoringSlice(h.kernel, { read: () => owned, patch: next => { owned = { ...owned, ...next } } })
  await slice.beginSlideSpotEdit({ id: 'title-field', instanceId: 'text', mountGeneration: 1, kind: 'text', initialValue: 'old', localBounds: frame,
    authorKey: 'title', scope, binding, bindingStatus: 'bound', dataPath: ['title'] })
  const gate = deferred(); let first = true
  h.controls.after = async () => { if (first) { first = false; await gate.promise } }
  slice.updateSlideSpotDraft('first', false)
  const accepted = slice.commitSlideContentInput()
  await waitFor(() => expect(h.operations).toHaveLength(1))
  slice.updateSlideSpotDraft('latest', false)
  gate.resolve(); await accepted
  expect(h.model().project.instances.text.data).toEqual({ title: 'latest' })
  expect(owned.slideContentEdit?.authorSpot?.binding?.baseline).toBe('latest')
  expect(h.model().project.instances.text.authoring?.records?.title.overrides.style).toEqual({ color: 'red' })
  await slice.commitTextEdit()
})
