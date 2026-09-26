import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { flowMediaCropGeometry } from '@/shared/flowMediaCrop'
import { FlowMediaCropEditor } from '@/renderer/ui/flow/FlowMediaCropEditor'
import { FlowPaperMedia } from '@/renderer/ui/flow/FlowPaperMedia'
import type { FlowMediaBlock } from '@/shared/contracts/course-project-v9/types'

afterEach(cleanup)

const block: FlowMediaBlock = { id: 'photo', type: 'media', mediaKind: 'image', assetId: 'original', layout: 'wide', crop: { left: 0.1, top: 0.2, right: 0.3, bottom: 0.1 }, cropX: 0.5, cropY: 0.5 }

it('projects Native source fractions to one crop rectangle and clipped DOM drawing parameters', () => {
  const result = flowMediaCropGeometry({ width: 1000, height: 500 }, block)
  expect(result.sourceRect).toEqual({ x: 100, y: 100, width: 600, height: 350 })
  expect(result.visibleRatio).toEqual({ x: 0.6, y: 0.7, area: 0.42 })
  expect(result.dom.wrapperAspectRatio).toBe('600 / 350')
  expect(result.dom.imageWidth).toBe(`${100 / 0.6}%`)
  const { container } = render(createElement(FlowPaperMedia, { block, url: 'asset://original', source: { width: 1000, height: 500 } }))
  const image = container.querySelector('img')!
  expect(image.getAttribute('src')).toBe('asset://original')
  expect(image.parentElement?.style.aspectRatio).toBe('600 / 350')
})

it('keeps the original asset and commits crop exactly once only on confirm', () => {
  const onConfirm = vi.fn(), onCancel = vi.fn()
  const view = render(createElement(FlowMediaCropEditor, { block, url: 'asset://original', onConfirm, onCancel }))
  fireEvent.change(screen.getByLabelText('左裁剪'), { target: { value: '0.2' } })
  fireEvent.click(screen.getByRole('button', { name: '取消' }))
  expect(onCancel).toHaveBeenCalledOnce()
  expect(onConfirm).not.toHaveBeenCalled()
  view.rerender(createElement(FlowMediaCropEditor, { block, url: 'asset://original', onConfirm, onCancel }))
  fireEvent.change(screen.getByLabelText('左裁剪'), { target: { value: '0.2' } })
  fireEvent.click(screen.getByRole('button', { name: '确认裁剪' }))
  expect(onConfirm).toHaveBeenCalledOnce()
  expect(onConfirm.mock.calls[0]?.[0]).toMatchObject({ crop: { left: 0.2, top: 0.2, right: 0.3, bottom: 0.1 } })
  expect(block.assetId).toBe('original')
})
