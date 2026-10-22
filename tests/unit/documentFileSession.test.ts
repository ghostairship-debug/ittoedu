// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentFileSession, mergeDocumentSources } from '../../src/renderer/documentFiles/documentFileSession'
import { createLessonDocumentFiles } from '../../src/main/lessonDocumentFiles'
import { createMarkdownTestHost } from '../helpers/markdownDocumentHost'

const roots: string[] = [], views: DocumentFileSession[] = []
afterEach(async () => {
  for (const view of views.splice(0)) view.dispose()
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected fixture path')
    await fs.rm(root, { recursive: true, force: true })
  }
})
async function fixture(source = 'old\n\nnotes', name = 'notes.md') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-main-session-')); roots.push(root)
  const filename = path.join(root, name); await fs.writeFile(filename, source)
  const ref = { kind: 'file' as const, path: filename }
  const journal = path.join(root, 'journal'), metadata = path.join(root, 'metadata')
  const { host, documents } = createMarkdownTestHost(journal)
  const files = createLessonDocumentFiles({ recoveryDirectory: metadata, validateTarget: async () => {}, documents })
  const port = { ...files, documents }, session = new DocumentFileSession(ref, port); views.push(session)
  await session.open()
  return { root, filename, ref, journal, metadata, host, documents, files, port, session }
}
async function observeNow(f: Awaited<ReturnType<typeof fixture>>) {
  const observed = await f.documents.observeFile(f.session.documentId!)
  await (f.session as unknown as { observe(observation: typeof observed): Promise<void> }).observe(observed)
}

async function conflictRecoveryFixture() {
  const f = await fixture('A\nkeep\nC')
  f.session.edit('A local\nkeep\nC local'); await f.session.drain()
  await fs.writeFile(f.filename, 'A remote\nkeep\nC remote'); await observeNow(f)
  const hunk = f.session.getSnapshot().conflictHunks[0]!
  f.session.setConflictDraft(hunk.id, 'teacher manual input')
  expect(await f.session.preserveDraft()).toBe(true)
  const recovery = await f.documents.readAuthoringDrafts(f.session.documentId!)
  const record = recovery!.sourceConflicts![0]!
  f.session.dispose()
  return { ...f, recovery: recovery!, record, hunk }
}

describe('Source conflict raw recovery', () => {
  it('restores matching source, disk and hunk baseline and claims only after durable possession', async () => {
    const f = await conflictRecoveryFixture()
    const claim = vi.spyOn(f.documents, 'claimAuthoringDrafts')
    const write = vi.spyOn(f.documents, 'writeAuthoringDrafts')
    const view = new DocumentFileSession(f.ref, f.port); views.push(view); await view.open()
    expect(view.getSnapshot().conflictDrafts).toEqual({ [f.hunk.id]: 'teacher manual input' })
    expect(view.getSnapshot().retainedSourceConflicts).toEqual([])
    expect(claim).toHaveBeenCalledWith(view.documentId, view.committedDocument!.epoch,
      f.recovery.recoveryRecords!.filter(record => record.kind === 'sourceConflict').map(({ id, digest }) => ({ id, digest })))
    expect(write).toHaveBeenCalledWith(view.documentId, { retainedRecords: [], sourceConflicts: [expect.objectContaining({ conflictBaseline: f.record.conflictBaseline })] }, view.committedDocument!.epoch)
    expect(claim.mock.invocationCallOrder[0]).toBeLessThan(write.mock.invocationCallOrder[0]!)
    expect(view.committedDocument!.model).toMatchObject({ source: f.record.source })
  })

  it('cold restores matching raw into the new epoch and clears the claimed original when that input is removed', async () => {
    const f = await conflictRecoveryFixture(), restarted = createMarkdownTestHost(f.journal)
    const claim = vi.spyOn(restarted.documents, 'claimAuthoringDrafts')
    const view = new DocumentFileSession(f.ref, { ...f.port, documents: restarted.documents }); views.push(view); await view.open()
    expect(view.committedDocument!.epoch).not.toBe(f.record.epoch)
    expect(view.getSnapshot().conflictDrafts).toEqual({ [f.hunk.id]: 'teacher manual input' })
    expect(claim).toHaveBeenCalledOnce()
    const owned = await restarted.documents.readAuthoringDrafts(view.documentId!)
    expect(owned!.sourceConflicts).toHaveLength(1)
    expect(owned!.sourceConflicts![0]!.epoch).toBe(view.committedDocument!.epoch)
    view.removeConflictDraft(f.hunk.id); expect(await view.preserveDraft()).toBe(true)
    expect(await restarted.documents.readAuthoringDrafts(view.documentId!)).toBeNull()
  })

  it.each(['source', 'diskVersion', 'conflictBaseline', 'legacy'] as const)('retains %s mismatch without restoring offset IDs or claiming it', async field => {
    const f = await conflictRecoveryFixture()
    const record = { ...f.record }
    if (field === 'legacy') delete record.conflictBaseline
    else record[field] = `${record[field]} changed`
    vi.spyOn(f.documents, 'readAuthoringDrafts').mockResolvedValue({ advanced: [], properties: [], sourceConflicts: [record],
      recoveryRecords: [{ id: 'original-id', digest: 'original-digest', ownerDocumentId: record.documentId, kind: 'sourceConflict', value: record }] })
    const claim = vi.spyOn(f.documents, 'claimAuthoringDrafts')
    const view = new DocumentFileSession(f.ref, f.port); views.push(view); await view.open()
    expect(view.getSnapshot().conflictHunks.some(hunk => hunk.id === f.hunk.id)).toBe(true)
    expect(view.getSnapshot().conflictDrafts).toEqual({})
    expect(view.getSnapshot().retainedSourceConflicts).toEqual([record])
    expect(view.getSnapshot().error).toContain('冲突基线')
    expect(claim).not.toHaveBeenCalled()
    view.setConflictDraft(f.hunk.id, 'new current input'); expect(await view.preserveDraft()).toBe(true)
    expect(view.getSnapshot().retainedSourceConflicts).toEqual([record])
  })

  it('keeps distinct matching candidates visible without silently selecting the last input', async () => {
    const f = await conflictRecoveryFixture()
    const other = { ...f.record, hunks: f.record.hunks.map(hunk => ({ ...hunk, text: 'different original input' })) }
    vi.spyOn(f.documents, 'readAuthoringDrafts').mockResolvedValue({ advanced: [], properties: [], sourceConflicts: [f.record, other] })
    const claim = vi.spyOn(f.documents, 'claimAuthoringDrafts')
    const view = new DocumentFileSession(f.ref, f.port); views.push(view); await view.open()
    expect(view.getSnapshot().conflictDrafts).toEqual({})
    expect(view.getSnapshot().retainedSourceConflicts).toEqual([f.record, other])
    expect(view.getSnapshot().error).toContain('多份不同')
    expect(claim).not.toHaveBeenCalled()
  })

  it('retains same-epoch rejected raw durably when a remounted editor writes a new hunk draft', async () => {
    const f = await conflictRecoveryFixture()
    await fs.writeFile(f.filename, 'A other remote\nkeep\nC other remote')
    const view = new DocumentFileSession(f.ref, f.port); views.push(view); await view.open()
    expect(view.committedDocument!.epoch).toBe(f.record.epoch)
    expect(view.getSnapshot().conflictDrafts).toEqual({})
    expect(view.getSnapshot().retainedSourceConflicts).toEqual([f.record])
    view.setConflictDraft(view.getSnapshot().conflictHunks[0]!.id, 'new same-epoch input')
    expect(await view.preserveDraft()).toBe(true)
    const retained = await f.documents.readAuthoringDrafts(view.documentId!)
    expect(retained!.sourceConflicts!.flatMap(candidate => candidate.hunks.map(hunk => hunk.text)))
      .toEqual(expect.arrayContaining(['teacher manual input', 'new same-epoch input']))
    expect(retained!.recoveryRecords!.some(candidate => candidate.id === f.recovery.recoveryRecords![0]!.id)).toBe(true)
  })
})

describe('Markdown projection on the main document owner', () => {
  it('keeps the save ACK source as merge base when a later disk version arrives before observation', async () => {
    const f = await fixture('A base\nB base\nC base')
    f.session.edit('A base\nB saved\nC base'); await f.session.drain()
    const save = f.documents.save.bind(f.documents)
    let saved = false
    vi.spyOn(f.documents, 'save').mockImplementation(async id => {
      const snapshot = await save(id)
      await fs.writeFile(f.filename, 'A base\nB saved\nC external')
      saved = true
      return snapshot
    })
    const observe = f.documents.observeFile.bind(f.documents)
    vi.spyOn(f.documents, 'observeFile').mockImplementation(async id => {
      const observation = await observe(id)
      if (saved) { saved = false; f.session.edit('A teacher\nB saved\nC base'); await f.session.drain() }
      return observation
    })
    expect(await f.session.flush()).toBe(true)
    expect(f.session.getSnapshot().source).toBe('A teacher\nB saved\nC external')
    expect(f.session.getSnapshot().conflictHunks).toHaveLength(0)
  })

  it('uses the actual Main save capture when the ACK already contains a newer teacher edit', async () => {
    const f = await fixture('A base\nB base\nC base')
    f.session.edit('A base\nB saved\nC base'); await f.session.drain()
    let edited = false
    const stop = f.documents.subscribe(event => {
      if (event.type === 'changed' && event.snapshot.saving && !edited) {
        edited = true; f.session.edit('A teacher\nB saved\nC base')
      }
    })
    const save = f.documents.save.bind(f.documents)
    vi.spyOn(f.documents, 'save').mockImplementation(async id => {
      const snapshot = await save(id)
      expect(snapshot.dirty).toBe(true)
      await fs.writeFile(f.filename, 'A base\nB saved\nC external')
      return snapshot
    })
    try {
      expect(await f.session.flush()).toBe(true)
      expect(f.session.getSnapshot().source).toBe('A teacher\nB saved\nC external')
    } finally { stop() }
  })

  it('keeps the Save As ACK source as base when the new location is externally edited before its observation', async () => {
    const f = await fixture('A\nB\nC')
    f.session.edit('A\nB saved\nC'); await f.session.drain()
    const target = path.join(f.root, 'copy.md')
    vi.spyOn(f.documents, 'saveWithDialog').mockImplementation(async id => {
      const saved = await f.documents.save(id, target)
      await fs.writeFile(target, 'A\nB saved\nC external')
      return saved
    })
    const observe = f.documents.observeFile.bind(f.documents)
    let edited = false
    vi.spyOn(f.documents, 'observeFile').mockImplementation(async id => {
      const observation = await observe(id)
      if (!edited) { edited = true; f.session.edit('A teacher\nB saved\nC'); await f.session.drain() }
      return observation
    })
    expect(await f.session.saveAs()).toBe(true)
    expect(f.session.ref).toEqual({ kind: 'file', path: target })
    await observeNow(f)
    expect(f.session.getSnapshot().source).toBe('A teacher\nB saved\nC external')
  })

  it('rebases a merge on the teacher input acknowledged while its second drain is waiting', async () => {
    const f = await fixture('A base\nB base\nC base')
    f.session.edit('A teacher\nB base\nC base'); await f.session.drain()
    await fs.writeFile(f.filename, 'A base\nB base\nC external')
    const read = f.documents.read.bind(f.documents)
    let reads = 0, release!: () => void, entered!: () => void
    const paused = new Promise<void>(resolve => { release = resolve })
    const waiting = new Promise<void>(resolve => { entered = resolve })
    vi.spyOn(f.documents, 'read').mockImplementation(async id => {
      if (++reads === 2) { entered(); await paused }
      return read(id)
    })
    const coordination = observeNow(f)
    await waiting
    f.session.edit('A teacher\nB teacher\nC base')
    await vi.waitFor(async () => expect((await read(f.session.documentId!)).model).toMatchObject({ source: 'A teacher\nB teacher\nC base' }))
    release(); await coordination
    expect(f.session.getSnapshot().source).toBe('A teacher\nB teacher\nC external')
    expect(await f.session.flush()).toBe(true)
    expect(await fs.readFile(f.filename, 'utf8')).toBe('A teacher\nB teacher\nC external')
  })

  it('recomputes each disk version from the real local source instead of its previous remote preview', async () => {
    const f = await fixture('A\nB\nC')
    f.session.edit('A local\nB\nC'); await f.session.drain()
    await fs.writeFile(f.filename, 'A remote1\nB\nC remote1'); await observeNow(f)
    expect(f.session.getSnapshot().source).toContain('C remote1')
    expect(f.session.getSnapshot().conflictHunks).toHaveLength(1)
    await fs.writeFile(f.filename, 'A remote2\nB\nC'); await observeNow(f)
    expect(f.session.getSnapshot().conflictHunks).toHaveLength(1)
    expect(f.session.getSnapshot().source).toBe('A local\nB\nC')
    await f.session.resolveConflictHunk(f.session.getSnapshot().conflictHunks[0]!.id, 'remote')
    expect(await fs.readFile(f.filename, 'utf8')).toBe('A remote2\nB\nC')
  })
  it('allows a repaired Undo draft to mention the removed filename as ordinary text', async () => {
    const f = await fixture('base')
    f.session.prepareAttachments([{ relativePath: 'assets/image.png', bytes: new Uint8Array([1, 2]) }])
    f.session.edit('![图](assets/image.png)'); await f.session.drain()
    const dispatch = f.documents.dispatch.bind(f.documents)
    let release!: () => void, entered!: () => void
    const paused = new Promise<void>(resolve => { release = resolve })
    const waiting = new Promise<void>(resolve => { entered = resolve })
    vi.spyOn(f.documents, 'dispatch').mockImplementation(async operation => {
      const result = await dispatch(operation)
      if (operation.mutation.type === 'undo') { entered(); await paused }
      return result
    })
    const undo = f.session.undo()
    await waiting
    f.session.edit('![教师](assets/image.png)')
    release(); await undo
    expect(f.session.getSnapshot().error).toContain('重叠')
    f.session.edit('assets/image.png 已被撤销')
    expect(await f.session.drain()).toBe(true)
    expect(await f.session.flush()).toBe(true)
    expect(await fs.readFile(f.filename, 'utf8')).toBe('assets/image.png 已被撤销')
    await expect(f.session.readResource('assets/image.png')).rejects.toThrow('未包含')
  })
  it('follows a renamed main binding without mutating an already frozen task reference or losing History', async () => {
    const f = await fixture()
    const originalRef = f.session.ref
    f.session.edit('教师未保存稿'); await f.session.drain()
    const id = f.session.documentId!
    const root = await f.host.files.registerRoot(f.root)
    const entries = (await f.host.files.listChildren({ workspaceId: root.workspaceId, directoryEntryId: root.rootEntryId })).entries
    const file = entries.find(entry => entry.status === 'accessible' && entry.name === 'notes.md')!
    if (file.status !== 'accessible') throw new Error('fixture')
    expect(await f.host.files.rename({ operationId: 'rename', workspaceId: root.workspaceId, sourceEntryId: file.entryId, name: '新名字.md' })).toMatchObject({ status: 'success' })
    expect(f.session.documentId).toBe(id)
    expect(f.session.ref).toEqual({ kind: 'file', path: path.join(f.root, '新名字.md') })
    expect(originalRef).toEqual(f.ref)
    await f.session.undo(); expect(f.session.getSnapshot().source).toBe('old\n\nnotes')
    await f.session.redo(); expect(await f.session.flush()).toBe(true)
    expect(await fs.readFile(path.join(f.root, '新名字.md'), 'utf8')).toBe('教师未保存稿')
    await expect(fs.stat(f.filename)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('keeps IME local until complete and restores one host history with resources after renderer reconstruction', async () => {
    const f = await fixture()
    f.session.setComposing(true); f.session.edit('中文输入', 'typing')
    expect((await f.documents.list())[0]!.model).toMatchObject({ source: 'old\n\nnotes' })
    expect(await fs.readFile(f.filename, 'utf8')).toBe('old\n\nnotes')
    f.session.setComposing(false); expect(await f.session.drain()).toBe(true)
    expect((await f.documents.list())[0]).toMatchObject({ dirty: true, undoDepth: 1, model: { source: '中文输入' } })
    f.session.prepareAttachments([{ relativePath: 'assets/image.png', bytes: new Uint8Array([0, 255, 1]) }])
    f.session.edit('中文输入\n![图](assets/image.png)')
    await f.session.drain()
    const committed = (await f.documents.list())[0]!
    expect(committed.undoDepth).toBe(2)
    f.session.dispose()
    const rebuilt = new DocumentFileSession(f.ref, f.port); views.push(rebuilt); await rebuilt.open()
    expect((await f.documents.list())[0]!.documentId).toBe(committed.documentId)
    expect(await rebuilt.readResource('assets/image.png')).toMatchObject({ bytes: new Uint8Array([0, 255, 1]) })
    await rebuilt.undo()
    expect(rebuilt.getSnapshot().source).toBe('中文输入')
    await expect(rebuilt.readResource('assets/image.png')).rejects.toThrow('未包含')
    await rebuilt.redo(); expect(await rebuilt.flush()).toBe(true)
    expect(await fs.readFile(f.filename, 'utf8')).toBe('中文输入\n![图](assets/image.png)')
    expect(await fs.readFile(path.join(f.root, 'assets/image.png'))).toEqual(Buffer.from([0, 255, 1]))
    expect(await rebuilt.close()).toBe(true)
    expect(await f.documents.list()).toEqual([])
  })

  it('keeps external overlapping edits explicit and adopts the selected merge through main without resetting history', async () => {
    const f = await fixture('第一段\n第二段\n第三段')
    f.session.edit('第一段本地\n第二段教师\n第三段'); await f.session.drain()
    await fs.writeFile(f.filename, '第一段磁盘\n第二段\n第三段磁盘')
    await vi.waitFor(() => expect(f.session.getSnapshot().conflictHunks).toHaveLength(1), { timeout: 3000 })
    expect(f.session.getSnapshot().source).toContain('第二段教师')
    expect(f.session.getSnapshot().source).toContain('第三段磁盘')
    expect(await f.session.flush()).toBe(false)
    await f.session.resolveConflictHunk(f.session.getSnapshot().conflictHunks[0]!.id, 'remote')
    expect(f.session.getSnapshot()).toMatchObject({ source: '第一段磁盘\n第二段教师\n第三段磁盘', conflict: null, dirty: false })
    expect((await f.documents.list())[0]!.undoDepth).toBe(2)
    await f.session.undo(); expect(f.session.getSnapshot().source).toBe('第一段本地\n第二段教师\n第三段')
    expect(mergeDocumentSources('A\nB', 'Ax\nB', 'A\nBy')).toBe('Ax\nBy')
  })

  it('preserves unsaved content and resources in the host journal without renderer recovery files', async () => {
    const f = await fixture('base')
    f.session.prepareAttachments([{ relativePath: 'images/a.png', bytes: new Uint8Array([1, 2, 3]) }])
    f.session.edit('![保留](images/a.png)')
    expect(await f.session.preserveAndClose()).toBe(true)
    expect(await fs.readFile(f.filename, 'utf8')).toBe('base')
    const restarted = createMarkdownTestHost(f.journal)
    const files = createLessonDocumentFiles({ recoveryDirectory: f.metadata, validateTarget: async () => {}, documents: restarted.documents })
    const view = new DocumentFileSession(f.ref, { ...files, documents: restarted.documents }); views.push(view)
    await view.open()
    expect(view.getSnapshot()).toMatchObject({ source: '![保留](images/a.png)', recovery: true, dirty: true })
    expect(await view.readResource('images/a.png')).toMatchObject({ bytes: new Uint8Array([1, 2, 3]) })
    await view.resolveConflict('recovery')
    expect(await fs.readFile(f.filename, 'utf8')).toBe('![保留](images/a.png)')
    expect(view.getSnapshot().dirty).toBe(false)
  })

  it.each(['notes.txt', 'notes.md', 'page.html'])('keeps %s dirty past 800 ms with History intact until explicit save', async name => {
    const f = await fixture('before', name)
    expect(f.session.getSnapshot().autoSave).toBe(false)
    f.session.edit('after')
    expect(await f.session.drain()).toBe(true)
    await new Promise(resolve => setTimeout(resolve, 950))
    expect(f.session.getSnapshot().dirty).toBe(true)
    expect(f.session.committedDocument).toMatchObject({ dirty: true, undoDepth: 1, model: { source: 'after' } })
    expect(await fs.readFile(f.filename, 'utf8')).toBe('before')
    await f.session.undo(); expect(f.session.getSnapshot().source).toBe('before')
    await f.session.redo(); expect(f.session.getSnapshot().source).toBe('after')
    expect(await f.session.flush()).toBe(true)
    expect(await fs.readFile(f.filename, 'utf8')).toBe('after')
  })

  it('saves after the user explicitly enables autosave, including an HTML file', async () => {
    const f = await fixture('<p>before</p>', 'page.html')
    f.session.edit('<p>after</p>'); await f.session.drain()
    f.session.setAutoSave(true)
    await vi.waitFor(async () => expect(await fs.readFile(f.filename, 'utf8')).toBe('<p>after</p>'), { timeout: 2000 })
    expect(f.session.getSnapshot().dirty).toBe(false)
  })

  it('suspends close input without draining IME, then resumes the same draft when close is cancelled', async () => {
    const f = await fixture('original', 'notes.txt')
    f.session.setComposing(true); f.session.edit('IME draft')
    const dispatch = vi.spyOn(f.documents, 'dispatch')
    f.session.suspendForClose()
    f.session.edit('late edit'); f.session.setComposing(false)
    expect(await f.session.drain()).toBe(false)
    expect(await f.session.flush()).toBe(false)
    expect(dispatch).not.toHaveBeenCalled()
    expect(f.session.getSnapshot().source).toBe('IME draft')
    expect(await fs.readFile(f.filename, 'utf8')).toBe('original')
    f.session.resumeAfterCloseCancelled()
    expect(await f.session.drain()).toBe(true)
    expect(f.session.committedDocument).toMatchObject({ dirty: true, undoDepth: 1, model: { source: 'IME draft' } })
    expect(await fs.readFile(f.filename, 'utf8')).toBe('original')
  })
})


it('M25 a failed local draft has a confirmed discard path without retrying drain or save; cancel retains the draft', async () => {
  const f = await fixture('original', 'failed.html')
  f.session.setComposing(true)
  f.session.edit('uncommitted input')
  const drain = vi.spyOn(f.session, 'drain').mockResolvedValue(false)
  const close = vi.spyOn(f.documents, 'closeWithDialog').mockResolvedValueOnce(false).mockImplementationOnce(async id => {
    await f.documents.close(id, true); return true
  })
  expect(await f.session.discardAndClose()).toBe(false)
  expect(f.session.getSnapshot().source).toBe('uncommitted input')
  expect(await f.session.discardAndClose()).toBe(true)
  expect(close).toHaveBeenCalledWith(f.session.documentId, undefined, true)
  expect(drain).not.toHaveBeenCalled()
  f.session.setComposing(false) // A late IME completion cannot recreate the disposed writer.
  expect(await f.documents.list()).toEqual([])
  expect(await fs.readFile(f.filename, 'utf8')).toBe('original')
})

it('confirms close input without rereading the full source and keeps cancelled input editable', async () => {
  const f = await fixture('<p>original</p>', 'close.html')
  const read = vi.spyOn(f.documents, 'read')
  f.session.edit('<p>teacher input</p>')
  vi.spyOn(f.documents, 'closeWithDialog').mockImplementation(async () => {
    // Main requests input confirmation before and after its write-task barrier.
    expect(await f.session.preserveDraft()).toBe(true)
    expect(await f.session.preserveDraft()).toBe(true)
    return false
  })
  expect(await f.session.close()).toBe(false)
  expect(read).not.toHaveBeenCalled()
  expect(await f.host.internalAPI.read(f.session.documentId!)).toMatchObject({ dirty: true, undoDepth: 1, model: { source: '<p>teacher input</p>' } })
  expect(await fs.readFile(f.filename, 'utf8')).toBe('<p>original</p>')
  f.session.edit('<p>after cancellation</p>')
  expect(await f.session.drain()).toBe(true)
  expect(f.session.committedDocument).toMatchObject({ dirty: true, model: { source: '<p>after cancellation</p>' } })
  read.mockRestore()
})

it('pauses the target disk poll during a single close request and resumes it after cancellation', async () => {
  const f = await fixture('original', 'close.txt')
  vi.useFakeTimers()
  try {
    const observe = vi.spyOn(f.documents, 'observeFile')
    let enter!: () => void, cancel!: (result: boolean) => void
    const entered = new Promise<void>(resolve => { enter = resolve })
    const response = new Promise<boolean>(resolve => { cancel = resolve })
    const dialog = vi.spyOn(f.documents, 'closeWithDialog').mockImplementation(() => { enter(); return response })
    const closing = f.session.close()
    expect(f.session.close()).toBe(closing)
    await entered
    await vi.advanceTimersByTimeAsync(1500)
    expect(observe).not.toHaveBeenCalled()
    expect(dialog).toHaveBeenCalledTimes(1)
    cancel(false)
    expect(await closing).toBe(false)
    await vi.advanceTimersByTimeAsync(1000)
    expect(observe).toHaveBeenCalledTimes(1)
  } finally { f.session.dispose(); vi.useRealTimers(); vi.restoreAllMocks() }
})

it('waits for close IME completion before confirming the committed input', async () => {
  const f = await fixture('original', 'close-ime.txt')
  const dialog = vi.spyOn(f.documents, 'closeWithDialog').mockResolvedValue(false)
  try {
    f.session.setComposing(true)
    f.session.edit('中文输入')
    const closing = f.session.close()
    await Promise.resolve()
    expect(dialog).not.toHaveBeenCalled()
    expect(await f.host.internalAPI.read(f.session.documentId!)).toMatchObject({ dirty: false, model: { source: 'original' } })
    f.session.setComposing(false)
    expect(await closing).toBe(false)
    expect(dialog).toHaveBeenCalledTimes(1)
    expect(await f.host.internalAPI.read(f.session.documentId!)).toMatchObject({ dirty: true, undoDepth: 1, model: { source: '中文输入' } })
    expect(await fs.readFile(f.filename, 'utf8')).toBe('original')
  } finally { dialog.mockRestore() }
})

it('keeps an unknown input acknowledgement from reaching the close decision', async () => {
  const f = await fixture('original', 'close-unknown.txt')
  const dispatch = vi.spyOn(f.documents, 'dispatch').mockRejectedValueOnce(new Error('transport lost'))
  const dialog = vi.spyOn(f.documents, 'closeWithDialog').mockResolvedValue(true)
  try {
    f.session.edit('input awaiting acknowledgement')
    expect(await f.session.close()).toBe(false)
    expect(await f.session.preserveDraft()).toBe(false)
    expect(dialog).not.toHaveBeenCalled()
    expect(f.session.getSnapshot()).toMatchObject({ source: 'input awaiting acknowledgement' })
    expect(await f.host.internalAPI.read(f.session.documentId!)).toMatchObject({ dirty: false, model: { source: 'original' } })
    expect(await fs.readFile(f.filename, 'utf8')).toBe('original')
  } finally { dispatch.mockRestore(); dialog.mockRestore() }
})

it('resumes polling when a pre-close observation finishes after cancellation', async () => {
  vi.useFakeTimers()
  let f: Awaited<ReturnType<typeof fixture>> | undefined
  try {
    f = await fixture('original', 'close-poll.txt')
    const observation = await f.documents.observeFile(f.session.documentId!)
    let finishObservation!: (value: typeof observation) => void
    const pending = new Promise<typeof observation>(resolve => { finishObservation = resolve })
    const observe = vi.spyOn(f.documents, 'observeFile').mockReturnValueOnce(pending)
    vi.spyOn(f.documents, 'closeWithDialog').mockResolvedValue(false)
    await vi.advanceTimersByTimeAsync(1000)
    expect(observe).toHaveBeenCalledTimes(1)
    expect(await f.session.close()).toBe(false)
    finishObservation(observation)
    await vi.advanceTimersByTimeAsync(1000)
    expect(observe).toHaveBeenCalledTimes(2)
  } finally { f?.session.dispose(); vi.useRealTimers(); vi.restoreAllMocks() }
})
