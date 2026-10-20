// @vitest-environment node
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { build } from 'esbuild'
import { expect, it } from 'vitest'
import { resolveComponentEase } from '../../src/player/components/runtime/componentEasing'

const require = createRequire(import.meta.url)
const phaserRoot = dirname(require.resolve('phaser/package.json'))
// Absolute fixture paths intentionally bypass Phaser's public exports: only the oracle loads its source.
const original = require(resolve(phaserRoot, 'src/tweens/builders/GetEaseFunction.js')) as (name: string) => (value: number) => number
const originalNames = Object.keys(require(resolve(phaserRoot, 'src/math/easing/EaseMap.js')))

it('preserves every Phaser easing name, accepted shorthand, default curves and unknown-name fallback', () => {
  const names = new Set([...originalNames, '', 'unknown', '.in', 'quad.easein', 'QUAD.in', 'toString', '__proto__'])
  for (const name of originalNames) {
    names.add(name[0].toLowerCase() + name.slice(1))
    for (const direction of ['in', 'out', 'inout', 'IN', 'OuT', 'InOut']) {
      names.add(`${name.split('.')[0].toLowerCase()}.${direction}`)
    }
  }
  for (const name of names) {
    const expected = original(name), actual = resolveComponentEase(name)
    // These are the actual 101 linear() samples emitted by presentation.set, including endpoints.
    for (let index = 0; index <= 100; index++) {
      expect(actual(index / 100), `${name} at ${index / 100}`).toBe(expected(index / 100))
    }
  }
})

it('builds the real interaction consumer without including the Phaser engine', async () => {
  const result = await build({
    entryPoints: ['src/player/components/runtime/ComponentWorldInteractions.ts'],
    absWorkingDir: resolve(import.meta.dirname, '../..'),
    bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022', minify: true, metafile: true,
  })
  const inputs = Object.keys(result.metafile!.inputs).map(path => path.replaceAll('\\', '/'))
  expect(inputs.some(path => path.endsWith('/componentEasing.ts'))).toBe(true)
  expect(inputs.filter(path => path.includes('node_modules/phaser/'))).toEqual([])
})
