import type { MenuCommand } from '../../editing/commands/CommandMenu'
import type { FlowMediaBlock } from '../../../shared/contracts/course-project-v9/types'

export interface FlowMediaToolPort {
  openCrop(): void
  patchMedia(patch: Partial<Pick<FlowMediaBlock, 'layout' | 'wrap' | 'caption'>>): void
  openCaption(caption: FlowMediaBlock['caption'], draft: { confirm(caption: NonNullable<FlowMediaBlock['caption']>): void; cancel(): void }): void
  convertToOverlay(): void
  modifyWithAi?(): void
}

function openCaptionDraft(block: FlowMediaBlock, port: FlowMediaToolPort): void {
  let active = true
  port.openCaption(block.caption, {
    confirm: caption => { if (!active) return; active = false; port.patchMedia({ caption }) },
    cancel: () => { active = false },
  })
}

export function flowMediaToolCommands(block: FlowMediaBlock, port: FlowMediaToolPort): MenuCommand[] {
  const image = block.mediaKind === 'image', visual = image || block.mediaKind === 'video'
  if (!visual) return []
  return [
    ...(image ? [{ id: 'flow-media.crop', label: '裁剪…', group: 'primary', run: port.openCrop }] : []),
    { id: 'flow-media.layout.content-width', label: '正文宽', group: 'layout', run: () => port.patchMedia({ layout: 'content-width', wrap: 'none' }) },
    { id: 'flow-media.layout.wide', label: '宽幅', group: 'layout', run: () => port.patchMedia({ layout: 'wide', wrap: 'none' }) },
    { id: 'flow-media.layout.full-width', label: '通栏', group: 'layout', run: () => port.patchMedia({ layout: 'full-width', wrap: 'none' }) },
    { id: 'flow-media.wrap.left', label: '左环绕', group: 'layout', run: () => port.patchMedia({ wrap: 'left' }) },
    { id: 'flow-media.wrap.right', label: '右环绕', group: 'layout', run: () => port.patchMedia({ wrap: 'right' }) },
    { id: 'flow-media.caption', label: '说明文字', group: 'edit', run: () => openCaptionDraft(block, port) },
    { id: 'flow-media.float', label: '改为浮动', group: 'edit', run: port.convertToOverlay },
    ...(port.modifyWithAi ? [{ id: 'flow-media.ai', label: 'AI 修改', group: 'edit', run: port.modifyWithAi }] : []),
  ]
}
