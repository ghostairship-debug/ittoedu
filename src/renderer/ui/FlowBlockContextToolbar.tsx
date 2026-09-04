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
  SlidersHorizontal,
  Strikethrough,
  Trash2,
  Type,
  Underline,
} from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import type { FlowBlock } from '../../shared/courseProjectTypes'
import type { TextRunStyle } from '../../shared/contracts/native-v1'
import {
  FLOW_DEFAULT_HIGHLIGHT,
  FLOW_PAPER_TEXT_COLOR,
  type FlowSelectionFormat,
  type FlowSelectionFormatField,
} from '../authoring/flowTextEdit'
import {
  COMMON_FONT_FAMILIES,
  FONT_FAMILY_SOURCE_TAGS,
  fontFamilySource,
  type FontFamilySource,
} from './properties/PropertyControls'

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
  readonly block: FlowBlock
  readonly selectionFormat: FlowSelectionFormat
  readonly placement: 'top' | 'below'
  readonly onCommand: (command: FlowBlockContextCommand) => void
  readonly onPreserveSelection?: () => void
}

export const FLOW_BLOCK_CONTEXT_TOOLBAR_CONTROL_HEIGHT = 27
export const FLOW_BLOCK_CONTEXT_TOOLBAR_SCROLLBAR_RESERVE = 18
export const FLOW_BLOCK_CONTEXT_TOOLBAR_PRIMARY_HEIGHT =
  FLOW_BLOCK_CONTEXT_TOOLBAR_CONTROL_HEIGHT + FLOW_BLOCK_CONTEXT_TOOLBAR_SCROLLBAR_RESERVE
export const FLOW_BLOCK_CONTEXT_TOOLBAR_HEIGHT = 54
export const FLOW_BLOCK_CONTEXT_TOOLBAR_BELOW_OFFSET =
  FLOW_BLOCK_CONTEXT_TOOLBAR_HEIGHT + 6

function stopToolbarMouseDown(event: { stopPropagation(): void }): void {
  event.stopPropagation()
}

function uniformValue<T>(field: FlowSelectionFormatField<T>): T | undefined {
  return field.state === 'uniform' ? field.value : undefined
}

function formatFieldTitle(
  label: string,
  field: FlowSelectionFormatField<unknown>,
  disabledReason: string | undefined,
): string {
  if (disabledReason) return `${label}：${disabledReason}`
  if (field.state === 'mixed') return `${label}：混合值，应用后统一选区`
  if (field.state === 'unset') return `${label}：使用默认值`
  return label
}

export function FlowBlockContextToolbar({
  block,
  selectionFormat,
  placement,
  onCommand,
  onPreserveSelection,
}: FlowBlockContextToolbarProps) {
  const [expanded, setExpanded] = useState(false)
  const enterCommittedFontSizeRef = useRef<string | null>(null)
  const headingLevel = block.type === 'heading' ? block.level : 2
  const capture = () => onPreserveSelection?.()
  const disabledReason = !selectionFormat.richText
    ? '当前块不支持文字格式'
    : undefined
  const inlineDisabled = !selectionFormat.canApplyInlineStyle
  const familyField = selectionFormat.fields.fontFamily
  const familyValue = familyField.state === 'mixed'
    ? '__mixed__'
    : uniformValue(familyField) ?? ''
  const fontSizeField = selectionFormat.fields.fontSize
  const fontSizeValue = uniformValue(fontSizeField)
  const colorValue = uniformValue(selectionFormat.fields.color) ?? FLOW_PAPER_TEXT_COLOR
  const highlightValue = uniformValue(selectionFormat.fields.highlightColor)
  const scopeLabel = selectionFormat.mode === 'caret'
    ? '插入点'
    : selectionFormat.mode === 'range'
      ? '选区'
      : '整块'
  const stateLabel = !selectionFormat.richText
    ? `${scopeLabel} · 无文字格式`
    : selectionFormat.mode === 'caret' && selectionFormat.hasPendingStyle
      ? `${scopeLabel} · 待输入样式`
      : selectionFormat.hasMixedValue
        ? `${scopeLabel} · 混合格式`
        : scopeLabel

  const booleanFormatButton = (
    key: 'bold' | 'italic' | 'underline',
    label: string,
    icon: ReactNode,
  ) => {
    const field = selectionFormat.fields[key]
    const active = field.state === 'uniform' && field.value
    const accessibleLabel = selectionFormat.mode === 'range'
      ? `局部${label}`
      : selectionFormat.mode === 'whole-block'
        ? `整块${label}`
      : `插入点${label}`
    return (
      <button
        type="button"
        data-format-state={field.state}
        title={formatFieldTitle(label, field, disabledReason)}
        aria-label={accessibleLabel}
        aria-pressed={field.state === 'mixed' ? 'mixed' : active}
        disabled={inlineDisabled}
        style={field.state === 'mixed'
          ? { outline: '1px dashed currentColor', outlineOffset: -2 }
          : active
            ? { background: 'var(--accent-soft, #dbeafe)' }
            : undefined}
        onClick={() => onCommand({
          type: 'range-style',
          style: { [key]: !active },
        })}
      >
        {icon}
      </button>
    )
  }

  return (
    <div
      className="text-edit-toolbar flow-block-context-toolbar"
      data-testid="flow-block-context-toolbar"
      data-flow-toolbar-placement={placement}
      data-flow-toolbar-layout="stable-primary"
      style={{
        position: 'absolute',
        left: 8,
        top: placement === 'top' ? 8 : undefined,
        bottom: placement === 'below' ? -FLOW_BLOCK_CONTEXT_TOOLBAR_BELOW_OFFSET : undefined,
        zIndex: 6,
        boxSizing: 'border-box',
        display: 'flex',
        flexWrap: 'nowrap',
        width: 440,
        maxWidth: 'calc(100% - 16px)',
        height: FLOW_BLOCK_CONTEXT_TOOLBAR_HEIGHT,
        overflow: 'visible',
      }}
      onPointerDownCapture={capture}
      onMouseDown={stopToolbarMouseDown}
      onClick={(event) => event.stopPropagation()}
    >
      <div
        data-testid="flow-range-toolbar"
        data-flow-toolbar-primary="true"
        data-flow-control-height={FLOW_BLOCK_CONTEXT_TOOLBAR_CONTROL_HEIGHT}
        data-flow-scrollbar-reserve={FLOW_BLOCK_CONTEXT_TOOLBAR_SCROLLBAR_RESERVE}
        style={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'nowrap',
          gap: 2,
          width: '100%',
          minWidth: 0,
          height: FLOW_BLOCK_CONTEXT_TOOLBAR_PRIMARY_HEIGHT,
          overflowX: 'auto',
          overflowY: 'hidden',
          overscrollBehaviorX: 'contain',
        }}
      >
        <span
          data-flow-primary-slot="scope"
          data-testid="flow-toolbar-format-scope"
          data-flow-format-mode={selectionFormat.mode}
          data-format-state={selectionFormat.hasMixedValue ? 'mixed' : 'resolved'}
          title={stateLabel}
          style={{
            display: 'inline-block',
            flex: '0 0 104px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: 11,
          }}
        >
          {stateLabel}
        </span>
        <select
          data-flow-primary-slot="font-family"
          data-testid="flow-toolbar-font-family"
          data-format-state={familyField.state}
          aria-label="字体"
          title={formatFieldTitle('字体', familyField, disabledReason)}
          value={familyValue}
          disabled={inlineDisabled}
          style={{ flex: '0 0 88px', width: 88, minWidth: 0 }}
          onChange={(event) => {
            const value = event.target.value
            if (value && value !== '__mixed__') {
              onCommand({ type: 'range-style', style: { fontFamily: value } })
            }
          }}
        >
          <option value="">默认字体</option>
          <option value="__mixed__" disabled>混合字体</option>
          {familyField.state === 'uniform' && !COMMON_FONT_FAMILIES.some((family) => family === familyField.value)
            ? <option value={familyField.value}>{familyField.value}</option>
            : null}
          {/* Grouped so this entry point states the same cost as the
              properties picker: a bundled family is embedded on export, a
              system family follows whatever the machine has. */}
          {(['bundled', 'system'] as readonly FontFamilySource[]).map((source) => {
            const families = COMMON_FONT_FAMILIES.filter(
              (family) => fontFamilySource(family) === source,
            )
            if (families.length === 0) return null
            return (
              <optgroup key={source} label={FONT_FAMILY_SOURCE_TAGS[source].cost}>
                {families.map((family) => (
                  <option key={family} value={family}>
                    {family}
                  </option>
                ))}
              </optgroup>
            )
          })}
        </select>
        <input
          key={`${fontSizeField.state}-${fontSizeValue ?? ''}`}
          type="number"
          data-flow-primary-slot="font-size"
          data-testid="flow-toolbar-font-size"
          data-format-state={fontSizeField.state}
          aria-label="字号"
          title={formatFieldTitle('字号', fontSizeField, disabledReason)}
          placeholder={fontSizeField.state === 'mixed' ? '混合' : '默认'}
          defaultValue={fontSizeValue}
          min={8}
          max={400}
          disabled={inlineDisabled}
          style={{ flex: '0 0 48px', width: 48 }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              // Applying the size changes this keyed input and may remove the
              // focused DOM node during keydown. Cancel the native Enter
              // action first; otherwise Chromium applies it to the retained
              // contenteditable selection and replaces the selected text with
              // a line break.
              event.preventDefault()
              event.stopPropagation()
              const target = event.currentTarget
              const n = Number(target.value)
              if (target.value.trim() !== '' && !Number.isNaN(n) && n > 0) {
                enterCommittedFontSizeRef.current = target.value
                onCommand({ type: 'range-style', style: { fontSize: n } })
              }
            }
          }}
          onBlur={(event) => {
            const target = event.currentTarget
            if (enterCommittedFontSizeRef.current === target.value) {
              enterCommittedFontSizeRef.current = null
              return
            }
            const n = Number(target.value)
            if (target.value.trim() !== '' && !Number.isNaN(n) && n > 0) {
              onCommand({ type: 'range-style', style: { fontSize: n } })
            }
          }}
        />
        <span data-flow-primary-slot="bold">
          {booleanFormatButton('bold', '加粗', <Bold size={14} />)}
        </span>
        <span data-flow-primary-slot="italic">
          {booleanFormatButton('italic', '斜体', <Italic size={14} />)}
        </span>
        <span data-flow-primary-slot="underline">
          {booleanFormatButton('underline', '下划线', <Underline size={14} />)}
        </span>
        <span data-flow-primary-slot="highlight">
          <button
            type="button"
            data-format-state={selectionFormat.fields.highlightColor.state}
            title={formatFieldTitle('高亮', selectionFormat.fields.highlightColor, disabledReason)}
            aria-label="高亮"
            aria-pressed={selectionFormat.fields.highlightColor.state === 'mixed'
              ? 'mixed'
              : typeof highlightValue === 'string'}
            disabled={inlineDisabled}
            style={selectionFormat.fields.highlightColor.state === 'mixed'
              ? { outline: '1px dashed currentColor', outlineOffset: -2 }
              : typeof highlightValue === 'string'
                ? { background: 'var(--accent-soft, #dbeafe)' }
                : undefined}
            onClick={() => onCommand({
              type: 'range-highlight',
              color: typeof highlightValue === 'string' ? null : FLOW_DEFAULT_HIGHLIGHT,
            })}
          >
            <Highlighter size={14} />
          </button>
        </span>
        <span data-flow-primary-slot="more">
          <button
            type="button"
            data-testid="flow-toolbar-more"
            title="更多格式与块操作"
            aria-label="更多格式与块操作"
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
          >
            <SlidersHorizontal size={14} />
          </button>
        </span>
      </div>

      {expanded ? (
        <div
          data-testid="flow-toolbar-more-panel"
          style={{
            position: 'absolute',
            left: 0,
            top: FLOW_BLOCK_CONTEXT_TOOLBAR_HEIGHT + 4,
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 4,
            width: 352,
            padding: 6,
            borderRadius: 6,
            background: 'var(--panel-bg, #fff)',
            boxShadow: '0 6px 20px rgba(15, 23, 42, 0.18)',
            zIndex: 1,
          }}
        >
          <button
            type="button"
            data-format-state={selectionFormat.fields.strike.state}
            title={formatFieldTitle('删除线', selectionFormat.fields.strike, disabledReason)}
            aria-label="删除线"
            aria-pressed={selectionFormat.fields.strike.state === 'mixed'
              ? 'mixed'
              : uniformValue(selectionFormat.fields.strike) === true}
            disabled={inlineDisabled}
            onClick={() => onCommand({
              type: 'range-style',
              style: { strike: uniformValue(selectionFormat.fields.strike) !== true },
            })}
          >
            <Strikethrough size={14} />
          </button>
          <button
            type="button"
            data-format-state={selectionFormat.fields.emphasis.state}
            title={formatFieldTitle('着重号', selectionFormat.fields.emphasis, disabledReason)}
            aria-label="着重号"
            aria-pressed={selectionFormat.fields.emphasis.state === 'mixed'
              ? 'mixed'
              : uniformValue(selectionFormat.fields.emphasis) === true}
            disabled={inlineDisabled}
            onClick={() => onCommand({
              type: 'range-style',
              style: { emphasis: uniformValue(selectionFormat.fields.emphasis) !== true },
            })}
          >
            <span aria-hidden="true">•</span>
          </button>
          <button
            type="button"
            title={disabledReason ?? '取消高亮'}
            aria-label="取消高亮"
            disabled={inlineDisabled}
            onClick={() => onCommand({ type: 'range-highlight', color: null })}
          >
            <Highlighter size={14} opacity={0.45} />
          </button>
          <button
            type="button"
            title={selectionFormat.mode === 'range'
              ? '清除选区格式'
              : selectionFormat.mode === 'caret'
                ? '清除待输入格式'
                : '请先选择文字再清除格式'}
            aria-label={selectionFormat.mode === 'caret' ? '清除待输入格式' : '清除选区格式'}
            disabled={selectionFormat.mode === 'whole-block'
              || (selectionFormat.mode === 'caret' && !selectionFormat.hasPendingStyle)}
            onClick={() => onCommand({ type: 'range-clear' })}
          >
            <Eraser size={14} />
          </button>
          <label title={formatFieldTitle('文字颜色', selectionFormat.fields.color, disabledReason)}>
            <input
              type="color"
              data-format-state={selectionFormat.fields.color.state}
              aria-label="文字颜色"
              value={colorValue}
              disabled={inlineDisabled}
              onChange={(event) => onCommand({ type: 'range-color', color: event.target.value })}
            />
          </label>
          <span aria-hidden="true" style={{ width: 1, height: 20, background: 'currentColor', opacity: 0.2 }} />
          {block.type === 'heading' ? (
            <label title="标题级别">
              <select
                aria-label="标题级别"
                value={headingLevel}
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
            <button type="button" title="转为标题" aria-label="转为标题" onClick={() => onCommand({ type: 'convert-heading', level: 2 })}>
              <Heading size={14} />
            </button>
          ) : null}
          {block.type === 'heading' || block.type === 'quote' ? (
            <button type="button" title="转为段落" aria-label="转为段落" onClick={() => onCommand({ type: 'convert-paragraph' })}>
              <Type size={14} />
            </button>
          ) : null}
          {block.type === 'list' ? (
            <>
              <button type="button" title="无序列表" aria-label="无序列表" onClick={() => onCommand({ type: 'list-ordered', ordered: false })}>
                <List size={14} />
              </button>
              <button type="button" title="有序列表" aria-label="有序列表" onClick={() => onCommand({ type: 'list-ordered', ordered: true })}>
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
          <button type="button" title="上移" aria-label="上移" onClick={() => onCommand({ type: 'move', direction: 'up' })}>↑</button>
          <button type="button" title="下移" aria-label="下移" onClick={() => onCommand({ type: 'move', direction: 'down' })}>↓</button>
          <button type="button" title="删除块" aria-label="删除块" onClick={() => onCommand({ type: 'delete' })}>
            <Trash2 size={14} />
          </button>
        </div>
      ) : null}
    </div>
  )
}
