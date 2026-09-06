import { app } from 'electron'
import { localAgentRequestSchema, localAgentResponseSchema, type LocalAgentResponse } from '../../shared/localAgentContract'
import { createWorkspaceIdentity } from '../workspaceIdentity'
import { LocalAgentHarness } from './harness'
import { LocalAgentRepository } from './repository'

let harness: LocalAgentHarness | undefined
export async function operateLocalAgent(request: unknown): Promise<LocalAgentResponse> {
  return localAgentResponseSchema.parse(await operate(request))
}
async function operate(request: unknown): Promise<LocalAgentResponse> {
  const input = localAgentRequestSchema.parse(request)
  if (process.env.COURSEWARE_CLI_DOGFOOD !== '1') return { enabled: false }
  harness ??= new LocalAgentHarness(new LocalAgentRepository(app.getPath('userData')))
  if (input.operation === 'probe') return { enabled: true, probe: await harness.probe(input.adapter) }
  const workspace = createWorkspaceIdentity(input.projectId, input.projectPath)
  switch (input.operation) {
    case 'start': return { enabled: true, sessionId: await harness.start(workspace, input.adapter, input.prompt) }
    case 'resume': return { enabled: true, sessionId: await harness.resume(workspace, input.sessionId, input.prompt) }
    case 'cancel': await harness.cancel(workspace, input.sessionId); return { enabled: true }
    case 'delete': await harness.delete(workspace, input.sessionId); return { enabled: true }
    case 'list': {
      const result = await harness.list(workspace)
      return { enabled: true, records: result.records.map(record => ({ ...record, events: [] })), damaged: result.damaged }
    }
    case 'read': {
      const result = await harness.list(workspace)
      return { enabled: true, records: result.records.filter(record => record.id === input.sessionId).map(record => ({ ...record, events: record.events.filter(event => event.sequence > input.after).slice(0, 200) })), damaged: result.damaged }
    }
  }
}
export async function closeLocalAgents(): Promise<void> { await harness?.close() }
export function localAgentsRunning(): boolean { return harness?.running ?? false }
