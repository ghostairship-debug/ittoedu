import { promises as fs } from 'node:fs'
import path from 'node:path'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { createMarkdownDriver } from '../../src/core/drivers/MarkdownDriver'
import { createDocumentJournal } from '../../src/main/workbench/documentJournal'
import type { DocumentPersistence } from '../../src/shared/workbench/document'

async function main() {
const [directory, point] = process.argv.slice(2)
const filename = path.join(directory, 'lesson.md')
const journal = createDocumentJournal({ directory: path.join(directory, 'journal') })
let armed = false
async function pause(): Promise<never> {
  process.send?.({ type: 'kill-now', point })
  return new Promise(() => {})
}
const persistence: DocumentPersistence = {
  async append(state) {
    if (armed && point === 'resources-before-log') await pause()
    await journal.append(state)
    if (armed && point === 'durable-before-state') await pause()
  },
  save: input => journal.save(input),
}
const session = await DocumentSession.create({ documentId: 'crash-document', epoch: 'worker-epoch',
  model: { kind: 'markdown', source: '# Before\n', resources: { assets: {}, components: {} } },
  binding: { kind: 'file', path: filename, version: null, bindingVersion: 1 },
}, createMarkdownDriver(), persistence)
await session.save()

// Fault injection stays in the child test harness, not the production commit path.
const originalOpen = fs.open.bind(fs)
fs.open = (async (...args: Parameters<typeof fs.open>) => {
  const handle = await originalOpen(...args)
  if (armed && point === 'journal-mid-write' && String(args[0]).endsWith('.journal') && args[1] === 'a+') {
    const originalWrite = handle.writeFile.bind(handle)
    handle.writeFile = async data => {
      const bytes = Buffer.from(data as Uint8Array)
      await originalWrite(bytes.subarray(0, Math.floor(bytes.length / 2)))
      await handle.sync()
      await pause()
    }
  }
  return handle
}) as typeof fs.open
const originalRename = fs.rename.bind(fs)
fs.rename = async (from, to) => {
  const savingTarget = armed && String(to) === filename
  if (savingTarget && point === 'save-before-replace') await pause()
  await originalRename(from, to)
  if (savingTarget && point === 'save-after-replace') await pause()
}
armed = true
const bytes = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1sAAAAASUVORK5CYII=', 'base64'))
const receipt = await session.execute({ documentId: session.documentId, epoch: 'worker-epoch', baseRevision: 0,
  operationId: 'content-and-resource', actor: 'human', mutation: { type: 'command', command: {
    type: 'markdown.replace', source: '# After\n![New](assets/new.png)\n', resources: { assets: { 'assets/new.png': bytes }, components: {} },
  } },
})
if (receipt.status !== 'applied') throw new Error(JSON.stringify(receipt))
await session.save()
throw new Error(`Fault point was not reached: ${point}`)
}
void main().catch(error => { console.error(error); process.exitCode = 1 })
