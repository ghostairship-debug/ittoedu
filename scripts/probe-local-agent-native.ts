/** Opt-in live CLI protocol probe. Does not import Electron or open a course. */
import { createInterface } from 'node:readline'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { captureAgent, launchAgent, resolveAgentExecutable, stopAgent } from '../src/main/localAgent/process'
import { localAgentIdSchema, type LocalAgentId } from '../src/shared/localAgentContract'

type Wire = Record<string, any>
const adapter = localAgentIdSchema.parse(process.argv[2])
const mode = process.argv[3] ?? 'metadata'
if (!['metadata', 'conversation', 'control', 'cancel'].includes(mode)) throw new Error('Use metadata, conversation, control or cancel')
const out = path.resolve('output/r18-native-preflight', `${adapter}-${mode}-${Date.now()}`)
const cwd = path.join(out, 'workspace')

async function main() {
  await fs.mkdir(cwd, { recursive: true })
  const token = `OBS-${randomUUID().slice(0, 8)}`
  await fs.writeFile(path.join(cwd, 'observation.txt'), token, 'utf8')
  // Two large regions give a falsifiable image result; filenames/prompts reveal no colours.
  const pixels = Buffer.alloc(160 * 80 * 3)
  for (let y = 0; y < 80; y++) for (let x = 0; x < 160; x++) pixels[(y * 160 + x) * 3 + (x < 80 ? 0 : 2)] = 255
  const png = await sharp(pixels, { raw: { width: 160, height: 80, channels: 3 } }).png().toBuffer()
  const imagePath = path.join(cwd, 'sample.png')
  await fs.writeFile(imagePath, png)
  const binary = await resolveAgentExecutable(adapter)
  if (!binary) throw new Error(`${adapter} missing`)
  const version = (await captureAgent(binary, ['--version'], cwd)).text.trim()
  const args: Record<LocalAgentId, string[]> = {
    codex: ['app-server', '--stdio'], opencode: ['acp'],
    claude: ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--replay-user-messages', '--permission-prompt-tool', 'stdio', '--tools', 'Read,AskUserQuestion'],
  }
  const child = launchAgent(binary, args[adapter], cwd)
  const transcript: Wire[] = []
  const summary: Wire = { adapter, version, mode, createdAt: new Date().toISOString(), cwd, expected: { image: 'red left, blue right', token }, results: {} }
  let stderr = '', id = 0, cursor = 0
  child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-4000) })
  const lines = createInterface({ input: child.stdout })
  const waiting = new Set<() => void>()
  const send = (value: Wire) => { transcript.push({ direction: 'out', value }); child.stdin.write(JSON.stringify(value) + '\n') }
  const awaitMessage = (predicate: (value: Wire) => boolean, start = transcript.length, timeout = adapter === 'opencode' ? 120_000 : 60_000): Promise<Wire> => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waiting.delete(check); reject(new Error('Native response deadline exceeded')) }, timeout)
    const check = () => {
      const entry = transcript.slice(start).find(e => e.direction === 'in' && predicate(e.value))
      if (entry) { clearTimeout(timer); waiting.delete(check); resolve(entry.value) }
      else if (child.exitCode !== null) { clearTimeout(timer); waiting.delete(check); reject(new Error(`Native process exited ${child.exitCode}: ${stderr}`)) }
    }
    waiting.add(check); check()
  })
  lines.on('line', line => {
    try {
      const value: Wire = JSON.parse(line)
      transcript.push({ direction: 'in', value })
      // Only the owned observation file may be read; no writes, terminal or external tools.
      if (value.method === 'fs/read_text_file') {
        const allowed = path.resolve(value.params.path) === path.join(cwd, 'observation.txt')
        send({ jsonrpc: '2.0', id: value.id, ...(allowed ? { result: { content: token } } : { error: { code: -32602, message: 'Outside probe observation' } }) })
      } else if (value.method === 'session/request_permission') {
        send({ jsonrpc: '2.0', id: value.id, result: { outcome: { outcome: 'cancelled' } } })
      } else if (value.method === 'item/tool/requestUserInput') {
        const answers = Object.fromEntries(value.params.questions.map((q: Wire) => [q.id, { answers: ['Green'] }]))
        send({ id: value.id, result: { answers } })
      } else if (value.method && value.id !== undefined) {
        send({ id: value.id, error: { code: -32601, message: 'Not enabled by read-only probe' } })
      } else if (value.type === 'control_request') {
        const request = value.request
        let response: Wire = { behavior: 'deny', message: 'Not enabled by read-only probe' }
        if (request.subtype === 'can_use_tool' && request.tool_name === 'AskUserQuestion') {
          const answers = Object.fromEntries((request.input.questions ?? []).map((q: Wire) => [q.question, 'Green']))
          response = { behavior: 'allow', updatedInput: { ...request.input, answers } }
        } else if (request.subtype === 'can_use_tool' && request.tool_name === 'Read' && path.resolve(request.input.file_path ?? '') === path.join(cwd, 'observation.txt')) {
          response = { behavior: 'allow', updatedInput: request.input }
        }
        send({ type: 'control_response', response: { subtype: 'success', request_id: value.request_id, response } })
      }
      for (const check of waiting) check()
    } catch (error) { summary.parseError = String(error); process.exitCode = 1 }
  })
  child.once('close', () => { for (const check of waiting) check() })
  const rpc = async (method: string, params: Wire): Promise<Wire> => {
    const requestId = ++id, start = transcript.length
    send({ ...(adapter === 'opencode' ? { jsonrpc: '2.0' } : {}), id: requestId, method, params })
    const response = await awaitMessage(v => v.id === requestId && !v.method, start)
    if (response.error) throw new Error(`${method}: ${JSON.stringify(response.error)}`)
    return response.result
  }
  const control = async (subtype: string, params: Wire = {}) => {
    const requestId = `probe-${++id}`, start = transcript.length
    send({ type: 'control_request', request_id: requestId, request: { subtype, ...params } })
    const value = await awaitMessage(v => v.type === 'control_response' && v.response.request_id === requestId, start)
    if (value.response.subtype !== 'success') throw new Error(JSON.stringify(value.response))
    return value.response.response
  }
  const claudeInput = (content: unknown) => send({ type: 'user', uuid: randomUUID(), session_id: '', parent_tool_use_id: null, message: { role: 'user', content } })
  try {
    let sessionId = '', model = ''
    if (adapter === 'codex') {
      summary.initialize = await rpc('initialize', { clientInfo: { name: 'courseware_native_preflight', version: '1' }, capabilities: { experimentalApi: true } })
      send({ method: 'initialized' })
      summary.models = await rpc('model/list', { limit: 100, includeHidden: false })
      if (mode !== 'metadata') {
        const result = await rpc('thread/start', { cwd, sandbox: 'read-only', approvalPolicy: 'never' })
        sessionId = result.thread.id; model = result.model; summary.model = model
      }
    } else if (adapter === 'opencode') {
      summary.initialize = await rpc('initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: true, writeTextFile: false }, terminal: false }, clientInfo: { name: 'courseware_native_preflight', version: '1' } })
      summary.session = await rpc('session/new', { cwd, mcpServers: [] })
      sessionId = summary.session.sessionId
      model = summary.session.configOptions?.find((o: Wire) => o.category === 'model')?.currentValue
      if (process.argv[4]) {
        const option = summary.session.configOptions?.find((o: Wire) => o.category === 'model')
        if (!option?.options?.some((value: Wire) => value.value === process.argv[4])) throw new Error('Requested probe model was not advertised')
        summary.configuration = await rpc('session/set_config_option', { sessionId, configId: option.id, value: process.argv[4] })
        model = summary.configuration.configOptions?.find((o: Wire) => o.category === 'model')?.currentValue
        if (model !== process.argv[4]) throw new Error('Native model configuration was not acknowledged')
      }
      summary.model = model
    } else {
      summary.initialize = await control('initialize', { hooks: {}, sdkMcpServers: [], agents: [] })
    }
    if (mode === 'metadata') return
    const prompt = 'This is an isolated read-only protocol test. Do not read parent folders or invoke skills or agents. Describe the attached image left to right. Use your native file reading tool to read observation.txt in the current working directory, and quote its token exactly. Keep the reply under 60 words.'
    if (mode === 'cancel' && adapter === 'codex') {
      cursor = transcript.length
      const active = await rpc('turn/start', { threadId: sessionId, input: [{ type: 'text', text: 'Write 100 classroom examples. Do not use tools.' }], effort: 'low' })
      await awaitMessage(v => v.method === 'turn/started' && v.params.turn.id === active.turn.id, cursor)
      summary.results.cancelAck = await rpc('turn/interrupt', { threadId: sessionId, turnId: active.turn.id })
      summary.results.cancelled = await awaitMessage(v => v.method === 'turn/completed' && v.params.turn.id === active.turn.id, cursor)
    } else if (mode === 'conversation') {
      cursor = transcript.length
      if (adapter === 'codex') {
        const result = await rpc('turn/start', { threadId: sessionId, input: [{ type: 'text', text: prompt }, { type: 'localImage', path: imagePath }], effort: 'low' })
        summary.results.first = await awaitMessage(v => v.method === 'turn/completed' && v.params.turn.id === result.turn.id, cursor)
      } else if (adapter === 'opencode') {
        summary.results.first = await rpc('session/prompt', { sessionId, prompt: [{ type: 'text', text: prompt }, { type: 'image', mimeType: 'image/png', data: png.toString('base64') }] })
      } else {
        claudeInput([{ type: 'text', text: prompt }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png.toString('base64') } }])
        summary.results.first = await awaitMessage(v => v.type === 'result', cursor)
      }
      const feedback = 'Host result for this PROBE ONLY: candidate rejected; diagnostic PROBE_WIDTH. No project was changed. In one sentence acknowledge that diagnostic and repeat the observation token from the previous turn. Do not read any files again.'
      cursor = transcript.length
      if (adapter === 'codex') {
        const result = await rpc('turn/start', { threadId: sessionId, input: [{ type: 'text', text: feedback }], effort: 'low' })
        summary.results.feedback = await awaitMessage(v => v.method === 'turn/completed' && v.params.turn.id === result.turn.id, cursor)
      } else if (adapter === 'opencode') summary.results.feedback = await rpc('session/prompt', { sessionId, prompt: [{ type: 'text', text: feedback }] })
      else { claudeInput(feedback); summary.results.feedback = await awaitMessage(v => v.type === 'result', cursor) }
    } else {
      cursor = transcript.length
      const question = 'Use your native structured user-question tool to ask whether the probe label should be Green or Blue. This choice is unknown and required for this protocol test. After I answer, reply only with the selected label. Do not inspect files, invoke agents or skills, or make changes.'
      if (adapter === 'codex') {
        const result = await rpc('turn/start', { threadId: sessionId, input: [{ type: 'text', text: question }], collaborationMode: { mode: 'plan', settings: { model, reasoning_effort: 'low', developer_instructions: null } } })
        summary.results.question = await awaitMessage(v => v.method === 'turn/completed' && v.params.turn.id === result.turn.id, cursor)
        const active = await rpc('turn/start', { threadId: sessionId, input: [{ type: 'text', text: 'Write a numbered list of 100 short classroom examples. Do not use tools.' }], effort: 'low' })
        summary.results.steer = await rpc('turn/steer', { threadId: sessionId, expectedTurnId: active.turn.id, input: [{ type: 'text', text: 'Correction: stop the list and say CORRECTION_RECEIVED only.' }] })
        summary.results.corrected = await awaitMessage(v => v.method === 'turn/completed' && v.params.turn.id === active.turn.id, cursor)
        const cancelTurn = await rpc('turn/start', { threadId: sessionId, input: [{ type: 'text', text: 'Write 100 more examples. Do not use tools.' }] })
        await awaitMessage(v => v.method === 'turn/started' && v.params.turn.id === cancelTurn.turn.id, cursor)
        summary.results.cancelAck = await rpc('turn/interrupt', { threadId: sessionId, turnId: cancelTurn.turn.id })
        summary.results.cancelled = await awaitMessage(v => v.method === 'turn/completed' && v.params.turn.id === cancelTurn.turn.id, cursor)
      } else if (adapter === 'claude') {
        claudeInput(question); summary.results.question = await awaitMessage(v => v.type === 'result', cursor)
        cursor = transcript.length; claudeInput('Write 100 classroom examples. Do not use tools.')
        await awaitMessage(v => v.type === 'stream_event', cursor)
        summary.results.interrupt = await control('interrupt')
        summary.results.cancelled = await awaitMessage(v => v.type === 'result', cursor)
        cursor = transcript.length; claudeInput('Correction: say CORRECTION_RECEIVED only.')
        summary.results.corrected = await awaitMessage(v => v.type === 'result', cursor)
      } else {
        summary.results.question = await rpc('session/prompt', { sessionId, prompt: [{ type: 'text', text: question }] })
        summary.results.answer = await rpc('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'Green. Reply with the selected label only.' }] })
        const cancelled = rpc('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'Write 100 short classroom examples. Do not use tools.' }] })
        void cancelled.catch(() => {}) // Keep the pending failure handled while waiting for admission.
        // Wait for a new update before cancellation, avoiding cancellation before prompt admission.
        await awaitMessage(v => v.method === 'session/update', transcript.length)
        send({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId } })
        summary.results.cancelled = await cancelled
        summary.results.corrected = await rpc('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'Correction: say CORRECTION_RECEIVED only.' }] })
      }
    }
  } catch (error) { summary.error = String(error); process.exitCode = 1 }
  finally {
    lines.close(); await stopAgent(child)
    // Local diagnostic only: external session IDs and machine paths are not committed fixtures.
    await fs.writeFile(path.join(out, 'transcript.json'), JSON.stringify(transcript, null, 2))
    await fs.writeFile(path.join(out, 'summary.json'), JSON.stringify({ ...summary, stderr }, null, 2))
    console.log(JSON.stringify({ adapter, mode, out, error: summary.error, model: summary.model, results: summary.results }, null, 2))
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
