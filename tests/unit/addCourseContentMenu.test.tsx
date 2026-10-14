import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AddCourseContentMenu } from '../../src/renderer/ui/AddCourseContentMenu'
import type { CourseEditorLayoutResult } from '../../src/renderer/course/courseEditorLayout'

afterEach(cleanup)

it.each([
  { kind: 'slide', primary: { action: 'scene', surfaceId: 'current' }, dropdown: ['flow-page', 'spatial-page'], activeSurfaceId: 'current' },
  { kind: 'flow', primary: { action: 'flow-page' }, dropdown: ['slide-page', 'spatial-page'], activeSurfaceId: 'current' },
  { kind: 'spatial', primary: { action: 'spatial-page' }, dropdown: ['slide-page', 'flow-page'], activeSurfaceId: 'current' },
] satisfies CourseEditorLayoutResult[])('offers one three-type menu in the $kind editor and preserves the original creation callbacks', layout => {
  const onPrimary = vi.fn(), onAddSlidePage = vi.fn(), onAddFlowPage = vi.fn(), onAddSpatialPage = vi.fn()
  render(<AddCourseContentMenu layout={layout} onPrimary={onPrimary} onAddSlidePage={onAddSlidePage}
    onAddFlowPage={onAddFlowPage} onAddSpatialPage={onAddSpatialPage} />)
  const trigger = screen.getByRole('button', { name: '新建页面' })
  expect(screen.getAllByRole('button')).toHaveLength(1)
  fireEvent.click(trigger)
  expect(onPrimary).not.toHaveBeenCalled()
  const menu = screen.getByRole('menu', { name: '新建页面' })
  expect(within(menu).getAllByRole('menuitem').map(item => item.getAttribute('aria-label'))).toEqual(['演示页', '流式页面', '无限画布'])
  fireEvent.click(trigger)
  expect(screen.queryByRole('menu')).toBeNull()
  const primaryKind = layout.primary.action === 'scene' ? 'slide-page' : layout.primary.action
  for (const [kind, label, callback] of [
    ['slide-page', '演示页', onAddSlidePage], ['flow-page', '流式页面', onAddFlowPage], ['spatial-page', '无限画布', onAddSpatialPage],
  ] as const) {
    fireEvent.click(trigger)
    fireEvent.click(within(screen.getByRole('menu', { name: '新建页面' })).getByRole('menuitem', { name: label }))
    expect(kind === primaryKind ? onPrimary : callback).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).toBeNull()
  }
  expect(primaryKind === 'slide-page' ? onAddSlidePage : primaryKind === 'flow-page' ? onAddFlowPage : onAddSpatialPage).not.toHaveBeenCalled()
})
