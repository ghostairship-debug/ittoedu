import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { FlowBlock } from '../../src/shared/courseProjectTypes'
import {
  applyFlowTextEditRunStyle,
  deriveFlowSelectionFormat,
  type FlowTextEditSession,
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
    text: 'Hello World',
    runs: [{ start: 0, end: 5, style: { bold: true, fontFamily: 'KaiTi', fontSize: 24 } }],
  }

  function richEdit(range: { start: number; end: number }): FlowTextEditSession {
    return {
      kind: 'rich-text',
      source: 'paper',
      blockId: 'p-1',
      surfaceId: 'flow',
      parentId: null,
      field: 'text',
      composing: false,
      pendingAction: null,
      revision: 1,
      original: { text: baseBlock.text, runs: structuredClone(baseBlock.runs ?? []) },
      draft: { text: baseBlock.text, runs: structuredClone(baseBlock.runs ?? []) },
      range,
    }
  }

  function renderToolbar(input: {
    block?: FlowBlock
    edit?: FlowTextEditSession | null
    props?: Partial<FlowBlockContextToolbarProps>
    hostWidth?: number
  } = {}) {
    const block = input.block ?? baseBlock
    const edit = input.edit === undefined ? richEdit({ start: 0, end: 5 }) : input.edit
    const onCommand = vi.fn()
    const onPreserveSelection = vi.fn()
    const props: FlowBlockContextToolbarProps = {
      block,
      selectionFormat: deriveFlowSelectionFormat({ block, edit }),
      placement: 'below',
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

  it('keeps one fixed primary geometry across caret, uniform range, mixed range, and whole block', () => {
    const wholeBlock: FlowBlock = {
      ...baseBlock,
      runs: [{
        start: 0,
        end: 11,
        style: { bold: true, fontFamily: 'KaiTi', fontSize: 24 },
      }],
    }
    const cases: Array<{
      block: FlowBlock
      edit: FlowTextEditSession | null
      mode: 'caret' | 'range' | 'whole-block'
      label: string
    }> = [
      { block: baseBlock, edit: richEdit({ start: 5, end: 5 }), mode: 'caret', label: '插入点' },
      { block: baseBlock, edit: richEdit({ start: 0, end: 5 }), mode: 'range', label: '选区' },
      { block: baseBlock, edit: richEdit({ start: 0, end: 11 }), mode: 'range', label: '混合格式' },
      { edit: null, block: wholeBlock, mode: 'whole-block', label: '整块' },
    ]

    for (const state of cases) {
      const rendered = renderToolbar({ block: state.block, edit: state.edit })
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
          : '选择文字后加粗'
      expect(screen.getByRole('button', { name: boldName })).toBeTruthy()
      if (state.mode === 'whole-block') {
        expect(screen.queryByRole('button', { name: '局部加粗' })).toBeNull()
      }
      rendered.unmount()
    }
  })

  it('shows derived mixed and active values instead of reading only the first run', () => {
    renderToolbar({ edit: richEdit({ start: 0, end: 11 }) })

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
    renderToolbar({ edit: richEdit({ start: 0, end: 5 }) })
    expect(screen.getByTestId('flow-toolbar-font-family')).toHaveValue('KaiTi')
    expect(screen.getByTestId('flow-toolbar-font-size')).toHaveValue(24)
    expect(screen.getByRole('button', { name: '局部加粗' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('writes range font controls and preserves the captured native selection', () => {
    const { onCommand, onPreserveSelection } = renderToolbar()

    fireEvent.pointerDown(screen.getByTestId('flow-toolbar-font-family'))
    fireEvent.change(screen.getByTestId('flow-toolbar-font-family'), {
      target: { value: 'SimSun' },
    })
    expect(onPreserveSelection).toHaveBeenCalled()
    expect(onCommand).toHaveBeenCalledWith({
      type: 'range-style',
      style: { fontFamily: 'SimSun' },
    })

    onCommand.mockClear()
    const fontSizeInput = screen.getByTestId('flow-toolbar-font-size')
    fireEvent.change(fontSizeInput, { target: { value: '28' } })
    fireEvent.keyDown(fontSizeInput, { key: 'Enter' })
    expect(onCommand).toHaveBeenCalledWith({
      type: 'range-style',
      style: { fontSize: 28 },
    })
  })

  it('keeps caret formatting display-only and explains how to enable writes', () => {
    const caretEdit = richEdit({ start: 5, end: 5 })
    const { onCommand } = renderToolbar({ edit: caretEdit })

    expect(screen.getByTestId('flow-toolbar-format-scope')).toHaveTextContent(
      '选择文字后应用',
    )
    expect(screen.getByTestId('flow-toolbar-font-family')).toHaveValue('KaiTi')
    expect(screen.getByTestId('flow-toolbar-font-family')).toBeDisabled()
    expect(screen.getByTestId('flow-toolbar-font-size')).toHaveValue(24)
    expect(screen.getByRole('button', { name: '选择文字后加粗' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '选择文字后加粗' }))
    expect(onCommand).not.toHaveBeenCalled()
    expect((applyFlowTextEditRunStyle(caretEdit, { italic: true }).draft as {
      runs: unknown[]
    }).runs).toEqual((caretEdit.draft as { runs: unknown[] }).runs)
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
      maxWidth: 'calc(100% - 16px)',
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
