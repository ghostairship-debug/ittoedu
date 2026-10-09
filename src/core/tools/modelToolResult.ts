import type { DocumentOperationResult } from '../../shared/workbench/document'
import type { ToolResult } from '../../shared/workbench/tools'
import type { ExportReceipt, SaveReceipt } from '../../shared/workbench/toolPorts'
import { agentFileMutationNames } from './AgentFileTools'
import type { ContentApplyRequest, ContentApplyResult, ContentApplySource, ContentObjectDraft } from '../contentApply/planning/types'
import type { ComponentDefinition, ComponentEdit, ComponentImplementation } from '../../shared/contracts/component-platform'

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

function operationReceipt(value: unknown): value is DocumentOperationResult {
  return record(value) && (value.status === 'applied' || value.status === 'unchanged')
    && typeof value.documentId === 'string' && typeof value.operationId === 'string'
    && typeof value.beforeRevision === 'number' && typeof value.revision === 'number'
    && value.persistence === 'recoverable'
}

function projectReceipt(receipt: DocumentOperationResult): DocumentOperationResult {
  if (!('appliedChanges' in receipt) || !receipt.appliedChanges) return receipt
  return { ...receipt, appliedChanges: { ...receipt.appliedChanges,
    changes: receipt.appliedChanges.changes.map(({ value: _value, ...change }) => change),
  } }
}

function contentApplyResult(value: unknown): value is ContentApplyResult & Record<string, unknown> {
  return record(value) && ['committed', 'unchanged', 'not_committed', 'unknown'].includes(String(value.commit))
    && ['usable', 'partial', 'unusable', 'unverified'].includes(String(value.usability))
    && value.delivery === 'not_requested' && Array.isArray(value.diagnostics) && Array.isArray(value.insertedIds)
    && record(value.input) && ['content', 'insert', 'style', 'redo', 'canonical',
      'surface.add', 'surface.move', 'surface.remove', 'surface.title'].includes(String(value.input.intent))
    && (value.input.intent === 'canonical' ? Array.isArray(value.input.edits)
      : String(value.input.intent).startsWith('surface.') ? true
        : record(value.input.target) && record(value.input.source) && (
          value.input.source.kind === 'html' ? typeof value.input.source.html === 'string'
            : value.input.source.kind === 'objects' ? Array.isArray(value.input.source.objects)
              : value.input.source.kind === 'data' ? Array.isArray(value.input.source.fields)
                : value.input.source.kind === 'style' && record(value.input.source.style)))
}

function projectImplementation(implementation: ComponentImplementation | null) {
  if (!implementation || implementation.kind === 'builtin') return implementation
  const { source: _source, ...metadata } = implementation
  return metadata
}

function projectDefinition(definition: ComponentDefinition) {
  const { dataSchema: _schema, implementation, ...metadata } = definition
  return { ...metadata, implementation: projectImplementation(implementation) }
}

function projectObject(object: ContentObjectDraft): unknown {
  return { definitionId: object.definitionId,
    ...(record(object.data) ? { dataFields: Object.keys(object.data) } : {}),
    ...(object.style ? { styleFields: Object.keys(object.style) } : {}),
    ...(object.frame ? { frameFields: Object.keys(object.frame) } : {}),
    ...(object.implementationOverride ? { implementationOverride: projectImplementation(object.implementationOverride) } : {}),
    ...(object.children ? { children: object.children.map(projectObject) } : {}) }
}

/** Summarize only the canonical edit contract, never recursively filter arbitrary authored JSON. */
function projectEdit(edit: ComponentEdit): Record<string, unknown> {
  const summary: Record<string, unknown> = { type: edit.type }
  for (const key of ['instanceId', 'surfaceId', 'definitionId', 'assetId', 'ownerId', 'path', 'container', 'index', 'rootIds'] as const) {
    if (key in edit) summary[key] = (edit as unknown as Record<string, unknown>)[key]
  }
  // Values stay in raw transactions; these field names explain what the operation changed.
  summary.fields = Object.keys(edit).filter(key => key !== 'type' && !(key in summary))
  if (edit.type === 'definition.set') summary.definition = projectDefinition(edit.definition)
  if (edit.type === 'implementation.set') summary.implementation = projectImplementation(edit.implementation)
  if (edit.type === 'component.files.set') summary.files = edit.files === null ? null : Object.keys(edit.files)
  if (edit.type === 'asset.add' || edit.type === 'asset.replace') {
    const { id, path, filename, mimeType, byteLength } = edit.asset
    summary.asset = { id, path, filename, mimeType, byteLength }
  }
  if (edit.type === 'surface.insert') summary.surface = { id: edit.surface.id, kind: edit.surface.kind }
  if (edit.type === 'instance.insert') summary.instances = edit.instances.map(instance => ({ id: instance.id,
    definitionId: instance.definitionId, ...(instance.implementationOverride
      ? { implementationOverride: projectImplementation(instance.implementationOverride) } : {}) }))
  return summary
}

function projectSource(source: ContentApplySource): Record<string, unknown> {
  switch (source.kind) {
    case 'html': return { kind: source.kind, ...(source.scope ? { scope: source.scope } : {}),
      ...(source.themeCss !== undefined ? { themeCssChanged: true } : {}),
      ...(source.siblingFiles ? { siblingFiles: source.siblingFiles instanceof Map
        ? [...source.siblingFiles.keys()] : Object.keys(source.siblingFiles) } : {}),
      ...(source.original ? { original: { filename: source.original.filename, mimeType: source.original.mimeType } } : {}) }
    case 'objects': return { kind: source.kind, objects: source.objects.map(projectObject),
      ...(source.definitions ? { definitions: source.definitions.map(projectDefinition) } : {}),
      ...(source.componentFiles ? { componentFiles: source.componentFiles.map(projectEdit) } : {}) }
    case 'data': return { kind: source.kind, fields: source.fields.map(({ path }) => ({ path })),
      ...(source.implementation !== undefined ? { implementation: projectImplementation(source.implementation) } : {}),
      ...(source.componentFiles ? { componentFiles: source.componentFiles.map(projectEdit) } : {}) }
    case 'style': return { kind: source.kind, fields: Object.keys(source.style) }
  }
}

function projectInput(input: ContentApplyRequest): unknown {
  if (input.intent === 'canonical') return { ...input, edits: input.edits.map(projectEdit) }
  if (!('source' in input)) return input
  const { source, projection, ...metadata } = input
  return { ...metadata, source: projectSource(source),
    ...(projection ? { projection: { entries: projection.entries } } : {}) }
}

/** Model replies describe committed paths; normalized document values stay in the host receipt. */
export function modelToolResult(toolName: string, result: ToolResult): ToolResult {
  // Pixel references are host-only transport input, not authored text or model capabilities.
  if (result.kind === 'read' && result.images) {
    const { images: _images, ...textResult } = result
    result = textResult
  }
  if (result.kind === 'document-operation') return { ...result, result: projectReceipt(result.result) }
  // Only this write tool wraps its host receipt in read.data. Explicit reads are authored content.
  if (toolName === 'project.apply' && result.kind === 'read' && contentApplyResult(result.data)) {
    return { ...result, data: { ...result.data, input: projectInput(result.data.input),
      ...(operationReceipt(result.data.receipt) ? { receipt: projectReceipt(result.data.receipt) } : {}) } }
  }
  return result
}

/** Business receipt facts shared by every consumer; ordinary read data is not a write receipt. */
const revision = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
type SuccessfulReceipt = Extract<DocumentOperationResult, { status: 'applied' | 'unchanged' }>

/** Read only the named write tool's host envelope; authored reads are never execution facts. */
export function contentApplyFact(name: string, result?: ToolResult): ContentApplyResult | null {
  if (name !== 'project.apply' || result?.kind !== 'read' || !record(result.data)) return null
  const data = result.data
  return ['committed', 'unchanged', 'not_committed', 'unknown'].includes(String(data.commit))
    && ['usable', 'partial', 'unusable', 'unverified'].includes(String(data.usability))
    && data.delivery === 'not_requested' && Array.isArray(data.diagnostics) && Array.isArray(data.insertedIds)
    ? data as unknown as ContentApplyResult : null
}

export function operationFact(name: string, result?: ToolResult): DocumentOperationResult | null {
  if (result?.kind === 'document-operation') return result.result
  return contentApplyFact(name, result)?.receipt ?? null
}
export function committedFact(name: string, result?: ToolResult): SuccessfulReceipt | null {
  const apply = contentApplyFact(name, result), receipt = operationFact(name, result)
  if (apply && apply.commit !== 'committed' && apply.commit !== 'unchanged') return null
  return receipt && (receipt.status === 'applied' || receipt.status === 'unchanged')
    && typeof receipt.documentId === 'string' && typeof receipt.operationId === 'string'
    && revision(receipt.beforeRevision) && revision(receipt.revision) && receipt.persistence === 'recoverable' ? receipt : null
}
/** An equivalent content result can be known without a receipt, but supplies no invented revision. */
export function knownApplication(name: string, result?: ToolResult): boolean {
  const apply = contentApplyFact(name, result)
  return !!committedFact(name, result) || apply?.commit === 'committed' || apply?.commit === 'unchanged'
}
export function applicationEventFacts(name: string, result?: ToolResult) {
  const receipt = operationFact(name, result), apply = contentApplyFact(name, result)
  if (receipt) return { applicationStatus: receipt.status, documentId: receipt.documentId,
    ...('revision' in receipt ? { revision: receipt.revision } : { error: receipt.message }) }
  if (apply?.commit === 'unchanged') return { applicationStatus: 'unchanged' as const }
  return {}
}

export function saveFact(name: string, result?: ToolResult): SaveReceipt | null {
  if (!['file.save', 'project.save', 'task.delivery'].includes(name) || result?.kind !== 'read' || !record(result.data)) return null
  const data = result.data
  return data.status === 'saved' && typeof data.documentId === 'string' && revision(data.savedRevision)
    && revision(data.currentRevision) && typeof data.dirty === 'boolean'
    && (name === 'file.save' || typeof data.path === 'string' && typeof data.epoch === 'string')
    ? data as unknown as SaveReceipt : null
}
export const currentSave = (fact: SaveReceipt | null): boolean => !!fact && !fact.dirty && fact.savedRevision === fact.currentRevision

export function exportFact(name: string, result?: ToolResult): ExportReceipt | null {
  if (!['document.export', 'task.delivery'].includes(name) || result?.kind !== 'read' || !record(result.data)) return null
  const data = result.data
  return (data.status === 'written' || data.status === 'generated') && typeof data.documentId === 'string'
    && typeof data.epoch === 'string' && typeof data.format === 'string' && revision(data.exportedRevision)
    && revision(data.currentRevision) && (data.files === undefined || Array.isArray(data.files)) ? data as unknown as ExportReceipt : null
}
export const currentExport = (fact: ExportReceipt | null): boolean => !!fact && fact.status === 'written'
  && fact.exportedRevision === fact.currentRevision

/** Lookup proves the transaction, never runtime usability. Preserve the original apply diagnostics/source. */
export function reconciledToolResult(name: string, previous: ToolResult | undefined, receipt: ToolResult): ToolResult {
  const apply = contentApplyFact(name, previous)
  if (!apply || previous?.kind !== 'read' || receipt.kind !== 'document-operation') return receipt
  return { ...previous, data: { ...apply, receipt: receipt.result,
    commit: receipt.result.status === 'applied' ? 'committed' : receipt.result.status === 'unchanged' ? 'unchanged' : 'not_committed' } }
}

export interface ServiceToolOutcome { status: 'failed' | 'unknown' | 'pending' | 'stopped' | 'saved' | 'generated' | 'written'; message: string }
const fileMutations = new Set<string>(agentFileMutationNames)

/** Only tools whose read receipt is itself a service job use its status for task settlement. */
export const serviceToolOutcome = (name: string, result?: ToolResult): ServiceToolOutcome | null => {
  if (name === 'html.import' && result?.kind === 'error' && result.code === 'html-import-cancelled')
    return { status: 'stopped', message: result.message }
  if (result?.kind !== 'read' || !result.data || typeof result.data !== 'object') return null
  const data = result.data as Record<string, unknown>
  const apply = contentApplyFact(name, result)
  if (apply) {
    const error = apply.diagnostics.find(item => item.level === 'error'), diagnostic = error?.message
    if (apply.commit === 'unknown') return { status: 'unknown', message: diagnostic ?? '内容提交结果未知；请查询原操作回执，不要重放' }
    if (apply.commit === 'not_committed') return { status: 'failed', message: diagnostic ?? '内容修改未提交' }
    // A committed local warning is an application fact, not a failed transaction.
    if (apply.usability === 'unusable' || apply.usability === 'partial' && error)
      return { status: 'failed', message: diagnostic ?? (apply.usability === 'unusable' ? '内容已提交，但当前不能使用' : '内容已提交，仍有局部问题待修复') }
  }
  if (name === 'course.createFromHtml') {
    if (data.status === 'saved' && data.saved === true) return { status: 'saved', message: 'HTML 课件已创建并保存' }
    if (data.status === 'imported') return { status: 'failed', message: typeof data.saveError === 'string' ? data.saveError : 'HTML 已导入，保存尚未成功' }
  }
  if (name === 'course.importPptx' && data.status === 'saved' && record(data.operation) && data.operation.status === 'success')
    return { status: 'saved', message: 'PPTX 已导入并保存为新课件' }
  if ((name === 'office.create' || name === 'office.edit') && data.status === 'saved' && data.saved === true)
    return { status: 'saved', message: 'Office 文件已保存' }
  if (fileMutations.has(name) && data.operation && typeof data.operation === 'object') {
    const operation = data.operation as { status?: unknown; items?: { error?: { message?: string } }[] }
    if (operation.status === 'failed' || operation.status === 'cancelled' || operation.status === 'partial')
      return { status: 'failed', message: operation.items?.find(item => item.error?.message)?.error?.message ?? '文件整理未完整成功' }
  }
  if (fileMutations.has(name) && data.documentResult && typeof data.documentResult === 'object') {
    const document = data.documentResult as { status?: unknown; message?: unknown }
    if (document.status !== 'applied' && document.status !== 'unchanged')
      return { status: 'failed', message: typeof document.message === 'string' ? document.message : '文件文档事务未提交' }
  }
  if(fileMutations.has(name)&&data.operation&&typeof data.operation==='object'
    &&(data.operation as {status?:unknown}).status==='success')return {status:'written',message:'文件操作已完成'}
  if(fileMutations.has(name)&&data.saved===true&&data.dirty!==true&&typeof data.path==='string')
    return {status:'written',message:'文件当前内容已保存'}
  const saved = saveFact(name, result)
  if (saved) return { status: 'saved', message: currentSave(saved) ? '文件已保存' : '文件已保存到原版本，期间的新修改仍未保存' }
  if (name === 'file.save' && data.status === 'saved') return { status: 'saved', message: data.dirty === true ? '文件已保存到原版本，期间的新修改仍未保存' : '文件已保存' }
  if (name === 'file.save' || name === 'project.save') return { status: 'failed', message: typeof data.reason === 'string' ? data.reason : '当前文档保存尚未确认' }
  if (name === 'task.delivery') {
    const exported = exportFact(name, result)
    if (currentExport(exported)) return { status: 'written', message: '导出文件已写入' }
    if (exported?.status === 'generated') return { status: 'failed', message: '导出内容已生成，但尚未写入交付文件' }
    return { status: 'failed', message: typeof data.reason === 'string' ? data.reason : '当前文档交付尚未完成' }
  }
  if (name === 'artifact.save') {
    if (data.status === 'written') return { status: 'written', message: '作业成果已保存为新文件' }
    if (data.status === 'unknown') return { status: 'unknown', message: '成果交付回执未知，请核对目标文件，不要重试同一操作' }
    if (data.status === 'rejected' || data.status === 'conflict' || data.status === 'stopped') return { status: 'failed', message: typeof data.message === 'string' ? data.message : '成果未保存' }
  }
  if (name === 'document.export' && data.status === 'generated') return { status: 'generated', message: '导出内容已生成，尚未写入文件' }
  if (name === 'document.export' && data.status === 'written') return { status: 'written', message: '导出文件已写入' }
  if (name === 'build.compile' && data.ok === false) return { status: 'failed', message: typeof data.message === 'string' ? data.message : '构建语法编译未通过' }
  if (name === 'build.check' && (data.status === 'failed' || data.status === 'cancelled')) {
    return { status: 'failed', message: data.status === 'failed' ? '构建检查未通过，请读取构建日志' : '构建检查已取消' }
  }
  if (name === 'web.search' || name === 'web.open' || name === 'mcp.discover' || name === 'mcp.invoke'
    || name === 'media.start' || name === 'compute.run' || name === 'delegate.start' || name === 'local.run' || name === 'delegate.readonly'
    || name === 'image.search' || name === 'image.preview' || name === 'image.fetch' || name === 'asset.search'
    || name === 'asset.use' || name === 'asset.save') {
    const message = typeof data.reason === 'string' ? data.reason.slice(0, 240) : '外部能力未返回可用成果'
    if (data.status === 'unknown') return { status: 'unknown', message }
    if (name === 'compute.run' && (data.status === 'preparing' || data.status === 'running'))
      return { status: 'pending', message: '受限计算作业仍在运行，请等待并读取成果' }
    if (name === 'delegate.start' && (data.status === 'preparing' || data.status === 'running' || data.status === 'ready'))
      return { status: 'pending', message: '外部委派须等待并回读封存成果' }
    if ((name === 'local.run' || name === 'delegate.readonly') && (data.status === 'preparing' || data.status === 'running' || data.status === 'ready'))
      return { status: 'pending', message: name === 'local.run' ? '本地作业需等待终态并读取退出结果和所需成果' : '只读子任务需等待终态并回读结果' }
    if (data.status === 'not-configured' || data.status === 'rejected' || data.status === 'failed'
      || data.status === 'stopped' || data.status === 'unconfigured' || data.status === 'access-required' || data.status === 'needs-material-reader'
      || (name === 'compute.run' || name === 'delegate.start' || name === 'local.run' || name === 'delegate.readonly') && (data.status === 'cancelled' || data.status === 'unapplied'))
      return { status: 'failed', message }
  }
  if (name === 'image.generate' || name === 'image.edit') {
    const failure = data.failure && typeof data.failure === 'object' ? data.failure as Record<string, unknown> : null
    const message = typeof failure?.message === 'string' && failure.message.trim() ? failure.message.slice(0, 240) : undefined
    // Stopping after dispatch leaves the provider outcome and charge unknown.
    // The user-facing stop flag must not authorize a fresh paid call ID.
    if (data.status === 'unknown' || failure?.outcome === 'unknown') return { status: 'unknown', message: message ?? '图片请求结果未知，未自动重试' }
    if (data.stopped === true) return { status: 'stopped', message: message ?? '图片任务已停止，成果尚未应用' }
    if (data.status === 'failed') return { status: 'failed', message: message ?? '图片请求失败，未得到可应用成果' }
    if (data.status === 'stopped' || data.status === 'unapplied') return { status: 'stopped', message: message ?? '图片任务已停止，成果尚未应用' }
    if (data.status === 'preparing' || data.status === 'running') return { status: 'pending', message: '图片作业仍在运行，请等待并读取成果' }
  }
  return null
}

export const toolFailed = (name: string, result?: ToolResult) => result?.kind === 'error' ||
  result?.kind === 'document-operation' && result.result.status !== 'applied' && result.result.status !== 'unchanged' ||
  !!saveFact(name, result) && !currentSave(saveFact(name, result)) ||
  ['failed', 'unknown', 'pending', 'stopped'].includes(serviceToolOutcome(name, result)?.status ?? '')
