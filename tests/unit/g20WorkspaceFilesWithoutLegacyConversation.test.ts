// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'

const probe = vi.hoisted(() => ({
  userData: '', root: '',
  authorize: vi.fn(async (_path: string) => {}),
}))
vi.mock('electron', () => ({
  app: { getPath: () => probe.userData },
  dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [probe.root] }) },
  shell: { openPath: async () => '' },
}))
vi.mock('../../src/main/fileDialogs', () => ({ openSelectedProjectFile: vi.fn() }))
vi.mock('../../src/main/workbench/workspaceFilesDesktopService', () => ({ authorizeWorkspaceFilesRoot: probe.authorize }))
import { operateLessonDesktop } from '../../src/main/lessonDesktopService'

beforeAll(async () => {
  probe.root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-files-no-v1-'))
  probe.userData = path.join(probe.root, 'app')
  await fs.mkdir(probe.userData)
})
afterAll(async () => {
  const resolved = path.resolve(probe.root)
  if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe test directory')
  await fs.rm(resolved, { recursive: true, force: true })
})

it('opens real folders and creates/reopens lesson metadata while old records are unavailable', async () => {
  const window = {} as BrowserWindow
  const chosen = await operateLessonDesktop(window, { operation: 'choose-workspace' })
  expect(chosen.directory).toBe(await fs.realpath(probe.root))
  expect(probe.authorize).toHaveBeenCalledWith(chosen.directory)
  const reopened = await operateLessonDesktop(window, { operation: 'open-workspace', directory: probe.root })
  expect(reopened.directory).toBe(chosen.directory)
  const created = await operateLessonDesktop(window, { operation: 'create-lesson', directory: probe.root, name: 'new lesson' })
  expect(created.lesson?.manifest.title).toBe('new lesson')
  expect(created).not.toHaveProperty('conversation')
  const opened = await operateLessonDesktop(window, { operation: 'open-lesson', directory: created.lesson!.identity.normalizedDirectory })
  expect(opened.lesson?.identity).toEqual(created.lesson!.identity)
  expect(opened).not.toHaveProperty('conversation')
  expect(opened).not.toHaveProperty('conversations')
  const listing = await operateLessonDesktop(window, { operation: 'list-directory', directory: probe.root })
  expect(listing.entries?.some(entry => entry.name === 'new lesson' && entry.kind === 'directory')).toBe(true)
  await expect(operateLessonDesktop(window, { operation: 'create-conversation', owner: { kind: 'workspace', workspaceRoot: probe.root } })).rejects.toThrow()
})
