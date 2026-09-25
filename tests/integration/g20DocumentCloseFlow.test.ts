// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { closeDocumentFlow, type DocumentClosePorts } from '../../src/main/workbench/documentCloseFlow'

const directories: string[] = []
afterEach(async () => { for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true }) })
async function setup() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-close-dialog-')); directories.push(directory)
  const filename = path.join(directory, '课例.md'); await fs.writeFile(filename, '原稿')
  const host = new DocumentHostService(path.join(directory, 'recovery')), opened = await host.open(filename)
  const edit = async (text: string) => {
    const snapshot = await host.internalAPI.read(opened.documentId)
    return host.internalAPI.dispatch({ documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision,
      operationId: crypto.randomUUID(), actor: 'human', mutation: { type: 'command', command: { type: 'markdown.replace', source: text } } })
  }
  await edit('未保存的修改')
  const ports: DocumentClosePorts = {
    read: () => host.internalAPI.read(opened.documentId), hasWritableTasks: async () => false, confirmStop: async () => true,
    stopWritableTasks: async () => {}, chooseDirty: async () => 'save', save: () => host.saveToPath(opened.documentId),
    withBarrier: work => host.tools.withWriteTaskBarrier([opened.documentId], work),
    close: async (snapshot, discardDirty) => { await host.operate({ type: 'close', documentId: snapshot.documentId, discardDirty, expected: { epoch: snapshot.epoch, revision: snapshot.revision } }) },
  }
  return { directory, filename, host, opened, edit, ports }
}

it('close asks before stopping writers; cancel/save cancellation keep content and History, successful save permits reopen', async () => {
  const { ports, host, opened, filename } = await setup()
  let active = true, stops = 0
  ports.hasWritableTasks = async () => active
  ports.stopWritableTasks = async () => { active = false; stops++ }
  ports.confirmStop = async () => false
  expect(await closeDocumentFlow(ports)).toBe(false); expect(stops).toBe(0)
  ports.confirmStop = async () => true; ports.chooseDirty = async () => 'cancel'
  expect(await closeDocumentFlow(ports)).toBe(false); expect(stops).toBe(1)
  ports.chooseDirty = async () => 'save'
  const save = ports.save; ports.save = async () => null
  expect(await closeDocumentFlow(ports)).toBe(false)
  expect(await host.internalAPI.read(opened.documentId)).toMatchObject({ dirty: true, undoDepth: 1 })
  ports.save = save
  expect(await closeDocumentFlow(ports)).toBe(true)
  expect((await host.open(filename)).model).toMatchObject({ source: '未保存的修改' })
})

it('discard is fenced to the exact revision and preserves edits made while the dialog was open', async () => {
  const { ports, host, opened, edit, filename } = await setup()
  ports.chooseDirty = async () => { await edit('确认期间新增内容'); return 'discard' }
  await expect(closeDocumentFlow(ports)).rejects.toThrow('确认关闭期间文档又有更改')
  expect(await host.internalAPI.read(opened.documentId)).toMatchObject({ dirty: true, undoDepth: 2, model: { source: '确认期间新增内容' } })
  expect(await fs.readFile(filename, 'utf8')).toBe('原稿')
  ports.chooseDirty = async () => 'discard'
  expect(await closeDocumentFlow(ports)).toBe(true)
  expect((await host.open(filename)).model).toMatchObject({ source: '原稿' })
})
