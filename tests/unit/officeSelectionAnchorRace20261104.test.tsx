// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { OfficeSelectionHost, OfficeSelectionTools } from '../../src/renderer/documentFiles/office/OfficeSelectionTools'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

test('a new Office selection does not expose the old toolbar over the next click', () => {
  const frames = new Map<number, FrameRequestCallback>(); let next = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++next, callback); return next })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(266)
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(34)
  const viewport = document.createElement('div'); document.body.append(viewport)
  viewport.getBoundingClientRect = () => ({ left: 400, top: 280, right: 1200, bottom: 800, width: 800, height: 520, x: 400, y: 280, toJSON() {} })
  const selection = { scope: 'object' as const, focus: { page: 0, shapeIds: ['one'] }, label: 'object' }
  const renderTools = (identity: string, top: number) => <OfficeSelectionHost.Provider value={{ path: 'deck.pptx', prepare: async () => true }}>
    <OfficeSelectionTools active selection={selection} selectionKey={identity} viewport={() => viewport}
      measure={() => ({ left: 427, top, width: 289, height: 58 })} aboveOffset={32} />
  </OfficeSelectionHost.Provider>
  const runFrame = () => { const pending = [...frames.values()]; frames.clear(); act(() => pending.forEach(fn => fn(0))) }
  const view = render(renderTools('shape', 398)); runFrame()
  const oldBar = screen.getByRole('toolbar', { name: '选中内容快捷工具' }).parentElement!
  expect(Number.parseFloat(oldBar.style.top)).toBe(332)
  // The old bar spans y=332..366, including the next text click at (478, 340).
  view.rerender(renderTools('text', 312))
  expect(screen.queryByRole('toolbar', { name: '选中内容快捷工具' })).toBeNull()
  runFrame()
  const newBar = screen.getByRole('toolbar', { name: '选中内容快捷工具' }).parentElement!
  const top = Number.parseFloat(newBar.style.top), left = Number.parseFloat(newBar.style.left)
  expect(left > 478 || left + 266 < 478 || top > 340 || top + 34 < 340).toBe(true)
  expect(screen.getByRole('button', { name: 'AI 修改' })).toBeEnabled()
  viewport.remove()
})
