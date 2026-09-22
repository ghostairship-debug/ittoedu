import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { strToU8, zipSync } from 'fflate'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packagesRoot = path.join(repositoryRoot, 'packages')
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
  if (
    !normalized ||
    normalized.startsWith('/') ||
    /^[a-zA-Z]:\//.test(normalized) ||
    normalized.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error(`不安全的组件相对路径：${value}`)
  }
  return normalized
}

function assertManifest(manifest, sourceDirectory) {
  if (manifest?.schemaVersion !== 4 || manifest?.runtimeApiVersion !== 4) {
    throw new Error(`${sourceDirectory} 不是 Component Schema 4 / Runtime API 4`)
  }
  if (!['dom', 'phaser', 'hybrid'].includes(manifest.renderMode)) {
    throw new Error(`${sourceDirectory} 的 renderMode 无效`)
  }
  if (!Array.isArray(manifest.supportedScopes) || manifest.supportedScopes.length === 0) {
    throw new Error(`${sourceDirectory} 未声明 supportedScopes`)
  }
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)+$/i.test(manifest.id ?? '')) {
    throw new Error(`${sourceDirectory} 的组件 ID 无效`)
  }
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version ?? '')) {
    throw new Error(`${sourceDirectory} 的版本无效`)
  }
  if ('category' in manifest) {
    throw new Error(`${sourceDirectory} 把目录分类写入了运行时 Manifest`)
  }
}

async function buildOne([sourceDirectory, outputPath]) {
  const sourceRoot = path.join(repositoryRoot, sourceDirectory)
  const manifest = JSON.parse(await fs.readFile(path.join(sourceRoot, 'manifest.json'), 'utf8'))
  assertManifest(manifest, sourceDirectory)
  const requiredPaths = new Set([
    'manifest.json',
    safeRelativePath(manifest.entry),
    ...(manifest.thumbnail ? [safeRelativePath(manifest.thumbnail)] : []),
    ...Object.values(manifest.assets ?? {}).map(safeRelativePath),
  ])
  const archiveFiles = Object.create(null)
  for (const relativePath of [...requiredPaths].sort()) {
    const bytes = await fs.readFile(path.join(sourceRoot, ...relativePath.split('/')))
    archiveFiles[relativePath] = relativePath === 'manifest.json'
      ? strToU8(`${JSON.stringify(manifest, null, 2)}\n`)
      : Uint8Array.from(bytes)
  }
  const runtime = new TextDecoder().decode(archiveFiles[manifest.entry])
  if (!runtime.includes(manifest.id) || !/runtimeApiVersion\s*:\s*4\b/.test(runtime)) {
    throw new Error(`${sourceDirectory} 的 runtime.js 未静态登记正确 ID/API 4`)
  }
  const archive = zipSync(archiveFiles, { level: 9, mtime: reproducibleTimestamp })
  const sha256 = createHash('sha256').update(archive).digest('hex')
  const output = path.join(repositoryRoot, outputPath)
  if (checkOnly) {
    const existing = await fs.readFile(output)
    const existingHash = createHash('sha256').update(existing).digest('hex')
    if (existingHash !== sha256) throw new Error(`${outputPath} 不是当前源码的可重现制品`)
  } else {
    await fs.mkdir(path.dirname(output), { recursive: true })
    await fs.writeFile(output, archive)
  }
  return { manifest, outputPath, sha256 }
}

const built = []
for (const spec of specs) built.push(await buildOne(spec))
const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8'))
if (catalog.catalogVersion !== 1 || !Array.isArray(catalog.packages)) {
  throw new Error('catalog.json 不是 Component Catalog V1')
}
for (const result of built) {
  const entry = catalog.packages.find((candidate) =>
    candidate.packageId === result.manifest.id && candidate.version === result.manifest.version)
  if (!entry) throw new Error(`catalog.json 缺少 ${result.manifest.id}@${result.manifest.version}`)
  if (entry.packagePath !== result.outputPath) {
    throw new Error(`${result.manifest.id} 的 packagePath 与构建输出不一致`)
  }
  if (checkOnly) {
    if (entry.sha256 !== result.sha256) throw new Error(`${result.manifest.id} 的目录 SHA-256 过期`)
  } else {
    entry.sha256 = result.sha256
  }
}
if (catalog.packages.length !== built.length) {
  throw new Error('catalog.json 包含没有可重现构建规格的组件')
}
if (!checkOnly) await fs.writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8')
console.log(`${checkOnly ? '已验证' : '已构建'} ${built.length} 个 Component API 4 组件`)
