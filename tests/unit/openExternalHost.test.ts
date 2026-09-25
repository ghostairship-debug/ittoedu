// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'

const state = vi.hoisted(() => ({ userData: '', openPath: vi.fn(async (_filename: string) => '') }))
vi.mock('electron', () => ({
  app: { getPath: () => state.userData },
  dialog: {},
  shell: { openPath: (filename: string) => state.openPath(filename) },
}))
vi.mock('../../src/main/fileDialogs', () => ({ openSelectedProjectFile: vi.fn() }))
import { operateLessonDesktop } from '../../src/main/lessonDesktopService'

let root: string
beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'open-external-'))
  state.userData = path.join(root, 'app')
  await fs.mkdir(state.userData, { recursive: true })
})
afterAll(async () => {
  if (!root || !path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe test root')
  await fs.rm(root, { recursive: true, force: true })
})

describe('F06 system host open-external', () => {
  it('returns a visible failure instead of throwing when the OS has no association', async () => {
    const filename = path.join(root, 'notes.docx')
    await fs.writeFile(filename, 'docx')
    state.openPath.mockResolvedValueOnce('There is no application associated with the given file name extension.')
    const result = await operateLessonDesktop({} as BrowserWindow, { operation: 'open-external', path: filename })
    expect(result).toEqual({
      opened: false,
      openError: 'There is no application associated with the given file name extension.',
    })
    expect(state.openPath).toHaveBeenCalledWith(await fs.realpath(filename))
  })

  it('reports success when the system host accepts the path', async () => {
    const filename = path.join(root, 'notes.md')
    await fs.writeFile(filename, '# notes\n')
    state.openPath.mockResolvedValueOnce('')
    await expect(operateLessonDesktop({} as BrowserWindow, { operation: 'open-external', path: filename }))
      .resolves.toEqual({ opened: true })
  })
})
