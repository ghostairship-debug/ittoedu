import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { flowMediaCropGeometry, flowMediaCropPatch } from '@/shared/flowMediaCrop'
import { clampCrop } from '@/shared/imageCrop'
import { FlowMediaCropEditor } from '@/renderer/ui/flow/FlowMediaCropEditor'
import { createImageData } from '@/components/image/data'
import type { ComponentInstance } from '@/shared/contracts/component-platform/project'

afterEach(cleanup)
const crop = { left: 0.1, top: 0.2, right: 0.3, bottom: 0.1 }

it('projects crop fractions and clamps extreme edges consistently for Flow delivery', () => {
  const result = flowMediaCropGeometry({ width: 1000, height: 500 }, { crop })
  expect(result.sourceRect).toEqual({ x: 100, y: 100, width: 600, height: 350 })
  expect(result.visibleRatio).toEqual({ x: 0.6, y: 0.7, area: 0.42 })
  expect(result.dom.wrapperAspectRatio).toBe('600 / 350')
  expect(result.dom.imageWidth).toBe(`${100 / 0.6}%`)
  const nearEdge = { left: 0.99, top: 1, right: 0.4, bottom: 0.5 }
  const flow = flowMediaCropPatch(nearEdge, 0.25, 0.75)
  expect(flow.crop).toEqual(clampCrop(nearEdge))
  expect(flowMediaCropGeometry({ width: 1000, height: 500 }, flow).sourceRect).toEqual({ x: 980, y: 490, width: 20, height: 10 })
  expect(flowMediaCropPatch(flow.crop!, flow.cropX, flow.cropY)).toEqual(flow)
})

it('previews original pixels, cancels without writes and submits one crop while confirmation is pending', async () => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const onConfirm = vi.fn(async () => { await gate }), onCancel = vi.fn()
  const imageData = { ...createImageData('original'), crop: clampCrop(crop) }
  const instance: ComponentInstance = { id: 'photo', definitionId: 'guoling.image', data: JSON.parse(JSON.stringify(imageData)) }
  const props = { instance, imageData, url: 'asset://original', onConfirm, onCancel }
  const view = render(createElement(FlowMediaCropEditor, props))
  expect(view.container.querySelector('img')?.getAttribute('src')).toBe('asset://original')
  fireEvent.change(screen.getByLabelText('左裁剪'), { target: { value: '0.2' } })
  fireEvent.click(screen.getByRole('button', { name: '取消' }))
  expect(onCancel).toHaveBeenCalledOnce(); expect(onConfirm).not.toHaveBeenCalled()
  view.unmount(); render(createElement(FlowMediaCropEditor, props))
  fireEvent.change(screen.getByLabelText('左裁剪'), { target: { value: '0.2' } })
  const confirm = screen.getByRole('button', { name: '确认裁剪' })
  fireEvent.click(confirm); fireEvent.click(confirm)
  expect(confirm).toBeDisabled(); expect(screen.getByLabelText('左裁剪')).toBeDisabled()
  expect(onConfirm).toHaveBeenCalledOnce()
  expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ crop: { left: 0.2, top: 0.2, right: 0.3, bottom: 0.1 } }))
  await act(async () => { release(); await gate })
  expect(imageData.assetId).toBe('original'); expect(imageData.crop).toEqual(crop)
})
