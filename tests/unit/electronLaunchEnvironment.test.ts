import { afterEach, describe, expect, it, vi } from 'vitest'
import { prepareElectronLaunchEnvironment } from '../../scripts/electronLaunchEnvironment'
import { decodeAgentEvent } from '../../src/main/localAgent/protocol'
import { agentArguments, LocalAgentAdapter } from '../../src/main/localAgent/adapter'
import { agentEnvironment, captureAgent, launchAgent, stopAgent } from '../../src/main/localAgent/process'
import { localAgentRequestSchema } from '../../src/shared/localAgentContract'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('LocalAgentCliAdapterV1', () => {
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
    } finally { await stopAgent(target); await stopAgent(sibling); await fs.rm(directory, { recursive: true, force: true }) }
  })
  it.each(['codex', 'claude', 'opencode'] as const)('%s normalizes installed, unsupported, bad JSON and crashes from a real fixture process', async id => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'adapter-contract-'))
    const fixture = path.join(directory, 'adapter.cjs')
    const adapter = new LocalAgentAdapter(id, async () => ({ executable: process.execPath, prefix: [fixture] }))
    const write = (code: string) => fs.writeFile(fixture, code)
    try {
      await write('console.log("99.0.0")')
      expect((await adapter.probe()).status).toBe('unsupported-version')
      const version = id === 'codex' ? '0.153.0' : id === 'claude' ? '2.1.0' : '1.18.26'
      await write(`if(process.argv.includes('--version')) console.log(${JSON.stringify(version)}); else { console.log('{"loggedIn":true}'); }`)
      expect((await adapter.probe()).status).toBe(id === 'opencode' ? 'unknown-auth' : 'ready')
      await write(`if(process.argv.includes('--version')) console.log(${JSON.stringify(version)}); else { console.log('{"loggedIn":false}'); process.exitCode=1; }`)
      expect((await adapter.probe()).status).toBe(id === 'opencode' ? 'unknown-auth' : 'unauthenticated')
      const collect = async () => { for await (const _wire of adapter.start('hello', directory)) { /* parse at transport boundary */ } }
      await write('console.log("{bad")')
      await expect(collect()).rejects.toThrow('protocol')
      await write('process.exitCode=7')
      await expect(collect()).rejects.toThrow('crash')
      await write('process.stderr.write("authentication failed"); process.exitCode=1')
      await expect(collect()).rejects.toThrow('unauthenticated')
      await write('process.stdout.write("x".repeat(1024*1024+1))')
      await expect(collect()).rejects.toThrow('output-limit')
    } finally { await adapter.cancel(); await fs.rm(directory, { recursive: true, force: true }) }
  })
  it.each(['codex', 'claude', 'opencode'] as const)('%s reports missing without starting another executable', async id => {
    const adapter = new LocalAgentAdapter(id, async () => null)
    expect((await adapter.probe()).status).toBe('missing')
  })
  it('maps all three wire protocols and rejects unknown events', () => {
    expect(decodeAgentEvent('codex', { type: 'thread.started', thread_id: 'thread-1' })[0]).toMatchObject({ kind: 'session', externalSessionId: 'thread-1' })
    expect(decodeAgentEvent('codex', { type: 'item.completed', item: { id: 'i1', type: 'agent_message', text: '你好' } })[0]).toMatchObject({ kind: 'text', payload: { text: '你好' } })
    expect(decodeAgentEvent('claude', { type: 'system', subtype: 'init', session_id: 'external' })[0]?.externalSessionId).toBe('external')
    expect(decodeAgentEvent('claude', { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool-1', name: 'Read', input: { path: 'a' } }] } })[0]?.kind).toBe('tool-call')
    expect(decodeAgentEvent('opencode', { type: 'tool_use', sessionID: 'session', part: { callID: 'call', tool: 'read', state: { input: {}, output: 'ok' } } }).map(e => e.kind)).toEqual(['tool-call', 'tool-result'])
    expect(decodeAgentEvent('opencode', { type: 'error', sessionID: 'session', error: { name: 'APIError', data: { statusCode: 429, message: 'FreeUsageLimitError' } } })[0]).toMatchObject({ kind: 'failed', failure: 'rate-limited' })
    for (const id of ['codex', 'claude', 'opencode'] as const) expect(() => decodeAgentEvent(id, { type: 'unexpected', sessionID: 's' })).toThrow()
  })
  it('strictly excludes arbitrary executable and environment requests', () => {
    expect(localAgentRequestSchema.safeParse({ operation: 'probe', adapter: 'codex', executable: 'cmd.exe' }).success).toBe(false)
    expect(agentEnvironment({ PATH: 'bin', OPENAI_API_KEY: 'secret', ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '--require evil' })).toEqual({ PATH: 'bin' })
    expect(agentArguments('codex', 'ignored', 'external')).toContain('external')
    expect(agentArguments('claude', 'ignored', 'external')).toContain('--resume')
    expect(agentArguments('opencode', '& echo bad', 'external').slice(-2)).toEqual(['--', '& echo bad'])
    expect(agentArguments('opencode', 'hello')).toContain('opencode/big-pickle')
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
    } finally { await fs.rm(directory, { recursive: true, force: true }) }
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
