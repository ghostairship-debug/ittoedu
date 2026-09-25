/** Real hidden Electron carrier. Build into output/g20-attachment-extraction; no shared dist mutation. */
import { app, BrowserWindow } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { createSandboxedAttachmentExtractor, type SandboxedAttachmentExtractionOptions } from '../../src/main/workbench/attachments/SandboxedAttachmentExtraction'
import { AttachmentService } from '../../src/main/workbench/attachments/AttachmentService'
import { MATERIAL_TEXT, diagramPng, r19LessonMaterials } from '../fixtures/r19LessonMaterials'

function twoPagePdf() {
  const streams = ['BT /F1 16 Tf 20 170 Td (Readable first page) Tj ET\n', '0 0 1 rg 20 20 80 80 re f\n']
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    ...[5, 6].map(contents => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Resources << /Font << /F1 7 0 R >> >> /Contents ${contents} 0 R >>`),
    ...streams.map(stream => `<< /Length ${stream.length} >>\nstream\n${stream}endstream`), '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
  let source = '%PDF-1.4\n'; const offsets: number[] = []
  for (const [index, object] of objects.entries()) { offsets.push(source.length); source += `${index + 1} 0 obj\n${object}\nendobj\n` }
  const xref = source.length
  source += `xref\n0 8\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(source)
}

app.disableHardwareAcceleration()
app.on('window-all-closed', () => { /* Each isolated job is expected to close its only window. */ })
void app.whenReady().then(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-real-extraction-'))
  const carrier = path.resolve(process.argv[2])
  const rendererURL = process.argv[3]
  const options: SandboxedAttachmentExtractionOptions = { preloadPath: path.join(carrier, 'preload.cjs'), ...(rendererURL ? { rendererURL } : { rendererFile: path.join(carrier, 'renderer', 'attachment-extraction.html') }) }
  const extractor = createSandboxedAttachmentExtractor(options)
  const service = new AttachmentService({ directory, extractor })
  try {
    const original = await service.receiveBytes({ name: 'two.pdf', bytes: twoPagePdf(), source: { kind: 'paste' } })
    const second = await service.extract(original.id, { pages: { from: 2, to: 2 } })
    assert.deepEqual(second.coverage, { format: 'pdf', complete: false, totalPages: 2, selectedPages: { from: 2, to: 2 } })
    assert.equal(second.representations.some(item => item.kind === 'text'), false)
    const image = second.representations.find(item => item.kind === 'image')!
    assert.ok(image && image.kind === 'image'); assert.equal(image.width, 800); assert.equal(image.height, 400)
    assert.deepEqual(image.provenance.range, { unit: 'pages', from: 2, to: 2, total: 2 })
    assert.ok(second.gaps.some(gap => gap.code === 'scanned-page' && gap.resolutionRepresentationId === image.id))
    const pixels = (await service.readRepresentation(second.id, image.id)).bytes
    const sample = await sharp(pixels).extract({ left: 80, top: 240, width: 1, height: 1 }).removeAlpha().raw().toBuffer()
    assert.deepEqual([...sample], [0, 0, 255])
    const full = await service.extract(original.id)
    const text = full.representations.find(item => item.kind === 'text')!
    assert.match(Buffer.from((await service.readRepresentation(full.id, text.id)).bytes).toString(), /Readable first page/)
    assert.equal((await service.readSnapshot(original.id)).representations[0].kind, 'file')
    console.log('PASS 1: real PDF.js worker, selected scanned page pixels, full-page text, immutable source')
    for (const fixture of r19LessonMaterials().filter(item => item.format !== 'pdf')) {
      const source = await service.receiveBytes({ name: fixture.name, bytes: fixture.bytes, source: { kind: 'drop' } })
      const derived = await service.extract(source.id)
      assert.equal(derived.coverage?.complete, true)
      const text = derived.representations.find(item => item.kind === 'text')!, image = derived.representations.find(item => item.kind === 'image')!
      assert.equal(Buffer.from((await service.readRepresentation(derived.id, text.id)).bytes).toString(), MATERIAL_TEXT)
      assert.deepEqual(Buffer.from((await service.readRepresentation(derived.id, image.id)).bytes), Buffer.from(diagramPng()))
    }
    console.log('PASS 2: real sandbox DOCX/PPTX text and original embedded image pixels')
    const controller = new AbortController()
    const cancelled = extractor.extract({ bytes: twoPagePdf(), filename: 'cancel.pdf' }, { signal: controller.signal })
    controller.abort(new Error('explicit cancellation'))
    await assert.rejects(cancelled, /explicit cancellation/)
    assert.equal(BrowserWindow.getAllWindows().length, 0)
    await assert.rejects(createSandboxedAttachmentExtractor({ ...options, timeoutMs: 1 }).extract({ bytes: twoPagePdf(), filename: 'timeout.pdf' }), /超时/)
    assert.equal(BrowserWindow.getAllWindows().length, 0)
    console.log('PASS 3: cancellation and timeout destroy real sandbox windows')
    await fs.writeFile(path.join(carrier, rendererURL ? 'dev-result.json' : 'build-result.json'), JSON.stringify({ passed: 3, failed: 0, entry: rendererURL ?? options.rendererFile, at: new Date().toISOString() }, null, 2))
  } finally {
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Invalid temporary root')
    await fs.rm(directory, { recursive: true, force: true })
  }
}).then(() => app.exit(0), error => { console.error(error); app.exit(1) })
