import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ComponentLibraryDialog } from '../../src/renderer/ui/ComponentsTab'
import type { AvailableComponentCatalogPackage } from '../../src/shared/componentCatalog'

afterEach(cleanup)
const entry: AvailableComponentCatalogPackage = {
  packageId: 'test.pinyin', version: '1.0.0', name: '测试拼音标注', description: '为文字标注拼音', subject: ['语文'], schoolStage: ['小学'], tags: ['拼音'],
  category: '语文标注', packagePath: 'pinyin.h5component', thumbnailPath: '', sha256: '', componentSchemaVersion: 2, runtimeApiVersion: 5,
  renderMode: 'dom', supportedScopes: ['scene'], quality: 'experimental', maintainer: 'test', verifiedCases: [], sourceKind: 'built-in',
  sourceId: 'bundled', sourceLabel: '应用组件', sourceTrust: 'prompt',
}
const catalog = { sources: [], packages: [entry], issues: [] }

it('browses purpose categories across sources and retains general content when filtering by subject and stage', () => {
  render(<ComponentLibraryDialog catalog={catalog} components={{}} onClose={vi.fn()} onAdd={vi.fn()} />)
  expect(screen.getByLabelText('选择测试拼音标注')).toBeEnabled()
  expect(screen.getByLabelText('选择教师控制台')).toBeEnabled()
  expect(screen.getByLabelText('选择淡入淡出转场')).toBeDisabled()
  fireEvent.change(screen.getByLabelText('筛选学科'), { target: { value: '语文' } })
  fireEvent.change(screen.getByLabelText('筛选学段'), { target: { value: '小学' } })
  expect(screen.getByLabelText('选择自主 Web 程序')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /内容与展示\s*2/ }))
  expect(screen.getByLabelText('选择测试拼音标注')).toBeInTheDocument()
  expect(screen.getByLabelText('选择可继续专业编辑的源码形状')).toBeInTheDocument()
  expect(screen.queryByLabelText('选择自主 Web 程序')).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('筛选来源'), { target: { value: 'built-in' } })
  expect(screen.getByLabelText('选择测试拼音标注')).toBeInTheDocument()
})

it('routes selected teacher, builtin and package together while retaining choices across purpose changes', async () => {
  const onAdd = vi.fn(async () => true), onClose = vi.fn()
  render(<ComponentLibraryDialog catalog={catalog} components={{}} onClose={onClose} onAdd={onAdd} />)
  fireEvent.click(screen.getByLabelText('选择自主 Web 程序'))
  fireEvent.click(screen.getByLabelText('选择教师控制台'))
  fireEvent.click(screen.getByRole('button', { name: /内容与展示\s*2/ }))
  fireEvent.click(screen.getByLabelText('选择测试拼音标注'))
  expect(screen.getByText('已选择 3 项')).toBeInTheDocument()
  expect(screen.getByText(/当前容器新增 2 项 · 整课全局层添加教师控制台/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '添加所选（3）' }))
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  expect(onAdd).toHaveBeenCalledExactlyOnceWith([entry], { builtInAssetIds: ['guoling.work.program'], includeTeacherController: true })
})

it('keeps an external package with missing labels usable while showing missing metadata honestly', () => {
  const external = { ...entry, sourceKind: 'external' as const, sourceId: 'external', sourceLabel: '外部目录', subject: [], schoolStage: [] }
  render(<ComponentLibraryDialog catalog={{ ...catalog, packages: [external] }} components={{}} onClose={vi.fn()} onAdd={vi.fn()} />)
  expect(screen.getByLabelText('选择测试拼音标注')).toBeEnabled()
  expect(screen.getByTestId('catalog-component-test.pinyin')).toHaveTextContent('学科未标注')
  fireEvent.click(screen.getByTestId('catalog-component-test.pinyin').querySelector('button')!)
  expect(screen.getByTestId('component-details-dialog')).toHaveTextContent('学段未标注')
})
