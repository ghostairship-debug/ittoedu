import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { contentDockResizeSign, WorkbenchSplitter } from '../../src/renderer/lessonWorkspace/view/WorkbenchSplitter'

describe('content dock splitter sign', () => {
  it('uses positive delta for left and top, negative for right and bottom', () => {
    expect(contentDockResizeSign('left')).toBe(1)
    expect(contentDockResizeSign('top')).toBe(1)
    expect(contentDockResizeSign('right')).toBe(-1)
    expect(contentDockResizeSign('bottom')).toBe(-1)
  })

  it('applies keyboard nudges with the dock-edge sign', () => {
    const onResizeDelta = vi.fn()
    const { getByRole } = render(
      <WorkbenchSplitter label="调整内容区宽度" orientation="vertical" value={46} direction={contentDockResizeSign('right')} onResizeDelta={onResizeDelta} />,
    )
    fireEvent.keyDown(getByRole('separator'), { key: 'ArrowRight' })
    expect(onResizeDelta).toHaveBeenCalledWith(-16)
    fireEvent.keyDown(getByRole('separator'), { key: 'ArrowLeft' })
    expect(onResizeDelta).toHaveBeenCalledWith(16)
  })
})
