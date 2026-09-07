import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { MAX_GENERATION_RESULT_BYTES } from '../../shared/generationResult'
import type { GenerationRequest } from '../../shared/generationContract'

const normalized = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value

async function candidateFilename(cwd: string, requestId: string): Promise<string> {
  const session = await fs.realpath(cwd)
  if (normalized(session) !== normalized(path.resolve(cwd))) throw new Error('protocol')
  const root = path.join(session, 'candidates', requestId)
  if (normalized(await fs.realpath(root)) !== normalized(root)) throw new Error('protocol')
  return path.join(root, 'candidate.json')
}

function resolvesTo(filename: string, cwd: string, expected: string): boolean {
  return normalized(path.resolve(cwd, filename)) === normalized(expected)
}

function permissionTargetsCandidate(toolCall: Record<string, any>, cwd: string, expected: string): boolean {
  if (toolCall.kind !== 'edit') return false
  const locations = Array.isArray(toolCall.locations) ? toolCall.locations : []
  if (locations.some(value => typeof value?.path === 'string' && resolvesTo(value.path, cwd, expected))) return true
  const input = toolCall.rawInput
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false
  return ['path', 'filePath', 'filename'].some(key => typeof input[key] === 'string' && resolvesTo(input[key], cwd, expected))
}

/** Native CLI session transport over stdin/stdout; exposes no host tools or live project API. */
export async function* openCodeAcp(child: ChildProcessWithoutNullStreams, cwd: string, prompt: string,
  externalId?: string, request?: GenerationRequest): AsyncGenerator<unknown> {
  const model = process.env.COURSEWARE_OPENCODE_MODEL?.trim() || 'opencode/big-pickle'
  const candidate = request ? await candidateFilename(cwd, request.requestId) : undefined
  let id = 0
  const send = (method: string, params: unknown) => {
    const requestId = ++id
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }) + '\n')
    return requestId
  }
  let waiting = send('initialize', { protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: Boolean(candidate) }, terminal: false },
    clientInfo: { name: 'courseware-editor', version: '1.8' } })
  let phase: 'initialize' | 'session' | 'model' | 'prompt' = 'initialize'
  let sessionId = externalId ?? ''
  let total = 0
  let candidateWrites = 0
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
  try {
    for await (const line of lines) {
      total += Buffer.byteLength(line)
      if (total > 8 * 1024 * 1024 || Buffer.byteLength(line) > 1024 * 1024) throw new Error('output-limit')
      const wire = JSON.parse(line)
      if (wire.method === 'session/request_permission') {
        const toolCall = wire.params?.toolCall
        const option = Array.isArray(wire.params?.options) ? wire.params.options.find((value: any) => value?.kind === 'allow_once') : undefined
        const allowed = candidate && phase === 'prompt' && wire.params?.sessionId === sessionId && option?.optionId
          && toolCall && permissionTargetsCandidate(toolCall, cwd, candidate)
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: wire.id, result: { outcome: allowed
          ? { outcome: 'selected', optionId: option.optionId }
          : { outcome: 'cancelled' } } }) + '\n')
        if (!allowed) yield { type: 'acp_permission_denied', sessionID: sessionId, title: toolCall?.title ?? 'CLI 工具访问' }
        continue
      }
      if (wire.method === 'fs/write_text_file') {
        const params = wire.params
        const valid = candidate && phase === 'prompt' && params?.sessionId === sessionId
          && typeof params.path === 'string' && resolvesTo(params.path, cwd, candidate)
          && typeof params.content === 'string' && Buffer.byteLength(params.content) <= MAX_GENERATION_RESULT_BYTES
        if (!valid || ++candidateWrites > 8) {
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: wire.id, error: { code: -32602, message: 'Only the current candidate file is writable' } }) + '\n')
          continue
        }
        try {
          const existing = await fs.realpath(candidate).then(value => value, error => {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
            throw error
          })
          if (existing && normalized(existing) !== normalized(candidate)) throw new Error('Candidate path changed before write')
          const handle = await fs.open(candidate, existing ? 'r+' : 'wx', 0o600)
          try {
            if (existing) await handle.truncate(0)
            await handle.writeFile(params.content, 'utf8')
          } finally { await handle.close() }
          if (normalized(await fs.realpath(candidate)) !== normalized(candidate)) throw new Error('Candidate path changed during write')
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: wire.id, result: {} }) + '\n')
        } catch (error) {
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: wire.id, error: {
            code: -32603, message: error instanceof Error ? error.message.slice(0, 300) : 'Candidate write failed',
          } }) + '\n')
        }
        continue
      }
      if (wire.method === 'session/update') {
        // session/load replays history; only this prompt's new events belong to the current record.
        if (phase === 'prompt' && wire.params?.sessionId === sessionId) yield { type: 'acp_update', sessionID: sessionId, update: wire.params.update }
        continue
      }
      if (wire.method && wire.id !== undefined) {
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: wire.id, error: { code: -32601, message: 'Client capability not available' } }) + '\n')
        continue
      }
      if (wire.id !== waiting) continue
      if (wire.error) yield { type: 'error', sessionID: sessionId || 'initializing', error: wire.error }
      if (wire.error) return
      if (phase === 'initialize') {
        if (wire.result?.protocolVersion !== 1) throw new Error('unsupported-version')
        if (externalId && !wire.result?.agentCapabilities?.loadSession) throw new Error('unsupported-version')
        waiting = send(externalId ? 'session/load' : 'session/new', { cwd, mcpServers: [], ...(externalId ? { sessionId: externalId } : {}) })
        phase = 'session'
      } else if (phase === 'session') {
        sessionId = externalId ?? wire.result?.sessionId
        if (!sessionId) throw new Error('protocol')
        yield { type: 'acp_session', sessionID: sessionId }
        waiting = send('session/set_config_option', { sessionId, configId: 'model', value: model })
        phase = 'model'
      } else if (phase === 'model') {
        waiting = send('session/prompt', { sessionId, prompt: [{ type: 'text', text: prompt }] })
        phase = 'prompt'
      } else {
        yield { type: 'acp_result', sessionID: sessionId, stopReason: wire.result?.stopReason }
        return
      }
    }
    throw new Error('interrupted')
  } finally { lines.close() }
}
