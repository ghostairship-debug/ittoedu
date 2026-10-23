import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createTextComponentData, type TextComponentData } from '../../src/components/text/data'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { authorFieldTextData, nativeTextClientRect } from '../../src/renderer/authoring/professionalContentFields'
import { ProfessionalContentEditor } from '../../src/renderer/ui/workspaces/ProfessionalContentEditor'
import { createInitialSlideOwnedState, createSlideAuthoringSlice } from '../../src/renderer/store/slices/slideAuthoringSlice'
import { createTestProjectFromLegacy } from '../helpers/glxWorkFixture'
import { createV10StoreHost } from '../helpers/courseV10StoreHost'
import type { ComponentAuthorSpot, JsonValue } from '../../src/shared/contracts/component-platform'

const fixtures: Awaited<ReturnType<typeof createV10StoreHost>>[] = []
afterEach(() => { cleanup(); vi.restoreAllMocks(); for (const fixture of fixtures.splice(0)) fixture.bridge.dispose() })
const frame = { width: 400, height: 120, transform: [1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number] }
const spot = (content: TextComponentData['content']): ComponentAuthorSpot => ({
  id: 'professional:text', instanceId: 'text', mountGeneration: 1, kind: 'text', dataPath: ['content'],
  initialValue: content as unknown as JsonValue, localBounds: frame,
})

it('opens a registered native content field with its authored appearance, sizing and toolbar defaults', async () => {
  const data = createTextComponentData('Small authored text.')
  Object.assign(data.appearance, { fontFamily: 'Georgia', fontSize: 14, color: '#525c4f', lineHeight: 1.95, letterSpacing: 0.4, padding: 2 })
  Object.assign(data.sizing, { mode: 'fixed', overflow: 'clip' })
  const project = createTestProjectFromLegacy({ schemaVersion: 10, id: 'small-native', revision: 0, title: 'Small native field',
    definitions: { [TEXT_DEFINITION.id]: TEXT_DEFINITION },
    instances: { text: { id: 'text', definitionId: TEXT_DEFINITION.id, frame, data: JSON.parse(JSON.stringify(data)) } },
    surfaces: [{ id: 'slide', kind: 'slide', title: 'Slide', childIds: ['text'] }], global: { underlay: [], overlay: [] }, assets: {} })
  const fixture = await createV10StoreHost(project); fixtures.push(fixture)
  let owned = createInitialSlideOwnedState()
  const slice = createSlideAuthoringSlice(fixture.kernel, { read: () => owned, patch: patch => { owned = { ...owned, ...patch } } })
  await slice.beginSlideSpotEdit(spot(data.content))
  const host = document.createElement('div'); document.body.append(host)
  try {
    render(<ProfessionalContentEditor project={fixture.model().project} draft={owned.slideContentEdit!} target={() => host}
      update={vi.fn()} updateSpot={vi.fn()} commit={async () => {}} cancel={vi.fn()} undo={() => {}} redo={() => {}} report={vi.fn()} />)
    const editor = screen.getByRole('textbox', { name: '正文编辑' })
    expect(editor.textContent).toBe('Small authored text.')
    expect((screen.getByRole('spinbutton', { name: '字号' }) as HTMLInputElement).value).toBe('14')
    expect((screen.getByRole('combobox', { name: '字体' }) as HTMLSelectElement).value).toBe('Georgia')
    const component = host.querySelector<HTMLElement>('.component-text-editor')!
    expect(component.style.padding).toBe('2px')
    expect(component.style.overflow).toBe('hidden')
    expect((component.firstElementChild as HTMLElement).style.lineHeight).toBe('1.95')
    expect((component.firstElementChild as HTMLElement).style.letterSpacing).toBe('0.4px')
    const defaults = editor.querySelector<HTMLElement>('[data-document-inline-defaults]')!
    expect(defaults.style.fontSize).toBe('14px')
    expect(defaults.style.fontFamily).toBe('Georgia')
    expect(defaults.style.color).toBe('rgb(82, 92, 79)')
    expect(fixture.operations).toHaveLength(0)
  } finally { host.remove() }
})

it('retains a generic rich field’s resolved line height and letter spacing without changing native data', () => {
  const content = createTextComponentData('A generic field.').content
  const field = { ...spot(content), textStyle: { 'font-size': '14px', 'line-height': '27.3px', 'letter-spacing': '0.7px', color: '#525c4f' } }
  expect(authorFieldTextData(field)?.appearance).toMatchObject({ fontSize: 14, lineHeight: 1.95, letterSpacing: 0.7, color: '#525c4f' })
  const native = createTextComponentData('Native original.')
  native.appearance.lineSpacing = 8; native.appearance.lineHeight = 'normal'
  const wrapped = authorFieldTextData(field, content as unknown as JsonValue, native)!
  expect(wrapped.appearance).toEqual(native.appearance)
  expect(wrapped.sizing).toEqual(native.sizing)
  expect(native.content).not.toEqual(wrapped.content)
})

it('measures display:contents text from actual range fragments and rejects a field with no painted box', () => {
  const slot = document.createElement('span'); slot.style.display = 'contents'; slot.textContent = 'Multiple lines'
  const select = vi.fn(), boxes = vi.fn(() => [new DOMRect(50, 100, 220, 18), new DOMRect(50, 127, 180, 18), new DOMRect(0, 0, 0, 0)])
  vi.spyOn(document, 'createRange').mockReturnValue({ selectNodeContents: select, getClientRects: boxes } as unknown as Range)
  vi.spyOn(slot, 'getBoundingClientRect').mockReturnValue(new DOMRect())
  expect(nativeTextClientRect(slot)).toMatchObject({ left: 50, top: 100, width: 220, height: 45 })
  expect(select).toHaveBeenCalledWith(slot)
  boxes.mockReturnValue([])
  expect(nativeTextClientRect(slot)).toBeNull()
})
