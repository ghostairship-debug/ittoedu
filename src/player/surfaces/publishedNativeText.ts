import type {
  LayerFrame,
  NativeElementContent,
} from '../../shared/courseProjectTypes'
import type { TextNode } from '../../shared/contracts/native-v1'
import { analyzeTextNodeLayout } from '../../shared/textLayout'
import { flowRichTextSegments } from './flow/flowModel'
import { colorWithAlpha } from '../../shared/colorAlpha'

type PublishedNativeTextFrame = Pick<LayerFrame, 'width' | 'height'>

function publishedTextNode(
  data: Extract<NativeElementContent, { nativeType: 'text' }>['data'],
  frame: PublishedNativeTextFrame,
): TextNode {
  return {
    id: 'published-native-text',
    name: 'Published native text',
    type: 'text',
    x: 0,
    y: 0,
    width: Math.max(1, frame.width),
    height: Math.max(1, frame.height),
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    playbackInitialVisibility: 'inherit',
    text: data.text,
    runs: data.runs,
    style: data.style,
  }
}

export function paintPublishedNativeText(
  wrap: HTMLElement,
  data: Extract<NativeElementContent, { nativeType: 'text' }>['data'],
  frame?: PublishedNativeTextFrame,
): void {
  const style = data.style
  const fontSize = frame
    ? analyzeTextNodeLayout(publishedTextNode(data, frame)).fontSize
    : style.fontSize
  wrap.style.boxSizing = 'border-box'
  wrap.style.backgroundColor = colorWithAlpha(style.backgroundColor, style.backgroundOpacity)
  wrap.style.borderRadius = `${Math.max(0, style.cornerRadius)}px`
  wrap.style.overflow = 'hidden'
  wrap.style.whiteSpace = 'pre-wrap'
  wrap.style.fontFamily = style.fontFamily || '"Microsoft YaHei", sans-serif'
  wrap.style.fontSize = `${Math.max(1, fontSize)}px`
  wrap.style.fontWeight = style.bold ? '700' : '400'
  wrap.style.fontStyle = style.italic ? 'italic' : 'normal'
  wrap.style.color = style.color || '#1f2937'
  wrap.style.textAlign = style.align
  wrap.style.lineHeight = `${Math.max(1, (
    frame ? fontSize * 1.22 : fontSize
  ) + style.lineSpacing)}px`
  wrap.style.letterSpacing = `${style.letterSpacing}px`
  wrap.style.padding = `${Math.max(0, style.padding)}px`
  wrap.style.textDecoration = 'none'
  wrap.style.writingMode = style.writingMode === 'horizontal' ? 'horizontal-tb' : style.writingMode

  wrap.textContent = ''

  const segments = flowRichTextSegments(data.text, data.runs)
  const dom = wrap.ownerDocument
  for (const segment of segments) {
    const span = dom.createElement('span')
    span.textContent = segment.text

    const isBold = segment.style.bold ?? style.bold
    span.style.fontWeight = isBold ? '700' : '400'

    const isItalic = segment.style.italic ?? style.italic
    span.style.fontStyle = isItalic ? 'italic' : 'normal'

    const isUnderline = segment.style.underline ?? style.underline
    const isStrike = segment.style.strike ?? style.strike
    const decorations: string[] = []
    if (isUnderline) decorations.push('underline')
    if (isStrike) decorations.push('line-through')
    span.style.textDecoration = decorations.join(' ') || 'none'

    span.style.color = segment.style.color || style.color || '#1f2937'

    const highlightColor = segment.style.highlightColor !== undefined
      ? segment.style.highlightColor
      : style.highlightColor
    if (highlightColor) {
      span.style.backgroundColor = highlightColor
    }

    const hasEmphasis = segment.style.emphasis ?? style.emphasis
    if (hasEmphasis) {
      span.style.textEmphasis = 'filled dot'
      ;(span.style as unknown as Record<string, string>).webkitTextEmphasis = 'filled dot'
    }

    wrap.appendChild(span)
  }
}
