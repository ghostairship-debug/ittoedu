import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'

import { buildContextPack } from './contextPack'
import {
  generateRepoIndexToDirectory,
  hashGeneratedDirectory,
} from './generator'
import {
  RepoIndexQueryEngine,
  type DirtyInput,
  type QueryConfidence,
  type QueryMode,
  type QueryResult,
} from './query'

export interface GoldenTask {
  id: string
  milestone: 'controlled-15' | 'extended-25'
  title: string
  queryText: string
  request: {
    mode: QueryMode
    value?: string
    size: 'small' | 'medium' | 'large'
  }
  coverage: string[]
  rationale: string
  evidence: string[]
  dirtyInputs?: DirtyInput[]
}

export interface GoldenExpected {
  id: string
  mustHitTop5: string[]
  requiredTop15: string[]
  forbiddenTop5: string[]
  expected: {
    confidence: QueryConfidence
    bootstrapRequired: boolean
    matchedFeatureId?: string
  }
}

interface GoldenTaskCollection {
  schemaVersion: 1
  corpusVersion: 1
  controlledMilestoneCount: number
  broadGateCount: number
  tasks: GoldenTask[]
}

interface GoldenExpectedCollection {
  schemaVersion: 1
  thresholds: GoldenThresholds
  expected: GoldenExpected[]
}

export interface GoldenThresholds {
  hitAt5: number
  recallAt15: number
  highConfidenceWrong: number
  queryP95Ms: number
  generationMs: number
  determinismRequired: boolean
}

export type RankedPathSource =
  | 'canonical'
  | 'entrypoint'
  | 'exact'
  | 'candidate'
  | 'related'

export interface RankedPath {
  rank: number
  path: string
  source: RankedPathSource
  reason: string
}

export interface GoldenTaskEvaluation {
  id: string
  milestone: GoldenTask['milestone']
  title: string
  request: GoldenTask['request']
  confidence: QueryConfidence
  bootstrapRequired: boolean
  matchedFeatureId?: string
  queryMs: number
  rankedPaths: RankedPath[]
  top5: string[]
  top15: string[]
  mustHitTop5: {
    expected: string[]
    hits: string[]
    misses: string[]
  }
  requiredTop15: {
    expected: string[]
    hits: string[]
    misses: string[]
  }
  forbiddenTop5: {
    expected: string[]
    hits: string[]
  }
  expectation: {
    confidenceMatches: boolean
    bootstrapMatches: boolean
    featureMatches: boolean
  }
  highConfidenceWrongReasons: string[]
  lowConfidenceCorrect: boolean | null
  contextPack: {
    bytes: number
    lines: number
  }
  bootstrapLocator: {
    command: string
    locatorMs: number
    paths: string[]
    readPathBytes: number
  }
}

export interface GoldenGateMetrics {
  taskCount: number
  canonicalTaskHits: number
  hitAt5: number
  canonicalExpected: number
  canonicalHits: number
  canonicalRecallAt5: number
  requiredExpected: number
  requiredHits: number
  recallAt15: number
  forbiddenTop5Count: number
  highConfidenceWrongCount: number
  expectationMismatchCount: number
  lowConfidenceExpectedCount: number
  lowConfidenceCorrectCount: number
  queryP95Ms: number
  bootstrapLocatorP95Ms: number
  bootstrapLocatorTotalMs: number
  contextPackBytes: number
  bootstrapReadPathBytes: number
  contextVolumeReduction: number
  generationMaxMs: number
  indexDeterministic: boolean
  queryDeterministic: boolean
  pass: boolean
  failedChecks: string[]
  taskGaps: {
    zeroHitAt5: string[]
    partialCanonicalAt5: string[]
    requiredRecallAt15: string[]
    forbiddenTop5: string[]
    highConfidenceWrong: string[]
    expectations: string[]
    lowConfidence: string[]
  }
}

export interface GoldenQualityReport {
  schemaVersion: 1
  corpusVersion: 1
  thresholds: GoldenThresholds
  generation: {
    firstMs: number
    secondMs: number
    firstHash: string
    secondHash: string
    deterministic: boolean
  }
  queryDeterministic: boolean
  qualitySignature: string
  controlled15: GoldenGateMetrics
  broad25: GoldenGateMetrics
  tasks: GoldenTaskEvaluation[]
  bootstrapComparisonNote: string
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function percentile(values: readonly number[], percentileValue: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.max(0, Math.ceil(percentileValue * sorted.length) - 1)
  return sorted[index] ?? 0
}

function edgeFilePath(id: string): string | undefined {
  return id.startsWith('file:') ? id.slice('file:'.length) : undefined
}

/**
 * Ranking is deliberately small and explainable. It does not reproduce the
 * import graph: semantic canonical files win, then semantic entrypoints,
 * exact file/symbol matches, ordered candidates, and finally related evidence.
 */
export function rankQueryPaths(result: QueryResult): RankedPath[] {
  const ranked: Omit<RankedPath, 'rank'>[] = []
  const seen = new Set<string>()
  const add = (path: string | undefined, source: RankedPathSource, reason: string): void => {
    if (!path || seen.has(path)) return
    seen.add(path)
    ranked.push({ path, source, reason })
  }

  const addSemantic = (): void => {
    result.matchedFeature?.canonicalFiles?.forEach((path) =>
      add(path, 'canonical', `${result.matchedFeature?.id}:canonical`),
    )
    result.matchedFeature?.entrypoints?.forEach((path) =>
      add(path, 'entrypoint', `${result.matchedFeature?.id}:entrypoint`),
    )
  }
  const addExact = (): void => {
    result.matchedFiles.forEach((file) => add(file.path, 'exact', `matched-file:${file.id}`))
    result.matchedSymbols.forEach((symbol) =>
      add(symbol.file, 'exact', `matched-symbol:${symbol.name}`),
    )
  }
  if (['symbol', 'path', 'changed'].includes(result.request.mode)) {
    addExact()
    addSemantic()
  } else {
    addSemantic()
    addExact()
  }
  result.candidates.forEach((candidate) => {
    candidate.paths.forEach((path) => add(path, 'candidate', `candidate:${candidate.id}`))
  })
  result.matchedFeature?.runtimeConsumers?.forEach((path) =>
    add(path, 'related', `${result.matchedFeature?.id}:runtime-consumer`),
  )
  result.relevantPaths.forEach((path) => add(path, 'related', 'query-relevant'))
  result.relatedTests.forEach((test) => add(test.file, 'related', `related-test:${test.id}`))
  result.relatedEdges.forEach((edge) => {
    add(edgeFilePath(edge.from), 'related', `edge:${edge.kind}`)
    add(edgeFilePath(edge.to), 'related', `edge:${edge.kind}`)
  })

  return ranked.map((entry, index) => ({ ...entry, rank: index + 1 }))
}

export function loadGoldenCorpus(repoRoot: string): {
  taskCollection: GoldenTaskCollection
  expectedCollection: GoldenExpectedCollection
} {
  const taskCollection = readJson<GoldenTaskCollection>(
    resolve(repoRoot, 'repo-index/golden-tasks/tasks.json'),
  )
  const expectedCollection = readJson<GoldenExpectedCollection>(
    resolve(repoRoot, 'repo-index/golden-tasks/expected.json'),
  )
  if (taskCollection.schemaVersion !== 1 || taskCollection.corpusVersion !== 1) {
    throw new Error('Golden task corpus version is unsupported')
  }
  if (expectedCollection.schemaVersion !== 1) {
    throw new Error('Golden expected schema version is unsupported')
  }
  if (taskCollection.tasks.length !== taskCollection.broadGateCount) {
    throw new Error('Golden task count does not match broadGateCount')
  }
  if (expectedCollection.expected.length !== taskCollection.tasks.length) {
    throw new Error('Golden task/expected counts differ')
  }

  const taskIds = taskCollection.tasks.map(({ id }) => id)
  const expectedIds = expectedCollection.expected.map(({ id }) => id)
  if (new Set(taskIds).size !== taskIds.length || new Set(expectedIds).size !== expectedIds.length) {
    throw new Error('Golden task IDs must be unique')
  }
  if (taskIds.some((id, index) => id !== expectedIds[index])) {
    throw new Error('Golden task and expected IDs must have the same stable order')
  }
  const controlled = taskCollection.tasks.filter(({ milestone }) => milestone === 'controlled-15')
  if (controlled.length !== taskCollection.controlledMilestoneCount) {
    throw new Error('Controlled milestone count is invalid')
  }

  const pathFields = expectedCollection.expected.flatMap((record) => [
    ...record.mustHitTop5,
    ...record.requiredTop15,
    ...record.forbiddenTop5,
  ])
  const evidencePaths = taskCollection.tasks.flatMap(({ evidence }) => evidence)
  for (const path of unique([...pathFields, ...evidencePaths])) {
    if (
      path.startsWith('/') ||
      path.startsWith('../') ||
      path.includes('\\') ||
      /^[A-Za-z]:[\\/]/.test(path)
    ) {
      throw new Error(`Golden paths must be repository-relative POSIX paths: ${path}`)
    }
    try {
      statSync(resolve(repoRoot, path))
    } catch {
      throw new Error(`Golden evidence path does not exist: ${path}`)
    }
  }
  return { taskCollection, expectedCollection }
}

function runBootstrapLocator(
  repoRoot: string,
  expected: GoldenExpected,
): GoldenTaskEvaluation['bootstrapLocator'] {
  const paths = unique([...expected.mustHitTop5, ...expected.requiredTop15]).sort(compareText)
  const startedAt = performance.now()
  const result = spawnSync('git', ['ls-files', '-z', '--', ...paths], {
    cwd: repoRoot,
    encoding: 'buffer',
    windowsHide: true,
    shell: false,
  })
  const locatorMs = performance.now() - startedAt
  if (result.status !== 0) {
    throw new Error(`Golden Bootstrap locator failed for ${expected.id}`)
  }
  const matched = (result.stdout ?? Buffer.alloc(0))
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .sort(compareText)
  if (matched.length !== paths.length || matched.some((path, index) => path !== paths[index])) {
    throw new Error(`Golden Bootstrap locator did not return every expected path for ${expected.id}`)
  }
  const readPathBytes = paths.reduce((total, path) => total + statSync(resolve(repoRoot, path)).size, 0)
  return {
    command: `git ls-files -- ${paths.join(' ')}`,
    locatorMs,
    paths,
    readPathBytes,
  }
}

function evaluateTask(
  repoRoot: string,
  generatedDirectory: string,
  task: GoldenTask,
  expected: GoldenExpected,
): GoldenTaskEvaluation {
  const engine = new RepoIndexQueryEngine({
    repoRoot,
    generatedDirectory,
    dirtyInputs: task.dirtyInputs ?? [],
  })
  const startedAt = performance.now()
  const result = engine.query(task.request)
  const queryMs = performance.now() - startedAt
  const rankedPaths = rankQueryPaths(result)
  const top5 = rankedPaths.slice(0, 5).map(({ path }) => path)
  const top15 = rankedPaths.slice(0, 15).map(({ path }) => path)
  const mustHits = expected.mustHitTop5.filter((path) => top5.includes(path))
  const requiredHits = expected.requiredTop15.filter((path) => top15.includes(path))
  const forbiddenHits = expected.forbiddenTop5.filter((path) => top5.includes(path))
  const featureMatches = expected.expected.matchedFeatureId === undefined ||
    result.matchedFeature?.id === expected.expected.matchedFeatureId
  const confidenceMatches = result.confidence === expected.expected.confidence
  const bootstrapMatches = result.bootstrapRequired === expected.expected.bootstrapRequired
  const highConfidenceWrongReasons: string[] = []
  if (result.confidence === 'high') {
    if (expected.expected.confidence === 'low') {
      highConfidenceWrongReasons.push('expected-low-confidence')
    }
    if (!featureMatches) highConfidenceWrongReasons.push('wrong-matched-feature')
    if (mustHits.length === 0) highConfidenceWrongReasons.push('no-canonical-hit-in-top5')
    if (forbiddenHits.length > 0) highConfidenceWrongReasons.push('forbidden-path-in-top5')
  }
  const pack = buildContextPack(result, engine.invariants, engine.exclusions)
  return {
    id: task.id,
    milestone: task.milestone,
    title: task.title,
    request: task.request,
    confidence: result.confidence,
    bootstrapRequired: result.bootstrapRequired,
    ...(result.matchedFeature ? { matchedFeatureId: result.matchedFeature.id } : {}),
    queryMs,
    rankedPaths,
    top5,
    top15,
    mustHitTop5: {
      expected: expected.mustHitTop5,
      hits: mustHits,
      misses: expected.mustHitTop5.filter((path) => !top5.includes(path)),
    },
    requiredTop15: {
      expected: expected.requiredTop15,
      hits: requiredHits,
      misses: expected.requiredTop15.filter((path) => !top15.includes(path)),
    },
    forbiddenTop5: {
      expected: expected.forbiddenTop5,
      hits: forbiddenHits,
    },
    expectation: { confidenceMatches, bootstrapMatches, featureMatches },
    highConfidenceWrongReasons,
    lowConfidenceCorrect: expected.expected.confidence === 'low'
      ? result.confidence === 'low' && result.bootstrapRequired
      : null,
    contextPack: { bytes: pack.bytes, lines: pack.lines },
    bootstrapLocator: runBootstrapLocator(repoRoot, expected),
  }
}

function stableTaskSignature(tasks: readonly GoldenTaskEvaluation[]): string {
  const stable = tasks.map((task) => ({
    id: task.id,
    confidence: task.confidence,
    bootstrapRequired: task.bootstrapRequired,
    matchedFeatureId: task.matchedFeatureId ?? null,
    rankedPaths: task.rankedPaths.map(({ path, source, reason }) => ({ path, source, reason })),
    mustHitTop5: task.mustHitTop5,
    requiredTop15: task.requiredTop15,
    forbiddenTop5: task.forbiddenTop5,
    expectation: task.expectation,
    highConfidenceWrongReasons: task.highConfidenceWrongReasons,
    lowConfidenceCorrect: task.lowConfidenceCorrect,
    contextPack: task.contextPack,
    bootstrapPaths: task.bootstrapLocator.paths,
    bootstrapReadPathBytes: task.bootstrapLocator.readPathBytes,
  }))
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex')
}

function taskGapIds(
  tasks: readonly GoldenTaskEvaluation[],
  predicate: (task: GoldenTaskEvaluation) => boolean,
): string[] {
  return tasks.filter(predicate).map(({ id }) => id)
}

export function buildGateMetrics(
  tasks: readonly GoldenTaskEvaluation[],
  thresholds: GoldenThresholds,
  generationMaxMs: number,
  indexDeterministic: boolean,
  queryDeterministic: boolean,
): GoldenGateMetrics {
  const canonicalExpected = tasks.reduce((sum, task) => sum + task.mustHitTop5.expected.length, 0)
  const canonicalHits = tasks.reduce((sum, task) => sum + task.mustHitTop5.hits.length, 0)
  const canonicalTaskHits = tasks.filter((task) => task.mustHitTop5.hits.length > 0).length
  const requiredExpected = tasks.reduce((sum, task) => sum + task.requiredTop15.expected.length, 0)
  const requiredHits = tasks.reduce((sum, task) => sum + task.requiredTop15.hits.length, 0)
  const hitAt5 = tasks.length === 0 ? 0 : canonicalTaskHits / tasks.length
  const canonicalRecallAt5 = canonicalExpected === 0 ? 0 : canonicalHits / canonicalExpected
  const recallAt15 = requiredExpected === 0 ? 0 : requiredHits / requiredExpected
  const forbiddenTop5Count = tasks.reduce((sum, task) => sum + task.forbiddenTop5.hits.length, 0)
  const highConfidenceWrongCount = tasks.filter(
    (task) => task.highConfidenceWrongReasons.length > 0,
  ).length
  const expectationMismatchCount = tasks.filter((task) =>
    !task.expectation.confidenceMatches ||
    !task.expectation.bootstrapMatches ||
    !task.expectation.featureMatches,
  ).length
  const lowConfidenceTasks = tasks.filter((task) => task.lowConfidenceCorrect !== null)
  const lowConfidenceCorrectCount = lowConfidenceTasks.filter(
    (task) => task.lowConfidenceCorrect === true,
  ).length
  const queryP95Ms = percentile(tasks.map(({ queryMs }) => queryMs), 0.95)
  const bootstrapLocatorP95Ms = percentile(
    tasks.map(({ bootstrapLocator }) => bootstrapLocator.locatorMs),
    0.95,
  )
  const bootstrapLocatorTotalMs = tasks.reduce(
    (sum, task) => sum + task.bootstrapLocator.locatorMs,
    0,
  )
  const contextPackBytes = tasks.reduce((sum, task) => sum + task.contextPack.bytes, 0)
  const bootstrapReadPathBytes = tasks.reduce(
    (sum, task) => sum + task.bootstrapLocator.readPathBytes,
    0,
  )
  const contextVolumeReduction = bootstrapReadPathBytes === 0
    ? 0
    : 1 - contextPackBytes / bootstrapReadPathBytes
  const failedChecks: string[] = []
  if (hitAt5 < thresholds.hitAt5) failedChecks.push('hitAt5')
  if (recallAt15 < thresholds.recallAt15) failedChecks.push('recallAt15')
  if (forbiddenTop5Count > 0) failedChecks.push('forbiddenTop5')
  if (highConfidenceWrongCount > thresholds.highConfidenceWrong) {
    failedChecks.push('highConfidenceWrong')
  }
  if (expectationMismatchCount > 0) failedChecks.push('confidenceOrBootstrapExpectation')
  if (lowConfidenceCorrectCount !== lowConfidenceTasks.length) {
    failedChecks.push('lowConfidenceDegrade')
  }
  if (queryP95Ms >= thresholds.queryP95Ms) failedChecks.push('queryP95')
  if (generationMaxMs >= thresholds.generationMs) failedChecks.push('generationTime')
  if (thresholds.determinismRequired && (!indexDeterministic || !queryDeterministic)) {
    failedChecks.push('determinism')
  }
  if (contextVolumeReduction <= 0) failedChecks.push('contextVolume')

  return {
    taskCount: tasks.length,
    canonicalTaskHits,
    hitAt5,
    canonicalExpected,
    canonicalHits,
    canonicalRecallAt5,
    requiredExpected,
    requiredHits,
    recallAt15,
    forbiddenTop5Count,
    highConfidenceWrongCount,
    expectationMismatchCount,
    lowConfidenceExpectedCount: lowConfidenceTasks.length,
    lowConfidenceCorrectCount,
    queryP95Ms,
    bootstrapLocatorP95Ms,
    bootstrapLocatorTotalMs,
    contextPackBytes,
    bootstrapReadPathBytes,
    contextVolumeReduction,
    generationMaxMs,
    indexDeterministic,
    queryDeterministic,
    pass: failedChecks.length === 0,
    failedChecks,
    taskGaps: {
      zeroHitAt5: taskGapIds(tasks, (task) => task.mustHitTop5.hits.length === 0),
      partialCanonicalAt5: taskGapIds(tasks, (task) =>
        task.mustHitTop5.hits.length > 0 && task.mustHitTop5.misses.length > 0,
      ),
      requiredRecallAt15: taskGapIds(tasks, (task) => task.requiredTop15.misses.length > 0),
      forbiddenTop5: taskGapIds(tasks, (task) => task.forbiddenTop5.hits.length > 0),
      highConfidenceWrong: taskGapIds(tasks, (task) => task.highConfidenceWrongReasons.length > 0),
      expectations: taskGapIds(tasks, (task) =>
        !task.expectation.confidenceMatches ||
        !task.expectation.bootstrapMatches ||
        !task.expectation.featureMatches,
      ),
      lowConfidence: taskGapIds(tasks, (task) => task.lowConfidenceCorrect === false),
    },
  }
}

export function evaluateGoldenTasks(repoRoot: string): GoldenQualityReport {
  const { taskCollection, expectedCollection } = loadGoldenCorpus(repoRoot)
  const expectedById = new Map(expectedCollection.expected.map((record) => [record.id, record]))
  const temporaryRoot = mkdtempSync(resolve(tmpdir(), 'ittoedu-golden-quality-'))
  try {
    const firstDirectory = resolve(temporaryRoot, 'first')
    const secondDirectory = resolve(temporaryRoot, 'second')
    const firstStarted = performance.now()
    generateRepoIndexToDirectory(repoRoot, firstDirectory)
    const firstMs = performance.now() - firstStarted
    const secondStarted = performance.now()
    generateRepoIndexToDirectory(repoRoot, secondDirectory)
    const secondMs = performance.now() - secondStarted
    const firstHash = hashGeneratedDirectory(firstDirectory)
    const secondHash = hashGeneratedDirectory(secondDirectory)
    const indexDeterministic = firstHash === secondHash

    const evaluations = taskCollection.tasks.map((task) => {
      const expected = expectedById.get(task.id)
      if (!expected) throw new Error(`Missing expected record for ${task.id}`)
      return evaluateTask(repoRoot, firstDirectory, task, expected)
    })
    const repeated = taskCollection.tasks.map((task) => {
      const expected = expectedById.get(task.id)
      if (!expected) throw new Error(`Missing expected record for ${task.id}`)
      return evaluateTask(repoRoot, firstDirectory, task, expected)
    })
    const firstSignature = stableTaskSignature(evaluations)
    const repeatedSignature = stableTaskSignature(repeated)
    const queryDeterministic = firstSignature === repeatedSignature
    const generationMaxMs = Math.max(firstMs, secondMs)
    const controlledTasks = evaluations.filter(({ milestone }) => milestone === 'controlled-15')
    const controlled15 = buildGateMetrics(
      controlledTasks,
      expectedCollection.thresholds,
      generationMaxMs,
      indexDeterministic,
      queryDeterministic,
    )
    const broad25 = buildGateMetrics(
      evaluations,
      expectedCollection.thresholds,
      generationMaxMs,
      indexDeterministic,
      queryDeterministic,
    )
    const qualitySignature = createHash('sha256').update(JSON.stringify({
      corpusVersion: taskCollection.corpusVersion,
      indexDeterministic,
      firstSignature,
      repeatedSignature,
      controlled: {
        hitAt5: controlled15.hitAt5,
        canonicalRecallAt5: controlled15.canonicalRecallAt5,
        recallAt15: controlled15.recallAt15,
        forbiddenTop5Count: controlled15.forbiddenTop5Count,
        highConfidenceWrongCount: controlled15.highConfidenceWrongCount,
        expectationMismatchCount: controlled15.expectationMismatchCount,
        lowConfidenceCorrectCount: controlled15.lowConfidenceCorrectCount,
        failedChecks: controlled15.failedChecks,
      },
      broad: {
        hitAt5: broad25.hitAt5,
        canonicalRecallAt5: broad25.canonicalRecallAt5,
        recallAt15: broad25.recallAt15,
        forbiddenTop5Count: broad25.forbiddenTop5Count,
        highConfidenceWrongCount: broad25.highConfidenceWrongCount,
        expectationMismatchCount: broad25.expectationMismatchCount,
        lowConfidenceCorrectCount: broad25.lowConfidenceCorrectCount,
        failedChecks: broad25.failedChecks,
      },
    })).digest('hex')

    return {
      schemaVersion: 1,
      corpusVersion: taskCollection.corpusVersion,
      thresholds: expectedCollection.thresholds,
      generation: {
        firstMs,
        secondMs,
        firstHash,
        secondHash,
        deterministic: indexDeterministic,
      },
      queryDeterministic,
      qualitySignature,
      controlled15,
      broad25,
      tasks: evaluations,
      bootstrapComparisonNote:
        'Bootstrap comparison reports only reproducible git ls-files locator time and expected read-path bytes versus generated Context Pack bytes; it does not estimate human reading time.',
    }
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
}

function reportForConsole(report: GoldenQualityReport): Record<string, unknown> {
  return {
    schemaVersion: report.schemaVersion,
    corpusVersion: report.corpusVersion,
    qualitySignature: report.qualitySignature,
    generation: report.generation,
    queryDeterministic: report.queryDeterministic,
    controlled15: report.controlled15,
    broad25: report.broad25,
    taskFailures: report.tasks.filter((task) =>
      task.mustHitTop5.misses.length > 0 ||
      task.requiredTop15.misses.length > 0 ||
      task.forbiddenTop5.hits.length > 0 ||
      task.highConfidenceWrongReasons.length > 0 ||
      !task.expectation.confidenceMatches ||
      !task.expectation.bootstrapMatches ||
      !task.expectation.featureMatches ||
      task.lowConfidenceCorrect === false,
    ).map((task) => ({
      id: task.id,
      confidence: task.confidence,
      bootstrapRequired: task.bootstrapRequired,
      matchedFeatureId: task.matchedFeatureId ?? null,
      top5: task.top5,
      canonicalMisses: task.mustHitTop5.misses,
      requiredMisses: task.requiredTop15.misses,
      forbiddenHits: task.forbiddenTop5.hits,
      highConfidenceWrongReasons: task.highConfidenceWrongReasons,
      expectation: task.expectation,
      lowConfidenceCorrect: task.lowConfidenceCorrect,
    })),
    bootstrapComparisonNote: report.bootstrapComparisonNote,
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined
const thisPath = resolve(fileURLToPath(import.meta.url))
if (invokedPath === thisPath) {
  const repoRoot = resolve(dirname(thisPath), '../..')
  try {
    const report = evaluateGoldenTasks(repoRoot)
    process.stdout.write(`${JSON.stringify(reportForConsole(report), null, 2)}\n`)
    if (!report.controlled15.pass || !report.broad25.pass) process.exitCode = 1
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
