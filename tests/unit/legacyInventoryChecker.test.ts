import { readFileSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'

import {
  checkLegacyConsumers,
  computeCanonicalInventoryDigest,
  computeProductTreeDigest,
  containsBareLegacyToken,
  LEGACY_QUERY_CATALOG_DIGEST,
  LEGACY_RECORD_STATUSES,
  LEGACY_SCAN_SCOPE,
  LEGACY_SCANNER_VERSION,
  LEGACY_SCOPE_DIGEST,
  LegacyInventoryError,
  targetReferenceQueryId,
} from '../../scripts/check-legacy-consumers'

const tempRoots: string[] = []

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'legacy-inventory-v3-'))
  tempRoots.push(root)
  return root
}

afterEach(async () => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()
    if (root) await rm(root, { recursive: true, force: true })
  }
})

type Endpoint = { path: string; symbol: string; use: string }

function categories(confirmed: Endpoint[] = [], unknowns: string[] = []) {
  return {
    staticImportsOrReferences: { confirmed, unknowns },
    dynamicStringIpcOrConfig: { confirmed: [], unknowns: [] },
    playerPreviewOrExport: { confirmed: [], unknowns: [] },
    buildFixtureOrRelease: { confirmed: [], unknowns: [] },
    persistedRecoveryOrCrossVersion: { confirmed: [], unknowns: [] },
    testConsumers: { confirmed: [], unknowns: [] },
    cacheAsyncGeneratedOrPackaging: { confirmed: [], unknowns: [] },
  }
}

function inventory(options: {
  digest: string
  confirmed?: Endpoint[]
  unknowns?: string[]
  status?: string
  targetPath?: string
  expectation?: 'file-absent' | 'symbol-absent'
  targetSymbols?: string[]
  countsOverride?: Record<string, unknown>
  scannerContractOverride?: Record<string, unknown>
  additionalTargets?: Array<{
    expectationId: string
    kind: string
    path: string
    expectation: 'file-absent'
  }>
}) {
  const confirmed = options.confirmed ?? []
  const status = options.status ?? 'active-debt'
  const expectation = options.expectation ?? 'file-absent'
  const target = {
    expectationId: 'LEG-900-target',
    kind: 'fixture-target',
    path: options.targetPath ?? 'src/legacy-target.ts',
    expectation,
    ...(expectation === 'symbol-absent'
      ? { symbols: options.targetSymbols ?? ['ProjectDocument'] }
      : {}),
  }
  return {
    schemaVersion: 2,
    scannerContract: options.scannerContractOverride ?? {
      version: LEGACY_SCANNER_VERSION,
      scope: LEGACY_SCAN_SCOPE,
      scopeDigest: LEGACY_SCOPE_DIGEST,
      queryCatalogDigest: LEGACY_QUERY_CATALOG_DIGEST,
    },
    baseline: {
      reconciledProductCommit: 'a'.repeat(40),
      reconciledProductTreeDigest: options.digest,
    },
    consumerCategoryDefinitions: {
      staticImportsOrReferences: 'static',
      dynamicStringIpcOrConfig: 'dynamic',
      playerPreviewOrExport: 'player',
      buildFixtureOrRelease: 'build',
      persistedRecoveryOrCrossVersion: 'persisted',
      testConsumers: 'tests',
      cacheAsyncGeneratedOrPackaging: 'generated',
    },
    startingCounts: {},
    records: [{
      id: 'LEG-900',
      legacyTargets: [target, ...(options.additionalTargets ?? [])],
      owner: 'fixture',
      status,
      consumerCategories: categories(confirmed, options.unknowns),
      zeroReferenceEvidence: { state: confirmed.length > 0 ? 'nonzero' : 'zero' },
    }],
    reconciledCounts: {
      recordCount: 1,
      byStatus: { [status]: 1 },
      confirmedConsumerRelationsByCategory: {
        staticImportsOrReferences: confirmed.length,
        dynamicStringIpcOrConfig: 0,
        playerPreviewOrExport: 0,
        buildFixtureOrRelease: 0,
        persistedRecoveryOrCrossVersion: 0,
        testConsumers: 0,
        cacheAsyncGeneratedOrPackaging: 0,
      },
      confirmedConsumerRelationCount: confirmed.length,
      uniqueConfirmedConsumerEndpointCount: new Set(confirmed.map((item) => `${item.path}#${item.symbol}`)).size,
      ...options.countsOverride,
    },
  }
}

async function writeTree(
  root: string,
  files: Record<string, string | Uint8Array>,
  buildInventory: (digest: string) => unknown,
): Promise<unknown> {
  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(root, ...relative.split('/'))
    await mkdir(path.dirname(absolute), { recursive: true })
    await writeFile(absolute, content)
  }
  if (!Object.hasOwn(files, 'package.json')) await writeFile(path.join(root, 'package.json'), '{}\n')
  const inventoryPath = path.join(root, 'docs', 'development-plan', 'inventories', 'legacy-consumers.json')
  await mkdir(path.dirname(inventoryPath), { recursive: true })
  await writeFile(inventoryPath, `${JSON.stringify(buildInventory('0'.repeat(64)), null, 2)}\n`)
  const value = buildInventory(computeProductTreeDigest(root))
  await writeFile(inventoryPath, `${JSON.stringify(value, null, 2)}\n`)
  return value
}

function lesson(schemaVersion: number): Uint8Array {
  return zipSync({ 'project.json': strToU8(JSON.stringify({ schemaVersion })) })
}

function category(error: unknown): string | undefined {
  return error instanceof LegacyInventoryError ? error.category : undefined
}

describe('legacy query boundaries', () => {
  it('matches a bare legacy name without matching a legal composite name', () => {
    expect(containsBareLegacyToken('type ProjectDocument = {}', 'ProjectDocument')).toBe(true)
    expect(containsBareLegacyToken('type CourseProjectDocument = {}', 'ProjectDocument')).toBe(false)
  })

  it('canonical inventory digest ignores object key order and whitespace', () => {
    expect(computeCanonicalInventoryDigest({ b: 2, a: [1] }))
      .toBe(computeCanonicalInventoryDigest(JSON.parse('{\n "a": [1], "b": 2\n}')))
  })
})

describe('legacy inventory v3 scanner', () => {
  it('ratchet accepts an exact registered path + query observation', async () => {
    const root = await createTempRoot()
    await writeTree(root, {
      'src/consumer.ts': 'export type ProjectDocument = { schemaVersion: 8 }\n',
    }, (digest) => inventory({
      digest,
      confirmed: [{ path: 'src/consumer.ts', symbol: 'ProjectDocument', use: 'fixture' }],
    }))
    const result = checkLegacyConsumers({ projectRoot: root, mode: 'ratchet' })
    expect(result.matchedConfirmedRelationCount).toBe(1)
    expect(result.newConsumers).toEqual([])
  })

  it('rejects a new query in an already registered path', async () => {
    const root = await createTempRoot()
    await writeTree(root, {
      'src/consumer.ts': 'export type ProjectDocument = {}; export type SceneNode = {}\n',
    }, (digest) => inventory({
      digest,
      confirmed: [{ path: 'src/consumer.ts', symbol: 'ProjectDocument', use: 'fixture' }],
    }))
    expect(() => checkLegacyConsumers({ projectRoot: root, mode: 'ratchet' }))
      .toThrowError(expect.objectContaining({ category: 'new-consumer' }))
  })

  it('rejects a live token after confirmed relations are cleared', async () => {
    const root = await createTempRoot()
    await writeTree(root, { 'src/consumer.ts': 'export type SceneNode = {}\n' }, (digest) => inventory({ digest }))
    expect(() => checkLegacyConsumers({ projectRoot: root, mode: 'ratchet' }))
      .toThrowError(expect.objectContaining({ category: 'new-consumer' }))
  })

  it('ratchets an exact source + file target reference without requiring a legacy token', async () => {
    const root = await createTempRoot()
    await writeTree(root, {
      'src/consumer.ts': "import { currentHelper } from './legacy-target'\nexport { currentHelper }\n",
      'src/legacy-target.ts': 'export const currentHelper = true\n',
    }, (digest) => inventory({
      digest,
      confirmed: [{
        path: 'src/consumer.ts',
        symbol: targetReferenceQueryId('LEG-900-target'),
        use: 'imports the exact file-absent target',
      }],
    }))
    const result = checkLegacyConsumers({ projectRoot: root, mode: 'ratchet' })
    expect(result.matchedConfirmedRelationCount).toBe(1)
    expect(result.summary.targetReferences).toBe(1)
    expect(result.targetReferences[0]).toMatchObject({
      path: 'src/consumer.ts',
      targetExpectationId: 'LEG-900-target',
      targetPath: 'src/legacy-target.ts',
    })
  })

  it('rejects an unregistered relative or alias reference to a file-absent target', async () => {
    for (const source of [
      "export * from './legacy-target'\n",
      "vi.mock('@/legacy-target')\n",
    ]) {
      const root = await createTempRoot()
      await writeTree(root, {
        'src/consumer.ts': source,
        'src/legacy-target.ts': 'export const currentHelper = true\n',
      }, (digest) => inventory({ digest }))
      expect(() => checkLegacyConsumers({ projectRoot: root, mode: 'ratchet' }))
        .toThrowError(expect.objectContaining({ category: 'new-consumer' }))
    }
  })

  it('keeps a registered stale module reference as known debt after the target file is gone', async () => {
    const root = await createTempRoot()
    await writeTree(root, {
      'src/consumer.ts': "const loadLegacy = () => import('./legacy-target.js')\nexport { loadLegacy }\n",
    }, (digest) => inventory({
      digest,
      confirmed: [{
        path: 'src/consumer.ts',
        symbol: targetReferenceQueryId('LEG-900-target'),
        use: 'stale dynamic import',
      }],
    }))
    for (const mode of ['ready', 'zero'] as const) {
      expect(() => checkLegacyConsumers({ projectRoot: root, mode }))
        .toThrowError(expect.objectContaining({ category: 'known-debt' }))
    }
  })

  it('does not turn a registered source path into an allowlist for another file target', async () => {
    const root = await createTempRoot()
    await writeTree(root, {
      'src/consumer.ts': "import './legacy-target'\nimport './second-target'\n",
      'src/legacy-target.ts': 'export const first = true\n',
      'src/second-target.ts': 'export const second = true\n',
    }, (digest) => inventory({
      digest,
      confirmed: [{
        path: 'src/consumer.ts',
        symbol: targetReferenceQueryId('LEG-900-target'),
        use: 'only the first target is registered',
      }],
      additionalTargets: [{
        expectationId: 'LEG-900-second-target',
        kind: 'fixture-target',
        path: 'src/second-target.ts',
        expectation: 'file-absent',
      }],
    }))
    expect(() => checkLegacyConsumers({ projectRoot: root, mode: 'ratchet' }))
      .toThrowError(expect.objectContaining({ category: 'new-consumer' }))
  })

  it('does not classify an unrelated bare label as a module reference', async () => {
    const root = await createTempRoot()
    await writeTree(root, {
      'src/consumer.ts': "export const label = 'legacy-target'\n",
    }, (digest) => inventory({ digest }))
    expect(checkLegacyConsumers({ projectRoot: root, mode: 'ready' }).summary.targetReferences).toBe(0)
  })

  it('ignores quoted target paths inside inline, block, and HTML comments', async () => {
    const root = await createTempRoot()
    await writeTree(root, {
      'src/consumer.ts': [
        "export const current = true // import './legacy-target'",
        '/*',
        "import './legacy-target'",
        '*/',
        '',
      ].join('\n'),
      'artifacts/comment.html': '<!-- <script src="../src/legacy-target.ts"></script> -->\n',
    }, (digest) => inventory({ digest }))
    expect(checkLegacyConsumers({ projectRoot: root, mode: 'ready' }).summary.targetReferences).toBe(0)
  })

  it('finds a file target embedded in a command/config string', async () => {
    const root = await createTempRoot()
    await writeTree(root, {
      'package.json': '{"scripts":{"legacy":"node src/legacy-target.ts --check"}}\n',
    }, (digest) => inventory({
      digest,
      confirmed: [{
        path: 'package.json',
        symbol: targetReferenceQueryId('LEG-900-target'),
        use: 'embedded command reference',
      }],
    }))
    const result = checkLegacyConsumers({ projectRoot: root, mode: 'ratchet' })
    expect(result.targetReferences).toHaveLength(1)
    expect(result.targetReferences[0]?.specifier).toBe('src/legacy-target.ts')
  })

  it('does not resolve a JSON import as the TypeScript target with the same stem', async () => {
    const root = await createTempRoot()
    await writeTree(root, {
      'src/consumer.ts': "import data from './legacy-target.json'\nexport { data }\n",
      'src/legacy-target.json': '{}\n',
    }, (digest) => inventory({ digest }))
    expect(checkLegacyConsumers({ projectRoot: root, mode: 'ready' }).summary.targetReferences).toBe(0)
  })

  it('counts a legacy target file as a consumer when it references another file target', async () => {
    const root = await createTempRoot()
    await writeTree(root, {
      'src/legacy-target.ts': "export * from './second-target'\n",
      'src/second-target.ts': 'export const second = true\n',
    }, (digest) => inventory({
      digest,
      confirmed: [{
        path: 'src/legacy-target.ts',
        symbol: targetReferenceQueryId('LEG-900-second-target'),
        use: 'first file target consumes the second',
      }],
      additionalTargets: [{
        expectationId: 'LEG-900-second-target',
        kind: 'fixture-target',
        path: 'src/second-target.ts',
        expectation: 'file-absent',
      }],
    }))
    expect(() => checkLegacyConsumers({ projectRoot: root, mode: 'ready' }))
      .toThrowError(expect.objectContaining({ category: 'known-debt' }))
  })

  it('reports known debt only after current identity and unmatched checks pass', async () => {
    const root = await createTempRoot()
    await writeTree(root, { 'src/consumer.ts': 'export type ProjectDocument = {}\n' }, (digest) => inventory({
      digest,
      confirmed: [{ path: 'src/consumer.ts', symbol: 'ProjectDocument', use: 'fixture' }],
    }))
    try {
      checkLegacyConsumers({ projectRoot: root, mode: 'ready' })
      expect.fail('ready must fail')
    } catch (error) {
      expect(category(error)).toBe('known-debt')
    }
  })

  it('allows a file-absent target definition in ready but not zero', async () => {
    const root = await createTempRoot()
    await writeTree(root, { 'src/legacy-target.ts': 'export const legacyShell = true\n' }, (digest) => inventory({ digest }))
    expect(checkLegacyConsumers({ projectRoot: root, mode: 'ready' }).mode).toBe('ready')
    expect(() => checkLegacyConsumers({ projectRoot: root, mode: 'zero' }))
      .toThrowError(expect.objectContaining({ category: 'legacy-module-present' }))
  })

  it('allows a symbol-absent host file to remain and rejects the target symbol', async () => {
    const clean = await createTempRoot()
    await writeTree(clean, { 'src/host.ts': 'export const current = true\n' }, (digest) => inventory({
      digest,
      targetPath: 'src/host.ts',
      expectation: 'symbol-absent',
    }))
    expect(checkLegacyConsumers({ projectRoot: clean, mode: 'zero' }).mode).toBe('zero')

    const debt = await createTempRoot()
    await writeTree(debt, { 'src/host.ts': 'export type ProjectDocument = {}\n' }, (digest) => inventory({
      digest,
      targetPath: 'src/host.ts',
      expectation: 'symbol-absent',
    }))
    expect(() => checkLegacyConsumers({ projectRoot: debt, mode: 'ready' }))
      .toThrowError(expect.objectContaining({ category: 'known-debt' }))
  })

  it('rejects a removed target when its file returns', async () => {
    const root = await createTempRoot()
    await writeTree(root, { 'src/legacy-target.ts': 'export const returned = true\n' }, (digest) => inventory({
      digest,
      status: 'removed',
    }))
    expect(() => checkLegacyConsumers({ projectRoot: root, mode: 'ratchet' }))
      .toThrowError(expect.objectContaining({ category: 'legacy-module-present' }))
  })

  it('requires current product identity for ready and zero but not ratchet', async () => {
    const root = await createTempRoot()
    await writeTree(root, {}, (digest) => inventory({ digest }))
    await mkdir(path.join(root, 'src'), { recursive: true })
    await writeFile(path.join(root, 'src', 'changed.ts'), 'export const changed = true\n')
    expect(checkLegacyConsumers({ projectRoot: root, mode: 'ratchet' }).candidate.matchesInventory).toBe(false)
    for (const mode of ['ready', 'zero'] as const) {
      expect(() => checkLegacyConsumers({ projectRoot: root, mode }))
        .toThrowError(expect.objectContaining({ category: 'stale-inventory' }))
    }
  })

  it('detects schema 8 in h5lesson, accepts V9, and fails closed on a bad archive', async () => {
    const v8 = await createTempRoot()
    await writeTree(v8, { 'examples/v8.h5lesson': lesson(8) }, (digest) => inventory({ digest }))
    expect(() => checkLegacyConsumers({ projectRoot: v8, mode: 'ratchet' }))
      .toThrowError(expect.objectContaining({ category: 'new-consumer' }))

    const v9 = await createTempRoot()
    await writeTree(v9, { 'examples/v9.h5lesson': lesson(9) }, (digest) => inventory({ digest }))
    expect(checkLegacyConsumers({ projectRoot: v9, mode: 'zero' }).summary.schema8Archives).toBe(0)

    const bad = await createTempRoot()
    await writeTree(bad, { 'examples/bad.h5lesson': strToU8('not a zip') }, (digest) => inventory({ digest }))
    expect(() => checkLegacyConsumers({ projectRoot: bad, mode: 'ratchet' }))
      .toThrowError(expect.objectContaining({ category: 'scan-error' }))
  })

  it('rejects malformed reconciled counts and stale scanner identity', async () => {
    const badCounts = await createTempRoot()
    await writeTree(badCounts, {}, (digest) => inventory({ digest, countsOverride: { recordCount: 2 } }))
    expect(() => checkLegacyConsumers({ projectRoot: badCounts, mode: 'ratchet' }))
      .toThrowError(expect.objectContaining({ category: 'malformed-inventory' }))

    const stale = await createTempRoot()
    await writeTree(stale, {}, (digest) => inventory({
      digest,
      scannerContractOverride: { version: 'old' },
    }))
    expect(() => checkLegacyConsumers({ projectRoot: stale, mode: 'ratchet' }))
      .toThrowError(expect.objectContaining({ category: 'stale-inventory' }))
  })

  it('writes only a successful zero report atomically at the fixed candidate path', async () => {
    const root = await createTempRoot()
    await writeTree(root, {}, (digest) => inventory({ digest }))
    const before = computeProductTreeDigest(root)
    const reportPath = path.join(root, 'artifacts', 'release-evidence', 'v1.1', before, 'legacy-zero.json')
    const result = checkLegacyConsumers({ projectRoot: root, mode: 'zero', reportPath })
    expect(JSON.parse(await readFile(reportPath, 'utf8'))).toMatchObject({
      schemaVersion: 2,
      kind: 'legacy-consumer-scan',
      candidate: { candidateId: before },
      inventory: { canonicalDigest: result.inventory.canonicalDigest },
    })
    expect(await readdir(path.dirname(reportPath))).toEqual(['legacy-zero.json'])
    expect(computeProductTreeDigest(root)).toBe(before)
  })

  it('leaves no report when zero fails', async () => {
    const root = await createTempRoot()
    await writeTree(root, { 'src/legacy-target.ts': 'export const old = true\n' }, (digest) => inventory({ digest }))
    const candidate = computeProductTreeDigest(root)
    const reportPath = path.join(root, 'artifacts', 'release-evidence', 'v1.1', candidate, 'legacy-zero.json')
    expect(() => checkLegacyConsumers({ projectRoot: root, mode: 'zero', reportPath })).toThrow()
    expect(() => readFileSync(reportPath, 'utf8')).toThrow()
  })

  it('keeps the tracked status enum stable', () => {
    expect(LEGACY_RECORD_STATUSES).toEqual([
      'active-debt',
      'reachability-unproven',
      'retained-compatibility',
      'dead-candidate',
      'removed',
    ])
  })
})
