import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { FlowBlock } from '../../src/shared/courseProjectTypes'
import {
  deriveFlowSelectionFormat,
} from '../../src/renderer/authoring/flowTextEdit'
import {
  FLOW_BLOCK_CONTEXT_TOOLBAR_CONTROL_HEIGHT,
  FLOW_BLOCK_CONTEXT_TOOLBAR_SCROLLBAR_RESERVE,
  FlowBlockContextToolbar,
  type FlowBlockContextToolbarProps,
} from '../../src/renderer/ui/FlowBlockContextToolbar'

describe('FlowBlockContextToolbar', () => {
  afterEach(() => {
    cleanup()
  })

  const baseBlock: Extract<FlowBlock, { type: 'paragraph' }> = {
    id: 'p-1',
    type: 'paragraph',
    content: { inlines: [{ type: 'text', text: 'Hello', style: { bold: true, fontFamily: 'KaiTi', fontSize: 24 } }, { type: 'text', text: ' World' }] },
  }

  function renderToolbar(input: {
    block?: FlowBlock
    range?: { start: number; end: number } | null
    props?: Partial<FlowBlockContextToolbarProps>
    hostWidth?: number
  } = {}) {
    const block = input.block ?? baseBlock
    const range = input.range === undefined ? { start: 0, end: 5 } : input.range
    const onCommand = vi.fn()
    const onPreserveSelection = vi.fn()
    const props: FlowBlockContextToolbarProps = {
      block,
      selectionFormat: deriveFlowSelectionFormat({ block, range }),
      onCommand,
      onPreserveSelection,
      ...input.props,
    }
    const result = render(
      <div data-testid="flow-toolbar-host" style={{ width: input.hostWidth ?? 900 }}>
        <FlowBlockContextToolbar {...props} />
      </div>,
    )
    return { ...result, onCommand, onPreserveSelection }
  }

  it('keeps one fixed primary geometry across uniform range, mixed range, and whole block', () => {
    const wholeBlock: FlowBlock = {
      ...baseBlock,
      content: { inlines: [{ type: 'text', text: 'Hello World', style: { bold: true, fontFamily: 'KaiTi', fontSize: 24 } }] },
    }
    const cases: Array<{
      block: FlowBlock
      range: { start: number; end: number } | null
      mode: 'range' | 'whole-block'
      label: string
    }> = [
      { block: baseBlock, range: { start: 0, end: 5 }, mode: 'range', label: '选区' },
      { block: baseBlock, range: { start: 0, end: 11 }, mode: 'range', label: '混合格式' },
      { range: null, block: wholeBlock, mode: 'whole-block', label: '整块' },
    ]

    for (const state of cases) {
      const rendered = renderToolbar({ block: state.block, range: state.range })
      const shell = screen.getByTestId('flow-block-context-toolbar')
      expect(shell).toHaveAttribute('data-flow-toolbar-layout', 'stable-primary')
      expect(shell).toHaveStyle({
        width: '440px',
        height: '54px',
        flexWrap: 'nowrap',
      })
      expect(screen.getByTestId('flow-range-toolbar')).toHaveStyle({
        height: '45px',
        flexWrap: 'nowrap',
        overflowX: 'auto',
      })
      expect(shell.querySelectorAll('[data-flow-primary-slot]')).toHaveLength(8)
      expect(screen.getByTestId('flow-toolbar-format-scope')).toHaveAttribute(
        'data-flow-format-mode',
        state.mode,
      )
      expect(screen.getByTestId('flow-toolbar-format-scope')).toHaveTextContent(state.label)
      const boldName = state.mode === 'range'
        ? '局部加粗'
        : state.mode === 'whole-block'
          ? '整块加粗'
          : '插入点加粗'
      expect(screen.getByRole('button', { name: boldName })).toBeTruthy()
      if (state.mode === 'whole-block') {
        expect(screen.queryByRole('button', { name: '局部加粗' })).toBeNull()
      }
      rendered.unmount()
    }
  })

  it('shows derived mixed and active values instead of reading only the first run', () => {
    renderToolbar({ range: { start: 0, end: 11 } })

    expect(screen.getByTestId('flow-toolbar-font-family')).toHaveAttribute(
      'data-format-state',
      'mixed',
    )
    expect(screen.getByTestId('flow-toolbar-font-size')).toHaveAttribute(
      'data-format-state',
      'mixed',
    )
    expect(screen.getByRole('button', { name: '局部加粗' })).toHaveAttribute('aria-pressed', 'mixed')
    expect(screen.getByTestId('flow-toolbar-format-scope')).toHaveTextContent('混合格式')

    cleanup()
    renderToolbar({ range: { start: 0, end: 5 } })
    expect(screen.getByTestId('flow-toolbar-font-family')).toHaveValue('KaiTi')
    expect(screen.getByTestId('flow-toolbar-font-size')).toHaveValue(24)
    expect(screen.getByRole('button', { name: '局部加粗' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('writes range font controls and preserves the captured native selection', () => {
    const { onCommand, onPreserveSelection } = renderToolbar()

    const fontFamily = screen.getByTestId('flow-toolbar-font-family')
    fireEvent.pointerDown(fontFamily)
    const familyMouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    fontFamily.dispatchEvent(familyMouseDown)
    expect(familyMouseDown.defaultPrevented).toBe(false)
    fontFamily.focus()
    expect(document.activeElement).toBe(fontFamily)
    fireEvent.change(fontFamily, {
      target: { value: 'SimSun' },
    })
    expect(onPreserveSelection).toHaveBeenCalled()
    expect(onCommand).toHaveBeenCalledWith({
      type: 'range-style',
      style: { fontFamily: 'SimSun' },
    })

    onCommand.mockClear()
    const fontSizeInput = screen.getByTestId('flow-toolbar-font-size')
    const sizeMouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    fontSizeInput.dispatchEvent(sizeMouseDown)
    expect(sizeMouseDown.defaultPrevented).toBe(false)
    fontSizeInput.focus()
    expect(document.activeElement).toBe(fontSizeInput)
    fireEvent.change(fontSizeInput, { target: { value: '28' } })
    expect(fireEvent.keyDown(fontSizeInput, { key: 'Enter' })).toBe(false)
    expect(onCommand).toHaveBeenCalledWith({
      type: 'range-style',
      style: { fontSize: 28 },
    })
    fireEvent.blur(fontSizeInput)
    expect(onCommand).toHaveBeenCalledTimes(1)
  })

  it('derives mixed text and math styles without changing canonical inline content', () => {
    const block: FlowBlock = { id: 'math-paragraph', type: 'paragraph', content: { inlines: [
      { type: 'text', text: '公式', style: { color: '#123456', bold: true } },
      { type: 'math', formulaId: 'm', latex: 'x', accessibleText: 'x', style: { color: '#abcdef' } },
    ] } }
    const original = structuredClone(block)
    const format = deriveFlowSelectionFormat({ block, range: { start: 0, end: 3 } })
    expect(format.fields.color.state).toBe('mixed')
    expect(format.fields.bold.state).toBe('mixed')
    expect(format.end).toBe(3)
    expect(block).toEqual(original)
  })

  it('puts low-frequency formatting and block commands in an absolute discoverable panel', () => {
    renderToolbar()
    expect(screen.queryByTestId('flow-toolbar-more-panel')).toBeNull()

    fireEvent.click(screen.getByTestId('flow-toolbar-more'))
    const panel = screen.getByTestId('flow-toolbar-more-panel')
    expect(panel).toHaveStyle({ position: 'absolute', top: '58px' })
    expect(screen.getByRole('button', { name: '删除线' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '清除选区格式' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '转为标题' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '删除块' })).toBeEnabled()
  })

  it('contains fixed primary slots with horizontal overflow in a narrow block', () => {
    renderToolbar({ hostWidth: 260 })
    expect(screen.getByTestId('flow-toolbar-host')).toHaveStyle({ width: '260px' })
    expect(screen.getByTestId('flow-block-context-toolbar')).toHaveStyle({
      maxWidth: '100%',
    })
    expect(screen.getByTestId('flow-range-toolbar')).toHaveStyle({
      overflowX: 'auto',
      overflowY: 'hidden',
    })
    const scroller = screen.getByTestId('flow-range-toolbar')
    const usableScrollerHeight = Number.parseFloat(scroller.style.height)
    const requiredScrollerHeight = FLOW_BLOCK_CONTEXT_TOOLBAR_CONTROL_HEIGHT +
      FLOW_BLOCK_CONTEXT_TOOLBAR_SCROLLBAR_RESERVE
    expect(usableScrollerHeight).toBeGreaterThanOrEqual(requiredScrollerHeight)
    const shellHeight = Number.parseFloat(
      screen.getByTestId('flow-block-context-toolbar').style.height,
    )
    const shellBorderAndPadding = 8
    expect(shellHeight - shellBorderAndPadding).toBeGreaterThanOrEqual(
      usableScrollerHeight,
    )
    expect(screen.getByTestId('flow-range-toolbar').querySelectorAll(
      '[data-flow-primary-slot]',
    )).toHaveLength(8)
  })
})
