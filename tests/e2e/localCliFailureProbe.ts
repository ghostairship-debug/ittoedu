import { copyFileSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { expect, type ElectronApplication, type Page } from '@playwright/test'

type Adapter = 'codex' | 'claude' | 'opencode'
type Failure = 'authentication-before-initialize' | 'unauthenticated' | 'crash' | 'protocol' | 'launch'

/** Use each native handshake before provoking an active-turn failure. */
function lifecycleFailureScript(adapter: Adapter, failure: Failure, version: string): string {
  return `
    if (process.argv.includes('--version')) { console.log(${JSON.stringify(version)}); process.exit(0); }
    const adapter = ${JSON.stringify(adapter)}, failure = ${JSON.stringify(failure)};
    if (failure === 'authentication-before-initialize') { process.stderr.write('authentication failed'); process.exit(1); }
    const send = value => console.log(JSON.stringify(value));
    const sessionId = adapter + '-' + failure + '-native-session';
    const fail = () => setTimeout(() => {
      if (failure === 'unauthenticated') { process.stderr.write('authentication failed'); process.exit(1); }
      if (failure === 'crash') process.exit(7);
      if (adapter === 'codex') send({ method:'turn/completed', params:{ threadId:sessionId, turn:{ id:'fixture-turn', status:'failed', error:{ message:'fixture protocol violation' } } } });
      else if (adapter === 'claude') send({ type:'result', session_id:sessionId, is_error:true, subtype:'error_during_execution', errors:['fixture protocol violation'] });
      else console.log('{bad');
    }, 30);
    require('node:readline').createInterface({ input:process.stdin }).on('line', line => {
      const wire = JSON.parse(line);
      if (adapter === 'claude') {
        if (wire.request?.subtype === 'initialize') send({type:'control_response', response:{subtype:'success', request_id:wire.request_id, response:{models:[]}}});
        else if (wire.type === 'user') { send({type:'system', subtype:'init', session_id:sessionId}); fail(); }
      } else if (adapter === 'codex') {
        if (wire.method === 'initialize') send({id:wire.id, result:{userAgent:'codex/${version}'}});
        else if (wire.method === 'model/list') send({id:wire.id, result:{data:[]}});
        else if (wire.method === 'thread/start') send({id:wire.id, result:{thread:{id:sessionId}}});
        else if (wire.method === 'turn/start') { send({id:wire.id, result:{turn:{id:'fixture-turn'}}}); fail(); }
      } else {
        if (wire.method === 'initialize') send({id:wire.id, result:{protocolVersion:1, agentInfo:{version:'${version}'}}});
        else if (wire.method === 'session/new') send({id:wire.id, result:{sessionId, configOptions:[]}});
        else if (wire.method === 'session/prompt') fail();
      }
    });
    process.stdin.on('end', () => process.exit(0));
  `
}

function expectedFailure(adapter: Adapter, failure: Failure): { failure: string; payload: { message: string } } {
  // IPC reads the V1 display projection of V2 events. Assert that projection
  // together with the precise reason shown to the teacher, not the category alone.
  const authentication = adapter === 'claude' ? 'CLI 认证失效，请重新登录' : 'authentication failed'
  if (failure === 'authentication-before-initialize') return { failure: 'protocol', payload: { message: `CLI 未完成（打开原生 CLI）：${adapter === 'codex' ? 'Codex initialize: ' : ''}${authentication}` } }
  if (failure === 'unauthenticated') return { failure: adapter === 'opencode' ? 'launch' : 'unsupported-version', payload: { message: authentication } }
  if (failure === 'crash') return { failure: 'launch', payload: { message: adapter === 'codex' ? 'Codex 进程意外退出 (exit 7)' : `${adapter === 'claude' ? 'Claude' : 'OpenCode'} 进程异常退出 (code: 7)` } }
  if (failure === 'protocol') return { failure: 'protocol', payload: { message: adapter === 'opencode' ? 'Malformed JSON-RPC message' : 'fixture protocol violation' } }
  return { failure: 'protocol', payload: { message: 'CLI 未完成（打开原生 CLI）：launch' } }
}

/** Exercise the real preload/Main route with adapter-owned npm fixture executables. */
export async function runLocalCliFailureProbe(app: ElectronApplication, page: Page, runRoot: string): Promise<void> {
  const directory = join(runRoot, 'cli-fixtures')
  mkdirSync(directory, { recursive: true })
  copyFileSync(process.execPath, join(directory, 'node.exe'))
  const adapters = ['codex', 'claude', 'opencode'] as const
  const packages = { codex: '@openai/codex', claude: '@anthropic-ai/claude-code', opencode: 'opencode-ai' }
  await app.evaluate((_, root) => {
    const state = globalThis as typeof globalThis & { r16Environment?: Record<string, string | undefined> }
    state.r16Environment = Object.fromEntries(['PATH', 'APPDATA', 'USERPROFILE'].map(key => [key, process.env[key]]))
    process.env.PATH = root; process.env.APPDATA = root; process.env.USERPROFILE = root
  }, directory)
  const owner = { projectId: 'cli-failure-fixture', projectPath: join(runRoot, 'fixture.h5lesson') }
  try {
    for (const adapter of adapters) {
      expect(await page.evaluate(adapter => window.desktopAPI.localAgent({ operation: 'probe', adapter }), adapter)).toMatchObject({ enabled: true, probe: { adapter, status: 'missing' } })
      const root = join(directory, 'node_modules', packages[adapter]); mkdirSync(root, { recursive: true })
      writeFileSync(join(root, 'package.json'), JSON.stringify({ bin: { [adapter]: 'cli.js' } }))
      const version = adapter === 'codex' ? '0.153.0' : adapter === 'claude' ? '2.1.0' : '1.18.26'
      const script = join(root, 'cli.js')
      writeFileSync(script, `if(process.argv.includes('--version')) console.log(${JSON.stringify(version)}); else { console.log('{"loggedIn":false}'); process.exitCode=1; }`)
      expect((await page.evaluate(adapter => window.desktopAPI.localAgent({ operation: 'probe', adapter }), adapter)).probe?.status).toBe(adapter === 'opencode' ? 'unknown-auth' : 'unauthenticated')
      for (const failure of ['authentication-before-initialize', 'unauthenticated', 'crash', 'protocol', 'launch'] as const) {
        writeFileSync(script, lifecycleFailureScript(adapter, failure, version))
        const invalidBinary = join(directory, `${adapter}.exe`)
        if (failure === 'launch') writeFileSync(invalidBinary, 'invalid executable fixture')
        try {
          const result = await page.evaluate(input => window.desktopAPI.localAgent(input), { operation: 'start' as const, adapter, prompt: 'fixture', ...owner })
          await expect.poll(async () => (await page.evaluate(input => window.desktopAPI.localAgent(input), { operation: 'read' as const, sessionId: result.sessionId!, after: 0, ...owner })).records?.[0]?.status).toBe('failed')
          const record = (await page.evaluate(input => window.desktopAPI.localAgent(input), { operation: 'read' as const, sessionId: result.sessionId!, after: 0, ...owner })).records![0]!
          expect(record.events.at(-1)).toMatchObject({ kind: 'failed', ...expectedFailure(adapter, failure) })
          if (failure === 'launch' || failure === 'authentication-before-initialize') expect(record.externalSessionId).toBeUndefined()
          else expect(record.externalSessionId).toBe(`${adapter}-${failure}-native-session`)
        } finally { if (failure === 'launch') unlinkSync(invalidBinary) }
      }
    }
  } finally {
    await app.evaluate(() => {
      const state = globalThis as typeof globalThis & { r16Environment?: Record<string, string | undefined> }
      for (const [key, value] of Object.entries(state.r16Environment ?? {})) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
      delete state.r16Environment
    })
  }
}
