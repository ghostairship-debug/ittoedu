import { ArrowDown, ArrowUp, ImageIcon } from 'lucide-react'
import { useRef } from 'react'
import { QuickBarButton, QuickBarMenu, QuickBarSeparator } from '../../editing/quickbar/SelectionQuickBar'
import type { FlowPropertiesCommands } from '../properties/FlowPropertiesPanel'

const ACCEPT = { image: 'image/*', audio: 'audio/*', video: 'video/*' } as const
const NOUN = { image: '图片', audio: '音频', video: '视频' } as const

/** Quick bar actions of a selected Flow document object (image, media, table, chart or component block). */
export function FlowBlockQuickActions({ block, commands }: { block: { readonly type: string; readonly mediaKind?: 'image' | 'audio' | 'video' }; commands: FlowPropertiesCommands }) {
  const input = useRef<HTMLInputElement>(null)
  const media = block.type === 'media' && block.mediaKind ? { mediaKind: block.mediaKind } : null
  return <>
    {media && <>
      <QuickBarButton label={`替换${NOUN[media.mediaKind]}`} text="替换" icon={<ImageIcon size={14} />} onClick={() => input.current?.click()} />
      <input ref={input} type="file" hidden tabIndex={-1} accept={ACCEPT[media.mediaKind]} aria-label={`替换${NOUN[media.mediaKind]}文件`} onChange={event => {
        const file = event.target.files?.[0]; event.target.value = ''
        if (file) void file.arrayBuffer()
          .then(bytes => commands.importReplacementMedia({ name: file.name, mimeType: file.type, bytes: new Uint8Array(bytes) }))
          .catch(() => commands.reportError('媒体文件读取失败'))
      }} />
    </>}
    <QuickBarButton label="上移" icon={<ArrowUp size={14} />} onClick={() => commands.moveSelectedBlock('up')} />
    <QuickBarButton label="下移" icon={<ArrowDown size={14} />} onClick={() => commands.moveSelectedBlock('down')} />
    <QuickBarMenu items={[{ id: 'flow-block.delete', label: '删除', danger: true, run: () => commands.deleteSelectedBlocks() }]} />
    <QuickBarSeparator />
  </>
}
