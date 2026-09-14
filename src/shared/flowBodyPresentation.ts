import { BUNDLED_TEXT_FONT_FAMILY } from './fonts/bundledFontFamilies'

/** The authoring paper and every Published carrier share these content metrics. */
export const FLOW_BODY_FONT_FAMILY = `"${BUNDLED_TEXT_FONT_FAMILY}","Microsoft YaHei","PingFang SC",sans-serif`
export const FLOW_BODY_SCROLL_PADDING = '24px 16px 48px'
export const FLOW_BODY_PAPER_PADDING = '28px 36px 64px'
export interface FlowWidthLayout {
  readonly widthMode?: 'fluid' | 'reading'
  readonly readingWidth: number
}
export function flowPaperMaxWidth(layout: FlowWidthLayout): string {
  return layout.widthMode === 'fluid' ? 'none' : `${layout.readingWidth}px`
}
/** Border-box paper and content sizes before observation transforms. */
export function resolveFlowBodyWidth(layout: FlowWidthLayout, viewportWidth: number): number {
  const paper = Math.max(0, viewportWidth - 32)
  return Math.max(0, (layout.widthMode === 'fluid' ? paper : Math.min(paper, layout.readingWidth)) - 72)
}
export interface FlowParagraphPresentation {
  readonly textAlign: 'left' | 'center' | 'right'
  readonly lineHeight: number
}

/** Existing V9 paragraph spacing semantics, shared by DOM and static projections. */
export function resolveFlowParagraphPresentation(block: {
  readonly textAlign?: 'left' | 'center' | 'right'
  readonly lineSpacing?: number
}): FlowParagraphPresentation {
  return { textAlign: block.textAlign ?? 'left', lineHeight: 1.6 + (block.lineSpacing ?? 0) / 16 }
}
export const FLOW_BODY_CSS = `
.flow-body-content{box-sizing:border-box;font-family:${FLOW_BODY_FONT_FAMILY};font-size:16px;line-height:1.6;color:#1f2937;overflow-wrap:anywhere}
.flow-body-content *{box-sizing:border-box}
.flow-body-content p,.flow-body-content h1,.flow-body-content h2,.flow-body-content h3,.flow-body-content h4,.flow-body-content h5,.flow-body-content h6,.flow-body-content blockquote,.flow-body-content ul,.flow-body-content ol,.flow-body-content figure,.flow-body-content pre{margin:0}
.flow-body-content h1{font-size:2em}.flow-body-content h2{font-size:1.5em}.flow-body-content h3{font-size:1.17em}.flow-body-content h4{font-size:1em}.flow-body-content h5{font-size:.83em}.flow-body-content h6{font-size:.67em}
.flow-body-content blockquote{padding-left:20px;border-left:3px solid #cbd5e1}
.flow-body-content ul,.flow-body-content ol{padding-left:32px}
.flow-body-content [data-flow-body-block]{position:relative;margin:0 0 12px}
.flow-body-content [data-flow-idle-rich-text],.flow-body-content [data-flow-published-rich-text]{white-space:pre-wrap;overflow-wrap:anywhere;min-height:1lh;display:block}
.flow-body-content .flow-block-media>img,.flow-body-content .flow-block-media>video{display:block}
.flow-body-content table{width:100%;border-collapse:collapse}
.flow-body-content th,.flow-body-content td{padding:8px;border:1px solid #cbd5e1;text-align:left}
`.trim()
