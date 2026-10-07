import { z } from 'zod'
import type { DocumentSnapshot } from '../../../shared/workbench/document'
import type { ToolResult } from '../../../shared/workbench/tools'
import { componentDefinitionSchema, componentSpatialAuthoringSchema, jsonValueSchema, type ComponentAsset, type ComponentEdit, type ComponentOperationBatch, type CourseProjectV10 } from '../../../shared/contracts/component-platform'
import { captureComponentOperation, equalComponentValue } from '../../drivers/courseV10Operations'
import { CourseV10Driver } from '../../drivers/CourseV10Driver'
import type { ContentApplyDiagnostic, ContentApplyIntent, ContentApplyRequest, ContentApplyResult, ContentApplySource, SurfaceApplyRequest } from '../../contentApply/planning/types'
import { componentProjectFiles, type ComponentProjectFile } from './projection'
import { assetReferencePath, cssUrlReferences } from '../../../shared/composition/projectReferences'
import { flowDocumentEdits } from '../../components/document/flowDocumentProjection'
import { parseDocumentMarkdown } from '../../../shared/document/markdown'
import { bindMarkdownIdentities } from '../../../shared/document/markdownIdentity'
import { alignFlowBlocks, parseFlowHtml } from '../../../shared/document/html'
import { componentSourceAuthoringEdits } from '../../components/source/sourceAuthoringEdits'

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
  /** I binds this baseline to L19 planning and dispatches through the current canonical Session. */
  apply(runId: string, operationId: string, requestDigest: string, baseline: ComponentProjectSnapshot,
    request: ContentApplyRequest): Promise<ContentApplyResult>
  source(runId: string, from: string, snapshot: ComponentProjectSnapshot): Promise<ComponentProjectFileInput>
  /** Existing Markdown/professional/image parsers can normalize real source formats without another writer. */
  prepareSource?(input: ComponentProjectFileInput, file: ComponentProjectFile, intent: ContentApplyIntent): Promise<ContentApplySource>
}
const selector = z.string().min(1).optional(), path = z.string().min(1)
const common = { project: selector, path, intent: z.enum(['content', 'insert', 'style', 'redo']).optional() }
export const componentProjectFileSchemas = {
  'project.list': z.object({ project: selector }).strict(),
  'project.read': z.object({ project: selector, path, offset: z.number().int().nonnegative().optional(), limit: z.number().int().positive().optional() }).strict(),
  'project.apply': z.union([
    z.object({ ...common, content: z.string() }).strict(), z.object({ ...common, from: z.string().min(1) }).strict(),
    z.object({ project: selector, path: z.literal('pages'), intent: z.literal('surface.add'),
      kind: z.enum(['slide', 'flow', 'spatial']), title: z.string().optional(), before: path.optional() }).strict(),
    z.object({ project: selector, path, intent: z.literal('surface.move'), before: path.optional() }).strict(),
    z.object({ project: selector, path, intent: z.literal('surface.remove') }).strict(),
    z.object({ project: selector, path, intent: z.literal('surface.title'), title: z.string() }).strict(),
  ]),
} as const
export type ComponentProjectFileToolName = keyof typeof componentProjectFileSchemas
const failure = (code: string, message: string): ToolResult => ({ kind: 'error', code, message })
const key = (documentId: string, path: string) => `${documentId}\u0000${path}`
const surfaceIdOf = (file: ComponentProjectFile | undefined): string | undefined => file?.target?.kind === 'container'
  && file.target.container.kind === 'surface' ? file.target.container.surfaceId : undefined
const listedFiles = (files: ComponentProjectFile[]) => files.map(({ path, kind, note }) => ({ path, type: kind, ...(note ? { note } : {}) }))
const sameFile = (left: ComponentProjectFile, right: ComponentProjectFile): boolean => left.kind === right.kind
  && (left.binding ? equalComponentValue(bindingIdentity(left), bindingIdentity(right))
    : left.target ? equalComponentValue(left.target, right.target) : !right.target && left.path === right.path)
  && left.sourceFile?.path === right.sourceFile?.path
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

/** Translate a captured file projection into the existing formal edits; never a second store. */
export function canonicalComponentFileEdits(snapshot: ComponentProjectSnapshot, file: ComponentProjectFile,
  content: string | undefined, source?: ContentApplySource, input?: ComponentProjectFileInput, diagnostics: ContentApplyDiagnostic[] = []): ComponentEdit[] {
  const originalProject = snapshot.model.project, binding = file.binding
  const project = input?.resourceEdits?.length ? { ...originalProject, assets: { ...originalProject.assets,
    ...Object.fromEntries(input.resourceEdits.map(edit => [edit.asset.id, edit.asset])) } } : originalProject
  if (!binding) throw new Error('工程文件没有正式字段绑定')
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
    const value = JSON.parse(content), previous = project.surfaces.find(surface => surface.id === binding.surfaceId)?.spatial
    const instanceId = (path: string) => {
      const id = Object.entries(binding.objectPaths).find(([, observed]) => observed === path)?.[0]
      if (!id) throw new Error(`空间引用的对象路径尚未读取：${path}`)
      return id
    }
    const frames = (value.stops as { title?: string; pose: unknown; target?: string }[]).map((stop, index) => ({
      id: previous?.frames[index]?.id ?? crypto.randomUUID(), ...(stop.title !== undefined ? { title: stop.title } : {}), pose: stop.pose,
      ...(stop.target ? { targetInstanceId: instanceId(stop.target) } : {}) }))
    const paths = value.paths?.map((path: { title?: string; stops: number[]; objects?: string[]; style?: unknown }, index: number) => ({
      id: previous?.paths?.[index]?.id ?? crypto.randomUUID(), title: path.title,
      frameIds: path.stops.map(stop => { const frame = frames[stop - 1]; if (!frame) throw new Error(`空间路径引用的镜头不存在：${stop}`); return frame.id }),
      instanceIds: path.objects?.map(instanceId), style: path.style }))
    const relations = value.relations?.map((relation: { from: string; to: string; label?: string; kind?: string }, index: number) => ({
      id: previous?.relations?.[index]?.id ?? crypto.randomUUID(), sourceInstanceId: instanceId(relation.from), targetInstanceId: instanceId(relation.to), label: relation.label, kind: relation.kind }))
    const semanticZoom = value.semanticZoom?.map((rule: { objects: string[]; minZoom: number; maxZoom: number; visible: boolean }, index: number) => ({
      id: previous?.semanticZoom?.[index]?.id ?? crypto.randomUUID(), instanceIds: rule.objects.map(instanceId), minZoom: rule.minZoom, maxZoom: rule.maxZoom, visible: rule.visible }))
    return [{ type: 'spatial.set', surfaceId: binding.surfaceId, spatial: componentSpatialAuthoringSchema.parse({ home: value.home, frames,
      ...(paths ? { paths } : {}), ...(relations ? { relations } : {}), ...(semanticZoom ? { semanticZoom } : {}) }) }]
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
  constructor(private readonly host: ComponentProjectFileHost) {}
  stopRun(runId: string): void { this.reads.delete(runId) }

  private remember(runId: string, snapshot: ComponentProjectSnapshot, files: ComponentProjectFile[], captured = true): void {
    const reads = this.reads.get(runId) ?? new Map()
    // Session reads clone the same immutable version. Share that capture inside this observation owner.
    if (captured) snapshot = [...reads.values()].find(seen => seen.captured && seen.snapshot.documentId === snapshot.documentId
      && seen.snapshot.epoch === snapshot.epoch && seen.snapshot.revision === snapshot.revision)?.snapshot ?? snapshot
    for (const file of files) reads.set(key(snapshot.documentId, file.path), { snapshot, file, captured })
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
      const file = next.files.find(file => sameFile(seen.file, file))
      reads.set(pathKey, file ? { snapshot: next.snapshot, file: { ...file, path: seen.file.path }, ...(seen.pagination ? { pagination: seen.pagination } : {}) }
        : { ...seen, unavailable: true })
    }
  }

  /** Other file-addressed tools share the observed identity instead of resolving a renamed path again. */
  captureFile(runId: string, current: ComponentProjectSnapshot, path: string, requireObserved = false): { snapshot: ComponentProjectSnapshot; file: ComponentProjectFile } {
    const seen = this.reads.get(runId)?.get(key(current.documentId, path))
    if (seen && seen.snapshot.epoch !== current.epoch) throw new Error('工程身份已变化，请读取当前工程文件。')
    if (seen?.unavailable) throw new Error('原工程文件目标已不存在或类型已变化；请用 project.list 或 project.read 读取当前文件。')
    if (seen) return seen
    if (requireObserved) throw new Error('对象路径尚未观察；请先用 project.list 或 project.read 读取当前工程文件。')
    const file = componentProjectFiles(current.model.project, current.model.resources).find(value => value.path === path)
    if (!file) throw new Error(`没有这个工程文件：${path}`)
    return { snapshot: current, file }
  }

  async execute(runId: string, operationId: string, requestDigest: string, name: ComponentProjectFileToolName, raw: unknown): Promise<ToolResult> {
    try {
      if (name === 'project.list') {
        const input = componentProjectFileSchemas[name].parse(raw)
        const snapshot = await this.host.document(runId, input.project, 'read')
        const files = componentProjectFiles(snapshot.model.project, snapshot.model.resources)
        this.forgetDocument(runId, snapshot.documentId)
        this.remember(runId, snapshot, files)
        return { kind: 'read', data: { files: listedFiles(files) } }
      }
      if (name === 'project.read') {
        const input = componentProjectFileSchemas[name].parse(raw)
        const current = await this.host.document(runId, input.project, 'read')
        const seen = this.reads.get(runId)?.get(key(current.documentId, input.path))
        const offset = input.offset ?? 0
        if (offset && seen?.pagination && seen.pagination.snapshot.epoch !== current.epoch) return failure('project-changed', '工程身份已变化，请从文件开头重新读取。')
        if (offset && seen?.unavailable) return failure('target-not-found', '原工程文件目标已不存在或类型已变化；请从文件开头重新读取。')
        const captured = offset ? seen?.pagination : undefined
        const snapshot = captured?.snapshot ?? current
        const file = captured?.file ?? componentProjectFiles(snapshot.model.project, snapshot.model.resources).find(file => file.path === input.path)
        if (!file) return failure('not-found', `没有这个工程文件：${input.path}`)
        this.remember(runId, snapshot, [file])
        const saved = this.reads.get(runId)!.get(key(current.documentId, input.path))!
        saved.pagination = captured ?? { snapshot: saved.snapshot, file: saved.file }
        if (file.content === undefined) return { kind: 'read', data: { path: file.path, type: file.kind, mimeType: file.mimeType, byteLength: file.bytes?.byteLength ?? 0 } }
        const end = Math.min(file.content.length, offset + (input.limit ?? 100_000))
        return { kind: 'read', data: { path: file.path, type: file.kind, content: file.content.slice(offset, end),
          ...(file.note ? { note: file.note } : {}), ...(offset || end < file.content.length ? { offset, total: file.content.length } : {}),
          ...(end < file.content.length ? { nextOffset: end } : {}) } }
      }
      const input = componentProjectFileSchemas['project.apply'].parse(raw)
      const current = await this.host.document(runId, input.project, 'write')
      const seen = this.reads.get(runId)?.get(key(current.documentId, input.path))
      if (seen && seen.snapshot.epoch !== current.epoch) return failure('project-changed', '工程身份已变化，请读取当前工程文件。')
      if (seen?.unavailable) return failure('target-not-found', '原工程文件目标已不存在或类型已变化；请用 project.list 或 project.read 读取当前文件。')
      const baseline = seen?.snapshot ?? current
      const file = seen?.file ?? componentProjectFiles(current.model.project, current.model.resources).find(file => file.path === input.path)
      if (!seen && file) this.remember(runId, baseline, [file])
      if (input.intent === 'surface.add' || input.intent === 'surface.move' || input.intent === 'surface.remove' || input.intent === 'surface.title') {
        let beforeSurfaceId: string | undefined
        if ('before' in input && input.before !== undefined) {
          const observedBefore = this.reads.get(runId)?.get(key(current.documentId, input.before))
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
          const occupied = nextFile && this.reads.get(runId)?.get(key(current.documentId, nextFile.path))
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
              this.remember(runId, known.snapshot, [{ ...known.file, path: nextFile.path }], false)
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
        let actual = 'from' in input ? await this.host.source(runId, input.from, baseline) : undefined
        let content = actual ? actual.text : 'content' in input ? input.content : undefined
        let source: ContentApplySource | undefined
        if (file.binding.kind === 'flow' || file.binding.kind === 'theme') {
          actual ??= { filename: file.path, bytes: new TextEncoder().encode(content ?? ''), text: content }
          actual.assetContext = { assets: baseline.model.project.assets, bytes: baseline.model.resources.assets }
          if (this.host.prepareSource) {
            source = await this.host.prepareSource(actual, file, intent)
            if (source.kind === 'html') content = source.html
            else if (source.kind === 'data' && typeof source.fields[0]?.value === 'string') content = source.fields[0].value
          }
        } else if (file.binding.kind === 'definition-source' && !(file.kind === 'asset' && actual?.text === undefined)) {
          source = actual && this.host.prepareSource ? await this.host.prepareSource(actual, file, intent)
            : content !== undefined ? componentFileContentSource(file, content, actual) : undefined
        } else if (file.binding.kind === 'asset' && file.mimeType?.startsWith('image/')) {
          actual ??= { filename: file.path, bytes: new TextEncoder().encode(content ?? ''), text: content }
          if (this.host.prepareSource) await this.host.prepareSource(actual, file, intent)
        }
        const diagnostics: ContentApplyDiagnostic[] = [...actual?.diagnostics ?? []]
        const edits = [...actual?.resourceEdits ?? [], ...canonicalComponentFileEdits(baseline, file, content, source, actual, diagnostics)]
        const result = await this.host.apply(runId, operationId, requestDigest, baseline, { intent: 'canonical', edits, diagnostics })
        return { kind: 'read', data: { path: input.path, ...result } }
      }
      if (!file?.target) return failure('target-not-found', `没有可应用的工程目标：${input.path}`)
      const intent = input.intent ?? (file.kind === 'style' ? 'style' : 'content')
      if (file.kind === 'structure' && intent === 'content') return failure('content-target-required', '这是工程结构观察；请修改同名目录中的对象内容，或明确插入/重做意图。')
      if (file.kind === 'html' && file.note && !file.projection && intent === 'content') return failure('professional-target-required', file.note)
      let source: ContentApplySource
      if ('from' in input) {
        const actual = await this.host.source(runId, input.from, baseline)
        source = this.host.prepareSource ? await this.host.prepareSource(actual, file, intent)
          : actual.text !== undefined ? componentFileContentSource(file, actual.text, actual) : (() => { throw new Error('当前文件需要专业资源适配；原始字节已保留。') })()
      } else source = componentFileContentSource(file, input.content)
      const request: ContentApplyRequest = { intent, target: file.target, source, ...(file.projection ? { projection: file.projection } : {}) }
      const result = await this.host.apply(runId, operationId, requestDigest, baseline, request)
      return { kind: 'read', data: { path: input.path, ...result } }
    } catch (error) {
      return failure('project-file-unresolved', error instanceof Error ? error.message : String(error))
    }
  }
}
