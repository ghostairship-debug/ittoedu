import { z } from 'zod'
import { observeSpatialSource, prepareSpatialSourceEdit, prepareSpatialGraphSourceEdit } from '../../course/courseSpatialEdits'
import type { ComponentSpatialPose } from '../../../shared/contracts/component-platform'
import type { DocumentSnapshot } from '../../../shared/workbench/document'
import type { ToolResult } from '../../../shared/workbench/tools'
import { componentDefinitionSchema, jsonValueSchema, resolveComponentPresentation, type ComponentAsset, type ComponentEdit, type ComponentOperationBatch, type CourseProjectV10 } from '../../../shared/contracts/component-platform'
import { captureComponentOperation, equalComponentValue } from '../../drivers/courseV10Operations'
import { CourseV10Driver } from '../../drivers/CourseV10Driver'
import type { ContentApplyDiagnostic, ContentApplyIntent, ContentApplyRequest, ContentApplyResult, ContentApplySource, SurfaceApplyRequest } from '../../contentApply/planning/types'
import { componentProjectFiles, componentProjectScopeFiles, type ComponentProjectFile, type ComponentProjectFileScope, type ComponentProjectFileState } from './projection'
import { assetReferencePath, cssUrlReferences } from '../../../shared/composition/projectReferences'
import { flowDocumentEdits } from '../../components/document/flowDocumentProjection'
import { parseDocumentMarkdown } from '../../../shared/document/markdown'
import { bindMarkdownIdentities } from '../../../shared/document/markdownIdentity'
import { alignFlowBlocks, parseFlowHtml } from '../../../shared/document/html'
import { componentSourceAuthoringEdits } from '../../components/source/sourceAuthoringEdits'
import { courseConfigureInputSchema } from '../../tools/toolSchemas'
import { courseSettingsEdits } from '../../course/courseSemanticEdits'

export type ComponentProjectSnapshot = DocumentSnapshot & { model: Extract<DocumentSnapshot['model'], { kind: 'course-v10' }> }
export interface ComponentProjectFileInput {
  filename: string
  bytes: Uint8Array
  text?: string
  /** Already confined by the Main file owner; the content service handles resource preparation. */
  siblingFiles?: ReadonlyMap<string, Uint8Array>
  /** Source admission's logical entry within the same captured owner file set. */
  sourceEntry?: string
  /** Captured project bytes used only by Main's existing resource preparation. */
  assetContext?: { assets: CourseProjectV10['assets']; bytes: ComponentProjectSnapshot['model']['resources']['assets'] }
  resourceEdits?: Extract<ComponentEdit, { type: 'asset.add' }>[]
  resourceBindings?: Record<string, ComponentAsset>
  preparedHtml?: string
  assetReplacement?: Pick<ComponentAsset, 'mimeType' | 'width' | 'height'>
  diagnostics?: ContentApplyDiagnostic[]
}
export interface ComponentProjectFileHost {
  document(runId: string, selector: string | undefined, access: 'read' | 'write'): Promise<ComponentProjectSnapshot>
  scope?(runId: string, selector: string | undefined, snapshot: ComponentProjectSnapshot): ComponentProjectFileScope
  /** I binds this baseline to L19 planning and dispatches through the current canonical Session. */
  apply(runId: string, operationId: string, requestDigest: string, baseline: ComponentProjectSnapshot,
    request: ContentApplyRequest): Promise<ContentApplyResult>
  source(runId: string, from: string, snapshot: ComponentProjectSnapshot, sourceHtml?: string): Promise<ComponentProjectFileInput>
  /** Existing Markdown/professional/image parsers can normalize real source formats without another writer. */
  prepareSource?(input: ComponentProjectFileInput, file: ComponentProjectFile, intent: ContentApplyIntent, runId: string): Promise<ContentApplySource>
  settings?(runId: string, snapshot: ComponentProjectSnapshot, settings: ReturnType<typeof componentProjectSettings>): Promise<ComponentEdit[]>
  spatialViewport?(runId: string, snapshot: ComponentProjectSnapshot, surfaceId: string): Promise<ComponentSpatialPose>
}
const selector = z.string().min(1).optional(), path = z.string().min(1)
const common = { project: selector, path, intent: z.enum(['content', 'insert', 'style', 'redo']).optional() }
export const componentProjectFileSchemas = {
  'project.list': z.object({ project: selector, offset: z.number().int().nonnegative().optional(), limit: z.number().int().positive().optional() }).strict(),
  'project.read': z.object({ project: selector, path, offset: z.number().int().nonnegative().optional(), limit: z.number().int().positive().optional() }).strict(),
  'project.apply': z.union([
    z.object({ ...common, content: z.string() }).strict(), z.object({ ...common, from: z.string().min(1), content: z.string().optional() }).strict(),
    z.object({ project: selector, path: z.literal('pages'), intent: z.literal('surface.add'),
      kind: z.enum(['slide', 'flow', 'spatial']), title: z.string().optional(), before: path.optional() }).strict(),
    z.object({ project: selector, path, intent: z.literal('surface.move'), before: path.optional() }).strict(),
    z.object({ project: selector, path, intent: z.literal('surface.remove') }).strict(),
    z.object({ project: selector, path, intent: z.literal('surface.title'), title: z.string() }).strict(),
  ]),
} as const
export type ComponentProjectFileToolName = keyof typeof componentProjectFileSchemas
const failure = (code: string, message: string, data?: unknown): ToolResult => ({ kind: 'error', code, message, ...(data !== undefined ? { data } : {}) })
const key = (documentId: string, path: string) => `${documentId}\u0000${path}`
const fileKey = (documentId: string, path: string, scope: ComponentProjectFileScope = { kind: 'document' }) => key(documentId, `${JSON.stringify(scope)}\u0000${path}`)
const surfaceIdOf = (file: ComponentProjectFile | undefined): string | undefined => file?.target?.kind === 'container'
  && file.target.container.kind === 'surface' ? file.target.container.surfaceId : undefined
const listedFiles = (files: ComponentProjectFile[]) => files.map(({ path, kind, note }) => ({ path, type: kind, ...(note ? { note } : {}) }))
const sameFile = (left: ComponentProjectFile, right: ComponentProjectFile): boolean => left.kind === right.kind
  && (left.binding ? equalComponentValue(bindingIdentity(left), bindingIdentity(right))
    : left.target ? equalComponentValue(left.target, right.target) : !right.target && left.path === right.path)
  && left.sourceFile?.path === right.sourceFile?.path

function authoringFiles(snapshot: ComponentProjectSnapshot, state?: ComponentProjectFileState): ComponentProjectFile[] {
  const files = componentProjectFiles(snapshot.model.project, snapshot.model.resources)
  if (!state) return files
  const surface = snapshot.model.project.surfaces.find(value => value.id === state.surfaceId)
  if (!surface?.presentation?.states.some(value => value.id === state.stateId)) throw new Error('展示状态已不存在，请读取当前目标。')
  const project = resolveComponentPresentation(snapshot.model.project, state.surfaceId, state.stateId)
  return files.map(file => {
    if (file.target?.kind !== 'instance' || file.kind !== 'data' && file.kind !== 'style') return { ...file, observedState: state }
    const instance = project.instances[file.target.instanceId]
    return { ...file, observedState: state, editingContext: state,
      content: JSON.stringify(file.kind === 'data' ? instance.data : instance.style ?? {}, null, 2) }
  })
}
type ObservedFile = { snapshot: ComponentProjectSnapshot; file: ComponentProjectFile; unavailable?: boolean
  /** ACK projections are explained values, not actual Session captures of that revision. */
  captured?: boolean
  /** Offset continuation reads this immutable capture, even after an ACK advances other observations. */
  pagination?: { snapshot: ComponentProjectSnapshot; file: ComponentProjectFile } }
function bindingIdentity(file: ComponentProjectFile): unknown {
  const binding = file.binding
  return binding?.kind === 'flow' ? { kind: binding.kind, surfaceId: binding.surfaceId, format: binding.format }
    : binding?.kind === 'spatial' ? { kind: binding.kind, surfaceId: binding.surfaceId } : binding
}

/** The file adapter accepts authored settings; canonical identity and structure stay with their owners. */
export function componentProjectSettings(snapshot: ComponentProjectSnapshot, content: string) {
  const value: unknown = JSON.parse(content)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('工程设置需要 JSON 对象')
  const settings: Record<string, unknown> = {}, project = snapshot.model.project
  for (const [key, item] of Object.entries(value)) {
    if (['title', 'background', 'designTokens', 'playback'].includes(key)) settings[key] = item
    else if (!['id', 'revision', 'schemaVersion'].includes(key)
      && !equalComponentValue(item, project[key as keyof CourseProjectV10]))
      throw new Error(`project.json 的 ${key} 不是设置字段；请通过已观察的对象、页面或资源路径修改，原输入已保留。`)
  }
  return courseConfigureInputSchema.shape.settings.parse(settings)
}

/** Translate a captured file projection into the existing formal edits; never a second store. */
export function canonicalComponentFileEdits(snapshot: ComponentProjectSnapshot, file: ComponentProjectFile,
  content: string | undefined, source?: ContentApplySource, input?: ComponentProjectFileInput, diagnostics: ContentApplyDiagnostic[] = [], currentSpatialViewport?: ComponentSpatialPose): ComponentEdit[] {
  const originalProject = snapshot.model.project, binding = file.binding
  const project = input?.resourceEdits?.length ? { ...originalProject, assets: { ...originalProject.assets,
    ...Object.fromEntries(input.resourceEdits.map(edit => [edit.asset.id, edit.asset])) } } : originalProject
  if (!binding) throw new Error('工程文件没有正式字段绑定')
  if (binding.kind === 'project-settings') {
    if (content === undefined) throw new Error('工程设置需要 JSON 源文')
    const settings = componentProjectSettings(snapshot, content)
    if (settings.background?.source) throw new Error('背景图片来源请使用 course.configure，软件会登记图片资源')
    return courseSettingsEdits(project, settings)
  }
  if (binding.kind === 'theme') {
    if (content === undefined) throw new Error('主题文件需要 CSS 源文')
    const assets: Record<string, { assetId: string }> = {}
    for (const { reference } of cssUrlReferences(content)) {
      const path = assetReferencePath(reference)
      const asset = path && Object.values(project.assets).find(asset => asset.path === path)
      if (asset) assets[path!] = { assetId: asset.id }
    }
    const { assets: _oldBindings, ...theme } = project.theme ?? {}
    return [{ type: 'project.theme.set', theme: { ...theme, css: content, ...(Object.keys(assets).length ? { assets } : {}) } }]
  }
  if (binding.kind === 'definition') {
    if (content === undefined) throw new Error('共享定义需要 JSON 源文')
    const previous = project.definitions[binding.definitionId]
    if (!previous) throw new Error('共享定义已不存在')
    const metadata = componentDefinitionSchema.omit({ id: true, implementation: true }).parse(JSON.parse(content))
    return [{ type: 'definition.set', definition: { ...metadata, id: previous.id, implementation: previous.implementation } }]
  }
  if (binding.kind === 'definition-source' || binding.kind === 'instance-source') {
    const target = binding.kind === 'definition-source'
      ? { kind: 'definition' as const, definition: project.definitions[binding.definitionId]! }
      : { kind: 'instance' as const, instanceId: binding.instanceId }
    if (target.kind === 'definition' && !target.definition) throw new Error('共享定义已不存在')
    if (file.kind === 'asset' && file.sourceFile && file.implementation?.workspace) {
      const bytes = input?.bytes ?? (content !== undefined ? new TextEncoder().encode(content) : undefined)
      if (!bytes) throw new Error('组件原文件需要原始字节或文本')
      const captured = file.sourceFile, ownerId = captured.privateOwner ? file.implementation.workspace.ownerId : crypto.randomUUID()
      return componentSourceAuthoringEdits(target,
        { ...file.implementation, workspace: { ...file.implementation.workspace, ownerId } },
        { type: 'component.files.set', ownerId, expectedFiles: captured.privateOwner ? captured.files : null, files: { ...captured.files, [captured.path]: bytes } })
    }
    const prepared = source ?? (content !== undefined ? componentFileContentSource(file, content, input) : undefined)
    if (prepared?.kind !== 'data' || !prepared.implementation) throw new Error('共享源码没有可应用实现')
    return [...(prepared.componentFiles ?? []).slice(1), ...componentSourceAuthoringEdits(target,
      prepared.implementation, prepared.componentFiles?.[0])]
  }
  if (binding.kind === 'spatial') {
    if (content === undefined) throw new Error('空间镜头需要 JSON 源文')
    return [binding.graphScope
      ? prepareSpatialGraphSourceEdit(project, binding.graphScope, JSON.parse(content), binding.refs, binding.objectPaths, currentSpatialViewport)
      : prepareSpatialSourceEdit(project, binding.surfaceId, JSON.parse(content), binding.refs, binding.objectPaths, currentSpatialViewport)]
  }
  if (binding.kind === 'asset') {
    const previous = project.assets[binding.assetId]
    if (!previous) throw new Error('工程素材已不存在')
    const bytes = input?.bytes ?? (content !== undefined ? new TextEncoder().encode(content) : undefined)
    if (!bytes) throw new Error('工程素材需要原始字节或文本')
    const expectedBytes = snapshot.model.resources.assets[previous.id]
    if (!expectedBytes) throw new Error('工程素材原始字节尚未提供')
    return [{ type: 'asset.replace', asset: { ...previous, ...input?.assetReplacement, byteLength: bytes.byteLength }, bytes, expectedBytes }]
  }
  if (content === undefined) throw new Error('正文文件需要可读取的源文')
  if (binding.format === 'markdown') {
    const previous = parseDocumentMarkdown(file.content!, { createId: () => crypto.randomUUID() })
    if (previous.status !== 'valid') throw new Error('当前正文投影无法解析')
    bindMarkdownIdentities(previous, binding.document)
    const parsed = parseDocumentMarkdown(content, { previous, recoverUnsupportedBlocks: true, createId: () => crypto.randomUUID(),
      resolveImage: href => {
        const asset = input?.resourceBindings?.[href] ?? Object.values(project.assets).find(asset => asset.path === assetReferencePath(href))
        if (!asset) throw new Error(`正文引用的素材尚未提供：${href}`)
        return { assetId: asset.id, source: { kind: 'project' } }
      } })
    if (parsed.status === 'valid') {
      const edits = flowDocumentEdits(project, binding.surfaceId, parsed.document.content.blocks)
      if (parsed.diagnostics.length) {
        diagnostics.push(...parsed.diagnostics.map(issue => ({ level: 'warning' as const, code: 'flow-markdown-partial', message: issue.message, repairable: true })))
        const id = crypto.randomUUID(), bytes = input?.bytes ?? new TextEncoder().encode(content)
        edits.push({ type: 'asset.add', asset: { id, path: `assets/${id}.md`, filename: input?.filename ?? '正文源文.md',
          mimeType: 'text/markdown', byteLength: bytes.byteLength }, bytes })
      }
      return edits
    }
    diagnostics.push(...parsed.diagnostics.map(issue => ({ level: 'warning' as const, code: 'flow-markdown-partial', message: issue.message, repairable: true })))
    // Whole-body HTML fallback loses formal object fences. Keep an unrepresentable draft for repair.
    throw new Error(parsed.diagnostics.map(issue => issue.message).join('\n'))
  }
  const instanceByPath = (path: string) => Object.entries(binding.objectPaths).find(([, observed]) => observed === path)?.[0]
  const context = { assets: project.assets, packageName: (id: string) => id,
    instanceHtml: (id: string) => `<guoling-instance path="${(binding.objectPaths[id] ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></guoling-instance>` }
  const parsed = parseFlowHtml(content, { assets: project.assets, requireResolvedAssets: true, instanceByPath })
  diagnostics.push(...parsed.diagnostics.map(issue => ({ ...issue, repairable: true })))
  const aligned = alignFlowBlocks(parsed.blocks, binding.document.content.blocks, context)
  if (aligned.unresolved.length) throw new Error(`正文引用的组件尚未提供：${aligned.unresolved.join('、')}`)
  const edits = flowDocumentEdits(project, binding.surfaceId, aligned.blocks)
  if (diagnostics.some(issue => issue.level !== 'info')) {
    const id = crypto.randomUUID(), bytes = input?.bytes ?? new TextEncoder().encode(content)
    edits.push({ type: 'asset.add', asset: { id, path: `assets/${id}.html`, filename: input?.filename ?? '正文源文.html',
      mimeType: 'text/html', byteLength: bytes.byteLength }, bytes })
  }
  return edits
}

/** Extract changed fields so an unrelated human field is never overwritten by a complete data file. */
function dataFields(before: unknown, next: z.infer<typeof jsonValueSchema>, path: string[] = []): { path: string[]; value: z.infer<typeof jsonValueSchema> }[] {
  if (equalComponentValue(before, next)) return []
  if (before && typeof before === 'object' && !Array.isArray(before) && next && typeof next === 'object' && !Array.isArray(next)
    && Object.keys(before).every(name => Object.hasOwn(next, name))) {
    return Object.entries(next).flatMap(([name, value]) => dataFields((before as Record<string, unknown>)[name], value, [...path, name]))
  }
  return [{ path, value: next }]
}
export function componentFileContentSource(file: ComponentProjectFile, content: string, input?: ComponentProjectFileInput): ContentApplySource {
  if (file.kind === 'page' || file.kind === 'html' || file.kind === 'structure') return { kind: 'html', html: content,
    ...(file.projection ? { scope: 'projection' } : {}), ...(input?.siblingFiles ? { siblingFiles: input.siblingFiles } : {}) }
  if (file.kind === 'data') return { kind: 'data', fields: dataFields(JSON.parse(file.content!), jsonValueSchema.parse(JSON.parse(content))) }
  if (file.kind === 'style') {
    const style = z.record(z.string(), jsonValueSchema).parse(JSON.parse(content))
    const previous = JSON.parse(file.content!) as Record<string, unknown>
    for (const name of Object.keys(previous)) if (!Object.hasOwn(style, name)) style[name] = null
    return { kind: 'style', style: Object.fromEntries(Object.entries(style).filter(([name, value]) => !equalComponentValue(previous[name], value))) }
  }
  if (file.kind === 'source') {
    const implementation = file.implementation
    if (!implementation) throw new Error('组件源码目标尚未提供实现')
    if (implementation.workspace) {
      const captured = file.sourceFile
      if (!captured) throw new Error('组件源码文件尚未读取')
      const ownerId = captured.privateOwner ? implementation.workspace.ownerId : crypto.randomUUID()
      const files = { ...captured.files, [captured.path]: new TextEncoder().encode(content) }
      return { kind: 'data', fields: [],
        implementation: { ...implementation, workspace: { ...implementation.workspace, ownerId } },
        componentFiles: [{ type: 'component.files.set', ownerId, files, expectedFiles: captured.privateOwner ? captured.files : null }] }
    }
    return { kind: 'data', fields: [], implementation: { ...implementation, source: content } }
  }
  throw new Error('该文件不能作为内容修改目标；素材请通过内容资源入口应用。')
}

/** Thin path adapter. Captured observations are read baselines, never a mutable author store. */
export class ComponentProjectFileCoordinator {
  private readonly reads = new Map<string, Map<string, ObservedFile>>()
  private readonly listings = new Map<string, Map<string, { snapshot: ComponentProjectSnapshot; files: ComponentProjectFile[] }>>()
  constructor(private readonly host: ComponentProjectFileHost) {}
  stopRun(runId: string): void { this.reads.delete(runId); this.listings.delete(runId) }

  /** Ordinary target reads and project.list introduce paths through this existing observation owner. */
  listScope(runId: string, current: ComponentProjectSnapshot, scope: ComponentProjectFileScope, offset = 0, limit = 100) {
    const listingKey = key(current.documentId, JSON.stringify(scope))
    const listings = this.listings.get(runId) ?? new Map()
    let captured = offset ? listings.get(listingKey) : undefined
    if (captured && captured.snapshot.epoch !== current.epoch) throw new Error('工程身份已变化，请从目录开头重新读取。')
    if (offset && !captured) throw new Error('目录续页尚未读取，请从目录开头重新读取。')
    if (!captured) {
      captured = { snapshot: current, files: componentProjectScopeFiles(current.model.project, authoringFiles(current, scope.state), scope) }
      listings.set(listingKey, captured); this.listings.set(runId, listings)
    }
    const end = Math.min(captured.files.length, offset + Math.min(limit, 1000))
    const files = captured.files.slice(offset, end)
    this.remember(runId, captured.snapshot, files, true, scope)
    return { files: listedFiles(files), offset, total: captured.files.length, revision: captured.snapshot.revision,
      ...(end < captured.files.length ? { nextOffset: end } : {}),
      basis: scope.state ? 'state-data-style-and-base-source' : 'base',
      note: `${scope.state ? 'data/style 为所选展示状态的有效内容；组件源码仍是基态。HTML/页面结构的状态修改使用该状态目标的 object.update、presentation.update。' : '这些工程文件是基础作者内容。'}目录续页把 nextOffset 传给 project.list 的 offset，并沿用 project。` }
  }

  private remember(runId: string, snapshot: ComponentProjectSnapshot, files: ComponentProjectFile[], captured = true, scope: ComponentProjectFileScope = { kind: 'document' }): void {
    const reads = this.reads.get(runId) ?? new Map()
    // Session reads clone the same immutable version. Share that capture inside this observation owner.
    if (captured) snapshot = [...reads.values()].find(seen => seen.captured && seen.snapshot.documentId === snapshot.documentId
      && seen.snapshot.epoch === snapshot.epoch && seen.snapshot.revision === snapshot.revision)?.snapshot ?? snapshot
    for (const file of files) reads.set(fileKey(snapshot.documentId, file.path, scope), { snapshot, file, captured })
    this.reads.set(runId, reads)
  }

  forgetDocument(runId: string, documentId: string): void {
    const reads = this.reads.get(runId)
    for (const savedKey of reads?.keys() ?? []) if (savedKey.startsWith(`${documentId}\u0000`)) reads!.delete(savedKey)
  }

  /** Advance only values explained by this run's durable command; never absorb unread human edits. */
  acknowledge(runId: string, documentId: string, epoch: string, revision: number, command: ComponentOperationBatch): void {
    const reads = this.reads.get(runId)
    if (!reads) return
    const driver = new CourseV10Driver()
    const projected = new Map<ComponentProjectSnapshot, { snapshot: ComponentProjectSnapshot; files: ComponentProjectFile[] } | null>()
    for (const [pathKey, seen] of reads) {
      if (seen.snapshot.documentId !== documentId || seen.snapshot.epoch !== epoch || seen.unavailable) continue
      if (!projected.has(seen.snapshot)) {
        try {
          const model = driver.withRevision(driver.apply(seen.snapshot.model,
            captureComponentOperation(seen.snapshot.model.project, command.edits)), revision)
          if (model.kind !== 'course-v10') throw new Error('工程格式已变化')
          const snapshot = { ...seen.snapshot, revision, model }
          projected.set(seen.snapshot, { snapshot, files: componentProjectFiles(model.project, model.resources) })
        } catch {
          // A command that cannot be expressed on this older observation does not make current content read.
          projected.set(seen.snapshot, null)
        }
      }
      const next = projected.get(seen.snapshot)
      if (!next) continue
      let candidates: ComponentProjectFile[]
      try { candidates = seen.file.observedState ? authoringFiles(next.snapshot, seen.file.observedState) : next.files }
      catch { reads.set(pathKey, { ...seen, unavailable: true }); continue }
      let file = candidates.find(file => sameFile(seen.file, file))
      if (file?.binding?.kind === 'spatial' && seen.file.binding?.kind === 'spatial') {
        const observed = observeSpatialSource(next.snapshot.model.project, file.binding.surfaceId, file.binding.objectPaths, seen.file.binding.refs)
        file = { ...file, content: JSON.stringify(observed.source, null, 2), binding: { ...file.binding, refs: observed.refs, ...(seen.file.binding.graphScope ? { graphScope: seen.file.binding.graphScope } : {}) } }
      }
      reads.set(pathKey, file ? { snapshot: next.snapshot, file: { ...file, path: seen.file.path }, ...(seen.pagination ? { pagination: seen.pagination } : {}) }
        : { ...seen, unavailable: true })
    }
  }

  /** Other file-addressed tools share the observed identity instead of resolving a renamed path again. */
  captureFile(runId: string, current: ComponentProjectSnapshot, path: string, requireObserved = false, selector?: string): { snapshot: ComponentProjectSnapshot; file: ComponentProjectFile } {
    const scope = this.host.scope?.(runId, selector, current)
    const seen = this.reads.get(runId)?.get(fileKey(current.documentId, path, scope))
    if (seen && seen.snapshot.epoch !== current.epoch) throw new Error('工程身份已变化，请读取当前工程文件。')
    if (seen?.unavailable) throw new Error('原工程文件目标已不存在或类型已变化；请用 project.list 或 project.read 读取当前文件。')
    if (seen) return seen
    if (requireObserved) throw new Error('对象路径尚未观察；请先用 project.list 或 project.read 读取当前工程文件。')
    const file = componentProjectScopeFiles(current.model.project, authoringFiles(current, scope?.state), scope ?? { kind: 'document' }).find(value => value.path === path)
    if (!file) throw new Error(`没有这个工程文件：${path}`)
    return { snapshot: current, file }
  }

  async execute(runId: string, operationId: string, requestDigest: string, name: ComponentProjectFileToolName, raw: unknown): Promise<ToolResult> {
    try {
      if (name === 'project.list') {
        const input = componentProjectFileSchemas[name].parse(raw)
        const snapshot = await this.host.document(runId, input.project, 'read')
        const scope = this.host.scope?.(runId, input.project, snapshot) ?? { kind: 'document' }
        if (!input.offset && scope.kind === 'document') {
          const reads = this.reads.get(runId), prefix = fileKey(snapshot.documentId, '', scope)
          for (const savedKey of reads?.keys() ?? []) if (savedKey.startsWith(prefix)) reads!.delete(savedKey)
        }
        return { kind: 'read', data: this.listScope(runId, snapshot, scope, input.offset, input.limit) }
      }
      if (name === 'project.read') {
        const input = componentProjectFileSchemas[name].parse(raw)
        const current = await this.host.document(runId, input.project, 'read')
        const scope = this.host.scope?.(runId, input.project, current)
        const seen = this.reads.get(runId)?.get(fileKey(current.documentId, input.path, scope))
        const offset = input.offset ?? 0
        if (offset && seen?.pagination && seen.pagination.snapshot.epoch !== current.epoch) return failure('project-changed', '工程身份已变化，请从文件开头重新读取。')
        if (offset && seen?.unavailable) return failure('target-not-found', '原工程文件目标已不存在或类型已变化；请从文件开头重新读取。')
        const captured = offset ? seen?.pagination : undefined
        const snapshot = captured?.snapshot ?? current
        const projected = captured ? [] : componentProjectScopeFiles(snapshot.model.project, authoringFiles(snapshot, scope?.state), scope ?? { kind: 'document' })
        const currentFile = seen && seen.snapshot.epoch === current.epoch
          ? projected.find(file => sameFile(seen.file, file)) : projected.find(file => file.path === input.path)
        const file = captured?.file ?? (currentFile ? { ...currentFile, path: input.path } : undefined)
        if (!file) return failure('not-found', `没有这个工程文件：${input.path}`)
        this.remember(runId, snapshot, [file], true, scope)
        const saved = this.reads.get(runId)!.get(fileKey(current.documentId, input.path, scope))!
        saved.pagination = captured ?? { snapshot: saved.snapshot, file: saved.file }
        if (file.content === undefined) return { kind: 'read', data: { path: file.path, type: file.kind, mimeType: file.mimeType, byteLength: file.bytes?.byteLength ?? 0 } }
        const end = Math.min(file.content.length, offset + (input.limit ?? 100_000))
        return { kind: 'read', data: { path: file.path, type: file.kind, content: file.content.slice(offset, end),
          ...(file.note ? { note: file.note } : {}), ...(offset || end < file.content.length ? { offset, total: file.content.length } : {}),
          ...(end < file.content.length ? { nextOffset: end } : {}) } }
      }
      const input = componentProjectFileSchemas['project.apply'].parse(raw)
      const current = await this.host.document(runId, input.project, 'write')
      const scope = this.host.scope?.(runId, input.project, current)
      const seen = this.reads.get(runId)?.get(fileKey(current.documentId, input.path, scope))
      if (seen && seen.snapshot.epoch !== current.epoch) return failure('project-changed', '工程身份已变化，请读取当前工程文件。')
      if (seen?.unavailable) return failure('target-not-found', '原工程文件目标已不存在或类型已变化；请用 project.list 或 project.read 读取当前文件。')
      let baseline = seen?.snapshot ?? current
      let file = seen?.file ?? componentProjectScopeFiles(current.model.project, authoringFiles(current, scope?.state), scope ?? { kind: 'document' }).find(file => file.path === input.path)
      if (input.path === 'pages' && input.intent === 'surface.title') {
        const pages = authoringFiles(current).filter(file => file.kind === 'structure' && surfaceIdOf(file))
        const currentPage = current.model.project.surfaces.length === 1 ? current.model.project.surfaces[0] : undefined
        const prefix = fileKey(current.documentId, '', scope)
        const observed = [...(this.reads.get(runId)?.entries() ?? [])]
          .filter(([savedKey, value]) => savedKey.startsWith(prefix) && !value.unavailable && value.snapshot.epoch === current.epoch)
          .map(([, value]) => value.snapshot).reduce<ComponentProjectSnapshot | undefined>((latest, snapshot) =>
            !latest || snapshot.revision > latest.revision ? snapshot : latest, seen?.snapshot)
        if (scope && scope.kind !== 'document' || !currentPage
          || observed && (observed.model.project.surfaces.length !== 1 || observed.model.project.surfaces[0]!.id !== currentPage.id))
          return failure('target-not-found', 'pages 只有在当前与已观察工程均确定为同一唯一页面时才能命名；请使用实际页面路径。', { pages: listedFiles(pages) })
        baseline = observed ?? current
        file = authoringFiles(baseline).find(value => value.kind === 'structure' && surfaceIdOf(value) === currentPage.id)
      }
      if (scope?.kind === 'graph' && (input.intent && input.intent !== 'content' || file?.binding?.kind !== 'spatial'))
        return failure('not-authorized', '空间图项目标只能修改已观察的当前空间源文中的所选图项')
      if (scope?.state && (input.intent?.startsWith('surface.') || file?.binding?.kind === 'flow' || file?.binding?.kind === 'spatial'
        || file?.target && !['data', 'style', 'source', 'asset'].includes(file.kind)))
        return failure('state-file-target-required', '该工程路径是基础结构或 HTML 源文，不能写入展示状态。请沿用此状态 target 使用 object.update 或 presentation.update；状态 data/style 文件可直接 project.apply。')
      if (!seen && file) this.remember(runId, baseline, [file], true, scope)
      if (input.intent === 'surface.add' || input.intent === 'surface.move' || input.intent === 'surface.remove' || input.intent === 'surface.title') {
        let beforeSurfaceId: string | undefined
        if ('before' in input && input.before !== undefined) {
          const observedBefore = this.reads.get(runId)?.get(fileKey(current.documentId, input.before, scope))
          if (observedBefore?.unavailable) return failure('target-not-found', `原页面位置已不存在：${input.before}`)
          const before = observedBefore?.file
            ?? componentProjectFiles(baseline.model.project, baseline.model.resources).find(value => value.path === input.before)
          beforeSurfaceId = surfaceIdOf(before)
          if (!beforeSurfaceId) return failure('target-not-found', `没有这个页面位置：${input.before}`)
        }
        let request: SurfaceApplyRequest
        if (input.intent === 'surface.add') request = { intent: input.intent, kind: input.kind, title: input.title,
          ...(beforeSurfaceId !== undefined ? { beforeSurfaceId } : {}) }
        else {
          const surfaceId = surfaceIdOf(file)
          if (!surfaceId) return failure('target-not-found', `没有这个页面：${input.path}`)
          request = input.intent === 'surface.move' ? { intent: input.intent, surfaceId,
            ...(beforeSurfaceId !== undefined ? { beforeSurfaceId } : {}) }
            : input.intent === 'surface.title' ? { intent: input.intent, surfaceId, title: input.title }
              : { intent: input.intent, surfaceId }
        }
        const result = await this.host.apply(runId, operationId, requestDigest, baseline, request)
        if (result.commit !== 'committed' && result.commit !== 'unchanged') return { kind: 'read', data: { path: input.path, ...result } }
        try {
          const after = await this.host.document(runId, input.project, 'read')
          const files = componentProjectFiles(after.model.project, after.model.resources)
          const surfaceId = request.intent === 'surface.add' ? result.insertedIds[0]
            : request.intent === 'surface.remove' ? undefined : request.surfaceId
          const nextFile = files.find(value => value.kind === 'structure' && surfaceIdOf(value) === surfaceId)
          const occupied = nextFile && this.reads.get(runId)?.get(fileKey(current.documentId, nextFile.path, scope))
          const collision = occupied && (occupied.unavailable || !sameFile(occupied.file, nextFile!))
          let introduced = false
          // The receipt can introduce this changed path, but cannot rebind an old alias to another page.
          if (nextFile && !collision) {
            const observations = [...(this.reads.get(runId)?.values() ?? [])].filter(value => !value.unavailable
              && value.snapshot.documentId === current.documentId && value.snapshot.epoch === baseline.epoch)
            const known = observations.find(value => sameFile(value.file, nextFile))
              ?? [...new Set(observations.map(value => value.snapshot))].flatMap(snapshot => {
                const file = componentProjectFiles(snapshot.model.project, snapshot.model.resources).find(value => sameFile(value, nextFile))
                return file ? [{ snapshot, file }] : []
              })[0]
            if (known) {
              this.remember(runId, known.snapshot, [{ ...known.file, path: nextFile.path }], false, scope)
              introduced = true
            }
          }
          return { kind: 'read', data: { path: introduced && nextFile ? nextFile.path : input.path, ...result,
            ...(collision ? { next: '页面路径与此前观察重名；调用 project.list 读取当前目录。' }
              : nextFile && !introduced ? { next: '页面已提交；调用 project.list 读取当前目录。' } : {}) } }
        } catch (error) {
          // A subsequent observation failure cannot erase the canonical commit receipt.
          return { kind: 'read', data: { path: input.path, ...result, diagnostics: [...result.diagnostics,
            { level: 'warning', code: 'framework-paths-unavailable', message: error instanceof Error ? error.message : String(error) }] } }
        }
      }
      if (file?.binding) {
        const intent = input.intent ?? 'content'
        if (intent === 'insert' || intent === 'redo') return failure('file-content-required', '此路径修改已存在的正式字段；向页面插入或重做请使用页面结构路径。')
        let actual = 'from' in input ? await this.host.source(runId, input.from, baseline, input.content) : undefined
        let content = actual ? actual.text : 'content' in input ? input.content : undefined
        let source: ContentApplySource | undefined
        if (file.binding.kind === 'flow' || file.binding.kind === 'theme') {
          actual ??= { filename: file.path, bytes: new TextEncoder().encode(content ?? ''), text: content }
          actual.assetContext = { assets: baseline.model.project.assets, bytes: baseline.model.resources.assets }
          if (this.host.prepareSource) {
            source = await this.host.prepareSource(actual, file, intent, runId)
            if (source.kind === 'html') content = source.html
            else if (source.kind === 'data' && typeof source.fields[0]?.value === 'string') content = source.fields[0].value
          }
        } else if (file.binding.kind === 'definition-source' && !(file.kind === 'asset' && actual?.text === undefined)) {
          source = actual && this.host.prepareSource ? await this.host.prepareSource(actual, file, intent, runId)
            : content !== undefined ? componentFileContentSource(file, content, actual) : undefined
        } else if (file.binding.kind === 'asset' && file.mimeType?.startsWith('image/')) {
          actual ??= { filename: file.path, bytes: new TextEncoder().encode(content ?? ''), text: content }
          if (this.host.prepareSource) await this.host.prepareSource(actual, file, intent, runId)
        }
        const diagnostics: ContentApplyDiagnostic[] = [...actual?.diagnostics ?? []]
        let viewport: ComponentSpatialPose | undefined
        if (file.binding.kind === 'spatial' && content !== undefined) {
          const value = JSON.parse(content)
          if (value.home === 'currentViewport' || Array.isArray(value.stops) && value.stops.some((stop: { pose?: unknown }) => stop.pose === 'currentViewport')) {
            if (!this.host.spatialViewport) throw new Error('当前宿主没有空间视口，请打开原空间页面后重试')
            viewport = await this.host.spatialViewport(runId, baseline, file.binding.surfaceId)
          }
        }
        const edits = file.binding.kind === 'project-settings' && this.host.settings
          ? await this.host.settings(runId, baseline, componentProjectSettings(baseline, content ?? ''))
          : [...actual?.resourceEdits ?? [], ...canonicalComponentFileEdits(baseline, file, content, source, actual, diagnostics, viewport)]
        const result = await this.host.apply(runId, operationId, requestDigest, baseline, { intent: 'canonical', edits, diagnostics })
        return { kind: 'read', data: { path: input.path, ...result } }
      }
      if (!file?.target) return failure('target-not-found', `没有可应用的工程目标：${input.path}`)
      const intent = input.intent ?? (file.kind === 'style' ? 'style' : 'content')
      if (file.kind === 'structure' && intent === 'content') return failure('content-target-required', '这是工程结构观察；请修改同名目录中的对象内容，或明确插入/重做意图。')
      if (file.kind === 'html' && file.note && !file.projection && intent === 'content') return failure('professional-target-required', file.note)
      let source: ContentApplySource
      if ('from' in input) {
        const actual = await this.host.source(runId, input.from, baseline, input.content)
        actual.assetContext = { assets: baseline.model.project.assets, bytes: baseline.model.resources.assets }
        source = this.host.prepareSource ? await this.host.prepareSource(actual, file, intent, runId)
          : actual.text !== undefined ? componentFileContentSource(file, actual.text, actual) : (() => { throw new Error('当前文件需要专业资源适配；原始字节已保留。') })()
      } else {
        source = componentFileContentSource(file, input.content)
        if (this.host.prepareSource && source.kind === 'html') {
          const prepared = await this.host.prepareSource({ filename: file.path, bytes: new TextEncoder().encode(input.content), text: input.content,
            assetContext: { assets: baseline.model.project.assets, bytes: baseline.model.resources.assets } }, file, intent, runId)
          // Literal tool content is already journaled; only a supplied file has an original file asset.
          if (prepared.kind === 'html') { const { original: _original, ...content } = prepared; source = content }
          else source = prepared
        }
      }
      const request: ContentApplyRequest = { intent, target: file.target, source, ...(file.projection ? { projection: file.projection } : {}),
        ...(file.editingContext ? { editingContext: file.editingContext } : {}) }
      const result = await this.host.apply(runId, operationId, requestDigest, baseline, request)
      return { kind: 'read', data: { path: input.path, ...result } }
    } catch (error) {
      return failure('project-file-unresolved', error instanceof Error ? error.message : String(error))
    }
  }
}
