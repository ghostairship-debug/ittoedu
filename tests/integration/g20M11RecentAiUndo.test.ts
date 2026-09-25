// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { documentHostRequestSchema } from '../../src/shared/workbench/desktop'
import { createLessonDocumentFiles } from '../../src/main/lessonDocumentFiles'
import { DocumentFileSession } from '../../src/renderer/documentFiles/documentFileSession'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import { createCourseStoreHost } from '../helpers/courseStoreHost'
import { createMarkdownTestHost } from '../helpers/markdownDocumentHost'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }) })

it('M11 guarded AI undo removes only the current AI History item and its resource bytes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-m11-ai-undo-'))
  roots.push(root)
  const { host, documents } = createMarkdownTestHost(path.join(root, 'journal'))
  const created = await documents.create({ kind: 'markdown', source: '初稿', resources: { assets: {}, components: {} } }, 'lesson.md')
  const edit = async (actor: 'agent' | 'human', source: string, operationId: string, withResource = false) => {
    const before = await documents.read(created.documentId)
    const result = await host.internalAPI.dispatch({ documentId: created.documentId, epoch: before.epoch,
      baseRevision: before.revision, actor, operationId, mutation: { type: 'command', command: {
        type: 'markdown.replace', source, ...(withResource ? { resources: { assets: { picture: Uint8Array.of(1, 2, 3) }, components: {} } } : {}),
      } } })
    expect(result.status).toBe('applied')
  }
  await edit('agent', 'AI A', 'ai-a')
  await edit('human', '人工 B', 'human-b')
  await edit('agent', 'AI C', 'ai-c', true)
  const latest = await documents.read(created.documentId)
  expect(latest.undoHead).toEqual({ operationId: 'ai-c', actor: 'agent' })
  const request = { type: 'dispatch' as const, operation: { documentId: created.documentId, epoch: latest.epoch,
    baseRevision: latest.revision, actor: 'human' as const, operationId: 'undo-ai-c',
    mutation: { type: 'undo' as const, expectedTopOperationId: 'ai-c' } } }
  expect(documentHostRequestSchema.safeParse(request).success).toBe(true)
  expect((await documents.dispatch(request.operation)).status).toBe('applied')
  const undone = await documents.read(created.documentId)
  expect(undone.model).toMatchObject({ kind: 'markdown', source: '人工 B', resources: { assets: {} } })
  expect(undone.undoHead).toEqual({ operationId: 'human-b', actor: 'human' })
  const rejected = await documents.dispatch({ documentId: created.documentId, epoch: undone.epoch,
    baseRevision: undone.revision, actor: 'human', operationId: 'cannot-skip-human',
    mutation: { type: 'undo', expectedTopOperationId: 'ai-a' } })
  expect(rejected).toMatchObject({ status: 'conflict', code: 'history-head-changed', applied: false })
  expect(await documents.read(created.documentId)).toMatchObject({ revision: undone.revision, undoDepth: undone.undoDepth, model: undone.model })
  expect((await documents.dispatch({ documentId: created.documentId, epoch: undone.epoch,
    baseRevision: undone.revision, actor: 'human', operationId: 'redo-ai-c', mutation: { type: 'redo' } })).status).toBe('applied')
  const redone = await documents.read(created.documentId)
  expect(redone.model).toMatchObject({ kind: 'markdown', source: 'AI C', resources: { assets: { picture: Uint8Array.of(1, 2, 3) } } })
})

it('M11 Markdown drains a newer human draft before deciding whether recent AI can be undone', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-m11-ai-draft-'))
  roots.push(root)
  const filename = path.join(root, 'lesson.md')
  await fs.writeFile(filename, '初稿')
  const { host, documents } = createMarkdownTestHost(path.join(root, 'journal'))
  const opened = await documents.open(filename)
  const files = createLessonDocumentFiles({ documents, recoveryDirectory: path.join(root, 'metadata'), validateTarget: async () => {} })
  const session = new DocumentFileSession({ kind: 'file', path: filename }, { ...files, documents }, opened.documentId)
  try {
    await session.open()
    const before = await documents.read(opened.documentId)
    expect((await host.internalAPI.dispatch({ documentId: opened.documentId, epoch: before.epoch,
      baseRevision: before.revision, actor: 'agent', operationId: 'ai-edit',
      mutation: { type: 'command', command: { type: 'markdown.replace', source: 'AI 改稿' } } })).status).toBe('applied')
    await session.drain()
    expect((await documents.read(opened.documentId)).undoHead?.actor).toBe('agent')
    session.edit('人工后续改稿')
    await session.undoLatestAgent()
    const actual = await documents.read(opened.documentId)
    expect(actual.model).toMatchObject({ kind: 'markdown', source: '人工后续改稿' })
    expect(actual.undoHead?.actor).toBe('human')
    expect(session.getSnapshot().error).toContain('最近一次操作不是 AI 修改')
  } finally { session.dispose() }
})

it('M11 Markdown rebases typing during a pending AI undo without reviving an AI image', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-m11-pending-typing-'))
  roots.push(root)
  const filename = path.join(root, 'lesson.md')
  await fs.writeFile(filename, '初稿')
  const { host, documents } = createMarkdownTestHost(path.join(root, 'journal'))
  const opened = await documents.open(filename)
  const files = createLessonDocumentFiles({ documents, recoveryDirectory: path.join(root, 'metadata'), validateTarget: async () => {} })
  let undoStarted!: () => void
  let releaseUndo!: () => void
  const started = new Promise<void>(resolve => { undoStarted = resolve })
  const gate = new Promise<void>(resolve => { releaseUndo = resolve })
  const guarded = { ...documents, dispatch: async (operation: Parameters<typeof host.internalAPI.dispatch>[0]) => {
    if (operation.mutation.type === 'undo') { undoStarted(); await gate }
    return host.internalAPI.dispatch(operation)
  } }
  const session = new DocumentFileSession({ kind: 'file', path: filename }, { ...files, documents: guarded }, opened.documentId)
  try {
    await session.open()
    const before = await documents.read(opened.documentId)
    expect((await host.internalAPI.dispatch({ documentId: opened.documentId, epoch: before.epoch,
      baseRevision: before.revision, actor: 'agent', operationId: 'ai-edit',
      mutation: { type: 'command', command: { type: 'markdown.replace', source: '初稿\n![AI 图](assets/ai.png)',
        resources: { assets: { 'assets/ai.png': Uint8Array.of(1, 2, 3) }, components: {} } } } })).status).toBe('applied')
    await session.drain()
    const undo = session.undoLatestAgent()
    await started
    session.edit('初稿\n![AI 图](assets/ai.png)\n教师追加')
    expect(session.getSnapshot().source).toContain('教师追加')
    releaseUndo()
    await undo
    expect(await session.drain()).toBe(true)
    expect((await documents.read(opened.documentId)).model).toMatchObject({ kind: 'markdown', source: '初稿\n教师追加', resources: { assets: {} } })
    expect(session.getSnapshot().source).toBe('初稿\n教师追加')
    await expect(session.readResource('assets/ai.png')).rejects.toThrow('当前文档未包含该素材')
    expect(session.getSnapshot().error).toBeNull()
  } finally { releaseUndo(); session.dispose() }
})

it('M11 a stale guarded undo leaves no pending History item and permits a later normal undo', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-m11-stale-history-'))
  roots.push(root)
  const filename = path.join(root, 'lesson.md')
  await fs.writeFile(filename, '初稿')
  const { host, documents } = createMarkdownTestHost(path.join(root, 'journal'))
  const opened = await documents.open(filename)
  const files = createLessonDocumentFiles({ documents, recoveryDirectory: path.join(root, 'metadata'), validateTarget: async () => {} })
  let interrupted = false
  let undoReceipt: Awaited<ReturnType<typeof documents.dispatch>> | undefined
  const guarded = { ...documents, dispatch: async (operation: Parameters<typeof host.internalAPI.dispatch>[0]) => {
    if (operation.mutation.type === 'undo' && !interrupted) {
      interrupted = true
      const live = await documents.read(opened.documentId)
      expect((await host.internalAPI.dispatch({ documentId: opened.documentId, epoch: live.epoch,
        baseRevision: live.revision, actor: 'human', operationId: 'concurrent-human',
        mutation: { type: 'command', command: { type: 'markdown.replace', source: '正式人工后续' } } })).status).toBe('applied')
    }
    const receipt = await host.internalAPI.dispatch(operation)
    if (operation.mutation.type === 'undo') undoReceipt = receipt
    return receipt
  } }
  const session = new DocumentFileSession({ kind: 'file', path: filename }, { ...files, documents: guarded }, opened.documentId)
  try {
    await session.open()
    const before = await documents.read(opened.documentId)
    expect((await host.internalAPI.dispatch({ documentId: opened.documentId, epoch: before.epoch,
      baseRevision: before.revision, actor: 'agent', operationId: 'ai-edit',
      mutation: { type: 'command', command: { type: 'markdown.replace', source: 'AI 改稿' } } })).status).toBe('applied')
    await session.drain()
    await session.undoLatestAgent()
    expect((await documents.read(opened.documentId)).model).toMatchObject({ kind: 'markdown', source: '正式人工后续' })
    expect(undoReceipt).toMatchObject({ status: 'conflict', code: 'stale-revision', applied: false })
    expect(await session.drain()).toBe(true)
    await session.undo()
    expect((await documents.read(opened.documentId)).model).toMatchObject({ kind: 'markdown', source: 'AI 改稿' })
  } finally { session.dispose() }
})

it('M11 typing during a rejected undo stays visible until the teacher edits again', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-m11-rejected-typing-'))
  roots.push(root)
  const filename = path.join(root, 'lesson.md')
  await fs.writeFile(filename, '初稿')
  const { host, documents } = createMarkdownTestHost(path.join(root, 'journal'))
  const opened = await documents.open(filename)
  const files = createLessonDocumentFiles({ documents, recoveryDirectory: path.join(root, 'metadata'), validateTarget: async () => {} })
  let undoStarted!: () => void
  let releaseUndo!: () => void
  const started = new Promise<void>(resolve => { undoStarted = resolve })
  const gate = new Promise<void>(resolve => { releaseUndo = resolve })
  const guarded = { ...documents, dispatch: async (operation: Parameters<typeof documents.dispatch>[0]) => {
    if (operation.mutation.type === 'undo') { undoStarted(); await gate }
    return documents.dispatch(operation)
  } }
  const session = new DocumentFileSession({ kind: 'file', path: filename }, { ...files, documents: guarded }, opened.documentId)
  try {
    await session.open()
    const before = await documents.read(opened.documentId)
    expect((await documents.dispatch({ documentId: opened.documentId, epoch: before.epoch,
      baseRevision: before.revision, actor: 'agent', operationId: 'ai-edit',
      mutation: { type: 'command', command: { type: 'markdown.replace', source: 'AI 改稿' } } })).status).toBe('applied')
    await session.drain()
    const undo = session.undoLatestAgent()
    await started
    session.edit('人工在途草稿')
    const concurrent = await documents.read(opened.documentId)
    expect((await documents.dispatch({ documentId: opened.documentId, epoch: concurrent.epoch,
      baseRevision: concurrent.revision, actor: 'human', operationId: 'human-concurrent',
      mutation: { type: 'command', command: { type: 'markdown.replace', source: '另一处正式改动' } } })).status).toBe('applied')
    releaseUndo()
    await undo
    expect(session.getSnapshot().source).toBe('人工在途草稿')
    expect(await session.drain()).toBe(false)
    expect((await documents.read(opened.documentId)).model).toMatchObject({ kind: 'markdown', source: '另一处正式改动' })
    session.edit('人工决定继续写')
    expect(await session.drain()).toBe(true)
    expect((await documents.read(opened.documentId)).model).toMatchObject({ kind: 'markdown', source: '人工决定继续写' })
  } finally { releaseUndo(); session.dispose() }
})

it('M11 concurrent button clicks issue one guarded undo and a stale receipt cannot strand History', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-m11-double-undo-'))
  roots.push(root)
  const filename = path.join(root, 'lesson.md')
  await fs.writeFile(filename, '初稿')
  const { documents } = createMarkdownTestHost(path.join(root, 'journal'))
  const opened = await documents.open(filename)
  const files = createLessonDocumentFiles({ documents, recoveryDirectory: path.join(root, 'metadata'), validateTarget: async () => {} })
  let undoStarted!: () => void
  let releaseUndo!: () => void
  const started = new Promise<void>(resolve => { undoStarted = resolve })
  const gate = new Promise<void>(resolve => { releaseUndo = resolve })
  let undoCalls = 0
  const guarded = { ...documents, dispatch: async (operation: Parameters<typeof documents.dispatch>[0]) => {
    if (operation.mutation.type === 'undo') { undoCalls++; undoStarted(); await gate }
    return documents.dispatch(operation)
  } }
  const session = new DocumentFileSession({ kind: 'file', path: filename }, { ...files, documents: guarded }, opened.documentId)
  try {
    await session.open()
    const before = await documents.read(opened.documentId)
    expect((await documents.dispatch({ documentId: opened.documentId, epoch: before.epoch,
      baseRevision: before.revision, actor: 'agent', operationId: 'ai-edit',
      mutation: { type: 'command', command: { type: 'markdown.replace', source: 'AI 改稿' } } })).status).toBe('applied')
    await session.drain()
    const first = session.undoLatestAgent(), second = session.undoLatestAgent()
    await started
    const concurrent = await documents.read(opened.documentId)
    expect((await documents.dispatch({ documentId: opened.documentId, epoch: concurrent.epoch,
      baseRevision: concurrent.revision, actor: 'human', operationId: 'human-concurrent',
      mutation: { type: 'command', command: { type: 'markdown.replace', source: '正式人工改动' } } })).status).toBe('applied')
    releaseUndo()
    await Promise.all([first, second])
    expect(undoCalls).toBe(1)
    expect(await session.drain()).toBe(true)
    await session.undo()
    expect((await documents.read(opened.documentId)).model).toMatchObject({ kind: 'markdown', source: 'AI 改稿' })
  } finally { releaseUndo(); session.dispose() }
})

it('M11 an overlapping edit during undo remains a visible draft without restoring removed image bytes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-m11-overlap-undo-'))
  roots.push(root)
  const filename = path.join(root, 'lesson.md')
  await fs.writeFile(filename, '初稿')
  const { documents } = createMarkdownTestHost(path.join(root, 'journal'))
  const opened = await documents.open(filename)
  const files = createLessonDocumentFiles({ documents, recoveryDirectory: path.join(root, 'metadata'), validateTarget: async () => {} })
  let undoStarted!: () => void
  let releaseUndo!: () => void
  const started = new Promise<void>(resolve => { undoStarted = resolve })
  const gate = new Promise<void>(resolve => { releaseUndo = resolve })
  const guarded = { ...documents, dispatch: async (operation: Parameters<typeof documents.dispatch>[0]) => {
    if (operation.mutation.type === 'undo') { undoStarted(); await gate }
    return documents.dispatch(operation)
  } }
  const session = new DocumentFileSession({ kind: 'file', path: filename }, { ...files, documents: guarded }, opened.documentId)
  try {
    await session.open()
    const before = await documents.read(opened.documentId)
    expect((await documents.dispatch({ documentId: opened.documentId, epoch: before.epoch,
      baseRevision: before.revision, actor: 'agent', operationId: 'ai-image',
      mutation: { type: 'command', command: { type: 'markdown.replace', source: '初稿\n![AI 图](assets/ai.png)',
        resources: { assets: { 'assets/ai.png': Uint8Array.of(1, 2, 3) }, components: {} } } } })).status).toBe('applied')
    await session.drain()
    const undo = session.undoLatestAgent()
    await started
    session.edit('初稿\n![教师改图](assets/ai.png)')
    releaseUndo()
    await undo
    expect(session.getSnapshot().source).toBe('初稿\n![教师改图](assets/ai.png)')
    expect(session.getSnapshot().error).toContain('重叠')
    expect(await session.drain()).toBe(false)
    const actual = await documents.read(opened.documentId)
    expect(actual.model).toMatchObject({ kind: 'markdown', source: '初稿', resources: { assets: {} } })
    await expect(session.readResource('assets/ai.png')).rejects.toThrow('当前文档未包含该素材')
    session.edit('初稿\n![教师再次改图](assets/ai.png)')
    expect(await session.drain()).toBe(false)
    expect((await documents.read(opened.documentId)).model).toMatchObject({ kind: 'markdown', source: '初稿', resources: { assets: {} } })
    session.edit('初稿\n教师保留自己的说明')
    expect(await session.drain()).toBe(true)
    expect((await documents.read(opened.documentId)).model).toMatchObject({ kind: 'markdown', source: '初稿\n教师保留自己的说明', resources: { assets: {} } })
  } finally { releaseUndo(); session.dispose() }
})

it('M11 typing during the undo preflight becomes a human edit before the AI-head decision', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-m11-preflight-typing-'))
  roots.push(root)
  const filename = path.join(root, 'lesson.md')
  await fs.writeFile(filename, '初稿')
  const { documents } = createMarkdownTestHost(path.join(root, 'journal'))
  const opened = await documents.open(filename)
  const files = createLessonDocumentFiles({ documents, recoveryDirectory: path.join(root, 'metadata'), validateTarget: async () => {} })
  let readStarted!: () => void
  let releaseRead!: () => void
  const started = new Promise<void>(resolve => { readStarted = resolve })
  const gate = new Promise<void>(resolve => { releaseRead = resolve })
  let blockRead = false, undoCalls = 0
  const guarded = { ...documents, read: async (id: string) => {
    if (blockRead) { blockRead = false; readStarted(); await gate }
    return documents.read(id)
  }, dispatch: async (operation: Parameters<typeof documents.dispatch>[0]) => {
    if (operation.mutation.type === 'undo') undoCalls++
    return documents.dispatch(operation)
  } }
  const session = new DocumentFileSession({ kind: 'file', path: filename }, { ...files, documents: guarded }, opened.documentId)
  try {
    await session.open()
    const before = await documents.read(opened.documentId)
    expect((await documents.dispatch({ documentId: opened.documentId, epoch: before.epoch,
      baseRevision: before.revision, actor: 'agent', operationId: 'ai-edit',
      mutation: { type: 'command', command: { type: 'markdown.replace', source: 'AI 改稿' } } })).status).toBe('applied')
    await session.drain()
    blockRead = true
    const undo = session.undoLatestAgent()
    await started
    session.edit('AI 改稿\n教师续写')
    releaseRead()
    await undo
    expect(undoCalls).toBe(0)
    expect(await session.drain()).toBe(true)
    const actual = await documents.read(opened.documentId)
    expect(actual.model).toMatchObject({ kind: 'markdown', source: 'AI 改稿\n教师续写' })
    expect(actual.undoHead?.actor).toBe('human')
  } finally { releaseRead(); session.dispose() }
})

it('M11 course button action uses the existing Bridge History and refuses to skip a later human edit', async () => {
  const h = await createCourseStoreHost()
  const initial = await h.open(createBlankCourseProject({ includeDefaultController: false, controls: 'none' }))
  const id = initial.documentId
  const store = () => useEditorStore.getState()
  const title = () => {
    const snapshot = h.registry.get(id).read()
    if (snapshot.model.kind !== 'course-v9') throw new Error('Course fixture required')
    return snapshot.model.project.title
  }
  const aiTitle = async (value: string, operationId: string) => {
    const before = h.registry.get(id).read()
    if (before.model.kind !== 'course-v9') throw new Error('Course fixture required')
    expect((await h.api.dispatch({ documentId: id, epoch: before.epoch, baseRevision: before.revision,
      actor: 'agent', operationId, mutation: { type: 'command', command: {
        type: 'course.replace', project: { ...before.model.project, title: value }, resources: before.model.resources,
      } } })).status).toBe('applied')
  }
  await aiTitle('AI A', 'course-ai-a')
  store().renameProject('人工 B'); await store().drainCourseDocument()
  await aiTitle('AI C', 'course-ai-c')
  await vi.waitFor(() => expect(store().courseDocument.snapshot?.undoHead).toEqual({ operationId: 'course-ai-c', actor: 'agent' }))
  expect(await store().undoLatestAgentCourseDocument()).toBe(true)
  expect(title()).toBe('人工 B')
  store().redo(); await vi.waitFor(() => expect(title()).toBe('AI C'))
  store().renameProject('人工 D'); await store().drainCourseDocument()
  const beforeRefusal = h.registry.get(id).read()
  await expect(store().undoLatestAgentCourseDocument()).rejects.toThrow('最近一次操作不是 AI 修改')
  expect(h.registry.get(id).read()).toMatchObject({ revision: beforeRefusal.revision, undoDepth: beforeRefusal.undoDepth, model: beforeRefusal.model })
  store().undo(); await vi.waitFor(() => expect(title()).toBe('AI C'))
  expect(await store().undoLatestAgentCourseDocument()).toBe(true)
  expect(title()).toBe('人工 B')
})
