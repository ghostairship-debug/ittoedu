import type { ComponentAuthorSpot, CourseProjectV10 } from '../../../../shared/contracts/component-platform'
import type { PropertiesPatch } from '../../../ui/properties/SlideNativePropertiesPanel'
import type { TextFormatView } from '../../../editing/quickbar/TextFormatActions'
import { stepFontSize } from '../../../../shared/fontSizeStep'
import { authorSpotIsSvgText, authorSpotStyleSourceRegion } from '../../../../core/components/authoring/componentAuthorEdits'

export function authorSpotFormatView(project: CourseProjectV10, spot: ComponentAuthorSpot): TextFormatView & { alignment: boolean; highlight: boolean; lineSpacing: boolean } | null {
  if (spot.kind !== 'text' || typeof spot.initialValue !== 'string' || !spot.textStyle || !spot.authorKey || !spot.binding) return null
  const exactHtml = !spot.geometry && authorSpotStyleSourceRegion(project, spot)
  if (!spot.geometry && !exactHtml) return null
  const style = { ...spot.textStyle, ...project.instances[spot.instanceId]?.authoring?.records?.[spot.authorKey]?.overrides.style }
  const size = Number.parseFloat(style['font-size'] ?? '') || 16
  const align = style['text-align']
  const svg = authorSpotIsSvgText(spot)
  const gap = /^calc\(\s*1\.22em\s*\+\s*([\d.]+)px\s*\)$/.exec(style['line-height'] ?? '')
  const alignment = Boolean(spot.geometry) && /^(?:p|div|h[1-6]|li|td|th|section|article|blockquote|pre|header|footer|main|aside)$/.test(spot.binding.path.at(-1)?.tag ?? '')
  return { text: spot.initialValue, runs: [], alignment, highlight: !svg, lineSpacing: !svg, style: {
    fontFamily: style['font-family'] ?? 'sans-serif', fontSize: size, color: (svg ? style.fill : style.color) ?? '#000000',
    bold: style['font-weight'] === 'bold' || Number.parseFloat(style['font-weight'] ?? '') >= 600,
    italic: ['italic', 'oblique'].includes(style['font-style'] ?? ''), underline: style['text-decoration-line']?.split(/\s+/).includes('underline') ?? false,
    highlightColor: !style['background-color'] || ['transparent', 'rgba(0, 0, 0, 0)'].includes(style['background-color']) ? null : style['background-color'],
    align: align === 'center' || align === 'right' ? align : 'left',
    lineSpacing: gap ? Number(gap[1]) : Math.max(0, (Number.parseFloat(style['line-height'] ?? '') || size * 1.22) - size * 1.22),
  } }
}

export function authorSpotStylePatch(spot: ComponentAuthorSpot, view: TextFormatView, patch: PropertiesPatch): Record<string, string> {
  const style = ('style' in patch ? patch.style : undefined) as Partial<TextFormatView['style']> | undefined, result: Record<string, string> = {}
  if (patch.fontSizeStep) result['font-size'] = `${stepFontSize(view.style.fontSize, patch.fontSizeStep)}px`
  if (!style) return result
  if (style.fontFamily !== undefined) result['font-family'] = style.fontFamily
  if (style.fontSize !== undefined) result['font-size'] = `${style.fontSize}px`
  if (style.color !== undefined) {
    result.color = style.color
    if (authorSpotIsSvgText(spot)) result.fill = style.color
    else result['-webkit-text-fill-color'] = 'currentColor'
  }
  if (style.bold !== undefined) result['font-weight'] = style.bold ? '700' : '400'
  if (style.italic !== undefined) result['font-style'] = style.italic ? 'italic' : 'normal'
  if (style.underline !== undefined) {
    const lines = new Set((spot.textStyle?.['text-decoration-line'] ?? '').split(/\s+/).filter(value => value && value !== 'none'))
    if (style.underline) lines.add('underline'); else lines.delete('underline')
    result['text-decoration-line'] = [...lines].join(' ') || 'none'
  }
  if (style.highlightColor !== undefined) result['background-color'] = style.highlightColor ?? 'transparent'
  if (style.align !== undefined) result['text-align'] = style.align
  if (style.lineSpacing !== undefined) result['line-height'] = `calc(1.22em + ${style.lineSpacing}px)`
  return result
}
