import { afterEach, expect, it, vi } from 'vitest'
import { DocumentAiTaskController } from '../../src/renderer/documentFiles/documentAiTaskController'
import type { LessonDocumentAiAPI, LessonDocumentAiResult } from '../../src/shared/lessonDocumentAiTask'
import type { LessonDocumentEditorHandle } from '../../src/renderer/documentFiles/LessonDocumentEditor'
const workspace = { version: 1 as const, kind: 'lesson' as const, lessonId: 'lesson', normalizedDirectory: '/lesson', conversationId: 'chat' }
const ref = { kind: 'lesson' as const, lessonId: 'lesson', lessonDirectory: '/lesson', relativePath: 'a.md' }
const version = { contentVersion: 'v1', attachments: [] }
afterEach(() => vi.useRealTimers())
function fixture() {
 const steps: string[] = []
 const unregister = vi.fn(), apply = vi.fn(async () => ({ status: 'conflict' as const, conflicts: [] })), invalidate = vi.fn(async () => {})
 const session = { ref, getSnapshot: () => ({ source: '原稿' }), prepareAiEdit: vi.fn(async (ranges, epoch) => { steps.push('prepare'); return { status: 'ready', document: { version }, ranges, epoch } }), registerAiTaskStop: vi.fn(() => unregister), applyAiEdit: apply, invalidatePreparedAiEdits: invalidate }
 const editor = { session, flush: async () => { steps.push('flush'); return true } } as unknown as LessonDocumentEditorHandle
 return { steps, editor, session, apply, invalidate, unregister }
}
it('flushes and prepares before native start, and applies to the pinned session after tab changes', async () => {
 vi.useFakeTimers()
 const f = fixture(), notify = vi.fn()
 const api = vi.fn<LessonDocumentAiAPI>(async request => {
  if (request.operation === 'start') { f.steps.push('start'); return { taskId: 'task', sessionId: 'native', status: 'running', message: '运行中' } }
  return { taskId: 'task', sessionId: 'native', status: 'candidate', message: '候选', apply: { baseVersion: version, epoch: 1, operationId: 'task', edits: [] } }
 })
 let current: LessonDocumentEditorHandle | null = f.editor
 const controller = new DocumentAiTaskController(api, workspace, notify)
 await controller.start({ name: 'a.md', getEditor: () => current }, 'codex', '改稿')
 current = null
 await vi.advanceTimersByTimeAsync(1000)
 expect(f.steps).toEqual(['flush', 'prepare', 'start'])
 expect(f.apply).toHaveBeenCalledTimes(1)
 expect(f.unregister).toHaveBeenCalledTimes(1)
})
it('Stop during native start invalidates prepared edits and cancels late task without applying', async () => {
 vi.useFakeTimers()
 const f = fixture()
 let resolveStart!: (result: LessonDocumentAiResult) => void
 const api = vi.fn<LessonDocumentAiAPI>(request => request.operation === 'start' ? new Promise(resolve => { resolveStart = resolve }) : Promise.resolve({ taskId: 'task', sessionId: 'native', status: 'stopped', message: '停止' }))
 const controller = new DocumentAiTaskController(api, workspace, vi.fn())
 const started = controller.start({ name: 'a.md', getEditor: () => f.editor }, 'codex', '改稿')
 await vi.waitFor(() => expect(resolveStart).toBeTypeOf('function'))
 await controller.stop()
 resolveStart({ taskId: 'task', sessionId: 'native', status: 'running', message: '运行中' }); await started
 await vi.advanceTimersByTimeAsync(5000)
 expect(api).toHaveBeenCalledWith({ operation: 'stop', workspace, taskId: 'task' })
 expect(f.invalidate).toHaveBeenCalled()
 expect(f.apply).not.toHaveBeenCalled()
})
it('failed native start releases the stop registration and prepared baseline', async () => {
 const f = fixture(), api = vi.fn<LessonDocumentAiAPI>(async () => { throw new Error('启动失败') })
 const controller = new DocumentAiTaskController(api, workspace, vi.fn())
 await expect(controller.start({ name: 'a.md', getEditor: () => f.editor }, 'codex', '改稿')).rejects.toThrow('启动失败')
 expect(f.unregister).toHaveBeenCalledTimes(1); expect(f.invalidate).toHaveBeenCalled()
})
it('reports the pinned file and actual saved version to the stage owner only after application', async () => {
 vi.useFakeTimers()
 const f = fixture(), savedVersion = { contentVersion: 'saved', attachments: [] }
 f.apply.mockResolvedValue({ status: 'applied', record: { id: 'task', ref, baseVersion: version, savedVersion, applied: [] }, conflicts: [] } as never)
 const api = vi.fn<LessonDocumentAiAPI>(async request => request.operation === 'start'
  ? { taskId: 'task', sessionId: 'native', status: 'running', message: '运行中' }
  : { taskId: 'task', sessionId: 'native', status: 'candidate', message: '候选', apply: { baseVersion: version, epoch: 1, operationId: 'task', edits: [] } })
 const onApplied = vi.fn(async () => {})
 await new DocumentAiTaskController(api, workspace, vi.fn()).start({ name: 'a.md', getEditor: () => f.editor }, 'codex', '改稿', onApplied)
 expect(onApplied).not.toHaveBeenCalled()
 await vi.advanceTimersByTimeAsync(1000)
 expect(onApplied).toHaveBeenCalledWith(ref, savedVersion)
})
it('starts a directory file edit without converting the ref into a lesson', async () => {
 vi.useFakeTimers()
 const fileRef = { kind: 'file' as const, path: '/ws/notes.md' }
 const f = fixture()
 f.session.ref = fileRef as never
 const api = vi.fn<LessonDocumentAiAPI>(async request => {
  if (request.operation === 'start') {
   expect(request.ref).toEqual(fileRef)
   expect(request.workspace).toMatchObject({ kind: 'directory' })
   return { taskId: 'task', sessionId: 'native', status: 'running', message: '运行中' }
  }
  return { taskId: 'task', sessionId: 'native', status: 'candidate', message: '候选', apply: { baseVersion: version, epoch: 1, operationId: 'task', edits: [] } }
 })
 const workspace = { version: 1 as const, kind: 'directory' as const, normalizedDirectory: '/ws', conversationId: 'chat' }
 await new DocumentAiTaskController(api, workspace, vi.fn()).start({ name: 'notes.md', getEditor: () => f.editor }, 'codex', '改目录稿')
 expect(api).toHaveBeenCalledWith(expect.objectContaining({ operation: 'start', ref: fileRef, workspace }))
})
it('keeps partial application suggestions without completing the stage repair', async () => {
 vi.useFakeTimers()
 const f = fixture(), notify = vi.fn(), onApplied = vi.fn(async () => {})
 f.apply.mockResolvedValue({ status: 'partial', record: { savedVersion: version }, conflicts: [{ before: '教师原稿', after: 'AI 建议' }] } as never)
 const api = vi.fn<LessonDocumentAiAPI>(async request => request.operation === 'start'
  ? { taskId: 'task', sessionId: 'native', status: 'running', message: '运行中' }
  : { taskId: 'task', sessionId: 'native', status: 'candidate', message: '候选', apply: { baseVersion: version, epoch: 1, operationId: 'task', edits: [] } })
 await new DocumentAiTaskController(api, workspace, notify).start({ name: 'a.md', getEditor: () => f.editor }, 'codex', '修稿', onApplied)
 await vi.advanceTimersByTimeAsync(1000)
 expect(f.apply).toHaveBeenCalledTimes(1)
 expect(notify).toHaveBeenCalledWith('已保存无冲突修改，1 处建议待处理')
 expect(onApplied).not.toHaveBeenCalled()
})
