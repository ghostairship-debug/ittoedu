import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { SlideLightActions, slideLightMenuItems } from '../../src/renderer/editing/quickbar/SlideLightActions'
import { slideLightCommands } from '../../src/renderer/editing/commands/slideLightCommands'
import { SelectionQuickBar } from '../../src/renderer/editing/quickbar/SelectionQuickBar'

afterEach(cleanup)

const commands = () => slideLightCommands({ isText: true, locked: false, clickBindable: true, sounds: [], locations: [], stateBackgroundOverride: false })
const bar = (children: React.ReactNode) => <SelectionQuickBar anchor={{ left: 100, top: 100, width: 100, height: 30 }}
  bounds={{ left: 0, top: 0, right: 800, bottom: 600 }} label="M22" selectionKey="one">{children}</SelectionQuickBar>

it('M22 keeps direct font, spacing and page background entries on the same command descriptors as More', async () => {
  const run = vi.fn(async (_command: ReturnType<typeof commands>[number]) => {})
  const list = commands()
  const menu = slideLightMenuItems(list, command => { void run(command) })
  expect(menu.map(item => item.id)).toEqual(list.map(item => item.id))
  render(bar(<SlideLightActions commands={list} fontFamily={null} lineSpacing={4} backgroundColor="#ffffff" onRun={run} />))
  fireEvent.click(screen.getByRole('button', { name: '行距' }))
  const spacing = screen.getByRole('menu', { name: '行距' })
  expect(within(spacing).getByRole('menuitem', { name: /标准（额外 4 像素）/ }).textContent).toContain('✓')
  await act(async () => { fireEvent.click(within(spacing).getByRole('menuitem', { name: /宽松（额外 8 像素）/ })) })
  expect(run).toHaveBeenCalledWith(list.find(item => item.id === 'slide.spacing.8'))
  fireEvent.click(screen.getByRole('button', { name: '页面背景' }))
  expect(within(screen.getByRole('menu', { name: '页面背景' })).getByRole('menuitem', { name: /#ffffff/ }).textContent).toContain('✓')
})

it('M22 preserves disabled reason and reports command rejection in the quick bar', async () => {
  const list = slideLightCommands({ isText: false, locked: false, clickBindable: false, sounds: [], locations: [], stateBackgroundOverride: true })
  const onRun = vi.fn(async () => { throw new Error('目标已失效') })
  render(bar(<SlideLightActions commands={list} fontFamily={null} lineSpacing={null} backgroundColor={null} onRun={onRun} />))
  fireEvent.click(screen.getByRole('button', { name: '字体' }))
  expect(within(screen.getByRole('menu', { name: '字体' })).getAllByRole('menuitem')[0].getAttribute('aria-disabled')).toBe('true')
  fireEvent.click(screen.getByRole('button', { name: '字体' }))
  fireEvent.click(screen.getByRole('button', { name: '页面背景' }))
  expect(within(screen.getByRole('menu', { name: '页面背景' })).getAllByRole('menuitem')[0].getAttribute('aria-disabled')).toBe('true')
  cleanup()
  render(bar(<SlideLightActions commands={commands()} fontFamily={null} lineSpacing={null} backgroundColor={null} onRun={onRun} />))
  fireEvent.click(screen.getByRole('button', { name: '行距' }))
  await act(async () => { fireEvent.click(within(screen.getByRole('menu', { name: '行距' })).getAllByRole('menuitem')[0]) })
  expect(screen.getByRole('alert').textContent).toBe('目标已失效')
})
