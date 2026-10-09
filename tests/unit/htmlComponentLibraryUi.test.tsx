import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { AvailableHtmlComponent, ComponentCatalogSnapshot } from '@/shared/componentCatalog'
import { ComponentLibraryDialog } from '@/renderer/ui/ComponentsTab'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const html = (overrides: Partial<AvailableHtmlComponent>): AvailableHtmlComponent => ({ format: 'guoling-html-component', formatVersion: 1,
  packageId: 'html-component.a1b2c3d4', version: '1.0.0', name: '公转模拟', description: '拖动地球观察四季', subject: ['地理'], schoolStage: [],
  tags: ['公转'], sourceCourse: '四季的成因.h5lesson', savedAt: '2026-10-04T08:00:00.000Z', assets: [],
  sourceId: 'component-catalog:mine', sourceLabel: '我的资产库', sourceTrust: 'trusted', entry: 'html-component.a1b2c3d4@1.0.0', removable: true, ...overrides })

it('lists the newest HTML components of every directory and deletes one from my library after confirmation', async () => {
  const remove = vi.fn(async () => ({ sources: [], packages: [], issues: [] }))
  vi.stubGlobal('desktopAPI', { deleteComponentCatalogHtmlComponent: remove })
  const onRefresh = vi.fn()
  const catalog: ComponentCatalogSnapshot = { sources: [], packages: [], issues: [], htmlComponents: [
    html({}), html({ version: '1.0.1', entry: 'html-component.a1b2c3d4@1.0.1' }),
    html({ packageId: 'html-component.ffff0000', name: '拼读卡片', description: '', sourceId: 'component-catalog:colleague', sourceLabel: '同事的组件',
      sourceTrust: 'prompt', entry: 'html-component.ffff0000@1.0.0', removable: false }),
  ] }
  render(<ComponentLibraryDialog catalog={catalog} components={{}} onClose={() => {}} onRefresh={onRefresh} />)
  const section = screen.getByRole('region', { name: 'HTML 组件' })
  const mine = within(section).getByTestId('html-component-html-component.a1b2c3d4')
  expect(mine.textContent).toContain('v1.0.1')
  expect(mine.textContent).toContain('来自 四季的成因.h5lesson')
  expect(within(within(section).getByTestId('html-component-html-component.ffff0000')).queryByRole('button')).toBeNull()

  fireEvent.click(within(mine).getByRole('button', { name: '删除' }))
  expect(remove).not.toHaveBeenCalled()
  fireEvent.click(within(mine).getByRole('button', { name: '确认删除' }))
  await waitFor(() => expect(onRefresh).toHaveBeenCalledOnce())
  expect(remove).toHaveBeenCalledWith({ sourceId: 'component-catalog:mine', entry: 'html-component.a1b2c3d4@1.0.1' })

  fireEvent.change(screen.getByRole('searchbox', { name: '搜索组件' }), { target: { value: '拼读' } })
  expect(within(screen.getByRole('region', { name: 'HTML 组件' })).queryByTestId('html-component-html-component.a1b2c3d4')).toBeNull()
})
