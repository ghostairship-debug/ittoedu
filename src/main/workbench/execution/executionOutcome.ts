import { isNativeProjectFilename } from '../../../shared/nativeProjectFile'
import type { ExecutionRunRecord, ExecutionToolRecord } from '../../../shared/workbench/execution'
import type { ToolResult } from '../../../shared/workbench/tools'
import type { DocumentToolGateway } from '../../../core/tools/DocumentToolGateway'
import { USER_QUESTION_TOOL } from '../../../shared/workbench/userQuestion'
import { agentFileMutationNames } from '../../../core/tools/AgentFileTools'
import path from 'node:path'
import { toolRegistration } from '../../../core/tools/ToolCatalog'
import { committedFact, contentApplyFact, currentExport, currentSave, exportFact, knownApplication, operationFact, saveFact, serviceToolOutcome, toolFailed } from '../../../core/tools/modelToolResult'

export const committed = (result?: ToolResult): result is Extract<ToolResult, { kind: 'document-operation' }> =>
  result?.kind === 'document-operation' && (result.result.status === 'applied' || result.result.status === 'unchanged')

export const fileCreated = (name: string, result?: ToolResult): boolean => (name === 'file.create'
  || name === 'course.importPptx' && serviceToolOutcome(name, result)?.status === 'saved') && result?.kind === 'read'
  && !!result.data && typeof result.data === 'object'
  && (result.data as { operation?: { status?: unknown } }).operation?.status === 'success'

/** Durable host receipts identify a run's documents, including one created after an empty start. */
export function trustedRunDocumentIds(record: ExecutionRunRecord): string[] {
  const ids = new Set(record.input.documents.map(document => document.documentId))
  for (const tool of record.tools) {
    if (tool.state !== 'returned') continue
    const receipt = committedFact(tool.call.name, tool.result)
    if (receipt) { ids.add(receipt.documentId); continue }
    if (tool.call.name !== 'file.open' && !fileCreated(tool.call.name, tool.result)) continue
    const data = tool.result?.kind === 'read' && tool.result.data && typeof tool.result.data === 'object'
      ? tool.result.data as { documentId?: unknown; path?: unknown } : null
    if (typeof data?.documentId === 'string' && data.documentId && typeof data.path === 'string') ids.add(data.documentId)
  }
  return [...ids]
}

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
const failedTool = (tool: ExecutionToolRecord) => tool.notInvokedReason !== 'steering' && (!!tool.observationFailure || toolFailed(tool.call.name, tool.result))
const unknownToolOutcome = (tool: ExecutionToolRecord) => tool.observationFailure?.outcome === 'unknown'
  || serviceToolOutcome(tool.call.name, tool.result)?.status === 'unknown'
  || tool.result?.kind === 'error' && /outcome-unknown/.test(tool.result.code)

/** Main's current settlement view; never changes or replaces the original receipt. */
export type SettledExecutionTool = ExecutionToolRecord & {
  currentContentVerification?: { sourceDocumentId: string;
    observation: Awaited<ReturnType<DocumentToolGateway['verifyContentDiagnostics']>> }
}
export function currentContentRepaired(tool: SettledExecutionTool): boolean {
  const apply = contentApplyFact(tool.call.name, tool.result), receipt = committedFact(tool.call.name, tool.result)
  const verified = tool.currentContentVerification
  if (!apply || !receipt || tool.observationFailure || !verified || verified.sourceDocumentId !== receipt.documentId
    || !verified.observation.current || !['partial', 'unusable'].includes(apply.usability)) return false
  const diagnostics = apply.diagnostics.filter(item => item.level !== 'info')
  return diagnostics.length > 0 && verified.observation.results.length === diagnostics.length
    && diagnostics.every((diagnostic, index) => {
      const result = verified.observation.results[index]!
      return result.state === 'resolved' && result.code === diagnostic.code
        && result.instanceId === diagnostic.instanceId && result.reference === diagnostic.reference
    })
}

type PendingJob = { kind: 'image' | 'compute' | 'delegation'; id: string; requiresArtifactRead?: boolean }
const pendingJob = (tool: ExecutionToolRecord): PendingJob | null => {
  if (serviceToolOutcome(tool.call.name, tool.result)?.status !== 'pending' || tool.result?.kind !== 'read') return null
  const data = tool.result.data as { job?: unknown }
  return (tool.call.name === 'image.generate' || tool.call.name === 'image.edit'
    || tool.call.name === 'compute.run' || ['delegate.start', 'local.run', 'delegate.readonly'].includes(tool.call.name))
    && typeof data.job === 'string' ? { kind: tool.call.name === 'compute.run' ? 'compute'
      : ['delegate.start', 'local.run', 'delegate.readonly'].includes(tool.call.name) ? 'delegation' : 'image', id: data.job,
      ...(tool.call.name === 'local.run' ? { requiresArtifactRead: !!(tool.call.input as { outputs?: string[] })?.outputs?.length } : {}) } : null
}
const terminalJobReceipt = (tool: ExecutionToolRecord, pending: PendingJob): boolean => {
  if (tool.result?.kind !== 'read' || toolFailed(tool.call.name, tool.result)) return false
  const data = tool.result.data as { job?: unknown; jobId?: unknown; kind?: unknown; status?: unknown; terminal?: unknown;
    sourceKind?: unknown; sourceId?: unknown; verifiedBytes?: unknown } | null
  if (pending.kind === 'delegation' && pending.requiresArtifactRead !== false) return tool.call.name === 'delegate.read' && data?.job === pending.id
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

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, child]) => [key, stable(child)]))
  return value
}
function sameObservedTarget(failed: ExecutionToolRecord, later: ExecutionToolRecord): boolean {
  if ((failed.call.name !== 'view.observe' && failed.call.name !== 'html.observe') || failed.call.name !== later.call.name
    || later.state !== 'returned' || failedTool(later) || later.result?.kind !== 'read') return false
  const receipt = (tool: ExecutionToolRecord) => tool.result?.kind === 'read' && tool.result.data && typeof tool.result.data === 'object'
    ? tool.result.data as { identity?: { documentId?: unknown; locationId?: unknown; stateId?: unknown }; image?: { resourceId?: unknown } } : null
  const before = receipt(failed), after = receipt(later)
  if (typeof after?.identity?.documentId !== 'string' || typeof after.image?.resourceId !== 'string') return false
  if (typeof before?.identity?.documentId === 'string') return before.identity.documentId === after.identity.documentId
    && before.identity.locationId === after.identity.locationId
    && (before.identity.stateId ?? null) === (after.identity.stateId ?? null)
  return !!failed.effectTargets?.length && !!later.effectTargets?.length
    && JSON.stringify(stable(failed.effectTargets)) === JSON.stringify(stable(later.effectTargets))
}
const delivered = (tool: ExecutionToolRecord) => !failedTool(tool)
  && (knownApplication(tool.call.name, tool.result) || fileCreated(tool.call.name, tool.result)
    || tool.result?.kind === 'read' && (tool.call.name === 'file.read' || tool.call.name === 'material.read'
      || tool.call.name === 'image.generate' && (tool.result.data as { status?: unknown })?.status === 'ready'
      || tool.call.name === 'image.edit' && (tool.result.data as { status?: unknown })?.status === 'ready'
      || serviceToolOutcome(tool.call.name, tool.result)?.status === 'saved'
      || serviceToolOutcome(tool.call.name, tool.result)?.status === 'written'
      || fileMutations.has(tool.call.name)))

/** Only calls still in flight or with an unconfirmed original external effect
 * are unfinished operations. Definite rejections remain in the audit history. */
function unresolvedToolFailures(record: ExecutionRunRecord): ExecutionToolRecord[] {
  return record.tools.filter((tool,index)=>{
    if(tool.call.name===USER_QUESTION_TOOL||tool.call.name==='task.note'||tool.call.name==='task.finish') return false
    if(tool.notInvokedReason==='steering')return false
    if(tool.state!=='returned'||unknownToolOutcome(tool))return true
    // Required visual verification remains unfinished until the same displayed state is observed successfully.
    if(tool.observationFailure&&(tool.call.name==='view.observe'||tool.call.name==='html.observe')
      &&!optionalObservationFailure(tool)&&!record.tools.slice(index+1).some(later=>sameObservedTarget(tool,later)))return true
    const pending=pendingJob(tool)
    if(pending){
      const later=record.tools.slice(index+1)
      if(later.some(receipt=>terminalJobReceipt(receipt,pending)))return false
      const observation=later.slice().reverse().flatMap(receipt=>{
        const data=completionJobObservation(receipt,pending)
        return data?[{receipt,data}]:[]
      })[0]
      return !observation||!knownJobFailure(observation.receipt,observation.data)
    }
    return serviceToolOutcome(tool.call.name,tool.result)?.status==='pending'
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
      // A terminal delivery for an input document shares the created-file freshness check.
      // An ordinary earlier save never requires saving subsequent intentional editor changes.
      if (tool.call.name === 'task.delivery' && !facts.has(saved.documentId) && trustedRunDocumentIds(record).includes(saved.documentId)
        && matchesSaveBinding(record, saved)) {
        const path = record.documentBindings?.[saved.documentId]?.path ?? saved.path
        facts.set(saved.documentId, { documentId: saved.documentId, label: (path?.split(/[\\/]/).at(-1) ?? saved.documentId).slice(0, 160),
          ...(path ? { path } : {}), revision: saved.currentRevision, savedRevision: null })
      }
      const fact = facts.get(saved.documentId)
      if (fact && matchesSaveBinding(record, saved, fact.path)) {
        fact.savedRevision = saved.savedRevision!
        if (saved.dirty) fact.revision = saved.currentRevision
      }
    }
  }
  for(const fact of facts.values()){
    const current=(record as SettledExecutionRun).currentDocuments?.[fact.documentId]
    if(current&&(current.dirty||current.revision>0))fact.revision=Math.max(fact.revision??0,current.revision)
  }
  return [...facts.values()]
}
const unconfirmedSave = (fact: NewFileDeliveryFact) => fact.revision !== null
  && (fact.savedRevision === null || fact.savedRevision < fact.revision)

function hasConfirmedOutput(record:ExecutionRunRecord):boolean {
  return record.tools.some(tool=>persistedToolWork(tool.call.name,tool.result)
    ||toolRegistration(tool.call.name)?.capability==='resource'&&delivered(tool))
    ||record.tools.some((tool,index)=>{
      const pending=pendingJob(tool)
      return !!pending&&record.tools.slice(index+1).some(receipt=>terminalJobReceipt(receipt,pending))
    })
}
export function hasConfirmedWork(record: ExecutionRunRecord): boolean {
  return hasConfirmedOutput(record)||record.tools.some(tool => delivered(tool) || tool.state === 'returned' && tool.result?.kind === 'read'
    && ['read', 'inspect', 'context.read'].includes(tool.call.name))
}

export function hasUnresolvedToolFailure(record: ExecutionRunRecord): boolean {
  return executionCompletionIssues(record).length > 0
}

/** Current Session facts are an ephemeral settlement view, never model input or a grant. */
export interface SettledExecutionRun extends ExecutionRunRecord {
  currentDocuments?: Record<string,{epoch:string;revision:number;dirty:boolean}>
}
function currentRevision(record:ExecutionRunRecord,documentId:string,epoch?:string):number {
  const current=(record as SettledExecutionRun).currentDocuments?.[documentId]
  if(current&&(!epoch||current.epoch===epoch))return current.revision
  return Math.max(0,...record.tools.flatMap(tool=>{
    const fact=committedFact(tool.call.name,tool.result)
    const scopes=[...tool.effectTargets??[],...tool.writeScopes??[]].filter(scope=>scope.documentId===documentId&&scope.epoch)
    return fact&&fact.documentId===documentId&&(!epoch||!scopes.length||scopes.some(scope=>scope.epoch===epoch))?[fact.revision]:[]
  }))
}
function deliveryDocument(record:ExecutionRunRecord,tool:ExecutionToolRecord):string|undefined {
  const fact=saveFact(tool.call.name,tool.result)??exportFact(tool.call.name,tool.result)
  if(fact)return fact.documentId
  if(tool.effectTargets?.length===1)return tool.effectTargets[0]!.documentId
  const documents=trustedRunDocumentIds(record)
  return documents.length===1?documents[0]:undefined
}
function deliveryPath(record:ExecutionRunRecord,value:string):string {
  const normalized=value.replace(/\\/g,'/')
  const absolute=/^(?:[a-z]:\/|\/)/i.test(normalized)?normalized:
    (record.input.workspaceRoot?record.input.workspaceRoot.replace(/\\/g,'/')+'/'+normalized:normalized)
  return pathKey(path.posix.normalize(absolute))
}
function deliveryInput(tool:ExecutionToolRecord):{format?:string;destination?:string}|null {
  const input=tool.call.input as {format?:string;destination?:string;delivery?:{format?:string;destination?:string}}|null
  return tool.call.name==='task.finish'?input?.delivery??null:input
}
/** Delivery obligations use the final typed intent and actual save/export facts,
 * not the sequence of content-writing attempts which led to that result. */
function deliveryCompletionIssues(record:ExecutionRunRecord):ExecutionCompletionIssue[] {
  const issues:ExecutionCompletionIssue[]=[]
  // The publication owner supplies a concrete destination and immutable source
  // version. This is an output obligation, independently of intermediate calls.
  const publications=new Map<string,{tool:ExecutionToolRecord;status:string;path:string}>()
  for(const tool of record.tools){
    if(toolRegistration(tool.call.name)?.effect!=='artifact-delivery'||tool.result?.kind!=='read')continue
    const data=tool.result.data as {sourceKind?:unknown;sourceId?:unknown;path?:unknown;version?:unknown;status?:unknown}|null
    if(!data||![data.sourceKind,data.sourceId,data.path,data.version,data.status].every(value=>typeof value==='string'))continue
    const identity=JSON.stringify([data.sourceKind,data.sourceId,pathKey(data.path as string),data.version])
    // Create-only publication receipts are durable facts. A later known rejection
    // cannot unwrite the same output; unknown effects still block independently.
    if(publications.get(identity)?.status!=='written')
      publications.set(identity,{tool,status:data.status as string,path:data.path as string})
  }
  for(const publication of publications.values())if(publication.status!=='written')
    issues.push({name:publication.tool.call.name,status:'unverified',callId:publication.tool.callId,receiptCallId:publication.tool.callId,
      requestId:publication.tool.requestId,message:publication.path+' 的指定来源版本尚未确认实际写入'})
  const saveRequests=record.tools.filter(tool=>['file.save','project.save'].includes(tool.call.name)&&!currentSave(saveFact(tool.call.name,tool.result))
    ||['task.delivery','task.finish'].includes(tool.call.name)&&deliveryInput(tool)!==null&&!deliveryInput(tool)?.format)
  const saves=record.tools.flatMap(tool=>{
    const fact=saveFact(tool.call.name,tool.result)
    return fact?[fact]:[]
  })
  const requiredSaves=new Map<string|undefined,ExecutionToolRecord>()
  for(const request of saveRequests)requiredSaves.set(deliveryDocument(record,request),request)
  for(const [documentId,request] of requiredSaves){
    const input=deliveryInput(request)
    const target=typeof input?.destination==='string'?deliveryPath(record,input.destination):undefined
    const actual=saves.slice().reverse().find(fact=>documentId!==undefined&&fact.documentId===documentId
      &&(!target||typeof fact.path==='string'&&deliveryPath(record,fact.path)===target))
    const current=documentId?(record as SettledExecutionRun).currentDocuments?.[documentId]:undefined
    if(actual&&currentSave(actual)&&matchesSaveBinding(record,actual)
      &&actual.savedRevision!>=currentRevision(record,actual.documentId,actual.epoch)
      &&(!current||current.epoch===actual.epoch&&current.dirty===false))continue
    issues.push({name:'project.save',status:'unsaved',...(documentId?{documentId}:{}),message:'目标文档的当前版本尚未确认保存并处于已保存状态'})
  }
  const requests=new Map<string,ExecutionToolRecord>()
  const terminalKeys=new Set<string>()
  for(const tool of record.tools){
    const input=deliveryInput(tool)
    if(tool.call.name!=='document.export'&&!(['task.delivery','task.finish'].includes(tool.call.name)&&input?.format))continue
    const documentId=deliveryDocument(record,tool)
    const format=input?.format??exportFact(tool.call.name,tool.result)?.format??'html-offline'
    const key=JSON.stringify([documentId,format])
    if(['task.delivery','task.finish'].includes(tool.call.name)){
      terminalKeys.add(key)
      requests.set(key,tool)
    }else if(!terminalKeys.has(key))requests.set(key,tool)
  }
  for(const tool of requests.values()){
    const input=deliveryInput(tool)
    const documentId=deliveryDocument(record,tool)
    const original=exportFact(tool.call.name,tool.result)
    const format=input?.format??original?.format??'html-offline'
    const target=typeof input?.destination==='string'?deliveryPath(record,input.destination):original?.path?deliveryPath(record,original.path):undefined
    const candidates=record.tools.flatMap(receipt=>{
      const fact=exportFact(receipt.call.name,receipt.result)
      return fact&&fact.documentId===documentId&&fact.format===format
        &&(!target||[fact.path,...fact.files?.map(file=>file.path)??[]].some(filename=>typeof filename==='string'&&deliveryPath(record,filename)===target))?[fact]:[]
    })
    const actual=candidates.at(-1),current=documentId?(record as SettledExecutionRun).currentDocuments?.[documentId]:undefined
    const binding=documentId?record.documentBindings?.[documentId]:undefined
    if(actual&&currentExport(actual)&&actual.exportedRevision!>=currentRevision(record,actual.documentId,actual.epoch)
      &&(!binding||binding.epoch===actual.epoch&&binding.savedRevision<=actual.exportedRevision!)
      &&(!current||current.epoch===actual.epoch))continue
    issues.push({name:'task.delivery',status:'unverified',...(documentId?{documentId}:{}),
      callId:tool.callId,receiptCallId:tool.callId,requestId:tool.requestId,message:format+' 指定交付产物尚未确认真实写入目标路径并匹配当前文档版本'})
  }
  return issues
}

export interface ExecutionCompletionIssue {
  callId?: string; name: string; status: 'pending' | 'unknown' | 'failed' | 'unverified' | 'unsaved'; message: string
  requestId?: string; receiptCallId?: string
  documentId?: string
  job?: string; kind?: 'image' | 'compute' | 'delegation'
}

/** Known failures are warnings; they never erase or rewrite the original records. */
export function executionAuditWarnings(record:ExecutionRunRecord):ExecutionCompletionIssue[] {
  const unresolved=new Set(unresolvedToolFailures(record))
  const warnings=record.tools.filter(tool=>tool.state==='returned'&&!unresolved.has(tool)&&failedTool(tool)
    &&tool.call.name!==USER_QUESTION_TOOL&&tool.call.name!=='task.finish').map((tool):ExecutionCompletionIssue=>({
      name:tool.call.name,status:'failed',callId:tool.callId,requestId:tool.requestId,receiptCallId:tool.callId,
      message:tool.observationFailure?.message??(tool.result?.kind==='error'?tool.result.message:serviceToolOutcome(tool.call.name,tool.result)?.message??'中间操作未成功；原回执保留')
    }))
  const latestVisual=new Map<string,NonNullable<ExecutionRunRecord['visualAnalyses']>[number]>()
  for(const analysis of record.visualAnalyses??[])latestVisual.set(analysis.source,analysis)
  for(const analysis of latestVisual.values())if(analysis.status==='vision-unavailable')
    warnings.push({name:'视觉分析',status:'unverified',message:analysis.source+'：'+(analysis.reason??'原来源尚未完成视觉分析')})
  if(record.failure?.code==='vision-unavailable')warnings.push({name:'视觉分析',status:'unverified',message:record.failure.message})
  return warnings
}
export function executionExitDecision(record:ExecutionRunRecord):{
  status:'continue'|'partial'|'completed';remaining:ExecutionCompletionIssue[];continuable:ExecutionCompletionIssue[];warnings:ExecutionCompletionIssue[]
}{
  const remaining=executionCompletionIssues(record),warnings=executionAuditWarnings(record)
  const continuable=remaining.filter(issue=>issue.status==='pending'||issue.status==='unknown')
  return {status:continuable.length?'continue':remaining.length?'partial':'completed',remaining,continuable,warnings}
}

function completionJobObservation(tool: ExecutionToolRecord, pending: NonNullable<ReturnType<typeof pendingJob>>) {
  if (tool.state !== 'returned' || tool.result?.kind !== 'read') return null
  const data = tool.result.data as { job?: unknown; jobId?: unknown; kind?: unknown; status?: unknown; terminal?: unknown;
    failure?: { outcome?: unknown }; snapshot?: { reason?: unknown; failure?: { outcome?: unknown; message?: unknown } } } | null
  if (!data || (data.job ?? data.jobId) !== pending.id) return null
  return (tool.call.name === 'job.wait' || tool.call.name === 'job.status') && data.kind === pending.kind
    || tool.call.name === 'image.status' && pending.kind === 'image' ? data : null
}
const knownJobFailure = (tool: ExecutionToolRecord, data: NonNullable<ReturnType<typeof completionJobObservation>>) =>
  (tool.call.name === 'image.status' || data.terminal === true) && ['failed', 'cancelled', 'stopped', 'unapplied'].includes(String(data.status))
    && data.failure?.outcome !== 'unknown' && data.snapshot?.failure?.outcome !== 'unknown'

/** Ending the loop is distinct from proving complete delivery. These are derived
 * from the original receipts; a terminal failed job never becomes a successful one. */
export function executionCompletionIssues(record: ExecutionRunRecord): ExecutionCompletionIssue[] {
  const issues = unresolvedToolFailures(record).map((tool): ExecutionCompletionIssue => {
    let receipt = tool
    let status: ExecutionCompletionIssue['status'] = unknownToolOutcome(tool) ? 'unknown'
      : tool.state !== 'returned' ? 'pending' : tool.observationFailure ? 'unverified' : 'failed'
    let message = tool.observationFailure?.message ?? (tool.result?.kind === 'error' ? tool.result.message
      : serviceToolOutcome(tool.call.name, tool.result)?.message ?? '工具操作尚未确认完成')
    const pending = pendingJob(tool)
    if (pending && status !== 'unknown') {
      status = 'pending'
      const observations = record.tools.slice(record.tools.indexOf(tool) + 1)
      for (const later of observations.slice().reverse()) {
        const data = completionJobObservation(later, pending)
        if (!data) continue
        receipt = later
        if (data.status === 'unknown' || data.failure?.outcome === 'unknown' || data.snapshot?.failure?.outcome === 'unknown') {
          status = 'unknown'; message = '原作业结果未知；请查询原作业，不要重新提交'
        } else if (knownJobFailure(later, data)) {
          status = 'failed'
          // Reading the same ended failure again is not a new failure that
          // forces another model turn before it can choose partial termination.
          receipt = observations.find(earlier => {
            const observed = completionJobObservation(earlier, pending)
            return observed && knownJobFailure(earlier, observed)
          }) ?? later
          message = typeof data.snapshot?.reason === 'string' ? data.snapshot.reason
            : typeof data.snapshot?.failure?.message === 'string' ? data.snapshot.failure.message : `原作业已结束，状态为 ${data.status}`
        }
        break
      }
    }
    return { callId: tool.callId, name: tool.call.name, status, message,
      requestId: receipt.requestId, receiptCallId: receipt.callId, ...(pending ? { job: pending.id, kind: pending.kind } : {}) }
  })
  const attemptedOutput=record.tools.some(tool=>tool.notInvokedReason!=='steering'
    &&['write','save'].includes(toolRegistration(tool.call.name)?.capability??''))
  const attemptedResource=record.tools.some(tool=>tool.notInvokedReason!=='steering'
    &&toolRegistration(tool.call.name)?.capability==='resource')
  if((attemptedOutput||attemptedResource)&&!hasConfirmedOutput(record))
    issues.push({name:'交付',status:'unverified',message:'尚未取得正式内容应用、文件创建、保存或写出的成果回执；中间诊断已保留'})
  for (const fact of newFileDeliveryFacts(record).filter(unconfirmedSave)) {
    const receipt = record.tools.slice().reverse().find(tool => {
      const data = tool.result?.kind === 'read' ? tool.result.data as { documentResult?: Record<string, unknown> } | null : null
      const mutation = operationFact(tool.call.name, tool.result) ?? (fileMutations.has(tool.call.name) ? data?.documentResult : null)
      return mutation?.status === 'applied' && mutation.documentId === fact.documentId && mutation.revision === fact.revision
    })
    issues.push({ name: 'project.save', status: 'unsaved', documentId: fact.documentId,
      ...(receipt ? { callId: receipt.callId, receiptCallId: receipt.callId, requestId: receipt.requestId } : {}),
      message: `${fact.label} 的文档版本 ${fact.revision} 尚未确认保存到目标文件` })
  }
  issues.push(...deliveryCompletionIssues(record))
  return issues
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
  const auditWarnings=executionAuditWarnings(record)
  const auditWarning=auditWarnings.length?'中间操作警告 '+auditWarnings.length+' 项，完整失败与诊断已保留在运行记录':undefined
  if (record.status === 'completed') return [record.failure?.message, diagnosticWarning, noteWarning,auditWarning].filter(Boolean).join('；') || undefined
  const parts: string[] = []
  if (record.status === 'stopped') parts.push('任务已停止')
  else if (record.failure?.message) parts.push(record.failure.message)
  else if (record.status === 'partial') {
    const message = executionCompletionIssues(record).at(-1)?.message
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
  const importedDocuments = new Set(record.tools.filter(tool => tool.call.name === 'course.importPptx'
    && fileCreated(tool.call.name, tool.result)).flatMap(tool => {
      const data = tool.result?.kind === 'read' ? tool.result.data as { documentId?: unknown } : undefined
      return typeof data?.documentId === 'string' ? [data.documentId] : []
    }))
  const scaffolds = fileFacts.filter(fact => fact.revision === null && isNativeProjectFilename(fact.label) && !importedDocuments.has(fact.documentId))
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
