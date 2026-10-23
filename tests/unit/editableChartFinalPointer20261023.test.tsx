import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createChartLayerItem, createChartNode } from '@/core/tools/nativeNodeFactories'
import { EditableChartView } from '@/renderer/ui/EditableChartView'
import type { NativeChartContent } from '@/shared/contracts/native-v1'

beforeEach(() => {
  vi.stubGlobal('PointerEvent', class extends MouseEvent {
    readonly pointerId: number
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init)
      this.pointerId = init.pointerId ?? 1
    }
  })
})

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function chartFixture(height = 360) {
  const chart = createChartLayerItem(createChartNode({ chartType: 'bar' })).content.data as NativeChartContent
  const commit = vi.fn()
  render(<EditableChartView id="resize-chart" chart={chart} width={640} height={height} onHeightCommit={commit} />)
  const view = screen.getByTestId('editable-chart-view')
  vi.spyOn(view, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 320, height / 2))
  const handle = screen.getByRole('button', { name: '调整图表高度' })
  handle.setPointerCapture = vi.fn()
  return { view, handle, commit }
}

it.each([
  { moveY: undefined, upY: 150, expected: 460 },
  { moveY: 120, upY: 160, expected: 480 },
])('commits the final pointer Y at render scale after move $moveY', ({ moveY, upY, expected }) => {
  const { view, handle, commit } = chartFixture()
  fireEvent.pointerDown(handle, { pointerId: 1, clientY: 100 })
  if (moveY !== undefined) {
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: moveY })
    expect(view.style.aspectRatio).toBe('640 / 400')
  }
  expect(commit).not.toHaveBeenCalled()
  fireEvent.pointerUp(handle, { pointerId: 1, clientY: upY })
  expect(commit).toHaveBeenCalledExactlyOnceWith(expected)
  expect(view.style.aspectRatio).toBe('640 / 360')
})

it.each([360, 120])('keeps the original height %i when the pointer does not move', height => {
  const { view, handle, commit } = chartFixture(height)
  fireEvent.pointerDown(handle, { pointerId: 1, clientY: 100 })
  fireEvent.pointerUp(handle, { pointerId: 1, clientY: 100 })
  expect(commit).not.toHaveBeenCalled()
  expect(view.style.aspectRatio).toBe(`640 / ${height}`)
})

it('cancels a resize preview without committing on cancel or a later pointerup', () => {
  const { view, handle, commit } = chartFixture()
  fireEvent.pointerDown(handle, { pointerId: 1, clientY: 100 })
  fireEvent.pointerMove(handle, { pointerId: 1, clientY: 120 })
  expect(view.style.aspectRatio).toBe('640 / 400')
  fireEvent.pointerCancel(handle, { pointerId: 1 })
  expect(view.style.aspectRatio).toBe('640 / 360')
  fireEvent.pointerUp(handle, { pointerId: 1, clientY: 160 })
  expect(commit).not.toHaveBeenCalled()
})
