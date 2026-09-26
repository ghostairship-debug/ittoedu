import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, expect, it } from 'vitest'
import { usePointerGesture } from '../../src/renderer/editing/quickbar/usePointerGesture'

afterEach(cleanup)

function Stage() {
  const [root, setRoot] = useState<HTMLElement | null>(null)
  const active = usePointerGesture(root)
  // Like the Slide stage: its React capture handler takes the press and stops it at the React root.
  return <main ref={setRoot} data-testid="stage" data-active={active} onPointerDownCapture={event => event.stopPropagation()}>
    <div data-testid="object" />
  </main>
}

it('M21 notices a drag on a stage whose own handler stops the press, and not presses elsewhere', () => {
  render(<><Stage /><button type="button">elsewhere</button></>)
  const stage = screen.getByTestId('stage')
  fireEvent.pointerDown(screen.getByTestId('object'), { button: 0 })
  expect(stage).toHaveAttribute('data-active', 'true')
  act(() => { window.dispatchEvent(new Event('pointerup')) })
  expect(stage).toHaveAttribute('data-active', 'false')
  fireEvent.pointerDown(screen.getByRole('button', { name: 'elsewhere' }), { button: 0 })
  expect(stage).toHaveAttribute('data-active', 'false')
})
