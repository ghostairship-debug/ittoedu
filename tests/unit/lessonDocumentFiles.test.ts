import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createLessonDocumentFiles } from '../../src/main/lessonDocumentFiles'
import type { DocumentFileRef } from '../../src/shared/document/ports'

describe('lessonDocumentFiles real disk', () => {
  let directory: string, ref: DocumentFileRef, files: ReturnType<typeof createLessonDocumentFiles>
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lesson-doc-'))
    ref = { lessonId: 'lesson-a', lessonDirectory: path.join(directory, 'lesson'), relativePath: 'plan.md' }
    await fs.mkdir(ref.lessonDirectory)
    files = createLessonDocumentFiles({ recoveryDirectory: path.join(directory, 'recovery'), validateTarget: async target => { if (target.lessonId !== 'lesson-a') throw new Error('wrong lesson') } })
  })
  afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }) })
  const save = (source: string, expectedVersion: Awaited<ReturnType<typeof files.openDocument>>['version'] | null = null, operationId = source) => files.saveDocument({ ref, source, expectedVersion, operationId, attachments: [] })
  it('does not treat merely viewing and preserving unchanged invalid Markdown as pending recovery', async () => {
    const source = '- 首项\n  - 嵌套项\n'
    await save(source)
    const disk = await files.openDocument(ref)
    await files.preserveDraft(ref, source, disk.version)
    expect(await files.readRecovery(ref)).toBeNull()
    const saved = await files.saveDocumentIfNoRecovery({ ref, expectedVersion: disk.version, source: '- 平铺项\n', operationId: 'next-stage', attachments: [] })
    expect(saved.status).toBe('saved')
  })
  it('protects real unsaved content against a stage candidate even when disk CAS still matches', async () => {
    await save('磁盘稿')
    const disk = await files.openDocument(ref)
    await files.preserveDraft(ref, '教师未保存稿', disk.version)
    const result = await files.saveDocumentIfNoRecovery({ ref, expectedVersion: disk.version, source: '模型第二稿', operationId: 'blocked-stage', attachments: [] })
    expect(result.status).toBe('failed')
    expect((await files.openDocument(ref)).source).toBe('磁盘稿')
    expect((await files.readRecovery(ref))?.source).toBe('教师未保存稿')
  })
  it('compares pending attachment bytes rather than treating every attachment entry as unsaved', async () => {
    await files.saveDocument({ ref, source: '![图](image.png)', expectedVersion: null, operationId: 'asset-base', attachments: [{ relativePath: 'image.png', bytes: new Uint8Array([1, 2]) }] })
    const disk = await files.openDocument(ref)
    await files.preserveDraft(ref, disk.source, disk.version, [{ relativePath: 'image.png', bytes: new Uint8Array([1, 2]) }])
    expect(await files.readRecovery(ref)).toBeNull()
    await files.preserveDraft(ref, disk.source, disk.version, [{ relativePath: 'image.png', bytes: new Uint8Array([1, 3]) }])
    expect((await files.readRecovery(ref))?.attachments).toHaveLength(1)
  })
  it('serializes simultaneous CAS and preserves rejected draft across restart', async () => {
    expect((await save('原稿')).status).toBe('saved')
    const disk = await files.openDocument(ref)
    const results = await Promise.all([save('甲', disk.version), save('乙', disk.version)])
    expect(results.map(result => result.status)).toEqual(['saved', 'conflict'])
    expect((await files.openDocument(ref)).source).toBe('甲')
    const restarted = createLessonDocumentFiles({ recoveryDirectory: path.join(directory, 'recovery'), validateTarget: async () => {} })
    expect((await restarted.readRecovery(ref))?.source).toBe('乙')
  })
  it('prepares attachments before markdown and detects attachment-only changes', async () => {
    const result = await files.saveDocument({ ref, source: '![图](assets/a.png)', expectedVersion: null, operationId: 'image', attachments: [{ relativePath: 'assets/a.png', bytes: new Uint8Array([1, 2]) }] })
    expect(result.status).toBe('saved')
    const disk = await files.openDocument(ref)
    expect(disk.version.attachments).toHaveLength(1)
    await fs.writeFile(path.join(ref.lessonDirectory, 'assets/a.png'), new Uint8Array([3]))
    expect((await save('新稿', disk.version)).status).toBe('conflict')
  })
  it('preserves recoverable source on write failure and confines document paths', async () => {
    const result = await files.saveDocument({ ref: { ...ref, relativePath: '../outside.md' }, source: '草稿', expectedVersion: null, operationId: 'bad', attachments: [] })
    expect(result).toMatchObject({ status: 'failed', recovery: 'saved' })
    await expect(fs.access(path.join(directory, 'outside.md'))).rejects.toThrow()
  })
  it('recovers an interrupted journal without replaying already written content', async () => {
    await save('原稿')
    const version = (await files.openDocument(ref)).version
    await save('恢复稿', version, 'interrupted')
    const [bucket] = await fs.readdir(path.join(directory, 'recovery'))
    const journalDirectory = path.join(directory, 'recovery', bucket!)
    for (const name of await fs.readdir(journalDirectory)) {
      const filename = path.join(journalDirectory, name)
      const record = JSON.parse(await fs.readFile(filename, 'utf8'))
      if (record.request?.operationId === 'interrupted') {
        delete record.result; record.phase = 'prepared'
        await fs.writeFile(filename, JSON.stringify(record))
      }
    }
    expect(await files.readRecovery(ref)).toBeNull()
    expect((await save('恢复稿', version, 'interrupted')).status).toBe('saved')
    expect((await files.openDocument(ref)).source).toBe('恢复稿')
  })
  it('refuses missing attachments before replacing the markdown', async () => {
    await save('原稿')
    const disk = await files.openDocument(ref)
    expect((await save('![missing](assets/missing.png)', disk.version)).status).toBe('failed')
    expect((await files.openDocument(ref)).source).toBe('原稿')
  })
  it('does not repeat a committed operation and selectively reverts persisted AI changes', async () => {
    const base = `原稿甲\n${'独立段落'.repeat(20)}\n原稿乙`
    await save(base)
    const disk = await files.openDocument(ref)
    const edits = [{ from: 0, to: 3, before: '原稿甲', after: 'AI甲' }, { from: base.length - 3, to: base.length, before: '原稿乙', after: 'AI乙' }]
    await files.prepareAiEdit(ref, edits, 1)
    const result = await files.applyAiEdit({ ref, baseVersion: disk.version, epoch: 1, operationId: 'ai', edits })
    expect(result.status).toBe('applied')
    if (result.status !== 'applied' && result.status !== 'partial') throw new Error('missing record')
    const ai = await files.openDocument(ref)
    await save(ai.source.replace('AI乙', '教师乙'), ai.version, 'teacher')
    expect((await files.applyAiEdit({ ref, baseVersion: disk.version, epoch: 1, operationId: 'ai', edits })).status).toBe('applied')
    expect((await files.openDocument(ref)).source).toContain('教师乙')
    const current = await files.openDocument(ref)
    const reverted = await files.revertAiEdit(result.record, current.version)
    expect(reverted.reverted).toHaveLength(1)
    expect(reverted.unreverted).toHaveLength(1)
    expect((await files.openDocument(ref)).source).toBe(base.replace('原稿乙', '教师乙'))
  })
  it('reconciles AI written-content journal after a crash before final change record', async () => {
    await save('原稿')
    const disk = await files.openDocument(ref)
    const edits = [{ from: 0, to: 2, before: '原稿', after: 'AI稿' }]
    await files.prepareAiEdit(ref, edits, 1)
    const result = await files.applyAiEdit({ ref, baseVersion: disk.version, epoch: 1, operationId: 'crash-ai', edits })
    if (result.status !== 'applied' && result.status !== 'partial') throw new Error('missing record')
    const [bucket] = await fs.readdir(path.join(directory, 'recovery'))
    const journalDirectory = path.join(directory, 'recovery', bucket!)
    const aiFile = (await fs.readdir(journalDirectory)).find(name => name.startsWith('ai-'))!
    await fs.writeFile(path.join(journalDirectory, aiFile), JSON.stringify({ source: 'AI稿', conflicts: [], intent: { baseVersion: disk.version, applied: result.record.applied } }))
    const restarted = createLessonDocumentFiles({ recoveryDirectory: path.join(directory, 'recovery'), validateTarget: async () => {} })
    const recovered = await restarted.recoverAiEditRecord(ref, 'crash-ai')
    expect(recovered.status).toBe('applied')
    expect((await restarted.openDocument(ref)).source).toBe('AI稿')
  })
  it('invalidates prepared AI on Stop and refuses revival with the old epoch', async () => {
    await save('原稿')
    const disk = await files.openDocument(ref), edits = [{ from: 0, to: 2, before: '原稿', after: '旧候选' }]
    expect((await files.prepareAiEdit(ref, edits, 7)).status).toBe('ready')
    await files.invalidateAiEdits(ref)
    expect((await files.applyAiEdit({ ref, baseVersion: disk.version, epoch: 7, operationId: 'stopped', edits })).status).toBe('failed')
    expect((await files.prepareAiEdit(ref, edits, 7)).status).toBe('failed')
    expect((await files.prepareAiEdit(ref, edits, 8)).status).toBe('ready')
    expect((await files.openDocument(ref)).source).toBe('原稿')
  })
  it('retains pending attachment bytes with recovery and reads resources only inside the lesson', async () => {
    await save('原稿')
    const version = (await files.openDocument(ref)).version
    const attachments = [{ relativePath: 'assets/a.png', bytes: new Uint8Array([1, 2, 3]) }]
    await files.preserveDraft(ref, '![图](assets/a.png)', version, attachments)
    await expect(fs.access(path.join(ref.lessonDirectory, 'assets/a.png'))).rejects.toThrow()
    const recovered = await files.readRecovery(ref)
    expect(recovered?.baseSource).toBe('原稿')
    expect(recovered?.attachments).toEqual(attachments)
    await files.saveDocument({ ref, source: recovered!.source, expectedVersion: version, operationId: 'resource', attachments: recovered!.attachments! })
    expect(await files.readResource(ref, 'assets/a.png')).toEqual({ bytes: attachments[0]!.bytes, mime: 'image/png', filename: 'a.png' })
    await expect(files.readResource(ref, '../outside.png')).rejects.toThrow()
  })
  it('does not revive a preparation that was still awaiting identity validation when stopped', async () => {
    await save('原稿')
    let release!: () => void, entered!: () => void, hold = true
    const barrier = new Promise<void>(resolve => { release = resolve }), started = new Promise<void>(resolve => { entered = resolve })
    const delayed = createLessonDocumentFiles({ recoveryDirectory: path.join(directory, 'recovery'), validateTarget: async () => { if (hold) { hold = false; entered(); await barrier } } })
    const ranges = [{ from: 0, to: 2, before: '原稿', after: '旧稿' }]
    const preparation = delayed.prepareAiEdit(ref, ranges, 9)
    await started; await delayed.invalidateAiEdits(ref); release()
    expect((await preparation).status).toBe('failed')
    expect((await delayed.prepareAiEdit(ref, ranges, 9)).status).toBe('failed')
  })
})
