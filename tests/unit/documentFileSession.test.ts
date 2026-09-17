import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentFileSession, mergeDocumentSources, type RecoverableDocumentFilePort } from '../../src/renderer/documentFiles/documentFileSession'
import type { OpenDocumentResult } from '../../src/shared/document/ports'

const ref = { kind: 'lesson' as const, lessonId: 'lesson', lessonDirectory: '/lesson', relativePath: 'plan.md' }
function fixture() {
  let disk: OpenDocumentResult = { ref, source: '原稿', version: { contentVersion: '1', attachments: [] }, diagnostics: [] }
  let notify: Parameters<RecoverableDocumentFilePort['watchDocument']>[1] = () => {}
  const port: RecoverableDocumentFilePort = {
    openDocument: async () => disk,
    watchDocument: (_ref, listener) => { notify = listener; return () => {} },
    saveDocument: vi.fn(async request => { disk = { ...disk, source: request.source, version: { contentVersion: request.source, attachments: [] } }; return { status: 'saved' as const, operationId: request.operationId, version: disk.version } }),
    prepareAiEdit: vi.fn(), applyAiEdit: vi.fn(), revertAiEdit: vi.fn(), preserveDraft: vi.fn(async () => {}), readRecovery: async () => null,
  }
  return { port, session: new DocumentFileSession(ref, port), external(source: string) { disk = { ...disk, source, version: { contentVersion: source, attachments: [] } }; notify({ type: 'changed', disk }) } }
}
afterEach(() => vi.useRealTimers())
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
})
