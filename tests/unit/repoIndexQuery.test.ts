import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { spawnSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildContextPack } from '../../scripts/repo-index/contextPack'
import { generateRepoIndexToDirectory } from '../../scripts/repo-index/generator'
import {
  collectInputInventory,
  loadRepoIndexConfig,
  type InputInventoryResult,
} from '../../scripts/repo-index/inputInventory'
import {
  assessFreshness,
  clearQueryCache,
  collectGitDirtyInputs,
  parseQueryCliArguments,
  RepoIndexQueryEngine,
  type DirtyInput,
} from '../../scripts/repo-index/query'
import { writeContextPackOutput } from '../../scripts/query-repo-index'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const temporaryRoot = mkdtempSync(resolve(tmpdir(), 'ittoedu-repo-query-test-'))
const generatedDirectory = resolve(temporaryRoot, 'generated')

function parseJsonLines<T>(path: string): T[] {
  const text = readFileSync(path, 'utf8').trim()
  return text.length === 0
    ? []
    : text.split('\n').map((line) => JSON.parse(line) as T)
}

function createEngine(dirtyInputs: readonly DirtyInput[] = []): RepoIndexQueryEngine {
  return new RepoIndexQueryEngine({
    repoRoot,
    generatedDirectory,
    dirtyInputs,
  })
}

beforeAll(() => {
  generateRepoIndexToDirectory(repoRoot, generatedDirectory)
  clearQueryCache()
}, 20_000)

afterAll(() => {
  rmSync(temporaryRoot, { recursive: true, force: true })
})

describe('repo-index query and Context Pack', () => {
  it('enforces mutually exclusive CLI modes and sizes', () => {
    expect(parseQueryCliArguments(['--feature', 'components'])).toEqual({
      request: { mode: 'feature', value: 'components', size: 'medium' },
    })
    expect(parseQueryCliArguments(['--symbol', 'buildPublishedCourseV2Payload', '--size', 'small']))
      .toMatchObject({ request: { mode: 'symbol', size: 'small' } })
    expect(parseQueryCliArguments(['--path', 'src/renderer/App.tsx', '--size', 'large']))
      .toMatchObject({ request: { mode: 'path', size: 'large' } })
    expect(parseQueryCliArguments(['--changed'])).toMatchObject({
      request: { mode: 'changed' },
    })
    expect(parseQueryCliArguments(['--query', 'Flow 图片替换保存重开']))
      .toMatchObject({ request: { mode: 'query' } })
    expect(() => parseQueryCliArguments([])).toThrow(/Exactly one query mode/)
    expect(() =>
      parseQueryCliArguments(['--feature', 'components', '--query', 'components'])
    ).toThrow(/Exactly one query mode/)
    expect(() => parseQueryCliArguments(['--feature', 'x', '--size', 'huge']))
      .toThrow(/small, medium, or large/)
  })

  it('matches exact Feature suffix/name/NFKC aliases without Legacy override', () => {
    const engine = createEngine()
    for (const value of ['components', 'Components', 'Ｃｏｍｐｏｎｅｎｔｓ']) {
      const result = engine.query({ mode: 'feature', value, size: 'small' })
      expect(result).toMatchObject({
        confidence: 'high',
        bootstrapRequired: false,
        matchedFeature: { id: 'feature:components' },
        freshness: { status: 'fresh', safeForS2: true },
      })
    }

    const text = engine.query({
      mode: 'query',
      value: 'HTML web package preview',
      size: 'small',
    })
    expect(text.candidates[0]?.id).toBe('feature:html-web-export')
    const legacyRank = text.candidates.findIndex(
      (candidate) => candidate.id === 'feature:legacy-release',
    )
    expect(legacyRank === -1 || legacyRank > 0).toBe(true)
  })

  it('prioritizes exact symbol and path facts', () => {
    const engine = createEngine()
    const symbol = engine.query({
      mode: 'symbol',
      value: 'buildPublishedCourseV2Payload',
      size: 'small',
    })
    expect(symbol).toMatchObject({ confidence: 'high', bootstrapRequired: false })
    expect(symbol.matchedSymbols).toEqual([
      expect.objectContaining({
        name: 'buildPublishedCourseV2Payload',
        file: 'src/renderer/export/course/buildPublishedCourse.ts',
      }),
    ])

    const path = engine.query({
      mode: 'path',
      value: 'src/renderer/App.tsx',
      size: 'small',
    })
    expect(path).toMatchObject({ confidence: 'high', bootstrapRequired: false })
    expect(path.matchedFiles).toEqual([
      expect.objectContaining({ path: 'src/renderer/App.tsx' }),
    ])
  })

  it('returns deterministic changed paths and marks relevant dirty state unsafe', () => {
    const dirty = [{ path: 'src/renderer/App.tsx', status: ' M' }]
    const result = createEngine(dirty).query({ mode: 'changed', size: 'small' })
    expect(result).toMatchObject({
      confidence: 'high',
      bootstrapRequired: true,
      freshness: {
        status: 'stale',
        safeForS2: false,
        relevantDirtyInputs: dirty,
      },
    })
    expect(result.candidates[0]).toMatchObject({
      kind: 'path',
      label: 'src/renderer/App.tsx',
    })
  })

  it('keeps external Catalog and ambiguous free text low-confidence with Bootstrap fallback', () => {
    const engine = createEngine()
    const external = engine.query({
      mode: 'query',
      value: 'courseware-components external catalog source',
      size: 'small',
    })
    expect(external).toMatchObject({
      confidence: 'low',
      bootstrapRequired: true,
      matchedFeature: { id: 'feature:components' },
    })
    expect(external.unknowns.join(' ')).toContain('external-source-unavailable')

    const unknown = engine.query({
      mode: 'query',
      value: 'totally-unmapped-quantum-widget',
      size: 'small',
    })
    expect(unknown).toMatchObject({ confidence: 'low', bootstrapRequired: true })
    expect(unknown.matchedFeature).toBeUndefined()
    expect(unknown.relevantPaths).toEqual([])
  })

  it('forces GT-024/025 external package-source wording onto the local Components boundary', () => {
    const engine = createEngine()
    const goldenExternalQueries = [
      // GT-024 original package-identity/source wording.
      'com.ittoedu.*@version + runtime.js/源码/修复',
      // GT-025 original latest third-party Catalog/source wording.
      'Catalog 里最新的第三方组件…源码',
    ]
    for (const value of goldenExternalQueries) {
      const external = engine.query({ mode: 'query', value, size: 'small' })
      expect(external).toMatchObject({
        confidence: 'low',
        bootstrapRequired: true,
        matchedFeature: { id: 'feature:components' },
      })
      expect(external.candidates[0]).toMatchObject({ id: 'feature:components' })
      expect(external.unknowns.join(' ')).toContain('external-source-unavailable')
      for (const canonical of external.matchedFeature?.canonicalFiles ?? []) {
        expect(external.relevantPaths).toContain(canonical)
      }
      expect(external.relevantPaths.join(' ')).not.toMatch(
        /courseware-components|com\.ittoedu\.|runtime\.js/,
      )
    }
  })

  it('distinguishes fresh, partially-stale, stale, and relevant dirty inputs', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(generatedDirectory, 'manifest.json'), 'utf8'),
    )
    const storedInventory = parseJsonLines<any>(
      resolve(generatedDirectory, 'input-inventory.jsonl'),
    )
    const currentInventory = collectInputInventory(repoRoot, loadRepoIndexConfig(repoRoot))
    const raw = { manifest, storedInventory, currentInventory, dirtyInputs: [] }
    expect(assessFreshness(raw, ['src/renderer/App.tsx'])).toMatchObject({
      status: 'fresh',
      safeForS2: true,
    })

    const unrelated: InputInventoryResult = {
      hashes: { ...currentInventory.hashes, source: 'sha256:unrelated' },
      records: [
        ...currentInventory.records,
        {
          path: 'docs/unrelated.md',
          domain: 'source',
          contentHash: 'sha256:unrelated',
          bytes: 1,
        },
      ],
    }
    expect(assessFreshness({ ...raw, currentInventory: unrelated }, ['src/renderer/App.tsx']))
      .toMatchObject({ status: 'partially-stale', safeForS2: false })

    const relevant: InputInventoryResult = {
      hashes: { ...currentInventory.hashes, source: 'sha256:relevant' },
      records: currentInventory.records.map((record) =>
        record.path === 'src/renderer/App.tsx'
          ? { ...record, contentHash: 'sha256:changed' }
          : record,
      ),
    }
    expect(assessFreshness({ ...raw, currentInventory: relevant }, ['src/renderer/App.tsx']))
      .toMatchObject({ status: 'stale', safeForS2: false })
    expect(assessFreshness(
      { ...raw, dirtyInputs: [{ path: 'src/renderer/App.tsx', status: ' M' }] },
      ['src/renderer/App.tsx'],
    )).toMatchObject({ status: 'stale', safeForS2: false })
  })

  it('uses git argument arrays and preserves unusual dirty filenames', () => {
    const gitRoot = resolve(temporaryRoot, 'git-status')
    mkdirSync(gitRoot, { recursive: true })
    const init = spawnSync('git', ['init', '--quiet'], {
      cwd: gitRoot,
      shell: false,
      windowsHide: true,
    })
    expect(init.status).toBe(0)
    writeFileSync(resolve(gitRoot, 'odd;name.ts'), 'export const value = 1\n')
    expect(collectGitDirtyInputs(gitRoot)).toContainEqual({
      path: 'odd;name.ts',
      status: '??',
    })
  })

  it('renders every required section below the selected upper budget without padding', () => {
    const engine = createEngine()
    const result = engine.query({ mode: 'feature', value: 'components', size: 'small' })
    const pack = buildContextPack(result, engine.invariants, engine.exclusions)
    for (const heading of [
      '## Freshness / Dirty Inputs',
      '## Matched Feature and Confidence',
      '## Current Status',
      '## Canonical Contract and Carrier',
      '## Start Here',
      '## Write Path',
      '## Runtime / Preview / Export Consumers',
      '## Related Tests',
      '## Current Must Preserve',
      '## Transitional Legacy',
      '## Do Not Read Unless Needed',
      '## Suggested Minimal Validation',
      '## Unknowns',
    ]) {
      expect(pack.markdown).toContain(heading)
    }
    expect(pack.bytes).toBeLessThanOrEqual(20 * 1024)
    expect(pack.lines).toBeLessThanOrEqual(350)
    expect(pack.bytes).toBeLessThan(12 * 1024)
    expect(pack.markdown.toLowerCase()).not.toContain(repoRoot.toLowerCase())

  })

  it('allows only OS-temporary absolute output or ignored repository contexts', () => {
    const engine = createEngine()
    const result = engine.query({ mode: 'feature', value: 'components', size: 'small' })
    const pack = buildContextPack(result, engine.invariants, engine.exclusions)
    const safeTemporary = resolve(temporaryRoot, 'output/context.md')
    writeContextPackOutput(repoRoot, safeTemporary, pack.markdown)
    expect(readFileSync(safeTemporary, 'utf8')).toBe(pack.markdown)
    expect(() =>
      writeContextPackOutput(repoRoot, 'context.md', pack.markdown)
    ).toThrow(/repo-index\/contexts/)
    const unsafeAbsolute = resolve(repoRoot, '../context-outside-repo.md')
    expect(existsSync(unsafeAbsolute)).toBe(false)
    expect(() =>
      writeContextPackOutput(repoRoot, unsafeAbsolute, pack.markdown)
    ).toThrow(/OS temporary directory/)
    expect(existsSync(unsafeAbsolute)).toBe(false)
  })

  it('keeps cached query P95 below two seconds', () => {
    const engine = createEngine()
    const durations: number[] = []
    for (let index = 0; index < 30; index += 1) {
      const started = performance.now()
      engine.query({ mode: 'feature', value: 'components', size: 'small' })
      durations.push(performance.now() - started)
    }
    durations.sort((left, right) => left - right)
    const p95 = durations[Math.ceil(durations.length * 0.95) - 1]
    expect(p95).toBeLessThan(2_000)
  })
})
