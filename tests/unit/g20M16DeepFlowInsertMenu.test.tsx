import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ElementsTab } from '@/renderer/ui/ElementsTab'
import { MediaTab } from '@/renderer/ui/MediaTab'
import { ComponentsTab } from '@/renderer/ui/ComponentsTab'
import { useEditorStore } from '@/renderer/store/editorStore'
import { selectFlowGlobalScope } from '@/renderer/course/flowEditorSlice'
import { componentContentSha256 } from '@/shared/componentContentIntegrity'
import type { ComponentPackageData } from '@/shared/componentTypes'
import type { AssetMeta } from '@/shared/contracts/media-v1'
import { connectAssignedCourse, settleAssignedCourse } from '../helpers/triage-t5-courseHost'

const image: AssetMeta = { id: 'flow-image', filename: 'diagram.png', mimeType: 'image/png', kind: 'image', path: 'assets/diagram.png', byteLength: 8, width: 2, height: 2 }
const video: AssetMeta = { id: 'flow-video', filename: 'film.mp4', mimeType: 'video/mp4', kind: 'video', path: 'assets/film.mp4', byteLength: 8, width: 2, height: 2 }
const originalGetContext = HTMLCanvasElement.prototype.getContext

beforeEach(async () => {
  await connectAssignedCourse('flow')
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof originalGetContext
  vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:flow-insert', revokeObjectURL: () => undefined })
})
afterEach(() => { cleanup(); HTMLCanvasElement.prototype.getContext = originalGetContext; vi.unstubAllGlobals() })

function packageData(): ComponentPackageData {
  const manifest: ComponentPackageData['manifest'] = {
    schemaVersion: 4, runtimeApiVersion: 4, id: 'com.example.flow-insert', name: '纸面组件', version: '1.0.0',
    entry: 'runtime.js', defaultSize: { width: 320, height: 180 }, minSize: { width: 100, height: 80 },
    preserveAspectRatio: false, assets: {}, defaultProps: {}, supportedScopes: ['scene'], renderMode: 'phaser',
    presets: [{ id: 'preset-a', label: '方案 A', props: { title: 'A' } }],
  }
  const runtimeSource = 'window.CoursewareComponent.define({id:"com.example.flow-insert",runtimeApiVersion:4,create:function(){return{destroy:function(){}}}})'
  const files = { 'manifest.json': new TextEncoder().encode(JSON.stringify(manifest)), 'runtime.js': new TextEncoder().encode(runtimeSource) }
  return { manifest, runtimeSource, files, contentSha256: componentContentSha256(files) }
}

describe('M16 deep editor Flow insertion', () => {
  it('uses the shared 11 document and 4 paper commands, including both image destinations', () => {
    const onFlowInsert = vi.fn()
    render(<ElementsTab onAddImage={vi.fn()} onImportAudio={vi.fn()} onImportVideo={vi.fn()} onFlowInsert={onFlowInsert} />)
    const body = screen.getByRole('region', { name: '插入到正文' })
    const paper = screen.getByRole('region', { name: '放到纸面上' })
    expect(within(body).getAllByRole('menuitem')).toHaveLength(11)
    expect(within(paper).getAllByRole('menuitem')).toHaveLength(4)
    fireEvent.click(within(body).getByRole('menuitem', { name: '图片' }))
    fireEvent.click(within(paper).getByRole('menuitem', { name: '图片' }))
    expect(onFlowInsert.mock.calls.map(([command]) => [command.destination, command.kind])).toEqual([
      ['document', 'image'], ['paper', 'image'],
    ])
    expect(screen.queryByTestId('add-text')).toBeNull()
    expect(screen.queryByText('Runtime')).toBeNull()
  })

  it('keeps the existing Flow body chart picker when the command port is present', async () => {
    const onFlowInsert = vi.fn()
    render(<ElementsTab onAddImage={vi.fn()} onFlowInsert={onFlowInsert} />)
    fireEvent.click(screen.getByTestId('add-chart'))
    expect(screen.getByTestId('chart-picker-panel')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('add-chart-bar'))
    await settleAssignedCourse()
    const surface = useEditorStore.getState().flowSession!.history.present.surfaces.find(entry => entry.type === 'flow')!
    expect(surface.blocks).toContainEqual(expect.objectContaining({ type: 'chart', chart: expect.objectContaining({ chartType: 'bar' }) }))
    expect(onFlowInsert).not.toHaveBeenCalled()
  })

  it('passes actual library asset IDs through the same command port', async () => {
    useEditorStore.getState().importAsset(image, new Uint8Array(8))
    useEditorStore.getState().importAsset(video, new Uint8Array(8))
    await settleAssignedCourse()
    const onFlowInsert = vi.fn()
    render(<MediaTab onImportAudio={vi.fn()} onImportVideo={vi.fn()} onFlowInsert={onFlowInsert} />)
    fireEvent.click(screen.getByTestId('insert-flow-media-flow-image'))
    fireEvent.click(screen.getByTestId('insert-flow-overlay-flow-image'))
    fireEvent.click(screen.getByTestId('insert-flow-media-flow-video'))
    expect(onFlowInsert.mock.calls.map(([command, payload]) => [command.destination, command.kind, payload.assetId])).toEqual([
      ['document', 'image', image.id], ['paper', 'image', image.id], ['document', 'video', video.id],
    ])
    expect(screen.queryByTestId('insert-flow-overlay-flow-video')).toBeNull()
  })

  it('passes actual component package and preset IDs through both destinations', async () => {
    const pkg = packageData()
    useEditorStore.getState().importComponentPackage(pkg)
    await settleAssignedCourse()
    const onFlowInsert = vi.fn()
    render(<ComponentsTab onFlowInsert={onFlowInsert} />)
    fireEvent.click(screen.getByTestId(`component-${pkg.manifest.id}`))
    fireEvent.click(screen.getByRole('button', { name: '将纸面组件放到纸面上' }))
    fireEvent.click(within(screen.getByLabelText('纸面组件预设')).getByRole('button', { name: '方案 A' }))
    fireEvent.click(screen.getByRole('button', { name: '将方案 A 放到纸面上' }))
    expect(onFlowInsert.mock.calls.map(([command, payload]) => [command.destination, command.kind, payload.packageId, payload.presetId])).toEqual([
      ['document', 'component', pkg.manifest.id, undefined],
      ['paper', 'component', pkg.manifest.id, undefined],
      ['document', 'component', pkg.manifest.id, 'preset-a'],
      ['paper', 'component', pkg.manifest.id, 'preset-a'],
    ])
  })

  it('leaves Flow without the port, Flow global, and Slide on their existing element entries', async () => {
    render(<ElementsTab onAddImage={vi.fn()} />)
    expect(screen.queryByRole('menu', { name: 'Flow 插入菜单' })).toBeNull()
    expect(screen.getByTestId('add-text')).toBeInTheDocument()
    cleanup()
    const project = useEditorStore.getState().flowSession!.history.present
    const location = project.locations.find(entry => entry.kind === 'flow-block')!
    useEditorStore.getState().applyFlowSelection(selectFlowGlobalScope(project, location.id))
    render(<ElementsTab onAddImage={vi.fn()} onFlowInsert={vi.fn()} />)
    expect(screen.queryByRole('region', { name: '插入到正文' })).toBeNull()
    expect(screen.getByTestId('add-text')).toBeInTheDocument()
    cleanup()
    await connectAssignedCourse('slide')
    render(<ElementsTab onAddImage={vi.fn()} onFlowInsert={vi.fn()} />)
    expect(screen.queryByRole('region', { name: '插入到正文' })).toBeNull()
    expect(screen.getByTestId('add-text')).toBeInTheDocument()
  })
})
