import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ColorInput } from '@/renderer/ui/ColorInput'
import { PropertyDraftBoundary } from '@/renderer/ui/properties/PropertyControls'

afterEach(cleanup)

it('cancels a continuous pointer gesture when focus moves before release', () => {
  const commit = vi.fn()
  const preview = vi.fn()
  render(<ColorInput id="probe" label="probe" value="#ffffff" onChange={commit} onPreviewChange={preview} />)
  fireEvent.click(screen.getByRole('button', { name: '连续调色' }))
  const slider = screen.getByRole('slider', { name: 'probe红通道' })
  slider.setPointerCapture = vi.fn()
  fireEvent.pointerDown(slider, { pointerId: 1 })
  fireEvent.change(slider, { target: { value: '0' } })
  expect(preview).toHaveBeenLastCalledWith('#00ffff')
  fireEvent.blur(slider)
  fireEvent.pointerUp(slider, { pointerId: 1 })
  expect(preview).toHaveBeenLastCalledWith(null)
  expect(commit).not.toHaveBeenCalled()
})

it('retires a color draft on target change while preserving the control DOM', () => {
  const commit = vi.fn()
  const before = vi.fn()
  const after = vi.fn()
  const view = (key: string, preview: typeof before) => <PropertyDraftBoundary bindingKey={key} onStale={() => {}}>
    <ColorInput id="probe" label="probe" value="#ffffff" onChange={commit} onPreviewChange={preview} />
  </PropertyDraftBoundary>
  const { rerender } = render(view('old', before))
  const picker = screen.getByLabelText('probe选择器')
  fireEvent.input(picker, { target: { value: '#123456' } })
  expect(before).toHaveBeenLastCalledWith('#123456')
  rerender(view('new', after))
  expect(screen.getByLabelText('probe选择器')).toBe(picker)
  expect(before).toHaveBeenLastCalledWith(null)
  fireEvent.change(picker, { target: { value: '#123456' } })
  expect(commit).not.toHaveBeenCalled()
  expect(after).not.toHaveBeenCalled()
})

it('allows choosing the same preset again after an external Undo', () => {
  const commit = vi.fn()
  const { rerender } = render(<ColorInput id="probe" label="probe" value="#ffffff" onChange={commit} />)
  fireEvent.click(screen.getByRole('button', { name: '红色 #ef4444' }))
  expect(commit).toHaveBeenCalledTimes(1)
  rerender(<ColorInput id="probe" label="probe" value="#ef4444" onChange={commit} />)
  // A normal undo updates the controlled value without remounting this target.
  rerender(<ColorInput id="probe" label="probe" value="#ffffff" onChange={commit} />)
  fireEvent.click(screen.getByRole('button', { name: '红色 #ef4444' }))
  expect(commit.mock.calls).toEqual([['#ef4444'], ['#ef4444']])
})

it('allows entering the same valid HEX after undoing that color', () => {
  const commit = vi.fn()
  const { rerender } = render(<ColorInput id="probe" label="probe" value="#ffffff" onChange={commit} />)
  const field = screen.getByLabelText('probe')
  field.focus()
  fireEvent.change(field, { target: { value: '#123456' } })
  fireEvent.keyDown(field, { key: 'Enter' })
  expect(commit).toHaveBeenCalledTimes(1)
  rerender(<ColorInput id="probe" label="probe" value="#123456" onChange={commit} />)
  rerender(<ColorInput id="probe" label="probe" value="#ffffff" onChange={commit} />)
  field.focus()
  fireEvent.change(field, { target: { value: '#123456' } })
  fireEvent.keyDown(field, { key: 'Enter' })
  expect(commit.mock.calls).toEqual([['#123456'], ['#123456']])
})
