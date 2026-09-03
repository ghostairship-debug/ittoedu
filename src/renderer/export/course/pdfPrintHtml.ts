export interface PdfPrintImage {
  readonly dataUrl: string
  readonly width: number
  readonly height: number
}

export function buildPdfPrintHtml(
  projectTitle: string,
  images: readonly (string | PdfPrintImage)[],
): string {
  const escapedTitle = projectTitle.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!)
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapedTitle}</title><style>
  @page { size: 13.333in 7.5in; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; }
  .page { width: 13.333in; height: 7.5in; break-after: page; page-break-after: always; overflow: hidden; }
  .page:last-child { break-after: auto; page-break-after: auto; }
  .page { display: flex; align-items: center; justify-content: center; background: #fff; }
  img { display: block; max-width: 100%; max-height: 100%; width: auto; height: auto; object-fit: contain; }
  </style></head><body>${images.map((image, index) => {
    const captured = typeof image === 'string'
      ? { dataUrl: image, width: 1280, height: 720 }
      : image
    return `<section class="page" data-capture-width="${captured.width}" data-capture-height="${captured.height}"><img src="${captured.dataUrl}" alt="第 ${index + 1} 页"></section>`
  }).join('')}</body></html>`
}
