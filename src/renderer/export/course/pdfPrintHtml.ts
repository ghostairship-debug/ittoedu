import { resolvePrintPageSize, type FlowDocxPageSize, type FlowDocxOrientation } from '../flowPageBox'

export interface PdfPrintImage {
  readonly dataUrl: string
  readonly width: number
  readonly height: number
}

export interface PdfPrintOptions {
  pageSize?: FlowDocxPageSize
  orientation?: FlowDocxOrientation
  /** Software-owned unique CSS page identifier for a mixed document. */
  pageName?: string
}

export function pdfPrintPageName(id: string): string {
  return `output-${Array.from(id).map(char => char.codePointAt(0)!.toString(16)).join('-')}`
}

export function buildPdfPrintHtml(
  projectTitle: string,
  images: readonly (string | PdfPrintImage)[],
  options: PdfPrintOptions = {},
): string {
  const escapedTitle = projectTitle.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!)
  const pageName = pdfPrintPageName(options.pageName ?? 'capture')
  const scope = `[data-pdf-print-root="${pageName}"]`
  const captures = images.map(image => typeof image === 'string' ? { dataUrl: image, width: 1280, height: 720 } : image)
  const pages = captures.map(image => resolvePrintPageSize(options.pageSize ?? 'surface-native', options.orientation ?? 'auto', image))
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapedTitle}</title><style>
  ${pages.map((page, index) => `@page ${pageName}-${index} { size: ${page.cssSize}; margin: 0; }`).join('\n')}
  ${scope}, ${scope} * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; }
  ${scope} .page { break-after: page; page-break-after: always; overflow: hidden; display: flex; align-items: center; justify-content: center; background: #fff; }
  ${scope} .page:last-child { break-after: auto; page-break-after: auto; }
  ${scope} img { display: block; max-width: 100%; max-height: 100%; width: auto; height: auto; object-fit: contain; }
  </style></head><body><main data-pdf-print-root="${pageName}">${captures.map((captured, index) => {
    const page = pages[index]!
    return `<section class="page" style="page:${pageName}-${index};width:${page.widthPx}px;height:${page.heightPx}px" data-capture-width="${captured.width}" data-capture-height="${captured.height}"><img src="${captured.dataUrl}" alt="第 ${index + 1} 页"></section>`
  }).join('')}</main></body></html>`
}
