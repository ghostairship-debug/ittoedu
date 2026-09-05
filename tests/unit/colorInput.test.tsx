import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ColorInput, COMMON_COLOR_PRESETS } from '../../src/renderer/ui/ColorInput'

describe('ColorInput', () => {
  afterEach(() => {
    cleanup()
  })
  it('renders 12 preset color buttons with accessible names and values', () => {
    render(
      <ColorInput
        id="test-color"
        label="测试颜色"
        value="#ffffff"
        onChange={vi.fn()}
      />
    )

    expect(COMMON_COLOR_PRESETS).toHaveLength(12)
    for (const preset of COMMON_COLOR_PRESETS) {
      const hexClean = preset.value.replace('#', '')
      const btn = screen.getByTestId(`test-color-preset-${hexClean}`)
      expect(btn).toBeInTheDocument()
      expect(btn).toHaveAttribute('aria-label', `${preset.name} ${preset.value}`)
      expect(btn).toHaveAttribute('title', `${preset.name} (${preset.value})`)
    }
  })

  it('marks currently selected preset and shows check indicator', () => {
    render(
      <ColorInput
        id="test-color"
        label="测试颜色"
        value="#ef4444"
        onChange={vi.fn()}
      />
    )

    const redBtn = screen.getByTestId('test-color-preset-ef4444')
    expect(redBtn).toHaveAttribute('aria-current', 'true')
    expect(redBtn).toHaveAttribute('data-selected', 'true')
    expect(redBtn.textContent).toContain('✓')

    const whiteBtn = screen.getByTestId('test-color-preset-ffffff')
    expect(whiteBtn).not.toHaveAttribute('aria-current')
    expect(whiteBtn).not.toHaveAttribute('data-selected')
    expect(whiteBtn.textContent).not.toContain('✓')
  })

  it('calls onChange when clicking a different preset, but ignores already selected preset', () => {
    const onChange = vi.fn()
    render(
      <ColorInput
        id="test-color"
        label="测试颜色"
        value="#ffffff"
        onChange={onChange}
      />
    )

    // Click white (already selected) -> no-op
    const whiteBtn = screen.getByTestId('test-color-preset-ffffff')
    fireEvent.click(whiteBtn)
    expect(onChange).not.toHaveBeenCalled()

    // Click blue (#3b82f6) -> fires onChange once
    const blueBtn = screen.getByTestId('test-color-preset-3b82f6')
    fireEvent.click(blueBtn)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('#3b82f6')
  })

  it('commits valid hex text input on Enter or blur, and reverts on Escape', () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <ColorInput
        id="test-color"
        label="测试颜色"
        value="#ffffff"
        onChange={onChange}
      />
    )

    const input = screen.getByLabelText('测试颜色') as HTMLInputElement
    expect(input.value).toBe('#ffffff')

    // Type valid hex and hit Enter
    fireEvent.change(input, { target: { value: '#123456' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('#123456')

    rerender(
      <ColorInput
        id="test-color"
        label="测试颜色"
        value="#123456"
        onChange={onChange}
      />
    )

    // Blurring with same value does not re-commit
    fireEvent.blur(input)
    expect(onChange).toHaveBeenCalledTimes(1)

    // Type invalid text and press Escape -> reverts to value
    fireEvent.change(input, { target: { value: 'not-a-color' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input.value).toBe('#123456')
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('commits on native color picker change and provides preview on input', () => {
    const onChange = vi.fn()
    const onPreviewChange = vi.fn()
    render(
      <ColorInput
        id="test-color"
        label="测试颜色"
        value="#ffffff"
        onChange={onChange}
        onPreviewChange={onPreviewChange}
      />
    )

    const picker = screen.getByLabelText('测试颜色选择器') as HTMLInputElement

    // Simulate native input (dragging) -> updates preview only
    fireEvent.input(picker, { target: { value: '#ff8800' } })
    expect(onPreviewChange).toHaveBeenCalledWith('#ff8800')
    expect(onChange).not.toHaveBeenCalled()

    // Simulate native change (release / commit) -> commits once
    fireEvent.change(picker, { target: { value: '#ff8800' } })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('#ff8800')

    // Firing change with same value again -> no duplicate commit
    fireEvent.change(picker, { target: { value: '#ff8800' } })
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})
