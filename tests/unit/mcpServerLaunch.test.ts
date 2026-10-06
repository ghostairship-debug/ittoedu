// @vitest-environment node
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { mcpServerElectronArguments, readMcpConnectionReady, waitForMcpConnection } from '../../scripts/mcpServerLaunch'

const workspace = path.resolve('test-workspace')
const ready = { status: 'ready', endpoint: 'http://127.0.0.1:45888/mcp', token: 'connection-only', workspace, workspaceId: 'space',
  permission: 'workspace', pid: 123, profile: path.resolve('test-profile'), mode: 'headless', ownership: 'owned', requestedWorkspace: workspace, workspaceMismatch: false }

describe('resident MCP launcher', () => {
  it('binds an explicit absolute workspace and forwards the chosen Electron profile', () => {
    expect(mcpServerElectronArguments(['--workspace', workspace, '--port=45888', '--permission', 'read-only', '--user-data-dir=profile', '--ready-json']))
      .toEqual(['.', '--headless-mcp', `--workspace=${workspace}`, '--port=45888', '--permission=read-only', '--user-data-dir=profile', '--ready-json'])
    expect(() => mcpServerElectronArguments([])).toThrow('workspace')
    expect(() => mcpServerElectronArguments(['--workspace', 'relative'])).toThrow('绝对')
    expect(() => mcpServerElectronArguments(['--workspace', workspace, '--port=0'])).toThrow()
    expect(() => mcpServerElectronArguments(['--workspace', workspace, '--permission=unknown'])).toThrow()
    expect(() => mcpServerElectronArguments(['--workspace', workspace, '--mcp-ready-file=other'])).toThrow('启动器维护')
  })

  it('waits for the owner ready receipt after a second-instance exit 0', async () => {
    let reads = 0
    const result = await waitForMcpConnection({ read: async () => ++reads === 3 ? { ...ready, mode: 'gui', ownership: 'attached' } : undefined,
      exit: () => ({ code: 0, signal: null }), pause: async () => undefined })
    expect(reads).toBe(3)
    expect(result).toMatchObject({ pid: 123, mode: 'gui', ownership: 'attached' })
  })

  it('reports service failure, failed process exit, and missing ready without inventing readiness', async () => {
    expect(() => readMcpConnectionReady({ status: 'failed', message: 'port already in use' })).toThrow('port already in use')
    expect(() => readMcpConnectionReady({ ...ready, token: '' })).toThrow('token')
    await expect(waitForMcpConnection({ read: async () => undefined, exit: () => ({ code: 1, signal: null }) })).rejects.toThrow('退出状态：1')
    let time = 0
    await expect(waitForMcpConnection({ read: async () => undefined, exit: () => ({ code: 0, signal: null }), timeoutMs: 50,
      now: () => time, pause: async milliseconds => { time += milliseconds } })).rejects.toThrow('未收到')
  })
})
