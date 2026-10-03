// @vitest-environment node
import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, degrees } from 'pdf-lib'
import { MediaFilesService, type MediaFileOwner } from '../../src/main/workbench/mediaFiles/MediaFilesService'
import { pdfPagePoint } from '../../src/main/workbench/mediaFiles/pdfFileEditing'
import { MediaFileDraft } from '../../src/renderer/documentFiles/media/mediaFileDraft'
import type { FileArtifactBinding, MediaFileSnapshot } from '../../src/shared/workbench/mediaFiles'

function fileOwner(initial: Uint8Array) {
  let bytes = initial
  let version = 1
  const reads: FileArtifactBinding[] = []
  const writes: Uint8Array[] = []
  const binding = (): FileArtifactBinding => ({ path: 'fixture', fileVersion: String(version), bindingVersion: 1 })
  const owner: MediaFileOwner = {
    async read(target) {
      if (target.fileVersion !== String(version)) throw new Error('原文件已改变')
      reads.push(target)
      return bytes.slice()
    },
    async replace(target, candidate) {
      if (target.fileVersion !== String(version)) throw new Error('原文件已改变')
      bytes = candidate.slice(); version++; writes.push(bytes)
      return binding()
    },
  }
  return { owner, binding, reads, writes, bytes: () => bytes }
}

describe('media file edits in original formats', () => {
  it('applies crop, rotation and a visible ink stroke, then reopens the saved PNG bytes', async () => {
    const initial = await sharp({ create: { width: 80, height: 40, channels: 4, background: '#ffffff' } }).png().toBuffer()
    const file = fileOwner(initial)
    const service = new MediaFilesService(file.owner)
    const result = await service.save(file.binding(), [
      { type: 'image.crop', rectangle: { x: 0.25, y: 0, width: 0.5, height: 1 } },
      { type: 'image.rotate', degrees: 90 },
      { type: 'image.ink', points: [{ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }], color: '#ff0000', strokeWidth: 0.05 },
    ])
    expect(result.content).toMatchObject({ kind: 'image', mimeType: 'image/png', width: 40, height: 40, editable: true })
    expect(result.binding.fileVersion).toBe('2')
    expect(file.writes).toHaveLength(1)
    expect(file.reads.map(read => read.fileVersion)).toEqual(['1', '2'])
    const { data, info } = await sharp(file.bytes()).raw().toBuffer({ resolveWithObject: true })
    const middle = (20 * info.width + 20) * info.channels
    expect(data[middle]).toBeGreaterThan(240)
    expect(data[middle + 1]).toBeLessThan(30)
    expect(data[middle + 2]).toBeLessThan(30)
    expect(data[0]).toBe(255)
    expect(data[1]).toBe(255)
  })

  it('keeps JPEG as JPEG and auto-orients camera metadata before applying visible coordinates', async () => {
    const initial = await sharp({ create: { width: 80, height: 40, channels: 3, background: '#ffffff' } })
      .withMetadata({ orientation: 6 }).jpeg().toBuffer()
    const file = fileOwner(initial)
    const service = new MediaFilesService(file.owner)
    const opened = await service.open(file.binding())
    expect(opened.content).toMatchObject({ width: 40, height: 80, mimeType: 'image/jpeg' })
    const result = await service.save(file.binding(), [{ type: 'image.crop', rectangle: { x: 0, y: 0, width: 1, height: 0.5 } }])
    expect(result.content).toMatchObject({ width: 40, height: 40, mimeType: 'image/jpeg' })
    const metadata = await sharp(file.bytes()).metadata()
    expect(metadata.width).toBe(40); expect(metadata.height).toBe(40)
    expect(metadata.orientation ?? 1).toBe(1)
  })

  it('retains PDF page content while moving, rotating and annotating cropped pages', async () => {
    const document = await PDFDocument.create()
    document.addPage([200, 100]).drawText('First original page')
    const second = document.addPage([300, 200]); second.setCropBox(20, 30, 240, 140); second.drawText('Second original page')
    const file = fileOwner(await document.save())
    const service = new MediaFilesService(file.owner)
    const result = await service.save(file.binding(), [
      { type: 'pdf.move-page', from: 1, to: 0 },
      { type: 'pdf.rotate-page', page: 0, degrees: 90 },
      { type: 'pdf.highlight', page: 0, rectangle: { x: 0.1, y: 0.2, width: 0.5, height: 0.1 }, color: '#ffff00' },
      { type: 'pdf.ink', page: 0, points: [{ x: 0.1, y: 0.2 }, { x: 0.6, y: 0.3 }], color: '#ff0000', strokeWidth: 0.01 },
    ])
    expect(result.content).toMatchObject({ kind: 'pdf', pages: [{ width: 140, height: 240, rotation: 90 }, { width: 200, height: 100, rotation: 0 }] })
    const reopened = await PDFDocument.load(file.bytes())
    expect(reopened.getPageCount()).toBe(2)
    const page = reopened.getPage(0)
    expect(page.getCropBox()).toEqual({ x: 20, y: 30, width: 240, height: 140 })
    expect(page.node.Contents()).toBeTruthy()
    const annots = page.node.Annots()!
    expect(annots.size()).toBe(2)
    const highlight = reopened.context.lookup(annots.get(0), PDFDict)
    expect(highlight.lookup(PDFName.of('Subtype'), PDFName).asString()).toBe('/Highlight')
    const quad = highlight.lookup(PDFName.of('QuadPoints'), PDFArray)
    const expectedQuad = [68, 44, 68, 114, 92, 44, 92, 114]
    quad.asArray().forEach((value, index) => expect((value as PDFNumber).asNumber()).toBeCloseTo(expectedQuad[index]))
    expect(reopened.context.lookup(annots.get(1), PDFDict).lookup(PDFName.of('Subtype'), PDFName).asString()).toBe('/Ink')
    expect(file.reads.map(read => read.fileVersion)).toEqual(['1', '2'])
  })

  it('converts screen coordinates correctly for all PDF quarter turns and refuses deletion of the last page', async () => {
    const document = await PDFDocument.create()
    const page = document.addPage([300, 200]); page.setCropBox(20, 30, 240, 140)
    const point = { x: 0.25, y: 0.5 }
    const expected = [[80, 100], [140, 65], [200, 100], [140, 135]]
    for (const [index, angle] of [0, 90, 180, 270].entries()) {
      page.setRotation(degrees(angle)); expect(pdfPagePoint(page, point)).toEqual(expected[index])
    }
    const file = fileOwner(await document.save())
    await expect(new MediaFilesService(file.owner).save(file.binding(), [{ type: 'pdf.delete-page', page: 0 }])).rejects.toThrow('至少需要保留一页')
    expect(file.writes).toHaveLength(0)
  })
})

describe('media file draft ownership', () => {
  it('retains an unsaved draft on a file-version conflict and obtains a new binding on explicit reload', async () => {
    const bytes = await sharp({ create: { width: 20, height: 10, channels: 3, background: '#ffffff' } }).png().toBuffer()
    const file = fileOwner(bytes), service = new MediaFilesService(file.owner)
    const snapshot = await service.open(file.binding())
    const draft = new MediaFileDraft(snapshot, {
      preview: (binding, operations) => service.preview(binding, operations),
      save: (binding, operations) => service.save(binding, operations),
      reload: () => service.open(file.binding()),
    })
    await draft.apply({ type: 'image.rotate', degrees: 90 })
    expect(draft.read().preview.content).toMatchObject({ width: 10, height: 20 })
    await file.owner.replace(snapshot.binding, bytes)
    expect(await draft.save()).toBeNull()
    expect(draft.read().operations).toHaveLength(1)
    expect(draft.read().error).toBe('原文件已改变')
    await draft.reload()
    expect(draft.read().operations).toHaveLength(0)
    expect(draft.read().base.binding.fileVersion).toBe('2')
    draft.dispose()
  })

  it('undoes a pending preview without letting its late response overwrite the draft', async () => {
    const bytes = await sharp({ create: { width: 20, height: 10, channels: 3, background: '#ffffff' } }).png().toBuffer()
    const file = fileOwner(bytes), service = new MediaFilesService(file.owner)
    const snapshot = await service.open(file.binding())
    let complete!: (value: MediaFileSnapshot) => void
    const draft = new MediaFileDraft(snapshot, {
      preview: () => new Promise(resolve => { complete = resolve }),
      save: (binding, operations) => service.save(binding, operations), reload: () => service.open(file.binding()),
    })
    const pending = draft.apply({ type: 'image.rotate', degrees: 90 })
    await draft.undo()
    complete(await service.preview(snapshot.binding, [{ type: 'image.rotate', degrees: 90 }]))
    await pending
    expect(draft.read().operations).toHaveLength(0)
    expect(draft.read().preview).toBe(snapshot)
    expect(draft.read().previewReady).toBe(true)
    draft.dispose()
  })
})
