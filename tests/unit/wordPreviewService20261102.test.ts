// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { applyOfficeContent } from '../../src/main/workbench/office/OfficeContentService'
import { WordPreviewService, type WordPreviewConverter } from '../../src/main/workbench/office/WordPreviewService'
import { WordPreviewError } from '../../src/main/workbench/office/WordPreviewError'

const roots: string[] = []
const engine = { name: 'test-layout-port', version: '1' }
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const fixture = async (text = '中文原件') => (await applyOfficeContent(undefined, {
  format: 'docx', operation: 'create', blocks: [{ type: 'paragraph', text }],
})).bytes
async function root() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'guoling-word-preview-test-'))
  roots.push(directory)
  return directory
}
async function writePdf(outputDirectory: string) {
  const pdf = await PDFDocument.create()
  pdf.addPage([595, 842]); pdf.addPage([842, 595])
  await fs.writeFile(path.join(outputDirectory, 'document.pdf'), await pdf.save())
}
afterEach(async () => { await Promise.all(roots.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true }))) })

describe('Word preview snapshot boundary', () => {
  it('converts an isolated source snapshot into real PDF pages without writing the original or keeping temporary files', async () => {
    const directory = await root(), source = await fixture(), original = path.join(directory, 'original.docx')
    await fs.writeFile(original, source)
    const scratch = path.join(directory, 'preview'), inputHash = hash(source)
    const convert: WordPreviewConverter = async input => {
      expect(input.sourcePath).not.toBe(original)
      expect(input.sourcePath.startsWith(scratch + path.sep)).toBe(true)
      expect(hash(await fs.readFile(input.sourcePath))).toBe(inputHash)
      expect(await fs.readdir(input.outputDirectory)).toEqual([])
      expect(await fs.readdir(input.profileDirectory)).toEqual([])
      await writePdf(input.outputDirectory)
      return { engine }
    }
    const result = await new WordPreviewService(scratch, convert).render(source)
    expect(result).toMatchObject({ sourceSha256: inputHash, pageCount: 2, engine,
      pages: [{ width: 595, height: 842, rotation: 0 }, { width: 842, height: 595, rotation: 0 }] })
    expect((await PDFDocument.load(result.pdfBytes)).getPageCount()).toBe(2)
    expect(hash(source)).toBe(inputHash)
    expect(hash(await fs.readFile(original))).toBe(inputHash)
    expect(await fs.readdir(scratch)).toEqual([])
  })

  it('does not reuse a preceding preview when a newer source conversion fails or produces invalid output', async () => {
    const directory = await root(), inputs: string[] = [], sources: string[] = []
    const service = new WordPreviewService(directory, async input => {
      inputs.push(input.outputDirectory); sources.push(hash(await fs.readFile(input.sourcePath)))
      if (inputs.length === 1) await writePdf(input.outputDirectory)
      else await fs.writeFile(path.join(input.outputDirectory, 'document.pdf'), 'conversion failed')
      return { engine }
    })
    const first = await fixture('旧内容'), next = await fixture('更新后的内容')
    await expect(service.render(first)).resolves.toMatchObject({ sourceSha256: hash(first), pageCount: 2 })
    await expect(service.render(next)).rejects.toMatchObject({ code: 'conversion' })
    expect(inputs[0]).not.toBe(inputs[1]); expect(sources).toEqual([hash(first), hash(next)])
    expect(await fs.readdir(directory)).toEqual([])
  })

  it('rejects a converter that changes its input, retaining the caller snapshot', async () => {
    const directory = await root(), source = await fixture(), before = hash(source)
    const service = new WordPreviewService(directory, async input => {
      await fs.writeFile(input.sourcePath, 'unexpected rewrite')
      await writePdf(input.outputDirectory)
      return { engine }
    })
    await expect(service.render(source)).rejects.toMatchObject({ code: 'conversion' })
    expect(hash(source)).toBe(before)
    expect(await fs.readdir(directory)).toEqual([])
  })

  it('does not publish a late PDF after cancellation and clears the owned temporary directory', async () => {
    const directory = await root(), controller = new AbortController()
    const service = new WordPreviewService(directory, async input => {
      expect(input.signal).toBe(controller.signal)
      await writePdf(input.outputDirectory)
      controller.abort(new Error('preview closed'))
      return { engine }
    })
    await expect(service.render(await fixture(), { signal: controller.signal })).rejects.toThrow('preview closed')
    expect(await fs.readdir(directory)).toEqual([])
  })

  it('classifies corrupt input without exposing parser details', async () => {
    const directory = await root()
    const service = new WordPreviewService(directory, async () => { throw new Error('should not convert') })
    const failure = await service.render(Buffer.from('not a DOCX')).catch(error => error)
    expect(failure).toBeInstanceOf(WordPreviewError)
    expect(failure.code).toBe('invalid_document')
    expect(failure.message).not.toContain('not a DOCX')
  })
})
