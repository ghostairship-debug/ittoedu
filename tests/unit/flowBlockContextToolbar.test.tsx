import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  FlowBlockContextToolbar,
  type FlowBlockContextToolbarProps,
} from '../../src/renderer/ui/FlowBlockContextToolbar'
import type { FlowTextEditSession } from '../../src/renderer/authoring/flowTextEdit'

describe('FlowBlockContextToolbar', () => {
  afterEach(() => {
    cleanup()
  })

  function renderToolbar(
    propsOverrides: Partial<FlowBlockContextToolbarProps> = {},
  ) {
    const onCommand = vi.fn()
    const onPreserveSelection = vi.fn()

    const defaultProps: FlowBlockContextToolbarProps = {
      block: {
        type: 'paragraph',
      },
      edit: {
        kind: 'rich-text',
        blockId: 'p-1',
        original: { text: 'Hello World', runs: [] },
        draft: { text: 'Hello World', runs: [] },
        range: { start: 0, end: 5 },
        cursor: 5,
        composing: false,
      } as FlowTextEditSession,
      placement: 'below',
      onCommand,
      onPreserveSelection,
    }

    const props = { ...defaultProps, ...propsOverrides }
    const result = render(<FlowBlockContextToolbar {...props} />)
    return { ...result, onCommand, onPreserveSelection }
  }

  it('renders font family select and font size input when showRangeTools is true', () => {
    renderToolbar()

    const fontFamilySelect = screen.getByTestId('flow-toolbar-font-family')
    expect(fontFamilySelect).toBeTruthy()
    expect(fontFamilySelect.tagName).toBe('SELECT')
    expect(screen.getByLabelText('字体')).toBe(fontFamilySelect)

    const fontSizeInput = screen.getByTestId('flow-toolbar-font-size')
    expect(fontSizeInput).toBeTruthy()
    expect(fontSizeInput.tagName).toBe('INPUT')
    expect(screen.getByLabelText('字号')).toBe(fontSizeInput)
  })

  it('triggers onCommand with range-style fontFamily when font family is selected', () => {
    const { onCommand } = renderToolbar()

    const fontFamilySelect = screen.getByTestId('flow-toolbar-font-family')
    fireEvent.change(fontFamilySelect, { target: { value: 'KaiTi' } })

    expect(onCommand).toHaveBeenCalledWith({
      type: 'range-style',
      style: { fontFamily: 'KaiTi' },
    })
  })

  it('triggers onCommand with range-style fontSize on enter key and blur', () => {
    const { onCommand } = renderToolbar()

    const fontSizeInput = screen.getByTestId('flow-toolbar-font-size')

    fireEvent.change(fontSizeInput, { target: { value: '28' } })
    fireEvent.keyDown(fontSizeInput, { key: 'Enter' })

    expect(onCommand).toHaveBeenCalledWith({
      type: 'range-style',
      style: { fontSize: 28 },
    })

    onCommand.mockClear()

    fireEvent.change(fontSizeInput, { target: { value: '36' } })
    fireEvent.blur(fontSizeInput)

    expect(onCommand).toHaveBeenCalledWith({
      type: 'range-style',
      style: { fontSize: 36 },
    })
  })

  it('does not trigger onCommand when font size input is empty or invalid', () => {
    const { onCommand } = renderToolbar()

    const fontSizeInput = screen.getByTestId('flow-toolbar-font-size')

    fireEvent.change(fontSizeInput, { target: { value: '' } })
    fireEvent.keyDown(fontSizeInput, { key: 'Enter' })
    fireEvent.blur(fontSizeInput)

    expect(onCommand).not.toHaveBeenCalled()
  })

  it('does not render range tools when edit is null or not rich-text', () => {
    renderToolbar({ edit: null })

    expect(screen.queryByTestId('flow-range-toolbar')).toBeNull()
    expect(screen.queryByTestId('flow-toolbar-font-family')).toBeNull()
    expect(screen.queryByTestId('flow-toolbar-font-size')).toBeNull()
  })
})

