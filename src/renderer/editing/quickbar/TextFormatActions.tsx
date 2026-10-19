import { AArrowDown, AArrowUp, AlignCenter, AlignLeft, AlignRight, Baseline, Bold, Highlighter, Italic, Pencil, Underline } from 'lucide-react'
import { QuickBarButton, QuickBarColorButton, QuickBarLabel } from './SelectionQuickBar'
import type { PropertiesItemView, PropertiesPatch } from '../../ui/properties/SlideNativePropertiesPanel'

type TextView = Extract<PropertiesItemView, { type: 'text' }>
export type TextFormatView = Pick<TextView, 'text' | 'runs'> & { style: Pick<TextView['style'],
  'fontFamily' | 'fontSize' | 'color' | 'bold' | 'italic' | 'underline' | 'highlightColor' | 'align' | 'lineSpacing'> }
const ALIGN_ORDER = ['left', 'center', 'right'] as const
const ALIGN_ICON = { left: <AlignLeft size={14} />, center: <AlignCenter size={14} />, right: <AlignRight size={14} /> }
const ALIGN_LABEL = { left: '左对齐', center: '居中', right: '右对齐' }

/** The same object-format controls serve professional text and a bound local text leaf. */
export function TextFormatActions({ view, patch, editText, alignment = true, highlight = true }: { view: TextFormatView; patch(patch: PropertiesPatch): void; editText?: () => void; alignment?: boolean; highlight?: boolean }) {
  const sizes = [...new Set(Array.from(view.text).map((_char, index) => view.runs.find(run => run.start <= index && run.end > index)?.style.fontSize ?? view.style.fontSize))]
  const align = ALIGN_ORDER.includes(view.style.align) ? view.style.align : 'left'
  const next = ALIGN_ORDER[(ALIGN_ORDER.indexOf(align) + 1) % ALIGN_ORDER.length]!
  return <>
    {editText && <QuickBarButton label="编辑文字" icon={<Pencil size={14} />} onClick={editText} />}
    <QuickBarButton label="加粗" icon={<Bold size={14} />} pressed={view.style.bold} onClick={() => patch({ style: { bold: !view.style.bold } })} />
    <QuickBarButton label="斜体" icon={<Italic size={14} />} pressed={view.style.italic} onClick={() => patch({ style: { italic: !view.style.italic } })} />
    <QuickBarButton label="下划线" icon={<Underline size={14} />} pressed={view.style.underline} onClick={() => patch({ style: { underline: !view.style.underline } })} />
    <QuickBarButton label="减小字号" icon={<AArrowDown size={15} />} disabled={sizes.length > 0 && sizes.every(size => size <= 8)} onClick={() => patch({ fontSizeStep: -1 })} />
    <QuickBarLabel>{sizes.length > 1 ? '混合' : Math.round(sizes[0] ?? view.style.fontSize)}</QuickBarLabel>
    <QuickBarButton label="增大字号" icon={<AArrowUp size={15} />} disabled={sizes.length > 0 && sizes.every(size => size >= 400)} onClick={() => patch({ fontSizeStep: 1 })} />
    <QuickBarColorButton label="文字颜色" icon={<Baseline size={14} />} value={view.style.color} onPick={color => { if (color) patch({ style: { color } }) }} />
    {highlight && <QuickBarColorButton label="高亮" icon={<Highlighter size={14} />} variant="highlight" value={view.style.highlightColor} onPick={highlightColor => patch({ style: { highlightColor } })} />}
    {alignment && <QuickBarButton label={`${ALIGN_LABEL[align]}（点按切换为${ALIGN_LABEL[next]}）`} icon={ALIGN_ICON[align]} onClick={() => patch({ style: { align: next } })} />}
  </>
}
