import { expect, it, vi } from 'vitest'
import { flowMediaToolCommands } from '@/renderer/ui/flow/flowMediaCommands'
import { flowBlockCommands } from '@/renderer/ui/flow/FlowBlockQuickActions'
import type { FlowPropertiesCommands } from '@/renderer/ui/properties/FlowPropertiesPanel'
import type { FlowMediaBlock } from '@/shared/contracts/course-project-v9/types'

const image: FlowMediaBlock = { id: 'photo', type: 'media', mediaKind: 'image', assetId: 'original', layout: 'content-width' }

it('offers image crop, five layout choices, caption and float through narrow callbacks', () => {
  const port = { openCrop: vi.fn(), patchMedia: vi.fn(), convertToOverlay: vi.fn(), modifyWithAi: vi.fn() }
  const commands = flowMediaToolCommands(image, port)
  expect(commands.map(item => item.label)).toEqual(['裁剪…', '正文宽', '宽幅', '通栏', '左环绕', '右环绕', '说明文字', '改为浮动', 'AI 修改'])
  commands.find(item => item.id === 'flow-media.wrap.right')!.run()
  commands.find(item => item.id === 'flow-media.caption')!.run()
  commands.find(item => item.id === 'flow-media.float')!.run()
  expect(port.patchMedia).toHaveBeenNthCalledWith(1, { wrap: 'right' })
  expect(port.patchMedia).toHaveBeenNthCalledWith(2, { caption: { inlines: [] } })
  expect(port.convertToOverlay).toHaveBeenCalledOnce()
  const full = flowBlockCommands(image, { moveSelectedBlock: vi.fn(), deleteSelectedBlocks: vi.fn() } as unknown as FlowPropertiesCommands, vi.fn(), port)
  expect(full.map(item => item.id)).toContain('flow-media.crop')
  expect(full.map(item => item.id)).toContain('flow-block.replace')
})

it('does not offer crop or layout for audio', () => {
  const port = { openCrop: vi.fn(), patchMedia: vi.fn(), convertToOverlay: vi.fn() }
  expect(flowMediaToolCommands({ ...image, mediaKind: 'audio' }, port)).toEqual([])
  expect(flowMediaToolCommands({ ...image, mediaKind: 'video' }, port).some(item => item.id === 'flow-media.crop')).toBe(false)
})
