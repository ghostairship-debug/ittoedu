import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  formulaAstToAccessibleText,
  serializeFormulaAst,
} from '@/shared/formulaLinear'
import {
  selectActiveScene,
  useEditorStore,
} from '@/renderer/store/editorStore'
import { PropertiesTab } from '@/renderer/ui/PropertiesTab'
import { FormulaEditDialog } from '@/renderer/ui/FormulaEditDialog'
import type { FormulaNode } from '@/shared/projectTypes'

function formulaNode(): FormulaNode {
  const node = selectActiveScene(useEditorStore.getState()).nodes[0]
  if (node?.type !== 'formula') throw new Error('Expected FormulaNode')
  return node as FormulaNode
}

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

beforeEach(() => {
  useEditorStore.getState().createNewProject()
  useEditorStore.setState({ editorMode: 'professional' })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    drawingContext(),
  )
  useEditorStore.getState().addFormulaNode()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('FormulaNode authoring UI', () => {
  it('uses linear input and one history transaction instead of editable AST JSON', () => {
    const original = structuredClone(formulaNode())
    const historyBefore = useEditorStore.getState().history.past.length
    render(<PropertiesTab onReplaceImage={vi.fn()} />)

    expect(screen.queryByTestId('formula-id')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: '公式结构' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('formula-ast-diagnostic')).not.toBeInTheDocument()

    const input = screen.getByRole('textbox', {
      name: '公式内容（线性输入）',
    }) as HTMLInputElement
    fireEvent.change(input, {
      target: { value: '(\\sqrt[3]{x} / y_i^2) = 1' },
    })
    expect(screen.getByTestId('formula-preview')).toHaveAttribute(
      'aria-label',
      expect.stringContaining('公式预览'),
    )
    fireEvent.click(screen.getByRole('button', { name: '应用公式' }))

    const updated = formulaNode()
    expect(updated.ast).toEqual({
      type: 'row',
      children: [
        {
          type: 'fenced',
          open: '(',
          close: ')',
          body: {
            type: 'fraction',
            numerator: {
              type: 'root',
              index: { type: 'token', value: '3' },
              radicand: { type: 'token', value: 'x' },
            },
            denominator: {
              type: 'script',
              base: { type: 'token', value: 'y' },
              superscript: { type: 'token', value: '2' },
              subscript: { type: 'token', value: 'i' },
            },
          },
        },
        { type: 'operator', value: '=' },
        { type: 'token', value: '1' },
      ],
    })
    expect(updated.formulaId).toBe(original.formulaId)
    expect(updated.accessibleText).toBe(formulaAstToAccessibleText(updated.ast))
    expect(useEditorStore.getState().history.past).toHaveLength(historyBefore + 1)
    expect(screen.getByText('公式已应用，无障碍描述已同步更新')).toBeInTheDocument()

    useEditorStore.getState().undo()
    expect(formulaNode()).toEqual(original)
    useEditorStore.getState().redo()
    expect(formulaNode().ast).toEqual(updated.ast)
  })

  it('keeps a custom accessible description and makes review/restoration explicit', () => {
    render(<PropertiesTab onReplaceImage={vi.fn()} />)
    const accessible = screen.getByRole('textbox', { name: '无障碍描述' })
    fireEvent.change(accessible, { target: { value: '自定义读法' } })
    fireEvent.blur(accessible)
    expect(screen.getByText('使用自定义描述')).toBeInTheDocument()

    const input = screen.getByRole('textbox', {
      name: '公式内容（线性输入）',
    }) as HTMLInputElement
    fireEvent.change(input, { target: { value: '\\sqrt{x}' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(formulaNode()).toMatchObject({
      accessibleText: '自定义读法',
      ast: { type: 'root', radicand: { type: 'token', value: 'x' } },
    })
    expect(screen.getByText(/请复核你的自定义无障碍描述/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '恢复自动描述' }))
    expect(formulaNode().accessibleText).toBe('x的平方根')
    expect(screen.getByText('随公式自动更新')).toBeInTheDocument()
  })

  it('never commits parse errors or unfinished template slots and clears stale preview', () => {
    const original = structuredClone(formulaNode())
    render(<PropertiesTab onReplaceImage={vi.fn()} />)
    const input = screen.getByRole('textbox', {
      name: '公式内容（线性输入）',
    }) as HTMLInputElement
    const preview = screen.getByTestId('formula-preview')
    expect(preview.querySelector('canvas')).not.toBeNull()

    fireEvent.change(input, { target: { value: '\\frac{x}' } })
    expect(screen.getByRole('alert')).toHaveTextContent(/分母/)
    expect(preview.querySelector('canvas')).toBeNull()
    expect(screen.getByRole('button', { name: '应用公式' })).toBeDisabled()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(formulaNode()).toEqual(original)

    fireEvent.change(input, { target: { value: 'a+b' } })
    input.setSelectionRange(0, 3)
    fireEvent.click(screen.getByRole('button', { name: '分式' }))
    expect(input).toHaveValue('\\frac{a+b}{□}')
    expect(screen.getByText(/请补全所有/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '应用公式' })).toBeDisabled()
    expect(formulaNode()).toEqual(original)
  })

  it('supports slot navigation and Escape cancellation without touching project history', () => {
    const original = structuredClone(formulaNode())
    const historyBefore = useEditorStore.getState().history.past.length
    render(<PropertiesTab onReplaceImage={vi.fn()} />)
    const input = screen.getByRole('textbox', {
      name: '公式内容（线性输入）',
    }) as HTMLInputElement

    fireEvent.change(input, { target: { value: '' } })
    input.setSelectionRange(0, 0)
    fireEvent.click(screen.getByRole('button', { name: 'n 次根' }))
    expect(input.value).toBe('\\sqrt[□]{□}')
    expect(input.selectionStart).toBe(6)
    fireEvent.keyDown(input, { key: 'Tab' })
    expect(input.selectionStart).toBe(9)

    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input).toHaveValue(serializeFormulaAst(original.ast))
    expect(formulaNode()).toEqual(original)
    expect(useEditorStore.getState().history.past).toHaveLength(historyBefore)
    expect(screen.getByText('已取消未应用的公式修改')).toBeInTheDocument()
  })

  it('groups a selected expression before applying a script template', () => {
    render(<PropertiesTab onReplaceImage={vi.fn()} />)
    const input = screen.getByRole('textbox', {
      name: '公式内容（线性输入）',
    }) as HTMLInputElement

    fireEvent.change(input, { target: { value: 'a+b' } })
    input.setSelectionRange(0, 3)
    fireEvent.click(screen.getByRole('button', { name: '上标' }))

    expect(input).toHaveValue('{a+b}^{□}')
    fireEvent.change(input, { target: { value: '{a+b}^{2}' } })
    fireEvent.click(screen.getByRole('button', { name: '应用公式' }))
    expect(formulaNode().ast).toEqual({
      type: 'script',
      base: {
        type: 'row',
        children: [
          { type: 'token', value: 'a' },
          { type: 'operator', value: '+' },
          { type: 'token', value: 'b' },
        ],
      },
      superscript: { type: 'token', value: '2' },
    })
  })

  it('keeps raw AST absent from simple authoring mode', () => {
    useEditorStore.setState({ editorMode: 'simple' })
    render(<PropertiesTab onReplaceImage={vi.fn()} />)
    expect(screen.getByTestId('formula-authoring-editor')).toBeInTheDocument()
    expect(screen.queryByTestId('formula-id')).not.toBeInTheDocument()
    expect(screen.queryByTestId('formula-ast-diagnostic')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: '公式结构' })).not.toBeInTheDocument()
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
