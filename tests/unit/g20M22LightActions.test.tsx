import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { SlideLightActions, SlideLightPageActions, slideLightMenuItems } from '../../src/renderer/editing/quickbar/SlideLightActions'
import { slideLightCommands, slideLightPageCommands } from '../../src/renderer/editing/commands/slideLightCommands'
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

it('M22 page entry runs page commands without a selected item and shares disabled reasons', async () => {
  const list = slideLightPageCommands({ stateBackgroundOverride: true })
  const onRun = vi.fn(async (_command: typeof list[number]) => {})
  render(<SlideLightPageActions commands={list} backgroundColor={null} onRun={onRun} />)
  fireEvent.click(screen.getByRole('button', { name: '页面操作' }))
  const menu = screen.getByRole('menu', { name: '页面操作' })
  const background = within(menu).getByRole('menuitem', { name: /#ffffff/ })
  expect(background.getAttribute('aria-disabled')).toBe('true')
  expect(background.getAttribute('aria-description')).toContain('独立背景')
  fireEvent.click(background)
  expect(onRun).not.toHaveBeenCalled()
  await act(async () => { fireEvent.click(within(menu).getByRole('menuitem', { name: '放置音频' })) })
  expect(onRun).toHaveBeenCalledWith(list.find(command => command.kind === 'audio-import'))
})

it('M22 page entry reports rejection from the captured page action', async () => {
  const list = slideLightPageCommands({})
  const onError = vi.fn()
  const onRun = vi.fn(async () => { throw new Error('页面已切换') })
  render(<SlideLightPageActions commands={list} backgroundColor="#ffffff" onRun={onRun} onError={onError} />)
  fireEvent.click(screen.getByRole('button', { name: '页面操作' }))
  const selected = within(screen.getByRole('menu', { name: '页面操作' })).getByRole('menuitem', { name: /#ffffff/ })
  expect(selected.textContent).toContain('✓')
  await act(async () => { fireEvent.click(selected) })
  expect(screen.getByRole('alert').textContent).toBe('页面已切换')
  expect(onError).toHaveBeenCalledWith('页面已切换')
})
