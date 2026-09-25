import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'

async function main() {
const [root, point] = process.argv.slice(2)
const host = new DocumentHostService(path.join(root, 'documents'))
const base = { kind: 'markdown' as const, source: 'BASE', resources: { assets: {}, components: {} } }
const a = await host.internalAPI.create(base, 'a.md')
const b = await host.internalAPI.create(base, 'b.md')
const c = await host.internalAPI.create(base, 'c.md')
const filename = (name: string) => path.join(root, `${name}.md`)
await host.saveToPath(a.documentId, filename('a'))
await host.saveToPath(b.documentId, filename('b'))
await host.saveToPath(c.documentId, filename('c'))

function replace(snapshot: DocumentSnapshot, operationId: string, source: string, assets: Record<string, Uint8Array> = {}) {
  return host.internalAPI.dispatch({ documentId: snapshot.documentId, epoch: snapshot.epoch,
    baseRevision: snapshot.revision, operationId, actor: 'agent', runId: 'active-run',
    mutation: { type: 'command', command: { type: 'markdown.replace', source,
      resources: { assets, components: {} } } } })
}
if ((await replace(a, 'a-committed', 'A DIRTY')).status !== 'applied') throw new Error('A did not commit')
const asset = new Uint8Array([1, 2, 3, 4, 5])
if ((await replace(b, 'b-committed', 'B DIRTY\n![asset](assets/fixture.png)',
  { 'assets/fixture.png': asset })).status !== 'applied') throw new Error('B did not commit')

// Deny a real document replacement, leaving the committed draft and attachment in recovery.
const rename = fs.rename.bind(fs)
let denied = false
fs.rename = async (from, to) => {
  if (!denied && String(to) === filename('b')) {
    denied = true
    throw Object.assign(new Error('disk unavailable'), { code: 'EIO' })
  }
  return rename(from, to)
}
try { await host.saveToPath(b.documentId) } catch { /* Expected EIO. */ }
finally { fs.rename = rename }
if (!denied || !(await host.internalAPI.read(b.documentId)).dirty) throw new Error('Disk failure was not observed')

await fs.writeFile(path.join(root, 'identities.json'), JSON.stringify({ a: a.documentId, b: b.documentId, c: c.documentId }))
const activeJournal = `${createHash('sha256').update(c.documentId).digest('hex')}.journal`
const open = fs.open.bind(fs)
fs.open = (async (...args: Parameters<typeof fs.open>) => {
  const handle = await open(...args)
  if (String(args[0]).endsWith(activeJournal) && args[1] === 'a+') {
    const write = handle.writeFile.bind(handle)
    handle.writeFile = async data => {
      if (point === 'before-durable') {
        process.send?.({ type: 'kill-now' })
        await new Promise<never>(() => {})
      }
      await write(data)
      await handle.sync()
      process.send?.({ type: 'kill-now' })
      await new Promise<never>(() => {})
    }
  }
  return handle
}) as typeof fs.open
await replace(c, 'c-active', 'C ACTIVE')
throw new Error('Crash point was not reached')
}
void main().catch(error => { console.error(error); process.exitCode = 1 })
