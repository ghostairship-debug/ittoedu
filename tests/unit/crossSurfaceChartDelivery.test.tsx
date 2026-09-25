import { buildPublishedFixture as buildPublishedCourseV2Payload } from '../fixtures/teacherController'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { strFromU8, unzipSync } from 'fflate'
import { createBlankFlowCourseProject } from '@/renderer/project/createFlowCourseProject'
import { createBlankSpatialCourseProject } from '@/renderer/project/createSpatialCourseProject'
import { createChartNode, createChartLayerItem } from '@/core/tools/nativeNodeFactories'
import { insertFlowEditorBlock, updateFlowEditorBlock, duplicateFlowEditorBlock, reorderFlowEditorBlock } from '@/renderer/course/flowEditorCommands'
import { openSpatialAuthoringSession, addSpatialWorldChartLayer, replaceSpatialWorldChart, undoSpatialAuthoring, setSpatialEditingScope } from '@/renderer/course/spatialEditorCommands'
import { duplicateSpatialLayers } from '@/renderer/course/spatialClipboardCommands'
import { changeChartType } from '@/renderer/course/chartContentOperations'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import { publishedCourseV2Schema } from '@/shared/publishedCourseSchema'

import { buildFlowPrintPlan, renderFlowPrintBodyHtml } from '@/renderer/export/course/flowPrintPlan'
import { buildFlowDocx } from '@/renderer/export/course/flowDocx'
import { FlowSurfaceHost } from '@/player/surfaces/flow/FlowSurfaceHost'
import { SpatialSurfaceHost } from '@/player/surfaces/spatial/SpatialSurfaceHost'
import { SlideNativeTypeFields } from '@/renderer/ui/properties/SlideNativePropertiesPanel'
import { createChartPropertiesCommands } from '@/renderer/ui/properties/chartPropertiesCommands'
import { EditableChartView } from '@/renderer/ui/EditableChartView'
import { buildSpatialEditorView, captureSpatialEditorAuthoringTarget } from '@/renderer/course/spatialEditorView'
import { chartCanvasTextPort, connectChartCanvasText } from '@/renderer/authoring/chartCanvasTextBridge'
import type { NativeChartContent } from '@/shared/contracts/native-v1'
import { projectWithBackgroundPreview, type BackgroundPreview } from '@/renderer/authoring/backgroundPreview'

const chartContent = (chartType: NativeChartContent['chartType']) => createChartLayerItem(createChartNode({ chartType })).content.data as NativeChartContent
const publish = (project: ReturnType<typeof createBlankFlowCourseProject>) => buildPublishedCourseV2Payload({ project, assetFiles: {}, components: {} })

it('projects a nested Flow chart color without mutating the document and drops stale or cancelled previews', () => {
  const project = createBlankFlowCourseProject()
  const surface = project.surfaces.find(surface => surface.type === 'flow')!
  const chart = chartContent('bar')
  const original = chart.style.textColor
  surface.blocks.push({ id: 'preview-section', type: 'section', title: { inlines: [{ type: 'text', text: '嵌套' }] }, collapsedByDefault: false, blocks: [{ id: 'preview-chart', type: 'chart', chart, height: 320 }] })
  const current = { locationId: project.startLocationId, stateId: null, generation: 3 }
  const preview: BackgroundPreview = { target: { ...current, projectId: project.id, revision: project.revision, owner: 'flow-chart', authoringAddress: 'preview-chart' }, color: '', nativeData: { style: { textColor: '#cc0000' } } }
  const projected = projectWithBackgroundPreview(project, preview, current)
  expect(projected.revision).toBe(project.revision)
  expect(chart.style.textColor).toBe(original)
  const nextSurface = projected.surfaces.find(surface => surface.type === 'flow')!
  const section = nextSurface.blocks.at(-1)!
  if (section.type !== 'section' || section.blocks[0]?.type !== 'chart') throw new Error('expected nested chart')
  expect(section.blocks[0].chart.style.textColor).toBe('#cc0000')
  expect(projectWithBackgroundPreview(project, null, current)).toBe(project)
  expect(projectWithBackgroundPreview(project, preview, { ...current, generation: 4 })).toBe(project)
  const revised = { ...project, revision: project.revision + 1 }
  expect(projectWithBackgroundPreview(revised, preview, current)).toBe(revised)
})
afterEach(cleanup)

describe('1.3 chart carriers', () => {
  it('connects Spatial frame and item targets to the same draft while rejecting stale identities', () => {
    const session = addSpatialWorldChartLayer(openSpatialAuthoringSession(createBlankSpatialCourseProject()), { id: 'bridge-chart' }).nextSession!
    const view = buildSpatialEditorView({ project: session.history.present, locationId: session.selection.locationId, sessionCamera: session.sessionCamera })
    const sessionToken = { surfaceType: 'spatial-2d' as const, locationId: view.locationId, revision: view.revision, generation: 1 }
    const capture = (field: 'frame' | 'item') => captureSpatialEditorAuthoringTarget({ view, sessionToken, target: { kind: 'layer', layerItemId: 'bridge-chart', field } })
    const inspector = capture('item')
    const canvas = capture('frame')
    expect(canvas.authoringAddress).not.toBe(inspector.authoringAddress)
    const port = { read: vi.fn(), commit: vi.fn(() => null) }
    const disconnect = connectChartCanvasText(inspector, port)
    try {
      expect(chartCanvasTextPort(canvas)).toBe(port)
      expect(chartCanvasTextPort({ ...canvas, documentRevision: canvas.documentRevision + 1 })).toBeUndefined()
      expect(chartCanvasTextPort({ ...canvas, itemId: 'other-chart' })).toBeUndefined()
    } finally { disconnect() }
    expect(chartCanvasTextPort(canvas)).toBeUndefined()
  })
  it.each(['bar', 'line', 'area', 'pie', 'donut'] as const)('keeps %s in nested Flow document order, copies identities, publishes and prints', async type => {
    const project = createBlankFlowCourseProject()
    const surface = project.surfaces.find(surface => surface.type === 'flow')!
    const section = { id: 'chart-section', type: 'section' as const, title: { inlines: [{ type: 'text' as const, text: '图表节' }] }, collapsedByDefault: false, blocks: [] }
    surface.blocks.push(section)
    const insertion = insertFlowEditorBlock(project, { surfaceId: surface.id, parentId: section.id, index: 0, block: { id: 'body-chart', type: 'chart', chart: chartContent(type), height: 400 } })
    expect(insertion.ok).toBe(true)
    const target = { surfaceId: surface.id, parentId: section.id, blockId: 'body-chart' }
    const edited = updateFlowEditorBlock(insertion.nextDocument!, target, block => { if (block.type === 'chart') block.chart.title = '编辑后标题' })
    const copy = duplicateFlowEditorBlock(edited.nextDocument!, target)
    expect(copy.ok).toBe(true)
    const copiedSurface = copy.nextDocument!.surfaces.find(surface => surface.type === 'flow')!
    const copiedSection = copiedSurface.blocks.find(block => block.id === section.id)!
    expect(copiedSection.type).toBe('section')
    if (copiedSection.type !== 'section') throw new Error('section')
    const [original, duplicate] = copiedSection.blocks
    if (original?.type !== 'chart' || duplicate?.type !== 'chart') throw new Error('chart')
    expect(duplicate.chart.categories[0]!.id).not.toBe(original.chart.categories[0]!.id)
    expect(duplicate.chart.series[0]!.points[0]!.id).not.toBe(original.chart.series[0]!.points[0]!.id)
    expect(reorderFlowEditorBlock(copy.nextDocument!, target, 1).ok).toBe(true)
    const reopened = courseProjectDocumentSchema.parse(JSON.parse(JSON.stringify(copy.nextDocument)))
    const published = publishedCourseV2Schema.parse(publish(reopened))
    const flow = published.surfaces.find(surface => surface.type === 'flow')!
    const plan = buildFlowPrintPlan(flow)
    expect(plan.nodes.filter(node => node.type === 'chart')).toHaveLength(2)
    expect(renderFlowPrintBodyHtml(plan)).toContain('编辑后标题')
    const host = new FlowSurfaceHost(published)
    const container = document.createElement('div')
    await host.mount(container); await host.activate()
    expect(container.querySelectorAll('[data-native-chart-id]')).toHaveLength(2)
    expect(container.querySelector('[data-native-chart-id="body-chart"]')?.parentElement?.style.position).not.toBe('absolute')
    await host.destroy()
  })

  it('writes a static DOCX image and editable data table, and rejects a missing image', () => {
    const project = createBlankFlowCourseProject()
    const surface = project.surfaces.find(surface => surface.type === 'flow')!
    const chart = chartContent('bar')
    chart.title = '销量图'
    surface.blocks.push({ id: 'sales', type: 'chart', chart, height: 360 })
    const payload = publish(project)
    expect(() => buildFlowDocx(payload, surface.id)).toThrow('缺少静态图面')
    const result = buildFlowDocx(payload, surface.id, { chartImages: new Map([['sales', { bytes: new Uint8Array([137,80,78,71,13,10,26,10]), mimeType: 'image/png' }]]) })
    const files = unzipSync(result.bytes)
    const xml = strFromU8(files['word/document.xml']!)
    expect(xml).toContain('图表数据（可编辑）')
    expect(xml).toContain(chart.categories[0]!.label)
    expect(xml).toContain('<w:tbl>')
    expect(xml).toContain('<a:blip r:embed=')
    expect(Object.keys(files).some(path => path.startsWith('word/media/chart'))).toBe(true)
    expect(result.report).toContainEqual(expect.objectContaining({ blockId: 'sales', disposition: 'fallback' }))
  })

  it.each(['bar', 'line', 'area', 'pie', 'donut'] as const)('edits %s in Spatial world, supports undo/copy and renders its published chart', async type => {
    const project = createBlankSpatialCourseProject()
    const initial = openSpatialAuthoringSession(project)
    const added = addSpatialWorldChartLayer(initial, { id: 'world-chart', chartType: type, x: -50, y: 120 })
    expect(added.ok).toBe(true)
    const session = added.nextSession!
    const world = session.history.present.surfaces.find(surface => surface.type === 'spatial-2d')!
    const item = world.world.layerItems.find(item => item.layerItemId === 'world-chart')!
    if (item.kind !== 'native' || item.content.nativeType !== 'chart') throw new Error('chart')
    expect(item.frame).toMatchObject({ x: -50, y: 120 })
    const changed = replaceSpatialWorldChart(session, item.layerItemId, changeChartType(item.content.data, 'donut', item.content.data.series[0]!.id))
    expect(changed.ok).toBe(true)
    expect(changed.nextSession!.history.past.length).toBe(session.history.past.length + 1)
    expect(undoSpatialAuthoring(changed.nextSession!).nextSession!.history.present).toEqual(session.history.present)
    const stale = replaceSpatialWorldChart(changed.nextSession!, item.layerItemId, item.content.data, { expectedRevision: session.history.present.revision })
    expect(stale.ok).toBe(false)
    expect(stale.nextSession!.history.present).toBe(changed.nextSession!.history.present)
    const duplicated = duplicateSpatialLayers(session, [item.layerItemId])
    expect(duplicated.ok).toBe(true)
    const copiedWorld = duplicated.nextSession!.history.present.surfaces.find(surface => surface.type === 'spatial-2d')!
    const copy = copiedWorld.world.layerItems.at(-1)!
    if (copy.kind !== 'native' || copy.content.nativeType !== 'chart') throw new Error('chart')
    expect(copy.content.data.categories[0]!.id).not.toBe(item.content.data.categories[0]!.id)
    const global = setSpatialEditingScope(session, 'global').nextSession!
    expect(addSpatialWorldChartLayer(global).ok).toBe(false)
    const payload = publishedCourseV2Schema.parse(publish(courseProjectDocumentSchema.parse(JSON.parse(JSON.stringify(session.history.present)))) )
    const host = SpatialSurfaceHost.fromPublishedCourse(payload, { width: 800, height: 450 })
    const container = document.createElement('div')
    await host.mount(container); await host.activate()
    expect(container.querySelector('[data-native-chart-id="world-chart"]')).not.toBeNull()
    await host.destroy()
  })

  it('edits a canvas category in one commit and cancels without writing', () => {
    const chart = chartContent('bar')
    const commit = vi.fn((_chart: NativeChartContent) => null)
    const { container } = render(<EditableChartView id="direct-chart" chart={chart} width={656} height={360} onCommit={commit} />)
    fireEvent.doubleClick(container.querySelector('[data-chart-category-id]')!)
    fireEvent.change(screen.getByLabelText('图表文字'), { target: { value: '画布分类' } })
    fireEvent.keyDown(screen.getByLabelText('图表文字'), { key: 'Enter' })
    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit.mock.calls[0]![0]).toMatchObject({ categories: [expect.objectContaining({ label: '画布分类' }), ...chart.categories.slice(1)] })
    fireEvent.doubleClick(container.querySelector('[data-chart-category-id]')!)
    fireEvent.change(screen.getByLabelText('图表文字'), { target: { value: '取消内容' } })
    fireEvent.keyDown(screen.getByLabelText('图表文字'), { key: 'Escape' })
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('retains the SVG label across selection rerenders so a second click can edit it', () => {
    const chart = chartContent('bar')
    const { container, rerender } = render(<EditableChartView id="stable-chart" chart={chart} width={656} height={360} onCommit={vi.fn()} />)
    const label = container.querySelector('[data-chart-category-id]')!
    fireEvent.click(label)
    rerender(<EditableChartView id="stable-chart" chart={structuredClone(chart)} width={656} height={360} onCommit={vi.fn()} />)
    expect(container.querySelector('[data-chart-category-id]')).toBe(label)
    fireEvent.doubleClick(label)
    expect(screen.getByLabelText('图表文字')).toHaveValue(chart.categories[0]!.label)
  })
  it('shows Spatial chart properties and commits clean chart values', () => {
    const node = createChartNode({ chartType: 'bar' })
    const chart = createChartLayerItem(node).content.data as NativeChartContent
    const commit = vi.fn((_chart: NativeChartContent) => null)
    render(<SlideNativeTypeFields node={node} update={vi.fn()} contentEditingEnabled spatialMode videoDiagnostics={[]} onReplaceImage={vi.fn()}
      textCommands={{ beginEdit: vi.fn(), commitEdit: vi.fn(), cancelEdit: vi.fn(), updateDraft: vi.fn(), toggleStyle: vi.fn() }} draftBindingKey="world-chart-properties" tableCommands={null}
      chartCommands={createChartPropertiesCommands(chart, commit, vi.fn())} />)
    expect(screen.getByTestId('chart-properties')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('图表标题'), { target: { value: '空间图表' } })
    fireEvent.blur(screen.getByLabelText('图表标题'))
    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit.mock.calls[0]![0]).toMatchObject({ title: '空间图表' })
    expect(commit.mock.calls[0]![0]).not.toHaveProperty('id')
  })

  it('uses SVG local coordinates under zoom and defers IME blur until composition ends', () => {
    const chart = chartContent('bar')
    const commit = vi.fn((_chart: NativeChartContent) => null)
    const { container } = render(<EditableChartView id="ime-chart" chart={chart} width={656} height={360} onCommit={commit} />)
    const label = container.querySelector('[data-chart-category-id]')!
    Object.defineProperty(label, 'getBBox', { value: () => ({ x: 120, y: 250, width: 40, height: 16 }) })
    Object.defineProperty(screen.getByTestId('editable-chart-view'), 'clientWidth', { value: 656 })
    fireEvent.doubleClick(label)
    const input = screen.getByLabelText('图表文字')
    expect(input.style.left).toBe('120px')
    expect(input.style.top).toBe('250px')
    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: 'pin' } })
    fireEvent.blur(input)
    expect(commit).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: '拼音' } })
    fireEvent.compositionEnd(input)
    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit.mock.calls[0]![0].categories[0]!.label).toBe('拼音')
  })

})
