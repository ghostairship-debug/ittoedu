import { Pencil } from 'lucide-react'
import { QuickBarButton } from './SelectionQuickBar'
import type { PropertiesItemView, PropertiesPatch } from '../../ui/properties/SlideNativePropertiesPanel'
import { TextFormatControls, type TextFormatState } from './TextFormatControls'

type TextView = Extract<PropertiesItemView, { type: 'text' }>
export type TextFormatView = Pick<TextView, 'text' | 'runs'> & { style: Pick<TextView['style'],
  'fontFamily' | 'fontSize' | 'color' | 'bold' | 'italic' | 'underline' | 'highlightColor' | 'align' | 'lineSpacing'> }

/** Resolve runs as well as the default; mixed whole-object formatting must not pretend to be uniform. */
export function textFormatState(view: TextFormatView): TextFormatState {
  const samples = Array.from(view.text).map((_char, index) => ({ ...view.style, ...view.runs.find(run => run.start <= index && run.end > index)?.style }))
  if (!samples.length) samples.push(view.style)
  const read = <Key extends keyof TextFormatState>(key: Key): TextFormatState[Key] => {
    const first = samples[0]![key as keyof typeof view.style]
    return (samples.every(style => style[key as keyof typeof view.style] === first) ? first : 'mixed') as TextFormatState[Key]
  }
  return { bold: read('bold'), italic: read('italic'), underline: read('underline'), fontSize: read('fontSize'), fontFamily: read('fontFamily'),
    color: samples.every(style => style.color === samples[0]!.color) ? samples[0]!.color : null,
    highlightColor: samples.every(style => style.highlightColor === samples[0]!.highlightColor) ? samples[0]!.highlightColor : null }
}

/** The same object-format controls serve professional text and a bound local text leaf. */
export function TextFormatActions({ view, patch, editText, alignment = true, highlight = true }: { view: TextFormatView; patch(patch: PropertiesPatch): void; editText?: () => void; alignment?: boolean; highlight?: boolean }) {
  const value = textFormatState(view)
  return <>
    {editText && <QuickBarButton label="编辑文字" icon={<Pencil size={14} />} onClick={editText} />}
    <TextFormatControls value={value} scope="全文" onStyle={style => patch({ style })}
      onToggle={key => patch({ style: { [key]: value[key] !== true } })} onStep={fontSizeStep => patch({ fontSizeStep })}
      highlight={highlight} alignment={alignment ? { value: view.style.align, set: align => patch({ style: { align } }) } : undefined} />
  </>
}
