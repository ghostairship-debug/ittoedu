// @vitest-environment node
import { afterEach, expect, it } from 'vitest'
import { build } from 'esbuild'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { constants, runInNewContext, runInThisContext } from 'node:vm'
import type { AffineMatrix } from '../../src/core/components/geometry'

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
})

type CoordinateReader = (element: HTMLElement) => AffineMatrix | null

it('retains geometry dependencies in a fresh realm after minified code splitting', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'guoling-client-matrix-realm-'))
  directories.push(directory)
  await build({
    entryPoints: {
      reader: fileURLToPath(new URL('../../src/player/components/runtime/componentClientMatrix.ts', import.meta.url)),
      geometry: fileURLToPath(new URL('../../src/core/components/geometry/index.ts', import.meta.url)),
    },
    outdir: directory, outExtension: { '.js': '.mjs' }, bundle: true, splitting: true,
    format: 'esm', platform: 'browser', target: 'es2022', minify: true, logLevel: 'silent',
  })
  // A real shared chunk gives the consumer its own local import aliases.
  expect(await readFile(join(directory, 'reader.mjs'), 'utf8')).toMatch(/from["']\.\/chunk-/)
  expect(constants.USE_MAIN_CONTEXT_DEFAULT_LOADER).toBeDefined()
  const nativeImport = runInThisContext('(url) => import(url)', {
    importModuleDynamically: constants.USE_MAIN_CONTEXT_DEFAULT_LOADER,
  }) as (url: string) => Promise<Record<string, any>>
  const reader = await nativeImport(pathToFileURL(join(directory, 'reader.mjs')).href) as {
    componentClientMatrix: CoordinateReader; componentClientMatrixRealmSource(): string
  }
  const geometry = await nativeImport(pathToFileURL(join(directory, 'geometry.mjs')).href)
  // Function.name is observable metadata, not the consuming module's lexical
  // binding. Make that distinction deterministic across bundler versions.
  Object.defineProperty(geometry.multiplyMatrices, 'name', { value: 'geometryProduct' })
  Object.defineProperty(geometry.transformPoint, 'name', { value: 'geometryProjection' })
  const realm = runInNewContext(`(${reader.componentClientMatrixRealmSource()})`) as CoordinateReader

  let parentTransform = 'matrix(2,0,0,3,0,0)'
  const parent = { parentElement: null }
  const view = { getComputedStyle: (node: unknown) => ({
    width: '40px', height: '20px', transform: node === parent ? parentTransform : 'matrix(0,1,-1,0,0,0)',
  }) }
  const element = {
    ownerDocument: { defaultView: view }, parentElement: parent, offsetWidth: 40, offsetHeight: 20,
    getBoundingClientRect: () => ({ left: 100, top: 50, width: 40, height: 120 }),
  } as unknown as HTMLElement

  // Rotated child under a nonuniformly scaled parent, with client translation.
  const expected = [0, 3, -2, 0, 140, 50]
  expect(reader.componentClientMatrix(element)).toEqual(expected)
  expect(Array.from(realm(element)!)).toEqual(expected)
  parentTransform = 'matrix(0,0,0,1,0,0)'
  expect(reader.componentClientMatrix(element)).toBeNull()
  expect(realm(element)).toBeNull()
})
