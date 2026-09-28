// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { AgentFileService } from '../../src/main/workbench/execution/AgentFileService'
import { DocumentFileSession } from '../../src/renderer/documentFiles/documentFileSession'
import { createLessonDocumentFiles } from '../../src/main/lessonDocumentFiles'
import { createMarkdownTestHost } from '../helpers/markdownDocumentHost'

const roots: string[] = []
const sessions: DocumentFileSession[] = []
afterEach(async () => { for (const session of sessions.splice(0)) session.dispose(); for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }) })

it('creates HTML as a formal text document and opens both HTML extensions', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-m23-html-route-')); roots.push(root)
  const { host } = createMarkdownTestHost(path.join(root, 'journal'))
  const files = new AgentFileService(host)
  const context = { runId: 'html', workspaceRoot: root, permission: 'workspace' as const }
  const created = await files.execute(context, 'file.create', { name: 'page.html', kind: 'html' }, 'html-create')
  expect(created.opened).toMatchObject({ kind: 'text', writable: true, name: path.join(root, 'page.html') })
  await expect(fs.readFile(path.join(root, 'page.html'), 'utf8')).resolves.toBe('')
  await expect(files.preflightCreate(context, { name: 'page.txt', kind: 'html' })).rejects.toThrow('格式不符')
  await fs.writeFile(path.join(root, 'legacy.htm'), '<!doctype html><title>legacy</title>')
  const opened = await files.execute(context, 'file.open', { path: 'legacy.htm' }, 'html-open')
  expect(opened.opened).toMatchObject({ kind: 'text', writable: true })
})

it('commits HTML edits to main History without the 800 ms disk flush, then saves and reopens exact source', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-m23-html-save-')); roots.push(root)
  const filename = path.join(root, 'page.html')
  const original = '\ufeff<!doctype html>\r\n<p>old</p>\n'
  const changed = '\ufeff<!doctype html>\r\n<p>新文案 &amp; 😀</p>\n'
  await fs.writeFile(filename, original, 'utf8')
  const { documents } = createMarkdownTestHost(path.join(root, 'journal'))
  const files = createLessonDocumentFiles({ recoveryDirectory: path.join(root, 'recovery'), validateTarget: async () => {}, documents })
  const ref = { kind: 'file' as const, path: filename }
  const port = { ...files, documents }
  const session = new DocumentFileSession(ref, port); sessions.push(session)
  await session.open()
  session.edit(changed)
  expect(await session.drain()).toBe(true)
  expect(session.committedDocument).toMatchObject({ dirty: true, undoDepth: 1, model: { kind: 'text', source: changed } })
  await new Promise(resolve => setTimeout(resolve, 950))
  expect(await fs.readFile(filename, 'utf8')).toBe(original)
  expect(session.getSnapshot().dirty).toBe(true)
  await session.undo()
  expect(session.getSnapshot().source).toBe(original)
  await session.redo()
  expect(session.getSnapshot().source).toBe(changed)
  expect(await session.flush()).toBe(true)
  expect(await fs.readFile(filename, 'utf8')).toBe(changed)
  session.dispose()
  const reopened = new DocumentFileSession(ref, port); sessions.push(reopened)
  await reopened.open()
  expect(reopened.getSnapshot()).toMatchObject({ source: changed, dirty: false })
})
