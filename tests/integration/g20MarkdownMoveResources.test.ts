// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { prepareMarkdownMoveResources } from '../../src/main/workbench/markdownMoveResources'
import { readDocumentFileVersion } from '../../src/main/workbench/documentJournal'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected fixture directory')
    await fs.rm(root, { recursive: true, force: true })
  }
})
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-md-move-'))
  roots.push(root)
  const from = path.join(root, 'from'), to = path.join(root, 'to')
  await fs.mkdir(from); await fs.mkdir(to)
  const source = path.join(from, 'lesson.md'), target = path.join(to, 'lesson.md')
  const put = async (relative: string, value: string, directory = from) => {
    const filename = path.join(directory, relative)
    await fs.mkdir(path.dirname(filename), { recursive: true }); await fs.writeFile(filename, value)
  }
  await put('assets/a.png', 'image-a'); await put('assets/b.png', 'image-b')
  await put('components/demo/index.js', 'export default 1'); await put('components/demo/nested/style.css', '.demo{}')
  await put('components/other/index.js', 'export default 2')
  const body = '![A](assets/a.png)\n![B](assets/b.png)\n```cw-object-v1\n' + JSON.stringify({ resources: { components: [
    { source: { kind: 'relative', path: 'components/demo' } }, { source: { kind: 'relative', path: 'components/other' } },
  ] } }) + '\n```\n'
  await fs.writeFile(source, body)
  return { root, from, to, source, target, body, put }
}
describe('Markdown move resource preparation', () => {
  it('prepares relative images and complete packages, preserves sources and reopens after the caller moves only Markdown', async () => {
    const f = await fixture()
    await f.put('assets/a.png', 'image-a', f.to) // Existing identical resources are reused.
    const original = await fs.stat(path.join(f.to, 'assets/a.png'))
    const prepared = await prepareMarkdownMoveResources(f.source, f.target)
    expect(prepared.sourceVersion).toBe(await readDocumentFileVersion(f.source, 'markdown'))
    expect((await fs.stat(path.join(f.to, 'assets/a.png'))).ino).toBe(original.ino)
    expect(await fs.readFile(f.source, 'utf8')).toBe(f.body)
    await expect(fs.access(f.target)).rejects.toMatchObject({ code: 'ENOENT' })
    await fs.rename(f.source, f.target)
    const host = new DocumentHostService(path.join(f.root, 'journal'))
    const reopened = await host.internalAPI.open(f.target)
    expect(reopened.model).toMatchObject({ kind: 'markdown', source: f.body })
    expect(Buffer.from(reopened.model.resources.assets['assets/a.png']!).toString()).toBe('image-a')
    expect(Object.keys(reopened.model.resources.components['components/demo']!)).toEqual(['index.js', 'nested/style.css'])
    expect(Buffer.from(reopened.model.resources.components['components/demo']!['nested/style.css']!).toString()).toBe('.demo{}')
    expect(await fs.readFile(path.join(f.from, 'assets/a.png'), 'utf8')).toBe('image-a')
    expect(await fs.readFile(path.join(f.from, 'components/demo/index.js'), 'utf8')).toBe('export default 1')
  })
  it('rejects collisions, escaping references and symlink destinations before preparing any resource', async () => {
    const f = await fixture()
    await f.put('assets/b.png', 'user original', f.to)
    await expect(prepareMarkdownMoveResources(f.source, f.target)).rejects.toMatchObject({ code: 'resource-conflict' })
    expect(await fs.readFile(path.join(f.to, 'assets/b.png'), 'utf8')).toBe('user original')
    await expect(fs.access(path.join(f.to, 'assets/a.png'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await fs.readdir(f.to)).toEqual(['assets'])
    await fs.writeFile(f.source, '![escape](../external.png)')
    await expect(prepareMarkdownMoveResources(f.source, f.target)).rejects.toThrow()
    await fs.writeFile(f.source, f.body)
    const linkedTarget = path.join(f.root, 'linked'); await fs.mkdir(linkedTarget)
    const actual = path.join(linkedTarget, 'actual'); await fs.mkdir(actual)
    await fs.symlink(actual, path.join(linkedTarget, 'assets'), process.platform === 'win32' ? 'junction' : 'dir')
    await expect(prepareMarkdownMoveResources(f.source, path.join(linkedTarget, 'lesson.md'))).rejects.toThrow('符号链接')
    expect(await fs.readdir(actual)).toEqual([])
    expect(await fs.readFile(f.source, 'utf8')).toBe(f.body)
  })
  it('cleans an interrupted preparation and rolls back only resources whose identity and complete package are unchanged', async () => {
    const f = await fixture(), link = fs.link.bind(fs)
    let links = 0
    vi.spyOn(fs, 'link').mockImplementation(async (from, to) => { if (++links === 2) throw new Error('injected publication failure'); await link(from, to) })
    await expect(prepareMarkdownMoveResources(f.source, f.target)).rejects.toThrow('injected publication failure')
    vi.restoreAllMocks()
    expect(await fs.readdir(f.to)).toEqual([])
    expect(await fs.readFile(f.source, 'utf8')).toBe(f.body)
    const clean = await prepareMarkdownMoveResources(f.source, f.target)
    await clean.rollback(); await clean.rollback()
    expect(await fs.readdir(f.to)).toEqual([])
    const changed = await prepareMarkdownMoveResources(f.source, f.target)
    await fs.writeFile(path.join(f.to, 'assets/a.png'), 'later user write')
    await f.put('components/demo/user.txt', 'later user addition', f.to)
    await changed.rollback()
    expect(await fs.readFile(path.join(f.to, 'assets/a.png'), 'utf8')).toBe('later user write')
    expect(await fs.readFile(path.join(f.to, 'components/demo/index.js'), 'utf8')).toBe('export default 1')
    expect(await fs.readFile(path.join(f.to, 'components/demo/user.txt'), 'utf8')).toBe('later user addition')
    await expect(fs.access(path.join(f.to, 'assets/b.png'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.access(path.join(f.to, 'components/other'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await fs.readdir(f.to)).some(name => name.startsWith('.guoling'))).toBe(false)
  })
})
