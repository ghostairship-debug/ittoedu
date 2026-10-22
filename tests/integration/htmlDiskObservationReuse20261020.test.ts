// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import * as sourceResources from '../../src/main/workbench/documentSourceResources'
import * as htmlAnalysis from '../../src/main/workbench/htmlImport/htmlResourceAnalysis'
import { createHtmlPreviewResourceCollector } from '../../src/main/workbench/htmlPreview/htmlPreviewResources'

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true })
})
async function setup(source: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'html-observation-')); roots.push(root)
  const filename = path.join(root, 'lesson.html')
  await fs.writeFile(filename, source)
  return { root, filename, host: new DocumentHostService(path.join(root, 'journal')) }
}

it('reuses the last HTML disk model without reanalyzing unchanged source, while keeping dirty edits and external changes distinct', async () => {
  const source = '<!doctype html><p>Disk source</p><script>window.items=[1,2,3]</script>'
  const { filename, host } = await setup(source)
  const capture = vi.spyOn(sourceResources, 'prepareDocumentSave')
  const opened = await host.open(filename)
  expect(capture).toHaveBeenCalledTimes(1)
  await host.internalAPI.dispatch({ documentId: opened.documentId, epoch: opened.epoch, baseRevision: opened.revision,
    operationId: 'dirty-html', actor: 'human', mutation: { type: 'command', command: { type: 'markdown.replace', source: '<p>Unsaved edit</p>' } } })
  for (let index = 0; index < 2; index++) {
    expect(await host.observeFile(opened.documentId)).toMatchObject({ version: opened.binding.kind === 'file' ? opened.binding.version : null,
      model: { kind: 'text', source }, baseSource: source })
  }
  expect(capture).toHaveBeenCalledTimes(1)
  expect(host.registry.get(opened.documentId).read()).toMatchObject({ dirty: true, model: { source: '<p>Unsaved edit</p>' } })
  await fs.writeFile(filename, '<p>External edit</p>')
  expect(await host.observeFile(opened.documentId)).toMatchObject({ model: { source: '<p>External edit</p>' } })
  expect(capture).toHaveBeenCalledTimes(2)
  await host.observeFile(opened.documentId)
  expect(capture).toHaveBeenCalledTimes(2)
  await fs.unlink(filename)
  expect(await host.observeFile(opened.documentId)).toMatchObject({ version: null, model: null })
})

it('invalidates the HTML disk projection when a held dependency changes or a previously missing dependency appears', async () => {
  const { root, filename, host } = await setup('<!doctype html><link rel="stylesheet" href="theme.css"><img src="missing.png"><p>Lesson</p>')
  await fs.writeFile(path.join(root, 'theme.css'), 'p{color:red}')
  const capture = vi.spyOn(sourceResources, 'prepareDocumentSave')
  const opened = await host.open(filename)
  await host.observeFile(opened.documentId)
  expect(capture).toHaveBeenCalledTimes(1)
  await fs.writeFile(path.join(root, 'theme.css'), 'p{color:blue}')
  const changed = await host.observeFile(opened.documentId)
  expect(capture).toHaveBeenCalledTimes(2)
  expect(new TextDecoder().decode(changed.model?.resources.assets['theme.css'])).toBe('p{color:blue}')
  await fs.writeFile(path.join(root, 'missing.png'), new Uint8Array([1, 2, 3]))
  const arrived = await host.observeFile(opened.documentId)
  expect(capture).toHaveBeenCalledTimes(3)
  expect(Array.from(arrived.model?.resources.assets['missing.png'] ?? [])).toEqual([1, 2, 3])
  await host.observeFile(opened.documentId)
  expect(capture).toHaveBeenCalledTimes(3)
})

it('keeps discovering new images when a program depends on directory membership', async () => {
  const { root, filename, host } = await setup('<script>const P="pictures/";target.innerHTML=`<img src="${P+file}">`;</script>')
  await fs.mkdir(path.join(root, 'pictures'))
  await fs.writeFile(path.join(root, 'pictures', 'one.png'), new Uint8Array([1, 2, 3]))
  const opened = await host.open(filename)
  await fs.writeFile(path.join(root, 'pictures', 'two.png'), new Uint8Array([4, 5, 6]))
  const observed = await host.observeFile(opened.documentId)
  expect(Object.keys(observed.model?.resources.assets ?? {}).sort()).toEqual(['pictures/one.png', 'pictures/two.png'])
})

it('uses the same Session preparation for first preview and rejects its grants after a dependency changes', async () => {
  const source = '<link rel="stylesheet" href="theme.css"><p>Lesson</p>'
  const { root, filename, host } = await setup(source)
  await fs.writeFile(path.join(root, 'theme.css'), 'p{background:url(https://media.example/first.png)}')
  const analyze = vi.spyOn(htmlAnalysis, 'analyzeHtmlResources')
  const opened = await host.open(filename)
  const prepared = analyze.mock.calls.length
  expect(prepared).toBeGreaterThan(0)
  const collect = createHtmlPreviewResourceCollector((html, directory) => host.readCapturedHtmlPreviewSources(opened.documentId, html, directory))
  expect(await collect(source, root)).toContainEqual({ url: 'https://media.example/first.png', usage: 'image' })
  expect(analyze).toHaveBeenCalledTimes(prepared)
  expect(await collect(source, root)).toContainEqual({ url: 'https://media.example/first.png', usage: 'image' })
  expect(analyze).toHaveBeenCalledTimes(prepared)
  await fs.writeFile(path.join(root, 'theme.css'), 'p{background:url(https://media.example/changed.png)}')
  expect(await host.readCapturedHtmlPreviewSources(opened.documentId, source, root)).toBeUndefined()
  const changed = await collect(source, root)
  expect(changed).toContainEqual({ url: 'https://media.example/changed.png', usage: 'image' })
  expect(changed).not.toContainEqual({ url: 'https://media.example/first.png', usage: 'image' })
})
