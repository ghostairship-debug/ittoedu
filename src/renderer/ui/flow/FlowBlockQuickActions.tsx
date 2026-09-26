import { ArrowDown, ArrowUp, ImageIcon } from 'lucide-react'
import type { MenuCommand } from '../../editing/commands/CommandMenu'
import { QuickBarButton, QuickBarMenu, QuickBarSeparator } from '../../editing/quickbar/SelectionQuickBar'
import type { FlowPropertiesCommands } from '../properties/FlowPropertiesPanel'

export type FlowMediaKind = 'image' | 'audio' | 'video'
export const FLOW_MEDIA_ACCEPT: Record<FlowMediaKind, string> = { image: 'image/*', audio: 'audio/*', video: 'video/*' }
const NOUN: Record<FlowMediaKind, string> = { image: '图片', audio: '音频', video: '视频' }

type FlowBlock = { readonly type: string; readonly mediaKind?: FlowMediaKind }

/**
 * Every operation of a selected Flow document object (image, media, table, chart or component block), defined once
 * (M21): the quick bar shows the first ones as buttons and the rest under "⋯"; the right-click menu shows all.
 */
export function flowBlockCommands(block: FlowBlock, commands: FlowPropertiesCommands, replaceMedia: (kind: FlowMediaKind) => void): MenuCommand[] {
  const media = block.type === 'media' && block.mediaKind ? block.mediaKind : null
  return [
    ...(media ? [{ id: 'flow-block.replace', label: `替换${NOUN[media]}…`, group: 'primary', run: () => replaceMedia(media) }] : []),
    { id: 'flow-block.up', label: '上移', group: 'order', run: () => commands.moveSelectedBlock('up') },
    { id: 'flow-block.down', label: '下移', group: 'order', run: () => commands.moveSelectedBlock('down') },
    { id: 'flow-block.delete', label: '删除', shortcut: 'Delete', group: 'edit', danger: true, run: () => commands.deleteSelectedBlocks() },
  ]
}

const ON_BAR = new Set(['flow-block.replace', 'flow-block.up', 'flow-block.down'])

/** The quick bar buttons of a selected Flow document object. */
export function FlowBlockQuickActions({ block, commands, replaceMedia }: { block: FlowBlock; commands: FlowPropertiesCommands; replaceMedia(kind: FlowMediaKind): void }) {
  const items = flowBlockCommands(block, commands, replaceMedia)
  const replace = items.find(item => item.id === 'flow-block.replace')
  return <>
    {replace && block.mediaKind && <QuickBarButton label={`替换${NOUN[block.mediaKind]}`} text="替换" icon={<ImageIcon size={14} />} onClick={replace.run} />}
    <QuickBarButton label="上移" icon={<ArrowUp size={14} />} onClick={() => commands.moveSelectedBlock('up')} />
    <QuickBarButton label="下移" icon={<ArrowDown size={14} />} onClick={() => commands.moveSelectedBlock('down')} />
    <QuickBarSeparator />
  </>
}

/** The quick bar's "⋯" of a selected Flow document object: the commands that are not buttons on the bar. */
export function flowBlockMenuCommands(block: FlowBlock, commands: FlowPropertiesCommands, replaceMedia: (kind: FlowMediaKind) => void): MenuCommand[] {
  return flowBlockCommands(block, commands, replaceMedia).filter(item => !ON_BAR.has(item.id))
}

export function FlowBlockQuickMenu({ block, commands, replaceMedia }: { block: FlowBlock; commands: FlowPropertiesCommands; replaceMedia(kind: FlowMediaKind): void }) {
  return <QuickBarMenu items={flowBlockMenuCommands(block, commands, replaceMedia)} />
}
