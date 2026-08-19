import {
  Bold,
  ChevronsLeft,
  ChevronsRight,
  Eraser,
  Heading,
  Highlighter,
  Italic,
  List,
  ListOrdered,
  Strikethrough,
  Trash2,
  Type,
  Underline,
} from 'lucide-react'
import type { TextRunStyle } from '../../shared/projectTypes'
import {
  FLOW_DEFAULT_HIGHLIGHT,
  FLOW_PAPER_TEXT_COLOR,
  type FlowTextEditSession,
} from '../authoring/flowTextEdit'
import { COMMON_FONT_FAMILIES } from './PropertiesTab'

export type FlowBlockContextCommand =
  | { type: 'range-style'; style: TextRunStyle }
  | { type: 'range-clear' }
  | { type: 'range-emphasis' }
  | { type: 'range-highlight'; color: string | null }
  | { type: 'range-color'; color: string }
  | { type: 'heading-level'; level: 1 | 2 | 3 | 4 | 5 | 6 }
  | { type: 'convert-heading'; level: 1 | 2 | 3 | 4 | 5 | 6 }
  | { type: 'convert-paragraph' }
  | { type: 'list-ordered'; ordered: boolean }
  | { type: 'indent' }
  | { type: 'outdent' }
  | { type: 'move'; direction: 'up' | 'down' }
  | { type: 'delete' }

export interface FlowBlockContextToolbarProps {
  readonly block: {
    readonly type: string
    readonly level?: 1 | 2 | 3 | 4 | 5 | 6
  }
  readonly edit: FlowTextEditSession | null
  readonly placement: 'top' | 'below'
  readonly onCommand: (command: FlowBlockContextCommand) => void
  readonly onPreserveSelection?: () => void
}

function preserveFocus(event: { preventDefault(): void; stopPropagation(): void }): void {
  event.preventDefault()
  event.stopPropagation()
}

export function FlowBlockContextToolbar({
  block,
  edit,
  placement,
  onCommand,
  onPreserveSelection,
}: FlowBlockContextToolbarProps) {
  const showRangeTools = edit?.kind === 'rich-text'
  const headingLevel = block.type === 'heading' ? block.level : 2
  const capture = () => onPreserveSelection?.()

  return (
    <div
      className="text-edit-toolbar flow-block-context-toolbar"
      data-testid="flow-block-context-toolbar"
      data-flow-toolbar-placement={placement}
      style={{
        position: 'absolute',
        left: 8,
        top: placement === 'top' ? 8 : undefined,
        bottom: placement === 'below' ? -42 : undefined,
        zIndex: 6,
        flexWrap: 'wrap',
        height: 'auto',
        maxWidth: 'calc(100% - 16px)',
      }}
      onPointerDownCapture={capture}
      onMouseDown={(event) => {
        capture()
        preserveFocus(event)
      }}
    >
      {showRangeTools ? (
        <div
          data-testid="flow-range-toolbar"
          style={{ display: 'flex', alignItems: 'center', gap: 2 }}
        >
          <select
            data-testid="flow-toolbar-font-family"
            aria-label="字体"
            defaultValue=""
            onMouseDown={preserveFocus}
            onChange={(event) => {
              const value = event.target.value
              if (value) {
                onCommand({ type: 'range-style', style: { fontFamily: value } })
              }
            }}
          >
            <option value="" disabled>字体</option>
            {COMMON_FONT_FAMILIES.map((family) => (
              <option key={family} value={family}>
                {family}
              </option>
            ))}
          </select>
          <input
            type="number"
            data-testid="flow-toolbar-font-size"
            aria-label="字号"
            placeholder="字号"
            min={8}
            max={400}
            style={{ width: 48 }}
            onMouseDown={preserveFocus}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                const target = event.currentTarget
                const n = Number(target.value)
                if (target.value.trim() !== '' && !Number.isNaN(n) && n > 0) {
                  onCommand({ type: 'range-style', style: { fontSize: n } })
                }
              }
            }}
            onBlur={(event) => {
              const target = event.currentTarget
              const n = Number(target.value)
              if (target.value.trim() !== '' && !Number.isNaN(n) && n > 0) {
                onCommand({ type: 'range-style', style: { fontSize: n } })
              }
            }}
          />
          <button type="button" title="局部加粗" aria-label="局部加粗" onClick={() => onCommand({ type: 'range-style', style: { bold: true } })}>
            <Bold size={14} />
          </button>
          <button type="button" title="局部斜体" aria-label="局部斜体" onClick={() => onCommand({ type: 'range-style', style: { italic: true } })}>
            <Italic size={14} />
          </button>
          <button type="button" title="局部下划线" aria-label="局部下划线" onClick={() => onCommand({ type: 'range-style', style: { underline: true } })}>
            <Underline size={14} />
          </button>
          <button type="button" title="局部删除线" aria-label="局部删除线" onClick={() => onCommand({ type: 'range-style', style: { strike: true } })}>
            <Strikethrough size={14} />
          </button>
          <button type="button" title="局部着重号" aria-label="局部着重号" onClick={() => onCommand({ type: 'range-emphasis' })}>
            <span aria-hidden="true">•</span>
          </button>
          <button type="button" title="局部高亮" aria-label="局部高亮" onClick={() => onCommand({ type: 'range-highlight', color: FLOW_DEFAULT_HIGHLIGHT })}>
            <Highlighter size={14} />
          </button>
          <button type="button" title="取消局部高亮" aria-label="取消局部高亮" onClick={() => onCommand({ type: 'range-highlight', color: null })}>
            <Highlighter size={14} opacity={0.45} />
          </button>
          <button type="button" title="清除局部格式" aria-label="清除局部格式" onClick={() => onCommand({ type: 'range-clear' })}>
            <Eraser size={14} />
          </button>
          <label title="局部文字颜色">
            <input
              type="color"
              aria-label="局部文字颜色"
              defaultValue={FLOW_PAPER_TEXT_COLOR}
              onChange={(event) => onCommand({ type: 'range-color', color: event.target.value })}
            />
          </label>
        </div>
      ) : null}

      <div
        data-testid="flow-structure-toolbar"
        style={{ display: 'flex', alignItems: 'center', gap: 2 }}
      >
        {block.type === 'heading' ? (
          <label title="标题级别">
            <select
              aria-label="标题级别"
              value={headingLevel}
              onMouseDown={preserveFocus}
              onChange={(event) => onCommand({
                type: 'heading-level',
                level: Number(event.target.value) as 1 | 2 | 3 | 4 | 5 | 6,
              })}
            >
              <option value={1}>H1</option>
              <option value={2}>H2</option>
              <option value={3}>H3</option>
              <option value={4}>H4</option>
              <option value={5}>H5</option>
              <option value={6}>H6</option>
            </select>
          </label>
        ) : null}
        {block.type === 'paragraph' || block.type === 'quote' ? (
          <button
            type="button"
            title="转为标题"
            aria-label="转为标题"
            onClick={() => onCommand({ type: 'convert-heading', level: 2 })}
          >
            <Heading size={14} />
          </button>
        ) : null}
        {block.type === 'heading' || block.type === 'quote' ? (
          <button
            type="button"
            title="转为段落"
            aria-label="转为段落"
            onClick={() => onCommand({ type: 'convert-paragraph' })}
          >
            <Type size={14} />
          </button>
        ) : null}
        {block.type === 'list' ? (
          <>
            <button
              type="button"
              title="无序列表"
              aria-label="无序列表"
              onClick={() => onCommand({ type: 'list-ordered', ordered: false })}
            >
              <List size={14} />
            </button>
            <button
              type="button"
              title="有序列表"
              aria-label="有序列表"
              onClick={() => onCommand({ type: 'list-ordered', ordered: true })}
            >
              <ListOrdered size={14} />
            </button>
          </>
        ) : null}
        <button type="button" title="缩进" aria-label="缩进" onClick={() => onCommand({ type: 'indent' })}>
          <ChevronsRight size={14} />
        </button>
        <button type="button" title="取消缩进" aria-label="取消缩进" onClick={() => onCommand({ type: 'outdent' })}>
          <ChevronsLeft size={14} />
        </button>
        <button type="button" title="上移" aria-label="上移" onClick={() => onCommand({ type: 'move', direction: 'up' })}>
          ↑
        </button>
        <button type="button" title="下移" aria-label="下移" onClick={() => onCommand({ type: 'move', direction: 'down' })}>
          ↓
        </button>
        <button type="button" title="删除块" aria-label="删除块" onClick={() => onCommand({ type: 'delete' })}>
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  )
}
