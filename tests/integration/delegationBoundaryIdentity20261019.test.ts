// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { WindowsCodexSandboxBoundary } from '../../src/main/workbench/delegation/WindowsCodexSandboxBoundary'

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllEnvs()
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })))
})

async function fixture(run: (root: string, boundary: WindowsCodexSandboxBoundary, config: string) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'guoling-boundary-identity-'))
  roots.push(root)
  const home = path.join(root, 'codex-home'); await fs.mkdir(home)
  const config = path.join(home, 'config.toml'); await fs.writeFile(config, 'fixture = "unchanged"')
  vi.stubEnv('CODEX_HOME', home)
  const original = Object.getOwnPropertyDescriptor(process, 'platform')!
  Object.defineProperty(process, 'platform', { ...original, value: 'win32' })
  const boundary = new WindowsCodexSandboxBoundary()
  // The native sandbox's real inside/outside behavior already has its Windows
  // integration test. This test isolates how its successful proof is consumed.
  vi.spyOn(boundary as any, 'probe').mockImplementation(async (...args: unknown[]) =>
    path.dirname(String(args[3])) === root ? 'written' : 'EACCES')
  try { await run(root, boundary, config) }
  finally { Object.defineProperty(process, 'platform', original) }
}

const launch = (root: string, signal?: AbortSignal) => ({ copyRoot: root, permission: 'workspace' as const,
  executable: process.execPath, args: ['exec', '--unapproved-option'],
  options: { cwd: root, windowsHide: true, shell: false }, signal })

it('retains a matching preflight after elapsed time and consumes it only once', async () => {
  await fixture(async (root, boundary) => {
    const time = vi.spyOn(Date, 'now').mockReturnValue(100_000)
    expect(await boundary.assertReady(root, 'workspace', process.execPath)).toBe(true)
    time.mockReturnValue(100_000 + 3 * 60 * 60_000)
    // Reaching exact-arguments validation proves the matching boundary was not
    // rejected merely because time elapsed; this fixture never spawns a child.
    expect(() => boundary.launchRestricted(launch(root))).toThrow('委派命令未固定')
    expect(() => boundary.launchRestricted(launch(root))).toThrow('当次探针')
  })
})

it('invalidates a preflight when the actual configuration changes', async () => {
  await fixture(async (root, boundary, config) => {
    expect(await boundary.assertReady(root, 'workspace', process.execPath)).toBe(true)
    await fs.writeFile(config, 'fixture = "changed"')
    expect(() => boundary.launchRestricted(launch(root))).toThrow('当次探针')
  })
})

it('binds preflight to this launch cancellation scope and discards revoked proofs', async () => {
  await fixture(async (root, boundary) => {
    const first = new AbortController(), other = new AbortController()
    expect(await boundary.assertReady(root, 'workspace', process.execPath, { signal: first.signal })).toBe(true)
    expect(() => boundary.launchRestricted(launch(root, other.signal))).toThrow('当次探针')
    expect(await boundary.assertReady(root, 'workspace', process.execPath, { signal: first.signal })).toBe(true)
    first.abort()
    expect(() => boundary.launchRestricted(launch(root))).toThrow('当次探针')
  })
})
