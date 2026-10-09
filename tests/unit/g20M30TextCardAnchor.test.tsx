import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ElementTextCardLayer, TextAiButton } from '../../src/renderer/workbench/elementCards/ElementTextCards'
import { elementCards } from '../../src/renderer/workbench/elementCards/elementCardController'
import { captureMarkdownSelection, workbenchSelection } from '../../src/renderer/workbench/SelectionContextController'
import { prepareDocumentTextEdit } from '../../src/renderer/document/documentSelectionCommands'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'

afterEach(async () => {
  cleanup()
  for (const card of elementCards.texts()) await elementCards.closeText(card.key)
  vi.restoreAllMocks()
})

function box(left: number, top: number, width = 80, height = 30): DOMRect {
  return { left, top, right: left + width, bottom: top + height, width, height, x: left, y: top,
    toJSON: () => ({}) } as DOMRect
}

it('M30 follows a visible selection on scroll, then explicitly rebinds a detached text card without losing its draft', async () => {
  let anchor = box(100, 100)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('selection-quick-bar__anchor') ? anchor
      : this.hasAttribute('data-selection-quick-bar') ? box(110, 140, 200, 36) : box(0, 0, 320, 200)
  })
  const view = (from: number) => <>
    <div data-selection-quick-bar="true"><TextAiButton documentId="doc" selectionIdentity={String(from)} start={async () => ({
      target: { kind: 'markdown-range', from, to: from + 2 }, label: `文字 ${from}`, content: '文字',
      capture: { documentId: 'doc', epoch: 'epoch', revision: 1, targets: [{ kind: 'markdown-range', from, to: from + 2 }], label: `文字 ${from}` },
    })} /></div>
    <ElementTextCardLayer />
  </>
  const { rerender } = render(view(1))
  fireEvent.click(screen.getByRole('button', { name: 'AI 修改' }))
  const card = await screen.findByRole('dialog', { name: 'AI 修改：文字 1' })
  await waitFor(() => expect(card).toHaveStyle({ left: '100px', top: '138px' }))
  fireEvent.change(within(card).getByRole('textbox', { name: 'AI 修改要求' }), { target: { value: '改成更简短的标题' } })

  anchor = box(180, 260)
  act(() => { fireEvent.scroll(document) })
  await waitFor(() => expect(card).toHaveStyle({ left: '180px', top: '298px' }))

  fireEvent.click(within(card).getByRole('button', { name: '重新选择文字并保留输入' }))
  expect(within(card).getByRole('status')).toHaveTextContent('请重新选中文字')
  rerender(view(30))
  anchor = box(220, 330)
  act(() => { fireEvent.scroll(document) })
  expect(elementCards.texts()).toMatchObject([{ target: { kind: 'markdown-range', from: 1, to: 3 } }])
  // A detached card stays reachable but clears the new quick bar so its AI button can be clicked.
  expect(card).toHaveStyle({ left: '100px', top: '184px' })
  expect(within(card).getByRole('textbox', { name: 'AI 修改要求' })).toHaveValue('改成更简短的标题')

  fireEvent.click(screen.getByRole('button', { name: 'AI 修改' }))
  await waitFor(() => expect(elementCards.texts()).toMatchObject([{
    target: { kind: 'markdown-range', from: 30, to: 32 }, label: '文字 30',
  }]))
  expect(screen.getByRole('dialog', { name: 'AI 修改：文字 30' })).toBe(card)
  expect(within(card).getByRole('textbox', { name: 'AI 修改要求' })).toHaveValue('改成更简短的标题')
  expect(elementCards.texts()).toHaveLength(1)
})

it('folds on an outside pointer, keeps input inside open, and restores the same unsent draft', async () => {
  render(<>
    <TextAiButton documentId="doc" selectionIdentity="selected" start={async () => ({
      target: { kind: 'markdown-range', from: 1, to: 3 }, label: '文字', content: '文字',
      capture: { documentId: 'doc', epoch: 'epoch', revision: 1, targets: [{ kind: 'markdown-range', from: 1, to: 3 }], label: '文字' },
    })} />
    <button type="button">outside</button>
    <ElementTextCardLayer />
  </>)
  fireEvent.click(screen.getByRole('button', { name: 'AI 修改' }))
  const card = await screen.findByRole('dialog', { name: 'AI 修改：文字' })
  const input = within(card).getByRole('textbox', { name: 'AI 修改要求' })
  fireEvent.change(input, { target: { value: '尚未发送的要求' } })
  const original = elementCards.texts()[0]!.key
  fireEvent.pointerDown(input)
  expect(screen.getByRole('dialog')).toBe(card)
  fireEvent.pointerDown(screen.getByRole('button', { name: 'outside' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(elementCards.view(original)).toMatchObject({ dismissed: true, draft: '尚未发送的要求', entries: [] })
  fireEvent.click(screen.getByRole('button', { name: 'AI 修改' }))
  const restored = await screen.findByRole('dialog', { name: 'AI 修改：文字' })
  expect(elementCards.texts()[0]!.key).toBe(original)
  expect(within(restored).getByRole('textbox', { name: 'AI 修改要求' })).toHaveValue('尚未发送的要求')
})

it('restores a folded draft after unrelated revision changes and reselecting the original text', async () => {
  let snapshot = { documentId: 'draft-recovery', epoch: 'original-session', revision: 1,
    model: { kind: 'markdown', source: 'text END', resources: { attachments: [] } } } as DocumentSnapshot
  const unregister = workbenchSelection.register('draft-recovery', async () => snapshot)
  const view = () => <>
    <TextAiButton documentId="draft-recovery" selectionIdentity={String(snapshot.revision)} start={() => {
      if (snapshot.model.kind !== 'markdown') throw new Error('markdown fixture')
      const from = snapshot.revision === 1 ? 0 : 7
      return prepareDocumentTextEdit('draft-recovery', { mode: 'source', revision: String(snapshot.revision),
        source: snapshot.model.source, label: '原目标', selection: null, ranges: [{ from, to: from + 4, before: 'text' }] }, captureMarkdownSelection)
    }} />
    <button type="button">outside</button><ElementTextCardLayer />
  </>
  try {
    const rendered = render(view())
    fireEvent.click(screen.getByRole('button', { name: 'AI 修改' }))
    const original = await screen.findByRole('dialog', { name: 'AI 修改：原目标' })
    const key = elementCards.texts().find(card => card.documentId === 'draft-recovery')!.key
    fireEvent.change(within(original).getByRole('textbox', { name: 'AI 修改要求' }), { target: { value: '保留的修改要求' } })
    fireEvent.pointerDown(screen.getByRole('button', { name: 'outside' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'AI 修改：原目标' })).toBeNull())
    snapshot = { ...snapshot, revision: 2, model: { kind: 'markdown', source: 'prefix text END', resources: { attachments: [] } } }
    rendered.rerender(view())
    fireEvent.click(screen.getByRole('button', { name: 'AI 修改' }))
    const empty = await screen.findByRole('dialog', { name: 'AI 修改：原目标' })
    expect(within(empty).getByRole('textbox', { name: 'AI 修改要求' })).toHaveValue('')
    const recover = screen.getByRole('button', { name: '恢复 AI 草稿：原目标' })
    fireEvent.pointerDown(recover)
    fireEvent.click(recover)
    await waitFor(() => expect(elementCards.view(key)).toMatchObject({ dismissed: false, draft: '保留的修改要求',
      target: { kind: 'markdown-range', from: 0, to: 4 } }))
    const restored = screen.getAllByRole('dialog', { name: 'AI 修改：原目标' }).find(card =>
      (within(card).getByRole('textbox', { name: 'AI 修改要求' }) as HTMLTextAreaElement).value === '保留的修改要求')
    expect(restored).toBeDefined()
    expect(elementCards.matchesTextCapture(key, { documentId: 'draft-recovery', epoch: 'original-session', revision: 1,
      targets: [{ kind: 'markdown-range', from: 0, to: 4 }], label: '原目标' })).toBe(true)
  } finally { unregister() }
})
