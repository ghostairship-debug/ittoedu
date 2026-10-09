import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFormulaNode } from '../../src/core/tools/nativeNodeFactories'
import { FormulaEditDialog } from '../../src/renderer/ui/FormulaEditDialog'

const formulaNode = () => createFormulaNode({ id: 'formula', formulaId: 'formula-identity', accessibleText: 'x', ast: { type: 'token', value: 'x' } })
function drawingContext(): CanvasRenderingContext2D {
  return {
    measureText: vi.fn((value: string) => ({
      width: Math.max(8, Array.from(value).length * 12),
    })),
    scale: vi.fn(),
    save: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    fillText: vi.fn(),
    restore: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
  } as unknown as CanvasRenderingContext2D
}

beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(drawingContext()) })
afterEach(() => { cleanup(); vi.restoreAllMocks() })
describe('professional formula dialog completion', () => {
  it('applies valid dialog edits on outside click, retains invalid slots, and delays completion during IME', async () => {
    const onCancel = vi.fn()
    const onCommit = vi.fn()
    render(<FormulaEditDialog node={structuredClone(formulaNode())} onCancel={onCancel} onCommit={onCommit} />)
    const input = screen.getByRole('textbox', { name: '公式内容（线性输入）' })
    fireEvent.change(input, { target: { value: 'x+□' } })
    fireEvent.pointerDown(screen.getByTestId('formula-edit-dialog-backdrop'))
    expect(onCommit).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: 'x+y' } })
    fireEvent.click(screen.getByRole('button', { name: '关闭公式编辑' }))
    expect(onCommit).not.toHaveBeenCalled()
    fireEvent.compositionEnd(input)
    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1))
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('provides a focused canvas dialog with explicit cancel and commit boundaries', () => {
    const node = structuredClone(formulaNode())
    const onCancel = vi.fn()
    const onCommit = vi.fn()
    render(
      <FormulaEditDialog
        node={node}
        onCancel={onCancel}
        onCommit={onCommit}
      />,
    )
    expect(screen.getByRole('dialog', { name: '编辑公式' })).toBeInTheDocument()
    const input = screen.getByRole('textbox', {
      name: '公式内容（线性输入）',
    }) as HTMLInputElement
    expect(input).toHaveFocus()

    fireEvent.change(input, { target: { value: '\\sqrt{x}' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onCommit).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: 'a/b' } })
    fireEvent.click(screen.getByRole('button', { name: '应用公式' }))
    expect(onCommit).toHaveBeenCalledWith(
      {
        type: 'fraction',
        numerator: { type: 'token', value: 'a' },
        denominator: { type: 'token', value: 'b' },
      },
      'b分之a',
    )
  })
})
