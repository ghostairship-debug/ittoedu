import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createTextNode } from '@/core/tools/nativeNodeFactories'
import { rememberRecentColor } from '@/renderer/editing/color/recentColors'
import { TextEditOverlay } from '@/renderer/ui/TextEditOverlay'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear() })

it('M21 keeps the text colour and highlight palettes of text being edited apart: each shows its own recent colours', () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  const workspace = document.createElement('div'), canvas = document.createElement('canvas')
  workspace.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 1280, bottom: 720, width: 1280, height: 720, toJSON: () => ({}) })
  canvas.getBoundingClientRect = workspace.getBoundingClientRect
  rememberRecentColor('color', '#123456')
  render(<TextEditOverlay node={createTextNode({ text: '春风' })} workspace={workspace} canvas={canvas} onPreview={vi.fn()} onCommit={vi.fn()} onCancel={() => undefined} />)
  fireEvent.click(screen.getByRole('button', { name: '局部文字颜色' }))
  const colour = screen.getByRole('group', { name: '局部文字颜色' })
  expect(within(colour).getByRole('radiogroup', { name: '最近使用' })).toBeInTheDocument()
  fireEvent.click(within(colour).getByRole('button', { name: '更多颜色…' }))
  expect(within(colour).getByLabelText('自定义颜色')).toBeInTheDocument()
  // Switching to the highlight palette starts it fresh: no text colours as recent highlights, picker closed.
  fireEvent.click(screen.getByRole('button', { name: '局部高亮' }))
  const highlight = screen.getByRole('group', { name: '局部高亮' })
  expect(within(highlight).queryByRole('radiogroup', { name: '最近使用' })).toBeNull()
  expect(within(highlight).queryByLabelText('自定义颜色')).toBeNull()
  expect(within(highlight).getByRole('button', { name: '无高亮' })).toBeInTheDocument()
})
