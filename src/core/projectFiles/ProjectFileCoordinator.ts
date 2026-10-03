import type { DocumentModel, DocumentSnapshot } from '../../shared/workbench/document'
import type { ToolAdvisory, ToolResult } from '../../shared/workbench/tools'
import { projectFileToolSchemas, type ProjectFileToolName } from '../tools/ProjectFileTools'
import type { PageParsePort } from './pageHtml'
import { listProjectFiles, projectFileIdentity, projectFileVersion, readProjectFile, slidePageFiles, type ProjectFileRead } from './projectFileView'
import { parsePagePath, planPageDelete, planPageMove, planPageWrite, ProjectFileError, type PlannedChange } from './slidePages'

export type CourseModel = Extract<DocumentModel, { kind: 'course-v9' }>
export type CourseSnapshot = DocumentSnapshot & { model: CourseModel }
export interface ProjectFileCommit { result: ToolResult; model?: CourseModel }

/** Gateway-owned authority: grant checks, the canonical Session commit and the existing staging admission. */
export interface ProjectFileHost {
  document(runId: string, selector: string | undefined, access: 'read' | 'write'): Promise<CourseSnapshot>
  commit(runId: string, operationId: string, requestDigest: string, snapshot: CourseSnapshot, model: CourseModel): Promise<ProjectFileCommit>
  admit(runId: string, operationId: string, requestDigest: string, snapshot: CourseSnapshot, model: CourseModel): Promise<ProjectFileCommit>
  parsePage(): PageParsePort | undefined
  createId(): string
}

const READ_LIMIT = 100_000
const failure = (code: string, message: string): ToolResult => ({ kind: 'error', code, message })

/** Project files are a projection of the course; writes become one undoable canonical change. */
export class ProjectFileCoordinator {
  /** run -> document file identity -> version last read or written by that run. */
  private readonly versions = new Map<string, Map<string, string>>()
  constructor(private readonly host: ProjectFileHost) {}

  stopRun(runId: string): void { this.versions.delete(runId) }

  private remember(runId: string, documentId: string, file: ProjectFileRead, model: CourseModel): void {
    const run = this.versions.get(runId) ?? new Map<string, string>()
    run.set(`${documentId}\u0000${projectFileIdentity(file)}`, projectFileVersion(file, model.resources))
    this.versions.set(runId, run)
  }

  /** A whole-file write replaces only what this run has seen. */
  private assertFresh(runId: string, snapshot: CourseSnapshot, file: ProjectFileRead): void {
    const seen = this.versions.get(runId)?.get(`${snapshot.documentId}\u0000${projectFileIdentity(file)}`)
    if (seen === undefined) throw new ProjectFileError('read-required', `写入已有文件前请先读取：${file.path}`)
    if (seen !== projectFileVersion(file, snapshot.model.resources))
      throw new ProjectFileError('file-changed', `${file.path} 在读取后已被修改（可能是人工编辑），请重新读取后再写入`)
  }

  private plan(snapshot: CourseSnapshot, path: string, content: string): PlannedChange {
    const { project, resources } = snapshot.model
    if (parsePagePath(path) || slidePageFiles(project).some(page => page.path === path)) {
      const parse = this.host.parsePage()
      if (!parse) throw new ProjectFileError('service-unavailable', '页面解析服务尚未就绪')
      return planPageWrite({ project, resources, path, html: content, parse, createId: () => this.host.createId() })
    }
    throw new ProjectFileError('unsupported-path', `不能写入 ${path}：第一批支持 slides/ 演示页`)
  }

  private async apply(runId: string, operationId: string, requestDigest: string, snapshot: CourseSnapshot, planned: PlannedChange): Promise<ToolResult> {
    const model: CourseModel = { kind: 'course-v9', resources: planned.resources,
      project: { ...planned.project, revision: snapshot.model.project.revision, updatedAt: snapshot.model.project.updatedAt } }
    const committed = planned.admission
      ? await this.host.admit(runId, operationId, requestDigest, snapshot, model)
      : await this.host.commit(runId, operationId, requestDigest, snapshot, model)
    if (committed.result.kind !== 'document-operation' || committed.result.result.status !== 'applied' && committed.result.result.status !== 'unchanged') return committed.result
    const after = committed.model ?? model
    const page = planned.identity.startsWith('page:') ? slidePageFiles(after.project).find(value => `page:${value.sceneId}` === planned.identity) : undefined
    const file = page && readProjectFile(after.project, after.resources, page.path)
    if (file) this.remember(runId, snapshot.documentId, file, after)
    const advisories: ToolAdvisory[] = planned.diagnostics.filter(item => item.level !== 'info')
      .map(item => ({ step: 0, code: 'html-import-warning' as const, message: item.message }))
    return { ...committed.result, affected: file ? [file.path] : [], ...(advisories.length ? { advisories } : {}) }
  }

  async execute(runId: string, operationId: string, requestDigest: string, name: ProjectFileToolName, raw: unknown): Promise<ToolResult> {
    try {
      if (name === 'project.list') {
        const input = projectFileToolSchemas[name].parse(raw)
        const snapshot = await this.host.document(runId, input.project, 'read')
        return { kind: 'read', data: { files: listProjectFiles(snapshot.model.project, snapshot.model.resources) } }
      }
      if (name === 'project.read') {
        const input = projectFileToolSchemas[name].parse(raw)
        const snapshot = await this.host.document(runId, input.project, 'read')
        const file = readProjectFile(snapshot.model.project, snapshot.model.resources, input.path)
        if (!file) return failure('not-found', `没有这个文件：${input.path}；可先列出工程文件`)
        this.remember(runId, snapshot.documentId, file, snapshot.model)
        if (file.kind === 'asset') {
          const { assetId: _id, kind: _kind, ...asset } = file
          return { kind: 'read', data: asset }
        }
        const offset = input.offset ?? 0, end = Math.min(file.content.length, offset + (input.limit ?? READ_LIMIT))
        return { kind: 'read', data: { path: file.path, ...(file.kind === 'page' ? { type: file.type, ...(file.objects.length ? { objects: file.objects } : {}) } : { type: '教师控制台' }),
          content: file.content.slice(offset, end), ...(offset || end < file.content.length ? { offset, total: file.content.length } : {}),
          ...(end < file.content.length ? { nextOffset: end } : {}) } }
      }
      if (name === 'project.write' || name === 'project.edit') {
        const input = name === 'project.write' ? projectFileToolSchemas[name].parse(raw) : projectFileToolSchemas[name].parse(raw)
        const snapshot = await this.host.document(runId, input.project, 'write')
        const current = readProjectFile(snapshot.model.project, snapshot.model.resources, input.path)
        let content: string
        if ('content' in input) {
          if (current) this.assertFresh(runId, snapshot, current)
          content = input.content
        } else {
          if (!current) return failure('not-found', `没有这个文件：${input.path}；新文件请整份写入`)
          if (current.kind === 'asset' && current.content === undefined) return failure('binary-file', '局部替换只适用于文本文件')
          content = current.content!
          for (const edit of input.edits) {
            const first = content.indexOf(edit.old)
            if (first < 0) return failure('edit-mismatch', `原文未找到：${edit.old.slice(0, 80)}；文件可能已被修改，请重新读取`)
            if (content.indexOf(edit.old, first + 1) >= 0) return failure('edit-ambiguous', `原文出现不止一次：${edit.old.slice(0, 80)}；请给出更长、唯一的原文`)
            content = content.slice(0, first) + edit.new + content.slice(first + edit.old.length)
          }
        }
        return await this.apply(runId, operationId, requestDigest, snapshot, this.plan(snapshot, input.path, content))
      }
      if (name === 'project.move') {
        const input = projectFileToolSchemas[name].parse(raw)
        const snapshot = await this.host.document(runId, input.project, 'write')
        if (!slidePageFiles(snapshot.model.project).some(page => page.path === input.from))
          return failure('unsupported-path', `不能移动 ${input.from}：第一批支持 slides/ 演示页`)
        return await this.apply(runId, operationId, requestDigest, snapshot, planPageMove(snapshot.model.project, snapshot.model.resources, input.from, input.to))
      }
      const input = projectFileToolSchemas['project.delete'].parse(raw)
      const snapshot = await this.host.document(runId, input.project, 'write')
      if (!slidePageFiles(snapshot.model.project).some(page => page.path === input.path))
        return failure('unsupported-path', `不能删除 ${input.path}：第一批支持 slides/ 演示页`)
      return await this.apply(runId, operationId, requestDigest, snapshot, planPageDelete(snapshot.model.project, snapshot.model.resources, input.path))
    } catch (error) {
      if (error instanceof ProjectFileError) return failure(error.code, error.message)
      throw error
    }
  }
}
