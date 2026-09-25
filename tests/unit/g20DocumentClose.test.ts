// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { BrowserWindow } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { prepareDocumentWindowClose } from '../../src/main/workbench/documentCloseCoordinator'
import { saveDocumentWithDialog } from '../../src/main/workbench/documentSaveDialog'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'

const { getPath, showSaveDialog } = vi.hoisted(() => ({ getPath: vi.fn(), showSaveDialog: vi.fn() }))
vi.mock('electron', () => ({ app: { getPath }, dialog: { showSaveDialog } }))
const directories: string[] = []
const window = {} as BrowserWindow
let sequence = 0

async function host() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-close-'))
  directories.push(directory)
  getPath.mockReturnValue(directory)
  const journal = path.join(directory, 'journal')
  const documents = new DocumentHostService(journal)
  const course = await documents.internalAPI.create({ kind: 'course-v9', project: createBlankCourseProject({
    title: 'saved baseline', includeDefaultController: false, controls: 'none',
  }), resources: { assets: {}, components: {} } }, 'background.h5lesson')
  const coursePath = path.join(directory, 'background.h5lesson')
  await documents.saveToPath(course.documentId, coursePath)
  const foregroundPath = path.join(directory, 'foreground.md')
  await fs.writeFile(foregroundPath, '# clean foreground')
  const foreground = await documents.open(foregroundPath)
  const read = (id: string) => documents.registry.get(id).read()
  const drain = async () => { await Promise.all(documents.registry.list().map(value => documents.registry.get(value.documentId).drain())) }
  const edit = async (id: string, text: string) => {
    const current = read(id)
    return documents.internalAPI.dispatch({ documentId: id, epoch: current.epoch, baseRevision: current.revision,
      operationId: `close-edit-${++sequence}`, actor: 'human', mutation: { type: 'command', command: current.model.kind === 'markdown'
        ? { type: 'markdown.replace', source: text }
        : { type: 'course.replace', project: { ...current.model.project, title: text } } } })
  }
  return { documents, directory, journal, course, coursePath, foreground, foregroundPath, read, edit, drain }
}

afterEach(async () => {
  getPath.mockReset()
  showSaveDialog.mockReset()
  for (const directory of directories.splice(0)) {
    if (!path.resolve(directory).startsWith(path.join(path.resolve(os.tmpdir()), 'g20-close-'))) throw new Error('Invalid test directory')
    await fs.rm(directory, { recursive: true, force: true })
  }
})

describe('G20 whole-window document close', () => {
  it('finds background dirty documents and saves every kind through real persistence and native dialog routing', async () => {
    const h = await host()
    await h.edit(h.course.documentId, 'background must be saved')
    const untitled = await h.documents.internalAPI.create({ kind: 'markdown', source: '# new notes', resources: { assets: {}, components: {} } }, 'notes.md')
    const notesPath = path.join(h.directory, 'notes.md')
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: notesPath })
    const confirm = vi.fn(() => 'save' as const), prepare = vi.fn(async () => true), saved: string[] = []
    expect(h.read(h.foreground.documentId).dirty).toBe(false)
    expect(await prepareDocumentWindowClose({ list: () => h.documents.registry.list(), drain: h.drain, rendererDirty: async () => false, confirm,
      prepareRenderer: prepare, save: async id => { saved.push(id); return saveDocumentWithDialog(window, h.documents, id) } })).toBe(true)
    expect(confirm).toHaveBeenCalledOnce()
    expect(saved).toEqual([h.course.documentId, untitled.documentId])
    expect(prepare).toHaveBeenCalledTimes(2)
    expect(showSaveDialog).toHaveBeenCalledOnce()
    expect(showSaveDialog).toHaveBeenCalledWith(window, expect.objectContaining({
      defaultPath: path.join(h.directory, 'workbench-v2', 'space', 'notes.md'),
      filters: [{ name: 'Markdown 文档', extensions: ['md'] }],
    }))
    expect(h.documents.registry.list().every(value => !value.dirty)).toBe(true)
    expect(new CourseV9Driver().load(new Uint8Array(await fs.readFile(h.coursePath)))).toMatchObject({ project: { title: 'background must be saved' } })
    expect(await fs.readFile(notesPath, 'utf8')).toBe('# new notes')
  })

  it('keeps the window and untitled draft after dialog cancellation, and preserves recovery without deleting files', async () => {
    const h = await host()
    await h.edit(h.course.documentId, 'edited course')
    const untitled = await h.documents.internalAPI.create({ kind: 'markdown', source: '# cancel keeps this', resources: { assets: {}, components: {} } }, 'cancel.md')
    showSaveDialog.mockResolvedValue({ canceled: true })
    const save = vi.fn((id: string) => saveDocumentWithDialog(window, h.documents, id))
    const ports = { list: () => h.documents.registry.list(), drain: h.drain, rendererDirty: async () => false,
      confirm: () => 'save' as const, prepareRenderer: async () => true, save }
    expect(await prepareDocumentWindowClose(ports)).toBe(false)
    expect(h.read(untitled.documentId)).toMatchObject({ dirty: true, binding: { kind: 'untitled' } })
    expect(h.documents.registry.list()).toHaveLength(3)
    expect(h.read(h.course.documentId).dirty).toBe(false)
    save.mockClear()
    expect(await prepareDocumentWindowClose({ ...ports, confirm: () => 'preserve' as const })).toBe(true)
    expect(save).not.toHaveBeenCalled()
    const restarted = new DocumentHostService(h.journal)
    const recovery = await restarted.operate({ type: 'recoverable' }) as DocumentSnapshot[]
    expect(recovery).toEqual(expect.arrayContaining([expect.objectContaining({ documentId: untitled.documentId, dirty: true })]))
    expect(await fs.readFile(h.foregroundPath, 'utf8')).toBe('# clean foreground')
  })

  it('refuses close on save failure or inputs arriving during save without automatically resaving them', async () => {
    const h = await host()
    await h.edit(h.course.documentId, 'version selected for save')
    const prepare = vi.fn(async () => {
      if (prepare.mock.calls.length === 2) await h.edit(h.foreground.documentId, '# typed during save')
      return true
    })
    const save = vi.fn(async (id: string) => {
      const result = await saveDocumentWithDialog(window, h.documents, id)
      await h.edit(id, 'course edited after captured save')
      return result
    })
    const ports = { list: () => h.documents.registry.list(), drain: h.drain, rendererDirty: async () => false,
      confirm: () => 'save' as const, prepareRenderer: prepare, save }
    expect(await prepareDocumentWindowClose(ports)).toBe(false)
    expect(save).toHaveBeenCalledOnce()
    expect(h.read(h.course.documentId).dirty).toBe(true)
    expect(h.read(h.foreground.documentId).dirty).toBe(true)
    expect(await fs.readFile(h.foregroundPath, 'utf8')).toBe('# clean foreground')
    expect(new CourseV9Driver().load(new Uint8Array(await fs.readFile(h.coursePath)))).toMatchObject({ project: { title: 'version selected for save' } })
    await expect(prepareDocumentWindowClose({ ...ports, prepareRenderer: async () => true,
      save: async () => { throw new Error('disk unavailable') } })).rejects.toThrow('disk unavailable')
    expect(h.documents.registry.list()).toHaveLength(2)
  })
})
