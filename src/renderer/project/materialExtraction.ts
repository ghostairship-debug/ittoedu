import type { MaterialExtraction, MaterialFragment } from '../../shared/materialExtraction'
import { MATERIAL_EXTRACTION_LIMITS as limits } from '../../shared/materialExtraction'
import { openPptxPackage, pptxRelationshipId, xmlAll, xmlChildren, xmlFirst, type PptxPackage } from './pptxPackage'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { inspectImageTransformSource } from './imageTransform'

export interface MaterialExtractionOptions {
  pages?: { from: number; to: number }
  onPageCount?: (total: number) => void
  onPageImage?: (image: { assetId: string; width: number; height: number; downsampled: boolean }) => void
}
function pageRange(total: number, options: MaterialExtractionOptions) {
  options.onPageCount?.(total)
  const range = options.pages ?? { from: 1, to: total }
  if (!Number.isSafeInteger(range.from) || !Number.isSafeInteger(range.to) || range.from < 1 || range.to < range.from || range.to > total) throw new Error(`页范围必须在 1–${total} 内`)
  return range
}

function result(format: MaterialExtraction['format']): MaterialExtraction {
  return { version: 1, extractorVersion: 'material-3', format, fragments: [], assets: [], gaps: [] }
}
function add(out: MaterialExtraction, fragment: Omit<MaterialFragment, 'id'>) {
  out.fragments.push({ id: `fragment-${out.fragments.length + 1}`, ...fragment })
}
function verify(out: MaterialExtraction): MaterialExtraction {
  if (out.fragments.reduce((sum, item) => sum + (item.text?.length ?? 0), 0) > limits.textCharacters || out.assets.reduce((sum, item) => sum + item.bytes.length, 0) > limits.outputBytes) throw new Error('材料提取结果超过容量上限')
  if (!out.fragments.length) throw new Error('材料没有可读取内容')
  return out
}
function images(pkg: PptxPackage, node: Element, part: string, locator: MaterialFragment['locator'], out: MaterialExtraction) {
  const relationships = pkg.relationships(part)
  for (const image of [...xmlAll(node, 'blip'), ...xmlAll(node, 'imagedata')]) {
    const id = pptxRelationshipId(image, 'embed') || pptxRelationshipId(image)
    const rel = relationships.find(item => item.id === id)
    if (!rel || rel.external || !pkg.files[rel.target]) { out.gaps.push({ locator, reason: '图片关系缺失或为外部链接' }); continue }
    const ext = rel.target.split('.').pop()?.toLowerCase()
    const mime = ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff', emf: 'image/emf', wmf: 'image/wmf' } as Record<string, string>)[ext ?? '']
    if (!mime) { out.gaps.push({ locator, reason: `无法识别图片格式：${ext}` }); continue }
    let asset = out.assets.find(item => item.id === rel.target)
    if (!asset) { asset = { id: rel.target, mime, bytes: pkg.files[rel.target] }; out.assets.push(asset) }
    add(out, { kind: 'image', locator, assetId: asset.id })
    if (['emf', 'wmf', 'tif', 'tiff'].includes(ext!)) out.gaps.push({ locator, reason: '原图已保留，但此格式需要转换后才能视觉读取' })
  }
}
function content(pkg: PptxPackage, root: Element, part: string, out: MaterialExtraction, page?: number) {
  const partLocator = { part, ...(page ? { page } : {}) }
  for (const name of ['chart', 'relIds', 'oleObj', 'object', 'altChunk', 'pict', 'custGeom', 'prstGeom']) {
    const unresolved = xmlAll(root, name).filter(node => {
      // Office pictures carry a rectangular geometry for their image frame.
      // Their actual pixels are extracted by images(); this is not an unread shape.
      // Keep independent shapes and nonrectangular/custom picture geometry visible.
      const properties = node.parentElement
      const picture = properties?.parentElement
      return !(name === 'prstGeom' && node.getAttribute('prst') === 'rect'
        && properties?.localName === 'spPr' && picture?.localName === 'pic'
        && xmlAll(picture, 'blip').length > 0)
    })
    if (unresolved.length) out.gaps.push({ locator: partLocator, reason: `需要复核未展开图形或对象：${name}` })
  }
  for (const background of xmlAll(root, 'bg')) images(pkg, background, part, partLocator, out)
  let paragraph = 0
  const visit = (node: Element) => {
    const locator = { part, ...(page ? { page } : {}), paragraph: ++paragraph }
    if (node.localName === 'tbl') {
      const text = xmlAll(node, 'tr').map(row => xmlChildren(row).filter(cell => cell.localName === 'tc').map(cell => xmlAll(cell, 't').map(t => t.textContent ?? '').join('')).join('\t')).join('\n')
      if (text.trim()) add(out, { kind: 'table', locator, text })
      images(pkg, node, part, locator, out)
      for (const formula of xmlAll(node, 'oMath')) add(out, { kind: 'formula', locator, text: new XMLSerializer().serializeToString(formula) })
      return
    }
    if (node.localName === 'p') {
      const text = xmlAll(node, 't').filter(t => !t.closest('oMath')).map(t => t.textContent ?? '').join('')
      if (text.trim()) add(out, { kind: 'text', locator, text })
      images(pkg, node, part, locator, out)
      for (const formula of xmlAll(node, 'oMath')) add(out, { kind: 'formula', locator, text: new XMLSerializer().serializeToString(formula) })
      return
    }
    if (node.localName === 'pic') { images(pkg, node, part, locator, out); return }
    for (const child of xmlChildren(node)) visit(child)
  }
  visit(root)
}
export function extractOfficeMaterial(bytes: Uint8Array, format: 'docx' | 'pptx', options: MaterialExtractionOptions = {}): MaterialExtraction {
  const out = result(format)
  const part = format === 'docx' ? 'word/document.xml' : 'ppt/presentation.xml'
  const pkg = openPptxPackage(bytes, part)
  if (format === 'docx') {
    if (options.pages) throw new Error('Word XML 没有可靠页边界，不能按页选择；请使用全文或导出 PDF 后选择页范围')
    const body = xmlFirst(pkg.xml(part), 'body')
    if (!body) throw new Error('Word 正文缺失')
    content(pkg, body, part, out)
    for (const rel of pkg.relationships(part).filter(item => /\/(header|footer|footnotes|endnotes)$/.test(item.type))) {
      if (rel.external || !pkg.files[rel.target]) { out.gaps.push({ locator: { part }, reason: '附属正文关系缺失' }); continue }
      content(pkg, pkg.xml(rel.target).documentElement, rel.target, out)
    }
  } else {
    const slides = xmlAll(pkg.xml(part), 'sldId')
    if (!slides.length || slides.length > limits.pages) throw new Error('材料幻灯片数量须为 1–100')
    const range = pageRange(slides.length, options)
    const relationships = pkg.relationships(part)
    slides.forEach((slide, index) => {
      if (index + 1 < range.from || index + 1 > range.to) return
      const rel = relationships.find(item => item.id === pptxRelationshipId(slide) && item.type.endsWith('/slide'))
      if (!rel || rel.external || !pkg.files[rel.target]) throw new Error(`第 ${index + 1} 页内容缺失`)
      content(pkg, pkg.xml(rel.target).documentElement, rel.target, out, index + 1)
      const inherited = new Set<string>([rel.target])
      const readInherited = (source: string) => {
        for (const relation of pkg.relationships(source).filter(item => /\/(slideLayout|slideMaster)$/.test(item.type))) {
          if (relation.external || !pkg.files[relation.target]) { out.gaps.push({ locator: { part: source, page: index + 1 }, reason: '版式或母版内容缺失' }); continue }
          if (inherited.has(relation.target)) continue
          inherited.add(relation.target)
          content(pkg, pkg.xml(relation.target).documentElement, relation.target, out, index + 1)
          readInherited(relation.target)
        }
      }
      readInherited(rel.target)
      for (const note of pkg.relationships(rel.target).filter(item => item.type.endsWith('/notesSlide'))) {
        if (note.external || !pkg.files[note.target]) { out.gaps.push({ locator: { part: rel.target, page: index + 1 }, reason: '备注内容缺失' }); continue }
        content(pkg, pkg.xml(note.target).documentElement, note.target, out, index + 1)
      }
    })
  }
  return verify(out)
}

/** Each PDF page is also rasterized: scanned text, equations and diagrams remain readable. */
export async function extractPdfMaterial(bytes: Uint8Array, options: MaterialExtractionOptions = {}): Promise<MaterialExtraction> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
  const loading = pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: true })
  const out = result('pdf')
  try {
    const pdf = await loading.promise
    if (pdf.numPages > limits.pages) throw new Error('PDF 材料不能超过 100 页')
    const range = pageRange(pdf.numPages, options)
    let totalBytes = 0
    for (let page = range.from; page <= range.to; page++) {
      const source = await pdf.getPage(page)
      const locator = { part: 'document.pdf', page }
      const text = (await source.getTextContent()).items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('').trim()
      if (text) add(out, { kind: 'text', locator, text })
      const initial = source.getViewport({ scale: 1 })
      const viewport = source.getViewport({ scale: Math.min(2, 1600 / Math.max(initial.width, initial.height)) })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height)
      try {
        await source.render({ canvas, viewport }).promise
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('PDF 页面图像编码失败')), 'image/png'))
        const imageBytes = new Uint8Array(await blob.arrayBuffer())
        totalBytes += imageBytes.length
        if (totalBytes > limits.outputBytes) throw new Error('PDF 页面图像超过容量上限')
        const id = `page-${page}.png`
        options.onPageImage?.({ assetId: id, width: canvas.width, height: canvas.height, downsampled: viewport.scale < 1 })
        out.assets.push({ id, mime: 'image/png', bytes: imageBytes })
        add(out, { kind: 'image', locator, assetId: id })
        if (!text) out.gaps.push({ locator, reason: '本页没有可提取文字；需要实际阅读保存的页面图像', resolution: { kind: 'read-page-image', assetId: id } })
      } finally { canvas.width = 0; canvas.height = 0; source.cleanup() }
    }
    return verify(out)
  } finally { await loading.destroy() }
}
export async function extractMaterial(bytes: Uint8Array, filename: string): Promise<MaterialExtraction> {
  if (!bytes.length || bytes.length > limits.sourceBytes) throw new Error('材料须为非空且不超过 32 MiB 的文件')
  const extension = filename.split('.').pop()?.toLowerCase()
  if (extension === 'docx' || extension === 'pptx') return extractOfficeMaterial(bytes, extension)
  if (extension === 'pdf') return extractPdfMaterial(bytes)
  const imageMime = ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' } as Record<string, string>)[extension ?? '']
  if (imageMime) {
    const inspected = await inspectImageTransformSource(bytes, imageMime)
    if (inspected.status !== 'ready') throw new Error(inspected.message)
    const out = result('image'), assetId = `original.${extension === 'jpeg' ? 'jpg' : extension}`
    out.assets.push({ id: assetId, mime: imageMime, bytes: bytes.slice() })
    add(out, { kind: 'image', locator: { part: filename, page: 1 }, assetId })
    return verify(out)
  }
  if (!['txt', 'md', 'csv'].includes(extension ?? '')) throw new Error('不支持此材料格式')
  const out = result('text')
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  if (text.trim()) add(out, { kind: 'text', locator: { part: filename }, text })
  return verify(out)
}
