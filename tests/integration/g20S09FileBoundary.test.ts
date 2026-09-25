// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { WorkspaceFiles } from '../../src/main/workbench/WorkspaceFiles'
import { WorkspaceFilesDesktopService } from '../../src/main/workbench/workspaceFilesDesktopService'
import { assertTrustedIpcSender } from '../../src/main/security'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'

const temporaryRoots: string[] = []
const junctions: string[] = []
afterEach(async () => {
  for (const junction of junctions.splice(0)) await fs.unlink(junction).catch(() => {})
  for (const root of temporaryRoots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe fixture cleanup')
    await fs.rm(root, { recursive: true, force: true })
  }
})

async function fixture() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-s09-boundary-'))
  temporaryRoots.push(base)
  const root = path.join(base, 'workspace'), outside = path.join(base, 'workspace-sibling')
  await fs.mkdir(root)
  await fs.mkdir(outside)
  return { root, outside }
}

it('rejects forged handles, path fields, UNC roots and a junction escape while legitimate creates work', async () => {
  const { root, outside } = await fixture()
  await fs.symlink(outside, path.join(root, 'escape'), 'junction')
  junctions.push(path.join(root, 'escape'))
  const desktop = new WorkspaceFilesDesktopService(new WorkspaceFiles())
  const grant = await desktop.authorizeRoot(root)
  await expect(desktop.operate({ type: 'root', directory: outside })).rejects.toThrow('授权')
  await expect(desktop.operate({ type: 'root', directory: `\\\\127.0.0.1\\not-authorized\\workspace` })).rejects.toThrow('授权')
  await expect(desktop.operate({ type: 'root', directory: path.join(root, '..', 'workspace-sibling') })).rejects.toThrow('授权')
  const other = path.join(path.dirname(root), 'other-authorized')
  await fs.mkdir(other)
  const otherGrant = await desktop.authorizeRoot(other)
  await expect(desktop.operate({ type: 'list', workspaceId: grant.workspaceId, directoryEntryId: otherGrant.rootEntryId })).rejects.toThrow('句柄')
  await expect(desktop.operate({ type: 'list', workspaceId: grant.workspaceId, directoryEntryId: path.join(outside, 'secret.md') })).rejects.toThrow('句柄')
  await expect(desktop.operate({ type: 'create-text', workspaceId: grant.workspaceId, operationId: 'forged-path', targetDirectoryId: grant.rootEntryId, name: 'secret.txt', directory: outside } as never)).rejects.toThrow()
  const traversal = await desktop.operate({ type: 'create-text', workspaceId: grant.workspaceId, operationId: 'traversal', targetDirectoryId: grant.rootEntryId, name: '../secret.txt' })
  expect(traversal.items[0]).toMatchObject({ status: 'failed', error: { code: 'invalid-entry-name' } })
  const listed = await desktop.operate({ type: 'list', workspaceId: grant.workspaceId, directoryEntryId: grant.rootEntryId })
  expect(listed.entries).toContainEqual({ status: 'blocked', name: 'escape', reason: 'outside-workspace' })
  const created = await desktop.operate({ type: 'create-text', workspaceId: grant.workspaceId, operationId: 'valid-create', targetDirectoryId: grant.rootEntryId, name: 'valid.txt' })
  expect(created.status).toBe('success')
  expect(await fs.readFile(path.join(root, 'valid.txt'))).toHaveLength(0)
  await expect(fs.access(path.join(outside, 'secret.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
})

it.skipIf(process.platform !== 'win32')('rechecks an authorized target directory after a coordination pause replaces it with an outside junction', async () => {
  const { root, outside } = await fixture()
  const inbox = path.join(root, 'inbox')
  await fs.mkdir(inbox)
  let swapped = false
  const files = new WorkspaceFiles({ aroundMutation: async (action, perform) => {
    if (action.kind === 'create-file' && !swapped) {
      swapped = true
      await fs.rename(inbox, path.join(root, 'inbox-original'))
      await fs.symlink(outside, inbox, 'junction')
      junctions.push(inbox)
    }
    return perform()
  } })
  const desktop = new WorkspaceFilesDesktopService(files)
  const grant = await desktop.authorizeRoot(root)
  const listing = await desktop.operate({ type: 'list', workspaceId: grant.workspaceId, directoryEntryId: grant.rootEntryId })
  const entry = listing.entries.find(item => item.name === 'inbox')
  if (!entry || entry.status !== 'accessible') throw new Error('Missing authorized target')
  const result = await desktop.operate({ type: 'create-text', workspaceId: grant.workspaceId, operationId: 'race-create', targetDirectoryId: entry.entryId, name: 'probe.txt' })
  expect(swapped).toBe(true)
  expect(result.items[0]).toMatchObject({ status: 'failed', error: { code: 'outside-workspace' } })
  await expect(fs.access(path.join(outside, 'probe.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(fs.access(path.join(root, 'inbox-original', 'probe.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
})

it.skipIf(process.platform !== 'win32')('rechecks an authorized source directory before a delayed trash operation', async () => {
  const { root, outside } = await fixture()
  const selected = path.join(root, 'selected')
  await fs.mkdir(selected)
  await fs.writeFile(path.join(outside, 'keep.md'), 'outside remains')
  let trashCalls = 0
  const files = new WorkspaceFiles({
    trashItem: async () => { trashCalls++ },
    aroundMutation: async (action, perform) => {
      if (action.kind === 'trash') {
        await fs.rename(selected, path.join(root, 'selected-original'))
        await fs.symlink(outside, selected, 'junction')
        junctions.push(selected)
      }
      return perform()
    },
  })
  const desktop = new WorkspaceFilesDesktopService(files)
  const grant = await desktop.authorizeRoot(root)
  const listing = await desktop.operate({ type: 'list', workspaceId: grant.workspaceId, directoryEntryId: grant.rootEntryId })
  const entry = listing.entries.find(item => item.name === 'selected')
  if (!entry || entry.status !== 'accessible') throw new Error('Missing authorized source')
  const result = await desktop.operate({ type: 'trash', workspaceId: grant.workspaceId, operationId: 'race-trash', entryIds: [entry.entryId] })
  expect(result.items[0]).toMatchObject({ status: 'failed', error: { code: 'outside-workspace' } })
  expect(trashCalls).toBe(0)
  expect(await fs.readFile(path.join(outside, 'keep.md'), 'utf8')).toBe('outside remains')
})

it('accepts only the current main window top frame as an IPC sender', () => {
  const url = 'file:///C:/app/index.html'
  const mainFrame = { processId: 9, frameToken: 'main-token', detached: false, url }
  const webContents = { mainFrame }
  const window = { webContents, isDestroyed: () => false } as unknown as BrowserWindow
  const event = { sender: webContents, senderFrame: mainFrame } as unknown as IpcMainInvokeEvent
  expect(() => assertTrustedIpcSender(event, window, url)).not.toThrow()
  const forgedContents = { mainFrame }
  expect(() => assertTrustedIpcSender({ ...event, sender: forgedContents } as IpcMainInvokeEvent, window, url)).toThrow('桌面请求不是由编辑器主页面发起的')
  expect(() => assertTrustedIpcSender({ ...event, senderFrame: { ...mainFrame, frameToken: 'child-token' } } as IpcMainInvokeEvent, window, url)).toThrow('桌面请求不是由编辑器主页面发起的')
  expect(() => assertTrustedIpcSender({ ...event, senderFrame: { ...mainFrame, url: 'file:///C:/app/preview.html' } } as IpcMainInvokeEvent, window, url)).toThrow('桌面请求不是由编辑器主页面发起的')
  expect(() => assertTrustedIpcSender(event, null, url)).toThrow('桌面请求不是由编辑器主页面发起的')
})
