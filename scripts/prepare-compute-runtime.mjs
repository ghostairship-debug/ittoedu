// Development asset preparation only. Runtime uses the resulting local files.
// Run: node scripts/prepare-compute-runtime.mjs
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { unzipSync } from 'fflate'

const root = fileURLToPath(new URL('../public/vendor/compute-runtime/', import.meta.url))
const version = '314.0.7'
const base = `https://cdn.jsdelivr.net/pyodide/v${version}/full/`
const packages = ['numpy', 'pandas', 'matplotlib']
const fontCommit = '523d033d6cb47f4a80c58a35753646f5c3608a78'
const fontBase = `https://raw.githubusercontent.com/notofonts/noto-cjk/${fontCommit}/Sans/`
const sources = []

async function save(relative, bytes) {
  const target = resolve(root, relative)
  if (!target.startsWith(resolve(root) + sep)) throw new Error(`Asset path escapes destination: ${relative}`)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, bytes)
}
async function download(url, relative, expectedSha256) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status} ${response.statusText}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  // The official lock identifies exact release wheels, not general correctness.
  if (expectedSha256 && sha256 !== expectedSha256) throw new Error(`Release wheel identity mismatch: ${url}`)
  await save(relative, bytes)
  sources.push({ file: relative, url, bytes: bytes.length, sha256 })
  console.log(`${relative}: ${bytes.length} bytes`)
  return bytes
}

const lockBytes = await download(`${base}pyodide-lock.json`, 'pyodide/pyodide-lock.json')
const lock = JSON.parse(new TextDecoder().decode(lockBytes))
const selected = new Set()
function include(name) {
  if (selected.has(name)) return
  const item = lock.packages[name]
  if (!item) throw new Error(`Required package absent from official ${version} lock: ${name}`)
  selected.add(name)
  for (const dependency of item.depends) include(dependency)
}
packages.forEach(include)

for (const file of ['pyodide.mjs', 'pyodide.js', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip']) {
  await download(`${base}${file}`, `pyodide/${file}`)
}
await download(`https://raw.githubusercontent.com/pyodide/pyodide/${version}/LICENSE`, 'licenses/PYODIDE-MPL-2.0.txt')
await download('https://raw.githubusercontent.com/python/cpython/v3.14.2/LICENSE', 'licenses/CPYTHON-LICENSE.txt')

const licenseName = /(?:^|\/)(?:license|licence|copying|notice|authors)(?:[._-]|$)/i
const packageSources = []
for (const key of selected) {
  const item = lock.packages[key]
  const bytes = await download(new URL(item.file_name, base).href, `pyodide/${item.file_name}`, item.sha256)
  const retained = unzipSync(bytes, { filter: entry => licenseName.test(entry.name) || /\.dist-info\/METADATA$/.test(entry.name) })
  const licenses = []
  let license = ''
  for (const [name, content] of Object.entries(retained)) {
    if (name.endsWith('/METADATA')) {
      const metadata = new TextDecoder().decode(content)
      license = metadata.match(/^License-Expression:\s*(.+)$/m)?.[1]
        ?? metadata.match(/^License:\s*(.+)$/m)?.[1] ?? 'See bundled wheel license files'
      continue
    }
    const relative = `licenses/packages/${key}/${name}`
    await save(relative, content)
    licenses.push(relative)
  }
  packageSources.push({ key, name: item.name, version: item.version, file: item.file_name,
    depends: item.depends, sha256: item.sha256, license, licenses })
}

await download(`${fontBase}SubsetOTF/SC/NotoSansSC-Regular.otf`, 'fonts/NotoSansSC-Regular.otf')
await download(`https://raw.githubusercontent.com/notofonts/noto-cjk/${fontCommit}/LICENSE`, 'fonts/OFL.txt')
const manifest = {
  schemaVersion: 1,
  pyodide: { version, entry: 'pyodide/pyodide.mjs' },
  packages,
  font: { file: 'fonts/NotoSansSC-Regular.otf', family: 'Noto Sans SC' },
}
// Write readiness metadata last; partial downloads do not announce completion.
await save('sources.json', JSON.stringify({ pyodideRelease: `https://github.com/pyodide/pyodide/releases/tag/${version}`,
  python: lock.info.python, abi: lock.info.abi_version, packages: packageSources,
  font: { version: '2.004', commit: fontCommit, source: `${fontBase}SubsetOTF/SC/NotoSansSC-Regular.otf`, license: 'OFL-1.1' },
  downloads: sources.sort((a, b) => a.file.localeCompare(b.file)),
}, null, 2) + '\n')
await save('manifest.json', JSON.stringify(manifest, null, 2) + '\n')
console.log(JSON.stringify({ status: 'assets-prepared', version, packages: selected.size,
  downloadedBytes: sources.reduce((sum, item) => sum + item.bytes, 0), font: manifest.font }))
