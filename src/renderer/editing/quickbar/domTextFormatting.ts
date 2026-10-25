import type { TextFormatView } from './TextFormatActions'
import type { PropertiesPatch } from '../../ui/properties/SlideNativePropertiesPanel'
import { stepFontSize } from '../../../shared/fontSizeStep'

/** CSS-backed text fields use the same format controls and style conversion in every host. */
export function domTextFormatView(text: string, style: Record<string, string | undefined>, svg: boolean): TextFormatView {
  const size = Number.parseFloat(style['font-size'] ?? '') || 16, align = style['text-align']
  const gap = /^calc\(\s*1\.22em\s*\+\s*([\d.]+)px\s*\)$/.exec(style['line-height'] ?? '')
  return { text, runs: [], style: {
    fontFamily: style['font-family'] ?? 'sans-serif', fontSize: size, color: (svg ? style.fill : style.color) ?? '#000000',
    bold: style['font-weight'] === 'bold' || Number.parseFloat(style['font-weight'] ?? '') >= 600,
    italic: ['italic', 'oblique'].includes(style['font-style'] ?? ''), underline: style['text-decoration-line']?.split(/\s+/).includes('underline') ?? false,
    highlightColor: !style['background-color'] || ['transparent', 'rgba(0, 0, 0, 0)'].includes(style['background-color']) ? null : style['background-color'],
    align: align === 'center' || align === 'right' ? align : 'left',
    lineSpacing: gap ? Number(gap[1]) : Math.max(0, (Number.parseFloat(style['line-height'] ?? '') || size * 1.22) - size * 1.22),
  } }
}

export function domTextStylePatch(textStyle: Record<string, string | undefined>, svg: boolean, view: TextFormatView, patch: PropertiesPatch): Record<string, string> {
  const style = ('style' in patch ? patch.style : undefined) as Partial<TextFormatView['style']> | undefined, result: Record<string, string> = {}
  if (patch.fontSizeStep) result['font-size'] = `${stepFontSize(view.style.fontSize, patch.fontSizeStep)}px`
  if (!style) return result
  if (style.fontFamily !== undefined) result['font-family'] = style.fontFamily
  if (style.fontSize !== undefined) result['font-size'] = `${style.fontSize}px`
  if (style.color !== undefined) {
    result.color = style.color
    if (svg) result.fill = style.color
    else result['-webkit-text-fill-color'] = 'currentColor'
  }
  if (style.bold !== undefined) result['font-weight'] = style.bold ? '700' : '400'
  if (style.italic !== undefined) result['font-style'] = style.italic ? 'italic' : 'normal'
  if (style.underline !== undefined) {
    const lines = new Set((textStyle['text-decoration-line'] ?? '').split(/\s+/).filter(value => value && value !== 'none'))
    if (style.underline) lines.add('underline'); else lines.delete('underline')
    result['text-decoration-line'] = [...lines].join(' ') || 'none'
  }
  if (style.highlightColor !== undefined) result['background-color'] = style.highlightColor ?? 'transparent'
  if (style.align !== undefined) result['text-align'] = style.align
  if (style.lineSpacing !== undefined) result['line-height'] = `calc(1.22em + ${style.lineSpacing}px)`
  return result
}
