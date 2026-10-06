import type { DocumentOperationResult } from '../../shared/workbench/document'
import type { ToolResult } from '../../shared/workbench/tools'
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
  if (result.kind === 'document-operation') return { ...result, result: projectReceipt(result.result) }
  // Only this write tool wraps its host receipt in read.data. Explicit reads are authored content.
  if (toolName === 'project.apply' && result.kind === 'read' && contentApplyResult(result.data)) {
    return { ...result, data: { ...result.data, input: projectInput(result.data.input),
      ...(operationReceipt(result.data.receipt) ? { receipt: projectReceipt(result.data.receipt) } : {}) } }
  }
  return result
}
