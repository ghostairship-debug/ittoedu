import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  buildGateMetrics,
  evaluateGoldenTasks,
  loadGoldenCorpus,
  rankQueryPaths,
  type GoldenTaskEvaluation,
  type GoldenThresholds,
} from '../../scripts/repo-index/evaluateGoldenTasks'
import type { QueryResult } from '../../scripts/repo-index/query'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

const requiredCoverage = [
  'slide',
  'flow',
  'spatial',
  'media',
  'components',
  'runtime',
  'interactions',
  'layers',
  'controller',
  'save',
  'recovery',
  'preview',
  'player',
  'html',
  'web',
  'pptx',
  'pdf',
  'docx',
  'diagnostics',
  'developer-tab',
  'main',
  'preload',
  'ipc',
  'tsconfig',
  'release',
] as const

function syntheticQueryResult(): QueryResult {
  return {
    request: { mode: 'feature', value: 'synthetic', size: 'medium' },
    confidence: 'high',
    bootstrapRequired: false,
    matchedFeature: {
      id: 'feature:synthetic',
      name: 'Synthetic',
      aliases: [],
      statusClass: 'current-debt',
      canonicalFiles: ['canonical-a.ts', 'shared.ts'],
      entrypoints: ['entrypoint-b.ts', 'shared.ts'],
      runtimeConsumers: ['runtime-f.ts'],
    },
    matchedSymbols: [{
      id: 'symbol:exact-d',
      file: 'exact-d.ts',
      name: 'exactD',
      kind: 'function',
      line: 1,
      endLine: 2,
      exported: true,
      exportedAs: ['exactD'],
    }],
    matchedFiles: [{
      id: 'file:exact-c.ts',
      path: 'exact-c.ts',
      kind: 'typescript',
      projects: [],
      exports: [],
      tags: [],
    }],
    candidates: [{
      kind: 'feature',
      id: 'candidate:e',
      label: 'Candidate E',
      score: 10,
      reasons: ['synthetic'],
      paths: ['candidate-e.ts', 'canonical-a.ts'],
    }],
    relevantPaths: ['related-g.ts', 'canonical-a.ts'],
    relatedTests: [{
      id: 'test:h',
      file: 'related-test-h.ts',
      kind: 'it',
      name: 'h',
      line: 1,
      suite: [],
      runnable: true,
      command: 'npx vitest run related-test-h.ts',
      relatedFiles: [],
    }],
    relatedEdges: [{
      id: 'edge:i',
      kind: 'imports',
      from: 'file:edge-i.ts',
      to: 'module:external',
      resolved: false,
    }],
    modules: [],
    freshness: {
      status: 'fresh',
      safeForS2: true,
      domainMatches: { source: true, semantic: true, config: true, tool: true },
      changedInputs: [],
      dirtyInputs: [],
      relevantDirtyInputs: [],
      reasons: [],
    },
    unknowns: [],
  }
}

function syntheticEvaluation(
  id: string,
  input: Partial<GoldenTaskEvaluation> = {},
): GoldenTaskEvaluation {
  return {
    id,
    milestone: 'controlled-15',
    title: id,
    request: { mode: 'feature', value: id, size: 'medium' },
    confidence: 'high',
    bootstrapRequired: false,
    queryMs: 1,
    rankedPaths: [],
    top5: ['canonical.ts'],
    top15: ['canonical.ts', 'test.ts'],
    mustHitTop5: {
      expected: ['canonical.ts'],
      hits: ['canonical.ts'],
      misses: [],
    },
    requiredTop15: {
      expected: ['test.ts'],
      hits: ['test.ts'],
      misses: [],
    },
    forbiddenTop5: { expected: ['legacy.ts'], hits: [] },
    expectation: {
      confidenceMatches: true,
      bootstrapMatches: true,
      featureMatches: true,
    },
    highConfidenceWrongReasons: [],
    lowConfidenceCorrect: null,
    contextPack: { bytes: 100, lines: 10 },
    bootstrapLocator: {
      command: 'git ls-files -- canonical.ts test.ts',
      locatorMs: 1,
      paths: ['canonical.ts', 'test.ts'],
      readPathBytes: 1000,
    },
    ...input,
  }
}

describe('repo-index golden task gates', () => {
  it('loads the fixed 15/25 corpus with full coverage and hard external fallbacks', () => {
    const { taskCollection, expectedCollection } = loadGoldenCorpus(repoRoot)
    expect(taskCollection.tasks).toHaveLength(25)
    expect(taskCollection.tasks.slice(0, 15).every(
      ({ milestone }) => milestone === 'controlled-15',
    )).toBe(true)
    expect(taskCollection.tasks.slice(15).every(
      ({ milestone }) => milestone === 'extended-25',
    )).toBe(true)
    const coverage = new Set(taskCollection.tasks.flatMap(({ coverage }) => coverage))
    requiredCoverage.forEach((value) => expect(coverage.has(value), value).toBe(true))

    for (const record of expectedCollection.expected) {
      expect(record.mustHitTop5.length).toBeGreaterThan(0)
      expect(record.mustHitTop5.length).toBeLessThanOrEqual(5)
      expect(record.requiredTop15.length).toBeGreaterThan(0)
      expect(record.requiredTop15.length).toBeLessThanOrEqual(15)
      expect(new Set(record.mustHitTop5).size).toBe(record.mustHitTop5.length)
      expect(new Set(record.requiredTop15).size).toBe(record.requiredTop15.length)
      expect(new Set(record.forbiddenTop5).size).toBe(record.forbiddenTop5.length)
    }
    for (const id of ['GT-024', 'GT-025']) {
      const record = expectedCollection.expected.find((candidate) => candidate.id === id)
      expect(record?.expected).toMatchObject({
        confidence: 'low',
        bootstrapRequired: true,
        matchedFeatureId: 'feature:components',
      })
    }
  })

  it('ranks unique paths by query mode without treating broad feature matches as exact', () => {
    expect(rankQueryPaths(syntheticQueryResult())).toEqual([
      { rank: 1, path: 'canonical-a.ts', source: 'canonical', reason: 'feature:synthetic:canonical' },
      { rank: 2, path: 'shared.ts', source: 'canonical', reason: 'feature:synthetic:canonical' },
      { rank: 3, path: 'entrypoint-b.ts', source: 'entrypoint', reason: 'feature:synthetic:entrypoint' },
      { rank: 4, path: 'candidate-e.ts', source: 'candidate', reason: 'candidate:candidate:e' },
      { rank: 5, path: 'runtime-f.ts', source: 'related', reason: 'feature:synthetic:runtime-consumer' },
      { rank: 6, path: 'related-g.ts', source: 'related', reason: 'query-relevant' },
      { rank: 7, path: 'related-test-h.ts', source: 'related', reason: 'related-test:test:h' },
      { rank: 8, path: 'edge-i.ts', source: 'related', reason: 'edge:imports' },
    ])

    const queryBase = syntheticQueryResult()
    const queryResult: QueryResult = {
      ...queryBase,
      request: { mode: 'query', value: 'exactD', size: 'medium' },
      candidates: queryBase.candidates.map((candidate, index) => index === 0
        ? { ...candidate, paths: ['exact-d.ts', ...candidate.paths] }
        : candidate),
    }
    expect(rankQueryPaths(queryResult).find(({ path }) => path === 'exact-d.ts'))
      .toMatchObject({ source: 'candidate', reason: 'candidate:candidate:e' })
    expect(rankQueryPaths(queryResult).some(({ path }) => path === 'exact-c.ts'))
      .toBe(false)

    for (const mode of ['symbol', 'path', 'changed'] as const) {
      const exactResult = syntheticQueryResult()
      exactResult.request = { mode, value: 'exactD', size: 'medium' }
      expect(rankQueryPaths(exactResult).slice(0, 5).map(({ path, source }) => ({ path, source })))
        .toEqual([
          { path: 'exact-c.ts', source: 'exact' },
          { path: 'exact-d.ts', source: 'exact' },
          { path: 'canonical-a.ts', source: 'canonical' },
          { path: 'shared.ts', source: 'canonical' },
          { path: 'entrypoint-b.ts', source: 'entrypoint' },
        ])
    }
  })

  it('computes hard metrics without requiring the live corpus to pass', () => {
    const thresholds: GoldenThresholds = {
      hitAt5: 0.9,
      recallAt15: 0.85,
      highConfidenceWrong: 0,
      queryP95Ms: 2000,
      generationMs: 10000,
      determinismRequired: true,
    }
    const passed = buildGateMetrics(
      [syntheticEvaluation('GT-X')],
      thresholds,
      100,
      true,
      true,
    )
    expect(passed).toMatchObject({
      pass: true,
      hitAt5: 1,
      canonicalRecallAt5: 1,
      recallAt15: 1,
    })

    const failed = buildGateMetrics([
      syntheticEvaluation('GT-Y', {
        mustHitTop5: { expected: ['canonical.ts'], hits: [], misses: ['canonical.ts'] },
      }),
    ], thresholds, 100, true, true)
    expect(failed.pass).toBe(false)
    expect(failed.failedChecks).toContain('hitAt5')
    expect(failed.taskGaps.zeroHitAt5).toEqual(['GT-Y'])
  })

  it(
    'runs the real corpus twice internally and returns deterministic diagnostics',
    () => {
      const report = evaluateGoldenTasks(repoRoot)
      expect(report.tasks).toHaveLength(25)
      expect(report.controlled15.taskCount).toBe(15)
      expect(report.broad25.taskCount).toBe(25)
      expect(report.generation.deterministic).toBe(true)
      expect(report.queryDeterministic).toBe(true)
      expect(report.qualitySignature).toMatch(/^[a-f0-9]{64}$/)
      for (const id of ['GT-024', 'GT-025']) {
        expect(report.tasks.find((task) => task.id === id)).toMatchObject({
          confidence: 'low',
          bootstrapRequired: true,
          lowConfidenceCorrect: true,
        })
      }
    },
    30_000,
  )
})
