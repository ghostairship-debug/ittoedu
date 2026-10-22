import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { CanvasPlainTextEditor } from '../../src/renderer/ui/CanvasPlainTextEditor'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
const bounds = { x: 0, y: 0, width: 80, height: 30 }
it('keeps the source whitespace, inline typography and a middle UTF-16 caret without changing the value', () => {
  const commit = vi.fn(), draft = vi.fn()
  const ui = render(<CanvasPlainTextEditor presentation="inline" bounds={bounds} label="标题" value=" ME" initialCaret={2}
    textStyle={{ 'font-size': '36px', color: 'rgb(33, 78, 131)' }} onDraftChange={draft} onCommit={commit} onCancel={vi.fn()} />)
  const input = ui.getByRole('textbox')
  expect(input.textContent).toBe(' ME'); expect(input.style.fontSize).toBe('36px')
  expect(document.getSelection()?.anchorOffset).toBe(2)
  fireEvent.keyDown(input, { key: 'Escape' })
  expect(commit).toHaveBeenCalledWith(' ME'); expect(draft).not.toHaveBeenCalled()
})
it('inserts a literal newline rather than losing paragraph boundaries or leading whitespace', () => {
  const draft = vi.fn(), commit = vi.fn()
  const ui = render(<CanvasPlainTextEditor presentation="inline" bounds={bounds} label="正文" value=" one" initialCaret={4} multiline
    onDraftChange={draft} onCommit={commit} onCancel={vi.fn()} />)
  const input = ui.getByRole('textbox')
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(input.textContent).toBe(' one\n'); expect(draft).toHaveBeenLastCalledWith(' one\n', false)
  fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })
  expect(commit).toHaveBeenLastCalledWith(' one\n')
  fireEvent.blur(input); expect(commit).toHaveBeenCalledTimes(1)
})
it('accepts the pending first-gesture range and native word intent in the same input owner', () => {
  const props = { presentation: 'inline' as const, bounds, label: '标题', value: 'Hello world', initialCaret: 1, onCommit: vi.fn(), onCancel: vi.fn() }
  const ui = render(<CanvasPlainTextEditor {...props} selectionIntent={{ anchor: 1, focus: 4 }} />)
  expect(document.getSelection()?.toString()).toBe('ell')
  ui.rerender(<CanvasPlainTextEditor {...props} selectionIntent={{ anchor: 7, focus: 7, word: true }} />)
  expect(document.getSelection()?.toString()).toBe('world')
})
it('anchors to the original down when a later drag point arrives before the inline input mounts', () => {
  const descriptor = Object.getOwnPropertyDescriptor(document, 'caretPositionFromPoint')
  Object.defineProperty(document, 'caretPositionFromPoint', { configurable: true, value: (x: number) => ({
    offsetNode: document.querySelector('[contenteditable="true"]')!.firstChild!, offset: x === 10 ? 1 : 4,
  }) })
  try {
    const ui = render(<CanvasPlainTextEditor presentation="inline" bounds={bounds} label="初次拖选" value="YOU "
      initialPoint={{ x: 10, y: 10 }} selectionIntent={{ point: { x: 100, y: 10 } }} onCommit={vi.fn()} onCancel={vi.fn()} />)
    expect(ui.getByRole('textbox').textContent).toBe('YOU ')
    expect(document.getSelection()?.toString()).toBe('OU ')
    expect(document.getSelection()?.anchorOffset).toBe(1)
    expect(document.getSelection()?.focusOffset).toBe(4)
  } finally {
    if (descriptor) Object.defineProperty(document, 'caretPositionFromPoint', descriptor)
    else Reflect.deleteProperty(document, 'caretPositionFromPoint')
  }
})
it('keeps IME draft input local and does not finish on Escape during composition', () => {
  const draft = vi.fn(), commit = vi.fn()
  const ui = render(<CanvasPlainTextEditor presentation="inline" bounds={bounds} label="标题" value="原文" onDraftChange={draft} onCommit={commit} onCancel={vi.fn()} />)
  const input = ui.getByRole('textbox')
  fireEvent.compositionStart(input); input.textContent = '中文'; fireEvent.input(input)
  fireEvent.keyDown(input, { key: 'Escape' }); expect(commit).not.toHaveBeenCalled()
  expect(draft).toHaveBeenLastCalledWith('中文', true)
  fireEvent.compositionEnd(input); expect(draft).toHaveBeenLastCalledWith('中文', false)
})
it('preserves the existing card input for consumers that do not request inline presentation', () => {
  const ui = render(<CanvasPlainTextEditor bounds={bounds} label="原卡片" value="keep" onCommit={vi.fn()} onCancel={vi.fn()} />)
  expect(ui.getByRole('textbox').tagName).toBe('INPUT')
  expect(ui.getByText('Enter 完成 · Esc 完成')).toBeTruthy()
})
