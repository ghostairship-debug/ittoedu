import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ElementTextCardLayer, TextAiButton } from '../../src/renderer/workbench/elementCards/ElementTextCards'
import { elementCards } from '../../src/renderer/workbench/elementCards/elementCardController'

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
