// @vitest-environment node
import { expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { discoverNativeCodexExecutable } from '../../src/main/workbench/delegation/CodexDelegationRunner'
import { WindowsCodexSandboxBoundary } from '../../src/main/workbench/delegation/WindowsCodexSandboxBoundary'

it('probes both real Windows profiles and rejects an unsafe CLI launch', async () => {
  if (process.platform !== 'win32') return
  const executable = await discoverNativeCodexExecutable()
  expect(executable).toBeTruthy()
  const base = resolve('output/g20/b23')
  await fs.mkdir(base, { recursive: true })
  const root = await fs.mkdtemp(join(base, 'codex-boundary-'))
  const boundary = new WindowsCodexSandboxBoundary({ nodeExecutable: process.execPath })
  try {
    expect(await boundary.assertReady(root, 'workspace', executable!)).toBe(true)
    expect(await boundary.assertReady(root, 'read-only', executable!)).toBe(true)
    expect(() => boundary.launchRestricted({ copyRoot: root, permission: 'read-only', executable: executable!,
      args: ['exec', '--dangerously-bypass-approvals-and-sandbox'],
      options: { cwd: root, windowsHide: true, shell: false, env: { ...process.env } } }))
      .toThrow('委派命令未固定 Luna Fast、权限与工作副本')
  } finally {
    const actualBase = await fs.realpath(base), actualRoot = await fs.realpath(root)
    const rel = relative(actualBase, actualRoot)
    if (!rel || rel === '..' || rel.startsWith(`..${sep}`)) throw new Error('测试清理目录超出 b23')
    await fs.rm(actualRoot, { recursive: true, force: true })
  }
}, 45_000)
