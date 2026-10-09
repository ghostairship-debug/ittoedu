import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ImagePixelTransformProperties } from '../../src/renderer/ui/properties/ImagePixelTransformProperties'
afterEach(cleanup)
it('P0 sends exact pixel intent to the captured resource owner and retains controls after rejected ACK',async()=>{
  const transform=vi.fn(async()=>{throw new Error('源图片已改变')})
  render(<ImagePixelTransformProperties asset={{id:'image',path:'image.png',width:80,height:60}} transform={transform}/>)
  fireEvent.click(screen.getByText('编辑原图像素'))
  fireEvent.focus(screen.getByLabelText('像素裁剪左边'));fireEvent.change(screen.getByLabelText('像素裁剪左边'),{target:{value:'10'}});fireEvent.blur(screen.getByLabelText('像素裁剪左边'))
  await act(async()=>fireEvent.click(screen.getByRole('button',{name:'裁剪原图像素'})))
  expect(transform).toHaveBeenCalledExactlyOnceWith([{kind:'crop',region:{x:10,y:0,width:80,height:60}}])
  expect(screen.getByRole('alert')).toHaveTextContent('源图片已改变')
  expect(screen.getByLabelText('像素裁剪左边')).toHaveValue('10')
  expect(screen.getByRole('button',{name:'裁剪原图像素'})).toBeEnabled()
})
it('P0 offers pixel color editing when source dimensions are unavailable without inventing a size',async()=>{
  const transform=vi.fn(async()=>{})
  render(<ImagePixelTransformProperties transform={transform}/>)
  fireEvent.click(screen.getByText('编辑原图像素'))
  expect(screen.queryByLabelText('像素裁剪宽')).not.toBeInTheDocument()
  await act(async()=>fireEvent.click(screen.getByRole('button',{name:'替换像素颜色'})))
  expect(transform).toHaveBeenCalledExactlyOnceWith([{kind:'replace-color',sourceColor:'#ffffff',targetColor:'#22c55e',tolerance:32}])
})
