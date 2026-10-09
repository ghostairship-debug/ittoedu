import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { ElementsTab } from '../../src/renderer/ui/ElementsTab'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import { chartDataSchema } from '../../src/components/chart/data'
import { createCourseDocumentHost } from '../helpers/courseDocumentHost'
const store = () => useEditorStore.getState()
beforeEach(async () => { const h = await createCourseDocumentHost(); await store().connectCourseDocuments(h.api); store().setEditingScope('scene') })
afterEach(() => { cleanup(); store().cancelTextEdit(); store().courseBridge.dispose() })

it('opens one Slide chart picker, cancels without writes, filters types, then commits a real selected chart once', async () => {
  render(<ElementsTab onAddImage={() => {}} />)
  expect(screen.queryByTestId('add-chart-bar')).not.toBeInTheDocument()
  const initial = store().courseView.snapshot!
  fireEvent.click(screen.getByTestId('add-chart'))
  for (const type of ['bar', 'line', 'area', 'pie', 'donut']) expect(screen.getByTestId(`add-chart-${type}`)).toBeInTheDocument()
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(screen.queryByTestId('chart-picker-panel')).not.toBeInTheDocument()
  expect(store().courseView.snapshot).toEqual(initial)
  fireEvent.change(screen.getByLabelText('搜索元素内容'), { target: { value: '折线图' } })
  expect(screen.getByTestId('add-chart-line')).toBeInTheDocument()
  expect(screen.queryByTestId('add-chart-bar')).not.toBeInTheDocument()
  expect(screen.queryByTestId('add-chart')).not.toBeInTheDocument()
  await act(async () => { fireEvent.click(screen.getByTestId('add-chart-line')); await store().courseBridge.drain() })
  const project = store().courseView.project!, id = store().courseView.selectedInstanceId!
  expect(project.surfaces[0].childIds).toContain(id)
  expect(chartDataSchema.parse(project.instances[id].data).chartType).toBe('line')
  expect(store().courseView.snapshot!.undoDepth).toBe(initial.undoDepth + 1)
})

it('inserts the picker choice into the real Flow body and undoes the one operation', async () => {
  await store().createCourseDocument('flow')
  const original = store().courseView.snapshot!
  render(<ElementsTab onAddImage={() => {}} />)
  fireEvent.click(screen.getByTestId('add-chart'))
  await act(async () => { fireEvent.click(screen.getByTestId('add-chart-bar')); await store().courseBridge.drain() })
  const project = store().courseView.project!, surface = project.surfaces[0], id = store().courseView.selectedInstanceId!
  expect(surface.kind).toBe('flow'); expect(surface.childIds).toContain(id)
  expect(chartDataSchema.parse(project.instances[id].data).chartType).toBe('bar')
  expect(project.instances[id].flowPlacement).toBeUndefined()
  expect(store().courseView.snapshot!.undoDepth).toBe(original.undoDepth + 1)
  await act(async () => { await store().courseBridge.undo(store().courseView.activeDocumentId!) })
  expect(store().courseView.project!.surfaces).toEqual(original.model.kind === 'course-v10' ? original.model.project.surfaces : [])
})
