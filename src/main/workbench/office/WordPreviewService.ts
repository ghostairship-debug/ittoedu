import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { PDFDocument } from 'pdf-lib'
import { descendants, NS, OfficePackage } from './officePackage'
import { WordPreviewError, throwWordPreviewError } from './WordPreviewError'

export interface WordPreviewEngine {
  name: string
  version: string
}

export interface WordPreviewConversionInput {
  /** An owned disposable copy, never the user's original file. */
  sourcePath: string
  outputDirectory: string
  profileDirectory: string
  signal?: AbortSignal
}

/** The runtime owner prepares its renderer and waits for conversion/stop to settle. */
export type WordPreviewConverter = (input: WordPreviewConversionInput) => Promise<{
  engine: WordPreviewEngine
  notices?: string[]
}>

export interface WordPreviewPdf {
  pdfBytes: Uint8Array
  sourceSha256: string
  pageCount: number
  pages: Array<{ width: number; height: number; rotation: number }>
  engine: WordPreviewEngine
  notices: string[]
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

/**
 * Creates a disposable paginated projection from a file-owner snapshot.
 * Binding, authorization and source revision remain with the existing artifact owner;
 * this service deliberately accepts no path to an original document and has no writer.
 */
export class WordPreviewService {
  constructor(private readonly temporaryRoot: string, private readonly convert: WordPreviewConverter) {}

  async render(bytes: Uint8Array, options: { signal?: AbortSignal } = {}): Promise<WordPreviewPdf> {
    options.signal?.throwIfAborted()
    const source = Uint8Array.from(bytes)
    let externalContent: number
    try {
      const pkg = new OfficePackage(source), main = pkg.xml(pkg.main()).documentElement
      if (![NS.word, 'http://purl.oclc.org/ooxml/wordprocessingml/main'].includes(main.namespaceURI ?? '') || main.localName !== 'document') {
        throw new WordPreviewError('invalid_document')
      }
      externalContent = Object.keys(pkg.parts).filter(part => part.endsWith('.rels')).reduce((count, part) => count
        + descendants(pkg.xml(part), NS.relationship, 'Relationship').filter(relation => relation.getAttribute('TargetMode') === 'External'
          && !relation.getAttribute('Type')?.endsWith('/hyperlink')).length, 0)
    } catch { throwWordPreviewError(options.signal, 'invalid_document') }
    const sourceSha256 = sha256(source)
    await fs.mkdir(this.temporaryRoot, { recursive: true })
    const directory = await fs.mkdtemp(path.join(this.temporaryRoot, 'word-preview-'))
    try {
      const sourcePath = path.join(directory, 'document.docx')
      const outputDirectory = path.join(directory, 'rendered')
      const profileDirectory = path.join(directory, 'profile')
      await fs.mkdir(outputDirectory)
      await fs.mkdir(profileDirectory)
      await fs.writeFile(sourcePath, source)
      options.signal?.throwIfAborted()
      const conversion = await this.convert({ sourcePath, outputDirectory, profileDirectory, signal: options.signal })
      options.signal?.throwIfAborted()
      // Each invocation has its own empty output directory. An old successful PDF
      // cannot satisfy a failed reload of a newer document version.
      const pdfBytes = Uint8Array.from(await fs.readFile(path.join(outputDirectory, 'document.pdf')).catch(error => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new WordPreviewError('conversion')
        throw error
      }))
      if (Buffer.from(pdfBytes.subarray(0, 5)).toString('ascii') !== '%PDF-') {
        throw new WordPreviewError('conversion')
      }
      let pdf: PDFDocument
      try { pdf = await PDFDocument.load(pdfBytes, { updateMetadata: false }) }
      catch { throwWordPreviewError(options.signal, 'conversion') }
      const pages = pdf.getPages().map(page => ({ width: page.getWidth(), height: page.getHeight(), rotation: page.getRotation().angle }))
      if (!pages.length || pages.some(page => !Number.isFinite(page.width) || !Number.isFinite(page.height)
        || page.width <= 0 || page.height <= 0)) throw new WordPreviewError('conversion')
      if (sha256(await fs.readFile(sourcePath)) !== sourceSha256) throw new WordPreviewError('conversion')
      options.signal?.throwIfAborted()
      return { pdfBytes, sourceSha256, pageCount: pages.length, pages,
        engine: { ...conversion.engine }, notices: [
          ...(externalContent ? [`文稿有 ${externalContent} 处外链内容；预览使用文稿中已有内容，不自动更新外部数据。`] : []),
          ...(conversion.notices ?? []),
        ] }
    } finally {
      // The converter must settle its owned process before returning or rejecting.
      await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    }
  }
}
