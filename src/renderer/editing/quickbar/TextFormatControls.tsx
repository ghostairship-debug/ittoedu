import type { ReactNode } from 'react'
import { AArrowDown, AArrowUp, AlignCenter, AlignLeft, AlignRight, Baseline, Bold, Highlighter, Italic, Underline } from 'lucide-react'
import type { TextRunStyle } from '../../../shared/contracts/native-v1/types'
import { FONT_FAMILY_OPTIONS } from '../../../shared/fonts/fontFamilyCatalog'
import { QuickBarButton, QuickBarColorButton, QuickBarLabel } from './SelectionQuickBar'

export interface TextFormatState {
  bold?: boolean | 'mixed'
  italic?: boolean | 'mixed'
  underline?: boolean | 'mixed'
  fontSize?: number | 'mixed'
  fontFamily?: string | 'mixed'
  color?: string | null
  highlightColor?: string | null
}
type Alignment = 'left' | 'center' | 'right'
const ALIGN_ORDER: readonly Alignment[] = ['left', 'center', 'right']
const ALIGN_ICON = { left: <AlignLeft size={14} />, center: <AlignCenter size={14} />, right: <AlignRight size={14} /> }
const ALIGN_LABEL = { left: '左对齐', center: '居中', right: '右对齐' }

/** Presentation shared by object-wide text and the professional editor's real range/caret commands. */
export function TextFormatControls({ value, onStyle, onToggle, onStep, alignment, highlight = true, scope }: {
  value: TextFormatState
  onStyle(patch: TextRunStyle): void
  onToggle(key: 'bold' | 'italic' | 'underline'): void
  onStep(direction: 1 | -1): void
  alignment?: { value: Alignment | 'mixed'; set(value: Alignment): void }
  highlight?: boolean
  scope?: ReactNode
}) {
  const align = alignment?.value === 'mixed' ? 'left' : alignment?.value ?? 'left'
  const next = ALIGN_ORDER[(ALIGN_ORDER.indexOf(align) + 1) % ALIGN_ORDER.length]!
  const family = value.fontFamily ?? ''
  return <>
    {scope && <QuickBarLabel>{scope}</QuickBarLabel>}
    <QuickBarButton label="加粗" icon={<Bold size={14} />} pressed={value.bold} onClick={() => onToggle('bold')} />
    <QuickBarButton label="斜体" icon={<Italic size={14} />} pressed={value.italic} onClick={() => onToggle('italic')} />
    <QuickBarButton label="下划线" icon={<Underline size={14} />} pressed={value.underline} onClick={() => onToggle('underline')} />
    <QuickBarButton label="减小字号" icon={<AArrowDown size={15} />} disabled={typeof value.fontSize === 'number' && value.fontSize <= 8} onClick={() => onStep(-1)} />
    <input aria-label="字号" type="number" min="8" max="400" value={value.fontSize === 'mixed' ? '' : value.fontSize ?? ''}
      placeholder={value.fontSize === 'mixed' ? '混合' : '默认'} style={{ width: 48 }}
      onChange={event => { const size = Number(event.target.value); if (event.target.value && size >= 8 && size <= 400) onStyle({ fontSize: size }) }} />
    <QuickBarButton label="增大字号" icon={<AArrowUp size={15} />} disabled={typeof value.fontSize === 'number' && value.fontSize >= 400} onClick={() => onStep(1)} />
    <select aria-label="字体" value={family === 'mixed' ? '__mixed' : family} style={{ maxWidth: 112 }}
      onChange={event => { if (event.target.value && event.target.value !== '__mixed') onStyle({ fontFamily: event.target.value }) }}>
      <option value="">默认字体</option>{family === 'mixed' && <option value="__mixed">混合字体</option>}
      {family && family !== 'mixed' && !FONT_FAMILY_OPTIONS.some(option => option.family === family) && <option value={family}>{family}</option>}
      {FONT_FAMILY_OPTIONS.map(option => <option key={option.family} value={option.family}>{option.label}</option>)}
    </select>
    <QuickBarColorButton label="文字颜色" icon={<Baseline size={14} />} value={value.color} onPick={color => { if (color) onStyle({ color }) }} />
    {highlight && <QuickBarColorButton label="高亮" icon={<Highlighter size={14} />} variant="highlight" value={value.highlightColor} onPick={highlightColor => onStyle({ highlightColor })} />}
    {alignment && <QuickBarButton label={alignment.value === 'mixed' ? '混合对齐（点按切换为居中）' : `${ALIGN_LABEL[align]}（点按切换为${ALIGN_LABEL[next]}）`}
      icon={ALIGN_ICON[align]} onClick={() => alignment.set(next)} />}
  </>
}
