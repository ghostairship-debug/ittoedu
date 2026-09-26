import { expect, it, vi } from 'vitest'
import { flowMediaToolCommands } from '@/renderer/ui/flow/flowMediaCommands'
import { flowBlockCommands } from '@/renderer/ui/flow/FlowBlockQuickActions'
import type { FlowPropertiesCommands } from '@/renderer/ui/properties/FlowPropertiesPanel'
import type { FlowMediaBlock } from '@/shared/contracts/course-project-v9/types'

const image: FlowMediaBlock = { id: 'photo', type: 'media', mediaKind: 'image', assetId: 'original', layout: 'content-width' }

it('offers image crop, five layout choices, caption and float through narrow callbacks', () => {
  const port = { openCrop: vi.fn(), openCaption: vi.fn(), patchMedia: vi.fn(), convertToOverlay: vi.fn(), modifyWithAi: vi.fn() }
  const commands = flowMediaToolCommands(image, port)
  expect(commands.map(item => item.label)).toEqual(['裁剪…', '正文宽', '宽幅', '通栏', '左环绕', '右环绕', '说明文字', '改为浮动', 'AI 修改'])
  commands.find(item => item.id === 'flow-media.wrap.right')!.run()
  commands.find(item => item.id === 'flow-media.caption')!.run()
  commands.find(item => item.id === 'flow-media.float')!.run()
  expect(port.patchMedia).toHaveBeenNthCalledWith(1, { wrap: 'right' })
  expect(port.patchMedia).toHaveBeenCalledTimes(1)
  expect(port.openCaption).toHaveBeenCalledWith(undefined, expect.objectContaining({ confirm: expect.any(Function), cancel: expect.any(Function) }))
  expect(port.convertToOverlay).toHaveBeenCalledOnce()
  const full = flowBlockCommands(image, { moveSelectedBlock: vi.fn(), deleteSelectedBlocks: vi.fn() } as unknown as FlowPropertiesCommands, vi.fn(), port)
  expect(full.map(item => item.id)).toContain('flow-media.crop')
  expect(full.map(item => item.id)).toContain('flow-block.replace')
})

it('opens caption editing without a write, cancels with zero writes and confirms once', () => {
  type Caption = NonNullable<FlowMediaBlock['caption']>
  let draft: { confirm(caption: Caption): void; cancel(): void } | null = null
  const port = { openCrop: vi.fn(), openCaption: vi.fn((_caption: FlowMediaBlock['caption'], controls: { confirm(caption: Caption): void; cancel(): void }) => { draft = controls }), patchMedia: vi.fn(), convertToOverlay: vi.fn() }
  const rich: Caption = { inlines: [{ type: 'text', text: '原说明', style: { bold: true } }] }
  const command = flowMediaToolCommands({ ...image, caption: rich }, port).find(item => item.id === 'flow-media.caption')!
  command.run()
  expect(port.openCaption).toHaveBeenCalledWith(rich, expect.any(Object))
  expect(port.patchMedia).not.toHaveBeenCalled()
  const cancelled = draft!
  cancelled.cancel(); cancelled.confirm({ inlines: [{ type: 'text', text: '不应提交' }] })
  expect(port.patchMedia).not.toHaveBeenCalled()
  command.run()
  const confirmed = draft!
  confirmed.confirm(rich); confirmed.confirm({ inlines: [] })
  expect(port.patchMedia).toHaveBeenCalledOnce()
  expect(port.patchMedia).toHaveBeenCalledWith({ caption: rich })
})

it('does not offer crop or layout for audio', () => {
  const port = { openCrop: vi.fn(), openCaption: vi.fn(), patchMedia: vi.fn(), convertToOverlay: vi.fn() }
  expect(flowMediaToolCommands({ ...image, mediaKind: 'audio' }, port)).toEqual([])
  expect(flowMediaToolCommands({ ...image, mediaKind: 'video' }, port).some(item => item.id === 'flow-media.crop')).toBe(false)
})
