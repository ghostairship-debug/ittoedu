// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { createDocumentJournal, type DocumentJournal } from '../../src/main/workbench/documentJournal'
import { readHtmlClosure } from '../../src/main/workbench/htmlImport/readHtmlClosure'
import type { DocumentResources } from '../../src/shared/workbench/document'

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('unexpected fixture path')
    await fs.rm(root, { recursive: true, force: true })
  }
})
const bytes = (value: string) => new TextEncoder().encode(value)
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { promise, resolve } }
async function fixture(source: string, files: Record<string, Uint8Array | string> = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guoling-current-source-')); roots.push(root)
  const original = path.join(root, 'original'), destination = path.join(root, 'copy'), journalDirectory = path.join(root, 'journal')
  await fs.mkdir(original); await fs.mkdir(destination)
  const filename = path.join(original, 'page.html')
  await fs.writeFile(filename, source)
  for (const [relative, value] of Object.entries(files)) {
    const target = path.join(original, relative)
    await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, value)
  }
  const host = new DocumentHostService(journalDirectory), snapshot = await host.open(filename)
  return { root, original, destination, filename, journalDirectory, host, documentId: snapshot.documentId, target: path.join(destination, 'page.html') }
}
async function edit(f: Awaited<ReturnType<typeof fixture>>, source: string, resources?: DocumentResources) {
  const current = await f.host.internalAPI.read(f.documentId)
  const result = await f.host.internalAPI.dispatch({ documentId: f.documentId, epoch: current.epoch, baseRevision: current.revision,
    operationId: `edit-${current.revision}`, actor: 'human', mutation: { type: 'command',
      command: { type: 'markdown.replace', source, ...(resources ? { resources } : {}) } } })
  expect(result.status).toBe('applied')
  return f.host.internalAPI.read(f.documentId)
}

describe('current source capture and exact publication', () => {
  it('saves the unsaved current HTML after its original directory disappears, and cold opens it', async () => {
    const f = await fixture('<!doctype html><p>disk source</p>')
    const source = '<!doctype html>\r\n<p>current author draft</p>\r\n'
    await edit(f, source)
    await fs.rm(f.original, { recursive: true })
    const saved = await f.host.saveWithFact(f.documentId, f.target)
    expect(saved.snapshot).toMatchObject({ revision: 1, dirty: false, binding: { path: f.target } })
    expect(await fs.readFile(f.target, 'utf8')).toBe(source)
    const cold = await new DocumentHostService(path.join(f.root, 'cold')).open(f.target)
    expect(cold.model).toMatchObject({ kind: 'text', source }); expect(cold.dirty).toBe(false)
    // An actual new import still requires its selected entry file.
    await expect(readHtmlClosure({ htmlPath: f.filename, sourceHtml: source })).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('retains referenced current CSS, modules and nested media without recapturing deleted source bytes', async () => {
    const source = '<link rel="stylesheet" href="css/main.css"><script type="module" src="js/main.js"></script><img src="images/hero.png">'
    const files = { 'css/main.css': '.hero{background-image:url(../images/background.png)}',
      'js/main.js': 'import { ready } from "./ready.js"; window.ready = ready;', 'js/ready.js': 'export const ready = true;',
      'images/hero.png': new Uint8Array([1, 2, 3]), 'images/background.png': new Uint8Array([4, 5, 6]) }
    const f = await fixture(source, files)
    const current = await f.host.internalAPI.read(f.documentId)
    expect(Object.keys(current.model.resources.assets).sort()).toEqual(Object.keys(files).sort())
    const next = source + '<p>teacher addition</p>'
    await edit(f, next, { assets: { ...current.model.resources.assets, 'unreferenced.png': bytes('history only') }, components: {} })
    await fs.rm(f.original, { recursive: true })
    const readFile = fs.readFile.bind(fs), sourceReads: string[] = []
    vi.spyOn(fs, 'readFile').mockImplementation(((filename: Parameters<typeof fs.readFile>[0], ...rest: unknown[]) => {
      if (String(filename).startsWith(f.original + path.sep)) sourceReads.push(String(filename))
      return (readFile as (...args: unknown[]) => Promise<unknown>)(filename, ...rest)
    }) as typeof fs.readFile)
    await f.host.saveToPath(f.documentId, f.target)
    expect(sourceReads).toEqual([])
    expect(await fs.readFile(f.target, 'utf8')).toBe(next)
    for (const [relative, value] of Object.entries(files)) expect(await fs.readFile(path.join(f.destination, relative))).toEqual(Buffer.from(typeof value === 'string' ? bytes(value) : value))
    await expect(fs.access(path.join(f.destination, 'unreferenced.png'))).rejects.toMatchObject({ code: 'ENOENT' })
    const cold = await new DocumentHostService(path.join(f.root, 'cold')).open(f.target)
    expect(Object.keys(cold.model.resources.assets).sort()).toEqual(Object.keys(files).sort())
  })

  it('captures a newly referenced already-open stylesheet before disk, including its current nested dependency', async () => {
    const f = await fixture('<p>start</p>', { 'theme.css': '.old{color:red}', 'new.png': bytes('new image') })
    const stylesheet = await f.host.open(path.join(f.original, 'theme.css'))
    await f.host.internalAPI.dispatch({ documentId: stylesheet.documentId, epoch: stylesheet.epoch, baseRevision: stylesheet.revision,
      operationId: 'style-edit', actor: 'human', mutation: { type: 'command',
        command: { type: 'markdown.replace', source: '.new{background-image:url(new.png)}' } } })
    await edit(f, '<link rel="stylesheet" href="theme.css"><p>current body</p>')
    await fs.rm(path.join(f.original, 'theme.css'))
    await f.host.saveToPath(f.documentId, f.target)
    expect(await fs.readFile(path.join(f.destination, 'theme.css'), 'utf8')).toBe('.new{background-image:url(new.png)}')
    expect(await fs.readFile(path.join(f.destination, 'new.png'), 'utf8')).toBe('new image')
    expect((await f.host.internalAPI.read(stylesheet.documentId)).dirty).toBe(true)
  })

  it('preserves original dangling and remote references while reporting the unresolved local dependency', async () => {
    const source = '<img src="missing.png"><img src="https://example.invalid/remote.png"><p>kept source</p>'
    const f = await fixture(source)
    const saved = await f.host.saveWithFact(f.documentId, f.target)
    expect(saved.snapshot.dirty).toBe(false)
    expect(saved.warnings.some(message => message.includes('missing.png'))).toBe(true)
    expect(await fs.readFile(f.target, 'utf8')).toBe(source)
    await expect(fs.access(path.join(f.destination, 'missing.png'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps the real target resource conflict and leaves the current draft and target bytes intact', async () => {
    const f = await fixture('<img src="hero.png">', { 'hero.png': bytes('held author image') })
    await edit(f, '<img src="hero.png"><p>unsaved author change</p>')
    await fs.writeFile(path.join(f.destination, 'hero.png'), 'another document image')
    await expect(f.host.saveToPath(f.documentId, f.target)).rejects.toMatchObject({ publication: 'not-published', code: 'resource-conflict' })
    expect((await f.host.internalAPI.read(f.documentId)).dirty).toBe(true)
    expect(await fs.readFile(path.join(f.destination, 'hero.png'), 'utf8')).toBe('another document image')
    await expect(fs.access(f.target)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('acknowledges only r and keeps an r+1 source and resource edit dirty', async () => {
    const f = await fixture('<img src="hero.png"><p>original</p>', { 'hero.png': bytes('r resource') })
    await edit(f, '<img src="hero.png"><p>r source</p>')
    const journal = (f.host as unknown as { journal: DocumentJournal }).journal
    const prepare = journal.prepareSave!.bind(journal), entered = deferred(), release = deferred()
    vi.spyOn(journal, 'prepareSave').mockImplementation(async input => { const prepared = await prepare(input); entered.resolve(); await release.promise; return prepared })
    const saving = f.host.saveWithFact(f.documentId, f.target); await entered.promise
    await edit(f, '<img src="hero.png"><p>r+1 source</p>', { assets: { 'hero.png': bytes('r+1 resource') }, components: {} })
    release.resolve()
    const saved = await saving
    expect(saved.savedRevision).toBe(1)
    expect(saved.snapshot).toMatchObject({ revision: 2, dirty: true, model: { source: expect.stringContaining('r+1 source') } })
    expect(saved.snapshot.model.resources.assets['hero.png']).toEqual(bytes('r+1 resource'))
    expect(await fs.readFile(f.target, 'utf8')).toContain('r source')
    expect(await fs.readFile(path.join(f.destination, 'hero.png'), 'utf8')).toBe('r resource')
  })

  it('does not acknowledge a publication whose carried image changed after the body rename', async () => {
    const f = await fixture('<img src="hero.png"><p>original</p>', { 'hero.png': bytes('author image') })
    await edit(f, '<img src="hero.png"><p>current draft</p>')
    const identity = { runId: 'source-save-run', operationId: 'save-once', requestDigest: 'save-current-source' }
    const rename = fs.rename.bind(fs)
    vi.spyOn(fs, 'rename').mockImplementation(async (source, target) => {
      await rename(source, target)
      if (String(target) === f.filename) await fs.writeFile(path.join(f.original, 'hero.png'), 'external image after publication')
    })
    await expect(f.host.saveWithFact(f.documentId, undefined, identity)).rejects.toMatchObject({ publication: 'unknown', code: 'resource-conflict' })
    expect((await f.host.internalAPI.read(f.documentId))).toMatchObject({ revision: 1, dirty: true, model: { source: expect.stringContaining('current draft') } })
    expect(await f.host.lookupSave(f.documentId, identity)).toBeNull()
    const recovered = await createDocumentJournal({ directory: f.journalDirectory }).recover(f.documentId)
    expect(recovered).toMatchObject({ savedRevision: 0, revision: 1, model: { source: expect.stringContaining('current draft') } })
    expect(await fs.readFile(path.join(f.original, 'hero.png'), 'utf8')).toBe('external image after publication')
  })
})
