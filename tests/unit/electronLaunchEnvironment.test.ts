import { afterEach, describe, expect, it, vi } from 'vitest'
import { prepareElectronLaunchEnvironment } from '../../scripts/electronLaunchEnvironment'
import { createAgentEventDecoder, decodeAgentEvent } from '../fixtures/local-agent-v2/historicalWireDecoder'
import { localAgentText } from '../../src/shared/localAgentText'
import type { LocalAgentEvent } from '../../src/shared/localAgentContract'
import { createLocalAgentCliAdapterV2 } from '../../src/main/localAgent/adapter'
import { CLAUDE_CLI_ARGS } from '../../src/main/localAgent/claudeProcessTransport'
import { randomUUID } from 'node:crypto'
import { agentEnvironment, captureAgent, launchAgent, stopAgent } from '../../src/main/localAgent/process'
import { localAgentRequestSchema } from '../../src/shared/localAgentContract'
import type { GenerationRequest } from '../../src/shared/generationContract'
import { codexCandidateOutputSchema, codexTurnOutputSchema, decodeCodexStructuredOutput } from '../../src/main/localAgent/codexAppServer'
import { readGenerationResult } from '../../src/shared/generationResult'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// 全量并发下 Windows 临时目录清理会出现 EBUSY/ENOTEMPTY 竞态；有界重试（D2 同款）。
const win32RmRetry = process.platform === 'win32' ? { maxRetries: 8, retryDelay: 100 } : {}
afterEach(() => {
  vi.restoreAllMocks()
})

describe('native V2 factory and read-only historical wire fixtures', () => {
  it('reconciles Claude text after thinking when completed arrays omit the thinking block', () => {
    const decode = createAgentEventDecoder('claude')
    const wires = [
      { type: 'stream_event', event: { type: 'message_start', message: { id: 'm1' } } },
      { type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } } },
      { type: 'stream_event', event: { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } } },
      { type: 'stream_event', event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '先讨论' } } },
      { type: 'stream_event', event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '，再修改。' } } },
      { type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: '先讨论，再修改。' }] } },
    ]
    const events: LocalAgentEvent[] = []
    for (const wire of wires) events.push(...decode(wire).map(entry => ({ ...entry, version: 1 as const, adapter: 'claude' as const, sessionId: 'local', sequence: events.length + 1, time: 0 })))
    expect(localAgentText(events.slice(0, 1))).toBe('先讨论')
    expect(localAgentText(events)).toBe('先讨论，再修改。')
  })
  it('cancels only the target process tree while a sibling session stays alive', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-tree-'))
    const fixture = path.join(directory, 'tree.cjs')
    await fs.writeFile(fixture, `const {spawn}=require('node:child_process'); const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'}); require('node:fs').writeFileSync(process.argv[2],String(child.pid)); setInterval(()=>{},1000)`)
    const binary = { executable: process.execPath, prefix: [fixture] }
    const target = launchAgent(binary, [path.join(directory, 'target.pid')], directory)
    const sibling = launchAgent(binary, [path.join(directory, 'sibling.pid')], directory)
    const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }
    try {
      await expect.poll(async () => fs.readdir(directory)).toContain('target.pid')
      await expect.poll(async () => fs.readdir(directory)).toContain('sibling.pid')
      const descendant = Number(await fs.readFile(path.join(directory, 'target.pid'), 'utf8'))
      const siblingDescendant = Number(await fs.readFile(path.join(directory, 'sibling.pid'), 'utf8'))
      await stopAgent(target)
      await expect.poll(() => alive(descendant)).toBe(false)
      expect(alive(sibling.pid!)).toBe(true); expect(alive(siblingDescendant)).toBe(true)
    } finally { await stopAgent(target); await stopAgent(sibling); await fs.rm(directory, { recursive: true, force: true, ...win32RmRetry }) }
  })
  it.each(['codex', 'claude', 'opencode'] as const)('%s probes installation and rejects broken native handshakes from a real fixture process', async id => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'adapter-contract-'))
    const fixture = path.join(directory, 'adapter.cjs')
    const createAdapter = () => createLocalAgentCliAdapterV2(id, undefined, async () => ({ executable: process.execPath, prefix: [fixture] }))
    const adapter = createAdapter()
    const write = (code: string) => fs.writeFile(fixture, code)
    try {
      await write('console.log("99.0.0")')
      expect((await adapter.probe!()).status).toBe('unsupported-version')
      const version = id === 'codex' ? '0.153.0' : id === 'claude' ? '2.1.0' : '1.18.26'
      await write(`if(process.argv.includes('--version')) console.log(${JSON.stringify(version)}); else { console.log('{"loggedIn":true}'); }`)
      expect((await adapter.probe!()).status).toBe(id === 'opencode' ? 'unknown-auth' : 'ready')
      await write(`if(process.argv.includes('--version')) console.log(${JSON.stringify(version)}); else { console.log('{"loggedIn":false}'); process.exitCode=1; }`)
      expect((await adapter.probe!()).status).toBe(id === 'opencode' ? 'unknown-auth' : 'unauthenticated')
      for (const code of ['console.log("{bad")', 'process.exitCode=7', 'process.stderr.write("authentication failed"); process.exitCode=1']) {
        await write(code)
        const native = createAdapter()
        try {
          await expect(native.open({ cwd: directory, externalSessionId: null })).rejects.toThrow()
          expect(native.getExternalSessionId?.()).toBeNull()
        } finally { await native.close() }
      }
      await write(`if(process.argv.includes('--version')) console.log(${JSON.stringify(version)}); else process.stdout.write("x".repeat(32*1024*1024+1)+'\\n')`)
      const oversized = createAdapter()
      try {
        const opened = oversized.open({ cwd: directory, externalSessionId: null })
        if (id === 'claude') {
          // Claude reports stream limits on its event channel while the failed
          // initialize control separately rejects after the fixture exits.
          await expect(opened).rejects.toThrow()
          const collect = async () => { for await (const _ of oversized.events()) { /* drain native failure */ } }
          await expect(collect()).rejects.toThrow('output-limit')
        } else await expect(opened).rejects.toThrow('output-limit')
        expect(oversized.getExternalSessionId?.()).toBeNull()
      } finally { await oversized.close() }
    } finally { await adapter.close(); await fs.rm(directory, { recursive: true, force: true, ...win32RmRetry }) }
  })
  it.each(['codex', 'claude', 'opencode'] as const)('%s reports missing without starting another executable', async id => {
    const adapter = createLocalAgentCliAdapterV2(id, undefined, async () => null)
    expect((await adapter.probe!()).status).toBe('missing')
  })
  it('maps all three wire protocols and rejects unknown events', () => {
    expect(decodeAgentEvent('codex', { type: 'thread.started', thread_id: 'thread-1' })[0]).toMatchObject({ kind: 'session', externalSessionId: 'thread-1' })
    expect(decodeAgentEvent('codex', { type: 'item.completed', item: { id: 'i1', type: 'agent_message', text: '你好' } })[0]).toMatchObject({ kind: 'text', payload: { text: '你好' } })
    expect(decodeAgentEvent('claude', { type: 'system', subtype: 'init', session_id: 'external' })[0]?.externalSessionId).toBe('external')
    expect(decodeAgentEvent('claude', { type: 'system', subtype: 'thinking_tokens', session_id: 'external', thinking_tokens: 128 })[0]).toMatchObject({ kind: 'usage', payload: { thinking_tokens: 128 } })
    expect(decodeAgentEvent('claude', { type: 'system', subtype: 'api_retry', session_id: 'external', attempt: 1, max_retries: 3, retry_delay_ms: 1000, error_status: 429, error: 'rate_limit' })[0]).toMatchObject({ kind: 'session', payload: { status: 'api-retry', errorStatus: 429 } })
    expect(decodeAgentEvent('claude', { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool-1', name: 'Read', input: { path: 'a' } }] } })[0]?.kind).toBe('tool-call')
    expect(decodeAgentEvent('opencode', { type: 'tool_use', sessionID: 'session', part: { callID: 'call', tool: 'read', state: { input: {}, output: 'ok' } } }).map(e => e.kind)).toEqual(['tool-call', 'tool-result'])
    expect(decodeAgentEvent('opencode', { type: 'error', sessionID: 'session', error: { name: 'APIError', data: { statusCode: 429, message: 'FreeUsageLimitError' } } })[0]).toMatchObject({ kind: 'failed', failure: 'rate-limited' })
    for (const id of ['codex', 'claude', 'opencode'] as const) expect(() => decodeAgentEvent(id, { type: 'unexpected', sessionID: 's' })).toThrow()
  })
  it('rejects executable overrides while preserving native CLI environment and removing Electron host flags', () => {
    expect(localAgentRequestSchema.safeParse({ operation: 'probe', adapter: 'codex', executable: 'cmd.exe' }).success).toBe(false)
    expect(agentEnvironment({ PATH: 'bin', NATIVE_CLI_CONFIG: 'fixture-config', HTTPS_PROXY: 'fixture-proxy', ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '--max-old-space-size=1024' }))
      .toEqual({ PATH: 'bin', NATIVE_CLI_CONFIG: 'fixture-config', HTTPS_PROXY: 'fixture-proxy', NODE_OPTIONS: '--max-old-space-size=1024' })
    for (const id of ['codex', 'claude', 'opencode'] as const) {
      const adapter = createLocalAgentCliAdapterV2(id, undefined, async () => null)
      expect(adapter).toMatchObject({ id, open: expect.any(Function), startTurn: expect.any(Function), input: expect.any(Function), events: expect.any(Function), close: expect.any(Function) })
      expect('start' in adapter).toBe(false)
      expect('resume' in adapter).toBe(false)
    }
    expect(CLAUDE_CLI_ARGS).toContain('--include-partial-messages')
  })
  it('uses the exact program and literal args with spaces, Chinese and shell metacharacters', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'CLI 中文 space-'))
    try {
      const fixture = path.join(directory, 'fixture with 空格.cjs')
      await fs.writeFile(fixture, 'process.stdout.write(JSON.stringify(process.argv.slice(2)))')
      const args = ['中文 with spaces', '& echo injected > marker', '$(whoami)', '`hostname`']
      const result = await captureAgent({ executable: process.execPath, prefix: [fixture] }, args, directory)
      expect(result.code).toBe(0)
      expect(JSON.parse(result.text)).toEqual(args)
      expect(await fs.readdir(directory)).toEqual(['fixture with 空格.cjs'])
    } finally { await fs.rm(directory, { recursive: true, force: true, ...win32RmRetry }) }
  })
  it('builds a Codex app-server schema without unsupported free-form JSON keywords', () => {
    const requestId = '89e7b74a-2ba4-4f03-ad94-89aef212a776'
    const schema = codexCandidateOutputSchema({ requestId } as GenerationRequest)
    const text = JSON.stringify(schema)
    expect(text).not.toContain('"oneOf"')
    expect(text).not.toContain('"propertyNames"')
    expect(text).not.toContain('"format"')
    const properties = schema.properties as Record<string, { $ref?: string; const?: number; type?: string }>
    const definitions = schema.$defs as Record<string, unknown>
    const version = properties.version
    const resolvedVersion = version.$ref ? definitions[version.$ref.split('/').at(-1)!] : version
    expect(resolvedVersion).toMatchObject({ const: 2 })
    expect(properties.requestId).toMatchObject({ type: 'string' })
    expect(schema).toEqual(codexCandidateOutputSchema({ requestId: '2a42b1a2-1b08-411f-9407-81332bc0a229' } as GenerationRequest))
    expect(text).not.toContain('"candidateId"')
    expect(text).not.toContain('"authoringAddress"')
    expect(text).toContain('A complete JSON serialization of the selected authoring tool input.')
  })
  it('uses a strict reply-or-edit envelope for Codex auto requests', () => {
    const requestId = '89e7b74a-2ba4-4f03-ad94-89aef212a776'
    const schema = codexTurnOutputSchema({ requestId, expectedResult: 'auto' } as GenerationRequest) as any
    expect(schema).toMatchObject({
      type: 'object', additionalProperties: false,
      properties: { requestId: { type: 'string' }, kind: { enum: ['reply', 'edit'] } },
      required: ['version', 'requestId', 'kind', 'reply', 'candidate'],
    })
    const text = JSON.stringify(schema)
    expect(text).not.toContain('"oneOf"')
    expect(text).not.toContain('"propertyNames"')
    expect(text).not.toContain('"format"')
  })
  it('unwraps Codex auto replies and leaves malformed candidate input for host repair', () => {
    const requestId = '89e7b74a-2ba4-4f03-ad94-89aef212a776'
    const request = { requestId, expectedResult: 'auto' } as GenerationRequest
    expect(decodeCodexStructuredOutput(JSON.stringify({
      version: 1, requestId, kind: 'reply', reply: '平均分表示一组数据的整体水平。', candidate: null,
    }), request)).toBe('平均分表示一组数据的整体水平。')
    const candidate = {
      version: 1, requestId, candidateId: '2a42b1a2-1b08-411f-9407-81332bc0a229', summary: '新增文字', steps: [{
        id: 's1', tool: 'native.content', carrier: 'native', lowerCarrierReason: null,
        destination: { kind: 'create', scope: {
          projectId: 'project', documentRevision: 0, revisionPolicy: { kind: 'exact' }, sessionGeneration: 0,
          surfaceType: 'slide', surfaceId: 'surface', locationId: 'location', stateId: null,
          owner: 'scene', ownerKey: 'scene:location', parent: { kind: 'owner' }, insertion: { kind: 'append' },
        } },
        input: '{broken',
      }],
    }
    const decoded = decodeCodexStructuredOutput(JSON.stringify({
      version: 1, requestId, kind: 'edit', reply: null, candidate,
    }), request)
    expect(readGenerationResult(decoded, request)).toMatchObject({
      kind: 'candidate-format-error', requestId,
    })
    const valid = decodeCodexStructuredOutput(JSON.stringify({
      version: 1, requestId, kind: 'edit', reply: null,
      candidate: { ...candidate, steps: [{ ...candidate.steps[0], input: '{"operation":"insert"}' }] },
    }), request)
    expect(readGenerationResult(valid, request)).toMatchObject({
      kind: 'candidate', candidate: { steps: [{ input: { operation: 'insert' } }] },
    })
    expect(() => decodeCodexStructuredOutput(JSON.stringify({
      version: 1, requestId, kind: 'reply', reply: '说明', candidate,
    }), request)).toThrow('reply envelope')
  })
  it('forwards explicit native permission answers and replaces a staged candidate through V2 ACP', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-candidate-'))
    const requestId = '2a42b1a2-1b08-411f-9407-81332bc0a229'
    const candidateDirectory = path.join(directory, 'candidates', requestId)
    await fs.mkdir(candidateDirectory, { recursive: true })
    const candidatePath = path.join(candidateDirectory, 'candidate.json')
    const fixture = path.join(directory, 'acp.cjs')
    const permission = (id: number, target: string) => ({ jsonrpc: '2.0', id, method: 'session/request_permission', params: {
      sessionId: 'session-1', toolCall: { toolCallId: `tool-${id}`, kind: 'edit', title: 'Write candidate', locations: [{ path: target }] },
      options: [{ optionId: `allow-${id}`, kind: 'allow_once', name: 'Allow once' }, { optionId: `reject-${id}`, kind: 'reject_once', name: 'Reject once' }],
    } })
    await fs.writeFile(fixture, `
const readline=require('node:readline').createInterface({input:process.stdin});
const send=value=>process.stdout.write(JSON.stringify(value)+'\\n'); let promptId=0;
readline.on('line',line=>{const m=JSON.parse(line);
 if(m.method==='initialize') return send({jsonrpc:'2.0',id:m.id,result:{protocolVersion:1,agentCapabilities:{loadSession:true}}});
 if(m.method==='session/new') return send({jsonrpc:'2.0',id:m.id,result:{sessionId:'session-1'}});
 if(m.method==='session/set_config_option') return send({jsonrpc:'2.0',id:m.id,result:{}});
 if(m.method==='session/prompt'){promptId=m.id;return send(${JSON.stringify(permission(100, '../escape.json'))});}
 if(m.id===100){if(m.result?.outcome?.optionId!=='reject-100')process.exit(10);return send(${JSON.stringify(permission(101, candidatePath))});}
 if(m.id===101){if(m.result?.outcome?.optionId!=='allow-101')process.exit(11);return send({jsonrpc:'2.0',id:102,method:'fs/write_text_file',params:{sessionId:'session-1',path:${JSON.stringify(candidatePath)},content:'{"broken":true}'}});}
 if(m.id===102)return send({jsonrpc:'2.0',id:103,method:'fs/write_text_file',params:{sessionId:'session-1',path:${JSON.stringify(candidatePath)},content:'{"version":1}'}});
 if(m.id===103)return send({jsonrpc:'2.0',id:promptId,result:{stopReason:'end_turn'}});
});`)
    const adapter = createLocalAgentCliAdapterV2('opencode', { requestId } as GenerationRequest, async () => ({ executable: process.execPath, prefix: [fixture] }))
    try {
      await adapter.open({ cwd: directory, externalSessionId: null, candidateRoot: candidateDirectory })
      const identity = { taskId: randomUUID(), epoch: 0, workspace: { version: 1 as const, projectId: 'p1', normalizedPath: 'c:/lessons/native-test.h5lesson' } }
      await adapter.startTurn({ ...identity, runId: randomUUID(), observationId: randomUUID(), text: 'write candidate', imageFileIds: [] }, new Map())
      const answers: string[] = []
      let completed = false
      for await (const event of adapter.events()) {
        if (event.kind === 'question') {
          const question = event.question
          const value = answers.length ? 'Allow once' : 'Reject once'
          const delivery = await adapter.input({ version: 1, ...identity, inputId: randomUUID(), turnId: question.turnId,
            kind: 'answer', questionId: question.questionId, answers: [{ id: question.questions[0]!.id, values: [value] }] })
          expect(delivery.status).toBe('accepted')
          answers.push(value)
        } else if (event.kind === 'turn-ended') completed = event.status === 'completed'
      }
      expect(answers).toEqual(['Reject once', 'Allow once'])
      expect(completed).toBe(true)
      expect(JSON.parse(await fs.readFile(candidatePath, 'utf8'))).toEqual({ version: 1 })
    } finally { await adapter.close(); await fs.rm(directory, { recursive: true, force: true, ...win32RmRetry }) }
  })
})

/** The warning is expected on every clearing path; keep it out of the report. */
function silenceWarning(): void {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
}

describe('prepareElectronLaunchEnvironment', () => {
  it('leaves a clean environment untouched', () => {
    const environment = { PATH: '/usr/bin' }
    expect(prepareElectronLaunchEnvironment(environment)).toEqual([])
    expect(environment).toEqual({ PATH: '/usr/bin' })
  })

  it('removes the variable at every value that degrades Electron', () => {
    // Measured against the pinned Electron 43.1.1: unset reports v43.1.1, while
    // '', '0', '1' and 'false' all report Node's v24.18.0. Presence is what
    // breaks the launch, so the shell conventions for "off" have to be removed
    // too -- treating them as absent was a false negative in the only check
    // between a sandboxed shell and an unreadable launch failure.
    for (const value of ['', '0', '1', 'false']) {
      silenceWarning()
      const environment: NodeJS.ProcessEnv = { ELECTRON_RUN_AS_NODE: value, PATH: '/usr/bin' }
      expect(prepareElectronLaunchEnvironment(environment), JSON.stringify(value))
        .toEqual(['ELECTRON_RUN_AS_NODE'])
      expect(environment, JSON.stringify(value)).toEqual({ PATH: '/usr/bin' })
      expect('ELECTRON_RUN_AS_NODE' in environment, JSON.stringify(value)).toBe(false)
    }
  })

  it('says what it removed, so the repair is not silent', () => {
    silenceWarning()
    prepareElectronLaunchEnvironment({ ELECTRON_RUN_AS_NODE: '1' })
    expect(console.warn).toHaveBeenCalledTimes(1)
    expect(vi.mocked(console.warn).mock.calls[0]![0]).toContain('ELECTRON_RUN_AS_NODE')
  })

  it('is idempotent, so entry points may each call it', () => {
    silenceWarning()
    const environment: NodeJS.ProcessEnv = { ELECTRON_RUN_AS_NODE: '1' }
    expect(prepareElectronLaunchEnvironment(environment)).toEqual(['ELECTRON_RUN_AS_NODE'])
    expect(prepareElectronLaunchEnvironment(environment)).toEqual([])
  })

  it('defaults to this process, which is what production callers use', () => {
    silenceWarning()
    prepareElectronLaunchEnvironment()
    expect(process.env.ELECTRON_RUN_AS_NODE).toBeUndefined()
  })
})
