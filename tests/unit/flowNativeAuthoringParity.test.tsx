import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SharedShapeProperties } from '@/renderer/ui/properties/SharedShapeProperties'
import { createShapeNode } from '@/core/tools/nativeNodeFactories'
import type { ShapeNode } from '@/shared/contracts/native-v1'

describe('SharedShapeProperties unit tests', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders rectangle shape properties with fill, stroke, and corner radius controls', () => {
    const update = vi.fn()
    const node: ShapeNode = createShapeNode('rectangle', {
      id: 'shape-1',
      name: '矩形',
      width: 200,
      height: 100,
      style: {
        fillColor: '#3b82f6',
        fillOpacity: 0.8,
        borderColor: '#1d4ed8',
        borderWidth: 2,
        lineStyle: 'solid',
        cornerRadius: 8,
      },
    })

    render(<SharedShapeProperties node={node} update={update} />)

    expect(screen.getByTestId('shape-properties')).toBeInTheDocument()
    expect(screen.queryByTestId('shape-stroke-only-hint')).toBeNull()

    // Change fill color
    const fillColorInput = screen.getByLabelText('填充色') as HTMLInputElement
    expect(fillColorInput.value).toBe('#3b82f6')
    fireEvent.change(fillColorInput, { target: { value: '#ef4444' } })
    fireEvent.blur(fillColorInput)
    expect(update).toHaveBeenCalledWith({ style: { fillColor: '#ef4444' } })

    // Change corner radius (which sets rounded-rectangle if > 0)
    const radiusInput = screen.getByLabelText('圆角') as HTMLInputElement
    expect(radiusInput.value).toBe('8')
    fireEvent.change(radiusInput, { target: { value: '16' } })
    fireEvent.blur(radiusInput)
    expect(update).toHaveBeenCalledWith({
      shapeType: 'rounded-rectangle',
      style: { cornerRadius: 16 },
    })
  })

  it('renders line shape properties with stroke-only hint and disables/hides fill and corner radius', () => {
    const update = vi.fn()
    const node: ShapeNode = createShapeNode('line', {
      id: 'line-1',
      name: '直线',
      width: 200,
      height: 20,
      style: {
        borderColor: '#10b981',
        borderWidth: 3,
        lineStyle: 'dashed',
        startArrow: 'none',
        endArrow: 'triangle',
      },
    })

    render(<SharedShapeProperties node={node} update={update} />)

    expect(screen.getByTestId('shape-properties')).toBeInTheDocument()
    // Stroke-only hint must be displayed for line
    expect(screen.getByTestId('shape-stroke-only-hint')).toBeInTheDocument()
    // Fill and corner radius should not be rendered for line
    expect(screen.queryByLabelText('填充色')).toBeNull()
    expect(screen.queryByLabelText('圆角')).toBeNull()

    // Arrow options should be rendered
    const startArrowSelect = screen.getByLabelText('起点箭头') as HTMLSelectElement
    expect(startArrowSelect.value).toBe('none')
    const endArrowSelect = screen.getByLabelText('终点箭头') as HTMLSelectElement
    expect(endArrowSelect.value).toBe('triangle')

    fireEvent.change(endArrowSelect, { target: { value: 'stealth' } })
    expect(update).toHaveBeenCalledWith({ style: { endArrow: 'stealth' } })
  })
})
