// @vitest-environment jsdom
import { createHash, randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import { AttachmentsDesktopService } from '../../src/main/workbench/attachments/attachmentsDesktopService'
import { authorizeWorkspaceFilesRoot, operateWorkspaceFiles } from '../../src/main/workbench/workspaceFilesDesktopService'
import { readAttachmentFile } from '../../src/renderer/workbench/attachments/attachmentIntake'
import type { AttachmentSnapshot } from '../../src/shared/workbench/attachments'
import type { AttachmentIntakeFile } from '../../src/shared/workbench/attachmentsDesktop'

const electronState = vi.hoisted(() => ({ userData: '', selectedPaths: [] as string[] }))
vi.mock('electron', () => ({
  app: { getPath: () => electronState.userData, whenReady: async () => undefined, isPackaged: true, getAppPath: () => electronState.userData },
  dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [...electronState.selectedPaths] }) },
  shell: { trashItem: async () => undefined, showItemInFolder: () => undefined },
}))

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe fixture root')
    await fs.rm(root, { recursive: true, force: true })
  }
  electronState.selectedPaths = []
})
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const owner = { webContents: Object.assign(new EventEmitter(), { id: 81, isDestroyed: () => false }) } as unknown as BrowserWindow

it('S08-T01 gives memory screenshot, selected image and resource-tree file distinct traceable snapshots from one store', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-attachment-sources-')); roots.push(root)
  electronState.userData = path.join(root, 'user-data')
  const localDirectory = path.join(root, 'local'), workspaceDirectory = path.join(root, 'workspace')
  await fs.mkdir(localDirectory); await fs.mkdir(workspaceDirectory)
  const localPath = path.join(localDirectory, 'same.png'), workspacePath = path.join(workspaceDirectory, 'same.png')
  const memoryBytes = await sharp({ create: { width: 4, height: 3, channels: 4, background: '#d52233' } }).png().toBuffer()
  const localBytes = await sharp({ create: { width: 5, height: 3, channels: 4, background: '#23ab45' } }).png().toBuffer()
  const workspaceBytes = await sharp({ create: { width: 6, height: 3, channels: 4, background: '#3344de' } }).png().toBuffer()
  await fs.writeFile(localPath, localBytes); await fs.writeFile(workspacePath, workspaceBytes)
  const desktop = new AttachmentsDesktopService(path.join(root, 'managed'))

  // This is the Composer's path-free paste branch: a real in-memory File is
  // read by FileReader before its bytes cross the strict desktop request.
  const screenshot = new File([Uint8Array.from(memoryBytes).buffer], 'same.png', { type: 'image/png' })
  const memoryProgress: { loaded: number; total: number }[] = []
  const pastedBytes = await readAttachmentFile(screenshot, new AbortController().signal, (loaded, total) => memoryProgress.push({ loaded, total }))
  expect(Buffer.from(pastedBytes)).toEqual(memoryBytes)
  expect(memoryProgress.at(-1)).toEqual({ loaded: memoryBytes.length, total: memoryBytes.length })
  const memory = await desktop.operate({ type: 'receive', requestId: randomUUID(), name: screenshot.name, bytes: pastedBytes, source: 'paste', mediaType: screenshot.type }, owner) as AttachmentSnapshot

  electronState.selectedPaths = [localPath]
  const selected = await desktop.operate({ type: 'select' }, owner) as AttachmentIntakeFile[]
  expect(selected).toHaveLength(1)
  expect(selected[0]!.name).toBe('same.png')
  const local = await desktop.operate({ type: 'receive-granted', authorizationId: selected[0]!.authorizationId, requestId: randomUUID() }, owner) as AttachmentSnapshot

  const workspace = await authorizeWorkspaceFilesRoot(workspaceDirectory)
  const listing = await operateWorkspaceFiles({ type: 'list', workspaceId: workspace.workspaceId, directoryEntryId: workspace.rootEntryId })
  const entry = listing.entries.find(item => item.name === 'same.png')
  if (!entry || entry.status !== 'accessible') throw new Error('Workspace image is not accessible through the resource tree')
  const fromTree = await desktop.operate({ type: 'workspace-files', workspaceId: workspace.workspaceId, entryIds: [entry.entryId] }, owner) as AttachmentIntakeFile[]
  expect(fromTree).toHaveLength(1)
  expect(fromTree[0]!.name).toBe('same.png')
  const resource = await desktop.operate({ type: 'receive-granted', authorizationId: fromTree[0]!.authorizationId, requestId: randomUUID() }, owner) as AttachmentSnapshot

  const snapshots = [memory, local, resource], originalBytes = [memoryBytes, localBytes, workspaceBytes]
  expect(snapshots.map(item => item.name)).toEqual(['same.png', 'same.png', 'same.png'])
  expect(new Set(snapshots.map(item => item.id)).size).toBe(3)
  expect(new Set(snapshots.map(item => item.digest)).size).toBe(3)
  expect(snapshots.map(item => item.source.kind)).toEqual(['paste', 'file', 'workspace'])
  expect(snapshots.map(item => item.source.readOnly)).toEqual([true, true, true])
  expect(memory.source.pathHint).toBeUndefined()
  expect(local.source).toMatchObject({ authorizationId: selected[0]!.authorizationId, pathHint: localPath })
  expect(resource.source).toMatchObject({ authorizationId: fromTree[0]!.authorizationId, pathHint: workspacePath })

  for (const [index, snapshot] of snapshots.entries()) {
    const bytes = originalBytes[index]!
    expect(snapshot).toMatchObject({ state: 'added', mediaType: 'image/png', byteLength: bytes.length, digest: digest(bytes), blobRef: { digest: digest(bytes), byteLength: bytes.length },
      representations: [{ id: 'original-image', kind: 'image', mediaType: 'image/png', blobRef: { digest: digest(bytes), byteLength: bytes.length },
        provenance: { originalDigest: digest(bytes), originalByteLength: bytes.length, producer: 'sharp-verified-v1', complete: true, downsampled: false } }] })
    const stored = await desktop.operate({ type: 'snapshot', attachmentId: snapshot.id }, owner) as AttachmentSnapshot
    expect(stored).toEqual(snapshot)
    const represented = await desktop.operate({ type: 'representation', attachmentId: snapshot.id, representationId: 'original-image' }, owner) as { bytes: Uint8Array }
    expect(Buffer.from(represented.bytes)).toEqual(bytes)
  }
  expect(snapshots.map(item => item.representations[0] && 'width' in item.representations[0] ? item.representations[0].width : null)).toEqual([4, 5, 6])
  expect(await fs.readFile(localPath)).toEqual(localBytes)
  expect(await fs.readFile(workspacePath)).toEqual(workspaceBytes)
})
