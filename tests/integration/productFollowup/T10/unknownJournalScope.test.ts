// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createDocumentJournal } from '../../../../src/main/workbench/documentJournal'
import { DocumentHostService } from '../../../../src/main/workbench/DocumentHostService'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe fixture cleanup')
    await fs.rm(root, { recursive: true, force: true })
  }
})

it.each(['short-unreadable', 'unreadable complete recovery record'.repeat(4)])('unknown-owner unreadable journal %j permits unrelated non-readOnly availability and a real save while retaining the original diagnostic', async damagedSource => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'T10-journal-')); roots.push(root)
  const directory = path.join(root, 'recovery'); await fs.mkdir(directory)
  const damaged = path.join(directory, `${'0'.repeat(64)}.journal`)
  // No document/path record and no binding index; neither short opaque input nor a bad complete header may be deleted.
  await fs.writeFile(damaged, damagedSource)
  const journal = createDocumentJournal({ directory })
  expect(await journal.listBindings()).toEqual([])
  expect(journal.recoveryIssues).toHaveLength(1)
  const filename = path.join(root, 'unrelated.md')
  await expect(journal.assertAvailable([filename], ['unrelated-document'], false)).resolves.toBeUndefined()
  const host = new DocumentHostService(directory)
  const created = await host.internalAPI.create({ kind: 'markdown', source: '# Unrelated teacher content', resources: { assets: {}, components: {} } }, 'unrelated.md')
  const saved = await host.saveToPath(created.documentId, filename)
  expect(saved).toMatchObject({ dirty: false, model: { source: '# Unrelated teacher content' } })
  expect(await fs.readFile(filename, 'utf8')).toBe('# Unrelated teacher content')
  const cold = new DocumentHostService(directory)
  expect(await cold.open(filename)).toMatchObject({ dirty: false, model: { source: '# Unrelated teacher content' } })
  expect(await fs.readFile(damaged, 'utf8')).toBe(damagedSource)
  await journal.listBindings()
  expect(journal.recoveryIssues).toHaveLength(1)
})
