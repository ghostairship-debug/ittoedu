import { z } from 'zod'
import { literalTextMatches } from '../../tools/literalTextSearch'
import { taskTargetRegion, type TaskTargetMetadata } from '../../../shared/workbench/taskTargetContext'
import { compactToolInputError } from '../../tools/ToolInputDiagnostic'
import { componentProjectApplyReceiptFiles, sameComponentProjectFile as sameFile } from './applyReceiptFiles'
import { observeSpatialSource, prepareSpatialSourceEdit, prepareSpatialGraphSourceEdit } from '../../course/courseSpatialEdits'
import type { ComponentSpatialPose } from '../../../shared/contracts/component-platform'
import type { DocumentSnapshot } from '../../../shared/workbench/document'
import type { ToolResult } from '../../../shared/workbench/tools'
import { componentDefinitionSchema, componentFrameSchema, jsonValueSchema, resolveComponentPresentation, type ComponentAsset, type ComponentEdit, type ComponentFrame, type ComponentOperationBatch, type CourseProjectV10 } from '../../../shared/contracts/component-platform'
import { contentPlacementRegion } from '../../contentApply/planning/placement'
import { captureComponentOperation, equalComponentValue, presentationComponentEdits } from '../../drivers/courseV10Operations'
import { applyComponentStylePatch, cssStyleName } from '../../../shared/componentStylePatch'
import { CourseV10Driver } from '../../drivers/CourseV10Driver'
import type { ContentApplyDiagnostic, ContentApplyIntent, ContentApplyRequest, ContentApplyTarget, ContentApplyResult, ContentApplySource, SurfaceApplyRequest } from '../../contentApply/planning/types'
import { componentProjectFiles, componentProjectFileSummary, componentProjectLayoutViewports, componentProjectScopeFiles, type ComponentProjectFile, type ComponentProjectFileScope, type ComponentProjectFileState } from './projection'
import { assetReferencePath, cssUrlReferences } from '../../../shared/composition/projectReferences'
import { flowDocumentEdits } from '../../components/document/flowDocumentProjection'
import { parseDocumentMarkdown } from '../../../shared/document/markdown'
import { bindMarkdownIdentities } from '../../../shared/document/markdownIdentity'
import { alignFlowBlocks, parseFlowHtml } from '../../../shared/document/html'
import { componentSourceAuthoringEdits } from '../../components/source/sourceAuthoringEdits'
import { componentAuthorSourceEdits, componentAuthorEnhancementEdits } from '../../components/source/componentAuthorSource'
import { courseConfigureInputSchema } from '../../tools/toolSchemas'
import { courseSettingsEdits } from '../../course/courseSemanticEdits'
import { owningContainer, componentDefinitionBuiltinKey, isComponentVisibleAtSurface } from '../../../shared/contracts/component-platform'
import { textComponentDataSchema } from '../../../components/text/data'
import { plainDocumentText } from '../../../shared/document/content'
import { parseFragment, type DefaultTreeAdapterTypes } from 'parse5'
import { publicContentApplyReceipt, publicOperationReceipt } from '../../tools/publicWriteReceipt'
import { MODEL_DELIVERY_BYTES, modelTextEnd, modelJsonBytes } from '../../tools/modelDeliveryBudget'

export type ComponentProjectSnapshot = DocumentSnapshot & { model: Extract<DocumentSnapshot['model'], { kind: 'course-v10' }> }
export interface ComponentProjectFileInput {
  metadata?: TaskTargetMetadata
  filename: string
  bytes: Uint8Array
  text?: string
  /** Already confined by the Main file owner; the content service handles resource preparation. */
  siblingFiles?: ReadonlyMap<string, Uint8Array>
  /** Source admission's logical entry within the same captured owner file set. */
  sourceEntry?: string
  /** Captured project bytes used only by Main's existing resource preparation. */
  assetContext?: { assets: CourseProjectV10['assets']; bytes: ComponentProjectSnapshot['model']['resources']['assets']; references?: Record<string, string> }
  /** Set by the virtual HTML source owner, never inferred from incoming resource strings. */
  resourceNamespace?: 'project'
  resourceEdits?: Extract<ComponentEdit, { type: 'asset.add' }>[]
  resourceBindings?: Record<string, ComponentAsset>
  preparedHtml?: string
  assetReplacement?: Pick<ComponentAsset, 'mimeType' | 'width' | 'height'>
  diagnostics?: ContentApplyDiagnostic[]
}
export interface ComponentProjectFileHost {
  document(runId: string, selector: string | undefined, access: 'read' | 'write'): Promise<ComponentProjectSnapshot>
  currentTarget?(runId: string): string | undefined
  /** Fresh run authorization and a new scoped selector for a prior task's formal destination. */
  rebaseTarget?(runId: string, context: unknown): Promise<{ snapshot: ComponentProjectSnapshot; project: string;
    target: ContentApplyTarget; fileKind?: string; region?: ComponentFrame }>
  scope?(runId: string, selector: string | undefined, snapshot: ComponentProjectSnapshot): ComponentProjectFileScope
  /** I binds this baseline to L19 planning and dispatches through the current canonical Session. */
  apply(runId: string, operationId: string, requestDigest: string, baseline: ComponentProjectSnapshot,
    request: ContentApplyRequest): Promise<ContentApplyResult>
  applyBatch?(runId: string, operationId: string, requestDigest: string,
    operations: ComponentProjectFileBatchItem[]): Promise<ContentApplyResult[]>
  source(runId: string, from: string, snapshot: ComponentProjectSnapshot, sourceHtml?: string): Promise<ComponentProjectFileInput>
  /** Existing Markdown/professional/image parsers can normalize real source formats without another writer. */
  prepareSource?(input: ComponentProjectFileInput, file: ComponentProjectFile, intent: ContentApplyIntent, runId: string): Promise<ContentApplySource>
  settings?(runId: string, snapshot: ComponentProjectSnapshot, settings: ReturnType<typeof componentProjectSettings>): Promise<ComponentEdit[]>
  spatialViewport?(runId: string, snapshot: ComponentProjectSnapshot, surfaceId: string): Promise<ComponentSpatialPose>
}
export interface ComponentProjectFileBatchItem {
  baseline: ComponentProjectSnapshot
  request: ContentApplyRequest
  reprepare?(candidate: ComponentProjectSnapshot): Promise<{ baseline: ComponentProjectSnapshot; request: ContentApplyRequest }>
  /** Only a target created by an earlier item uses the batch candidate as its read basis. */
  candidateTarget?: boolean
  acknowledge?(command: ComponentOperationBatch): void
}
const selector = z.string().min(1).optional(), path = z.string().min(1)
const region = componentFrameSchema.optional().describe('一次新内容放置范围；width/height 是局部测量视口，transform 将局部坐标映射到父容器。采用后由正式 frame 持有；已有对象 content/redo 保当前外框，改变外框用 object.update。省略时沿用当前目标和默认视口。')
const common = { project: selector, path, region, intent: z.enum(['content', 'insert', 'style', 'redo', 'enhance']).optional() }
const batchFileCommon = { path, region, intent: common.intent }
const contentApplyFileSchema = z.union([
  z.object({ ...batchFileCommon, content: z.string() }).strict(), z.object({ ...batchFileCommon, from: z.string().min(1), content: z.string().optional() }).strict(),
  z.object({ path, region, intent: z.enum(['content', 'style']).optional(),
    edits: z.array(z.object({ old: z.string().min(1), new: z.string() }).strict()).min(1) }).strict(),
])
export const componentProjectFileSchemas = {
  'project.list': z.object({ project: selector, offset: z.number().int().nonnegative().optional(), limit: z.number().int().positive().optional() }).strict(),
  'project.read': z.object({ project: selector, path, query: z.string().min(1).optional(), refresh: z.boolean().optional(), full: z.boolean().optional(), offset: z.number().int().nonnegative().optional(), limit: z.number().int().positive().optional() }).strict(),
  'project.apply': z.union([
    z.object({ project: selector, operations: z.array(contentApplyFileSchema).min(1) }).strict(),
    z.object({ ...common, content: z.string() }).strict(), z.object({ ...common, from: z.string().min(1), content: z.string().optional() }).strict(),
    z.object({ project: selector, path, region, intent: z.enum(['content', 'style']).optional(),
      edits: z.array(z.object({ old: z.string().min(1), new: z.string() }).strict()).min(1) }).strict(),
    z.object({ project: selector, path: z.literal('pages'), intent: z.literal('surface.add'),
      kind: z.enum(['slide', 'flow', 'spatial']), title: z.string().optional(), before: path.optional(), content: z.string().optional(), from: z.string().min(1).optional(), region }).strict(),
    z.object({ project: selector, path: z.literal('pages'), intent: z.literal('surface.add'),
      pages: z.array(z.object({ kind: z.enum(['slide', 'flow', 'spatial']), title: z.string().optional(), before: path.optional(), content: z.string().optional(), from: z.string().min(1).optional(), region }).strict()).min(1) }).strict(),
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
const layoutContext = (file: ComponentProjectFile | undefined) => ({
  ...(file?.frame ? { frame: structuredClone(file.frame) } : {}),
  ...(file?.programViewport ? { viewport: { ...file.programViewport } } : {}),
})
function projectAssetContext(snapshot: ComponentProjectSnapshot, file: ComponentProjectFile): NonNullable<ComponentProjectFileInput['assetContext']> {
  const project = snapshot.model.project
  const data = file.target?.kind === 'instance' ? project.instances[file.target.instanceId]?.data : undefined
  const bindings = data && typeof data === 'object' && !Array.isArray(data) ? data.resourceBindings : undefined
  const references = bindings && typeof bindings === 'object' && !Array.isArray(bindings)
    ? Object.fromEntries(Object.entries(bindings).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) : undefined
  return { assets: project.assets, bytes: snapshot.model.resources.assets, ...(references ? { references } : {}) }
}
const listedFiles = (files: ComponentProjectFile[]) => files.map(file => ({ path: file.path, type: file.kind,
  ...layoutContext(file), ...(file.summary ? { summary: file.summary } : {}), ...(file.references ? { references: file.references } : {}), ...(file.note ? { note: file.note } : {}) }))

function authoringFiles(snapshot: ComponentProjectSnapshot, state?: ComponentProjectFileState): ComponentProjectFile[] {
  const files = componentProjectFiles(snapshot.model.project, snapshot.model.resources)
  if (!state) return files
  const surface = snapshot.model.project.surfaces.find(value => value.id === state.surfaceId)
  if (!surface?.presentation?.states.some(value => value.id === state.stateId)) throw new Error('展示状态已不存在，请读取当前目标。')
  const project = resolveComponentPresentation(snapshot.model.project, state.surfaceId, state.stateId)
  const layouts = componentProjectLayoutViewports(project)
  return files.map(file => {
    if (file.target?.kind !== 'instance') return { ...file, observedState: state }
    const instance = project.instances[file.target.instanceId]
    const current = { ...file, observedState: state, frame: instance.frame,
      programViewport: layouts.instances.get(instance.id) }
    if (file.kind !== 'data' && file.kind !== 'style') return current
    const content = JSON.stringify(file.binding?.kind === 'instance-authoring' ? instance.authoring ?? {} : file.kind === 'data' ? instance.data : instance.style ?? {}, null, 2)
    return { ...current, editingContext: state, content, summary: componentProjectFileSummary({ ...file, content }) }
  })
}
type ObservedFile = { snapshot: ComponentProjectSnapshot; file: ComponentProjectFile; unavailable?: boolean
  /** ACK projections are explained values, not actual Session captures of that revision. */
  captured?: boolean
  /** Offset continuation reads this immutable capture, even after an ACK advances other observations. */
  pagination?: { snapshot: ComponentProjectSnapshot; file: ComponentProjectFile; query?: string } }

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
  if (binding.kind === 'instance-authoring') {
    if (content === undefined) throw new Error('局部作者记录需要 JSON 源文')
    const edits: ComponentEdit[] = [{ type: 'authoring.set', instanceId: binding.instanceId, path: [], value: jsonValueSchema.parse(JSON.parse(content)) }]
    const context = file.editingContext
    return context ? presentationComponentEdits(originalProject, context.surfaceId, context.stateId, edits) : edits
  }
  if (binding.kind === 'definition-source' || binding.kind === 'instance-source') {
    const target = binding.kind === 'definition-source'
      ? { kind: 'definition' as const, definition: project.definitions[binding.definitionId]! }
      : { kind: 'instance' as const, instanceId: binding.instanceId }
    if (target.kind === 'definition' && !target.definition) throw new Error('共享定义已不存在')
    const sourceEdits = (implementation: Extract<import('../../../shared/contracts/component-platform').ComponentImplementation, { kind: 'source' }>, files?: Extract<ComponentEdit, { type: 'component.files.set' }>) => file.authorSource
      ? componentAuthorSourceEdits(project, snapshot.model.resources, target, file.authorSource.prepared, implementation, files, file.authorSource.dependencyId)
      : componentSourceAuthoringEdits(target, implementation, files)
    if (file.kind === 'asset' && file.sourceFile && file.implementation?.workspace) {
      const bytes = input?.bytes ?? (content !== undefined ? new TextEncoder().encode(content) : undefined)
      if (!bytes) throw new Error('组件原文件需要原始字节或文本')
      const captured = file.sourceFile, ownerId = captured.privateOwner ? file.implementation.workspace.ownerId : crypto.randomUUID()
      return sourceEdits(
        { ...file.implementation, workspace: { ...file.implementation.workspace, ownerId } },
        { type: 'component.files.set', ownerId, expectedFiles: captured.privateOwner ? captured.files : null, files: { ...captured.files, [captured.path]: bytes } })
    }
    const prepared = source ?? (content !== undefined ? componentFileContentSource(file, content, input) : undefined)
    if (prepared?.kind !== 'data' || !prepared.implementation) throw new Error('共享源码没有可应用实现')
    if (prepared.implementation.kind !== 'source') throw new Error('源码入口需要源码实现')
    return [...(prepared.componentFiles ?? []).slice(1), ...sourceEdits(prepared.implementation, prepared.componentFiles?.[0])]
  }
  if (binding.kind === 'spatial') {
    if (content === undefined) throw new Error('空间镜头需要 JSON 源文')
    const edit = binding.graphScope
      ? prepareSpatialGraphSourceEdit(project, binding.graphScope, JSON.parse(content), binding.refs, binding.objectPaths, currentSpatialViewport)
      : prepareSpatialSourceEdit(project, binding.surfaceId, JSON.parse(content), binding.refs, binding.objectPaths, currentSpatialViewport)
    const previousDefault = project.surfaces.find(surface => surface.id === binding.surfaceId)?.spatial?.defaultPathId
    if (edit.type === 'spatial.set' && previousDefault && !edit.spatial.paths?.some(path => path.id === previousDefault)
      && edit.spatial.defaultPathId === null) diagnostics.push({ level: 'info', code: 'spatial-default-route-reset', message: '已删除默认路径，默认播放路线已回到按镜头顺序。' })
    return [edit]
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
    scope: 'target', ...(input?.siblingFiles ? { siblingFiles: input.siblingFiles } : {}),
    ...(input?.resourceNamespace ? { resourceNamespace: input.resourceNamespace } : {}) }
  if (file.kind === 'data') return { kind: 'data', fields: dataFields(JSON.parse(file.content!), jsonValueSchema.parse(JSON.parse(content))) }
  if (file.kind === 'style') {
    const style = z.record(z.string(), jsonValueSchema).parse(JSON.parse(content))
    const previous = JSON.parse(file.content!) as Record<string, unknown>
    for (const name of Object.keys(previous)) if (!Object.keys(style).some(alias => cssStyleName(alias) === cssStyleName(name))) style[name] = null
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
  private readonly focusedTargets = new Map<string, { path: string; project?: string }>()
  private readonly reads = new Map<string, Map<string, ObservedFile>>()
  private readonly listings = new Map<string, Map<string, { snapshot: ComponentProjectSnapshot; files: ComponentProjectFile[] }>>()
  constructor(private readonly host: ComponentProjectFileHost) {}
  stopRun(runId: string): void { this.reads.delete(runId); this.listings.delete(runId); this.focusedTargets.delete(runId) }

  /** Real current file entrances accompany a repairable failure; no synthetic Source API. */
  private repairDetails(runId: string, snapshot: ComponentProjectSnapshot, original: ComponentProjectFile, inputPath: string, selector?: string) {
    const all = authoringFiles(snapshot, original.observedState)
    const current = all.find(file => sameFile(original, file))
    const target = current?.target ?? original.target
    const scope: ComponentProjectFileScope = target?.kind === 'instance' ? { kind: 'instance', instanceId: target.instanceId }
      : target?.container.kind === 'surface' ? { kind: 'surface', surfaceId: target.container.surfaceId } : { kind: 'document' }
    const binding = current?.binding ?? original.binding
    const definitionId = binding?.kind === 'definition' || binding?.kind === 'definition-source' ? binding.definitionId : undefined
    const scoped = target ? componentProjectScopeFiles(snapshot.model.project, all, scope) : all.filter(file => sameFile(original, file)
      || definitionId && (file.binding?.kind === 'definition' || file.binding?.kind === 'definition-source') && file.binding.definitionId === definitionId)
    const candidates = scoped.filter(file => ['html', 'data', 'style', 'source'].includes(file.kind) || file.binding?.kind === 'flow' || sameFile(original, file))
    const observationScope = this.host.scope?.(runId, selector, snapshot) ?? { kind: 'document' }
    const prefix = fileKey(snapshot.documentId, '', observationScope), reads = this.reads.get(runId)
    const observations = [...(reads?.entries() ?? [])].filter(([savedKey, seen]) => savedKey.startsWith(prefix)
      && !seen.unavailable && seen.snapshot.epoch === snapshot.epoch).map(([, seen]) => seen)
    const refreshPaths: string[] = []
    const files = candidates.flatMap(file => {
      // A natural path may now name another object under an old read alias.
      // Prefer the already observed identity, exactly as successful receipts do.
      const known = observations.find(seen => sameFile(seen.file, file))
      if (known) return [{ ...file, path: known.file.path }]
      const occupied = reads?.get(fileKey(snapshot.documentId, file.path, observationScope))
      if (occupied && (occupied.unavailable || !sameFile(occupied.file, file))) refreshPaths.push(file.path)
      return [file]
    })
    return { path: inputPath, currentRevision: snapshot.revision, ...layoutContext(current),
      files: listedFiles(files), ...(refreshPaths.length ? { refreshPaths, next: '部分当前路径与旧观察别名重名；按 repair.read 用 project.read refresh:true 局部刷新该文件。' } : {}),
      repair: { read: files.map(file => ({ tool: 'project.read', input: { ...(selector ? { project: selector } : {}), path: file.path, ...(refreshPaths.includes(file.path) ? { refresh: true } : {}) } })),
        write: '读取对应当前源文后，用 project.apply 的 content/from/edits 修改同一路径；.content.html 可直接改 HTML/CSS/页内脚本，.data.json 需保留专业数据合同，主 Source 及依赖可完整续读和改写。',
        ...(current?.frame ? { geometry: { tool: 'object.update', properties: ['frame', 'rotation'],
          next: '用该对象已观察的 target 显式修改 properties.frame；内容改写保留当前正式 frame。' } } : {}) } }
  }

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
          const projectedRevision = Math.max(revision, seen.snapshot.revision)
          const model = driver.withRevision(driver.apply(seen.snapshot.model,
            captureComponentOperation(seen.snapshot.model.project, command.edits)), projectedRevision)
          if (model.kind !== 'course-v10') throw new Error('工程格式已变化')
          const snapshot = { ...seen.snapshot, revision: projectedRevision, model }
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
      const dependencyId = seen.file.authorSource?.dependencyId
      if (!file && dependencyId) {
        // A local Source edit may fork a shared dependency. Follow only that command's actual copy.
        const copies = command.edits.filter((edit): edit is Extract<ComponentEdit, { type: 'definition.set' }> =>
          edit.type === 'definition.set' && edit.sourceOriginId === dependencyId)
        file = candidates.find(candidate => copies.some(edit => candidate.authorSource?.dependencyId === edit.definition.id)
          && sameFile({ ...seen.file, authorSource: { ...seen.file.authorSource!, dependencyId: candidate.authorSource!.dependencyId } }, candidate))
      }
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

  /** Freeze current target geometry for a child task without adopting unread Source or advancing CAS. */
  async taskTargetContext(runId: string, target?: { project?: string; path: string; region?: ComponentFrame }, resumeContext?: unknown) {
    if (!target && resumeContext) {
      if (!this.host.rebaseTarget) throw new Error('当前宿主没有正式子任务目标续接入口')
      const current = await this.host.rebaseTarget(runId, resumeContext)
      const scope = this.host.scope?.(runId, current.project, current.snapshot) ?? { kind: 'document' }
      const files = componentProjectScopeFiles(current.snapshot.model.project, authoringFiles(current.snapshot, scope.state), scope)
      const sameTarget = files.filter(file => {
        const actual = file.target, expected = current.target
        if (!actual || actual.kind !== expected.kind) return false
        return actual.kind === 'instance' ? expected.kind === 'instance' && actual.instanceId === expected.instanceId
          : expected.kind === 'container' && equalComponentValue(actual.container, expected.container)
      })
      const file = sameTarget.find(file => file.kind === current.fileKind)
        ?? sameTarget.find(file => ['html', 'data', 'structure'].includes(file.kind)) ?? sameTarget[0]
      if (!file) throw new Error('原子任务的正式目标已不存在；不能按旧路径或编辑器当前焦点替换它。')
      target = { project: current.project, path: file.path, ...(current.region ? { region: current.region } : {}) }
    }
    const explicit = target, currentTarget = !target ? this.host.currentTarget?.(runId) : undefined
    target ??= currentTarget ? undefined : this.focusedTargets.get(runId)
    const selector = target?.project ?? currentTarget
    let snapshot: ComponentProjectSnapshot
    try { snapshot = await this.host.document(runId, selector, 'read') }
    catch (error) {
      if (explicit) throw error
      return { regionStatus: 'unresolved' as const, reason: '当前任务没有可解析的课件目标；由本次创作意图选择新区域。' }
    }
    const scope = this.host.scope?.(runId, selector, snapshot) ?? { kind: 'document' }
    if (!target && scope.kind === 'document') {
      const focused = this.focusedTargets.get(runId)
      if (focused && (!focused.project || focused.project === selector)) target = focused
    }
    const all = authoringFiles(snapshot, scope.state)
    const scoped = componentProjectScopeFiles(snapshot.model.project, all, scope)
    const captured = target ? this.captureFile(runId, snapshot, target.path, false, selector) : undefined
    const file = captured ? scoped.find(value => sameFile(captured.file, value))
      : scope.kind === 'instance' ? scoped.find(value => value.target?.kind === 'instance' && value.target.instanceId === scope.instanceId && ['html', 'data'].includes(value.kind))
        : scope.kind === 'surface' ? scoped.find(value => value.kind === 'structure' && surfaceIdOf(value) === scope.surfaceId) : undefined
    if (!file) {
      if (target) throw new Error('原目标已不存在或已移出当前范围；请读取当前目标，不按重名路径替换它。')
      return { documentId: snapshot.documentId, epoch: snapshot.epoch, revision: snapshot.revision,
        regionStatus: 'unresolved' as const, reason: '当前任务没有明确的局部区域；现有页面不是默认的新内容范围。' }
    }
    const project = scope.state ? resolveComponentPresentation(snapshot.model.project, scope.state.surfaceId, scope.state.stateId) : snapshot.model.project
    const instanceId = file.target?.kind === 'instance' ? file.target.instanceId
      : file.target?.kind === 'container' && file.target.container.kind === 'instance' ? file.target.container.instanceId : undefined
    const container = file.target?.kind === 'container' ? file.target.container
      : instanceId ? owningContainer(project, instanceId) : undefined
    let owner = container
    while (owner?.kind === 'instance') owner = owningContainer(project, owner.instanceId)
    const surfaceId = owner?.kind === 'surface' ? owner.surfaceId
      : file.binding?.kind === 'flow' || file.binding?.kind === 'spatial' ? file.binding.surfaceId : undefined
    const surface = project.surfaces.find(value => value.id === surfaceId)
    const snippets = (id: string) => {
      const instance = project.instances[id]!, definition = project.definitions[instance.definitionId]
      const title = instance.name ?? definition?.title
      const native = textComponentDataSchema.safeParse(instance.data)
      if (native.success) return { ...(title ? { title } : {}), text: plainDocumentText(native.data.content).slice(0, 240) }
      const data = instance.data
      if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.html !== 'string') return title ? { title } : {}
      const visible = (node: DefaultTreeAdapterTypes.Node): string => node.nodeName === '#text' ? (node as DefaultTreeAdapterTypes.TextNode).value
        : 'tagName' in node && ['script', 'style', 'template'].includes(node.tagName) ? ''
          : 'childNodes' in node ? node.childNodes.map(visible).join(' ') : ''
      const found: string[] = []
      const visit = (node: DefaultTreeAdapterTypes.Node): void => {
        if (found.length >= 4) return
        if ('tagName' in node && ['script', 'style', 'template'].includes(node.tagName)) return
        if ('tagName' in node && /^(h[1-6]|nav|button|a)$/.test(node.tagName)) {
          const text = visible(node).replace(/\s+/g, ' ').trim().slice(0, 80)
          if (text && !found.includes(text)) found.push(text)
        }
        if (found.length < 4 && 'childNodes' in node) node.childNodes.forEach(visit)
      }
      visit(parseFragment(data.html))
      return { ...(title ? { title } : {}), ...(found.length ? { text: found.join(' · ').slice(0, 240) } : {}) }
    }
    // Sibling and global frames describe the existing composition, including
    // custom HTML navigation. No neighbor Source or extra write target is exposed.
    const siblingIds = !surface ? [] : container?.kind === 'instance' ? project.instances[container.instanceId]?.childIds ?? [] : surface.childIds
    const globalIds = !surface ? [] : [...project.global.underlay, ...project.global.overlay].filter(id => {
      const instance = project.instances[id]
      return instance && isComponentVisibleAtSurface(instance, surface.id)
    })
    const neighbors = [...new Set([...siblingIds, ...globalIds])].filter(id => id !== instanceId).flatMap(id => {
      const instance = project.instances[id]
      if (!instance || instance.visible === false || !instance.frame) return []
      const parent = owningContainer(project, id)
      return [{ ...snippets(id), frame: structuredClone(instance.frame),
        coordinates: parent?.kind === 'global' ? `global-${parent.plane}` : parent?.kind ?? 'surface' }]
    })
    return { documentId: snapshot.documentId, epoch: snapshot.epoch, revision: snapshot.revision,
      path: captured?.file.path ?? file.path, ...(captured && captured.file.path !== file.path ? { currentPath: file.path,
        pathNote: 'path 保留本次 run 的已观察身份别名；currentPath 是此快照自然地址，跨 run 需按当前目标重新读取。' } : {}),
      ...layoutContext(file), fileKind: file.kind, target: file.target, ...(file.editingContext ? { editingContext: file.editingContext } : {}),
      ...(selector ? { project: selector } : {}), regionStatus: target?.region ? 'explicit' : instanceId ? 'current-object' : 'unresolved',
      ...(target?.region ? { region: structuredClone(target.region) } : {}),
      ...(!instanceId && !target?.region ? { regionNote: 'viewport 是当前目标的内部尺寸；新内容区域仍由本次意图确定，未默认整页。' } : {}),
      ...(surface ? { surface: { title: surface.title, kind: surface.kind } } : {}),
      ...(instanceId ? { content: snippets(instanceId) } : {}), neighbors }
  }

  /** Introduce result addresses only from existing ACK projections; never adopt unread human values. */
  private async contentReceipt(runId: string, selector: string | undefined, inputPath: string,
    baseline: ComponentProjectSnapshot, original: ComponentProjectFile, result: ContentApplyResult,
    scope: ComponentProjectFileScope = { kind: 'document' }, enhancementId?: string): Promise<ToolResult> {
    const data = { path: inputPath, ...publicContentApplyReceipt(result) }
    if (result.commit !== 'committed' && result.commit !== 'unchanged') {
      let repair = this.repairDetails(runId, baseline, original, inputPath, selector)
      try { repair = this.repairDetails(runId, await this.host.document(runId, selector, 'read'), original, inputPath, selector) } catch { /* captured paths remain readable repair context */ }
      if (result.commit === 'unknown') return { kind: 'read', data: { ...data, ...repair,
        repair: { read: repair.repair.read, next: '本次提交效果未知；保留原回执，先沿原操作和当前文件查证，不重新应用原输入。' } } }
      return { kind: 'read', data: { ...data, ...repair, diagnostics: result.diagnostics.map(item => ({ ...item, file: item.file ?? inputPath, repairable: item.repairable ?? true })) } }
    }
    const resolvesPaths = result.insertedIds.length > 0 || ['definition', 'definition-source', 'instance-source'].includes(original.binding?.kind ?? '')
    if (!resolvesPaths && !original.programViewport)
      return { kind: 'read', data }
    try {
      const after = await this.host.document(runId, selector, 'read')
      if (!resolvesPaths) {
        // Content writes preserve identity. Read geometry from its owner instead
        // of materializing every source/project file once per batch child.
        const state = scope.state
        if (state && !after.model.project.surfaces.find(value => value.id === state.surfaceId)
          ?.presentation?.states.some(value => value.id === state.stateId)) throw new Error('展示状态已不存在，请读取当前目标。')
        const project = state ? resolveComponentPresentation(after.model.project, state.surfaceId, state.stateId) : after.model.project
        const layouts = componentProjectLayoutViewports(project), target = original.target
        const instanceId = target?.kind === 'instance' ? target.instanceId
          : target?.kind === 'container' && target.container.kind === 'instance' ? target.container.instanceId : undefined
        const instance = instanceId ? project.instances[instanceId] : undefined
        const viewport = instanceId ? layouts.instances.get(instanceId)
          : target?.kind === 'container' ? target.container.kind === 'surface' ? layouts.surfaces.get(target.container.surfaceId)
            : target.container.kind === 'global' ? layouts.fallback : undefined : undefined
        return { kind: 'read', data: { ...data, ...(instance?.frame ? { frame: structuredClone(instance.frame) } : {}),
          ...(viewport ? { viewport } : {}) } }
      }
      const currentFiles = authoringFiles(after, scope.state)
      const resolved = componentProjectApplyReceiptFiles(baseline, original, result, after, scope)
      const prefix = fileKey(baseline.documentId, '', scope), reads = this.reads.get(runId)
      const observations = [...(reads?.entries() ?? [])].filter(([savedKey, seen]) => savedKey.startsWith(prefix)
        && !seen.unavailable && seen.snapshot.epoch === baseline.epoch).map(([, seen]) => seen)
      const explained = [...new Set(observations.map(seen => seen.snapshot))].map(snapshot => ({ snapshot,
        files: authoringFiles(snapshot, scope.state) }))
      const collisions: string[] = [], unread: string[] = [], available = new Set<string>()
      let entryBytesRemaining = Math.floor(MODEL_DELIVERY_BYTES / 3)
      const sourceFacts = new Map<string, { content?: string; complete: boolean; revision: number; currentRevision: number; staleSnapshot?: true } & ReturnType<typeof layoutContext>>()
      for (const file of resolved.files) {
        const writtenEnhancement = enhancementId !== undefined && file.authorSource?.dependencyId === enhancementId
        const occupied = reads?.get(fileKey(baseline.documentId, file.path, scope))
        if (occupied && (occupied.unavailable || !sameFile(occupied.file, file))) { collisions.push(file.path); continue }
        let known = occupied ?? observations.find(seen => sameFile(seen.file, file))
          ?? explained.flatMap(({ snapshot, files }) => {
            const match = files.find(value => sameFile(value, file))
            return match ? [{ snapshot, file: match }] : []
          })[0]
        const committedRevision = result.receipt && 'revision' in result.receipt ? result.receipt.revision : undefined
        if (!known && writtenEnhancement && after.revision === committedRevision) {
          this.remember(runId, after, [file], true, scope)
          known = { snapshot: after, file }
        }
        if (!known) { unread.push(file.path); continue }
        // Metadata relocates only an existing ACK baseline. It never adopts an
        // unread value from the current document just because its path is listed.
        if (!occupied) this.remember(runId, known.snapshot, [{ ...known.file, path: file.path }], false, scope)
        available.add(file.path)
        if (file.kind !== 'source' || file.authorSource?.dependencyId && !writtenEnhancement || known.file.content === undefined) continue
        const instanceId = file.target?.kind === 'instance' ? file.target.instanceId : undefined
        const instance = instanceId ? known.snapshot.model.project.instances[instanceId] : undefined
        const implementation = instance && (instance.implementationOverride ?? known.snapshot.model.project.definitions[instance.definitionId]?.implementation)
        const generatedProgramEntry = result.insertedIds.length > 0 && instanceId && !baseline.model.project.instances[instanceId]
          && implementation?.kind === 'builtin' && ['guoling.web', 'guoling.html-program'].includes(implementation.key)
        const writtenSource = original.kind === 'source' && sameFile(original, file)
        if (!generatedProgramEntry && !writtenSource && !writtenEnhancement) continue
        // At the exact commit revision the returned Source is an actual read.
        // Otherwise retain only the command's ACK facts, not a later human edit.
        const captured = after.revision === committedRevision
        const source = captured ? { snapshot: after, file } : known
        if (committedRevision !== undefined && source.snapshot.revision < committedRevision || source.file.content === undefined) continue
        // Submitted bodies are already known through the command ACK. Only a useful,
        // actually delivered generated entry can introduce a new read baseline.
        const entryBytes = new TextEncoder().encode(source.file.content).byteLength
        const complete = !!generatedProgramEntry && !writtenSource && !writtenEnhancement && entryBytes <= entryBytesRemaining
        if (complete) {
          entryBytesRemaining -= entryBytes
          this.remember(runId, source.snapshot, [{ ...source.file, path: file.path }], captured, scope)
        }
        sourceFacts.set(file.path, { ...(complete ? { content: source.file.content } : {}), complete,
          ...layoutContext(source.file), revision: source.snapshot.revision,
          currentRevision: after.revision, ...(source.snapshot.revision !== after.revision ? { staleSnapshot: true } : {}) })
      }
      const currentPath = resolved.primary?.path
      const primary = resolved.primary
      const currentLayout = primary && currentFiles.find(file => sameFile(primary, file))
      return { kind: 'read', data: { ...data, ...layoutContext(currentLayout),
        ...(enhancementId ? { enhancementPath: resolved.files.find(file => file.authorSource?.dependencyId === enhancementId)?.path } : {}),
        files: listedFiles(resolved.files).map(file => ({ ...file, ...sourceFacts.get(file.path) })), currentRevision: after.revision,
        ...(currentPath ? available.has(currentPath) ? { path: currentPath } : { currentPath } : {}),
        ...(collisions.length ? { next: '部分当前文件路径与此前观察重名；按 repair.read 的 project.read refresh:true 局部刷新对应文件。', refreshPaths: collisions,
          repair: { read: collisions.map(path => ({ tool: 'project.read', input: { ...(selector ? { project: selector } : {}), path, refresh: true } })) } }
          : unread.length ? { next: '这些文件路径已有结果，但尚无已观察内容；继续修改前使用 project.read。', readPaths: unread } : {}) } }
    } catch (error) {
      return { kind: 'read', data: { ...data, diagnostics: [...result.diagnostics,
        { level: 'warning', code: 'content-paths-unavailable', message: error instanceof Error ? error.message : String(error) }] } }
    }
  }

  private async applyFiles(runId: string, operationId: string, requestDigest: string,
    input: { project?: string; operations: z.infer<typeof contentApplyFileSchema>[] }): Promise<ToolResult> {
    if (!this.host.applyBatch) return failure('service-unavailable', '当前宿主没有同批工程内容规划服务。')
    const prepared: { baseline: ComponentProjectSnapshot; request: ContentApplyRequest; path: string; file: ComponentProjectFile }[] = []
    const outcomes: ToolResult[] = []
    const positions: number[] = []
    for (const [operationIndex, operation] of input.operations.entries()) {
      const current = await this.host.document(runId, input.project, 'write')
      let captured: ReturnType<ComponentProjectFileCoordinator['captureFile']>
      try { captured = this.captureFile(runId, current, operation.path, false, input.project) }
      catch (error) { outcomes.push(failure('target-not-found', `operations[${operationIndex}] ${error instanceof Error ? error.message : String(error)}`,
        { operationIndex, path: operation.path, repair: { read: [{ tool: 'project.read', input: { ...(input.project ? { project: input.project } : {}), path: operation.path, refresh: true } }] } })); continue }
      let item: typeof prepared[number] | undefined
      const result = await this.execute(runId, operationId, requestDigest, 'project.apply', { ...operation, project: input.project },
        async (_run, _operation, _digest, baseline, request) => {
          item = { baseline, request, path: operation.path, file: captured.file }
          return { commit: 'not_committed', usability: 'unverified', delivery: 'not_requested', diagnostics: [], insertedIds: [], input: request }
        })
      positions.push(outcomes.length)
      outcomes.push(result.kind === 'error' ? { ...result, message: `operations[${operationIndex}] ${result.message}`,
        data: { ...(result.data && typeof result.data === 'object' ? result.data : {}), operationIndex, path: operation.path } } : result)
      if (item) prepared.push(item)
      else positions.pop()
    }
    const preparationDiagnostics = outcomes.flatMap(result => result.kind === 'error'
      ? [{ level: 'error' as const, code: result.code, message: result.message, repairable: true }] : [])
    if (!prepared.length) return { kind: 'read', data: { commit: 'not_committed', usability: 'unusable', delivery: 'not_requested',
      diagnostics: preparationDiagnostics, insertedIds: [], operations: outcomes } }
    // Project only this batch's successful edits onto old observations; current unread human values stay unread.
    const planning = new ComponentProjectFileCoordinator(this.host)
    planning.reads.set(runId, new Map(this.reads.get(runId)))
    const items: ComponentProjectFileBatchItem[] = prepared.map((item, index) => ({ ...item,
      acknowledge: command => planning.acknowledge(runId, item.baseline.documentId, item.baseline.epoch, item.baseline.revision, command),
      ...(item.file.authorSource || item.file.sourceFile ? { reprepare: async () => {
        let refreshed: { baseline: ComponentProjectSnapshot; request: ContentApplyRequest } | undefined
        const operation = input.operations[positions[index]!]!
        const result = await planning.execute(runId, operationId, requestDigest, 'project.apply', { ...operation, project: input.project },
          async (_run, _id, _digest, baseline, request) => {
            refreshed = { baseline, request }
            return { commit: 'not_committed', usability: 'unverified', delivery: 'not_requested', input: request, insertedIds: [], diagnostics: [] }
          })
        if (!refreshed) throw new Error(result.kind === 'error' ? result.message : '原Source文件不能在本批候选上继续准备。')
        return refreshed
      } } : {}),
    }))
    const results = await this.host.applyBatch(runId, operationId, requestDigest, items)
    for (const [index, item] of prepared.entries()) {
      const scope = this.host.scope?.(runId, input.project, item.baseline)
      const outcome = await this.contentReceipt(runId, input.project, item.path, item.baseline, item.file, results[index]!, scope)
      if (outcome.kind === 'read' && outcome.data && typeof outcome.data === 'object') {
        const { receipt: _commonReceipt, ...local } = outcome.data as Record<string, unknown>
        outcomes[positions[index]!] = { ...outcome, data: { ...local, operationIndex: positions[index] } }
      } else outcomes[positions[index]!] = outcome
    }
    const first = results.find(result => result.receipt || result.commit === 'unknown') ?? results[0]!
    return { kind: 'read', data: { commit: first.commit, ...(first.receipt ? { receipt: publicOperationReceipt(first.receipt) } : {}), delivery: 'not_requested',
      usability: outcomes.some(result => result.kind === 'error') || results.some(result => result.usability === 'partial' || result.usability === 'unusable')
        ? 'partial' : results.some(result => result.usability === 'unverified') ? 'unverified' : 'usable',
      diagnostics: [...preparationDiagnostics, ...results.flatMap(result => result.diagnostics)],
      insertedIds: results.flatMap(result => result.insertedIds), operations: outcomes } }
  }

  /** New-page identities stay inside the existing sequential candidate batch. */
  private async addSurfaceDrafts(runId: string, operationId: string, requestDigest: string,
    baseline: ComponentProjectSnapshot, request: Extract<SurfaceApplyRequest, { intent: 'surface.add' }>,
    drafts: { content?: string; from?: string; region?: ComponentFrame }[]): Promise<ContentApplyResult> {
    if (!this.host.applyBatch) throw new Error('当前宿主没有同批工程内容规划服务。')
    let surfaceIds: string[] = []
    const operations: ComponentProjectFileBatchItem[] = [{ baseline, request,
      acknowledge: command => { surfaceIds = command.edits.flatMap(edit => edit.type === 'surface.insert' ? [edit.surface.id] : []) } }]
    for (const [index, draft] of drafts.entries()) {
      if (draft.content === undefined && draft.from === undefined) continue
      operations.push({ baseline, request: { intent: 'canonical', edits: [] }, candidateTarget: true,
        reprepare: async candidate => {
          const surfaceId = surfaceIds[index]
          const file = authoringFiles(candidate).find(file => file.kind === 'structure' && surfaceIdOf(file) === surfaceId)
          if (!file?.target) throw new Error('本批新页面尚未准备，首稿未应用。')
          const preparationFile = draft.region ? { ...file, programViewport: { width: draft.region.width, height: draft.region.height } } : file
          const actual = draft.from !== undefined ? await this.host.source(runId, draft.from, candidate, draft.content)
            : { filename: file.path.replace(/\.json$/, '.html'), bytes: new TextEncoder().encode(draft.content ?? ''), text: draft.content ?? '' }
          actual.assetContext = projectAssetContext(candidate, file)
          let source = this.host.prepareSource ? await this.host.prepareSource(actual, preparationFile, 'insert', runId)
            : actual.text !== undefined ? componentFileContentSource(file, actual.text, actual)
              : (() => { throw new Error('新页首稿需要可读取的内容源文。') })()
          if (draft.from === undefined && source.kind === 'html') { const { original: _original, ...literal } = source; source = literal }
          return { baseline: candidate, request: { intent: 'insert', target: file.target, source,
            ...(actual.diagnostics?.length ? { diagnostics: actual.diagnostics } : {}), ...(draft.region ? { region: draft.region } : {}) } }
        } })
    }
    const results = await this.host.applyBatch(runId, operationId, requestDigest, operations)
    const first = results[0]!
    return { ...first, diagnostics: results.flatMap(result => result.diagnostics),
      usability: results.some(result => result.usability === 'unusable' || result.usability === 'partial') ? 'partial'
        : results.some(result => result.usability === 'unverified') ? 'unverified' : 'usable' }
  }

  async execute(runId: string, operationId: string, requestDigest: string, name: ComponentProjectFileToolName, raw: unknown,
    captureApply?: ComponentProjectFileHost['apply']): Promise<ToolResult> {
    let repairContext: { snapshot: ComponentProjectSnapshot; file: ComponentProjectFile; path: string; project?: string } | undefined
    try {
      const apply = captureApply ?? this.host.apply.bind(this.host)
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
        const reread = { tool: 'project.read', input: { ...(input.project ? { project: input.project } : {}), path: input.path,
          ...(input.query ? { query: input.query } : {}), refresh: true, ...(offset ? { offset } : {}) } }
        if (offset && !input.refresh && (!seen?.pagination || seen.pagination.query !== input.query))
          return failure('read-page-unavailable', '此文件没有对应的固定来源续页；可局部读取当前稿。', { repair: { read: [reread] } })
        if (offset && !input.refresh && seen?.pagination?.snapshot.epoch !== current.epoch)
          return failure('project-changed', '工程身份已变化；可局部读取当前稿。', { repair: { read: [reread] } })
        const captured = offset && !input.refresh ? seen?.pagination : undefined
        const snapshot = captured?.snapshot ?? current
        const projected = captured ? [] : componentProjectScopeFiles(snapshot.model.project, authoringFiles(snapshot, scope?.state), scope ?? { kind: 'document' })
        const currentFile = seen && !input.refresh && seen.snapshot.epoch === current.epoch
          ? projected.find(file => sameFile(seen.file, file)) : projected.find(file => file.path === input.path)
        const file = captured?.file ?? (currentFile ? { ...currentFile, path: input.path } : undefined)
        if (!file) return failure('not-found', `没有这个工程文件：${input.path}`, { repair: { read: [reread] } })
        this.remember(runId, snapshot, [file], true, scope)
        if (file.target) this.focusedTargets.set(runId, { path: input.path, ...(input.project ? { project: input.project } : {}) })
        const saved = this.reads.get(runId)!.get(fileKey(current.documentId, input.path, scope))!
        saved.pagination = captured ?? { snapshot: saved.snapshot, file: saved.file, ...(input.query ? { query: input.query } : {}) }
        const version = { documentId: snapshot.documentId, epoch: snapshot.epoch, revision: snapshot.revision, currentRevision: current.revision,
          basis: captured ? 'captured' : 'current',
          ...(snapshot.revision !== current.revision ? { staleSnapshot: true, refresh: reread, next: '正在续读固定来源；用 refresh 入口可局部读取当前稿。' } : {}) }
        const metadata = { path: file.path, type: file.kind, ...layoutContext(file), ...version,
          ...(file.summary ? { summary: file.summary } : {}), ...(file.references ? { references: file.references } : {}) }
        if (file.content === undefined) return { kind: 'read', data: { ...metadata, mimeType: file.mimeType, byteLength: file.bytes?.byteLength ?? 0 } }
        if (input.query) {
          const found = literalTextMatches(file.content, input.query, { offset,
            limit: Math.min(input.limit ?? 20, Math.max(1, Math.floor(MODEL_DELIVERY_BYTES / 512))) })
          return { kind: 'read', data: { ...metadata, query: input.query, matches: found.matches, offset, total: file.content.length,
            ...(found.truncated ? { nextOffset: found.offset } : {}) } }
        }
        const requestedEnd = Math.min(file.content.length, offset + (input.limit ?? file.content.length))
        let end = modelTextEnd(file.content, offset, requestedEnd, Math.max(1024, MODEL_DELIVERY_BYTES - modelJsonBytes(metadata) - 1024))
        if (end < file.content.length && /[\uD800-\uDBFF]/u.test(file.content[end - 1] ?? '') && /[\uDC00-\uDFFF]/u.test(file.content[end] ?? '')) end--
        if (end === offset && offset < file.content.length) end = Math.min(offset + 2, file.content.length)
        return { kind: 'read', data: { ...metadata, content: file.content.slice(offset, end),
          complete: offset === 0 && end === file.content.length,
          ...(input.full && end < file.content.length ? { requestedFull: true,
            next: '本次容量内仅交付此页；nextOffset继续同一固定版本，完整内容仍在原工程文件。' } : {}),
          ...(file.note ? { note: file.note } : {}), ...(offset || end < file.content.length ? { offset, total: file.content.length } : {}),
          ...(end < file.content.length ? { nextOffset: end } : {}) } }
      }
      const parsedInput = componentProjectFileSchemas['project.apply'].parse(raw)
      if ('operations' in parsedInput) return this.applyFiles(runId, operationId, requestDigest, parsedInput)
      let input = parsedInput
      const projectionEdit = 'edits' in input
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
      if (file) repairContext = { snapshot: current, file, path: input.path, project: input.project }
      if (scope?.kind === 'graph' && (input.intent && input.intent !== 'content' || file?.binding?.kind !== 'spatial'))
        return failure('not-authorized', '空间图项目标只能修改已观察的当前空间源文中的所选图项')
      if (scope?.state && (input.intent?.startsWith('surface.') || file?.binding?.kind === 'flow' || file?.binding?.kind === 'spatial'
        || file?.target && !['data', 'style', 'source', 'asset'].includes(file.kind)))
        return failure('state-file-target-required', '该工程路径是基础结构或 HTML 源文，不能写入展示状态。请沿用此状态 target 使用 object.update 或 presentation.update；状态 data/style 文件可直接 project.apply。')
      if ('edits' in input) {
        if (!seen) return failure('file-not-observed', '局部替换需要已观察的工程文件；请先用 project.list 或 project.read 读取该路径。')
        if (seen.file.content === undefined) return failure('file-text-required', '该工程文件不是文本；请沿用 content 或授权工作区 from 修改原格式内容。')
        let content = seen.file.content
        for (const [index, edit] of input.edits.entries()) {
          const start = content.indexOf(edit.old)
          if (start < 0) return failure('edit-mismatch', `第 ${index + 1} 处原文未出现在已观察的文件中；请重新读取并提供准确原文。`)
          if (content.indexOf(edit.old, start + 1) >= 0)
            return failure('edit-ambiguous', `第 ${index + 1} 处原文出现多次；请提供更长且唯一的原文。`)
          content = content.slice(0, start) + edit.new + content.slice(start + edit.old.length)
        }
        // Only the candidate changes: keep the captured file/baseline and the original request digest.
        input = { project: input.project, path: input.path, intent: input.intent, region: input.region, content }
      }
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
        if (input.intent === 'surface.add') {
          if ('pages' in input) {
            const pages = input.pages.map(page => {
              const before = page.before === undefined ? undefined : this.reads.get(runId)?.get(fileKey(current.documentId, page.before, scope))
                ?? { file: componentProjectFiles(baseline.model.project, baseline.model.resources).find(value => value.path === page.before) }
              const id = surfaceIdOf(before?.file)
              if (page.before !== undefined && (!id || 'unavailable' in before! && before!.unavailable)) throw new Error(`没有这个页面位置：${page.before}`)
              return { kind: page.kind, title: page.title, ...(id ? { beforeSurfaceId: id } : {}) }
            })
            request = { intent: input.intent, pages }
          } else request = { intent: input.intent, kind: input.kind, title: input.title,
            ...(beforeSurfaceId !== undefined ? { beforeSurfaceId } : {}) }
        }
        else {
          const surfaceId = surfaceIdOf(file)
          if (!surfaceId) return failure('target-not-found', `没有这个页面：${input.path}`)
          request = input.intent === 'surface.move' ? { intent: input.intent, surfaceId,
            ...(beforeSurfaceId !== undefined ? { beforeSurfaceId } : {}) }
            : input.intent === 'surface.title' ? { intent: input.intent, surfaceId, title: input.title }
              : { intent: input.intent, surfaceId }
        }
        const drafts = input.intent === 'surface.add' ? ('pages' in input ? input.pages : [input]) : []
        const result = request.intent === 'surface.add' && drafts.some(draft => draft.content !== undefined || draft.from !== undefined)
          ? await this.addSurfaceDrafts(runId, operationId, requestDigest, baseline, request, drafts)
          : await apply(runId, operationId, requestDigest, baseline, request)
        if (result.commit !== 'committed' && result.commit !== 'unchanged') return { kind: 'read', data: { path: input.path, ...publicContentApplyReceipt(result) } }
        try {
          const after = await this.host.document(runId, input.project, 'read')
          const files = componentProjectFiles(after.model.project, after.model.resources)
          if (request.intent === 'surface.add') {
            const observations = this.reads.get(runId)
            const targets = result.insertedIds.map(surfaceId => {
              const nextFile = files.find(value => value.kind === 'structure' && surfaceIdOf(value) === surfaceId)
              if (!nextFile) throw new Error(`新页面没有正式文件路径：${surfaceId}`)
              let resolvedPath = nextFile.path, suffix = 2
              while (observations?.has(fileKey(current.documentId, resolvedPath, scope))
                && !sameFile(observations.get(fileKey(current.documentId, resolvedPath, scope))!.file, nextFile)) {
                resolvedPath = nextFile.path.replace(/\.json$/, '') + `-${suffix++}.json`
              }
              this.remember(runId, after, [{ ...nextFile, path: resolvedPath }], true, scope)
              const surface = after.model.project.surfaces.find(value => value.id === surfaceId)!
              return { surfaceId, path: resolvedPath, kind: surface.kind, title: surface.title,
                order: after.model.project.surfaces.indexOf(surface) }
            })
            return { kind: 'read', data: { path: targets[0]?.path ?? input.path, ...publicContentApplyReceipt(result), targets } }
          }
          const surfaceId = request.intent === 'surface.remove' ? undefined : request.surfaceId
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
          return { kind: 'read', data: { path: introduced && nextFile ? nextFile.path : input.path, ...publicContentApplyReceipt(result),
            ...(collision ? { next: '页面路径与此前观察重名；调用 project.list 读取当前目录。' }
              : nextFile && !introduced ? { next: '页面已提交；调用 project.list 读取当前目录。' } : {}) } }
        } catch (error) {
          // A subsequent observation failure cannot erase the canonical commit receipt.
          return { kind: 'read', data: { path: input.path, ...publicContentApplyReceipt(result), diagnostics: [...result.diagnostics,
            { level: 'warning', code: 'framework-paths-unavailable', message: error instanceof Error ? error.message : String(error) }] } }
        }
      }
      if (input.intent === 'enhance') {
        if (file?.binding?.kind !== 'instance-source' || file.authorSource?.dependencyId
          || file.sourceFile && file.sourceFile.path !== file.implementation?.workspace?.entry)
          return failure('enhancement-target-required', '局部增强需使用当前实例的主 .view.js/.view.ts 或 workspace 入口路径；共享定义与依赖继续用 content 修改实际源码。')
        const actual = 'from' in input ? await this.host.source(runId, input.from, baseline, input.content) : undefined
        const content = actual ? actual.text : 'content' in input ? input.content : undefined
        const fresh: ComponentProjectFile = { ...file, sourceFile: undefined, authorSource: undefined,
          implementation: { kind: 'source', language: file.language ?? 'javascript', source: '' } }
        const source = actual && this.host.prepareSource ? await this.host.prepareSource(actual, fresh, 'content', runId)
          : content !== undefined ? componentFileContentSource(fresh, content, actual) : undefined
        if (source?.kind !== 'data' || source.implementation?.kind !== 'source') throw new Error('局部增强需要普通 JavaScript/TypeScript 业务模块')
        const edits = [...actual?.resourceEdits ?? [], ...source.componentFiles ?? [],
          ...componentAuthorEnhancementEdits(baseline.model.project, baseline.model.resources, file.binding.instanceId, source.implementation)]
        const instanceId = file.binding.instanceId
        const id = edits.filter(edit => edit.type === 'implementation.set' && edit.instanceId === instanceId).at(-1)
        const enhancementId = id?.type === 'implementation.set' && id.implementation?.kind === 'source' ? id.implementation.moduleBindings?.['./enhancement'] : undefined
        const result = await apply(runId, operationId, requestDigest, baseline, { intent: 'canonical', edits, diagnostics: actual?.diagnostics })
        return this.contentReceipt(runId, input.project, input.path, baseline, file, result, scope, enhancementId)
      }
      if (file?.binding) {
        const intent = input.intent ?? 'content'
        if (intent === 'insert' || intent === 'redo') return failure('file-content-required', '此路径修改已存在的正式字段；向页面插入或重做请使用页面结构路径。')
        let actual = 'from' in input ? await this.host.source(runId, input.from, baseline, input.content) : undefined
        let content = actual ? actual.text : 'content' in input ? input.content : undefined
        let source: ContentApplySource | undefined
        if (file.binding.kind === 'flow' || file.binding.kind === 'theme') {
          actual ??= { filename: file.path, bytes: new TextEncoder().encode(content ?? ''), text: content }
          actual.assetContext = projectAssetContext(baseline, file)
          if (this.host.prepareSource) {
            source = await this.host.prepareSource(actual, file, intent, runId)
            if (source.kind === 'html') content = source.html
            else if (source.kind === 'data' && typeof source.fields[0]?.value === 'string') content = source.fields[0].value
          }
        } else if ((file.binding.kind === 'definition-source' || file.binding.kind === 'instance-source') && !(file.kind === 'asset' && actual?.text === undefined)) {
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
        const result = await apply(runId, operationId, requestDigest, baseline, { intent: 'canonical', edits, diagnostics })
        return this.contentReceipt(runId, input.project, input.path, baseline, file, result, scope)
      }
      if (!file?.target) return failure('target-not-found', `没有可应用的工程目标：${input.path}`)
      // Literal CSS/JS inside .content.html belongs to the observed HTML owner,
      // not to the canonical theme/style planner. Normalize before source preparation.
      const intent = input.intent === 'style' && file.kind === 'html' && file.path.endsWith('.content.html')
        ? 'content' : input.intent ?? (file.kind === 'style' ? 'style' : 'content')
      if (file.kind === 'structure' && intent === 'content') return failure('content-target-required', '这是工程结构观察；请修改同名目录中的对象内容，或明确插入/重做意图。',
        { commit: 'not_committed', ...this.repairDetails(runId, current, file, input.path, input.project) })
      if (file.kind === 'html' && file.note && !file.projection && intent === 'content') return failure('professional-target-required', file.note,
        { commit: 'not_committed', ...this.repairDetails(runId, current, file, input.path, input.project) })
      const actual = 'from' in input ? await this.host.source(runId, input.from, baseline, input.content) : undefined
      const effectiveRegion = input.region ?? taskTargetRegion(actual?.metadata?.targetContext, {
        documentId: baseline.documentId, epoch: baseline.epoch, target: file.target, editingContext: file.editingContext })
      const placement = contentPlacementRegion({ intent, target: file.target, region: effectiveRegion })
      const preparationFile = placement ? { ...file, programViewport: { width: placement.width, height: placement.height } } : file
      let source: ContentApplySource
      let sourceDiagnostics: ContentApplyDiagnostic[] | undefined
      if (actual) {
        actual.assetContext = projectAssetContext(baseline, file)
        source = this.host.prepareSource ? await this.host.prepareSource(actual, preparationFile, intent, runId)
          : actual.text !== undefined ? componentFileContentSource(file, actual.text, actual) : (() => { throw new Error('当前文件需要专业资源适配；原始字节已保留。') })()
        sourceDiagnostics = actual.diagnostics
      } else {
        source = componentFileContentSource(file, input.content!)
        const resourceNamespace = file.kind === 'html' || file.kind === 'page' ? 'project' as const : undefined
        if (source.kind === 'html' && resourceNamespace) source = { ...source, resourceNamespace }
        if (this.host.prepareSource && source.kind === 'html') {
          const actual: ComponentProjectFileInput = { filename: file.path, bytes: new TextEncoder().encode(input.content!), text: input.content!,
            assetContext: projectAssetContext(baseline, file), ...(resourceNamespace ? { resourceNamespace } : {}) }
          const prepared = await this.host.prepareSource(actual, preparationFile, intent, runId)
          sourceDiagnostics = actual.diagnostics
          // Literal tool content is already journaled; only a supplied file has an original file asset.
          if (prepared.kind === 'html') { const { original: _original, ...content } = prepared; source = content }
          else source = prepared
        }
      }
      if (file.kind === 'style' && intent === 'style' && source.kind === 'style' && file.target.kind === 'instance') {
        const diagnostics: ContentApplyDiagnostic[] = []
        const context = file.editingContext
        const project = context ? resolveComponentPresentation(baseline.model.project, context.surfaceId, context.stateId) : baseline.model.project
        const instance = project.instances[file.target.instanceId]!
        const style = applyComponentStylePatch(instance.style, source.style, (name, reason) => diagnostics.push(reason === 'geometry'
          ? { level: 'info', code: 'frame-style-preserved', message: `外层 ${name} 由正式 frame 持有，样式修改未改变它。` }
          : { level: 'warning', code: 'unsupported-css-value', message: `${name} 不是当前 CSS consumer 支持的标量样式值，已保留其余样式。`, repairable: true }))
        const edits: ComponentEdit[] = equalComponentValue(instance.style ?? {}, style) ? []
          : [{ type: 'style.set', instanceId: instance.id, path: [], value: style }]
        const mapped = context ? presentationComponentEdits(baseline.model.project, context.surfaceId, context.stateId, edits) : edits
        const result = await apply(runId, operationId, requestDigest, baseline, { intent: 'canonical', edits: mapped, diagnostics })
        return this.contentReceipt(runId, input.project, input.path, baseline, file, result, scope)
      }
      if (source.kind === 'html') source = { ...source, scope: projectionEdit && file.projection ? 'projection' : 'target' }
      const request: ContentApplyRequest = { intent, target: file.target, source, ...(file.projection ? { projection: file.projection } : {}),
        ...(sourceDiagnostics?.length ? { diagnostics: sourceDiagnostics } : {}),
        ...(effectiveRegion ? { region: effectiveRegion } : {}),
        ...(file.editingContext ? { editingContext: file.editingContext } : {}) }
      const result = await apply(runId, operationId, requestDigest, baseline, request)
      return this.contentReceipt(runId, input.project, input.path, baseline, file, result, scope)
    } catch (error) {
      if (error instanceof z.ZodError) {
        const detail = compactToolInputError(error, { name, input: raw as Record<string, unknown> })
        return { ...detail, data: { ...(detail.data as object), commit: 'not_committed',
          ...(repairContext ? this.repairDetails(runId, repairContext.snapshot, repairContext.file, repairContext.path, repairContext.project) : {}) } }
      }
      return failure('project-file-unresolved', error instanceof Error ? error.message : String(error),
        { commit: 'not_committed', ...(repairContext ? this.repairDetails(runId, repairContext.snapshot, repairContext.file, repairContext.path, repairContext.project) : {}) })
    }
  }
}
