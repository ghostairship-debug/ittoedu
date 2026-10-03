// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { CodexDelegationRunner, type CodexDelegationRequest, type CodexDelegationBoundaryPort } from '../../src/main/workbench/delegation/CodexDelegationRunner'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

async function copyWith(script: string) {
  const root = await mkdtemp(path.join(tmpdir(), 'g20-delegation-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const fixture = path.join(root, 'codex-fixture.cjs')
  await writeFile(fixture, script)
  return { root, fixture }
}

const request = (root: string): CodexDelegationRequest => ({
  taskId: 'parent-child-1', goal: 'Create a checked test artifact', copyRoot: root, executablePath: process.execPath,
  permission: 'workspace', expectedArtifacts: ['answer.txt'],
})
const ready = async () => ({ ready: true, reason: 'fixture', version: 'codex-cli fixture', account: 'ChatGPT' as const })

function fixtureLaunch(script: string, observed?: string[][]) {
  return (_file: string, args: readonly string[], options: Parameters<typeof spawn>[2]): ChildProcessWithoutNullStreams => {
    observed?.push([...args])
    return spawn(process.execPath, [script], { ...options, stdio: 'pipe' })
  }
}
function fixtureBoundary(root: string, script: string, observed?: string[][]): CodexDelegationBoundaryPort {
  const launch = fixtureLaunch(script, observed)
  return { assertReady: async (copy, permission) => copy === root && permission === 'workspace',
    launchRestricted: ({ executable, args, options }) => launch(executable, args, options),
    stopRestricted: async child => { child.kill(); return false } }
}

it('returns a verified result only after a real artifact readback and caller verification', async () => {
  const { root, fixture } = await copyWith(`
    const fs = require('node:fs');
    process.stdin.resume(); process.stdin.on('end', () => {
      fs.writeFileSync('answer.txt', 'checked-result');
      console.log(JSON.stringify({ type: 'thread.started', thread_id: 'external-thread' }));
      console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Completed' } }));
      console.log(JSON.stringify({ type: 'turn.completed' }));
    });
  `)
  const args: string[][] = [], events: string[] = []
  const runner = new CodexDelegationRunner({ boundary: fixtureBoundary(root, fixture, args), inspectCli: ready })
  const result = await runner.run(request(root), { onEvent: event => events.push(event.kind),
    verify: async input => ({ accepted: (await readFile(input.artifacts[0].path, 'utf8')) === 'checked-result', detail: '成果已回读' }) })
  expect(result).toMatchObject({ status: 'verified', threadId: 'external-thread', exitCode: 0,
    artifacts: [{ path: path.join(root, 'answer.txt'), bytes: 14 }], verification: { accepted: true } })
  expect(events).toContain('finished')
  expect(args[0]).toContain('gpt-6-luna')
  expect(args[0]).toContain('service_tier="priority"')
  expect(args[0]).toContain('workspace-write')
  expect(args[0]).toContain('--json')
  expect(args[0]).toContain('--ephemeral')
  expect(args[0]).toContain('--skip-git-repo-check')
  expect(args[0]).not.toContain('--dangerously-bypass-approvals-and-sandbox')
})

it('does not launch without a verified boundary', async () => {
  const { root } = await copyWith('')
  const runner = new CodexDelegationRunner()
  const result = await runner.run(request(root), { verify: vi.fn(async () => ({ accepted: true, detail: 'should not run' })) })
  expect(result.status).toBe('unconfigured')
  expect(result.reason).toContain('边界')
})

it('treats stop as unknown until the process tree is independently confirmed, and never verifies a late artifact', async () => {
  const { root, fixture } = await copyWith(`
    const fs = require('node:fs');
    process.stdin.resume(); process.stdin.on('end', () => {
      fs.writeFileSync('answer.txt', 'possibly-changed');
      console.log(JSON.stringify({ type: 'thread.started', thread_id: 'stopped-thread' }));
      setInterval(() => {}, 1000);
    });
  `)
  const controller = new AbortController(), verify = vi.fn()
  const runner = new CodexDelegationRunner({ boundary: fixtureBoundary(root, fixture), inspectCli: ready })
  const result = await runner.run(request(root),
    { signal: controller.signal, onEvent: event => { if (event.kind === 'started') controller.abort() }, verify })
  expect(result.status).toBe('unknown')
  expect(result.externalChangesPossible).toBe(true)
  expect(verify).not.toHaveBeenCalled()
})

it('keeps failed CLI output and out-of-root artifacts from becoming successful delegation', async () => {
  const { root, fixture } = await copyWith(`
    process.stdin.resume(); process.stdin.on('end', () => {
      console.log(JSON.stringify({ type: 'turn.failed' })); process.exitCode = 2;
    });
  `)
  const verify = vi.fn()
  const runner = new CodexDelegationRunner({ boundary: fixtureBoundary(root, fixture), inspectCli: ready })
  const failed = await runner.run(request(root), { verify })
  expect(failed.status).toBe('failed')
  expect(verify).not.toHaveBeenCalled()
  const escaped = await runner.run({ ...request(root), expectedArtifacts: ['../other.txt'] }, { verify })
  expect(escaped.status).toBe('unconfigured')
  expect(escaped.reason).toContain('超出')
  expect(verify).not.toHaveBeenCalled()
})

it('keeps useful work alive after more than 32 MiB of legitimate stdout and stderr', async () => {
  const { root, fixture } = await copyWith(`
    const fs=require('node:fs'),{once}=require('node:events');
    process.stdin.resume();process.stdin.on('end',async()=>{
      const line=JSON.stringify({type:'diagnostic',text:'x'.repeat(1024*1024)})+String.fromCharCode(10);
      for(let i=0;i<36;i++){if(!process.stdout.write(line))await once(process.stdout,'drain');if(!process.stderr.write('y'.repeat(1024*1024)))await once(process.stderr,'drain');}
      fs.writeFileSync('answer.txt','preserved');console.log(JSON.stringify({type:'turn.completed'}));
    });
  `)
  const runner = new CodexDelegationRunner({ boundary: fixtureBoundary(root, fixture), inspectCli: ready })
  const result = await runner.run(request(root), { verify: async input => ({ accepted: (await readFile(input.artifacts[0].path, 'utf8')) === 'preserved', detail: 'large output retained' }) })
  if (result.diagnosticFile) cleanups.push(() => rm(path.dirname(result.diagnosticFile!), { recursive: true, force: true }))
  expect(result.status).toBe('verified')
  expect(result.diagnosticFile).toBeTruthy()
  await expect((await import('node:fs/promises')).stat(result.diagnosticFile!).then(stat => stat.size)).resolves.toBeGreaterThan(32 * 1024 * 1024)
})
