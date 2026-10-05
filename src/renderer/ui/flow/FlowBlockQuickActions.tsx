import { ArrowDown, ArrowUp, ImageIcon } from 'lucide-react'
import type { MenuCommand } from '../../editing/commands/CommandMenu'
import { QuickBarButton, QuickBarMenu, QuickBarSeparator } from '../../editing/quickbar/SelectionQuickBar'
import type { FlowPropertiesCommands } from '../properties/FlowPropertiesPanel'
import type { ComponentInstance } from '../../../shared/contracts/component-platform'
import { flowMediaToolCommands, type FlowMediaToolPort } from './flowMediaCommands'

export type FlowMediaKind = 'image' | 'audio' | 'video'
export const FLOW_MEDIA_ACCEPT: Record<FlowMediaKind, string> = { image: 'image/*', audio: 'audio/*', video: 'video/*' }
const NOUN: Record<FlowMediaKind, string> = { image: '图片', audio: '音频', video: '视频' }

type FlowBlock = { readonly instance: ComponentInstance; readonly mediaKind?: FlowMediaKind }
type FlowCommands = Pick<FlowPropertiesCommands, 'moveSelectedBlock' | 'deleteSelectedBlocks'>

/**
 * Every operation of a selected Flow document object (image, media, table, chart or component block), defined once
 * (M21): the quick bar shows the first ones as buttons and the rest under "⋯"; the right-click menu shows all.
 */
export function flowBlockCommands(block: FlowBlock, commands: FlowCommands, replaceMedia: (kind: FlowMediaKind) => void, mediaTools?: FlowMediaToolPort): MenuCommand[] {
  const media = block.mediaKind ?? null
  return [
    ...(media ? [{ id: 'flow-block.replace', label: `替换${NOUN[media]}…`, group: 'primary', run: () => replaceMedia(media) }] : []),
    ...(media && mediaTools ? flowMediaToolCommands(block.instance, media, mediaTools) : []),
    { id: 'flow-block.up', label: '上移', group: 'order', run: () => commands.moveSelectedBlock('up') },
    { id: 'flow-block.down', label: '下移', group: 'order', run: () => commands.moveSelectedBlock('down') },
    { id: 'flow-block.delete', label: '删除', shortcut: 'Delete', group: 'edit', danger: true, run: () => commands.deleteSelectedBlocks() },
  ]
}

const ON_BAR = new Set(['flow-block.replace', 'flow-block.up', 'flow-block.down', 'flow-media.crop', 'flow-media.layout.content-width', 'flow-media.layout.wide', 'flow-media.layout.full-width', 'flow-media.wrap.left', 'flow-media.wrap.right'])

/** The quick bar buttons of a selected Flow document object. */
export function FlowBlockQuickActions({ block, commands, replaceMedia, mediaTools }: { block: FlowBlock; commands: FlowCommands; replaceMedia(kind: FlowMediaKind): void; mediaTools?: FlowMediaToolPort }) {
  const items = flowBlockCommands(block, commands, replaceMedia, mediaTools)
  const replace = items.find(item => item.id === 'flow-block.replace')
  return <>
    {replace && block.mediaKind && <QuickBarButton label={`替换${NOUN[block.mediaKind]}`} text="替换" icon={<ImageIcon size={14} />} onClick={replace.run} />}
    {items.find(item => item.id === 'flow-media.crop') && <QuickBarButton label="裁剪图片" text="裁剪" onClick={items.find(item => item.id === 'flow-media.crop')!.run} />}
    {mediaTools && (block.mediaKind === 'image' || block.mediaKind === 'video') && <QuickBarMenu label="排版" items={items.filter(item => item.group === 'layout')} />}
    <QuickBarButton label="上移" icon={<ArrowUp size={14} />} onClick={() => commands.moveSelectedBlock('up')} />
    <QuickBarButton label="下移" icon={<ArrowDown size={14} />} onClick={() => commands.moveSelectedBlock('down')} />
    <QuickBarSeparator />
  </>
}

/** The quick bar's "⋯" of a selected Flow document object: the commands that are not buttons on the bar. */
export function flowBlockMenuCommands(block: FlowBlock, commands: FlowCommands, replaceMedia: (kind: FlowMediaKind) => void, mediaTools?: FlowMediaToolPort): MenuCommand[] {
  return flowBlockCommands(block, commands, replaceMedia, mediaTools).filter(item => !ON_BAR.has(item.id))
}

export function FlowBlockQuickMenu({ block, commands, replaceMedia, mediaTools }: { block: FlowBlock; commands: FlowCommands; replaceMedia(kind: FlowMediaKind): void; mediaTools?: FlowMediaToolPort }) {
  return <QuickBarMenu items={flowBlockMenuCommands(block, commands, replaceMedia, mediaTools)} />
}
