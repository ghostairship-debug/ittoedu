// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
const selected = vi.hoisted(() => ({ path: '', profile: '' }))
vi.mock('electron', () => ({ app: { getPath: () => selected.profile },
  dialog: { showSaveDialog: async () => ({ canceled: false, filePath: selected.path }) } }))
import { saveDocumentWithDialog } from '../../src/main/workbench/documentSaveDialog'
import { saveProjectFile } from '../../src/main/fileDialogs'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) {
  if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('fixture outside temp')
  await fs.rm(root, { recursive: true, force: true })
} })

it('does not transfer replacement approval from .h5lesson to an existing .glx sibling in either save entry', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-glx-dialog-')); roots.push(root)
  selected.profile = path.join(root, 'profile')
  const driver = new CourseV10Driver()
  const archive = (title: string) => driver.serialize({ kind: 'course-v10', project: createBlankCourseProjectV10(title), resources: { assets: {}, components: {} } })
  const title = async (filename: string) => { const opened = driver.load(await fs.readFile(filename));
    if (opened.kind !== 'course-v10') throw new Error('Missing V10'); return opened.project.title }
  const window = {} as BrowserWindow
  for (const entry of ['session', 'binary']) {
    const target = path.join(root, `${entry}.glx`), old = path.join(root, `${entry}.h5lesson`)
    await fs.writeFile(target, archive('另一个工程')); await fs.writeFile(old, archive('原旧文件'))
    const host = new DocumentHostService(path.join(root, `${entry}-journal`))
    const created = await host.bootstrapCourse()
    const save = () => entry === 'session' ? saveDocumentWithDialog(window, host, created.documentId, true)
      : saveProjectFile(window, { bytes: archive('新工程'), suggestedName: `${entry}.glx` })
    selected.path = old
    await expect(save()).rejects.toThrow()
    expect(await title(target)).toBe('另一个工程')
    expect(await title(old)).toBe('原旧文件')
    selected.path = target
    expect(await save()).not.toBeNull()
    expect(await title(target)).toBe(entry === 'session' && created.model.kind === 'course-v10' ? created.model.project.title : '新工程')
    expect(await title(old)).toBe('原旧文件')
  }
})
