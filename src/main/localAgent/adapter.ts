import type { LocalAgentId } from '../../shared/localAgentContract'
import type { LocalAgentCliAdapterV2 } from '../../shared/localAgentTaskContract'
import type { GenerationRequest } from '../../shared/generationContract'
import { resolveAgentExecutable } from './process'
import { OpenCodeAcpAdapter } from './openCodeAcp'
import { CodexAppServerAdapter } from './codexAppServer'
import { ClaudeProcessTransportAdapter } from './claudeProcessTransport'

export function createLocalAgentCliAdapterV2(
  id: LocalAgentId,
  request?: GenerationRequest,
  resolve = resolveAgentExecutable,
): LocalAgentCliAdapterV2 {
  if (id === 'codex') return new CodexAppServerAdapter(resolve, request)
  if (id === 'claude') return new ClaudeProcessTransportAdapter(resolve)
  if (id === 'opencode') return new OpenCodeAcpAdapter(resolve, request)
  throw new Error(`Unsupported adapter: ${id}`)
}
