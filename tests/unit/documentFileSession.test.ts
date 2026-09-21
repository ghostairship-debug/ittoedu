import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentFileSession, mergeDocumentSources, type RecoverableDocumentFilePort } from '../../src/renderer/documentFiles/documentFileSession'
import type { OpenDocumentResult } from '../../src/shared/document/ports'
import { createLessonDocumentFiles } from '../../src/main/lessonDocumentFiles'

const ref = { kind: 'lesson' as const, lessonId: 'lesson', lessonDirectory: '/lesson', relativePath: 'plan.md' }
const roots: string[] = []
function fixture(initialSource = '原稿') {
  let disk: OpenDocumentResult = { ref, source: initialSource, version: { contentVersion: '1', attachments: [] }, diagnostics: [] }
  let notify: Parameters<RecoverableDocumentFilePort['watchDocument']>[1] = () => {}
  const port: RecoverableDocumentFilePort = {
    openDocument: async () => disk,
    watchDocument: (_ref, listener) => { notify = listener; return () => {} },
    saveDocument: vi.fn(async request => { disk = { ...disk, source: request.source, version: { contentVersion: request.source, attachments: [] } }; return { status: 'saved' as const, operationId: request.operationId, version: disk.version } }),
    prepareAiEdit: vi.fn(), applyAiEdit: vi.fn(), revertAiEdit: vi.fn(), preserveDraft: vi.fn(async () => {}), readRecovery: async () => null, invalidateAiEdits: vi.fn(async () => {}),
  }
  return { port, session: new DocumentFileSession(ref, port), external(source: string) { disk = { ...disk, source, version: { contentVersion: source, attachments: [] } }; notify({ type: 'changed', disk }) } }
}
async function ownerFixture(source = 'old\n\nnotes') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'document-session-')); roots.push(root)
  const filename = path.join(root, 'notes.md')
  await fs.writeFile(filename, source)
  const fileRef = { kind: 'file' as const, path: filename }
  const files = createLessonDocumentFiles({ recoveryDirectory: path.join(root, 'recovery'), validateTarget: async () => {} })
  const session = new DocumentFileSession(fileRef, files); await session.open()
  return { filename, fileRef, files, session }
}
afterEach(async () => {
  vi.useRealTimers()
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe temporary path')
    await fs.rm(root, { recursive: true, force: true })
  }
})
describe('documentFileSession', () => {
  it('closing an untouched viewed source does not create a recovery draft', async () => {
    const { session, port } = fixture(); await session.open()
    expect(await session.preserveAndClose()).toBe(true)
    expect(port.preserveDraft).not.toHaveBeenCalled()
  })
  it('waits for IME completion and saves after 800ms idle', async () => {
    vi.useFakeTimers()
    const { session, port } = fixture(); await session.open()
    session.setComposing(true); session.edit('中文')
    await vi.advanceTimersByTimeAsync(1000)
    expect(port.saveDocument).not.toHaveBeenCalled()
    session.setComposing(false)
    await vi.advanceTimersByTimeAsync(799)
    expect(port.saveDocument).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(port.saveDocument).toHaveBeenCalledTimes(1)
    expect(session.getSnapshot().dirty).toBe(false)
    session.dispose()
  })
  it('keeps both conflicting drafts until the teacher selects one', async () => {
    const { session, external } = fixture(); await session.open()
    session.edit('教师稿'); external('外部稿')
    expect(await session.flush()).toBe(false)
    expect(session.getSnapshot().source).toBe('教师稿')
    expect(session.getSnapshot().conflict).toMatchObject({ source: '外部稿' })
    for (const hunk of session.getSnapshot().conflictHunks) await session.resolveConflictHunk(hunk.id, 'remote')
    expect(session.getSnapshot()).toMatchObject({ source: '外部稿', dirty: false })
    session.dispose()
  })
  it('resolves each overlap while preserving independent edits from both writers', async () => {
    const { session, port, external } = fixture()
    port.openDocument = async () => ({ ref, source: '第一段原始\n第二段原始\n第三段原始\n第四段原始', version: { contentVersion: '1', attachments: [] }, diagnostics: [] })
    await session.open()
    session.edit('第一段本地\n第二段教师\n第三段原始\n第四段教师')
    external('第一段外部\n第二段原始\n第三段磁盘\n第四段外部')
    expect(session.getSnapshot().conflictHunks).toHaveLength(2)
    expect(session.getSnapshot().source).toContain('第二段教师')
    expect(session.getSnapshot().source).toContain('第三段磁盘')
    const [first, second] = session.getSnapshot().conflictHunks
    await session.resolveConflictHunk(first!.id, 'remote')
    expect(port.saveDocument).not.toHaveBeenCalled()
    await session.resolveConflictHunk(second!.id, 'local', '手动')
    expect(session.getSnapshot()).toMatchObject({ source: '第一段外部\n第二段教师\n第三段磁盘\n第四段手动', dirty: false, conflict: null })
    session.dispose()
  })
  it('merges separate source ranges without replacing the local draft', () => {
    expect(mergeDocumentSources('甲\n中间\n乙', '甲改\n中间\n乙', '甲\n中间\n乙改')).toBe('甲改\n中间\n乙改')
    expect(mergeDocumentSources('原稿', '教师稿', 'AI稿')).toBeNull()
  })
  it('does not close when recovery persistence fails', async () => {
    const { session, port } = fixture(); await session.open(); session.edit('未保存')
    port.preserveDraft = async () => { throw new Error('disk full') }
    expect(await session.preserveAndClose()).toBe(false)
    expect(session.getSnapshot().source).toBe('未保存')
    expect(session.getSnapshot().error).toContain('disk full')
    session.dispose()
  })
  it('queues attachment bytes and submits them with the changed markdown in one save', async () => {
    const { session, port } = fixture(); await session.open()
    session.prepareAttachments([{ relativePath: 'assets/image.png', bytes: new Uint8Array([1, 2, 3]) }])
    expect(port.saveDocument).not.toHaveBeenCalled()
    session.edit('![图](assets/image.png)')
    await session.flush()
    expect(port.saveDocument).toHaveBeenCalledTimes(1)
    expect(vi.mocked(port.saveDocument).mock.calls[0]![0]).toMatchObject({ source: '![图](assets/image.png)', attachments: [{ relativePath: 'assets/image.png', bytes: new Uint8Array([1, 2, 3]) }] })
    session.dispose()
  })
  it('restores a conflicting recovery draft and groups undo separately from saves', async () => {
    const { session, port } = fixture()
    port.readRecovery = async () => ({ source: '恢复稿', expectedVersion: { contentVersion: 'old', attachments: [] } })
    await session.open()
    expect(await session.flush()).toBe(false)
    await session.resolveConflict('recovery')
    session.edit('恢复稿甲', 'typing'); session.edit('恢复稿甲乙', 'typing')
    await session.flush(); session.undo()
    expect(session.getSnapshot().source).toBe('恢复稿')
    session.redo(); expect(session.getSnapshot().source).toBe('恢复稿甲乙')
    session.dispose()
  })
  it('rejects a preview without writing the real file', async () => {
    const { filename, files, fileRef, session } = await ownerFixture()
    const disk = session.getSnapshot().disk!
    const edits = [{ from: 0, to: 3, before: 'old', after: 'new' }]
    expect((await session.prepareAiEdit(edits, 10)).status).toBe('ready')
    session.previewAiEdit({ baseVersion: disk.version, epoch: 10, operationId: randomUUID(), edits })
    await session.dismissAiCandidate()
    expect(await fs.readFile(filename, 'utf8')).toBe('old\n\nnotes')
    expect((await files.openDocument(fileRef)).source).toBe('old\n\nnotes')
    session.dispose(false)
  })
  it('undoes and redoes an accepted real-owner edit, then saves and reopens it', async () => {
    const { filename, fileRef, files, session } = await ownerFixture()
    const disk = session.getSnapshot().disk!
    const edits = [{ from: 0, to: 3, before: 'old', after: 'new' }]
    expect((await session.prepareAiEdit(edits, 11)).status).toBe('ready')
    session.previewAiEdit({ baseVersion: disk.version, epoch: 11, operationId: randomUUID(), edits })
    expect((await session.acceptAiCandidate())?.status).toBe('applied')
    expect(await fs.readFile(filename, 'utf8')).toBe('new\n\nnotes')
    session.undo(); expect(session.getSnapshot().source).toBe('old\n\nnotes')
    await session.flush()
    session.redo(); expect(session.getSnapshot().source).toBe('new\n\nnotes')
    await session.flush(); await session.close()
    const reopened = new DocumentFileSession(fileRef, files); await reopened.open()
    expect(reopened.getSnapshot().source).toBe('new\n\nnotes')
    await reopened.close()
  })
  it('keeps concurrent human input in the same history when undoing and redoing the AI group', async () => {
    const { port, session, external } = fixture('old\n\nnotes'); await session.open()
    let resolveApply!: (result: Awaited<ReturnType<RecoverableDocumentFilePort['applyAiEdit']>>) => void
    vi.mocked(port.applyAiEdit).mockImplementationOnce(() => new Promise(resolve => { resolveApply = resolve }))
    const applying = session.applyAiEdit({ baseVersion: { contentVersion: '1', attachments: [] }, epoch: 12, operationId: 'ai', edits: [{ from: 0, to: 3, before: 'old', after: 'new' }] })
    await vi.waitFor(() => expect(resolveApply).toBeTypeOf('function'))
    session.edit('old\n\nnotes + HUMAN', 'typing')
    external('new\n\nnotes + HUMAN')
    resolveApply({ status: 'applied', record: { id: 'ai', ref, baseVersion: { contentVersion: '1', attachments: [] }, savedVersion: { contentVersion: 'new\n\nnotes + HUMAN', attachments: [] }, applied: [{ from: 0, to: 3, before: 'old', after: 'new' }] }, conflicts: [] })
    await applying
    expect(session.getSnapshot().source).toBe('new\n\nnotes + HUMAN')
    session.undo(); expect(session.getSnapshot().source).toBe('old\n\nnotes + HUMAN')
    session.redo(); expect(session.getSnapshot().source).toBe('new\n\nnotes + HUMAN')
    session.undo(); session.undo(); expect(session.getSnapshot().source).toBe('old\n\nnotes')
    session.dispose()
  })
  it('uses the persisted AI version as history coordinates when a concurrent human prefix shifts the session source', async () => {
    const { port, session, external } = fixture('old\n\nnotes'); await session.open()
    let resolveApply!: (result: Awaited<ReturnType<RecoverableDocumentFilePort['applyAiEdit']>>) => void
    vi.mocked(port.applyAiEdit).mockImplementationOnce(() => new Promise(resolve => { resolveApply = resolve }))
    const applying = session.applyAiEdit({ baseVersion: { contentVersion: '1', attachments: [] }, epoch: 15, operationId: 'ai-prefix', edits: [{ from: 0, to: 3, before: 'old', after: 'new' }] })
    await vi.waitFor(() => expect(resolveApply).toBeTypeOf('function'))
    external('new\n\nnotes')
    session.edit('+ HUMAN\nnew\n\nnotes', 'typing')
    resolveApply({ status: 'applied', record: { id: 'ai-prefix', ref, baseVersion: { contentVersion: '1', attachments: [] }, savedVersion: { contentVersion: 'new\n\nnotes', attachments: [] }, applied: [{ from: 0, to: 3, before: 'old', after: 'new' }] }, conflicts: [] })
    await applying
    expect(session.getSnapshot().source).toBe('+ HUMAN\nnew\n\nnotes')
    session.undo(); expect(session.getSnapshot().source).toBe('+ HUMAN\nold\n\nnotes')
    session.redo(); expect(session.getSnapshot().source).toBe('+ HUMAN\nnew\n\nnotes')
    session.dispose()
  })
  it('invalidates a visible preview as soon as the watcher reports a disk change', async () => {
    const { port, session, external } = fixture(); await session.open()
    session.previewAiEdit({ baseVersion: { contentVersion: '1', attachments: [] }, epoch: 13, operationId: 'ai', edits: [] })
    external('外部稿')
    expect(session.getSnapshot()).toMatchObject({ source: '外部稿', aiCandidate: null })
    await vi.waitFor(() => expect(port.invalidateAiEdits).toHaveBeenCalled())
    session.dispose(false)
  })
  it('clears a preview on human editing or Stop and never sends the old candidate to the owner', async () => {
    const { port, session } = fixture(); await session.open()
    const request = { baseVersion: { contentVersion: '1', attachments: [] }, epoch: 14, operationId: 'ai', edits: [{ from: 0, to: 2, before: '原稿', after: 'AI稿' }] }
    session.previewAiEdit(request)
    session.edit('教师稿')
    expect(session.getSnapshot().aiCandidate).toBeNull()
    await session.acceptAiCandidate()
    expect(port.applyAiEdit).not.toHaveBeenCalled()
    session.previewAiEdit(request)
    await session.stopAiEdits()
    expect(session.getSnapshot().aiCandidate).toBeNull()
    expect(port.invalidateAiEdits).toHaveBeenCalled()
    session.dispose(false)
  })
  it('invalidates a visible preview when Undo or Redo changes the document', async () => {
    const { port, session } = fixture(); await session.open()
    const request = { baseVersion: { contentVersion: '1', attachments: [] }, epoch: 16, operationId: 'ai-history', edits: [] }
    session.edit('教师稿')
    session.previewAiEdit(request)
    session.undo()
    expect(session.getSnapshot()).toMatchObject({ source: '原稿', aiCandidate: null })
    session.previewAiEdit(request)
    session.redo()
    expect(session.getSnapshot()).toMatchObject({ source: '教师稿', aiCandidate: null })
    expect(port.invalidateAiEdits).toHaveBeenCalledTimes(2)
    session.dispose(false)
  })
})
