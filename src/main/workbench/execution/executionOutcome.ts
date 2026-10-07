import type { ExecutionRunRecord, ExecutionToolRecord } from '../../../shared/workbench/execution'
import type { ToolResult } from '../../../shared/workbench/tools'
import { USER_QUESTION_TOOL } from '../../../shared/workbench/userQuestion'
import { agentFileMutationNames } from '../../../core/tools/AgentFileTools'
import { committedFact, contentApplyFact, currentSave, knownApplication, operationFact, saveFact, serviceToolOutcome, toolFailed } from '../../../core/tools/modelToolResult'

export const committed = (result?: ToolResult): result is Extract<ToolResult, { kind: 'document-operation' }> =>
  result?.kind === 'document-operation' && (result.result.status === 'applied' || result.result.status === 'unchanged')

export const fileCreated = (name: string, result?: ToolResult): boolean => name === 'file.create' && result?.kind === 'read'
  && !!result.data && typeof result.data === 'object'
  && (result.data as { operation?: { status?: unknown } }).operation?.status === 'success'

export { serviceToolOutcome, toolFailed, type ServiceToolOutcome } from '../../../core/tools/modelToolResult'
const fileMutations = new Set<string>(agentFileMutationNames)

export function persistedToolWork(name: string, result?: ToolResult): boolean {
  const status = serviceToolOutcome(name, result)?.status
  return knownApplication(name, result) || fileCreated(name, result) || status === 'saved' || status === 'written'
}

/** Purpose describes an optional read, never authority or an exception for side effects. */
function optionalObservationFailure(tool: ExecutionToolRecord): boolean {
  if (tool.call.name !== 'view.observe' && tool.call.name !== 'html.observe') return false
  const input = tool.call.input
  if (!input || typeof input !== 'object' || !('purpose' in input) || input.purpose !== 'diagnostic') return false
  if (tool.observationFailure) return tool.observationFailure.outcome !== 'unknown'
  return tool.result?.kind === 'error' && ['observation-failed', 'service-unavailable', 'html-action-failed'].includes(tool.result.code)
}
const failedTool = (tool: ExecutionToolRecord) => !!tool.observationFailure || toolFailed(tool.call.name, tool.result)

const pendingJob = (tool: ExecutionToolRecord): { kind: 'image' | 'compute' | 'delegation'; id: string } | null => {
  if (serviceToolOutcome(tool.call.name, tool.result)?.status !== 'pending' || tool.result?.kind !== 'read') return null
  const data = tool.result.data as { job?: unknown }
  return (tool.call.name === 'image.generate' || tool.call.name === 'image.edit'
    || tool.call.name === 'compute.run' || tool.call.name === 'delegate.start')
    && typeof data.job === 'string' ? { kind: tool.call.name === 'compute.run' ? 'compute'
      : tool.call.name === 'delegate.start' ? 'delegation' : 'image', id: data.job } : null
}
const terminalJobReceipt = (tool: ExecutionToolRecord, pending: { kind: 'image' | 'compute' | 'delegation'; id: string }): boolean => {
  if (tool.result?.kind !== 'read' || toolFailed(tool.call.name, tool.result)) return false
  const data = tool.result.data as { job?: unknown; jobId?: unknown; kind?: unknown; status?: unknown; terminal?: unknown;
    sourceKind?: unknown; sourceId?: unknown; verifiedBytes?: unknown } | null
  if (pending.kind === 'delegation') return tool.call.name === 'delegate.read' && data?.job === pending.id
    && data.status === 'read' && data.verifiedBytes === true
  if (tool.call.name === 'artifact.save') return data?.status === 'written' && data.sourceKind === pending.kind
    && typeof data.sourceId === 'string' && data.sourceId.startsWith(`${pending.id}@`)
  if (!data || (data.job ?? data.jobId) !== pending.id) return false
  if (tool.call.name === 'image.status') return pending.kind === 'image' && data.status === 'ready'
  if (tool.call.name !== 'job.wait' && tool.call.name !== 'job.status') return false
  return data.kind === pending.kind && data.terminal === true
    && data.status === 'ready'
}

function jobOf(tool: ExecutionToolRecord): string | null {
  if (!tool.call.name.startsWith('build.')) return null
  const input = tool.call.input
  if (input && typeof input === 'object' && typeof (input as { job?: unknown }).job === 'string') return (input as { job: string }).job
  const result = tool.result
  if (tool.call.name === 'build.create' && result?.kind === 'read' && result.data && typeof result.data === 'object'
    && typeof (result.data as { job?: unknown }).job === 'string') return (result.data as { job: string }).job
  return null
}

function importedJobs(record: ExecutionRunRecord): Set<string> {
  return new Set(record.tools.flatMap(tool => tool.call.name === 'build.import' && committed(tool.result) && jobOf(tool)
    ? [jobOf(tool)!] : []))
}

/** A final canonical import supersedes earlier failed attempts for that same scratch job. */
const exploratoryNames = new Set(['read', 'inspect', 'listChildren', 'file.list', 'file.search', 'file.grep',
  'material.list', 'material.find', 'tools.load'])
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, child]) => [key, stable(child)]))
  return value
}
/** Identical operation and arguments identify a retry of one concrete request, never a nearby success. */
const origin = (tool: ExecutionToolRecord) => (tool as ExecutionToolRecord & { sourceRunId?: string }).sourceRunId ?? ''
const requestKey = (tool: ExecutionToolRecord) => JSON.stringify([origin(tool), tool.call.name, stable(tool.call.input)])
function sameObservedTarget(failed: ExecutionToolRecord, later: ExecutionToolRecord): boolean {
  if ((failed.call.name !== 'view.observe' && failed.call.name !== 'html.observe') || failed.call.name !== later.call.name
    || later.state !== 'returned' || failedTool(later) || later.result?.kind !== 'read') return false
  const receipt = (tool: ExecutionToolRecord) => tool.result?.kind === 'read' && tool.result.data && typeof tool.result.data === 'object'
    ? tool.result.data as { identity?: { documentId?: unknown; locationId?: unknown }; image?: { resourceId?: unknown } } : null
  const before = receipt(failed), after = receipt(later)
  if (typeof after?.identity?.documentId !== 'string' || typeof after.image?.resourceId !== 'string') return false
  if (typeof before?.identity?.documentId === 'string') return before.identity.documentId === after.identity.documentId
    && before.identity.locationId === after.identity.locationId
  return !!failed.effectTargets?.length && !!later.effectTargets?.length
    && JSON.stringify(stable(failed.effectTargets)) === JSON.stringify(stable(later.effectTargets))
}
/** Correcting a read cursor changes no work. A successful reread must still identify the same source. */
function sameReadSource(failed: ExecutionToolRecord, later: ExecutionToolRecord): boolean {
  if (failed.call.name !== 'file.read' || later.call.name !== 'file.read' || origin(failed) !== origin(later)
    || later.state !== 'returned' || later.result?.kind !== 'read' || failedTool(later)) return false
  const input = (tool: ExecutionToolRecord) => tool.call.input && typeof tool.call.input === 'object'
    ? tool.call.input as { path?: unknown } : null
  const source = input(failed)?.path
  return typeof source === 'string' && source === input(later)?.path
}
/** The changed-facts error rejected the old conclusion before commit. A later
 * model turn may correct its contents while keeping the same formal write scope. */
function correctedReadBasis(failed: ExecutionToolRecord, later: ExecutionToolRecord): boolean {
  return failed.result?.kind === 'error' && failed.result.code === 'read-basis-changed'
    && failed.requestId !== later.requestId && failed.call.name === later.call.name
    && !!failed.effectTargets?.length && !!later.effectTargets?.length
    && JSON.stringify(stable(failed.effectTargets)) === JSON.stringify(stable(later.effectTargets))
    && later.state === 'returned' && !failedTool(later) && knownApplication(later.call.name, later.result)
}
const delivered = (tool: ExecutionToolRecord) => !failedTool(tool)
  && (knownApplication(tool.call.name, tool.result) || fileCreated(tool.call.name, tool.result)
    || tool.result?.kind === 'read' && (tool.call.name === 'file.read' || tool.call.name === 'material.read'
      || tool.call.name === 'image.generate' && (tool.result.data as { status?: unknown })?.status === 'ready'
      || tool.call.name === 'image.edit' && (tool.result.data as { status?: unknown })?.status === 'ready'
      || serviceToolOutcome(tool.call.name, tool.result)?.status === 'saved'
      || serviceToolOutcome(tool.call.name, tool.result)?.status === 'written'
      || fileMutations.has(tool.call.name)))

/** Recover identity from host-issued references only, not text embedded in user content. */
function recoveredDeliveryFailures(record: ExecutionRunRecord): Set<ExecutionToolRecord> {
  const handles = new Map<string, string>(), filePaths = new Map<string, string>(), resolved = new Set<ExecutionToolRecord>()
  const pending: { tool: ExecutionToolRecord; documentId: string; destination?: string; format?: unknown }[] = []
  const pendingArtifacts = new Map<string, ExecutionToolRecord[]>()
  for (const tool of record.tools) {
    const input = tool.call.input && typeof tool.call.input === 'object' ? tool.call.input as Record<string, unknown> : {}
    const data = tool.result?.kind === 'read' && tool.result.data && typeof tool.result.data === 'object'
      ? tool.result.data as Record<string, unknown> : null
    if (tool.call.name === 'artifact.save' && tool.state === 'returned' && data
      && typeof data.sourceKind === 'string' && typeof data.sourceId === 'string'
      && typeof data.path === 'string' && typeof data.version === 'string') {
      // The artifact owner supplies canonical target and source identity, including the bytes' version.
      // A corrected delivery can settle a definite rejection across runs, never an unknown publication.
      const identity = JSON.stringify([data.sourceKind, data.sourceId, data.path, data.version])
      if (['rejected', 'conflict', 'stopped'].includes(String(data.status)))
        pendingArtifacts.set(identity, [...(pendingArtifacts.get(identity) ?? []), tool])
      else if (data.status === 'written') for (const failed of pendingArtifacts.get(identity) ?? []) resolved.add(failed)
    }
    const handleKey = (value: string) => JSON.stringify([origin(tool), value])
    let parentDocument = tool.effectTargets?.length === 1 ? tool.effectTargets[0]!.documentId
      : typeof input.target === 'string' ? handles.get(handleKey(input.target)) : undefined
    // A path mistaken for a save handle is attributable only when an earlier
    // successful host receipt identified that exact path in the same run.
    if (!parentDocument && tool.call.name === 'file.save' && tool.result?.kind === 'error'
      && tool.result.code === 'invalid-target' && input.destination === undefined && typeof input.target === 'string')
      parentDocument = filePaths.get(handleKey(input.target))
    if ((tool.call.name === 'file.open' || tool.call.name === 'file.create') && typeof data?.documentId === 'string' && typeof data.target === 'string')
      handles.set(handleKey(data.target), data.documentId)
    if (tool.state === 'returned' && (tool.call.name === 'file.open' || fileCreated(tool.call.name, tool.result))
      && typeof data?.documentId === 'string' && typeof data.path === 'string')
      filePaths.set(handleKey(data.path), data.documentId)
    if ((tool.call.name === 'read' || tool.call.name === 'inspect') && parentDocument && typeof data?.target === 'string') handles.set(handleKey(data.target), parentDocument)
    if ((tool.call.name === 'file.save' || tool.call.name === 'project.save' || tool.call.name === 'document.export') && parentDocument
      && tool.result?.kind === 'error' && ['target-conflict', 'invalid-target', 'not-authorized', 'delivery-rejected'].includes(tool.result.code))
      pending.push({ tool, documentId: parentDocument, destination: typeof input.destination === 'string' ? input.destination : undefined, format: input.format })
    const saved = saveFact(tool.call.name, tool.result)
    if (currentSave(saved) && matchesSaveBinding(record, saved!))
      for (const failed of pending) if ((failed.tool.call.name === 'file.save' || failed.tool.call.name === 'project.save')
        && failed.documentId === saved!.documentId) resolved.add(failed.tool)
    if (tool.call.name === 'document.export' && data?.status === 'written' && typeof data.documentId === 'string')
      for (const failed of pending) if (failed.tool.call.name === 'document.export' && failed.documentId === data.documentId
        && failed.format === data.format && (!failed.destination || failed.destination === data.path)) resolved.add(failed.tool)
  }
  return resolved
}

function unresolvedToolFailures(record: ExecutionRunRecord): ExecutionToolRecord[] {
  const resolvedDelivery = recoveredDeliveryFailures(record)
  const lastImportByJob = new Map<string, number>()
  record.tools.forEach((tool, index) => {
    const job = jobOf(tool)
    if (tool.call.name === 'build.import' && committed(tool.result) && job) lastImportByJob.set(job, index)
  })
  const hasDelivery = record.tools.some(tool => delivered(tool)
    && tool.call.name !== 'file.read' && tool.call.name !== 'material.read')
  const hasEvidence = hasDelivery || record.tools.some(tool => tool.state === 'returned' && tool.result?.kind === 'read'
    && ['read', 'inspect', 'file.read', 'material.read', 'web.open', 'context.read'].includes(tool.call.name))
  const sameIntendedEdit = (a: ExecutionToolRecord, b: ExecutionToolRecord) => {
    if (!a.effectTargets?.length || !b.effectTargets?.length || a.call.name !== b.call.name) return false
    const argumentsWithoutHandle = (value: unknown) => value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'target' && key !== 'expectedVersion')) : value
    return JSON.stringify(stable(a.effectTargets)) === JSON.stringify(stable(b.effectTargets))
      && JSON.stringify(stable(argumentsWithoutHandle(a.call.input))) === JSON.stringify(stable(argumentsWithoutHandle(b.call.input)))
  }
  return record.tools.filter((tool, index) => {
    // An unanswered or malformed question changed nothing; it is not an unfinished document operation.
    if (tool.call.name === USER_QUESTION_TOOL || tool.call.name === 'task.note') return false
    if (tool.state !== 'returned') return true
    const saved = saveFact(tool.call.name, tool.result)
    const wrongProjectSave = tool.call.name === 'project.save' && saved
      && (!matchesSaveBinding(record, saved) || tool.effectTargets?.length === 1 && tool.effectTargets[0]!.documentId !== saved.documentId)
    if (!failedTool(tool) && !wrongProjectSave) return false
    // A modification the user declined is the user's decision, not an unfinished operation.
    if (tool.result?.kind === 'error' && tool.result.code === 'user-denied') return false
    const pending = pendingJob(tool)
    if (pending && record.tools.slice(index + 1).some(later => terminalJobReceipt(later, pending))) return false
    const job = jobOf(tool)
    if (tool.call.name.startsWith('build.') && job && (lastImportByJob.get(job) ?? -1) > index) return false
    // An unknown external effect cannot be repaired by issuing a second call ID.
    if (tool.observationFailure?.outcome === 'unknown' || serviceToolOutcome(tool.call.name, tool.result)?.status === 'unknown'
      || tool.result?.kind === 'error' && /outcome-unknown/.test(tool.result.code)) return true
    if (record.tools.slice(index + 1).some(later => sameObservedTarget(tool, later))) return false
    if (record.tools.slice(index + 1).some(later => sameReadSource(tool, later))) return false
    if (record.tools.slice(index + 1).some(later => correctedReadBasis(tool, later))) return false
    if (optionalObservationFailure(tool)) return false
    if (resolvedDelivery.has(tool)) return false
    if (record.tools.slice(index + 1).some(later => (requestKey(later) === requestKey(tool) || sameIntendedEdit(tool, later))
      && later.state === 'returned' && !failedTool(later)
      && (knownApplication(later.call.name, later.result) || later.result?.kind === 'read' && recoversProjectSave(record, tool, later)))) return false
    // A malformed model call never reached a tool. Once a concrete result was
    // delivered, keep that attempt in history without letting its syntax alone
    // downgrade the task. Failed requested writes and unknown effects still do.
    if (hasDelivery && tool.result?.kind === 'error' && tool.result.code === 'invalid-tool-arguments') return false
    // Invalid exploratory handles stay in the history but do not turn a verified
    // final delivery into a partial task. Other failed deliverables remain partial.
    if (hasEvidence && exploratoryNames.has(tool.call.name) && tool.result?.kind === 'error'
      && ['invalid-target', 'target-conflict', 'tool-load-failed'].includes(tool.result.code)) return false
    return true
  })
}

interface NewFileDeliveryFact { documentId: string; label: string; path?: string; revision: number | null; savedRevision: number | null }
const pathKey = (value: string) => value.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase()
function matchesSaveBinding(record: ExecutionRunRecord, saved: NonNullable<ReturnType<typeof saveFact>>, createdPath?: string): boolean {
  const binding = record.documentBindings?.[saved.documentId]
  if (binding) {
    if (typeof saved.epoch === 'string' && binding.epoch !== saved.epoch) return false
    // The persistence owner carries the proved save revision through a formal rename/Save As.
    // Its current location must not invalidate a historical receipt for those same saved bytes.
    if (binding.savedRevision >= saved.savedRevision!) return true
    return typeof saved.path !== 'string' || pathKey(binding.path) === pathKey(saved.path)
  }
  return !createdPath || !saved.path || pathKey(createdPath) === pathKey(saved.path)
}
function recoversProjectSave(record: ExecutionRunRecord, failed: ExecutionToolRecord, later: ExecutionToolRecord): boolean {
  if (later.call.name !== 'project.save') return true
  const saved = saveFact(later.call.name, later.result)
  const documentId = failed.effectTargets?.length === 1 ? failed.effectTargets[0]!.documentId
    : record.input.documents.length === 1 ? record.input.documents[0]!.documentId : undefined
  return !!saved && currentSave(saved) && matchesSaveBinding(record, saved) && saved.documentId === documentId
}

/** Only this run's receipts count: a created path is not evidence that subsequent edits reached that file. */
export function newFileDeliveryFacts(record: ExecutionRunRecord): NewFileDeliveryFact[] {
  const facts = new Map<string, NewFileDeliveryFact>()
  for (const tool of record.tools) {
    const data = tool.result?.kind === 'read' && tool.result.data && typeof tool.result.data === 'object'
      ? tool.result.data as Record<string, unknown> : null
    if (fileCreated(tool.call.name, tool.result) && typeof data?.documentId === 'string') {
      const currentPath = record.documentBindings?.[data.documentId]?.path ?? (typeof data.path === 'string' ? data.path : undefined)
      const label = currentPath ? currentPath.split(/[\\/]/).at(-1)! : data.documentId
      if (!facts.has(data.documentId)) facts.set(data.documentId, { documentId: data.documentId,
        label: label.slice(0, 160), ...(currentPath ? { path: currentPath } : {}), revision: null, savedRevision: null })
    }
    const mutation = operationFact(tool.call.name, tool.result)
      ?? (fileMutations.has(tool.call.name) && data?.documentResult && typeof data.documentResult === 'object'
        ? data.documentResult as Record<string, unknown> : null)
    if (mutation?.status === 'applied' && typeof mutation.documentId === 'string'
      && typeof mutation.revision === 'number' && Number.isSafeInteger(mutation.revision)) {
      const fact = facts.get(mutation.documentId)
      if (fact) fact.revision = mutation.revision
    }
    const saved = saveFact(tool.call.name, tool.result)
    if (saved) {
      const fact = facts.get(saved.documentId)
      if (fact && matchesSaveBinding(record, saved, fact.path)) {
        fact.savedRevision = saved.savedRevision!
        if (saved.dirty) fact.revision = saved.currentRevision
      }
    }
  }
  return [...facts.values()]
}
const unconfirmedSave = (fact: NewFileDeliveryFact) => fact.revision !== null
  && (fact.savedRevision === null || fact.savedRevision < fact.revision)

export function hasConfirmedWork(record: ExecutionRunRecord): boolean {
  return record.tools.some(tool => delivered(tool) || tool.state === 'returned' && tool.result?.kind === 'read'
    && ['read', 'inspect', 'context.read'].includes(tool.call.name))
}

export function hasUnresolvedToolFailure(record: ExecutionRunRecord): boolean {
  return unresolvedToolFailures(record).length > 0 || newFileDeliveryFacts(record).some(unconfirmedSave)
}

/** Only receipt-backed facts are summarized; scratch cleanup is not a new task failure. */
export function runEndSummary(record: ExecutionRunRecord): string | undefined {
  const noteProblems = record.tools.filter(tool => tool.call.name === 'task.note').flatMap(tool => {
    if (tool.result?.kind === 'error') return [tool.result.message]
    const diagnostics = tool.result?.kind === 'read' && tool.result.data && typeof tool.result.data === 'object'
      ? (tool.result.data as { diagnostics?: unknown }).diagnostics : null
    return Array.isArray(diagnostics) ? diagnostics.filter((item): item is string => typeof item === 'string') : []
  })
  const noteWarning = noteProblems.length ? '工作笔记诊断：' + [...new Set(noteProblems)].join('；') : undefined
  const diagnosticFailures = record.tools.filter((tool, index) => optionalObservationFailure(tool)
    && !record.tools.slice(index + 1).some(later => sameObservedTarget(tool, later)))
  const diagnosticWarning = diagnosticFailures.length ? '可选画面诊断未完成，相关视觉结果未验证：'
    + [...new Set(diagnosticFailures.map(tool => tool.observationFailure?.message
      ?? (tool.result?.kind === 'error' ? tool.result.message : '画面不可用')))].join('；') : undefined
  if (record.status === 'completed') return [record.failure?.message, diagnosticWarning, noteWarning].filter(Boolean).join('；') || undefined
  const parts: string[] = []
  if (record.status === 'stopped') parts.push('任务已停止')
  else if (record.failure?.message) parts.push(record.failure.message)
  else if (record.status === 'partial') {
    const latest = unresolvedToolFailures(record).at(-1)
    const message = latest ? latest.observationFailure?.message ?? serviceToolOutcome(latest.call.name, latest.result)?.message
      ?? (latest.result?.kind === 'error' ? latest.result.message : '存在未完成的工具操作') : null
    if (message) parts.push(message)
  }
  const directApplied = record.tools.filter(tool => tool.call.name !== 'build.import'
    && committedFact(tool.call.name, tool.result)?.status === 'applied').length
  const importApplied = record.tools.filter(tool => tool.call.name === 'build.import'
    && tool.result?.kind === 'document-operation' && tool.result.result.status === 'applied').length
  if (directApplied) parts.push(`已保留 ${directApplied} 项正式文档修改`)
  if (diagnosticWarning) parts.push(diagnosticWarning)
  if (noteWarning) parts.push(noteWarning)
  if (importApplied) parts.push(`已正式导入 ${importApplied} 项构建成果`)
  const createdFiles = record.tools.filter(tool => fileCreated(tool.call.name, tool.result)).length
  if (createdFiles) parts.push(`已创建 ${createdFiles} 个文件`)
  const fileFacts = newFileDeliveryFacts(record)
  const unsaved = fileFacts.filter(unconfirmedSave)
  if (unsaved.length) parts.push(`新文件的修改尚未确认保存：${unsaved.map(fact => `${fact.label}（文档版本 ${fact.revision}）`).join('、')}；可恢复状态不等于目标文件已写盘`)
  const scaffolds = fileFacts.filter(fact => fact.revision === null && /\.h5lesson$/i.test(fact.label))
  if (scaffolds.length) parts.push(`仅有创建回执、未见课件内容提交：${scaffolds.map(fact => fact.label).join('、')}`)
  const savedArtifacts = record.tools.filter(tool => tool.call.name === 'artifact.save'
    && serviceToolOutcome(tool.call.name, tool.result)?.status === 'written').length
  if (savedArtifacts) parts.push(`已保存 ${savedArtifacts} 项作业成果`)
  const savedOffice = new Set(record.tools.filter(tool => (tool.call.name === 'office.create' || tool.call.name === 'office.edit')
    && serviceToolOutcome(tool.call.name, tool.result)?.status === 'saved').flatMap(tool => {
      const data = tool.result?.kind === 'read' ? tool.result.data as { path?: unknown } : undefined
      return typeof data?.path === 'string' ? [data.path] : []
    })).size
  if (savedOffice) parts.push(`已保存 ${savedOffice} 个 Office 文件`)
  const attemptedJobs = new Set(record.tools.filter(tool => tool.call.name.startsWith('build.')).map(jobOf).filter((job): job is string => !!job))
  const imported = importedJobs(record)
  if ([...attemptedJobs].some(job => !imported.has(job))) parts.push('另有暂存构建未导入；正式文档是否保存以保存回执为准')
  const unresolved = record.status === 'partial' ? unresolvedToolFailures(record) : []
  const ambiguousReadAfterEdit = !record.failure && (directApplied > 0 || importApplied > 0)
    && unresolved.length > 0 && unresolved.every(tool => (tool.call.name === 'read' || tool.call.name === 'inspect')
      && tool.result?.kind === 'error' && (tool.result.code === 'invalid-target' || tool.result.code === 'target-conflict'))
  if (record.status === 'partial' && ambiguousReadAfterEdit) parts.push('读取尝试失败，修改已应用；是否遗漏参考内容仍需确认')
  else if (record.status === 'stopped' || record.status === 'partial') parts.push('剩余工作未完成')
  return parts.length ? `${parts.join('；')}。` : undefined
}
