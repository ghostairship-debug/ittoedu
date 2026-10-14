// @vitest-environment node
import { EventEmitter } from 'node:events'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { McpConnectionReady } from '../../src/shared/workbench/mcpConnection'

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn }))
import { runProductMcpBootstrap } from '../../src/main/workbench/external/installedMcpBootstrap'
import { writeMcpLaunchReply } from '../../src/main/headlessMcpLaunch'

const folders: string[] = []
let workspace: string, profile: string, requested: string, innerHandoff: string
let child: EventEmitter & { unref: ReturnType<typeof vi.fn> }
const owner = (): McpConnectionReady => ({ status: 'ready', endpoint: 'http://127.0.0.1:9445/mcp', workspace,
  workspaceId: 'fixture-owner-root', permission: 'read-only', pid: 42424, profile, mode: 'headless', ownership: 'attached',
  requestedWorkspace: requested, workspaceMismatch: true })
async function temporary(prefix: string) { const folder = await fs.mkdtemp(path.join(os.tmpdir(), prefix)); folders.push(folder); return folder }
beforeEach(async () => {
  spawn.mockReset()
  const fixture = await temporary('guoling-connector-unit-')
  workspace = path.join(fixture, 'actual-owner'); requested = path.join(fixture, 'requested'); profile = path.join(fixture, 'profile')
  await Promise.all([workspace, requested, profile].map(folder => fs.mkdir(folder)))
  spawn.mockImplementation((_executable: string, args: string[]) => {
    child = Object.assign(new EventEmitter(), { unref: vi.fn() })
    innerHandoff = args.find(arg => arg.startsWith('--mcp-ready-file='))!.slice('--mcp-ready-file='.length)
    void writeMcpLaunchReply(innerHandoff, owner()).then(() => child.emit('exit', 0, null), error => child.emit('error', error))
    return child
  })
})
afterEach(async () => {
  vi.unstubAllEnvs()
  for (const folder of folders.splice(0)) {
    expect(path.resolve(path.dirname(folder)).toLowerCase()).toBe(path.resolve(os.tmpdir()).toLowerCase())
    expect(path.basename(folder)).toMatch(/^guoling-(?:connector-unit|mcp-connect)-/)
    await fs.rm(folder, { recursive: true, force: true })
  }
})
it('hands unchanged actual owner facts to the guarded outer file when a Portable wrapper has no stdout', async () => {
  const handoff = await temporary('guoling-mcp-connect-'), readyFile = path.join(handoff, 'ready.json')
  vi.stubEnv('PORTABLE_EXECUTABLE_FILE', path.join(handoff, 'declared-portable.exe'))
  const reply = await runProductMcpBootstrap(['--mcp-connect', `--workspace=${requested}`, '--permission=workspace', '--port=9445', `--mcp-ready-file=${readyFile}`],
    { executable: process.execPath, cwd: requested })
  expect(reply).toBeUndefined()
  expect(JSON.parse(await fs.readFile(readyFile, 'utf8'))).toEqual(owner())
  expect(spawn).toHaveBeenCalledTimes(1)
  expect(spawn.mock.calls[0][0]).toBe(path.join(handoff, 'declared-portable.exe'))
  expect(spawn.mock.calls[0][2]).toMatchObject({ cwd: requested, detached: true, stdio: 'ignore' })
  expect(child.unref).toHaveBeenCalledTimes(1)
  await expect(fs.stat(path.dirname(innerHandoff))).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(fs.stat(path.join(handoff, 'ready.tmp'))).rejects.toMatchObject({ code: 'ENOENT' })
})
it('retains the existing direct-executable stdout reply contract when no outer file was requested', async () => {
  await expect(runProductMcpBootstrap(['--mcp-connect', `--task-path=${requested}`], { executable: process.execPath, cwd: requested })).resolves.toEqual(owner())
  expect(spawn).toHaveBeenCalledTimes(1)
  await expect(fs.stat(path.dirname(innerHandoff))).rejects.toMatchObject({ code: 'ENOENT' })
})
it('returns a failed one-use file for a real invalid workspace without spawning or inventing ready', async () => {
  const handoff = await temporary('guoling-mcp-connect-'), readyFile = path.join(handoff, 'ready.json')
  await expect(runProductMcpBootstrap(['--mcp-connect', `--workspace=${path.join(requested, 'missing')}`, `--mcp-ready-file=${readyFile}`],
    { executable: process.execPath, cwd: requested })).rejects.toMatchObject({ code: 'ENOENT' })
  const failure = JSON.parse(await fs.readFile(readyFile, 'utf8'))
  expect(failure.status).toBe('failed'); expect(failure.message).toContain('ENOENT'); expect(failure.pid).toBeUndefined()
  expect(spawn).not.toHaveBeenCalled()
})
it('keeps the existing handoff location guard instead of writing a receipt into a workspace', async () => {
  const outsider = path.join(requested, 'ready.json')
  await expect(runProductMcpBootstrap(['--mcp-connect', `--workspace=${requested}`, `--mcp-ready-file=${outsider}`],
    { executable: process.execPath, cwd: requested })).rejects.toThrow('一次性目录')
  await expect(fs.stat(outsider)).rejects.toMatchObject({ code: 'ENOENT' })
  expect(child.unref).toHaveBeenCalledTimes(1)
})
