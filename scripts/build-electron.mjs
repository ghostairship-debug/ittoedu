import { spawn } from 'node:child_process'
import { existsSync, lstatSync, realpathSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { writePixabayDefaultKey } from './build-pixabay-default-key.mjs'

const workspace = realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'))
const output = path.resolve(workspace, 'dist-electron')
const compiler = path.join(workspace, 'node_modules', 'typescript', 'bin', 'tsc')

// Only the compiler's fixed generated directory may be removed. A junction or
// symlink must not redirect the cleanup outside this checkout.
if (path.relative(workspace, output) !== 'dist-electron' ||
    path.basename(output) !== 'dist-electron') {
  throw new Error(`Unexpected Electron build output: ${output}`)
}
if (!existsSync(compiler)) throw new Error(`TypeScript compiler missing: ${compiler}`)
const outputEntry = lstatSync(output, { throwIfNoEntry: false })
if (outputEntry) {
  const info = outputEntry
  if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(output) !== output) {
    throw new Error(`Electron build output is not the expected ordinary directory: ${output}`)
  }
  rmSync(output, { recursive: true, force: true })
}

const child = spawn(process.execPath, [compiler, '-p', 'tsconfig.electron.json'], {
  cwd: workspace,
  stdio: 'inherit',
  windowsHide: true,
})
child.on('error', (error) => {
  console.error(error)
  process.exitCode = 1
})
child.on('exit', async (code) => {
  process.exitCode = code ?? 1
  if (code === 0) {
    try { await writePixabayDefaultKey(output) }
    catch { console.error('Pixabay default key build failed'); process.exitCode = 1 }
  }
})
