import { app } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { documentAiCandidateSchema, documentAiReplacementCandidateSchema, lessonDocumentAiRequestSchema, type LessonDocumentAiRequest, type LessonDocumentAiResult } from '../shared/lessonDocumentAiTask'
import { documentSourceEdits } from '../shared/document/sourceMerge'
import { applyDocumentRanges } from './lessonDocumentCoauthoring'
import type { DocumentFileRef } from '../shared/document/ports'
import type { ConversationAgentWorkspace } from '../shared/workspaceIdentity'
import { normalizeWorkspacePath } from '../shared/workspaceIdentity'
import type { LocalAgentRequest, LocalAgentResponse } from '../shared/localAgentContract'
import { lessonDocumentFiles } from './lessonDocumentDesktopService'
import { operateLocalAgent, registerLessonRecordsInvalidator, type LessonRecordsInvalidationScope } from './localAgent/service'

export function assertDocumentAiRefMatchesWorkspace(workspace: ConversationAgentWorkspace, ref: DocumentFileRef): void {
  if (workspace.kind === 'lesson') {
    if (ref.kind !== 'lesson' || ref.lessonId !== workspace.lessonId) throw new Error('文件不属于当前课例')
    if (normalizeWorkspacePath(ref.lessonDirectory) !== normalizeWorkspacePath(workspace.normalizedDirectory)) throw new Error('文件不属于当前课例')
    return
  }
  if (ref.kind !== 'file') throw new Error('目录会话只能修改真实文件，不能要求课例相对路径')
  const cwd = path.resolve(workspace.normalizedDirectory)
  const file = path.resolve(ref.path)
  const relative = path.relative(cwd, file)
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('文件不属于当前会话目录')
}

function documentAiLabel(ref: DocumentFileRef): string {
  return ref.kind === 'lesson' ? ref.relativePath : (ref.path.replace(/\\/g, '/').split('/').pop() ?? ref.path)
}

type Start = Extract<LessonDocumentAiRequest, { operation: 'start' }>
interface Run { input: Start; source: string; root: string; result: LessonDocumentAiResult }
async function readCandidateText(directory: string, filename: string): Promise<string> {
  const root = await fs.realpath(directory), candidate = await fs.realpath(path.join(root, filename))
  if (path.dirname(candidate) !== root) throw new Error('候选越出本轮暂存目录')
  const file = await fs.open(candidate, 'r')
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('修改候选不是可读取的文本文件，或超过1 MiB')
    return await file.readFile('utf8')
  } finally { await file.close() }
}
export interface LessonDocumentAiDependencies {
  directory: string
  files: Pick<ReturnType<typeof lessonDocumentFiles>, 'openDocument' | 'invalidateAiEdits'>
  agent(request: LocalAgentRequest): Promise<LocalAgentResponse>
}
/** Staging/receipt adapter only; native harness owns all model and tool execution. */
export class LessonDocumentAiTasks {
  private runs = new Map<string, Run>()
  constructor(private deps: LessonDocumentAiDependencies) {}
  async invalidate(scope: LessonRecordsInvalidationScope) {
    const affected = [...this.runs.values()].filter(run => {
      if ('all' in scope) return true
      if ('directoryConversation' in scope) {
        return run.input.workspace.kind === 'directory'
          && run.input.workspace.conversationId === scope.directoryConversation.conversationId
          && normalizeWorkspacePath(run.input.workspace.normalizedDirectory) === normalizeWorkspacePath(scope.directoryConversation.normalizedDirectory)
      }
      return run.input.workspace.kind === 'lesson'
        && run.input.workspace.lessonId === scope.lesson.lessonId
        && path.resolve(run.input.workspace.normalizedDirectory).toLowerCase() === path.resolve(scope.lesson.normalizedDirectory).toLowerCase()
        && (!scope.conversationId || run.input.workspace.conversationId === scope.conversationId)
    })
    for (const run of affected) run.result = { ...run.result, status: 'stopped', message: '对话记录已删除，旧文档候选已失效', apply: undefined }
    await Promise.all(affected.map(run => this.deps.files.invalidateAiEdits(run.input.ref)))
  }
  async operate(raw: LessonDocumentAiRequest): Promise<LessonDocumentAiResult> {
    const input = lessonDocumentAiRequestSchema.parse(raw)
    if (input.operation === 'start') {
      assertDocumentAiRefMatchesWorkspace(input.workspace, input.ref)
      const disk = await this.deps.files.openDocument(input.ref)
      if (JSON.stringify(disk.version) !== JSON.stringify(input.baseVersion)) throw new Error('发送前当前稿已改变，请重新发送')
      if (input.ranges.some(range => disk.source.slice(range.from, range.to) !== range.before)) throw new Error('发送范围与当前稿不一致')
      const taskId = randomUUID(), root = path.join(this.deps.directory, taskId)
      await fs.mkdir(root, { recursive: true })
      await fs.writeFile(path.join(root, 'baseline.md'), disk.source, 'utf8')
      await fs.writeFile(path.join(root, 'request.json'), JSON.stringify({ taskId, ranges: input.ranges, baseVersion: disk.version }), 'utf8')
      const label = documentAiLabel(input.ref)
      const prompt = `教师明确要求修改文件 ${label}：${input.instruction}\n读取本轮基准 ${path.join(root, 'baseline.md')} 和范围 ${path.join(root, 'request.json')}。将修改后的完整Markdown写到 ${path.join(root, 'replacement.md')}，再将严格JSON {"replacementFile":"replacement.md"} 写到 ${path.join(root, 'candidate.json')}。宿主会对基准自动计算精确修改范围，无需手工计算偏移或重复输出before；未修改正文、样式及资源引用须原样保留。所有变化必须位于request.json允许范围内。不要覆盖正式课例文件、课件或baseline.md。宿主只保存无冲突部分，教师同时修改部分保留建议。替代传输仅在你已用脚本可靠算出精确范围时使用 {"edits":[{"from":整数,"to":整数,"before":"基准原文","after":"修改后原文"}]}，偏移均为原始baseline的UTF-16索引、互不重叠。两种传输只选一种，不提交空修改。不将本说明、校验命令或处理状态写入教师正文。`
      const reply = await this.deps.agent({ operation: 'lesson-start', workspace: input.workspace, adapter: input.adapter, intent: 'plan', prompt, userMessage: input.instruction })
      if (!reply.sessionId) throw new Error('原生文档修改任务未启动')
      const result: LessonDocumentAiResult = { taskId, sessionId: reply.sessionId, status: 'running', message: `正在修改 ${label}` }
      this.runs.set(taskId, { input, source: disk.source, root, result })
      return result
    }
    const run = this.runs.get(input.taskId)
    if (!run || JSON.stringify(run.input.workspace) !== JSON.stringify(input.workspace)) throw new Error('文档修改任务已失效，请重新发起；不会重放旧候选')
    if (input.operation === 'stop') {
      run.result = { ...run.result, status: 'stopped', message: '已停止文档修改', apply: undefined }
      await this.deps.files.invalidateAiEdits(run.input.ref)
      await this.deps.agent({ operation: 'lesson-cancel', workspace: input.workspace, sessionId: run.result.sessionId })
      return run.result
    }
    if (run.result.status !== 'running') return run.result
    try {
      const reply = await this.deps.agent({ operation: 'lesson-read', workspace: input.workspace, sessionId: run.result.sessionId, after: 0 })
      if (run.result.status !== 'running') return run.result
      const record = reply.records?.find(record => record.id === run.result.sessionId)
      if (!record || record.status === 'failed' || record.status === 'cancelled') throw new Error('原生文档修改任务已中断')
      if (record.status !== 'completed') return run.result
      const wire: unknown = JSON.parse(await readCandidateText(run.root, 'candidate.json'))
      const replacement = documentAiReplacementCandidateSchema.safeParse(wire)
      const candidate = replacement.success
        ? { edits: documentSourceEdits(run.source, await readCandidateText(run.root, replacement.data.replacementFile)).map(edit => ({ from: edit.from, to: edit.to, before: run.source.slice(edit.from, edit.to), after: edit.text })) }
        : wire
      const parsed = documentAiCandidateSchema.safeParse(candidate)
      if (!parsed.success) throw new Error('AI 未提供有效的文档修改范围，当前稿未改变。请补充要求后重试。')
      const { edits } = parsed.data
      if (edits.some(edit => !run.input.ranges.some(range => edit.from >= range.from && edit.to <= range.to))
        || applyDocumentRanges(run.source, run.source, edits).conflicts.length) throw new Error('候选范围、原文或重叠校验失败')
      if (run.result.status !== 'running') return run.result
      run.result = { ...run.result, status: 'candidate', message: '建议已生成，正在核对当前稿', apply: { baseVersion: run.input.baseVersion, epoch: run.input.epoch, operationId: run.result.taskId, edits } }
    } catch (error) { if (run.result.status === 'running') run.result = { ...run.result, status: 'failed', message: (error as Error).message } }
    return run.result
  }
}
let tasks: LessonDocumentAiTasks | undefined
export async function operateLessonDocumentAi(request: unknown): Promise<LessonDocumentAiResult> {
  if (!tasks) {
    tasks = new LessonDocumentAiTasks({ directory: path.join(app.getPath('userData'), 'lesson-document-ai', 'v1'), files: lessonDocumentFiles(), agent: operateLocalAgent })
    registerLessonRecordsInvalidator(scope => tasks!.invalidate(scope))
  }
  return tasks.operate(lessonDocumentAiRequestSchema.parse(request))
}
