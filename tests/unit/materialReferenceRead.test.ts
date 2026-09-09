// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'

const native = vi.hoisted(() => ({ directory: '', locate: vi.fn(), dialog: vi.fn() }))
vi.mock('electron', () => ({ app: { getPath: () => native.directory },
  shell: { showItemInFolder: native.locate }, dialog: { showOpenDialog: native.dialog } }))
import { operateMaterials } from '../../src/main/materialService'

describe('chat material reference reads', () => {
  it('reads the retained material without opening Explorer, while explicit locate keeps its user action', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'material-reference-'))
    native.directory = directory
    const owner = { projectId: 'material-course', projectPath: path.join(directory, 'lesson.h5lesson') }, window = {} as BrowserWindow
    const source = path.join(directory, 'source.md')
    try {
      await fs.writeFile(source, '原材料')
      const [record] = await operateMaterials(window, { operation: 'import-text', ...owner,
        input: { title: '已导入资料', text: '原材料', source: { kind: 'file', locator: source } } })
      expect(await operateMaterials(window, { operation: 'read', ...owner, id: record!.id })).toEqual([record])
      expect(native.locate).not.toHaveBeenCalled(); expect(native.dialog).not.toHaveBeenCalled()
      await operateMaterials(window, { operation: 'locate', ...owner, id: record!.id })
      expect(native.locate).toHaveBeenCalledExactlyOnceWith(source)
      await fs.unlink(source)
      expect(await operateMaterials(window, { operation: 'read', ...owner, id: record!.id })).toEqual([record])
      await expect(operateMaterials(window, { operation: 'read', ...owner, projectId: 'other-course', id: record!.id })).rejects.toThrow('不属于当前工程')
      expect(native.locate).toHaveBeenCalledTimes(1)
    } finally { await fs.rm(directory, { recursive: true, force: true }) }
  })
})
