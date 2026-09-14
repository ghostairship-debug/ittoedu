import { app, session } from 'electron'
import { configureNativeSystemProxy } from './nativeProxy'
import { localAgentRequestSchema, localAgentResponseSchema, type LocalAgentResponse } from '../../shared/localAgentContract'
import { createWorkspaceIdentity } from '../workspaceIdentity'
import { LocalAgentHarness } from './harness'
import { LocalAgentRepository } from './repository'
import { projectFileStatus } from '../projectFileObservation'
import { DesktopOperationError } from '../errors'
import { ZodError } from 'zod'

let harness: LocalAgentHarness | undefined
export async function operateLocalAgent(request: unknown): Promise<LocalAgentResponse> {
  try { return localAgentResponseSchema.parse(await operate(request)) }
  catch (error) {
    if (error instanceof DesktopOperationError || error instanceof ZodError) throw error
    throw new DesktopOperationError('LOCAL_AGENT_REQUEST_FAILED', 'CLI 操作未完成', error instanceof Error ? error.message.slice(0, 4000) : '当前请求未完成', '请根据提示调整当前任务后重试。')
  }
}
async function operate(request: unknown): Promise<LocalAgentResponse> {
  configureNativeSystemProxy(url => session.defaultSession.resolveProxy(url))
  const input = localAgentRequestSchema.parse(request)
  harness ??= new LocalAgentHarness(new LocalAgentRepository(app.getPath('userData')))
  if (input.operation === 'probe') return { enabled: true, probe: await harness.probe(input.adapter) }
  if (input.operation === 'capabilities') return { enabled: true, capabilities: await harness.capabilities(input.adapter, { refresh: input.refresh,
    ...(input.projectId && input.projectPath ? { workspace: createWorkspaceIdentity(input.projectId, input.projectPath) } : {}) }) }
  if (input.operation === 'configure') return { enabled: true, capabilities: await harness.configure(input.adapter, input.configuration,
    input.projectId && input.projectPath ? createWorkspaceIdentity(input.projectId, input.projectPath) : undefined) }
  const workspace = createWorkspaceIdentity(input.projectId, input.projectPath)
  switch (input.operation) {
    case 'workspace': return { enabled: true, workspace }
    case 'file-status': return { enabled: true, fileStatus: await projectFileStatus(input.projectPath) }
    case 'start': return { enabled: true, sessionId: await harness.start(workspace, input.adapter, input.prompt) }
    case 'resume': return { enabled: true, sessionId: await harness.resume(workspace, input.sessionId, input.prompt) }
    case 'generate': return { enabled: true, sessionId: await harness.generate(workspace, input.adapter, input.request, input.resumeSessionId, input.userMessage) }
    case 'continue': return { enabled: true, sessionId: await harness.continue(workspace, input.sessionId, input.request) }
    case 'candidate': {
      const generationResult = await harness.candidate(workspace, input.sessionId)
      const records = (await harness.list(workspace)).records.filter(record => record.id === input.sessionId)
      return { enabled: true, generationResult, records }
    }
    case 'host-result': return { enabled: true, records: [await harness.hostResult(workspace, input.sessionId, input.result, input.commitReceipt)] }
    case 'cancel': await harness.cancel(workspace, input.sessionId); return { enabled: true }
    case 'input': return { enabled: true, inputDelivery: await harness.input(workspace, input.sessionId, input.input) }
    case 'delete': await harness.delete(workspace, input.sessionId); return { enabled: true }
    case 'list': {
      const result = await harness.list(workspace)
      return { enabled: true, records: result.records.map(record => ({ ...record, events: [] })), damaged: result.damaged }
    }
    case 'read': {
      const result = await harness.list(workspace)
      return { enabled: true, records: result.records.filter(record => record.id === input.sessionId).map(record => ({ ...record, events: record.events.filter(event => event.sequence > input.after).slice(0, 200) })), damaged: result.damaged, fileStatus: await projectFileStatus(input.projectPath) }
    }
  }
}
export async function closeLocalAgents(): Promise<void> { await harness?.close() }
export function localAgentsRunning(): boolean { return harness?.running ?? false }
