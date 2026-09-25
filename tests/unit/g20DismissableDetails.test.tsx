import { useRef } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { useDismissableDetails } from '../../src/renderer/ui/useDismissableDetails'

afterEach(cleanup)

function Menu() {
  const ref = useRef<HTMLDetailsElement>(null)
  useDismissableDetails(ref)
  return <><button type="button">外面</button><details ref={ref} data-testid="menu"><summary>更多</summary><button type="button">搜索历史</button></details></>
}

it('closes a details menu on a press outside it or Escape, and keeps it open for presses inside', () => {
  render(<Menu />)
  const menu = screen.getByTestId('menu') as HTMLDetailsElement
  menu.open = true
  fireEvent.pointerDown(screen.getByRole('button', { name: '搜索历史' }))
  expect(menu.open).toBe(true)
  fireEvent.pointerDown(screen.getByRole('button', { name: '外面' }))
  expect(menu.open).toBe(false)
  menu.open = true
  fireEvent.keyDown(document.body, { key: 'Escape' })
  expect(menu.open).toBe(false)
})
