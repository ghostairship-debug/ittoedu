// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { DocumentHostService, type DocumentSaveFact } from '../../src/main/workbench/DocumentHostService'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe S12 fixture cleanup')
    await fs.rm(root, { recursive: true, force: true })
  }
})

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-s12-outside-file-'))
  roots.push(root)
  const filename = path.join(root, 'lesson.md')
  const journalDirectory = path.join(root, 'journal')
  await fs.writeFile(filename, '# Original\n')
  const host = new DocumentHostService(journalDirectory)
  const opened = await host.open(filename)
  return { root, filename, journalDirectory, host, opened }
}

async function humanEdit(host: DocumentHostService, snapshot: DocumentSnapshot, operationId: string, source: string) {
  return host.internalAPI.dispatch({ documentId: snapshot.documentId, epoch: snapshot.epoch,
    baseRevision: snapshot.revision, operationId, actor: 'human',
    mutation: { type: 'command', command: { type: 'markdown.replace', source } } })
}

/** A separate OS process writes the file directly, without MCP or host tool calls. */
function outsideCliWrite(filename: string, source: string): void {
  execFileSync(process.execPath, ['-e', "require('node:fs').writeFileSync(process.env.G20_OUTSIDE_FILE, process.env.G20_OUTSIDE_SOURCE)"], {
    windowsHide: true, stdio: 'pipe', env: { ...process.env, G20_OUTSIDE_FILE: filename, G20_OUTSIDE_SOURCE: source },
  })
}

it.skipIf(process.platform !== 'win32')('S12-T05 outside process cannot masquerade as a host commit or overwrite a dirty draft', async () => {
  const { root, filename, journalDirectory, host, opened } = await fixture()
  const localSource = '# Local unsaved teacher draft\n'
  const externalSource = '# Outside CLI edit\n'
  const receipt = await humanEdit(host, opened, 'teacher-edit', localSource)
  expect(receipt).toMatchObject({ status: 'applied', revision: 1 })
  const before = await host.internalAPI.read(opened.documentId)
  expect(before).toMatchObject({ revision: 1, dirty: true, undoDepth: 1, model: { source: localSource } })
  const saveFacts: DocumentSaveFact[] = []
  const unsubscribe = host.subscribeSaves(fact => saveFacts.push(fact))

  outsideCliWrite(filename, externalSource)
  const afterExternalWrite = await host.internalAPI.read(opened.documentId)
  expect(afterExternalWrite).toMatchObject({ revision: 1, dirty: true, undoDepth: 1,
    binding: { kind: 'file', version: before.binding.kind === 'file' ? before.binding.version : undefined },
    model: { source: localSource } })
  expect(await host.internalAPI.lookup(opened.documentId, 'teacher-edit')).toEqual(receipt)
  const observed = await host.internalAPI.observeFile(opened.documentId)
  expect(observed).toMatchObject({ model: { source: externalSource }, bindingVersion: 1 })
  expect(observed.version).not.toBe(before.binding.kind === 'file' ? before.binding.version : null)
  await expect(host.internalAPI.save(opened.documentId)).rejects.toMatchObject({ code: 'file-conflict' })
  expect(saveFacts.map(fact => fact.status)).toEqual(['saving', 'failed'])
  expect(await fs.readFile(filename, 'utf8')).toBe(externalSource)
  expect(await host.internalAPI.read(opened.documentId)).toMatchObject({ revision: 1, dirty: true,
    undoDepth: 1, model: { source: localSource } })
  unsubscribe()

  const restarted = new DocumentHostService(journalDirectory)
  expect(await restarted.internalAPI.recoverable()).toMatchObject([{ documentId: opened.documentId, dirty: true,
    model: { source: localSource } }])
  const restored = await restarted.internalAPI.restore(opened.documentId)
  expect(restored).toMatchObject({ dirty: true, revision: 1, undoDepth: 1, model: { source: localSource } })
  await expect(restarted.internalAPI.save(opened.documentId)).rejects.toMatchObject({ code: 'file-conflict' })
  const saveAs = path.join(root, 'teacher-draft.md')
  const savedCopy = await restarted.internalAPI.save(opened.documentId, saveAs)
  expect(savedCopy).toMatchObject({ dirty: false, model: { source: localSource }, binding: { kind: 'file', path: saveAs } })
  expect(await fs.readFile(saveAs, 'utf8')).toBe(localSource)
  expect(await fs.readFile(filename, 'utf8')).toBe(externalSource)
})

it.skipIf(process.platform !== 'win32')('S12-T05 explicit disk reconciliation records the choice and retains the previous draft in History', async () => {
  const { filename, host, opened } = await fixture()
  const localSource = '# Local before reload\n'
  const externalSource = '# External chosen version\n'
  expect(await humanEdit(host, opened, 'teacher-edit-before-reload', localSource)).toMatchObject({ status: 'applied' })
  outsideCliWrite(filename, externalSource)
  expect(await host.internalAPI.read(opened.documentId)).toMatchObject({ revision: 1, undoDepth: 1,
    dirty: true, model: { source: localSource } })
  const observation = await host.internalAPI.observeFile(opened.documentId)
  const reloaded = await host.internalAPI.reconcileFile({ documentId: opened.documentId, epoch: opened.epoch,
    baseRevision: 1, bindingVersion: observation.bindingVersion, version: observation.version, choice: 'disk' })
  expect(reloaded).toMatchObject({ revision: 2, dirty: false, undoDepth: 2, model: { source: externalSource } })
  expect(await fs.readFile(filename, 'utf8')).toBe(externalSource)
  const undone = await host.internalAPI.dispatch({ documentId: opened.documentId, epoch: opened.epoch,
    baseRevision: reloaded.revision, operationId: 'undo-explicit-reload', actor: 'human', mutation: { type: 'undo' } })
  expect(undone).toMatchObject({ status: 'applied' })
  expect(await host.internalAPI.read(opened.documentId)).toMatchObject({ dirty: true, model: { source: localSource } })
  expect(await fs.readFile(filename, 'utf8')).toBe(externalSource)
})
