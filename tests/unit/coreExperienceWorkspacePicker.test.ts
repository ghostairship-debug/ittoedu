// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { BrowserWindow, OpenDialogReturnValue } from 'electron'
import { expect, it, vi } from 'vitest'

const probe = vi.hoisted(() => ({ userData: '', show: vi.fn(), authorize: vi.fn(async (_path: string) => {}) }))
vi.mock('electron', () => ({ app: { getPath: () => probe.userData }, dialog: { showOpenDialog: probe.show }, shell: {} }))
vi.mock('../../src/main/fileDialogs', () => ({ openSelectedProjectFile: vi.fn() }))
vi.mock('../../src/main/workbench/workspaceFilesDesktopService', () => ({ authorizeWorkspaceFilesRoot: probe.authorize }))
import { operateLessonDesktop } from '../../src/main/lessonDesktopService'

it('shares one native workspace picker for concurrent requests and permits a fresh choice after cancellation', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-picker-'))
  try {
    probe.userData = path.join(root, 'profile'); await fs.mkdir(probe.userData)
    const directory = path.join(root, 'workspace'); await fs.mkdir(directory)
    let finish!: (result: OpenDialogReturnValue) => void
    probe.show.mockImplementationOnce(() => new Promise<OpenDialogReturnValue>(resolve => { finish = resolve }))
    const window = {} as BrowserWindow
    const first = operateLessonDesktop(window, { operation: 'choose-workspace' })
    const second = operateLessonDesktop(window, { operation: 'choose-workspace' })
    await Promise.resolve()
    expect(probe.show).toHaveBeenCalledOnce()
    expect(probe.show).toHaveBeenCalledWith(window, expect.objectContaining({ title: '打开工作空间', properties: ['openDirectory', 'createDirectory'] }))
    finish({ canceled: true, filePaths: [] })
    expect(await Promise.all([first, second])).toEqual([{ cancelled: true }, { cancelled: true }])
    expect(probe.authorize).not.toHaveBeenCalled()
    probe.show.mockResolvedValueOnce({ canceled: false, filePaths: [directory] })
    const selected = await operateLessonDesktop(window, { operation: 'choose-workspace' })
    expect(probe.show).toHaveBeenCalledTimes(2)
    expect(selected.directory).toBe(await fs.realpath(directory))
    expect(probe.authorize).toHaveBeenCalledOnce()
    expect(probe.authorize).toHaveBeenCalledWith(selected.directory)
    expect(JSON.parse(await fs.readFile(path.join(probe.userData, 'lesson-workspaces-v1.json'), 'utf8')).directories).toEqual([selected.directory])
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
