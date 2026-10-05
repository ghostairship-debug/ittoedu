import { build } from 'esbuild'
import { readFile, mkdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
// The helper can live in a leaf; all product writers and the shared fixture come from this integration root.
const sourceRoot = resolve(process.argv[5] ?? root)
const helperEntry = resolve(root, 'tests/helpers/generateMixedDeliveryArtifacts.ts')
const output = resolve(process.argv[2] ?? resolve(root, 'output/x1-mixed-delivery'))
const playerBundlePath = resolve(process.argv[3] ?? resolve(sourceRoot, 'dist-player/player.iife.js'))
const playerBundle = await readFile(playerBundlePath, 'utf8')
if (!playerBundle.trim()) throw new Error('实际 Player bundle 为空')
await mkdir(output, { recursive: true })
const entry = resolve(output, 'mixed-artifacts.cjs')
await build({ absWorkingDir: sourceRoot, entryPoints: [helperEntry], outfile: entry,
  bundle: true, platform: 'node', format: 'cjs', packages: 'external',
  banner: { js: `require = require('node:module').createRequire(${JSON.stringify(resolve(sourceRoot, 'package.json'))});` },
  plugins: [{ name: 'integration-writers', setup(builder) {
    builder.onResolve({ filter: /^\.\.\/(?:\.\.\/src\/|fixtures\/)/ }, args => args.importer === helperEntry
      ? builder.resolve(args.path, { resolveDir: resolve(sourceRoot, 'tests/helpers'), kind: args.kind }) : undefined)
  } }, { name: 'captured-player', setup(builder) {
    builder.onResolve({ filter: /^virtual:player-bundle$/ }, () => ({ path: 'player', namespace: 'captured-player' }))
    builder.onLoad({ filter: /.*/, namespace: 'captured-player' }, () => ({ contents: `export default ${JSON.stringify(playerBundle)}`, loader: 'js' }))
  } }] })
console.log(JSON.stringify({ helperEntry, sourceRoot, playerBundlePath, output }))
const result = spawnSync(process.execPath, [entry, output, ...(process.argv[4] ? [resolve(process.argv[4])] : [])], { cwd: sourceRoot, stdio: 'inherit' })
process.exitCode = result.status ?? 1
