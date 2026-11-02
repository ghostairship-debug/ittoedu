import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

// Publisher assets and digests: https://api.github.com/repos/ip7z/7zip/releases/tags/26.05
// Extract the distribution; never run either installer or request elevation.
const release = {
  version: '26.05',
  bootstrap: { name: '7zr.exe', sha256: '9bf582b894dfa665f852d7e9112b02290a1c303c2d95a21fcdc41ffcb03143b7' },
  archive: { name: '7z2605-x64.exe', sha256: 'fd99e86f57d8f429ef5ed045bf98315af962e2309b0f1ba87a147a44c71647d0' },
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Prepare the shipped extractor on Windows x64.')
const destination = path.join(root, 'resources/office-extractor/win-x64')
const scratchRoot = path.join(root, 'output/goal-correction-20261102/extractor-preparation')
await fs.mkdir(scratchRoot, { recursive: true })
const scratch = await fs.mkdtemp(path.join(scratchRoot, 'run-'))
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
async function download(asset) {
  const filename = path.join(scratch, asset.name)
  const response = await fetch(`https://github.com/ip7z/7zip/releases/download/${release.version}/${asset.name}`)
  if (!response.ok) throw new Error(`Publisher download failed: HTTP ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (hash(bytes) !== asset.sha256) throw new Error('Publisher digest mismatch: ' + asset.name)
  await fs.writeFile(filename, bytes, { flag: 'wx' })
  return filename
}
const bootstrap = await download(release.bootstrap)
const archive = await download(release.archive)
const extracted = path.join(scratch, 'extracted')
const result = spawnSync(bootstrap, ['x', archive, '-o' + extracted, '-y'], { encoding: 'utf8', windowsHide: true })
await fs.writeFile(path.join(scratch, 'extraction.log'), (result.stdout ?? '') + (result.stderr ?? ''))
if (result.error || result.status !== 0) throw result.error ?? new Error('Extractor unpack failed: ' + result.status)
const files = ['7z.exe', '7z.dll', 'License.txt', 'readme.txt']
const receipts = []
for (const name of files) {
  const bytes = await fs.readFile(path.join(extracted, name))
  receipts.push({ name, bytes: bytes.length, sha256: hash(bytes) })
}
await fs.mkdir(destination, { recursive: true })
for (const name of files) await fs.copyFile(path.join(extracted, name), path.join(destination, name))
const probe = spawnSync(path.join(destination, '7z.exe'), ['i'], { encoding: 'utf8', windowsHide: true })
if (probe.error || probe.status !== 0 || !/Nsis/i.test(probe.stdout)) throw new Error('Shipped extractor does not expose NSIS support.')
await fs.writeFile(path.join(destination, 'release.json'), JSON.stringify({ ...release, source: 'https://github.com/ip7z/7zip/releases/tag/26.05', files: receipts }, null, 2) + '\n')
await fs.writeFile(path.join(scratch, 'result.json'), JSON.stringify({ status: 'passed', destination, release, files: receipts, nsis: true, installed: false }, null, 2))
console.log(JSON.stringify({ status: 'passed', destination, result: path.join(scratch, 'result.json'), files: receipts }))
