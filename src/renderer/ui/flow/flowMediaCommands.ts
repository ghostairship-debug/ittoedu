import type { MenuCommand } from '../../editing/commands/CommandMenu'
import type { ComponentInstance } from '../../../shared/contracts/component-platform/project'
type FlowMediaLayout = NonNullable<ComponentInstance['flowLayout']>

export interface FlowMediaToolPort {
  openCrop(): void
  patchMedia(patch: Partial<FlowMediaLayout>): Promise<void>
  openCaption(caption: FlowMediaLayout['caption'], draft: { confirm(caption: NonNullable<FlowMediaLayout['caption']>): Promise<void>; cancel(): void }): void
  convertToOverlay(): void
  replace?(): void
  modifyWithAi?(): void
}

function openCaptionDraft(instance: ComponentInstance, port: FlowMediaToolPort): void {
  let active = true
  let pending: Promise<void> | null = null
  port.openCaption(instance.flowLayout?.caption, {
    confirm: caption => {
      if (!active) return Promise.resolve()
      if (!pending) pending = port.patchMedia({ caption }).then(() => { active = false }).finally(() => { pending = null })
      return pending
    },
    cancel: () => { active = false },
  })
}

export function flowMediaToolCommands(instance: ComponentInstance, mediaKind: 'image' | 'video' | 'audio', port: FlowMediaToolPort): MenuCommand[] {
  const image = mediaKind === 'image', visual = image || mediaKind === 'video'
  if (!visual) return []
  return [
    ...(image ? [{ id: 'flow-media.crop', label: '裁剪…', group: 'primary', run: port.openCrop }] : []),
    { id: 'flow-media.layout.content-width', label: '正文宽', group: 'layout', run: () => port.patchMedia({ width: 'content-width', wrap: 'none' }) },
    { id: 'flow-media.layout.wide', label: '宽幅', group: 'layout', run: () => port.patchMedia({ width: 'wide', wrap: 'none' }) },
    { id: 'flow-media.layout.full-width', label: '通栏', group: 'layout', run: () => port.patchMedia({ width: 'full-width', wrap: 'none' }) },
    { id: 'flow-media.wrap.left', label: '左环绕', group: 'layout', run: () => port.patchMedia({ wrap: 'left' }) },
    { id: 'flow-media.wrap.right', label: '右环绕', group: 'layout', run: () => port.patchMedia({ wrap: 'right' }) },
    { id: 'flow-media.caption', label: '说明文字', group: 'edit', run: () => openCaptionDraft(instance, port) },
    ...(port.replace ? [{ id: 'flow-media.replace', label: '替换媒体…', group: 'edit', run: port.replace }] : []),
    { id: 'flow-media.float', label: '改为浮动', group: 'edit', run: port.convertToOverlay },
    ...(port.modifyWithAi ? [{ id: 'flow-media.ai', label: 'AI 修改', group: 'edit', run: port.modifyWithAi }] : []),
  ]
}
