import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createLessonDocumentFiles } from '../../src/main/lessonDocumentFiles'
import { fileClipboardResourcePort, readFileClipboardContext, selectedFileClipboardContext } from '../../src/renderer/documentFiles/fileDocumentClipboard'
import { prepareDocumentClipboard } from '../../src/renderer/document/documentClipboard'
import { parseDocumentMarkdown, serializeDocumentMarkdown } from '../../src/shared/document/markdown'

describe('file clipboard resource transaction', () => {
  it('copies only referenced image bytes, saves markdown and attachment, and reopens the real file', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'file-clipboard-'))
    try {
      const lesson = path.join(directory, 'lesson'); await fs.mkdir(path.join(lesson, 'assets'), { recursive: true })
      const image = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+nkXcAAAAASUVORK5CYII=', 'base64'))
      await fs.writeFile(path.join(lesson, 'assets/original.png'), image)
      const ref = { lessonId: 'a', lessonDirectory: lesson, relativePath: 'copy.md' }
      const files = createLessonDocumentFiles({ recoveryDirectory: path.join(directory, 'recovery'), validateTarget: async () => {} })
      const resources = { assets: [{ assetId: 'original', source: { kind: 'relative' as const, path: 'assets/original.png' } }], components: [] }
      const context = await readFileClipboardContext(resources, relativePath => files.readResource(ref, relativePath))
      const subset = selectedFileClipboardContext(context, resources)
      const prepared = await prepareDocumentClipboard({ content: { blocks: [{ id: 'photo', type: 'media', assetId: 'original', mediaKind: 'image', altText: '实验图', caption: { inlines: [] }, layout: 'wide', wrap: 'none' }] }, resources }, { assets: [], components: [] }, fileClipboardResourcePort(JSON.parse(JSON.stringify(subset))))
      const source = serializeDocumentMarkdown(prepared.document, 'file')
      await expect(fs.access(path.join(lesson, prepared.prepared.attachments[0]!.relativePath))).rejects.toThrow()
      const result = await files.saveDocument({ ref, source, expectedVersion: null, operationId: 'clipboard', attachments: prepared.prepared.attachments })
      expect(result.status).toBe('saved')
      const reopened = await files.openDocument(ref)
      expect(reopened.version.attachments).toHaveLength(1)
      expect((await files.readResource(ref, reopened.version.attachments[0]!.relativePath)).bytes).toEqual(image)
      expect(parseDocumentMarkdown(reopened.source, { target: 'file', createId: () => crypto.randomUUID() }).status).toBe('valid')
    } finally { await fs.rm(directory, { recursive: true, force: true }) }
  })
})
