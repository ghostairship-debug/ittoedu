// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestLessonDocumentFiles as createLessonDocumentFiles } from '../helpers/markdownDocumentHost'
import type { DocumentFileRef } from '../../src/shared/document/ports'
import { lessonDocumentRequestSchema } from '../../src/shared/lessonDocumentDesktop'

describe('lessonDocumentFiles real disk', () => {
  let directory: string, lessonDirectory: string, ref: DocumentFileRef, files: ReturnType<typeof createLessonDocumentFiles>
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lesson-doc-'))
    lessonDirectory = path.join(directory, 'lesson')
    ref = { kind: 'lesson', lessonId: 'lesson-a', lessonDirectory, relativePath: 'plan.md' }
    await fs.mkdir(lessonDirectory)
    files = createLessonDocumentFiles({ recoveryDirectory: path.join(directory, 'recovery'), validateTarget: async target => { if (target.kind !== 'lesson' || target.lessonId !== 'lesson-a') throw new Error('wrong lesson') } })
  })
  afterEach(async () => {
    const resolved = path.resolve(directory)
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('lesson-doc-')) throw new Error('Unexpected test directory')
    await fs.rm(resolved, { recursive: true, force: true })
  })
  const save = (source: string, expectedVersion: Awaited<ReturnType<typeof files.openDocument>>['version'] | null = null, operationId = source) => files.saveDocument({ ref, source, expectedVersion, operationId, attachments: [] })
  it('does not treat merely viewing and preserving unchanged invalid Markdown as pending recovery', async () => {
    const source = '- 首项\n  - 嵌套项\n'
    await save(source)
    const disk = await files.openDocument(ref)
    await files.preserveDraft(ref, source, disk.version)
    expect(await files.readRecovery(ref)).toBeNull()
    const saved = await files.saveDocument({ ref, expectedVersion: disk.version, source: '- 平铺项\n', operationId: 'next-stage', attachments: [] })
    expect(saved.status).toBe('saved')
  })
  it('protects real unsaved content against an obsolete save version even when disk still matches', async () => {
    await save('磁盘稿')
    const disk = await files.openDocument(ref)
    await files.preserveDraft(ref, '教师未保存稿', disk.version)
    const result = await files.saveDocument({ ref, expectedVersion: disk.version, source: '模型第二稿', operationId: 'blocked-stage', attachments: [] })
    expect(result.status).toBe('conflict')
    expect((await files.openDocument(ref)).source).toBe('教师未保存稿')
    expect(await fs.readFile(path.join(lessonDirectory, 'plan.md'), 'utf8')).toBe('磁盘稿')
    expect((await files.readRecovery(ref))?.source).toBe('教师未保存稿')
  })
  it('saves manually authored invalid Markdown without an obsolete authoring-stage gate', async () => {
    await save('原稿')
    const invalidSource = '```cw-object-v1\n{not-json}\n```\n'
    const ordinary = await files.saveDocument({ ref, source: invalidSource, expectedVersion: (await files.openDocument(ref)).version, operationId: 'ordinary-invalid', attachments: [] })
    expect(ordinary.status).toBe('saved')
    expect((await files.openDocument(ref)).source).toBe(invalidSource)
  })
  it('rejects every retired candidate operation at the public schema boundary', () => {
    const target = { kind: 'file', path: path.join(lessonDirectory, 'plan.md') }
    for (const operation of ['read-ai-records', 'clear-ai-records', 'invalidate', 'prepare', 'apply', 'revert']) {
      expect(lessonDocumentRequestSchema.safeParse({ operation, ref: target }).success, operation).toBe(false)
    }
    expect(lessonDocumentRequestSchema.safeParse({ operation: 'open', ref: target }).success).toBe(true)
    for (const method of ['prepareAiEdit', 'applyAiEdit', 'revertAiEdit', 'readAiRecords', 'clearAiRecords', 'invalidateAiEdits', 'saveDocumentIfNoRecovery']) {
      expect(files, method).not.toHaveProperty(method)
    }
  })
  it('compares pending attachment bytes rather than treating every attachment entry as unsaved', async () => {
    await files.saveDocument({ ref, source: '![图](image.png)', expectedVersion: null, operationId: 'asset-base', attachments: [{ relativePath: 'image.png', bytes: new Uint8Array([1, 2]) }] })
    const disk = await files.openDocument(ref)
    await files.preserveDraft(ref, disk.source, disk.version, [{ relativePath: 'image.png', bytes: new Uint8Array([1, 2]) }])
    expect(await files.readRecovery(ref)).toBeNull()
    await expect(files.preserveDraft(ref, disk.source, disk.version, [{ relativePath: 'image.png', bytes: new Uint8Array([1, 3]) }])).rejects.toThrow('附件路径')
    await files.preserveDraft(ref, '![图](new-image.png)', disk.version, [{ relativePath: 'new-image.png', bytes: new Uint8Array([1, 3]) }])
    expect((await files.readRecovery(ref))?.attachments).toHaveLength(2)
  })
  it('serializes simultaneous CAS and restores only the committed result after restart', async () => {
    expect((await save('原稿')).status).toBe('saved')
    const disk = await files.openDocument(ref)
    const results = await Promise.all([save('甲', disk.version), save('乙', disk.version)])
    expect(results.map(result => result.status)).toEqual(['saved', 'conflict'])
    expect((await files.openDocument(ref)).source).toBe('甲')
    const restarted = createLessonDocumentFiles({ recoveryDirectory: path.join(directory, 'recovery'), validateTarget: async () => {} })
    expect(await restarted.readRecovery(ref)).toBeNull()
    expect((await restarted.openDocument(ref)).source).toBe('甲')
  })
  it('prepares attachments before markdown and detects attachment-only changes', async () => {
    const result = await files.saveDocument({ ref, source: '![图](assets/a.png)', expectedVersion: null, operationId: 'image', attachments: [{ relativePath: 'assets/a.png', bytes: new Uint8Array([1, 2]) }] })
    expect(result.status).toBe('saved')
    const disk = await files.openDocument(ref)
    expect(disk.version.attachments).toHaveLength(1)
    await fs.writeFile(path.join(lessonDirectory, 'assets/a.png'), new Uint8Array([3]))
    expect((await save('新稿', disk.version)).status).toBe('conflict')
  })
  it('preserves recoverable source on write failure and confines document paths', async () => {
    const result = await files.saveDocument({ ref: { kind: 'lesson', lessonId: 'lesson-a', lessonDirectory, relativePath: '../outside.md' }, source: '草稿', expectedVersion: null, operationId: 'bad', attachments: [] })
    expect(result).toMatchObject({ status: 'failed', recovery: 'failed' })
    await expect(fs.access(path.join(directory, 'outside.md'))).rejects.toThrow()
  })
  it('queries the original canonical receipt after restart without replaying already written content', async () => {
    await save('原稿')
    const version = (await files.openDocument(ref)).version
    await save('恢复稿', version, 'interrupted')
    const document = (await files.documents.list())[0]!
    const restarted = createLessonDocumentFiles({ recoveryDirectory: path.join(directory, 'recovery'), validateTarget: async () => {} })
    await restarted.documents.restore(document.documentId)
    expect(await restarted.documents.lookup(document.documentId, 'interrupted')).toMatchObject({ status: 'applied', revision: document.revision })
    expect(await files.readRecovery(ref)).toBeNull()
    expect((await restarted.openDocument(ref)).source).toBe('恢复稿')
    expect((await restarted.documents.read(document.documentId)).undoDepth).toBe(document.undoDepth)
  })
  it('retains ordinary Markdown dangling links without inventing attachment bytes', async () => {
    await save('原稿')
    const disk = await files.openDocument(ref)
    expect((await save('![missing](assets/missing.png)', disk.version)).status).toBe('saved')
    expect((await files.openDocument(ref)).source).toBe('![missing](assets/missing.png)')
    await expect(fs.access(path.join(lessonDirectory, 'assets/missing.png'))).rejects.toThrow()
  })
  it('retains pending attachment bytes with recovery and reads resources only inside the lesson', async () => {
    await save('原稿')
    const version = (await files.openDocument(ref)).version
    const attachments = [{ relativePath: 'assets/a.png', bytes: new Uint8Array([1, 2, 3]) }]
    await files.preserveDraft(ref, '![图](assets/a.png)', version, attachments)
    await expect(fs.access(path.join(lessonDirectory, 'assets/a.png'))).rejects.toThrow()
    const recovered = await files.readRecovery(ref)
    expect(recovered?.source).toBe('![图](assets/a.png)')
    expect(await fs.readFile(path.join(lessonDirectory, 'plan.md'), 'utf8')).toBe('原稿')
    expect(recovered?.attachments).toEqual(attachments)
    await files.saveDocument({ ref, source: recovered!.source, expectedVersion: recovered!.expectedVersion, operationId: 'resource', attachments: recovered!.attachments! })
    expect(await files.readResource(ref, 'assets/a.png')).toEqual({ bytes: attachments[0]!.bytes, mime: 'image/png', filename: 'a.png' })
    await expect(files.readResource(ref, '../outside.png')).rejects.toThrow()
  })
})
