import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { strToU8, zipSync } from 'fflate'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const catalogPath = path.join(repositoryRoot, 'catalog.json')
const reproducibleTimestamp = new Date('2026-08-10T00:00:00.000Z')
const checkOnly = process.argv.includes('--check')
const specs = [
  ['components/language/reading-annotation', 'packages/reading-annotation.h5component'],
  ['components/language/pinyin-annotation', 'packages/pinyin-annotation.h5component'],
  ['components/visual/text-container', 'packages/text-container.h5component'],
  ['components/visual/image-frame', 'packages/image-frame.h5component'],
]

function safeRelativePath(value) {
  const normalized = String(value).replaceAll('\\', '/')
  if (!normalized || normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized)
    || normalized.split('/').some(part => !part || part === '.' || part === '..')) throw new Error(`不安全的组件相对路径：${value}`)
  return normalized
}

/** These are authored V10 library manifests. The build only assembles their declared source files. */
async function buildOne([sourceDirectory, outputPath]) {
  const sourceRoot = path.join(repositoryRoot, sourceDirectory)
  const manifest = JSON.parse(await fs.readFile(path.join(sourceRoot, 'manifest.json'), 'utf8'))
  const files = { 'manifest.json': strToU8(`${JSON.stringify(manifest, null, 2)}\n`) }
  for (const [name, archivePath] of Object.entries(manifest.resources.assets)) {
    files[safeRelativePath(archivePath)] = Uint8Array.from(await fs.readFile(path.join(sourceRoot, safeRelativePath(name))))
  }
  for (const resources of Object.values(manifest.resources.components)) {
    for (const [name, archivePath] of Object.entries(resources)) {
      files[safeRelativePath(archivePath)] = Uint8Array.from(await fs.readFile(path.join(sourceRoot, safeRelativePath(name))))
    }
  }
  const archive = zipSync(files, { level: 9, mtime: reproducibleTimestamp })
  const sha256 = createHash('sha256').update(archive).digest('hex')
  const output = path.join(repositoryRoot, outputPath)
  if (checkOnly) {
    if (createHash('sha256').update(await fs.readFile(output)).digest('hex') !== sha256) throw new Error(`${outputPath} 不是当前源码的可重现制品`)
  } else {
    await fs.mkdir(path.dirname(output), { recursive: true })
    await fs.writeFile(output, archive)
  }
  return { manifest, outputPath, sha256 }
}

const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8'))
for (const spec of specs) {
  const result = await buildOne(spec)
  const entry = catalog.packages.find(candidate => candidate.packageId === result.manifest.entry.id && candidate.version === result.manifest.version)
  if (!entry || entry.packagePath !== result.outputPath) throw new Error(`目录缺少 ${result.manifest.entry.id}@${result.manifest.version} 的构建条目`)
  if (checkOnly) {
    if (entry.sha256 !== result.sha256) throw new Error(`${entry.packageId} 的目录 SHA-256 过期`)
  } else entry.sha256 = result.sha256
}
if (!checkOnly) await fs.writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8')
console.log(`${checkOnly ? '已验证' : '已构建'} ${specs.length} 个 Component API 5 组件`)
