// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { BrowserWindow } from 'electron'
import { afterEach, expect, it, vi } from 'vitest'

const { openPath } = vi.hoisted(() => ({ openPath: vi.fn(async (_filename: string): Promise<string> => '') }))
vi.mock('electron', () => ({ app: { getPath: () => '/fixture' }, dialog: {}, shell: { openPath } }))
vi.mock('../../src/main/lessonWorkspace', () => ({ LessonWorkspaceService: class {} }))
vi.mock('../../src/main/lessonProjects', () => ({ LessonProjectRegistry: class {} }))
vi.mock('../../src/main/fileDialogs', () => ({ openSelectedProjectFile: vi.fn() }))
vi.mock('../../src/main/workbench/workspaceFilesDesktopService', () => ({ authorizeWorkspaceFilesRoot: vi.fn() }))
import { operateLessonDesktop } from '../../src/main/lessonDesktopService'

const directories: string[] = []
afterEach(async () => {
  openPath.mockReset().mockResolvedValue('')
  for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true })
})
async function fixture(name: string) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'guoling-external-file-'))
  directories.push(directory)
  const filename = path.join(directory, name)
  await fs.writeFile(filename, 'fixture')
  return filename
}
const open = (filename: string) => operateLessonDesktop({} as BrowserWindow, { operation: 'open-external', path: filename })

it('opens an external document with the system association and reports its failure string', async () => {
  const filename = await fixture('document.docx')
  expect(await open(filename)).toEqual({ opened: true })
  expect(openPath).toHaveBeenCalledWith(await fs.realpath(filename))
  openPath.mockResolvedValueOnce('No application is associated with this file')
  expect(await open(filename)).toEqual({ opened: false, openError: 'No application is associated with this file' })
})

it('turns missing-file and shell failures into clear open receipts', async () => {
  const filename = await fixture('slides.pptx')
  await fs.rm(filename)
  expect(await open(filename)).toEqual({ opened: false, openError: '文件不存在，可能已被移动或删除' })
  expect(openPath).not.toHaveBeenCalled()
  await fs.writeFile(filename, 'fixture')
  openPath.mockRejectedValueOnce(new Error('system open failed'))
  expect(await open(filename)).toEqual({ opened: false, openError: 'system open failed' })
})

it.each(['program.exe', 'shortcut.lnk', 'script.js', 'script.cmd', 'script.ps1', 'script.py'])('does not invoke OS execution associations for %s', async name => {
  expect(await open(await fixture(name))).toMatchObject({ opened: false, openError: expect.stringContaining('不能从果铃运行') })
  expect(openPath).not.toHaveBeenCalled()
})
