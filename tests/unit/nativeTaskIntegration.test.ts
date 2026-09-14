// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { isTaskInputRead } from '@/main/localAgent/nativeTaskFiles'
import { generationCapabilityDirectory } from '@/main/localAgent/capabilityWorkspace'
import { configureNativeSystemProxy, nativeProxyEnvironment } from '@/main/localAgent/nativeProxy'
import { readableActivity } from '@/renderer/ui/chat/readableChatStatus'
import { readablePermissionTitle } from '@/renderer/ui/chat/NativeAgentQuestion'

const temporary: string[] = []
afterEach(async () => {
  configureNativeSystemProxy(async () => 'DIRECT')
  for (const root of temporary.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Test path escaped')
    await fs.rm(root, { recursive: true, force: true })
  }
})

describe('native task integration on a fresh installation path', () => {
  it('allows only current task input reads, with no blanket command/write or linked-directory permission', async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), '新机器-task-')); temporary.push(base)
    const root = path.join(base, 'staging', 'candidates', 'current'), caps = generationCapabilityDirectory(root)
    await fs.mkdir(root, { recursive: true }); await fs.mkdir(caps, { recursive: true })
    const file = path.join(root, 'request.json'), card = path.join(caps, 'tool.json'), external = path.join(base, 'user-file.txt')
    await Promise.all([fs.writeFile(file, '{}'), fs.writeFile(card, '{}'), fs.writeFile(external, 'user data')])
    const read = (filePath: string, kind = 'read') => ({ kind, locations: [{ path: filePath }] })
    expect(await isTaskInputRead(read(file), root)).toBe(true)
    expect(await isTaskInputRead(read(card), root)).toBe(true)
    expect(await isTaskInputRead(read(external), root)).toBe(false)
    expect(await isTaskInputRead(read(file, 'execute'), root)).toBe(false)
    expect(await isTaskInputRead(read(file, 'edit'), root)).toBe(false)
    expect(await isTaskInputRead({ ...read(file), rawInput: { command: 'anything' } }, root)).toBe(false)
    expect(await isTaskInputRead({ kind: 'read', locations: [{ path: file }, { path: external }] }, root)).toBe(false)
    await fs.symlink(base, path.join(root, 'outside'), 'junction')
    expect(await isTaskInputRead(read(path.join(root, 'outside', 'user-file.txt')), root)).toBe(false)
  })

  it('inherits the current system proxy without replacing explicit native settings or proxying loopback', async () => {
    configureNativeSystemProxy(async url => { expect(url).toContain('chatgpt.com'); return 'PROXY 127.0.0.1:43117; DIRECT' })
    expect(await nativeProxyEnvironment('opencode', { no_proxy: 'example.test' })).toEqual({
      HTTP_PROXY: 'http://127.0.0.1:43117', HTTPS_PROXY: 'http://127.0.0.1:43117', NO_PROXY: 'example.test,localhost,127.0.0.1,::1' })
    expect(await nativeProxyEnvironment('opencode', { https_proxy: 'http://user-proxy:1234' })).toEqual({})
    configureNativeSystemProxy(async () => 'DIRECT; PROXY ignored:80')
    expect(await nativeProxyEnvironment('claude', {})).toEqual({})
  })

  it('projects real tool activity and permission purpose without dumping raw protocol', () => {
    const activity = (name: string) => readableActivity({ version: 1, sequence: 1, kind: 'tool-call', payload: { name }, time: 1 } as any)
    expect(activity('read')).toBe('正在读取任务所需内容')
    expect(activity('Bash')).toBe('正在运行工具处理任务')
    expect(readablePermissionTitle('directory\n{"filepath":"D:/another/file.txt","parentDir":"D:/another"}')).toBe('CLI 需要访问此文件：D:/another/file.txt')
  })
})
