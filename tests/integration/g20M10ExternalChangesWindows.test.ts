// @vitest-environment node
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { WorkspaceFiles } from '../../src/main/workbench/WorkspaceFiles'
import { WorkspaceFilesDesktopService } from '../../src/main/workbench/workspaceFilesDesktopService'

const lockScript = String.raw`
$stream = [System.IO.File]::Open($env:G20_LOCK_SOURCE, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::ReadWrite)
try {
  [System.IO.File]::WriteAllText($env:G20_LOCK_READY, 'ready')
  while (-not [System.IO.File]::Exists($env:G20_LOCK_RELEASE)) { Start-Sleep -Milliseconds 25 }
} finally { $stream.Dispose() }
`

async function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return
  await new Promise<void>(resolve => {
    const timer = setTimeout(() => { child.kill(); resolve() }, 3_000)
    child.once('exit', () => { clearTimeout(timer); resolve() })
  })
}

it.skipIf(process.platform !== 'win32')('M10-T04 receives external watcher changes and reports a genuinely occupied file in a batch', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-m10-external-'))
  const workspace = path.join(directory, 'workspace')
  const target = path.join(workspace, 'target')
  const busy = path.join(workspace, 'busy.md')
  const ready = path.join(directory, 'lock-ready'), release = path.join(directory, 'lock-release')
  await fs.mkdir(target, { recursive: true })
  await fs.writeFile(busy, 'occupied')
  await fs.writeFile(path.join(workspace, 'available.md'), 'available')
  const service = new WorkspaceFilesDesktopService(new WorkspaceFiles())
  let locker: ChildProcess | undefined
  try {
    const root = await service.authorizeRoot(workspace)
    const changes: string[] = []
    const unsubscribe = service.subscribe(event => changes.push(event.workspaceId))
    await service.operate({ type: 'watch', workspaceId: root.workspaceId })
    const list = () => service.operate({ type: 'list', workspaceId: root.workspaceId, directoryEntryId: root.rootEntryId })
    const before = await list()
    const targetEntry = before.entries.find(item => item.status === 'accessible' && item.name === 'target')
    const busyEntry = before.entries.find(item => item.status === 'accessible' && item.name === 'busy.md')
    const availableEntry = before.entries.find(item => item.status === 'accessible' && item.name === 'available.md')
    if (!targetEntry || targetEntry.status !== 'accessible' || !busyEntry || busyEntry.status !== 'accessible'
      || !availableEntry || availableEntry.status !== 'accessible') throw new Error('Missing Windows tree fixture')

    const created = path.join(workspace, 'external.md')
    await fs.writeFile(created, 'external')
    await expect.poll(() => changes.length, { timeout: 5_000 }).toBeGreaterThan(0)
    const createdEntry = (await list()).entries.find(item => item.status === 'accessible' && item.name === 'external.md')
    if (!createdEntry || createdEntry.status !== 'accessible') throw new Error('External create missing from listing')
    const firstEventCount = changes.length
    await fs.rename(created, path.join(workspace, 'renamed.md'))
    await expect.poll(() => changes.length, { timeout: 5_000 }).toBeGreaterThan(firstEventCount)
    const renamedEntry = (await list()).entries.find(item => item.status === 'accessible' && item.name === 'renamed.md')
    expect(renamedEntry).toMatchObject({ entryId: createdEntry.entryId })
    expect(changes.every(workspaceId => workspaceId === root.workspaceId)).toBe(true)

    let lockError = ''
    locker = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', lockScript], {
      windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, G20_LOCK_SOURCE: busy, G20_LOCK_READY: ready, G20_LOCK_RELEASE: release },
    })
    locker.stderr?.on('data', chunk => { lockError += String(chunk) })
    await expect.poll(() => existsSync(ready) || locker?.exitCode !== null, { timeout: 8_000 }).toBe(true)
    if (!existsSync(ready)) throw new Error(`Could not hold Windows file handle: ${lockError}`)
    const result = await service.operate({ type: 'move', operationId: 'occupied-batch', workspaceId: root.workspaceId,
      sourceEntryIds: [availableEntry.entryId, busyEntry.entryId], targetDirectoryId: targetEntry.entryId })
    expect(result.status).toBe('partial')
    expect(result.items.find(item => item.sourceEntryId === availableEntry.entryId)).toMatchObject({ status: 'success',
      targetPath: path.join(target, 'available.md') })
    const occupied = result.items.find(item => item.sourceEntryId === busyEntry.entryId)
    expect(occupied).toMatchObject({ status: 'failed', sourcePath: busy, targetPath: path.join(target, 'busy.md') })
    expect(['EPERM', 'EACCES', 'EBUSY']).toContain(occupied?.error?.code)
    expect(await fs.readFile(busy, 'utf8')).toBe('occupied')
    expect(await fs.readFile(path.join(target, 'available.md'), 'utf8')).toBe('available')
    expect(existsSync(path.join(target, 'busy.md'))).toBe(false)
    unsubscribe()
  } finally {
    await fs.writeFile(release, 'release').catch(() => {})
    if (locker) await waitForExit(locker)
    service.dispose()
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe M10 fixture cleanup')
    await fs.rm(directory, { recursive: true, force: true })
  }
})
