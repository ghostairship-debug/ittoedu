import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AvailableComponentCatalogPackage,
  ComponentCatalogSnapshot,
} from '@/shared/componentCatalog'
import type { ComponentPackageData } from '@/shared/componentTypes'
import { ComponentsTab } from '@/renderer/ui/ComponentsTab'
import { useEditorStore,
  selectActiveCourseProjectDocument,
  selectSlideSceneList,
} from '@/renderer/store/editorStore'

const entry: AvailableComponentCatalogPackage = {
  packageId: 'com.example.catalog-card',
  version: '2.0.0',
  name: '目录卡片',
  description: '按需嵌入的目录卡片',
  subject: [],
  schoolStage: [],
  tags: ['card'],
  category: '视觉容器',
  packagePath: 'packages/card.h5component',
  thumbnailPath: 'thumbnails/card.svg',
  thumbnailDataUrl: 'data:image/svg+xml;base64,PHN2Zy8+',
  sha256: 'a'.repeat(64),
  componentSchemaVersion: 4,
  runtimeApiVersion: 4,
  renderMode: 'dom',
  supportedScopes: ['scene'],
  quality: 'experimental',
  maintainer: 'unassigned',
  verifiedCases: [],
  license: { status: 'unknown' },
  releaseBlockers: ['license-unverified'],
  sourceId: 'source:test',
  sourceLabel: '测试目录',
  sourceTrust: 'built-in',
}

const catalog: ComponentCatalogSnapshot = {
  sources: [{
    sourceId: entry.sourceId,
    label: entry.sourceLabel,
    trust: entry.sourceTrust,
    packageCount: 1,
  }],
  packages: [entry],
  issues: [],
}

const originalCanvasGetContext = HTMLCanvasElement.prototype.getContext

function embedded(version: string): ComponentPackageData {
  return {
    manifest: {
      schemaVersion: 4,
      runtimeApiVersion: 4,
      renderMode: 'dom',
      supportedScopes: ['scene'],
      id: entry.packageId,
      name: entry.name,
      version,
      entry: 'runtime.js',
      defaultSize: { width: 320, height: 180 },
      minSize: { width: 160, height: 90 },
      preserveAspectRatio: false,
      assets: {},
      defaultProps: { content: { title: '卡片' } },
    },
    runtimeSource: 'CoursewareComponent.define({ runtimeApiVersion: 4 })',
    files: {},
    provenance: {
      sha256: 'b'.repeat(64),
      importedAt: '2026-08-10T00:00:00.000Z',
      sourceLabel: '旧目录',
    },
  }
}

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof originalCanvasGetContext
  useEditorStore.getState().createNewProject()
  useEditorStore.setState({ editorMode: 'professional' })
})

afterEach(() => {
  cleanup()
  HTMLCanvasElement.prototype.getContext = originalCanvasGetContext
})

describe('组件目录 UI', () => {
  it('keeps the library and selection open while an async batch is pending or cancelled', async () => {
    let finish: ((completed: boolean) => void) | undefined
    const onAdd = vi.fn(() => new Promise<boolean>((resolve) => {
      finish = resolve
    }))
    render(
      <ComponentsTab
        componentCatalog={catalog}
        onAddCatalogComponents={onAdd}
      />,
    )
    fireEvent.click(screen.getByTestId('open-component-library'))
    fireEvent.click(screen.getByRole('checkbox', { name: '选择目录卡片' }))
    fireEvent.click(screen.getByRole('button', { name: '加入工程（1）' }))

    expect(screen.getByTestId('component-library')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '返回编辑器' })).toBeDisabled()
    await act(async () => finish?.(false))
    await waitFor(() => expect(screen.getByRole('button', { name: '返回编辑器' })).toBeEnabled())
    expect(screen.getByRole('checkbox', { name: '选择目录卡片' })).toBeChecked()
  })

  it('inserts an embedded package repeatedly without invoking catalog trust or reads', () => {
    useEditorStore.getState().importComponentPackage(embedded('2.0.0'))
    const onAddCatalogComponents = vi.fn()
    render(
      <ComponentsTab
        componentCatalog={catalog}
        onAddCatalogComponents={onAddCatalogComponents}
      />,
    )

    const projectCard = screen.getByTestId(`component-${entry.packageId}`)
    for (let index = 0; index < 10; index += 1) fireEvent.click(projectCard)

    expect(selectSlideSceneList(useEditorStore.getState())[0]!.nodes).toHaveLength(10)
    expect(onAddCatalogComponents).not.toHaveBeenCalled()
    expect(useEditorStore.getState().activeTab).toBe('components')
  })

  it('浏览时不嵌入，点击后把精确目录条目交给按需嵌入流程', () => {
    const onAdd = vi.fn()
    render(
      <ComponentsTab
        componentCatalog={catalog}
        onAddCatalogComponents={onAdd}
        onRefreshComponentCatalog={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByTestId('open-component-library'))

    expect(useEditorStore.getState().componentPackages[entry.packageId]).toBeUndefined()
    const card = screen.getByTestId(`catalog-component-${entry.packageId}`)
    expect(card).toHaveTextContent('可加入工程')
    expect(card).toHaveTextContent('试验')
    expect(card).not.toHaveTextContent('发布阻断')
    fireEvent.click(screen.getByRole('button', { name: '详情' }))
    expect(screen.getByTestId('component-details-dialog')).toHaveTextContent(
      'license-unverified',
    )
    fireEvent.click(screen.getByRole('button', { name: '关闭组件详情' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '选择目录卡片' }))
    fireEvent.click(screen.getByRole('button', { name: '加入工程（1）' }))
    expect(onAdd).toHaveBeenCalledWith([entry])
    expect(useEditorStore.getState().componentPackages[entry.packageId]).toBeUndefined()
  })

  it('对已嵌入旧版本只提示更新，不静默替换', () => {
    useEditorStore.getState().importComponentPackage(embedded('1.0.0'))
    const onUpdate = vi.fn()
    render(
      <ComponentsTab
        componentCatalog={catalog}
        onAddCatalogComponents={vi.fn()}
        onUpdateCatalogComponent={onUpdate}
      />,
    )
    fireEvent.click(screen.getByTestId('open-component-library'))

    expect(screen.getByTestId(`catalog-component-${entry.packageId}`))
      .toHaveTextContent('有新版本')
    expect(useEditorStore.getState().componentPackages[entry.packageId]?.manifest.version)
      .toBe('1.0.0')
    fireEvent.click(screen.getByRole('button', { name: '审阅更新' }))
    expect(onUpdate).toHaveBeenCalledWith(entry)
    expect(useEditorStore.getState().componentPackages[entry.packageId]?.manifest.version)
      .toBe('1.0.0')
  })
})
