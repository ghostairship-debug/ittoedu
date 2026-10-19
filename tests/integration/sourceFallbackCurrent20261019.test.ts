// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { readComponentProjectFileInput } from '../../src/main/workbench/projectFiles/componentPlatformFileInput'
import { readHtmlClosure } from '../../src/main/workbench/htmlImport/readHtmlClosure'

const roots: string[] = [], encode = (text: string) => new TextEncoder().encode(text), decode = (bytes?: Uint8Array) => new TextDecoder().decode(bytes)
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('unexpected fixture path')
    await fs.rm(root, { recursive: true, force: true })
  }
})
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guoling-source-fallback-')); roots.push(root)
  const source = path.join(root, 'source'); await fs.mkdir(source)
  const host = new DocumentHostService(path.join(root, 'journal'))
  const currentSource = async (filename: string) => {
    const snapshot = await host.readOpenedSource(filename)
    return snapshot?.model.kind === 'text' || snapshot?.model.kind === 'markdown' ? snapshot.model.source : undefined
  }
  const open = async (name: string, disk: string, current = disk) => {
    const filename = path.join(source, name)
    await fs.mkdir(path.dirname(filename), { recursive: true }); await fs.writeFile(filename, disk)
    const snapshot = await host.open(filename)
    if (current !== disk) expect(await host.internalAPI.dispatch({ documentId: snapshot.documentId, epoch: snapshot.epoch,
      baseRevision: snapshot.revision, operationId: `edit-${name}`, actor: 'human', mutation: { type: 'command',
        command: { type: 'markdown.replace', source: current } } })).toMatchObject({ status: 'applied' })
    return filename
  }
  return { root, source, host, currentSource, open }
}

it('admits the current open HTML and deleted open dependencies while keeping nested local media', async () => {
  const f = await fixture()
  const html = '<link rel="stylesheet" href="styles/main.css"><script type="module" src="main.js"></script><p>current author draft</p>'
  const css = '.current{background-image:url(../images/hero.svg)}', js = 'export const current = 42;'
  const entry = await f.open('page.html', '<p>disk draft</p>', html)
  const stylesheet = await f.open('styles/main.css', '.disk{color:red}', css)
  const script = await f.open('main.js', 'export const disk = 1;', js)
  await fs.mkdir(path.join(f.source, 'images')); await fs.writeFile(path.join(f.source, 'images/hero.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
  await fs.rm(entry); await fs.rm(stylesheet); await fs.rm(script)
  const input = await readComponentProjectFileInput({ from: entry,
    fileAccess: { permission: 'workspace', workspaceRoot: f.source }, currentSource: f.currentSource })
  expect(input.text).toBe(html); expect(decode(input.bytes)).toBe(html)
  expect(decode(input.siblingFiles?.get('styles/main.css'))).toBe(css)
  expect(decode(input.siblingFiles?.get('main.js'))).toBe(js)
  expect(decode(input.siblingFiles?.get('images/hero.svg'))).toContain('<svg')
  expect(input.diagnostics?.some(issue => issue.level === 'error' || issue.code === 'missing-relative-resource')).toBe(false)
  // A body alone does not turn an unknown missing path into an opened binding.
  await expect(readHtmlClosure({ htmlPath: entry, rootDir: f.source, sourceHtml: html })).rejects.toMatchObject({ code: 'ENOENT' })
})

it('captures current JS after its original directory disappears and reports the unopened missing import', async () => {
  const f = await fixture()
  const text = 'import { value } from "./helper.js"; import "./missing.js"; export { value };'
  const entry = await f.open('main.js', 'export const disk = 1;', text)
  await f.open('helper.js', 'export const value = 1;', 'export const value = 42;')
  await fs.rm(f.source, { recursive: true })
  const input = await readComponentProjectFileInput({ from: entry,
    fileAccess: { permission: 'workspace', workspaceRoot: f.source }, currentSource: f.currentSource })
  expect(input.sourceEntry).toBe('main.js'); expect(input.text).toBe(text)
  expect(decode(input.siblingFiles?.get('helper.js'))).toBe('export const value = 42;')
  expect(input.siblingFiles?.has('missing.js')).toBe(false)
  expect(input.diagnostics).toContainEqual(expect.objectContaining({ code: 'missing-source-dependency', reference: './missing.js', repairable: true,
    message: expect.stringContaining('main.js') }))
})

it('keeps missing dependency diagnostics alongside healthy HTML content and current dependencies', async () => {
  const f = await fixture()
  const entry = await f.open('page.html', '<p>usable</p><link rel="stylesheet" href="current.css"><img src="missing.svg">')
  const css = await f.open('current.css', '.disk{}', '.current{color:green}')
  await fs.rm(css)
  const input = await readComponentProjectFileInput({ from: entry,
    fileAccess: { permission: 'workspace', workspaceRoot: f.source }, currentSource: f.currentSource })
  expect(input.text).toContain('<p>usable</p>')
  expect(decode(input.siblingFiles?.get('current.css'))).toBe('.current{color:green}')
  expect(input.diagnostics).toContainEqual(expect.objectContaining({ reference: 'missing.svg', repairable: true, code: 'missing-relative-resource' }))
})

it('does not ask an open-source callback for missing files behind an external junction unless full access authorizes it', async () => {
  const f = await fixture(), outside = path.join(f.root, 'outside'); await fs.mkdir(outside)
  await fs.symlink(outside, path.join(f.source, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
  const outsideName = path.join(outside, 'missing.js'), reads: string[] = []
  const currentSource = async (filename: string) => { reads.push(filename); return filename === outsideName ? 'export const value = 42;' : undefined }
  const entry = path.join(f.source, 'main.js'); await fs.writeFile(entry, 'import "./escape/missing.js";')
  const input = await readComponentProjectFileInput({ from: entry,
    fileAccess: { permission: 'workspace', workspaceRoot: f.source }, currentSource })
  expect(reads).toEqual([entry]); expect(input.siblingFiles?.size).toBe(1)
  expect(input.diagnostics).toContainEqual(expect.objectContaining({ reference: './escape/missing.js', code: 'missing-source-dependency' }))
  await expect(readComponentProjectFileInput({ from: path.join(f.source, 'escape/missing.js'),
    fileAccess: { permission: 'workspace', workspaceRoot: f.source }, currentSource })).rejects.toThrow('授权工作空间外')
  const full = await readComponentProjectFileInput({ from: path.join(f.source, 'escape/missing.js'),
    fileAccess: { permission: 'full', workspaceRoot: f.source }, currentSource })
  expect(full.filename).toBe(outsideName); expect(full.bytes).toEqual(encode('export const value = 42;'))
})
