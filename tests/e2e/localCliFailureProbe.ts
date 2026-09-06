import { copyFileSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { expect, type ElectronApplication, type Page } from '@playwright/test'

/** Exercise the real preload/Main route with adapter-owned npm fixture executables. */
export async function runLocalCliFailureProbe(app: ElectronApplication, page: Page, runRoot: string): Promise<void> {
  const directory = join(runRoot, 'cli-fixtures')
  mkdirSync(directory, { recursive: true })
  copyFileSync(process.execPath, join(directory, 'node.exe'))
  const adapters = ['codex', 'claude', 'opencode'] as const
  const packages = { codex: '@openai/codex', claude: '@anthropic-ai/claude-code', opencode: 'opencode-ai' }
  await app.evaluate((_, root) => {
    const state = globalThis as typeof globalThis & { r16Environment?: Record<string, string | undefined> }
    state.r16Environment = Object.fromEntries(['PATH', 'APPDATA', 'USERPROFILE', 'COURSEWARE_CLI_DOGFOOD'].map(key => [key, process.env[key]]))
    process.env.PATH = root; process.env.APPDATA = root; process.env.USERPROFILE = root; process.env.COURSEWARE_CLI_DOGFOOD = '1'
  }, directory)
  const owner = { projectId: 'cli-failure-fixture', projectPath: join(runRoot, 'fixture.h5lesson') }
  try {
    for (const adapter of adapters) {
      expect((await page.evaluate(adapter => window.desktopAPI.localAgent({ operation: 'probe', adapter }), adapter)).probe?.status).toBe('missing')
      const root = join(directory, 'node_modules', packages[adapter]); mkdirSync(root, { recursive: true })
      writeFileSync(join(root, 'package.json'), JSON.stringify({ bin: { [adapter]: 'cli.js' } }))
      const version = adapter === 'codex' ? '0.153.0' : adapter === 'claude' ? '2.1.0' : '1.18.26'
      const script = join(root, 'cli.js')
      writeFileSync(script, `if(process.argv.includes('--version')) console.log(${JSON.stringify(version)}); else { console.log('{"loggedIn":false}'); process.exitCode=1; }`)
      expect((await page.evaluate(adapter => window.desktopAPI.localAgent({ operation: 'probe', adapter }), adapter)).probe?.status).toBe(adapter === 'opencode' ? 'unknown-auth' : 'unauthenticated')
      for (const failure of ['unauthenticated', 'crash', 'protocol', 'launch'] as const) {
        writeFileSync(script, failure === 'unauthenticated' ? 'process.stderr.write("authentication failed"); process.exitCode=1' : failure === 'protocol' ? 'console.log("{bad")' : 'process.exitCode=7')
        const invalidBinary = join(directory, `${adapter}.exe`)
        if (failure === 'launch') writeFileSync(invalidBinary, 'invalid executable fixture')
        try {
          const result = await page.evaluate(input => window.desktopAPI.localAgent(input), { operation: 'start' as const, adapter, prompt: 'fixture', ...owner })
          await expect.poll(async () => (await page.evaluate(input => window.desktopAPI.localAgent(input), { operation: 'read' as const, sessionId: result.sessionId!, after: 0, ...owner })).records?.[0]?.status).toBe('failed')
          const record = (await page.evaluate(input => window.desktopAPI.localAgent(input), { operation: 'read' as const, sessionId: result.sessionId!, after: 0, ...owner })).records![0]!
          expect(record.events.at(-1)?.failure).toBe(failure)
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
