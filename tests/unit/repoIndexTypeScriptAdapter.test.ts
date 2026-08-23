import { readFileSync, readdirSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'

import { createTypeScriptIndexAdapter } from '../../scripts/repo-index/typescriptAdapter'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const fixtureRoot = resolve(repoRoot, 'scripts/repo-index/fixtures/adapter')

function collectTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      return collectTypeScriptFiles(path)
    }
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : []
  })
}

function stableRealProjectScan() {
  const adapter = createTypeScriptIndexAdapter({ repoRoot })
  const startedAt = performance.now()
  try {
    adapter.loadProjects([
      'tsconfig.json',
      'tsconfig.electron.json',
      'tsconfig.e2e.json',
    ])
    const files = adapter.listFiles()
    const scans = files.map((file) => adapter.scanFile(file.path))
    return {
      durationMs: performance.now() - startedAt,
      files,
      serialization: JSON.stringify(scans),
    }
  } finally {
    adapter.dispose()
  }
}

describe('TypeScript 7 repo-index adapter', () => {
  it('extracts aliases, barrels, type imports, dynamic imports, symbols, JSDoc, and tests', () => {
    const adapter = createTypeScriptIndexAdapter({ repoRoot: fixtureRoot })
    adapter.loadProjects(['tsconfig.json'])

    expect(adapter.listFiles().map((file) => file.path)).toEqual([
      'src/barrel.ts',
      'src/dynamic.ts',
      'src/index.ts',
      'src/shared/projectTypes.ts',
      'src/types.ts',
      'tests/index.test.ts',
    ])

    const source = adapter.scanFile('src\\index.ts')
    if (process.platform === 'win32') {
      expect(adapter.scanFile('SRC\\INDEX.TS')).toEqual(source)
    }
    expect(source.projects).toEqual(['tsconfig.json'])
    expect(source.imports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'static',
          moduleSpecifier: '@/shared/projectTypes',
          isTypeOnly: true,
        }),
        expect.objectContaining({
          kind: 'static',
          moduleSpecifier: './barrel',
          isTypeOnly: false,
        }),
        expect.objectContaining({
          kind: 'dynamic',
          moduleSpecifier: './dynamic',
          isTypeOnly: false,
        }),
      ]),
    )
    expect(source.exports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'declaration',
          names: ['indexedValue'],
        }),
        expect.objectContaining({
          kind: 'named',
          names: ['renamedLocal'],
        }),
      ]),
    )
    expect(source.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'indexedValue',
          kind: 'const',
          line: 11,
          exported: true,
          jsDoc:
            'Primary fixture symbol. It proves that the first JSDoc paragraph is retained.',
        }),
        expect.objectContaining({ name: 'IndexedShape', kind: 'type' }),
        expect.objectContaining({ name: 'IndexedClass', kind: 'class' }),
        expect.objectContaining({ name: 'loadDynamicFixture', kind: 'function' }),
        expect.objectContaining({ name: 'localOnly', kind: 'const', exported: false }),
      ]),
    )

    const barrel = adapter.scanFile('src/barrel.ts')
    expect(barrel.exports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'named',
          names: ['fixtureValue'],
          moduleSpecifier: './dynamic',
        }),
        expect.objectContaining({
          kind: 'all',
          moduleSpecifier: './types',
        }),
        expect.objectContaining({
          kind: 'namespace',
          names: ['dynamicNamespace'],
        }),
      ]),
    )

    expect(adapter.scanFile('tests/index.test.ts').tests).toEqual([
      expect.objectContaining({ kind: 'describe', name: 'adapter fixture suite' }),
      expect.objectContaining({ kind: 'test', name: 'extracts literal test names' }),
      expect.objectContaining({ kind: 'it', name: 'supports property-access test modifiers' }),
    ])

    adapter.dispose()
    expect(() => adapter.listFiles()).toThrow(/disposed/)
    adapter.dispose()
  })

  it(
    'loads and deterministically scans the renderer, player, shared, Electron, and test projects twice',
    () => {
      const first = stableRealProjectScan()
      const second = stableRealProjectScan()

      const paths = first.files.map((file) => file.path)
      for (const prefix of [
        'src/renderer/',
        'src/player/',
        'src/shared/',
        'src/main/',
        'src/preload/',
        'tests/unit/',
        'tests/integration/',
        'tests/e2e/',
      ]) {
        expect(paths.some((path) => path.startsWith(prefix)), prefix).toBe(true)
      }

      const sharedMembership = first.files.find(
        (file) => file.path === 'src/shared/projectTypes.ts',
      )
      expect(sharedMembership?.projects).toEqual([
        'tsconfig.e2e.json',
        'tsconfig.electron.json',
        'tsconfig.json',
      ])
      expect(new Set(paths).size).toBe(paths.length)
      expect(first.serialization).toBe(second.serialization)
      expect(first.durationMs).toBeLessThan(10_000)
      expect(second.durationMs).toBeLessThan(10_000)

      console.info(
        `[repo-index adapter smoke] files=${first.files.length} first=${first.durationMs.toFixed(1)}ms second=${second.durationMs.toFixed(1)}ms stable=true`,
      )
    },
    30_000,
  )

  it('isolates every typescript/unstable import to typescriptAdapter.ts', () => {
    const toolingRoot = resolve(repoRoot, 'scripts/repo-index')
    const importers = collectTypeScriptFiles(toolingRoot)
      .filter((path) => readFileSync(path, 'utf8').includes('typescript/unstable/'))
      .map((path) => relative(toolingRoot, path).replace(/\\/g, '/'))
      .sort()

    expect(importers).toEqual(['typescriptAdapter.ts'])
  })
})
