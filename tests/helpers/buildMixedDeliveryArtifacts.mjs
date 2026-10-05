import { build } from 'esbuild'
import { readFile, mkdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const output = resolve(process.argv[2] ?? resolve(root, 'output/x1-mixed-delivery'))
const playerBundlePath = resolve(process.argv[3] ?? resolve(root, 'dist-player/player.iife.js'))
const playerBundle = await readFile(playerBundlePath, 'utf8')
if (!playerBundle.trim()) throw new Error('实际 Player bundle 为空')
await mkdir(output, { recursive: true })
const entry = resolve(output, 'mixed-artifacts.cjs')
await build({ absWorkingDir: root, entryPoints: ['tests/helpers/generateMixedDeliveryArtifacts.ts'], outfile: entry,
  bundle: true, platform: 'node', format: 'cjs', packages: 'external', plugins: [{ name: 'captured-player', setup(builder) {
    builder.onResolve({ filter: /^virtual:player-bundle$/ }, () => ({ path: 'player', namespace: 'captured-player' }))
    builder.onLoad({ filter: /.*/, namespace: 'captured-player' }, () => ({ contents: `export default ${JSON.stringify(playerBundle)}`, loader: 'js' }))
  } }] })
const result = spawnSync(process.execPath, [entry, output, ...(process.argv[4] ? [resolve(process.argv[4])] : [])], { cwd: root, stdio: 'inherit' })
process.exitCode = result.status ?? 1
