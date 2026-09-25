import { createHash, randomUUID } from 'node:crypto'
import { promises as fs, type Stats } from 'node:fs'
import path from 'node:path'
import { DocumentJournalError, markdownReferences, readDocumentFileVersion, readDocumentMarkdownResources, resourcePath } from './documentJournal'

const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const key = (filename: string) => process.platform === 'win32' ? filename.toLowerCase() : filename
const sameIdentity = (a: Stats, b: Stats) => a.dev === b.dev && a.ino === b.ino && a.birthtimeMs === b.birthtimeMs
type Owned = { filename: string; stat: Stats; digest?: string }
type Package = { relative: string; target: string; files: Record<string, Uint8Array>; prepared?: string; owned?: Owned[] }

async function stat(filename: string): Promise<Stats | null> {
  try { return await fs.lstat(filename) } catch (error) { if (missing(error)) return null; throw error }
}
async function tree(directory: string): Promise<Owned[]> {
  const root = await fs.lstat(directory)
  if (root.isSymbolicLink() || !root.isDirectory()) throw new Error('组件附件必须是普通目录')
  const result: Owned[] = [{ filename: directory, stat: root }]
  for (const entry of await fs.readdir(directory)) {
    const filename = path.join(directory, entry), info = await fs.lstat(filename)
    if (info.isSymbolicLink()) throw new Error('组件附件不能包含符号链接')
    if (info.isDirectory()) result.push(...await tree(filename))
    else if (info.isFile()) result.push({ filename, stat: info, digest: hash(await fs.readFile(filename)) })
    else throw new Error('附件不是普通文件')
  }
  return result
}
async function unchanged(item: Owned): Promise<boolean> {
  const current = await stat(item.filename)
  return Boolean(current && !current.isSymbolicLink() && sameIdentity(item.stat, current)
    && (item.digest === undefined ? current.isDirectory() : current.isFile() && hash(await fs.readFile(item.filename)) === item.digest))
}
async function removeOwned(items: Owned[]): Promise<void> {
  for (const item of [...items].reverse()) {
    if (!await unchanged(item)) continue
    try { if (item.digest === undefined) await fs.rmdir(item.filename); else await fs.unlink(item.filename) }
    catch (error) { if (!missing(error) && !['ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error }
  }
}

/** Prepares immutable sidecars only. The caller owns the file-operation lock and Markdown rename. */
export async function prepareMarkdownMoveResources(sourcePath: string, targetPath: string): Promise<{ sourceVersion: string; rollback(): Promise<void> }> {
  const source = path.resolve(sourcePath), target = path.resolve(targetPath)
  for (const filename of [source, target]) {
    const volume = path.parse(filename).root
    await resourcePath(volume, path.relative(volume, filename).split(path.sep).join('/'), { rejectSymlinks: true })
  }
  const sourceInfo = await fs.lstat(source)
  if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink()) throw new Error('移动源必须是普通 Markdown 文件')
  const sourceRoot = await fs.realpath(path.dirname(source)), targetRoot = await fs.realpath(path.dirname(target))
  const sourceVersion = await readDocumentFileVersion(source, 'markdown')
  if (sourceVersion === null) throw new Error('移动源文件已不存在')
  const references = await markdownReferences(await fs.readFile(source, 'utf8'))
  for (const relative of references) await resourcePath(sourceRoot, relative, { rejectSymlinks: true })
  const resources = await readDocumentMarkdownResources(source)
  const packageNames = Object.keys(resources.components).filter(relative => !Object.keys(resources.components).some(other => other !== relative && relative.startsWith(`${other}/`)))
  const packages: Package[] = []
  const files: { relative: string; target: string; bytes: Uint8Array; prepared?: string }[] = []
  const conflict = () => new DocumentJournalError('resource-conflict', '移动目标已有不同附件，源文件和原附件已保留')
  const checkedPath = async (relative: string) => {
    const filename = await resourcePath(targetRoot, relative, { rejectSymlinks: true })
    if (key(filename) === key(target)) throw conflict()
    return filename
  }
  // All destinations and complete existing packages are checked before creating anything.
  for (const relative of packageNames) {
    const filename = await checkedPath(relative), entries = resources.components[relative]!
    for (const child of Object.keys(entries)) {
      await resourcePath(sourceRoot, `${relative}/${child}`, { rejectSymlinks: true })
      await checkedPath(`${relative}/${child}`)
    }
    const existing = await stat(filename)
    if (existing) {
      const actual = (await tree(filename)).filter(item => item.digest !== undefined)
      if (actual.length !== Object.keys(entries).length || actual.some(item => {
        const bytes = entries[path.relative(filename, item.filename).split(path.sep).join('/')]
        return !bytes || hash(bytes) !== item.digest
      })) throw conflict()
    } else packages.push({ relative, target: filename, files: entries })
  }
  for (const [relative, bytes] of Object.entries(resources.assets)) {
    if (packageNames.some(directory => relative.startsWith(`${directory}/`))) continue
    const filename = await checkedPath(relative), existing = await stat(filename)
    if (existing) {
      if (!existing.isFile() || hash(await fs.readFile(filename)) !== hash(bytes)) throw conflict()
    } else files.push({ relative, target: filename, bytes })
  }
  if (await readDocumentFileVersion(source, 'markdown') !== sourceVersion) throw new DocumentJournalError('file-conflict', '移动准备期间源文档或附件已改变')

  const created: Owned[] = [], staging: Owned[] = []
  let rolledBack = false
  const rollback = async () => {
    if (rolledBack) return
    // Withdraw a complete unchanged package atomically; never dismantle a package changed by another writer.
    for (const bundle of [...packages].reverse()) {
      if (!bundle.owned || !await stat(bundle.target)) continue
      const current = await tree(bundle.target).catch(() => [])
      if (current.length !== bundle.owned.length || !await Promise.all(bundle.owned.map(unchanged)).then(checks => checks.every(Boolean))) continue
      const withdrawn = path.join(targetRoot, `.guoling-move-rollback-${randomUUID()}`)
      await fs.rename(bundle.target, withdrawn)
      await removeOwned(bundle.owned.map(item => ({ ...item, filename: path.join(withdrawn, path.relative(bundle.target, item.filename)) })))
    }
    await removeOwned(created)
    await removeOwned(staging)
    rolledBack = true
  }
  const ensureDirectory = async (directory: string, owned: Owned[]) => {
    const relative = path.relative(targetRoot, directory).split(path.sep).join('/')
    if (!relative) return
    await resourcePath(targetRoot, relative, { rejectSymlinks: true })
    let current = targetRoot
    for (const part of relative.split('/')) {
      current = path.join(current, part)
      const existing = await stat(current)
      if (existing) { if (!existing.isDirectory() || existing.isSymbolicLink()) throw conflict(); continue }
      await fs.mkdir(current)
      owned.push({ filename: current, stat: await fs.lstat(current) })
    }
  }
  const write = async (filename: string, bytes: Uint8Array) => {
    const handle = await fs.open(filename, 'wx')
    // Register before write so an interrupted/partial staging write is still cleaned up.
    const item: Owned = { filename, stat: await handle.stat(), digest: hash(new Uint8Array()) }
    staging.push(item)
    try { await handle.writeFile(bytes); await handle.sync() }
    finally {
      try { item.digest = hash(await fs.readFile(filename)) } finally { await handle.close() }
    }
  }
  try {
    if (!files.length && !packages.length) return { sourceVersion, rollback }
    const stage = await fs.mkdtemp(path.join(targetRoot, '.guoling-move-'))
    staging.push({ filename: stage, stat: await fs.lstat(stage) })
    for (const [index, item] of files.entries()) {
      item.prepared = path.join(stage, `asset-${index}`)
      await write(item.prepared, item.bytes)
    }
    for (const [index, bundle] of packages.entries()) {
      bundle.prepared = path.join(stage, `package-${index}`)
      await ensureDirectory(bundle.prepared, staging)
      for (const [relative, bytes] of Object.entries(bundle.files)) {
        const filename = path.join(bundle.prepared, relative)
        await ensureDirectory(path.dirname(filename), staging)
        await write(filename, bytes)
      }
    }
    for (const item of files) {
      await ensureDirectory(path.dirname(item.target), created)
      await checkedPath(item.relative)
      try {
        await fs.link(item.prepared!, item.target)
        created.push({ filename: item.target, stat: await fs.lstat(item.target), digest: hash(item.bytes) })
      } catch (error) {
        const existing = await stat(item.target)
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || !existing?.isFile() || existing.isSymbolicLink() || hash(await fs.readFile(item.target)) !== hash(item.bytes)) throw error
      }
    }
    for (const bundle of packages) {
      await ensureDirectory(path.dirname(bundle.target), created)
      await checkedPath(bundle.relative)
      if (await stat(bundle.target)) throw conflict()
      const owned = await tree(bundle.prepared!)
      await fs.rename(bundle.prepared!, bundle.target)
      bundle.owned = owned.map(item => ({ ...item, filename: path.join(bundle.target, path.relative(bundle.prepared!, item.filename)) }))
    }
    if (await readDocumentFileVersion(source, 'markdown') !== sourceVersion) throw new DocumentJournalError('file-conflict', '移动准备期间源文档或附件已改变')
    await removeOwned(staging)
    return { sourceVersion, rollback }
  } catch (error) {
    try { await rollback() } catch (cleanupError) { throw new AggregateError([error, cleanupError], '移动资源准备失败，清理未完成') }
    throw error
  }
}
