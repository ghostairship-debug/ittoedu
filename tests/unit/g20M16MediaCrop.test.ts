import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { flowMediaCropGeometry, flowMediaCropPatch } from '@/shared/flowMediaCrop'
import { clampCrop } from '@/renderer/editing/crop/imageCrop'
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

it('keeps uncropped image at its natural size and switches crop projection on and off', () => {
  const plain: FlowMediaBlock = { id: 'plain', type: 'media', mediaKind: 'image', assetId: 'original', layout: 'wide' }
  const props = { url: 'asset://original', source: { width: 1, height: 1 } }
  const view = render(createElement(FlowPaperMedia, { ...props, block: plain }))
  const image = view.container.querySelector('img')!
  expect(view.container.firstElementChild).toBe(image)
  expect(image.getAttribute('data-flow-media-kind')).toBe('image')
  expect(image.style.maxWidth).toBe('100%')
  expect(image.style.width).toBe('')
  expect(image.style.height).toBe('')
  expect(image.style.position).toBe('')

  view.rerender(createElement(FlowPaperMedia, { ...props, block }))
  const clipped = view.container.firstElementChild as HTMLElement
  expect(clipped.tagName).toBe('DIV')
  expect(clipped.style.aspectRatio).toBe('0.6 / 0.7')
  expect(clipped.querySelector('img')?.style.position).toBe('absolute')

  view.rerender(createElement(FlowPaperMedia, { ...props, block: plain }))
  expect(view.container.firstElementChild?.tagName).toBe('IMG')
  expect((view.container.firstElementChild as HTMLElement).style.width).toBe('')
})

it('matches Native edge bounds near 98 percent and preserves crop on body to Native round trip', () => {
  const nearEdge = { left: 0.99, top: 1, right: 0.4, bottom: 0.5 }
  const native = clampCrop(nearEdge)
  const flow = flowMediaCropPatch(nearEdge, 0.25, 0.75)
  expect(flow.crop).toEqual(native)
  expect(flow.cropX).toBe(0.25)
  expect(flow.cropY).toBe(0.75)
  const geometry = flowMediaCropGeometry({ width: 1000, height: 500 }, flow)
  expect(geometry.sourceRect).toEqual({ x: 980, y: 490, width: 20, height: 10 })
  const nativeAfterConversion = { crop: flow.crop!, cropX: flow.cropX!, cropY: flow.cropY! }
  const returned = flowMediaCropPatch(nativeAfterConversion.crop, nativeAfterConversion.cropX, nativeAfterConversion.cropY)
  expect(returned).toEqual(flow)
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
