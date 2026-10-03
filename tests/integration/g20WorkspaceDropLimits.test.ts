// @vitest-environment node
import { File } from 'node:buffer'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { snapshotWorkspaceDrop } from '../../src/renderer/lessonWorkspace/view/workspaceDropFiles'
import { WorkspaceFiles } from '../../src/main/workbench/WorkspaceFiles'
import { WorkspaceFilesDesktopService } from '../../src/main/workbench/workspaceFilesDesktopService'

it('snapshots and imports more than 32 dragged files through the real authorized file owner', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-many-drop-files-'))
  const service = new WorkspaceFilesDesktopService(new WorkspaceFiles())
  try {
    const files = Array.from({ length: 33 }, (_, index) => new File([`content-${index}`], `note-${index}.txt`))
    const snapshot = await snapshotWorkspaceDrop({ items: [], files } as unknown as DataTransfer)
    expect(snapshot.files).toHaveLength(33)
    const root = await service.authorizeRoot(directory)
    const result = await service.operate({ type: 'import-files', workspaceId: root.workspaceId,
      operationId: 'drop-many', targetDirectoryId: root.rootEntryId, ...snapshot })
    expect(result.status).toBe('success')
    expect(result.items).toHaveLength(33)
    expect(await fs.readFile(path.join(directory, 'note-32.txt'), 'utf8')).toBe('content-32')
  } finally {
    service.dispose()
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe fixture root')
    await fs.rm(directory, { recursive: true, force: true })
  }
})
