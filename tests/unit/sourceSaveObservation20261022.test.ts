// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { createDocumentJournal } from '../../src/main/workbench/documentJournal'
import * as sourceResources from '../../src/main/workbench/documentSourceResources'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected fixture path')
    await fs.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 })
  }
})
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'source-save-observation-')); roots.push(root)
  const filename = path.join(root, 'lesson.html')
  await fs.writeFile(filename, '<!doctype html><html><head><link rel="stylesheet" href="theme.css"></head><body><h1>original</h1><iframe src="child.html"></iframe><img src="missing.svg"></body></html>')
  await fs.writeFile(path.join(root, 'theme.css'), 'h1{color:red}')
  await fs.writeFile(path.join(root, 'child.html'), '<p>child original</p>')
  const host = new DocumentHostService(path.join(root, 'journal')), opened = await host.internalAPI.open(filename)
  return { root, filename, host, opened }
}
async function edit(host: DocumentHostService, snapshot: DocumentSnapshot, source: string, operationId = 'source-edit') {
  const result = await host.internalAPI.dispatch({ documentId: snapshot.documentId, epoch: snapshot.epoch, operationId,
    actor: 'human', baseRevision: snapshot.revision, mutation: { type: 'command', command: { type: 'markdown.replace', source } } })
  expect(result.status).toBe('applied')
}
function source(snapshot: DocumentSnapshot) {
  if (snapshot.model.kind !== 'text') throw new Error('Expected HTML source')
  return snapshot.model.source
}

it('reuses this accepted source preparation while retaining a strong post-save observation', async () => {
  const { host, opened } = await fixture()
  const next = source(opened).replace('original</h1>', 'saved</h1>')
  await edit(host, opened, next)
  const prepare = vi.spyOn(sourceResources, 'prepareDocumentSave')
  const snapshots = vi.spyOn(host.registry.get(opened.documentId), 'read')
  const saved = await host.internalAPI.save(opened.documentId)
  // One detached capture and one public result; routing and save facts do not
  // copy the whole source/resources merely to inspect binding or kind.
  expect(snapshots).toHaveBeenCalledTimes(2)
  expect(prepare).toHaveBeenCalledTimes(1)
  const observed = await host.internalAPI.observeFile(opened.documentId)
  expect(prepare).toHaveBeenCalledTimes(1)
  expect(observed.version).toBe(saved.binding.kind === 'file' ? saved.binding.version : undefined)
  expect(observed.model?.kind === 'text' && observed.model.source).toBe(next)
  expect(observed.model?.resources.assets['theme.css']).toBeDefined()
})

it('still captures external body, CSS, child-page and previously missing dependencies after a save', async () => {
  const { root, filename, host, opened } = await fixture()
  const next = source(opened).replace('original</h1>', 'saved</h1>')
  await edit(host, opened, next)
  await host.internalAPI.save(opened.documentId)
  const prepare = vi.spyOn(sourceResources, 'prepareDocumentSave')
  await fs.writeFile(path.join(root, 'theme.css'), 'h1{color:blue}')
  await fs.writeFile(path.join(root, 'child.html'), '<p>child external</p>')
  await fs.writeFile(path.join(root, 'missing.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>')
  const dependencies = await host.internalAPI.observeFile(opened.documentId)
  expect(prepare).toHaveBeenCalledTimes(1)
  expect(new TextDecoder().decode(dependencies.model!.resources.assets['theme.css'])).toBe('h1{color:blue}')
  expect(new TextDecoder().decode(dependencies.model!.resources.assets['child.html'])).toBe('<p>child external</p>')
  expect(dependencies.model!.resources.assets['missing.svg']).toBeDefined()
  await fs.writeFile(filename, next.replace('saved</h1>', 'external</h1>'))
  const body = await host.internalAPI.observeFile(opened.documentId)
  expect(prepare).toHaveBeenCalledTimes(2)
  expect(body.model?.kind === 'text' && body.model.source).toContain('external</h1>')
})

it('uses the captured saved revision rather than a newer teacher draft as the disk model', async () => {
  const { host, opened } = await fixture()
  const next = source(opened).replace('original</h1>', 'saved</h1>')
  await edit(host, opened, next)
  let continued: Promise<unknown> | undefined
  const stop = host.subscribeSaves(fact => {
    if (fact.status !== 'saving') return
    continued = host.internalAPI.dispatch({ documentId: opened.documentId, epoch: opened.epoch, operationId: 'continue-during-save',
      actor: 'human', baseRevision: fact.revision, mutation: { type: 'command', command: { type: 'markdown.splice', from: next.length, to: next.length, text: '\n<!-- teacher continues -->' } } })
  })
  const prepare = vi.spyOn(sourceResources, 'prepareDocumentSave')
  try {
    const saved = await host.internalAPI.save(opened.documentId)
    await continued
    expect(source(saved)).toContain('teacher continues')
    expect(saved.dirty).toBe(true)
    const observed = await host.internalAPI.observeFile(opened.documentId)
    expect(observed.model?.kind === 'text' && observed.model.source).toBe(next)
    expect(observed.baseSource).toBe(next)
    expect(prepare).toHaveBeenCalledTimes(1)
  } finally { stop() }
})

it('does not seed a failed publication with its unsaved source', async () => {
  const { filename, host, opened } = await fixture()
  const original = source(opened), next = original.replace('original</h1>', 'unsaved</h1>')
  await edit(host, opened, next)
  const rename = fs.rename.bind(fs)
  vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
    if (String(to) === filename) throw Object.assign(new Error('injected definite failure'), { code: 'EACCES' })
    return rename(from, to)
  })
  await expect(host.internalAPI.save(opened.documentId)).rejects.toThrow('injected definite failure')
  const observed = await host.internalAPI.observeFile(opened.documentId)
  expect(observed.model?.kind === 'text' && observed.model.source).toBe(original)
  expect((await host.internalAPI.read(opened.documentId)).dirty).toBe(true)
})


it.each(['html', 'md', 'txt'])('rejects mismatched %s source bytes before publishing the document', async extension => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'source-save-observation-')); roots.push(root)
  const filename = path.join(root, `mismatched.${extension}`)
  const journal = createDocumentJournal({ directory: path.join(root, 'journal') })
  await expect(journal.save({ documentId: 'mismatched-source', revision: 0,
    model: { kind: extension === 'md' ? 'markdown' : 'text', source: '<p>captured source</p>', resources: { assets: {}, components: {} } },
    binding: { kind: 'file', path: filename, version: null, bindingVersion: 1 },
    bytes: new TextEncoder().encode('<p>different bytes</p>'),
  })).rejects.toThrow('保存正文与固定文档版本不一致')
  await expect(fs.access(filename)).rejects.toMatchObject({ code: 'ENOENT' })
})
