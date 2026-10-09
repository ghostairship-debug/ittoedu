import { expect, it, vi } from 'vitest'
import { flowMediaToolCommands, type FlowMediaToolPort } from '@/renderer/ui/flow/flowMediaCommands'
import { flowBlockCommands } from '@/renderer/ui/flow/FlowBlockQuickActions'
import type { ComponentInstance } from '@/shared/contracts/component-platform/project'

it('offers media commands and submits a caption once, with cancellation and pending confirmation guards', async () => {
  const rich = { inlines: [{ type: 'text' as const, text: '原说明', style: { bold: true } }] }
  const image: ComponentInstance = { id: 'photo', definitionId: 'guoling.image', data: {}, flowLayout: { width: 'content-width', caption: rich } }
  let draft: Parameters<FlowMediaToolPort['openCaption']>[1] | undefined
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const port: FlowMediaToolPort = { openCrop: vi.fn(), openCaption: vi.fn((_caption, controls) => { draft = controls }),
    patchMedia: vi.fn(async () => { await gate }), convertToOverlay: vi.fn(), modifyWithAi: vi.fn() }
  const commands = flowMediaToolCommands(image, 'image', port)
  expect(commands.map(item => item.label)).toEqual(['裁剪…', '正文宽', '宽幅', '通栏', '左环绕', '右环绕', '说明文字', '改为浮动', 'AI 修改'])
  commands.find(item => item.id === 'flow-media.crop')!.run()
  commands.find(item => item.id === 'flow-media.float')!.run()
  expect(port.openCrop).toHaveBeenCalledOnce(); expect(port.convertToOverlay).toHaveBeenCalledOnce()
  const full = flowBlockCommands({ instance: image, mediaKind: 'image' }, { moveSelectedBlock: vi.fn(), deleteSelectedBlocks: vi.fn() }, vi.fn(), port)
  expect(full.map(item => item.id)).toContain('flow-block.replace')
  const caption = commands.find(item => item.id === 'flow-media.caption')!
  caption.run()
  expect(port.openCaption).toHaveBeenCalledWith(rich, expect.any(Object))
  expect(port.patchMedia).not.toHaveBeenCalled()
  draft!.cancel(); await draft!.confirm({ inlines: [] })
  expect(port.patchMedia).not.toHaveBeenCalled()
  caption.run()
  const pending = draft!.confirm(rich), duplicate = draft!.confirm({ inlines: [] })
  expect(port.patchMedia).toHaveBeenCalledOnce(); expect(port.patchMedia).toHaveBeenCalledWith({ caption: rich })
  release(); await Promise.all([pending, duplicate]); await draft!.confirm({ inlines: [] })
  expect(port.patchMedia).toHaveBeenCalledOnce()
  await commands.find(item => item.id === 'flow-media.wrap.right')!.run()
  expect(port.patchMedia).toHaveBeenNthCalledWith(2, { wrap: 'right' })
  expect(flowMediaToolCommands(image, 'audio', port)).toEqual([])
  expect(flowMediaToolCommands(image, 'video', port).some(item => item.id === 'flow-media.crop')).toBe(false)
})
