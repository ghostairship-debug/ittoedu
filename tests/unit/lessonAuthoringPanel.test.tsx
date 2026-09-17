import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { LessonAuthoringPanel } from '../../src/renderer/lessonAuthoring/LessonAuthoringPanel'
import type { LessonAuthoringDesktopResult } from '../../src/shared/lessonAuthoringDesktop'
afterEach(cleanup)
it('does not apply an old lesson after switching lessons while document flush awaits', async () => {
 const lesson = { schemaVersion: 1 as const, lessonId: 'a', normalizedDirectory: 'c:/a' }
 const state = { schemaVersion: 1 as const, lessonId: 'a', mode: 'automatic' as const, epoch: 1, controlEpoch: 0, documents: {}, materials: [] }
 const ticket = { schemaVersion: 1 as const, id: 'ticket', lesson, epoch: 1, controlEpoch: 0, stage: 'build' as const, mode: 'automatic' as const, inputs: [], materials: [] }
 const value: LessonAuthoringDesktopResult = { view: { state, currentStage: 'build', documents: [], issues: [] }, assembly: { ticket, modulePath: 'build.mjs', moduleSource: '', documents: { teachingPlan: { path: '', content: '' }, presentationScript: { path: '', content: '' } } } }
 const operate = vi.fn(async (request: { lesson: { lessonId: string } }) => request.lesson.lessonId === 'a' ? value : { view: value.view })
 let release!: (result: boolean) => void
 const flushDocuments = vi.fn(() => new Promise<boolean>(resolve => { release = resolve })), assemble = vi.fn(async () => '')
 const props = { lesson, conversationId: 'conversation', adapter: 'codex' as const, operate, materialSelections: [], flushDocuments, openDocument() {}, assemble }
 const ui = render(<LessonAuthoringPanel {...props} />)
 await waitFor(() => expect(flushDocuments).toHaveBeenCalledOnce())
 ui.rerender(<LessonAuthoringPanel {...props} lesson={{ ...lesson, lessonId: 'b', normalizedDirectory: 'c:/b' }} />)
 await act(async () => release(true))
 expect(assemble).not.toHaveBeenCalled()
})
it('saves and continues a partially committed project without repairing or reapplying its module', async () => {
 const lesson = { schemaVersion: 1 as const, lessonId: 'lesson', normalizedDirectory: 'c:/lesson' }
 const value: LessonAuthoringDesktopResult = { view: { state: { schemaVersion: 1, lessonId: 'lesson', mode: 'automatic', epoch: 1, controlEpoch: 0, documents: {}, materials: [] }, currentStage: 'build', documents: [], issues: [] }, run: { ticketId: 'ticket', stage: 'build', sessionId: 'native', status: 'ready-to-build', message: '已保留当前成果' }, application: 'has-changes', failure: { committedStepCount: 2, target: { projectId: 'actual-project', revision: 3, generation: 4 }, message: '实际失败' } }
 const operate = vi.fn(async () => value), assemble = vi.fn(async () => ''), continueProjectEditing = vi.fn(async () => {})
 render(<LessonAuthoringPanel lesson={lesson} conversationId="conversation" adapter="codex" operate={operate} materialSelections={[]} flushDocuments={async () => true} openDocument={() => {}} assemble={assemble} continueProjectEditing={continueProjectEditing} />)
 fireEvent.click(await screen.findByText('保存并继续编辑当前课件'))
 await waitFor(() => expect(continueProjectEditing).toHaveBeenCalledWith('actual-project'))
 expect(assemble).not.toHaveBeenCalled()
 expect(operate.mock.calls.every(call => (call as unknown as [{ operation: string }])[0].operation === 'read')).toBe(true)
 expect(value.run!.status).toBe('ready-to-build')
 expect(screen.queryByText('请助手修复当前构建')).toBeNull()
})
it('refreshes an asynchronous document repair independently of the previous completed native build task', async () => {
 const lesson = { schemaVersion: 1 as const, lessonId: 'lesson', normalizedDirectory: 'c:/lesson' }
 const state = { schemaVersion: 1 as const, lessonId: 'lesson', mode: 'automatic' as const, epoch: 1, controlEpoch: 0, documents: {}, materials: [] }
 const ticket = { schemaVersion: 1 as const, id: 'repair', lesson, epoch: 1, controlEpoch: 0, stage: 'teaching-brief' as const, mode: 'automatic' as const, inputs: [], materials: [] }
 const run = { ticketId: 'build', stage: 'build' as const, sessionId: 'native-build', status: 'ready-to-build' as const, message: '正在修复教学简报' }
 let reads = 0
 const operate = vi.fn(async (): Promise<LessonAuthoringDesktopResult> => ++reads === 1
  ? { view: { state, currentStage: 'teaching-brief', documents: [], issues: [] }, run, repairTicket: ticket }
  : { view: { state, currentStage: 'teaching-plan', documents: [], issues: [] }, run })
 render(<LessonAuthoringPanel lesson={lesson} conversationId="conversation" adapter="codex" operate={operate} materialSelections={[]} flushDocuments={async () => true} openDocument={() => {}} assemble={async () => ''} />)
 await screen.findByText('当前阶段：教学简报')
 await screen.findByText('当前阶段：教学策划', {}, { timeout: 3000 })
 expect(operate.mock.calls.length).toBe(2)
})
it('starts a real automatic run with a default instruction when the goal is left empty', async () => {
 const lesson = { schemaVersion: 1 as const, lessonId: 'lesson', normalizedDirectory: 'c:/lesson' }
 const state = { schemaVersion: 1 as const, lessonId: 'lesson', mode: 'automatic' as const, epoch: 1, controlEpoch: 0, documents: {}, materials: [{ id: 'material', extractionVersion: 'v', sourceVersion: 's', fragmentIds: ['body'] }] }
 const empty: LessonAuthoringDesktopResult = { view: { state: { ...state, mode: 'manual' }, currentStage: 'teaching-brief', documents: [], issues: [] } }
 const running: LessonAuthoringDesktopResult = { view: { state, currentStage: 'teaching-brief', documents: [], issues: [] }, run: { ticketId: 'ticket', stage: 'teaching-brief', sessionId: 'native', status: 'running', message: '已开始' } }
 const operate = vi.fn(async (request: { operation: string }): Promise<LessonAuthoringDesktopResult> => request.operation === 'set-mode' ? { view: { ...empty.view, state } } : request.operation === 'start' ? running : { view: { state, currentStage: 'teaching-brief', documents: [], issues: [] } })
 const flushDocuments = vi.fn(async () => true)
 render(<LessonAuthoringPanel lesson={lesson} conversationId="conversation" adapter="codex" operate={operate} materialSelections={state.materials} flushDocuments={flushDocuments} openDocument={() => {}} assemble={async () => ''} />)
 fireEvent.click(await screen.findByRole('button', { name: '自动模式（按材料）' }))
 await screen.findByText(/自动模式已就绪/)
 fireEvent.click(screen.getByRole('button', { name: '开始自动创作' }))
 await waitFor(() => expect(operate.mock.calls.some(call => (call as unknown as [{ operation: string }])[0].operation === 'start')).toBe(true))
 const startCall = operate.mock.calls.map(call => (call as unknown as [{ operation: string; instruction: string }])[0]).find(request => request.operation === 'start')!
 expect(startCall.instruction.trim().length).toBeGreaterThan(0)
 expect(flushDocuments).toHaveBeenCalled()
})
