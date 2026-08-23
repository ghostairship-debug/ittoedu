import { readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

import {
  collectInputInventory,
  loadRepoIndexConfig,
  type InputInventoryRecord,
  type InputInventoryResult,
} from './inputInventory'

export type QueryMode = 'feature' | 'symbol' | 'path' | 'changed' | 'query'
export type ContextPackSize = 'small' | 'medium' | 'large'
export type QueryConfidence = 'high' | 'medium' | 'low'
export type FreshnessStatus = 'fresh' | 'partially-stale' | 'stale'

export interface QueryRequest {
  mode: QueryMode
  value?: string
  size: ContextPackSize
}

export interface DirtyInput {
  path: string
  status: string
}

export interface ChangedInput {
  path: string
  domain?: string
  change: 'added' | 'removed' | 'changed' | 'domain-changed'
}

export interface FreshnessAssessment {
  status: FreshnessStatus
  safeForS2: boolean
  domainMatches: Record<'source' | 'semantic' | 'config' | 'tool', boolean>
  changedInputs: readonly ChangedInput[]
  dirtyInputs: readonly DirtyInput[]
  relevantDirtyInputs: readonly DirtyInput[]
  reasons: readonly string[]
}

export interface FeatureSemantic {
  id: string
  name: string
  aliases: readonly string[]
  statusClass: string
  owner?: string
  currentFact?: string
  targetState?: string
  canonicalFiles?: readonly string[]
  entrypoints?: readonly string[]
  runtimeConsumers?: readonly string[]
  tests?: readonly string[]
  evidence?: readonly string[]
  moduleIds?: readonly string[]
  carriers?: Record<string, string>
  reviewGate?: string
  removalPhase?: string
}

export interface ModuleSemantic {
  id: string
  name: string
  status: string
  statusClass: string
  owner?: string
  currentFact?: string
  targetState?: string
  entrypoints?: readonly string[]
  evidence?: readonly string[]
  reviewGate?: string
}

export interface InvariantSemantic {
  id: string
  name: string
  statusClass: string
  evidence: readonly string[]
}

export interface ExclusionSemantic {
  id: string
  name: string
  reason: string
  evidence: readonly string[]
}

export interface FileFact {
  id: string
  path: string
  kind: string
  projects: readonly string[]
  exports: readonly string[]
  tags: readonly string[]
}

export interface SymbolFact {
  id: string
  file: string
  name: string
  kind: string
  line: number
  endLine: number
  exported: boolean
  exportedAs: readonly string[]
  jsDoc?: string
}

export interface EdgeFact {
  id: string
  kind: string
  from: string
  to: string
  resolved: boolean
  specifier?: string
  line?: number
}

export interface TestFact {
  id: string
  file: string
  kind: string
  name: string
  line: number
  suite: readonly string[]
  runnable: boolean
  command?: string
  diagnostic?: string
  relatedFiles: readonly string[]
}

export interface QueryCandidate {
  kind: 'feature' | 'symbol' | 'path'
  id: string
  label: string
  score: number
  reasons: readonly string[]
  paths: readonly string[]
  statusClass?: string
}

export interface QueryResult {
  request: QueryRequest
  confidence: QueryConfidence
  bootstrapRequired: boolean
  matchedFeature?: FeatureSemantic
  matchedSymbols: readonly SymbolFact[]
  matchedFiles: readonly FileFact[]
  candidates: readonly QueryCandidate[]
  relevantPaths: readonly string[]
  relatedTests: readonly TestFact[]
  relatedEdges: readonly EdgeFact[]
  modules: readonly ModuleSemantic[]
  freshness: FreshnessAssessment
  unknowns: readonly string[]
}

interface Manifest {
  schemaVersion: number
  generatorVersion: number
  sourceTreeHash: string
  semanticHash: string
  configHash: string
  toolHash: string
}

interface LoadedIndex {
  manifest: Manifest
  inventory: readonly InputInventoryRecord[]
  files: readonly FileFact[]
  symbols: readonly SymbolFact[]
  edges: readonly EdgeFact[]
  tests: readonly TestFact[]
  features: readonly FeatureSemantic[]
  modules: readonly ModuleSemantic[]
  invariants: readonly InvariantSemantic[]
  exclusions: readonly ExclusionSemantic[]
}

interface QueryEngineOptions {
  repoRoot: string
  generatedDirectory?: string
  semanticDirectory?: string
  dirtyInputs?: readonly DirtyInput[]
  currentInventory?: InputInventoryResult
}

interface RawFreshness {
  manifest: Manifest
  storedInventory: readonly InputInventoryRecord[]
  currentInventory: InputInventoryResult
  dirtyInputs: readonly DirtyInput[]
}

const loadedIndexCache = new Map<string, LoadedIndex>()
const DOMAINS = ['source', 'semantic', 'config', 'tool'] as const

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

export function normalizeQueryTerm(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ')
}

function toSlashes(path: string): string {
  return path.replace(/\\/g, '/')
}

function normalizeRepoPath(path: string): string {
  const normalized = toSlashes(path.normalize('NFKC').trim()).replace(/^\.\//, '')
  if (
    normalized.length === 0 ||
    normalized.startsWith('/') ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized === '..' ||
    normalized.startsWith('../')
  ) {
    throw new Error(`Query paths must be repository-relative: ${path}`)
  }
  return normalized
}

function parseJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function parseJsonLines<T>(path: string): T[] {
  const text = readFileSync(path, 'utf8').trim()
  return text.length === 0
    ? []
    : text.split('\n').map((line) => JSON.parse(line) as T)
}

function loadIndex(
  repoRoot: string,
  generatedDirectory: string,
  semanticDirectory: string,
): LoadedIndex {
  const key = `${resolve(generatedDirectory)}\0${resolve(semanticDirectory)}`
  const cached = loadedIndexCache.get(key)
  if (cached) return cached

  const features = parseJson<{ features: FeatureSemantic[] }>(
    resolve(semanticDirectory, 'features.json'),
  ).features
  const modules = parseJson<{ modules: ModuleSemantic[] }>(
    resolve(semanticDirectory, 'modules.json'),
  ).modules
  const invariants = parseJson<{ invariants: InvariantSemantic[] }>(
    resolve(semanticDirectory, 'invariants.json'),
  ).invariants
  const exclusions = parseJson<{ exclusions: ExclusionSemantic[] }>(
    resolve(semanticDirectory, 'exclusions.json'),
  ).exclusions
  const loaded: LoadedIndex = {
    manifest: parseJson<Manifest>(resolve(generatedDirectory, 'manifest.json')),
    inventory: parseJsonLines<InputInventoryRecord>(
      resolve(generatedDirectory, 'input-inventory.jsonl'),
    ),
    files: parseJsonLines<FileFact>(resolve(generatedDirectory, 'files.jsonl')),
    symbols: parseJsonLines<SymbolFact>(resolve(generatedDirectory, 'symbols.jsonl')),
    edges: parseJsonLines<EdgeFact>(resolve(generatedDirectory, 'edges.jsonl')),
    tests: parseJsonLines<TestFact>(resolve(generatedDirectory, 'tests.jsonl')),
    features: [...features].sort((left, right) => compareText(left.id, right.id)),
    modules: [...modules].sort((left, right) => compareText(left.id, right.id)),
    invariants: [...invariants].sort((left, right) => compareText(left.id, right.id)),
    exclusions: [...exclusions].sort((left, right) => compareText(left.id, right.id)),
  }
  loadedIndexCache.set(key, loaded)
  return loaded
}

export function clearQueryCache(): void {
  loadedIndexCache.clear()
}

function runGit(repoRoot: string, args: readonly string[]): Buffer {
  const result = spawnSync('git', [...args], {
    cwd: repoRoot,
    encoding: 'buffer',
    windowsHide: true,
    shell: false,
  })
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(' ')} failed: ${result.stderr?.toString('utf8').trim() || 'unknown error'}`,
    )
  }
  return result.stdout ?? Buffer.alloc(0)
}

export function collectGitDirtyInputs(repoRoot: string): DirtyInput[] {
  const output = runGit(repoRoot, [
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
  ]).toString('utf8')
  const entries = output.split('\0').filter(Boolean)
  const dirty = new Map<string, string>()
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    if (entry.length < 4) continue
    const status = entry.slice(0, 2)
    const path = toSlashes(entry.slice(3))
    dirty.set(path, status)
    if ((status.includes('R') || status.includes('C')) && entries[index + 1]) {
      const sourcePath = toSlashes(entries[index + 1])
      dirty.set(sourcePath, status)
      index += 1
    }
  }
  return [...dirty.entries()]
    .map(([path, status]) => ({ path, status }))
    .sort((left, right) => compareText(left.path, right.path))
}

function compareInventory(
  stored: readonly InputInventoryRecord[],
  current: readonly InputInventoryRecord[],
): ChangedInput[] {
  const before = new Map(stored.map((record) => [record.path, record]))
  const after = new Map(current.map((record) => [record.path, record]))
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort(compareText)
  return paths.flatMap((path): ChangedInput[] => {
    const oldRecord = before.get(path)
    const newRecord = after.get(path)
    if (!oldRecord && newRecord) {
      return [{ path, domain: newRecord.domain, change: 'added' }]
    }
    if (oldRecord && !newRecord) {
      return [{ path, domain: oldRecord.domain, change: 'removed' }]
    }
    if (!oldRecord || !newRecord) return []
    if (oldRecord.domain !== newRecord.domain) {
      return [{ path, domain: newRecord.domain, change: 'domain-changed' }]
    }
    if (oldRecord.contentHash !== newRecord.contentHash) {
      return [{ path, domain: newRecord.domain, change: 'changed' }]
    }
    return []
  })
}

function pathIsRelevant(path: string, relevantPaths: ReadonlySet<string>): boolean {
  if (relevantPaths.has(path)) return true
  return [...relevantPaths].some((relevant) =>
    path.startsWith(`${relevant}/`) || relevant.startsWith(`${path}/`),
  )
}

export function assessFreshness(
  raw: RawFreshness,
  relevantPaths: readonly string[],
): FreshnessAssessment {
  const changedInputs = compareInventory(raw.storedInventory, raw.currentInventory.records)
  const relevant = new Set(relevantPaths)
  const relevantChanges = changedInputs.filter((change) => pathIsRelevant(change.path, relevant))
  const relevantDirtyInputs = raw.dirtyInputs.filter((dirty) =>
    pathIsRelevant(dirty.path, relevant),
  )
  const domainMatches = {
    source: raw.manifest.sourceTreeHash === raw.currentInventory.hashes.source,
    semantic: raw.manifest.semanticHash === raw.currentInventory.hashes.semantic,
    config: raw.manifest.configHash === raw.currentInventory.hashes.config,
    tool: raw.manifest.toolHash === raw.currentInventory.hashes.tool,
  }
  const allDomainsMatch = DOMAINS.every((domain) => domainMatches[domain])
  const reasons: string[] = []
  let status: FreshnessStatus
  if (
    raw.manifest.schemaVersion !== 1 ||
    raw.manifest.generatorVersion !== 1
  ) {
    status = 'stale'
    reasons.push('manifest schema/generator version is unsupported')
  } else if (relevantDirtyInputs.length > 0) {
    status = 'stale'
    reasons.push('query-relevant inputs are dirty')
  } else if (allDomainsMatch && changedInputs.length === 0) {
    status = 'fresh'
  } else if (
    !domainMatches.semantic ||
    !domainMatches.config ||
    relevantChanges.length > 0
  ) {
    status = 'stale'
    if (!domainMatches.semantic) reasons.push('semantic input changed')
    if (!domainMatches.config) reasons.push('scan/config input changed')
    if (relevantChanges.length > 0) reasons.push('query-relevant indexed inputs changed')
  } else {
    status = 'partially-stale'
    reasons.push('strict inputs changed outside the query-relevant path set')
  }
  if (!domainMatches.tool && status !== 'fresh') {
    reasons.push('tool input changed')
  }
  if (!domainMatches.source && status !== 'fresh') {
    reasons.push('source tree changed')
  }
  return {
    status,
    safeForS2: status === 'fresh' && relevantDirtyInputs.length === 0,
    domainMatches,
    changedInputs,
    dirtyInputs: raw.dirtyInputs,
    relevantDirtyInputs,
    reasons: [...new Set(reasons)],
  }
}

function featurePaths(feature: FeatureSemantic): string[] {
  return [...new Set([
    ...(feature.canonicalFiles ?? []),
    ...(feature.entrypoints ?? []),
    ...(feature.runtimeConsumers ?? []),
    ...(feature.tests ?? []),
    ...(feature.evidence ?? []),
  ])].sort(compareText)
}

function featureTerms(feature: FeatureSemantic): string[] {
  return [
    feature.id,
    feature.id.split(':').at(-1) ?? feature.id,
    feature.name,
    ...feature.aliases,
  ].map(normalizeQueryTerm)
}

function featureCandidate(
  feature: FeatureSemantic,
  score: number,
  reasons: string[],
): QueryCandidate {
  return {
    kind: 'feature',
    id: feature.id,
    label: feature.name,
    score,
    reasons,
    paths: featurePaths(feature),
    statusClass: feature.statusClass,
  }
}

function exactFeatureMatches(features: readonly FeatureSemantic[], value: string): FeatureSemantic[] {
  const normalized = normalizeQueryTerm(value)
  return features.filter((feature) => featureTerms(feature).includes(normalized))
}

function featuresForPath(features: readonly FeatureSemantic[], path: string): FeatureSemantic[] {
  return features.filter((feature) => featurePaths(feature).includes(path))
}

function relatedModules(
  modules: readonly ModuleSemantic[],
  feature: FeatureSemantic | undefined,
): ModuleSemantic[] {
  if (!feature) return []
  const ids = new Set(feature.moduleIds ?? [])
  return modules.filter((module) => ids.has(module.id))
}

function queryTokens(value: string): string[] {
  return normalizeQueryTerm(value)
    .split(/[^\p{L}\p{N}_:/.-]+/u)
    .filter((token) => token.length >= 2)
}

function textCandidates(index: LoadedIndex, value: string): QueryCandidate[] {
  const normalized = normalizeQueryTerm(value)
  const tokens = queryTokens(value)
  const explicitLegacy = /(?:legacy|\bv8\b|旧版|遗留)/iu.test(normalized)
  const candidates: QueryCandidate[] = []

  for (const feature of index.features) {
    const terms = featureTerms(feature)
    const haystack = normalizeQueryTerm([
      ...terms,
      feature.currentFact ?? '',
      feature.targetState ?? '',
      feature.owner ?? '',
      ...featurePaths(feature),
    ].join(' '))
    let score = 0
    const reasons: string[] = []
    if (terms.includes(normalized)) {
      score += 120
      reasons.push('exact feature id/name/alias')
    } else if (haystack.includes(normalized) && normalized.length >= 3) {
      score += 30
      reasons.push('feature phrase substring')
    }
    const matchedTokens = tokens.filter((token) => haystack.includes(token))
    score += matchedTokens.length * 9
    if (matchedTokens.length > 0) reasons.push(`feature tokens: ${matchedTokens.join(', ')}`)
    if (
      !explicitLegacy &&
      (feature.statusClass === 'transitional-allowance' || feature.id.includes('legacy'))
    ) {
      score = Math.max(0, score - 45)
      reasons.push('legacy candidate penalized without explicit legacy intent')
    }
    if (score > 0) candidates.push(featureCandidate(feature, score, reasons))
  }

  for (const symbol of index.symbols) {
    const name = normalizeQueryTerm(symbol.name)
    let score = 0
    const reasons: string[] = []
    if (name === normalized) {
      score = 105
      reasons.push('exact symbol')
    } else if (normalized.length >= 3 && name.includes(normalized)) {
      score = 42
      reasons.push('symbol substring')
    }
    if (score > 0) {
      candidates.push({
        kind: 'symbol',
        id: symbol.id,
        label: symbol.name,
        score,
        reasons,
        paths: [symbol.file],
      })
    }
  }

  for (const file of index.files) {
    const path = normalizeQueryTerm(file.path)
    if (normalized.length >= 3 && path.includes(normalized)) {
      candidates.push({
        kind: 'path',
        id: file.id,
        label: file.path,
        score: path === normalized ? 110 : 36,
        reasons: [path === normalized ? 'exact path' : 'path substring'],
        paths: [file.path],
      })
    }
  }

  for (const test of index.tests) {
    const name = normalizeQueryTerm(test.name)
    if (normalized.length >= 3 && name.includes(normalized)) {
      candidates.push({
        kind: 'path',
        id: test.id,
        label: test.name,
        score: name === normalized ? 90 : 28,
        reasons: [name === normalized ? 'exact test name' : 'test name substring'],
        paths: [test.file],
      })
    }
  }

  return candidates.sort((left, right) =>
    right.score - left.score || compareText(left.kind, right.kind) || compareText(left.id, right.id),
  )
}

function confidenceForText(candidates: readonly QueryCandidate[]): QueryConfidence {
  const first = candidates[0]
  const second = candidates[1]
  if (!first || first.score < 20) return 'low'
  if (first.score >= 100 && (!second || first.score - second.score >= 20)) return 'high'
  if (first.score >= 40 && (!second || first.score - second.score >= 10)) return 'medium'
  return 'low'
}

function externalCatalogIntent(value: string): boolean {
  const normalized = normalizeQueryTerm(value)
  const explicitTerms = [
    'courseware-components',
    'external catalog',
    'external component',
    '外部组件目录',
    '外部组件源码',
    '远程组件库',
  ].some((term) => normalized.includes(normalizeQueryTerm(term)))
  const sourceIntent = /(?:runtime\.js|source(?:\s+code)?|源码|源代码|修复|fix|patch)/iu
    .test(normalized)
  const packageIdentity = /com\.ittoedu\.[\p{L}\p{N}_.@*+-]+@[^\s+]+/iu.test(normalized)
  const latestThirdPartyCatalog =
    /(?:catalog|组件目录|组件库).*?(?:最新|第三方|third[-\s]?party)/iu.test(normalized)
  return explicitTerms ||
    (sourceIntent && packageIdentity) ||
    (sourceIntent && latestThirdPartyCatalog)
}

function relatedTestsForPaths(index: LoadedIndex, paths: readonly string[]): TestFact[] {
  const relevant = new Set(paths)
  return index.tests.filter((test) =>
    relevant.has(test.file) || test.relatedFiles.some((path) => relevant.has(path)),
  ).sort((left, right) => compareText(left.id, right.id))
}

function relatedEdgesForPaths(index: LoadedIndex, paths: readonly string[]): EdgeFact[] {
  const ids = new Set(paths.map((path) => `file:${path}`))
  return index.edges.filter((edge) => ids.has(edge.from) || ids.has(edge.to))
    .sort((left, right) => compareText(left.id, right.id))
}

function finalizeResult(
  request: QueryRequest,
  index: LoadedIndex,
  rawFreshness: RawFreshness,
  initial: Omit<QueryResult, 'request' | 'freshness' | 'bootstrapRequired' | 'relatedTests' | 'relatedEdges' | 'modules'> & {
    bootstrapRequired?: boolean
  },
): QueryResult {
  const relevantPaths = [...new Set(initial.relevantPaths)].sort(compareText)
  const freshness = assessFreshness(rawFreshness, relevantPaths)
  const relatedTests = relatedTestsForPaths(index, relevantPaths)
  const relatedEdges = relatedEdgesForPaths(index, relevantPaths)
  const modules = relatedModules(index.modules, initial.matchedFeature)
  const bootstrapRequired =
    initial.bootstrapRequired === true ||
    initial.confidence === 'low' ||
    freshness.status !== 'fresh'
  const unknowns = [...initial.unknowns]
  if (freshness.status !== 'fresh') {
    unknowns.push(
      `Index is ${freshness.status}; verify changed/relevant paths with manual Bootstrap before modification.`,
    )
  }
  if (!freshness.safeForS2) {
    unknowns.push('This Context Pack is not safe to treat as fresh for an S2 migration.')
  }
  return {
    request,
    confidence: initial.confidence,
    bootstrapRequired,
    ...(initial.matchedFeature ? { matchedFeature: initial.matchedFeature } : {}),
    matchedSymbols: initial.matchedSymbols,
    matchedFiles: initial.matchedFiles,
    candidates: initial.candidates,
    relevantPaths,
    relatedTests,
    relatedEdges,
    modules,
    freshness,
    unknowns: [...new Set(unknowns)],
  }
}

export class RepoIndexQueryEngine {
  readonly repoRoot: string
  readonly index: LoadedIndex
  readonly invariants: readonly InvariantSemantic[]
  readonly exclusions: readonly ExclusionSemantic[]
  private readonly rawFreshness: RawFreshness

  constructor(options: QueryEngineOptions) {
    this.repoRoot = resolve(options.repoRoot)
    const generatedDirectory = resolve(
      options.generatedDirectory ?? resolve(this.repoRoot, 'repo-index/generated'),
    )
    const semanticDirectory = resolve(
      options.semanticDirectory ?? resolve(this.repoRoot, 'repo-index/semantic'),
    )
    this.index = loadIndex(this.repoRoot, generatedDirectory, semanticDirectory)
    this.invariants = this.index.invariants
    this.exclusions = this.index.exclusions
    this.rawFreshness = {
      manifest: this.index.manifest,
      storedInventory: this.index.inventory,
      currentInventory: options.currentInventory ?? collectInputInventory(
        this.repoRoot,
        loadRepoIndexConfig(this.repoRoot),
      ),
      dirtyInputs: options.dirtyInputs ?? collectGitDirtyInputs(this.repoRoot),
    }
  }

  query(request: QueryRequest): QueryResult {
    if (request.mode !== 'changed' && !request.value?.trim()) {
      throw new Error(`${request.mode} query requires a non-empty value`)
    }
    if (request.mode === 'feature') return this.queryFeature(request)
    if (request.mode === 'symbol') return this.querySymbol(request)
    if (request.mode === 'path') return this.queryPath(request)
    if (request.mode === 'changed') return this.queryChanged(request)
    return this.queryText(request)
  }

  private queryFeature(request: QueryRequest): QueryResult {
    const matches = exactFeatureMatches(this.index.features, request.value!)
    const candidates = matches.map((feature) =>
      featureCandidate(feature, 120, ['exact feature id suffix/name/NFKC alias']),
    )
    const feature = matches.length === 1 ? matches[0] : undefined
    return finalizeResult(request, this.index, this.rawFreshness, {
      confidence: matches.length === 1 ? 'high' : 'low',
      bootstrapRequired: matches.length !== 1,
      ...(feature ? { matchedFeature: feature } : {}),
      matchedSymbols: [],
      matchedFiles: feature
        ? this.index.files.filter((file) => featurePaths(feature).includes(file.path))
        : [],
      candidates,
      relevantPaths: feature ? featurePaths(feature) : [],
      unknowns: matches.length === 0
        ? ['No exact feature id suffix, name, or alias matched.']
        : matches.length > 1
          ? ['Feature term is ambiguous across multiple exact aliases.']
          : [],
    })
  }

  private querySymbol(request: QueryRequest): QueryResult {
    const normalized = normalizeQueryTerm(request.value!)
    const matches = this.index.symbols.filter(
      (symbol) => normalizeQueryTerm(symbol.name) === normalized,
    )
    const files = [...new Set(matches.map((symbol) => symbol.file))]
    const featureMatches = [...new Set(files.flatMap((path) => featuresForPath(this.index.features, path)))]
    const feature = featureMatches.length === 1 ? featureMatches[0] : undefined
    const confidence: QueryConfidence = matches.length === 0
      ? 'low'
      : files.length === 1
        ? 'high'
        : 'medium'
    return finalizeResult(request, this.index, this.rawFreshness, {
      confidence,
      bootstrapRequired: confidence !== 'high',
      ...(feature ? { matchedFeature: feature } : {}),
      matchedSymbols: matches,
      matchedFiles: this.index.files.filter((file) => files.includes(file.path)),
      candidates: matches.map((symbol) => ({
        kind: 'symbol',
        id: symbol.id,
        label: symbol.name,
        score: 110,
        reasons: ['exact symbol name'],
        paths: [symbol.file],
      })),
      relevantPaths: [
        ...files,
        ...(feature ? featurePaths(feature) : []),
      ],
      unknowns: matches.length === 0
        ? ['No exact symbol matched; use --query for conservative candidates.']
        : files.length > 1
          ? ['Exact symbol exists in multiple files; select the intended declaration manually.']
          : [],
    })
  }

  private queryPath(request: QueryRequest): QueryResult {
    const path = normalizeRepoPath(request.value!)
    const direct = this.index.files.filter((file) => file.path === path)
    const insensitive = direct.length > 0
      ? direct
      : this.index.files.filter((file) => normalizeQueryTerm(file.path) === normalizeQueryTerm(path))
    const matches = direct.length > 0 ? direct : insensitive
    const featureMatches = featuresForPath(this.index.features, matches[0]?.path ?? path)
    const feature = featureMatches.length === 1 ? featureMatches[0] : undefined
    return finalizeResult(request, this.index, this.rawFreshness, {
      confidence: direct.length === 1 ? 'high' : matches.length > 0 ? 'medium' : 'low',
      bootstrapRequired: direct.length !== 1,
      ...(feature ? { matchedFeature: feature } : {}),
      matchedSymbols: this.index.symbols.filter((symbol) =>
        matches.some((file) => file.path === symbol.file),
      ),
      matchedFiles: matches,
      candidates: matches.map((file) => ({
        kind: 'path',
        id: file.id,
        label: file.path,
        score: direct.includes(file) ? 120 : 80,
        reasons: [direct.includes(file) ? 'exact path' : 'case-normalized path'],
        paths: [file.path],
      })),
      relevantPaths: [
        ...matches.map((file) => file.path),
        ...(feature ? featurePaths(feature) : []),
      ],
      unknowns: matches.length === 0
        ? ['Path is not present in generated file facts.']
        : direct.length === 0
          ? ['Only a case-normalized path matched; verify repository casing.']
          : [],
    })
  }

  private queryChanged(request: QueryRequest): QueryResult {
    const dirtyPaths = this.rawFreshness.dirtyInputs.map((dirty) => dirty.path)
    const files = this.index.files.filter((file) => dirtyPaths.includes(file.path))
    const featureMatches = [...new Set(
      dirtyPaths.flatMap((path) => featuresForPath(this.index.features, path)),
    )]
    const feature = featureMatches.length === 1 ? featureMatches[0] : undefined
    return finalizeResult(request, this.index, this.rawFreshness, {
      confidence: 'high',
      bootstrapRequired: dirtyPaths.length > 0,
      ...(feature ? { matchedFeature: feature } : {}),
      matchedSymbols: this.index.symbols.filter((symbol) => dirtyPaths.includes(symbol.file)),
      matchedFiles: files,
      candidates: dirtyPaths.map((path) => ({
        kind: 'path',
        id: `dirty:${path}`,
        label: path,
        score: 120,
        reasons: ['git status --porcelain dirty input'],
        paths: [path],
      })),
      relevantPaths: dirtyPaths,
      unknowns: dirtyPaths.length === 0
        ? ['No dirty files are reported by git status.']
        : ['Dirty paths must be reviewed before generating an implementation task.'],
    })
  }

  private queryText(request: QueryRequest): QueryResult {
    const external = externalCatalogIntent(request.value!)
    const candidates = textCandidates(this.index, request.value!)
    const components = external
      ? this.index.features.find((feature) => feature.id === 'feature:components')
      : undefined
    if (external) {
      const existingIndex = components
        ? candidates.findIndex((candidate) => candidate.id === components.id)
        : -1
      if (existingIndex >= 0) {
        candidates.splice(existingIndex, 1)
      }
      if (components) {
        candidates.unshift(featureCandidate(
          components,
          25,
          ['local Components boundary only; external source graph is unavailable'],
        ))
      }
    }
    const confidence = external ? 'low' : confidenceForText(candidates)
    const top = candidates[0]
    const feature = components ?? (top?.kind === 'feature'
      ? this.index.features.find((candidate) => candidate.id === top.id)
      : undefined)
    const paths = external && components ? featurePaths(components) : top?.paths ?? []
    const matchedSymbols = candidates
      .filter((candidate) => candidate.kind === 'symbol' && candidate.score === top?.score)
      .flatMap((candidate) =>
        this.index.symbols.filter((symbol) => symbol.id === candidate.id),
      )
    const matchedFiles = this.index.files.filter((file) => paths.includes(file.path))
    const unknowns: string[] = []
    if (external) {
      unknowns.push(
        'external-source-unavailable: package runtime.js/source is outside the V1 source graph; only the local feature:components boundary and canonical paths are available.',
      )
    }
    if (confidence === 'low') {
      unknowns.push('Free-text evidence is ambiguous or weak; no single write path is authoritative.')
    }
    return finalizeResult(request, this.index, this.rawFreshness, {
      confidence,
      bootstrapRequired: confidence === 'low' || external,
      ...(feature ? { matchedFeature: feature } : {}),
      matchedSymbols,
      matchedFiles,
      candidates: candidates.slice(0, 20),
      relevantPaths: [
        ...paths,
        ...(feature ? featurePaths(feature) : []),
      ],
      unknowns,
    })
  }
}

export interface ParsedQueryCli {
  request: QueryRequest
  output?: string
}

export function parseQueryCliArguments(args: readonly string[]): ParsedQueryCli {
  const modes: { mode: QueryMode; value?: string }[] = []
  let size: ContextPackSize = 'medium'
  let output: string | undefined
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (['--feature', '--symbol', '--path', '--query'].includes(argument)) {
      const value = args[index + 1]
      if (!value) throw new Error(`${argument} requires a value`)
      modes.push({ mode: argument.slice(2) as QueryMode, value })
      index += 1
      continue
    }
    if (argument === '--changed') {
      modes.push({ mode: 'changed' })
      continue
    }
    if (argument === '--size') {
      const value = args[index + 1] as ContextPackSize | undefined
      if (!value || !['small', 'medium', 'large'].includes(value)) {
        throw new Error('--size must be small, medium, or large')
      }
      size = value
      index += 1
      continue
    }
    if (argument === '--output') {
      output = args[index + 1]
      if (!output) throw new Error('--output requires a path')
      index += 1
      continue
    }
    throw new Error(`Unknown repo:context option: ${argument}`)
  }
  if (modes.length !== 1) {
    throw new Error('Exactly one query mode is required: --feature/--symbol/--path/--changed/--query')
  }
  return {
    request: { ...modes[0], size },
    ...(output ? { output } : {}),
  }
}

export function repositoryRelativePath(repoRoot: string, path: string): string | undefined {
  const normalized = toSlashes(relative(resolve(repoRoot), resolve(path)))
  return normalized === '..' || normalized.startsWith('../') ? undefined : normalized
}
