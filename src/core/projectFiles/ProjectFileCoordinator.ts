import type { AssetSource } from '../../shared/contracts/media-v1/types'
import type { DocumentModel, DocumentSnapshot } from '../../shared/workbench/document'
import type { ToolAdvisory, ToolResult } from '../../shared/workbench/tools'
import { courseComponentNameKey } from '../../shared/composition/projectReferences'
import { projectFileToolSchemas, type ProjectFileToolName } from '../tools/ProjectFileTools'
import { normalizeCourseProject } from '../course/normalizeCourseProject'
import type { ImageAssetResource } from '../tools/imageAssetMetadata'
import type { HostImageInput } from '../tools/imageResource'
import { assetPathIssue, assetPathType, planAssetDelete, planAssetMove, planAssetWrite } from './assetFiles'
import { docFiles, isDocPath, planDocDelete, planDocMove, planDocWrite, readDocFile } from './flowDocs'
import { componentPathName, planComponentDelete, planComponentMove, planComponentWrite, planControllerDelete, planControllerWrite, planThemeWrite } from './definitionFiles'
import type { PageParsePort } from './pageHtml'
import { programsChanged, withProgramFallbacks } from './programs'
import { assetFiles, CONTROLLER_FILE, listProjectFiles, projectFileIdentity, projectFileVersion, readProjectFile, slidePageFiles, THEME_FILE, type ProjectFileRead } from './projectFileView'
import { parsePagePath, planPageDelete, planPageMove, planPageWrite, ProjectFileError, type PlannedChange } from './slidePages'
import { rewriteMovedProjectLinks } from './projectNavigation'
import { isSpacePath, planSpaceDelete, planSpaceMove, spaceFiles } from './spaceFiles'
import { planSpaceWrite, readSpaceFile } from './spaceHtml'

export type CourseModel = Extract<DocumentModel, { kind: 'course-v9' }>
export type CourseSnapshot = DocumentSnapshot & { model: CourseModel }
export interface ProjectFileCommit { result: ToolResult; model?: CourseModel }

/** Public file -> observation location projection; a space with no stops has no observable location. */
export function projectFileLocationId(model: CourseModel, path: string): string | undefined {
  const page = slidePageFiles(model.project).find(page => page.path === path)
  if (page) return page.locationId
  const surface = docFiles(model.project).find(file => file.path === path)?.surface
    ?? spaceFiles(model.project).find(file => file.path === path)?.surface
  return surface ? model.project.locations.find(location => location.surfaceId === surface.id)?.id : undefined
}

/** Gateway-owned authority: grant checks, the canonical Session commit and the existing staging admission. */
export interface ProjectFileHost {
  document(runId: string, selector: string | undefined, access: 'read' | 'write'): Promise<CourseSnapshot>
  commit(runId: string, operationId: string, requestDigest: string, snapshot: CourseSnapshot, model: CourseModel): Promise<ProjectFileCommit>
  admit(runId: string, operationId: string, requestDigest: string, snapshot: CourseSnapshot, model: CourseModel): Promise<ProjectFileCommit>
  parsePage(): PageParsePort | undefined
  /** The existing image admission: decode, verify the real type, measure. */
  prepareImage(input: HostImageInput): Promise<ImageAssetResource>
  /** Bytes to copy into assets/: a workspace file within the task's file access, or this task's image result. */
  readSource(runId: string, from: string): Promise<HostImageInput & { source: AssetSource }>
  createId(): string
}

const READ_LIMIT = 100_000
const failure = (code: string, message: string): ToolResult => ({ kind: 'error', code, message })
const isPage = (project: CourseModel['project'], path: string) => !!parsePagePath(path) || slidePageFiles(project).some(page => page.path === path)

/** Any project file, handouts included. */
function readFile(model: Pick<CourseModel, 'project' | 'resources'>, path: string): ProjectFileRead | undefined {
  const doc = docFiles(model.project).find(file => file.path === path)
  if (doc) return { kind: 'doc', path, surfaceId: doc.surface.id, ...readDocFile(model.project, doc) }
  const space = spaceFiles(model.project).find(file => file.path === path)
  if (space) return { kind: 'space', path, surfaceId: space.surface.id, ...readSpaceFile(model.project, space.surface) }
  return readProjectFile(model.project, model.resources, path)
}

/** The file an identity names now, after renames and reordering. */
function fileByIdentity(model: CourseModel, identity: string): ProjectFileRead | undefined {
  const { project, resources } = model
  const [kind, value] = [identity.slice(0, identity.indexOf(':') < 0 ? undefined : identity.indexOf(':')), identity.slice(identity.indexOf(':') + 1)]
  const path = identity === 'theme' ? THEME_FILE : identity === 'controller' ? CONTROLLER_FILE
    : kind === 'page' ? slidePageFiles(project).find(page => page.sceneId === value)?.path
      : kind === 'doc' ? docFiles(project).find(file => file.surface.id === value)?.path
      : kind === 'space' ? spaceFiles(project).find(file => file.surface.id === value)?.path
      : kind === 'asset' ? assetFiles(project).find(file => file.meta.id === value)?.path
        : kind === 'component' ? Object.keys(project.components ?? {}).filter(name => courseComponentNameKey(name) === value).map(name => `components/${name}.html`)[0]
          : undefined
  return path === undefined ? undefined : readFile({ project, resources }, path)
}

/** Project files are a projection of the course; writes become one undoable canonical change. */
export class ProjectFileCoordinator {
  /** run -> document file identity -> version last read or written by that run. */
  private readonly versions = new Map<string, Map<string, string>>()
  constructor(private readonly host: ProjectFileHost) {}

  stopRun(runId: string): void { this.versions.delete(runId) }

  remember(runId: string, documentId: string, file: ProjectFileRead, model: CourseModel): void {
    const run = this.versions.get(runId) ?? new Map<string, string>()
    run.set(`${documentId}\u0000${projectFileIdentity(file)}`, projectFileVersion(file, model.resources))
    this.versions.set(runId, run)
  }

  /** A whole-file write replaces only what this run has seen. */
  assertFresh(runId: string, snapshot: CourseSnapshot, file: ProjectFileRead): void {
    const seen = this.versions.get(runId)?.get(`${snapshot.documentId}\u0000${projectFileIdentity(file)}`)
    if (seen === undefined) throw new ProjectFileError('read-required', `写入已有文件前请先读取：${file.path}`)
    if (seen !== projectFileVersion(file, snapshot.model.resources))
      throw new ProjectFileError('file-changed', `${file.path} 在读取后已被修改（可能是人工编辑），请重新读取后再写入`)
  }

  private async planAsset(snapshot: CourseSnapshot, path: string, input: HostImageInput, source: AssetSource): Promise<PlannedChange> {
    const issue = assetPathIssue(path)
    if (issue) throw new ProjectFileError('invalid-path', issue)
    if (input.mimeType !== assetPathType(path)) throw new ProjectFileError('type-mismatch', `${path} 的扩展名与图片实际类型（${input.mimeType}）不符`)
    let prepared: ImageAssetResource
    try { prepared = await this.host.prepareImage(input) }
    catch (error) { throw new ProjectFileError('invalid-image', `图片无法读取：${error instanceof Error ? error.message : String(error)}`) }
    return planAssetWrite(snapshot.model.project, snapshot.model.resources, path, prepared, source)
  }

  private async plan(snapshot: CourseSnapshot, path: string, content: string): Promise<PlannedChange> {
    const { project, resources } = snapshot.model
    if (path.startsWith('assets/')) {
      if (assetPathType(path) !== 'image/svg+xml' && !assetPathIssue(path)) throw new ProjectFileError('binary-file', '位图素材请用 from 从工作区文件或图片结果复制')
      return this.planAsset(snapshot, path, { bytes: new TextEncoder().encode(content), mimeType: 'image/svg+xml', filename: path.split('/').at(-1)! }, { kind: 'model-svg' })
    }
    if (path === THEME_FILE) return planThemeWrite(project, resources, content)
    if (path === CONTROLLER_FILE) return planControllerWrite(project, resources, content, () => this.host.createId())
    if (isDocPath(path)) {
      const parse = this.host.parsePage()
      if (!parse) throw new ProjectFileError('service-unavailable', '页面解析服务尚未就绪')
      return planDocWrite({ project, resources, path, html: content, parse })
    }
    if (isSpacePath(path)) {
      const parse = this.host.parsePage()
      if (!parse) throw new ProjectFileError('service-unavailable', '页面解析服务尚未就绪')
      return planSpaceWrite({ project, resources, path, html: content, parse, createId: () => this.host.createId() })
    }
    if (componentPathName(path) !== undefined) return planComponentWrite(project, resources, path, content)
    if (isPage(project, path)) {
      const parse = this.host.parsePage()
      if (!parse) throw new ProjectFileError('service-unavailable', '页面解析服务尚未就绪')
      return planPageWrite({ project, resources, path, html: content, parse, createId: () => this.host.createId() })
    }
    throw new ProjectFileError('unsupported-path', `不能写入 ${path}；可写 theme.css、slides/ 演示页、docs/ 讲义、spaces/ 空间、components/ 组件和 assets/ 素材`)
  }

  private async commit(runId: string, operationId: string, requestDigest: string, snapshot: CourseSnapshot, planned: PlannedChange) {
    // Normalize first so derived component copies count as running code and admission sees what will be committed.
    const project = normalizeCourseProject({ ...planned.project, revision: snapshot.model.project.revision, updatedAt: snapshot.model.project.updatedAt })
    const resources = withProgramFallbacks(project, planned.resources)
    const model: CourseModel = { kind: 'course-v9', project, resources }
    if (!planned.admission && !programsChanged(snapshot.model.project, project))
      return { ...await this.host.commit(runId, operationId, requestDigest, snapshot, model), candidate: model }
    return { ...await this.host.admit(runId, operationId, requestDigest, snapshot, model), candidate: model }
  }

  async apply(runId: string, operationId: string, requestDigest: string, snapshot: CourseSnapshot, planned: PlannedChange): Promise<ToolResult> {
    rewriteMovedProjectLinks(snapshot.model.project, planned.project)
    let committed = await this.commit(runId, operationId, requestDigest, snapshot, planned)
    const advisories: ToolAdvisory[] = planned.diagnostics.filter(item => item.level !== 'info')
      .map(item => ({ step: 0, code: 'html-import-warning' as const, message: item.message }))
    if (committed.result.kind === 'error' && committed.result.code === 'admission-failed' && planned.draft) {
      // A refused component is kept as a disabled draft; pages show its placeholder with the reason.
      const reason = committed.result.message
      committed = await this.commit(runId, operationId, requestDigest, snapshot, planned.draft(reason))
      advisories.push({ step: 0, code: 'html-import-warning', message: `组件未通过准入，已保存为草稿，页面显示占位与原因；修复后重新写入此文件。${reason}` })
    }
    const result = committed.result
    if (result.kind !== 'document-operation' || result.result.status !== 'applied' && result.result.status !== 'unchanged') return result
    const after = committed.model ?? committed.candidate
    const file = fileByIdentity(after, planned.identity)
    if (file) this.remember(runId, snapshot.documentId, file, after)
    return { ...result, affected: file ? [file.path] : [], ...(advisories.length ? { advisories } : {}) }
  }

  async execute(runId: string, operationId: string, requestDigest: string, name: ProjectFileToolName, raw: unknown): Promise<ToolResult> {
    try {
      if (name === 'project.list') {
        const input = projectFileToolSchemas[name].parse(raw)
        const snapshot = await this.host.document(runId, input.project, 'read')
        const spaces = spaceFiles(snapshot.model.project)
        const references = spaces.flatMap(file => file.surface.world.layerItems.flatMap(item => item.kind === 'composition'
          ? [{ path: file.path, carrier: { kind: 'composition' as const, item } }] : []))
        const files = listProjectFiles(snapshot.model.project, snapshot.model.resources, docFiles(snapshot.model.project), references)
        const docs = docFiles(snapshot.model.project).map(file => ({ path: file.path, type: '讲义',
          ...(file.surface.surfaceLayerItems.length ? { note: `另有 ${file.surface.surfaceLayerItems.length} 个挂靠段落的独立对象` } : {}) }))
        const after = files.reduce((last, file, index) => file.path.startsWith('slides') ? index : last, 0)
        files.splice(after + 1, 0, ...docs, ...spaces.map(file => ({ path: file.path, type: '空间',
          note: file.surface.camera.frames.length ? `${file.surface.camera.frames.length} 个停靠点` : '没有停靠点，当前不能按路径观察' })))
        return { kind: 'read', data: { files } }
      }
      if (name === 'project.read') {
        const input = projectFileToolSchemas[name].parse(raw)
        const snapshot = await this.host.document(runId, input.project, 'read')
        const file = readFile(snapshot.model, input.path)
        if (!file) return failure('not-found', `没有这个文件：${input.path}；可先列出工程文件`)
        this.remember(runId, snapshot.documentId, file, snapshot.model)
        if (file.kind === 'asset') {
          const { assetId: _id, kind: _kind, ...asset } = file
          return { kind: 'read', data: asset }
        }
        const offset = input.offset ?? 0, end = Math.min(file.content.length, offset + (input.limit ?? READ_LIMIT))
        const type = file.kind === 'page' ? file.type : file.kind === 'doc' ? '讲义' : file.kind === 'space' ? '空间' : file.kind === 'theme' ? '主题' : file.kind === 'controller' ? '教师控制台' : file.draft ? '组件草稿' : '组件'
        return { kind: 'read', data: { path: file.path, type,
          ...((file.kind === 'page' || file.kind === 'doc' || file.kind === 'space') && file.objects.length ? { objects: file.objects } : {}),
          ...(file.kind === 'space' && !projectFileLocationId(snapshot.model, file.path) ? { diagnostic: '该空间当前没有可观察的停靠点' } : {}),
          ...(file.kind === 'component' && file.draft ? { draft: file.draft } : {}),
          content: file.content.slice(offset, end), ...(offset || end < file.content.length ? { offset, total: file.content.length } : {}),
          ...(end < file.content.length ? { nextOffset: end } : {}) } }
      }
      if (name === 'project.write' || name === 'project.edit') {
        const input = name === 'project.write' ? projectFileToolSchemas[name].parse(raw) : projectFileToolSchemas[name].parse(raw)
        const snapshot = await this.host.document(runId, input.project, 'write')
        const current = readFile(snapshot.model, input.path)
        if ('from' in input) {
          if (current) this.assertFresh(runId, snapshot, current)
          const { source, ...file } = await this.host.readSource(runId, input.from)
          return await this.apply(runId, operationId, requestDigest, snapshot, await this.planAsset(snapshot, input.path, file, source))
        }
        let content: string
        if ('content' in input) {
          // An empty theme has nothing a run could overwrite.
          if (current && !(current.kind === 'theme' && !current.content)) this.assertFresh(runId, snapshot, current)
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
        return await this.apply(runId, operationId, requestDigest, snapshot, await this.plan(snapshot, current?.path ?? input.path, content))
      }
      if (name === 'project.move') {
        const input = projectFileToolSchemas[name].parse(raw)
        const snapshot = await this.host.document(runId, input.project, 'write')
        const { project, resources } = snapshot.model
        if (slidePageFiles(project).some(page => page.path === input.from)) return await this.apply(runId, operationId, requestDigest, snapshot, planPageMove(project, resources, input.from, input.to))
        if (componentPathName(input.from) !== undefined) return await this.apply(runId, operationId, requestDigest, snapshot, planComponentMove(project, resources, input.from, input.to))
        if (input.from.startsWith('assets/')) return await this.apply(runId, operationId, requestDigest, snapshot, planAssetMove(project, resources, input.from, input.to))
        if (isDocPath(input.from)) return await this.apply(runId, operationId, requestDigest, snapshot, planDocMove(project, resources, input.from, input.to))
        if (isSpacePath(input.from)) return await this.apply(runId, operationId, requestDigest, snapshot, planSpaceMove(project, resources, input.from, input.to))
        return failure('unsupported-path', `不能移动 ${input.from}；可移动演示页、讲义、空间、组件和素材`)
      }
      const input = projectFileToolSchemas['project.delete'].parse(raw)
      const snapshot = await this.host.document(runId, input.project, 'write')
      const { project, resources } = snapshot.model
      if (input.path === CONTROLLER_FILE) return await this.apply(runId, operationId, requestDigest, snapshot, planControllerDelete(project, resources))
      if (slidePageFiles(project).some(page => page.path === input.path)) return await this.apply(runId, operationId, requestDigest, snapshot, planPageDelete(project, resources, input.path))
      if (componentPathName(input.path) !== undefined) return await this.apply(runId, operationId, requestDigest, snapshot, planComponentDelete(project, resources, input.path))
      if (input.path === THEME_FILE) return await this.apply(runId, operationId, requestDigest, snapshot, planThemeWrite(project, resources, ''))
      if (input.path.startsWith('assets/')) return await this.apply(runId, operationId, requestDigest, snapshot, planAssetDelete(project, resources, input.path))
      if (isDocPath(input.path)) return await this.apply(runId, operationId, requestDigest, snapshot, planDocDelete(project, resources, input.path))
      if (isSpacePath(input.path)) return await this.apply(runId, operationId, requestDigest, snapshot, planSpaceDelete(project, resources, input.path))
      return failure('unsupported-path', `不能删除 ${input.path}；可删除演示页、讲义、空间、组件、素材和主题`)
    } catch (error) {
      if (error instanceof ProjectFileError) return failure(error.code, error.message)
      throw error
    }
  }
}
