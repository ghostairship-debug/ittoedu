import { testContainerInstance } from '../helpers/glxWorkFixture'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { SlideLightActions, SlideLightPageActions, slideLightMenuItems } from '../../src/renderer/editing/quickbar/SlideLightActions'
import { slideLightCommands, slideLightPageCommands } from '../../src/renderer/editing/commands/slideLightCommands'
import { SelectionQuickBar } from '../../src/renderer/editing/quickbar/SelectionQuickBar'
import { TextFormatActions } from '../../src/renderer/editing/quickbar/TextFormatActions'
import { authorSpotFormatView, authorSpotStylePatch } from '../../src/renderer/componentPlatform/surfaces/slide/authorSpotFormatting'
import { authorSpotStyleEdits } from '../../src/core/components/authoring/componentAuthorEdits'
import { applyComponentOperation, captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { WEB_DEFINITION } from '../../src/components/web/data'
import type { ComponentAuthorSpot } from '../../src/shared/contracts/component-platform'

afterEach(cleanup)

const commands = () => slideLightCommands({ isText: true, locked: false, clickBindable: true, sounds: [], locations: [], stateBackgroundOverride: false })
const bar = (children: React.ReactNode) => <SelectionQuickBar anchor={{ left: 100, top: 100, width: 100, height: 30 }}
  bounds={{ left: 0, top: 0, right: 800, bottom: 600 }} label="M22" selectionKey="one">{children}</SelectionQuickBar>

it('retains local nonzero line spacing when reselected and formatted again, with no paragraph alignment on an inline leaf', async () => {
  let project = createBlankCourseProjectV10('local text')
  project.definitions[WEB_DEFINITION.id] = WEB_DEFINITION
  project.instances.web = { id: 'web', definitionId: WEB_DEFINITION.id, data: { html: '<span>Text</span>' } }
  testContainerInstance(project, 0).childIds = ['web']
  const bounds = { width: 100, height: 30, transform: [1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number] }
  const spot: ComponentAuthorSpot = { kind: 'text', id: 'spot', authorKey: 'leaf', instanceId: 'web', mountGeneration: 1,
    initialValue: 'Text', bindingStatus: 'bound', binding: { kind: 'dom', path: [{ tag: 'span', index: 0 }], baseline: 'Text' },
    localBounds: bounds, geometry: { frame: bounds, parentToInstance: [1, 0, 0, 1, 0, 0], author: {}, boxInsets: { width: 0, height: 0 } },
    textStyle: { 'font-size': '20px', 'line-height': '24.4px' } }
  const apply = (patch: Parameters<typeof authorSpotStylePatch>[2]) => {
    const view = authorSpotFormatView(project, spot)!
    project = applyComponentOperation(project, captureComponentOperation(project, authorSpotStyleEdits(project, spot, authorSpotStylePatch(spot, view, patch))))
  }
  const draw = () => {
    const view = authorSpotFormatView(project, spot)!
    return bar(<><TextFormatActions view={view} alignment={view.alignment} patch={apply} />
      <SlideLightActions commands={commands().filter(command => command.kind === 'line-spacing')} fontFamily={null} lineSpacing={view.style.lineSpacing}
        backgroundColor={null} onRun={command => apply({ style: { lineSpacing: Number(command.value) } })} /></>)
  }
  let ui = render(draw())
  expect(screen.queryByRole('button', { name: /点按切换为/ })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '行距' }))
  await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: /宽松（额外 8 像素）/ })) })
  ui.unmount(); ui = render(draw())
  expect(authorSpotFormatView(project, spot)!.style.lineSpacing).toBe(8)
  fireEvent.click(screen.getByRole('button', { name: '加粗' }))
  ui.unmount(); render(draw())
  fireEvent.click(screen.getByRole('button', { name: '行距' }))
  expect(screen.getByRole('menuitem', { name: /宽松（额外 8 像素）/ }).textContent).toContain('✓')
  expect(authorSpotFormatView(project, { ...spot, geometry: undefined })).toBeNull()
})

it('M22 keeps direct font, spacing and page background entries on the same command descriptors as More', async () => {
  const run = vi.fn(async (_command: ReturnType<typeof commands>[number]) => {})
  const list = commands()
  const menu = slideLightMenuItems(list, command => { void run(command) })
  expect(menu.map(item => item.id)).toEqual(list.map(item => item.id))
  render(bar(<SlideLightActions commands={list} fontFamily={null} lineSpacing={4} backgroundColor="#ffffff" onRun={run} />))
  fireEvent.click(screen.getByRole('button', { name: '字体' }))
  const fonts = screen.getByRole('menu', { name: '字体' })
  expect(within(fonts).getAllByRole('menuitem').length).toBeGreaterThan(1)
  await act(async () => { fireEvent.click(within(fonts).getByRole('menuitem', { name: '字体：微软雅黑' })) })
  expect(run).toHaveBeenCalledWith(list.find(item => item.value === 'Microsoft YaHei'))
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
  expect(screen.queryByRole('button', { name: '字体' })).toBeNull()
  expect(screen.queryByRole('button', { name: '行距' })).toBeNull()
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
