// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ app: {}, session: {} }))
import { LessonAuthoringDesktopService } from '../../src/main/lessonAuthoringDesktopService'
import { LessonAuthoring } from '../../src/main/lessonAuthoring'
import { LessonWorkspaceService } from '../../src/main/lessonWorkspace'
import { LessonMaterials } from '../../src/main/lessonMaterials'
import { createBlankCourseProject } from '../../src/renderer/project/createCourseProject'
import { createCourseProjectArchive } from '../../src/renderer/project/courseProjectArchive'
import { createLessonDocumentFiles } from '../../src/main/lessonDocumentFiles'
import type { LocalAgentRecord, LocalAgentRequest, LocalAgentResponse } from '../../src/shared/localAgentContract'
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) { if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe test root'); await fs.rm(root, { recursive: true, force: true, ...(process.platform === 'win32' ? { maxRetries: 8, retryDelay: 100 } : {}) }) } }, 30_000)
async function fixture(options: { invalidFirstCandidate?: boolean } = {}) {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'authoring-stage-')); roots.push(root)
 const workspace = new LessonWorkspaceService(root), lesson = (await workspace.create(root, '课例')).identity
 const files = createLessonDocumentFiles({ recoveryDirectory: path.join(root, 'recovery'), validateTarget: async () => { await workspace.read(lesson) } })
 const materials = new LessonMaterials(async () => { await workspace.read(lesson) }), authoring = new LessonAuthoring({ workspace, files, materials })
 const records = new Map<string, LocalAgentRecord>(), prompts: string[] = [], requests: LocalAgentRequest[] = []
 const agent = async (input: LocalAgentRequest): Promise<LocalAgentResponse> => {
  requests.push(input)
  if (input.operation === 'lesson-start' || input.operation === 'lesson-resume') {
   prompts.push(input.prompt); const filename = input.prompt.match(/绝对路径：([^\n]+?)。/)![1]!
   const invalid = options.invalidFirstCandidate && input.operation === 'lesson-start' && prompts.length === 1
   await fs.writeFile(filename, filename.endsWith('.mjs') ? 'export const apiVersion = 2; export default async function({api}) { const session = await api.createCourseProject({surfaceType:"slide",title:"电路"}); return session.finish(); }' : invalid ? '- 上层\n  - 下层\n' : `# 阶段实际文档 ${prompts.length}\n先解释知识形成，再让学生操作验证。`)
   const sessionId = randomUUID(); records.set(sessionId, { version: 1, id: sessionId, adapter: input.operation === 'lesson-start' ? input.adapter : 'codex', workspace: input.workspace, status: 'completed', events: [] })
   return { enabled: true, sessionId }
  }
  if (input.operation === 'lesson-read') return { enabled: true, records: records.has(input.sessionId) ? [records.get(input.sessionId)!] : [] }
  if (input.operation === 'lesson-cancel') return { enabled: true }
  throw new Error('Unexpected native request')
 }
 const service = new LessonAuthoringDesktopService({ userData: root, editorRoot: path.resolve('.'), workspace, files, authoring, agent })
 return { root, workspace, lesson, files, materials, authoring, service, prompts, requests, context: { lesson, conversationId: randomUUID() } }
}
describe('integrated product authoring stages', { timeout: 20_000 }, () => {
 it('saves manual stage output through the real file owner and stops for its current confirmation', async () => {
  const f = await fixture()
  await f.service.operate({ operation: 'start', ...f.context, adapter: 'codex', instruction: '初中串并联电路' })
  const result = await f.service.operate({ operation: 'poll', ...f.context })
  expect(result.run?.status).toBe('waiting-confirmation'); expect(result.view.currentStage).toBe('teaching-brief')
  const document = result.view.documents[0]!; expect(document.status).toBe('draft')
  expect(await fs.readFile(path.join(f.lesson.normalizedDirectory, document.relativePath), 'utf8')).toContain('阶段实际文档')
  const confirmed = await f.service.operate({ operation: 'confirm', ...f.context, role: document.role, expectedVersion: document.version })
  expect(confirmed.view.currentStage).toBe('teaching-plan'); expect(f.prompts).toHaveLength(1)
 })
 it('automatically consumes real material and produces all four files before returning a guarded build module', async () => {
  const f = await fixture(), target = { lessonId: f.lesson.lessonId, rootPath: f.lesson.normalizedDirectory }
  const material = await f.materials.import(target, { title: '教材', original: new TextEncoder().encode('回路'), extraction: { version: 1, extractorVersion: 'test', format: 'text', fragments: [{ id: 'text', kind: 'text', text: '形成闭合回路', locator: { part: '正文' } }], assets: [], gaps: [] } })
  await f.service.operate({ operation: 'set-mode', ...f.context, mode: 'automatic', materials: [{ id: material.id, extractionVersion: material.extractionVersion, fragmentIds: ['text'] }] })
  await f.service.operate({ operation: 'start', ...f.context, adapter: 'codex', instruction: '初中电路' })
  let result = await f.service.operate({ operation: 'poll', ...f.context })
  for (let index = 0; index < 4; index++) result = await f.service.operate({ operation: 'poll', ...f.context })
  expect(result.run?.status).toBe('ready-to-build'); expect(result.view.documents).toHaveLength(4); expect(f.prompts).toHaveLength(5)
  expect(result.assembly?.moduleSource).toContain('apiVersion = 2'); expect(result.assembly?.documents.teachingPlan.content).toContain('实际文档')
  const ticketId = result.assembly!.ticket.id
  const applying = await f.service.operate({ operation: 'begin-application', ...f.context, ticketId })
  expect(applying.application).toBe('applying')
  const restarted = new LessonAuthoringDesktopService({ userData: f.root, editorRoot: path.resolve('.'), workspace: f.workspace, files: f.files, authoring: f.authoring, agent: async () => { throw new Error('Restart must not invoke native model') } })
  const recovered = await restarted.operate({ operation: 'read', ...f.context })
  expect(recovered.application).toBe('applying'); expect(recovered.assembly).toBeUndefined()
  expect((await f.service.operate({ operation: 'read', ...f.context })).assembly).toBeUndefined()
  await expect(f.service.operate({ operation: 'begin-application', ...f.context, ticketId })).rejects.toThrow('已经开始')
  await f.service.operate({ operation: 'fail-application', ...f.context, ticketId, hasCommittedChanges: false })
  const retry = await f.service.operate({ operation: 'begin-application', ...f.context, ticketId })
  expect(retry.assembly!.ticket.id).toBe(ticketId); expect(f.prompts).toHaveLength(5)
  await f.service.operate({ operation: 'fail-application', ...f.context, ticketId, hasCommittedChanges: true })
  expect((await f.service.operate({ operation: 'read', ...f.context })).assembly).toBeUndefined()
  const failedTarget = { projectId: randomUUID(), revision: 1, generation: 2 }
  await f.service.operate({ operation: 'fail-application', ...f.context, ticketId, hasCommittedChanges: true, failure: { target: failedTarget, committedStepCount: 0 } })
  const continuation = await f.service.operate({ operation: 'continue-application', ...f.context, ticketId })
  expect(continuation.assembly!.resumeTarget).toEqual(failedTarget); expect(f.prompts).toHaveLength(5)
  await f.service.operate({ operation: 'fail-application', ...f.context, ticketId, hasCommittedChanges: true, failure: { target: { ...failedTarget, revision: 2 }, committedStepCount: 1 } })
  await expect(f.service.operate({ operation: 'continue-application', ...f.context, ticketId })).rejects.toThrow('已有构建写入')
  await expect(f.service.operate({ operation: 'start', ...f.context, adapter: 'codex', instruction: '重试' })).rejects.toThrow('已有构建')
  const ref = result.view.documents[0]!; await fs.writeFile(path.join(f.lesson.normalizedDirectory, ref.relativePath), '# 教师改变简报')
  expect((await f.service.operate({ operation: 'validate', ...f.context, ticket: result.assembly!.ticket })).validation?.allowed).toBe(false)
 })
})

it('repairs current stages against prior inputs before reusing unchanged module source without another native turn', async () => {
 const f = await fixture(), target = { lessonId: f.lesson.lessonId, rootPath: f.lesson.normalizedDirectory }
 const material = await f.materials.import(target, { title: '教材', original: new TextEncoder().encode('回路'), extraction: { version: 1, extractorVersion: 'test', format: 'text', fragments: [{ id: 'text', kind: 'text', text: '闭合回路', locator: { part: '正文' } }], assets: [], gaps: [] } })
 await f.service.operate({ operation: 'set-mode', ...f.context, mode: 'automatic', materials: [{ id: material.id, extractionVersion: material.extractionVersion, fragmentIds: ['text'] }] })
 await f.service.operate({ operation: 'start', ...f.context, adapter: 'codex', instruction: '电路' })
 let ready = await f.service.operate({ operation: 'poll', ...f.context })
 for (let i = 0; i < 4; i++) ready = await f.service.operate({ operation: 'poll', ...f.context })
 const original = ready.assembly!
 const empty = createBlankCourseProject({ title: 'Existing empty', includeDefaultController: false, controls: 'none' })
 const emptyPath = path.join(f.lesson.normalizedDirectory, 'empty.h5lesson')
 await fs.writeFile(emptyPath, createCourseProjectArchive({ project: empty, assetFiles: {}, componentFiles: {} }))
 await f.workspace.bindProject(f.lesson, emptyPath)
 await f.service.operate({ operation: 'begin-application', ...f.context, ticketId: original.ticket.id })
 const failure = { target: { projectId: empty.id, revision: empty.revision, generation: 3 }, committedStepCount: 0 }
 await f.service.operate({ operation: 'fail-application', ...f.context, ticketId: original.ticket.id, hasCommittedChanges: true, failure })
 await fs.writeFile(path.join(f.lesson.normalizedDirectory, 'teaching-brief.md'), '# 修订简报\n原知识内容保留。')
 const stale = await f.service.operate({ operation: 'read', ...f.context })
 expect(stale.assembly).toBeUndefined(); expect(stale.view.currentStage).toBe('teaching-brief')
 await expect(f.service.operate({ operation: 'reprepare-existing-build', ...f.context })).rejects.toThrow()
 const cancelled = await f.service.operate({ operation: 'begin-document-repair', ...f.context, role: 'teaching-brief' })
 await f.service.operate({ operation: 'cancel-document-repair', ...f.context, ticketId: cancelled.repairTicket!.id })
 expect((await f.service.operate({ operation: 'read', ...f.context })).repairTicket).toBeUndefined()
 expect(f.prompts).toHaveLength(5)
 for (const doc of ready.view.documents) {
  const repair = await f.service.operate({ operation: 'begin-document-repair', ...f.context, role: doc.role })
  const ref = { kind: 'lesson' as const, lessonId: f.lesson.lessonId, lessonDirectory: f.lesson.normalizedDirectory, relativePath: doc.relativePath }
  const disk = await f.files.openDocument(ref)
  const saved = await f.files.saveDocument({ ref, operationId: randomUUID(), source: disk.source + '\n已按当前前置稿复核。', expectedVersion: disk.version, attachments: [] })
  if (saved.status !== 'saved') throw new Error('fixture save failed')
  await f.service.operate({ operation: 'complete-document-repair', ...f.context, ticket: repair.repairTicket!, expectedVersion: saved.version })
 }
 const prepared = await f.service.operate({ operation: 'reprepare-existing-build', ...f.context })
 expect(prepared.application).toBe('has-changes'); expect(prepared.failure).toEqual(failure); expect(prepared.assembly).toBeUndefined()
 const reused = await f.service.operate({ operation: 'continue-application', ...f.context, ticketId: prepared.run!.ticketId })
 expect(reused.assembly!.resumeTarget).toEqual(failure.target)
 expect(reused.assembly!.ticket.id).not.toBe(original.ticket.id)
 expect(reused.assembly!.moduleSource).toBe(original.moduleSource); expect(f.prompts).toHaveLength(5)
 expect(await fs.readFile(path.join(f.root, 'lesson-authoring-runs', 'v1', 'history', original.ticket.id + '.json'), 'utf8')).toContain(original.ticket.id)
}, 20_000)

it('Stop invalidates prepared edits for every registered document', async () => {
 const f = await fixture()
 await f.service.operate({ operation: 'start', ...f.context, adapter: 'codex', instruction: '串联电路' })
 const result = await f.service.operate({ operation: 'poll', ...f.context })
 const invalidate = vi.spyOn(f.files, 'invalidateAiEdits')
 await f.service.operate({ operation: 'stop', ...f.context })
 expect(invalidate).toHaveBeenCalledWith({ kind: 'lesson', lessonId: f.lesson.lessonId, lessonDirectory: f.lesson.normalizedDirectory, relativePath: result.view.documents[0]!.relativePath })
})

it('repairs the pinned native module using real diagnostics and guards stopped, late, changed-target and changed-document continuations', async () => {
 const f = await fixture()
 for (let i = 0; i < 4; i++) {
  await f.service.operate({ operation: 'start', ...f.context, adapter: 'codex', instruction: '解释闭合电路并让学生操作验证' })
  const stage = await f.service.operate({ operation: 'poll', ...f.context })
  const doc = stage.view.documents.find(d => d.role === stage.view.currentStage)!
  await f.service.operate({ operation: 'confirm', ...f.context, role: doc.role, expectedVersion: doc.version })
 }
 await f.service.operate({ operation: 'start', ...f.context, adapter: 'codex', instruction: '解释闭合电路并让学生操作验证' })
 const ready = await f.service.operate({ operation: 'poll', ...f.context }), original = ready.assembly!
 const target = { projectId: randomUUID(), revision: 1, generation: 2 }
 await f.service.operate({ operation: 'begin-application', ...f.context, ticketId: ready.run!.ticketId })
 const failure = { target, committedStepCount: 0, message: '规则输入不符合合同', tool: 'slide.interaction', diagnostics: [{ path: 'input.rule.id', message: '不允许自定义规则身份' }] }
 await f.service.operate({ operation: 'fail-application', ...f.context, ticketId: ready.run!.ticketId, hasCommittedChanges: true, failure })
 const repair = () => f.service.operate({ operation: 'repair-build', ...f.context, ticketId: ready.run!.ticketId, instruction: '请修好这个问题，保留电路的操作过程', currentTarget: target })
 await expect(f.service.operate({ operation: 'repair-build', ...f.context, ticketId: ready.run!.ticketId, instruction: '修复', currentTarget: { ...target, revision: 2 } })).rejects.toThrow('工程已变化')
 const started = await repair()
 const request = f.requests.at(-1)!
 expect(request.operation).toBe('lesson-resume')
 if (request.operation !== 'lesson-resume') throw new Error('Expected existing native resume')
 expect(request.sessionId).toBe(ready.run!.sessionId)
 expect(request.userMessage).toBe('请修好这个问题，保留电路的操作过程')
 expect(request.prompt).toContain('input.rule.id'); expect(request.prompt).toContain('encodeBase64')
 expect(started.run!.ticketId).not.toBe(ready.run!.ticketId)
 expect((await f.service.operate({ operation: 'validate', ...f.context, ticket: original.ticket })).validation?.allowed).toBe(false)
 const latePath = request.prompt.match(/绝对路径：([^\n]+?)。/)![1]!
 await f.service.operate({ operation: 'stop', ...f.context })
 await fs.writeFile(latePath, 'late cancelled output')
 expect((await f.service.operate({ operation: 'poll', ...f.context })).assembly).toBeUndefined()
 const resumed = await f.service.operate({ operation: 'repair-build', ...f.context, ticketId: started.run!.ticketId, instruction: '继续修复', currentTarget: target })
 const latest = f.requests.at(-1)!
 if (latest.operation !== 'lesson-resume') throw new Error('Expected resume')
 const baseline = latest.prompt.match(/基准模块：([^\n]+?)。/)![1]!
 expect(await fs.readFile(baseline, 'utf8')).toBe(original.moduleSource)
 const repaired = await f.service.operate({ operation: 'poll', ...f.context })
 expect(repaired.run!.status).toBe('ready-to-build'); expect(repaired.assembly).toBeUndefined(); expect(repaired.repairTarget).toEqual(target)
 await expect(f.service.operate({ operation: 'continue-application', ...f.context, ticketId: resumed.run!.ticketId, currentTarget: { ...target, generation: 3 } })).rejects.toThrow('工程已变化')
 const ref = repaired.view.documents[0]!
 await fs.writeFile(path.join(f.lesson.normalizedDirectory, ref.relativePath), '# 教师新的简报')
 await expect(f.service.operate({ operation: 'continue-application', ...f.context, ticketId: resumed.run!.ticketId, currentTarget: target })).rejects.toThrow()
 expect((await f.service.operate({ operation: 'read', ...f.context })).failure).toEqual(failure)
}, 20_000)

it('U08-repair-before-write returns format diagnostics to the same native session before saving', async () => {
 const f = await fixture({ invalidFirstCandidate: true })
 const started = await f.service.operate({ operation: 'start', ...f.context, adapter: 'codex', instruction: '解释闭合电路' })
 const first = await f.service.operate({ operation: 'poll', ...f.context })
 expect(first.run?.status).toBe('running')
 expect(first.view.documents).toHaveLength(0)
 const repair = f.requests.at(-1)!
 expect(repair.operation).toBe('lesson-resume')
 if (repair.operation !== 'lesson-resume') throw new Error('Expected same native session repair')
 expect(repair.sessionId).toBe(started.run?.sessionId)
 expect(repair.preserveTaskBudget).toBe(true)
 expect(repair.prompt).toContain('嵌套或任务列表')
 const second = await f.service.operate({ operation: 'poll', ...f.context })
 expect(second.run?.status).toBe('waiting-confirmation')
 expect(second.view.documents).toHaveLength(1)
})
