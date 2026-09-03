import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { unzipSync } from 'fflate'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const defaultProjectRoot = path.resolve(scriptDirectory, '..')

export const LEGACY_INVENTORY_RELATIVE = 'docs/development-plan/inventories/legacy-consumers.json'
export const LEGACY_SCANNER_VERSION = 'legacy-consumers-v3'
export const LEGACY_CHECK_MODES = ['ratchet', 'ready', 'zero'] as const
export type LegacyCheckMode = (typeof LEGACY_CHECK_MODES)[number]

export const LEGACY_RECORD_STATUSES = [
  'active-debt',
  'reachability-unproven',
  'retained-compatibility',
  'dead-candidate',
  'removed',
] as const
export type LegacyRecordStatus = (typeof LEGACY_RECORD_STATUSES)[number]

export const LEGACY_FAILURE_CATEGORIES = [
  'malformed-inventory',
  'stale-inventory',
  'scan-error',
  'new-consumer',
  'unknown-consumer',
  'known-debt',
  'legacy-module-present',
] as const
export type LegacyFailureCategory = (typeof LEGACY_FAILURE_CATEGORIES)[number]

const CONSUMER_CATEGORIES = [
  'staticImportsOrReferences',
  'dynamicStringIpcOrConfig',
  'playerPreviewOrExport',
  'buildFixtureOrRelease',
  'persistedRecoveryOrCrossVersion',
  'testConsumers',
  'cacheAsyncGeneratedOrPackaging',
] as const
type ConsumerCategory = (typeof CONSUMER_CATEGORIES)[number]

const TEXT_EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.html'] as const
const TEXT_EXTENSION_SET = new Set<string>(TEXT_EXTENSIONS)
const EXCLUDED_DIRECTORY_NAMES = [
  'node_modules',
  'dist',
  'dist-electron',
  'dist-player',
  'dist-renderer',
  'coverage',
  'output',
  'release',
  '.git',
  '.playwright-cli',
] as const
const EXCLUDED_DIRECTORY_SET = new Set<string>(EXCLUDED_DIRECTORY_NAMES)
const RELEASE_EVIDENCE_EXCLUSION = 'artifacts/release-evidence/v1.1'

export const LEGACY_SCAN_SCOPE = Object.freeze({
  roots: ['src', 'tests', 'scripts', 'examples', 'artifacts'],
  standaloneFiles: ['package.json'],
  moduleReferenceAliases: { '@/': 'src/' },
  textExtensions: [...TEXT_EXTENSIONS],
  archiveEntries: [{ extension: '.h5lesson', entry: 'project.json' }],
  excludedDirectoryNames: [...EXCLUDED_DIRECTORY_NAMES],
  scanExclusions: [`${RELEASE_EVIDENCE_EXCLUSION}/**`],
  productDigestExclusions: [LEGACY_INVENTORY_RELATIVE, `${RELEASE_EVIDENCE_EXCLUSION}/**`],
})

export const LEGACY_SELF_DESCRIPTION_PATHS = new Set([
  'scripts/check-legacy-consumers.ts',
  'tests/unit/legacyInventoryChecker.test.ts',
  'tests/unit/editor10ForbiddenTokens.test.ts',
  'tests/unit/readModelBoundary.test.ts',
])

/** Fixed queries cannot be narrowed by editing the inventory. */
export const LEGACY_QUERY_CATALOG = [
  'ProjectDocument',
  'SceneDocument',
  'SceneNode',
  'SceneNodeOverride',
  'ScenePresentation',
  'ScenePresentationState',
  'ExportPayload',
  'PROJECT_SCHEMA_VERSION',
  'projectDocumentSchema',
  'sceneNodeSchema',
  'projectCandidatePreviewDocument',
  'derivedV8ProjectFromBackend',
  'v9HistoryToStoreHistory',
  'buildExportPayload',
  'createProject',
  'migrateProjectV8ToCourseProjectV9',
  'buildPptx',
  'buildStandaloneHtml',
  'collectExportPreflight',
  'collectProjectHealth',
  'courseLayerItemToSceneNode',
  'PlayerApp',
  'PlayerScene',
  'CourseRuntimeKernel',
  'ProjectHealthDiagnostic',
  'ProjectHealthSummary',
  'renderProjectSceneImages',
  'EditorState.project',
  'slideCandidateUi',
  'courseDeliveryUnavailable',
  'handlePreview',
  'handleExportWebPackage',
  'handleExportPptx',
  'isSlideOnlyCourseProject',
  'handleExportPdf',
  'ExportPreflightReport',
  'createProjectArchive',
  'openProjectArchive',
  'createProjectV8Fields',
  'validateProjectArchiveBytes',
  'v9-slide-candidate',
  'V8SlideBackend',
  'V8_SLIDE_BACKEND',
  'build-project-v8-courseware',
  '导入旧版工程',
  'legacy-runtime-v2',
  'legacy-whole-canvas',
  'isV9SlideCandidateBackend',
  'selectSlideCandidateBackend',
  'executeSlideCandidateCommand',
] as const
export const LEGACY_SCAN_TOKENS = LEGACY_QUERY_CATALOG

const TARGET_SCOPED_QUERY_IDS = new Set([
  'courseDeliveryUnavailable',
  'handlePreview',
  'handleExportWebPackage',
  'handleExportPptx',
  'isSlideOnlyCourseProject',
  'handleExportPdf',
])

export class LegacyInventoryError extends Error {
  readonly category: LegacyFailureCategory

  constructor(category: LegacyFailureCategory, message: string) {
    super(message)
    this.name = 'LegacyInventoryError'
    this.category = category
  }
}

export interface LegacyEndpoint {
  path: string
  symbol: string
}

export interface LegacyTokenHit {
  path: string
  queryId: string
  line: number
  kind: 'token' | 'target-reference' | 'schema8-json' | 'schema8-h5lesson'
  archiveEntry?: string
  targetExpectationId?: string
  targetPath?: string
  specifier?: string
}

export interface LegacyTargetDefinition extends LegacyTokenHit {
  recordId: string
  expectationId: string
  expectation: 'file-absent' | 'symbol-absent'
}

export interface LegacyTargetResult {
  expectationId: string
  targetIdentityDigest: string
  path: string
  expectation: 'file-absent' | 'symbol-absent'
  filePresent: boolean
  definitionHits: LegacyTargetDefinition[]
  referenceHits: LegacyTokenHit[]
}

export interface LegacyRecordResult {
  id: string
  status: LegacyRecordStatus
  recordIdentityDigest: string
  registeredRelationCount: number
  observedRelationCount: number
  unknownCount: number
  targets: LegacyTargetResult[]
}

export interface LegacyCheckResult {
  schemaVersion: 2
  kind: 'legacy-consumer-scan'
  mode: LegacyCheckMode
  exitCode: 0
  candidate: {
    candidateId: string
    reconciledProductCommit: string
    currentProductTreeDigest: string
    reconciledProductTreeDigest: string
    matchesInventory: boolean
  }
  scanner: {
    version: string
    scope: typeof LEGACY_SCAN_SCOPE
    scopeDigest: string
    queryCatalogDigest: string
  }
  inventory: {
    path: string
    schemaVersion: 2
    canonicalDigest: string
  }
  summary: {
    confirmedExpected: number
    confirmedObserved: number
    unknown: number
    newConsumers: number
    unmatched: number
    targetDefinitions: number
    targetReferences: number
    legacyModulesPresent: number
    schema8Archives: number
  }
  records: LegacyRecordResult[]
  newConsumers: LegacyTokenHit[]
  unmatchedHits: LegacyTokenHit[]
  targetDefinitions: LegacyTargetDefinition[]
  targetReferences: LegacyTokenHit[]
  schema8Archives: LegacyTokenHit[]
  selfDescriptions: LegacyTokenHit[]
  invalidation: string[]
  failureCategory: null
  /** Compatibility summary fields used by existing callers. */
  confirmedEndpointCount: number
  matchedConfirmedRelationCount: number
  unknownCount: number
  tokenHits: number
  targetReferenceHits: number
}

interface LegacyTarget {
  raw: Record<string, unknown>
  expectationId: string
  path: string
  expectation: 'file-absent' | 'symbol-absent'
  symbols: string[]
}

interface LegacyRelation {
  recordId: string
  category: ConsumerCategory
  path: string
  symbol: string
  queryIds: string[]
  use: string
}

interface LegacyRecord {
  raw: Record<string, unknown>
  id: string
  status: LegacyRecordStatus
  targets: LegacyTarget[]
  relations: LegacyRelation[]
  unknownCount: number
}

interface ParsedInventory {
  raw: Record<string, unknown>
  baseline: {
    reconciledProductCommit: string
    reconciledProductTreeDigest: string
  }
  records: LegacyRecord[]
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function posix(value: string): string {
  return value.replaceAll('\\', '/')
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (isPlainRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

export function computeCanonicalInventoryDigest(value: unknown): string {
  return digest(value)
}

export const LEGACY_QUERY_CATALOG_DIGEST = digest(LEGACY_QUERY_CATALOG)
export const LEGACY_SCOPE_DIGEST = digest(LEGACY_SCAN_SCOPE)

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function tokenPattern(token: string): RegExp {
  return new RegExp(`(?<![A-Za-z0-9_])${escapeRegExp(token)}(?![A-Za-z0-9_])`)
}

export function containsBareLegacyToken(source: string, token: string): boolean {
  return tokenPattern(token).test(source)
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new LegacyInventoryError('malformed-inventory', `${label} 必须是非空字符串`)
  }
  return value
}

function requirePath(value: unknown, label: string): string {
  const result = requireString(value, label)
  if (result.includes('\\') || path.isAbsolute(result) || result.split('/').includes('..')) {
    throw new LegacyInventoryError('malformed-inventory', `${label} 必须是 scope 内 POSIX 相对路径`)
  }
  const first = result.split('/')[0]
  if (![...LEGACY_SCAN_SCOPE.roots, ...LEGACY_SCAN_SCOPE.standaloneFiles].includes(first)) {
    throw new LegacyInventoryError('malformed-inventory', `${label} 不在 scanner scope`)
  }
  return result
}

function requireSymbols(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string')) {
    throw new LegacyInventoryError('malformed-inventory', `${label} 必须是非空 symbol 数组`)
  }
  const symbols = value as string[]
  if (symbols.some((symbol) => !LEGACY_QUERY_CATALOG.includes(symbol as never))) {
    throw new LegacyInventoryError('malformed-inventory', `${label} 引用了 query catalog 外的 symbol`)
  }
  return symbols
}

const TARGET_REFERENCE_QUERY_PREFIX = 'target-reference:'

export function targetReferenceQueryId(expectationId: string): string {
  return `${TARGET_REFERENCE_QUERY_PREFIX}${expectationId}`
}

function splitSymbols(value: string, label: string, targets: readonly LegacyTarget[]): string[] {
  const symbols = [...new Set(value.split('|'))]
  const allowedTargetReferences = new Set(targets
    .filter((target) => target.expectation === 'file-absent')
    .map((target) => targetReferenceQueryId(target.expectationId)))
  if (symbols.some((symbol) => !LEGACY_QUERY_CATALOG.includes(symbol as never) && !allowedTargetReferences.has(symbol))) {
    throw new LegacyInventoryError('malformed-inventory', `${label} 引用了 query catalog 外的 symbol`)
  }
  return symbols
}

function parseTarget(value: unknown, recordId: string, seen: Set<string>): LegacyTarget {
  if (!isPlainRecord(value)) throw new LegacyInventoryError('malformed-inventory', `${recordId} target 必须是对象`)
  const expectationId = requireString(value.expectationId, `${recordId}.expectationId`)
  if (seen.has(expectationId)) throw new LegacyInventoryError('malformed-inventory', `重复 expectationId：${expectationId}`)
  seen.add(expectationId)
  const expectation = value.expectation
  if (expectation !== 'file-absent' && expectation !== 'symbol-absent') {
    throw new LegacyInventoryError('malformed-inventory', `${expectationId}.expectation 非法`)
  }
  const symbols = expectation === 'symbol-absent'
    ? requireSymbols(value.symbols, `${expectationId}.symbols`)
    : []
  if (expectation === 'file-absent' && value.symbols !== undefined) {
    throw new LegacyInventoryError('malformed-inventory', `${expectationId} file-absent 不得含 symbols`)
  }
  return {
    raw: value,
    expectationId,
    path: requirePath(value.path, `${expectationId}.path`),
    expectation,
    symbols,
  }
}

function parseRecord(value: unknown, seenIds: Set<string>, seenTargets: Set<string>): LegacyRecord {
  if (!isPlainRecord(value)) throw new LegacyInventoryError('malformed-inventory', 'record 必须是对象')
  const id = requireString(value.id, 'record.id')
  if (!/^LEG-[0-9]{3}$/.test(id) || seenIds.has(id)) {
    throw new LegacyInventoryError('malformed-inventory', `重复或非法 LEG id：${id}`)
  }
  seenIds.add(id)
  const status = value.status
  if (typeof status !== 'string' || !LEGACY_RECORD_STATUSES.includes(status as LegacyRecordStatus)) {
    throw new LegacyInventoryError('malformed-inventory', `${id}.status 非法`)
  }
  if (!Array.isArray(value.legacyTargets) || value.legacyTargets.length === 0) {
    throw new LegacyInventoryError('malformed-inventory', `${id}.legacyTargets 不能为空`)
  }
  const targets = value.legacyTargets.map((target) => parseTarget(target, id, seenTargets))
  if (!isPlainRecord(value.consumerCategories)) {
    throw new LegacyInventoryError('malformed-inventory', `${id}.consumerCategories 缺失`)
  }
  const keys = Object.keys(value.consumerCategories).sort()
  if (canonicalJson(keys) !== canonicalJson([...CONSUMER_CATEGORIES].sort())) {
    throw new LegacyInventoryError('malformed-inventory', `${id}.consumerCategories 必须恰含七类`)
  }
  const relations: LegacyRelation[] = []
  let unknownCount = 0
  for (const category of CONSUMER_CATEGORIES) {
    const bucket = value.consumerCategories[category]
    if (!isPlainRecord(bucket) || !Array.isArray(bucket.confirmed) || !Array.isArray(bucket.unknowns)) {
      throw new LegacyInventoryError('malformed-inventory', `${id}.${category} 结构无效`)
    }
    unknownCount += bucket.unknowns.length
    for (const endpoint of bucket.confirmed) {
      if (!isPlainRecord(endpoint)) throw new LegacyInventoryError('malformed-inventory', `${id} endpoint 非对象`)
      const symbol = requireString(endpoint.symbol, `${id}.${category}.symbol`)
      relations.push({
        recordId: id,
        category,
        path: requirePath(endpoint.path, `${id}.${category}.path`),
        symbol,
        queryIds: splitSymbols(symbol, `${id}.${category}.symbol`, targets),
        use: requireString(endpoint.use, `${id}.${category}.use`),
      })
    }
  }
  return { raw: value, id, status: status as LegacyRecordStatus, targets, relations, unknownCount }
}

function assertCounts(inventory: Record<string, unknown>, records: LegacyRecord[]): void {
  const actual = inventory.reconciledCounts
  if (!isPlainRecord(actual)) throw new LegacyInventoryError('malformed-inventory', 'reconciledCounts 缺失')
  const relations = records.flatMap((record) => record.relations)
  const byStatus = Object.fromEntries(LEGACY_RECORD_STATUSES
    .map((status) => [status, records.filter((record) => record.status === status).length] as const)
    .filter(([, count]) => count > 0))
  const byCategory = Object.fromEntries(CONSUMER_CATEGORIES.map((category) => [
    category,
    relations.filter((relation) => relation.category === category).length,
  ]))
  const expected: Record<string, unknown> = {
    recordCount: records.length,
    byStatus,
    confirmedConsumerRelationsByCategory: byCategory,
    confirmedConsumerRelationCount: relations.length,
    uniqueConfirmedConsumerEndpointCount: new Set(relations.map((item) => `${item.path}#${item.symbol}`)).size,
  }
  for (const [key, value] of Object.entries(expected)) {
    if (canonicalJson(actual[key]) !== canonicalJson(value)) {
      throw new LegacyInventoryError('malformed-inventory', `reconciledCounts.${key} 与 records 不一致`)
    }
  }
}

function readInventory(projectRoot: string): ParsedInventory {
  let raw: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(readFileSync(path.join(projectRoot, ...LEGACY_INVENTORY_RELATIVE.split('/')), 'utf8'))
    if (!isPlainRecord(parsed)) throw new Error('not object')
    raw = parsed
  } catch {
    throw new LegacyInventoryError('malformed-inventory', `无法读取合法的 ${LEGACY_INVENTORY_RELATIVE}`)
  }
  if (raw.schemaVersion !== 2) throw new LegacyInventoryError('malformed-inventory', 'schemaVersion 必须为 2')
  if (!isPlainRecord(raw.scannerContract)) throw new LegacyInventoryError('malformed-inventory', 'scannerContract 缺失')
  const expectedContract = {
    version: LEGACY_SCANNER_VERSION,
    scope: LEGACY_SCAN_SCOPE,
    scopeDigest: LEGACY_SCOPE_DIGEST,
    queryCatalogDigest: LEGACY_QUERY_CATALOG_DIGEST,
  }
  if (canonicalJson(raw.scannerContract) !== canonicalJson(expectedContract)) {
    throw new LegacyInventoryError('stale-inventory', 'scanner version/scope/query catalog identity 已失效')
  }
  if (!isPlainRecord(raw.baseline)) throw new LegacyInventoryError('malformed-inventory', 'baseline 缺失')
  const reconciledProductCommit = requireString(raw.baseline.reconciledProductCommit, 'reconciledProductCommit')
  const reconciledProductTreeDigest = requireString(raw.baseline.reconciledProductTreeDigest, 'reconciledProductTreeDigest')
  if (!/^[0-9a-f]{40}$/.test(reconciledProductCommit) || !/^[0-9a-f]{64}$/.test(reconciledProductTreeDigest)) {
    throw new LegacyInventoryError('malformed-inventory', 'candidate identity 格式无效')
  }
  if (!Array.isArray(raw.records)) throw new LegacyInventoryError('malformed-inventory', 'records 必须是数组')
  const seenIds = new Set<string>()
  const seenTargets = new Set<string>()
  const records = raw.records.map((record) => parseRecord(record, seenIds, seenTargets))
  const observationKeys = new Set<string>()
  for (const relation of records.flatMap((record) => record.relations)) {
    for (const queryId of relation.queryIds) {
      const key = `${relation.path}#${queryId}`
      if (observationKeys.has(key)) {
        throw new LegacyInventoryError('malformed-inventory', `重复 confirmed observation：${key}`)
      }
      observationKeys.add(key)
    }
  }
  assertCounts(raw, records)
  return { raw, baseline: { reconciledProductCommit, reconciledProductTreeDigest }, records }
}

export function confirmedEndpoints(inventory: Record<string, unknown>): LegacyEndpoint[] {
  if (!Array.isArray(inventory.records)) throw new LegacyInventoryError('malformed-inventory', 'records 必须是数组')
  const ids = new Set<string>()
  const targets = new Set<string>()
  return inventory.records
    .map((record) => parseRecord(record, ids, targets))
    .flatMap((record) => record.relations.map(({ path: endpointPath, symbol }) => ({ path: endpointPath, symbol })))
}

function excluded(relative: string): boolean {
  return relative === RELEASE_EVIDENCE_EXCLUSION || relative.startsWith(`${RELEASE_EVIDENCE_EXCLUSION}/`)
}

function collectFiles(projectRoot: string): string[] {
  const results: string[] = []
  const visit = (absolute: string): void => {
    let entries
    try {
      entries = readdirSync(absolute, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    for (const entry of entries) {
      if (EXCLUDED_DIRECTORY_SET.has(entry.name)) continue
      const next = path.join(absolute, entry.name)
      const relative = posix(path.relative(projectRoot, next))
      if (excluded(relative)) continue
      if (entry.isDirectory()) visit(next)
      else if (entry.isFile()) results.push(relative)
    }
  }
  for (const rootName of LEGACY_SCAN_SCOPE.roots) visit(path.join(projectRoot, rootName))
  for (const standalone of LEGACY_SCAN_SCOPE.standaloneFiles) {
    if (existsSync(path.join(projectRoot, standalone))) results.push(standalone)
  }
  return [...new Set(results)].sort((left, right) => left.localeCompare(right, 'en'))
}

export function computeProductTreeDigest(projectRoot: string): string {
  const hash = createHash('sha256')
  for (const relative of collectFiles(path.resolve(projectRoot))) {
    hash.update(relative)
    hash.update('\0')
    hash.update(readFileSync(path.join(projectRoot, ...relative.split('/'))))
    hash.update('\0')
  }
  return hash.digest('hex')
}

function commentOnly(line: string): boolean {
  const trimmed = line.trimStart()
  return trimmed.startsWith('//') || /^(\/\*|\*)/.test(trimmed)
}

interface FileReferenceTarget {
  recordId: string
  expectationId: string
  path: string
  identities: ReadonlySet<string>
}

function moduleIdentity(value: string): string {
  return value.replace(/\.(?:[cm]?[jt]sx?)$/i, '')
}

function moduleIdentities(targetPath: string): ReadonlySet<string> {
  const identity = moduleIdentity(targetPath)
  const values = new Set([identity])
  if (path.posix.basename(identity) === 'index') values.add(path.posix.dirname(identity))
  return values
}

function resolveModuleReference(sourcePath: string, specifier: string): string | null {
  const normalized = specifier
    .trim()
    .replace(/\\([\\/'"`])/g, '$1')
    .replaceAll('\\', '/')
    .replace(/[?#].*$/, '')
  if (normalized === '') return null

  let candidate: string
  const alias = Object.entries(LEGACY_SCAN_SCOPE.moduleReferenceAliases)
    .find(([prefix]) => normalized.startsWith(prefix))
  if (alias) {
    candidate = `${alias[1]}${normalized.slice(alias[0].length)}`
  } else if (normalized.startsWith('./') || normalized.startsWith('../')) {
    candidate = path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), normalized))
  } else if (LEGACY_SCAN_SCOPE.roots.some((root) => normalized === root || normalized.startsWith(`${root}/`))) {
    candidate = path.posix.normalize(normalized)
  } else {
    return null
  }
  if (candidate === '..' || candidate.startsWith('../') || path.posix.isAbsolute(candidate)) return null
  return moduleIdentity(candidate)
}

function quotedValues(lines: readonly string[]): Array<{ line: number; value: string }> {
  const values: Array<{ line: number; value: string }> = []
  let blockComment = false
  let htmlComment = false
  lines.forEach((source, lineIndex) => {
    let cursor = 0
    while (cursor < source.length) {
      if (blockComment) {
        const end = source.indexOf('*/', cursor)
        if (end < 0) return
        blockComment = false
        cursor = end + 2
        continue
      }
      if (htmlComment) {
        const end = source.indexOf('-->', cursor)
        if (end < 0) return
        htmlComment = false
        cursor = end + 3
        continue
      }
      if (source.startsWith('//', cursor)) return
      if (source.startsWith('/*', cursor)) {
        blockComment = true
        cursor += 2
        continue
      }
      if (source.startsWith('<!--', cursor)) {
        htmlComment = true
        cursor += 4
        continue
      }

      const quote = source[cursor]
      if (quote !== "'" && quote !== '"' && quote !== '`') {
        cursor += 1
        continue
      }
      let value = ''
      let escaped = false
      let dynamicTemplate = false
      let end = cursor + 1
      for (; end < source.length; end += 1) {
        const character = source[end]
        if (escaped) {
          value += `\\${character}`
          escaped = false
          continue
        }
        if (character === '\\') {
          escaped = true
          continue
        }
        if (character === quote) break
        if (quote === '`' && character === '$' && source[end + 1] === '{') dynamicTemplate = true
        value += character
      }
      if (end >= source.length) return
      if (!dynamicTemplate) values.push({ line: lineIndex + 1, value })
      cursor = end + 1
    }
  })
  return values
}

function pathReferenceCandidates(value: string): string[] {
  const candidates = new Set([value])
  const pattern = /(?:@\/|(?:\.\.?\/)+|(?:src|tests|scripts|examples|artifacts)\/)[A-Za-z0-9_@./\\-]+/g
  for (const match of value.matchAll(pattern)) candidates.add(match[0].replace(/[.,;:]+$/, ''))
  return [...candidates]
}

function scanTargetReferences(
  relative: string,
  lines: readonly string[],
  targets: readonly FileReferenceTarget[],
): LegacyTokenHit[] {
  const hits: LegacyTokenHit[] = []
  for (const quoted of quotedValues(lines)) {
    for (const specifier of pathReferenceCandidates(quoted.value)) {
      const resolved = resolveModuleReference(relative, specifier)
      if (!resolved) continue
      for (const target of targets) {
        if (relative === target.path || !target.identities.has(resolved)) continue
        hits.push({
          path: relative,
          queryId: targetReferenceQueryId(target.expectationId),
          line: quoted.line,
          kind: 'target-reference',
          targetExpectationId: target.expectationId,
          targetPath: target.path,
          specifier,
        })
      }
    }
  }
  return hits
}

function scanText(
  projectRoot: string,
  relative: string,
  targetQueriesByPath: ReadonlyMap<string, ReadonlySet<string>>,
  fileReferenceTargets: readonly FileReferenceTarget[],
): LegacyTokenHit[] {
  const source = readFileSync(path.join(projectRoot, ...relative.split('/')), 'utf8')
  const lines = source.split(/\r?\n/)
  const hits: LegacyTokenHit[] = []
  for (const queryId of LEGACY_QUERY_CATALOG) {
    if (TARGET_SCOPED_QUERY_IDS.has(queryId) && !targetQueriesByPath.get(relative)?.has(queryId)) continue
    const pattern = tokenPattern(queryId)
    lines.forEach((line, index) => {
      if (!commentOnly(line) && pattern.test(line)) hits.push({ path: relative, queryId, line: index + 1, kind: 'token' })
    })
  }
  if (path.extname(relative) === '.json') {
    try {
      const parsed = JSON.parse(source) as unknown
      if (isPlainRecord(parsed) && parsed.schemaVersion === 8) {
        hits.push({ path: relative, queryId: 'h5lesson-project-schema-8', line: 1, kind: 'schema8-json' })
      }
    } catch {
      // Token scanning remains valid for non-JSON config text with a .json suffix.
    }
  }
  hits.push(...scanTargetReferences(relative, lines, fileReferenceTargets))
  return hits
}

function scanArchive(projectRoot: string, relative: string): LegacyTokenHit[] {
  let archive: Record<string, Uint8Array>
  try {
    archive = unzipSync(new Uint8Array(readFileSync(path.join(projectRoot, ...relative.split('/')))))
  } catch {
    throw new LegacyInventoryError('scan-error', `损坏的 h5lesson：${relative}`)
  }
  const entries = Object.keys(archive).filter((entry) => entry === 'project.json')
  if (entries.length !== 1) throw new LegacyInventoryError('scan-error', `${relative} 必须恰含根 project.json`)
  try {
    const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(archive['project.json'])) as unknown
    return isPlainRecord(parsed) && parsed.schemaVersion === 8
      ? [{ path: relative, queryId: 'h5lesson-project-schema-8', line: 1, kind: 'schema8-h5lesson', archiveEntry: 'project.json' }]
      : []
  } catch {
    throw new LegacyInventoryError('scan-error', `${relative}/project.json 不是合法 UTF-8 JSON`)
  }
}

function scan(projectRoot: string, records: readonly LegacyRecord[]): LegacyTokenHit[] {
  const hits: LegacyTokenHit[] = []
  const targetQueriesByPath = new Map<string, Set<string>>()
  const fileReferenceTargets: FileReferenceTarget[] = []
  for (const target of records.flatMap((record) => record.targets)) {
    const queries = targetQueriesByPath.get(target.path) ?? new Set<string>()
    target.symbols.forEach((symbol) => queries.add(symbol))
    targetQueriesByPath.set(target.path, queries)
  }
  for (const record of records) {
    for (const target of record.targets) {
      if (target.expectation !== 'file-absent') continue
      fileReferenceTargets.push({
        recordId: record.id,
        expectationId: target.expectationId,
        path: target.path,
        identities: moduleIdentities(target.path),
      })
    }
  }
  for (const relative of collectFiles(projectRoot)) {
    const extension = path.extname(relative)
    if (TEXT_EXTENSION_SET.has(extension)) hits.push(...scanText(projectRoot, relative, targetQueriesByPath, fileReferenceTargets))
    else if (extension === '.h5lesson') hits.push(...scanArchive(projectRoot, relative))
  }
  return hits.sort((left, right) => left.path.localeCompare(right.path, 'en') || left.line - right.line || left.queryId.localeCompare(right.queryId, 'en'))
}

export function scanTokenHits(projectRoot: string): LegacyTokenHit[] {
  const resolved = path.resolve(projectRoot)
  return scan(resolved, readInventory(resolved).records)
}

function hitKey(hit: Pick<LegacyTokenHit, 'path' | 'queryId' | 'line'>): string {
  return `${hit.path}\0${hit.queryId}\0${hit.line}`
}

function classifyTargets(projectRoot: string, records: LegacyRecord[], hits: LegacyTokenHit[]): LegacyTargetResult[] {
  return records.flatMap((record) => record.targets.map((target) => {
    const absolute = path.join(projectRoot, ...target.path.split('/'))
    const filePresent = existsSync(absolute) && statSync(absolute).isFile()
    const definitionHits: LegacyTargetDefinition[] = target.expectation === 'file-absent'
      ? (filePresent ? [{
          recordId: record.id,
          expectationId: target.expectationId,
          expectation: target.expectation,
          path: target.path,
          queryId: '<file>',
          line: 0,
          kind: 'token',
        }] : [])
      : hits
          .filter((hit) => hit.path === target.path && target.symbols.includes(hit.queryId))
          .map((hit) => ({ ...hit, recordId: record.id, expectationId: target.expectationId, expectation: target.expectation }))
    const referenceHits = hits.filter((hit) =>
      hit.kind === 'target-reference' && hit.targetExpectationId === target.expectationId,
    )
    return {
      expectationId: target.expectationId,
      targetIdentityDigest: digest(target.raw),
      path: target.path,
      expectation: target.expectation,
      filePresent,
      definitionHits,
      referenceHits,
    }
  }))
}

function writeReportAtomically(reportPath: string, result: LegacyCheckResult): void {
  const directory = path.dirname(reportPath)
  mkdirSync(directory, { recursive: true })
  const temporary = path.join(directory, `.${path.basename(reportPath)}.${process.pid}.${Date.now()}.tmp`)
  try {
    writeFileSync(temporary, `${JSON.stringify(result, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    renameSync(temporary, reportPath)
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
}

export function checkLegacyConsumers(options: {
  projectRoot?: string
  mode: LegacyCheckMode
  enforceDigest?: boolean
  reportPath?: string
}): LegacyCheckResult {
  const projectRoot = path.resolve(options.projectRoot ?? defaultProjectRoot)
  const inventory = readInventory(projectRoot)
  const currentDigest = computeProductTreeDigest(projectRoot)
  const matchesInventory = currentDigest === inventory.baseline.reconciledProductTreeDigest
  if ((options.mode !== 'ratchet' || options.enforceDigest) && !matchesInventory) {
    throw new LegacyInventoryError('stale-inventory', `product digest 已偏离台账：inventory ${inventory.baseline.reconciledProductTreeDigest}，当前 ${currentDigest}`)
  }

  const allHits = scan(projectRoot, inventory.records)
  const selfDescriptions = allHits.filter((hit) => LEGACY_SELF_DESCRIPTION_PATHS.has(hit.path))
  const productHits = allHits.filter((hit) => !LEGACY_SELF_DESCRIPTION_PATHS.has(hit.path))
  const targetResults = classifyTargets(projectRoot, inventory.records, productHits)
  const targetDefinitions = targetResults.flatMap((target) => target.definitionHits)
  const targetReferences = targetResults.flatMap((target) => target.referenceHits)
  const targetKeys = new Set(targetDefinitions.filter((hit) => hit.queryId !== '<file>').map(hitKey))
  const fileTargetPaths = new Set(targetResults.filter((target) => target.expectation === 'file-absent').map((target) => target.path))
  const observations = productHits.filter((hit) =>
    (hit.kind === 'target-reference' || !fileTargetPaths.has(hit.path)) && !targetKeys.has(hitKey(hit)),
  )

  const relations = inventory.records.flatMap((record) => record.relations)
  const observedRelations = relations.filter((relation) => observations.some((hit) => hit.path === relation.path && relation.queryIds.includes(hit.queryId)))
  const observedKeys = new Set(observations
    .filter((hit) => relations.some((relation) => hit.path === relation.path && relation.queryIds.includes(hit.queryId)))
    .map(hitKey))
  const unclassified = observations.filter((hit) => !observedKeys.has(hitKey(hit)))
  const registeredPaths = new Set([
    ...relations.map((relation) => relation.path),
    ...inventory.records.flatMap((record) => record.targets.map((target) => target.path)),
  ])
  const unmatchedHits = unclassified.filter((hit) => registeredPaths.has(hit.path))
  const newConsumers = unclassified.filter((hit) => !registeredPaths.has(hit.path))
  const schema8Archives = observations.filter((hit) => hit.kind === 'schema8-h5lesson')
  const unknownCount = inventory.records.reduce((sum, record) => sum + record.unknownCount, 0)
  const returnedRemoved = targetResults.filter((target) => target.definitionHits.length > 0 && inventory.records.some((record) => record.status === 'removed' && record.targets.some((candidate) => candidate.expectationId === target.expectationId)))

  if (returnedRemoved.length > 0) {
    throw new LegacyInventoryError('legacy-module-present', `removed target 回流：${returnedRemoved.map((target) => target.expectationId).join(', ')}`)
  }
  if (newConsumers.length > 0 || unmatchedHits.length > 0) {
    const preview = [...unmatchedHits, ...newConsumers].slice(0, 12).map((hit) => `${hit.path}:${hit.line}#${hit.queryId}`).join(', ')
    throw new LegacyInventoryError('new-consumer', `出现未登记 legacy observation：${preview}`)
  }

  const symbolDefinitions = targetDefinitions.filter((hit) => hit.expectation === 'symbol-absent')
  if (options.mode !== 'ratchet') {
    if (unknownCount > 0) throw new LegacyInventoryError('unknown-consumer', `仍有 ${unknownCount} 条 unknown consumer`)
    if (observedRelations.length > 0 || symbolDefinitions.length > 0) {
      throw new LegacyInventoryError('known-debt', `仍有 ${observedRelations.length} 条 confirmed observation 和 ${symbolDefinitions.length} 条 symbol target definition`)
    }
    if (options.mode === 'zero') {
      const presentFiles = targetResults.filter((target) => target.expectation === 'file-absent' && target.filePresent)
      if (presentFiles.length > 0) throw new LegacyInventoryError('legacy-module-present', `旧模块仍在：${presentFiles.map((target) => target.path).join(', ')}`)
    }
  }

  const records: LegacyRecordResult[] = inventory.records.map((record) => ({
    id: record.id,
    status: record.status,
    recordIdentityDigest: digest({ id: record.id, status: record.status, targets: record.targets.map((target) => target.raw), relations: record.relations, unknownCount: record.unknownCount }),
    registeredRelationCount: record.relations.length,
    observedRelationCount: observedRelations.filter((relation) => relation.recordId === record.id).length,
    unknownCount: record.unknownCount,
    targets: targetResults.filter((target) => record.targets.some((candidate) => candidate.expectationId === target.expectationId)),
  }))
  const result: LegacyCheckResult = {
    schemaVersion: 2,
    kind: 'legacy-consumer-scan',
    mode: options.mode,
    exitCode: 0,
    candidate: {
      candidateId: currentDigest,
      reconciledProductCommit: inventory.baseline.reconciledProductCommit,
      currentProductTreeDigest: currentDigest,
      reconciledProductTreeDigest: inventory.baseline.reconciledProductTreeDigest,
      matchesInventory,
    },
    scanner: { version: LEGACY_SCANNER_VERSION, scope: LEGACY_SCAN_SCOPE, scopeDigest: LEGACY_SCOPE_DIGEST, queryCatalogDigest: LEGACY_QUERY_CATALOG_DIGEST },
    inventory: { path: LEGACY_INVENTORY_RELATIVE, schemaVersion: 2, canonicalDigest: computeCanonicalInventoryDigest(inventory.raw) },
    summary: {
      confirmedExpected: relations.length,
      confirmedObserved: observedRelations.length,
      unknown: unknownCount,
      newConsumers: newConsumers.length,
      unmatched: unmatchedHits.length,
      targetDefinitions: targetDefinitions.length,
      targetReferences: targetReferences.length,
      legacyModulesPresent: targetResults.filter((target) => target.expectation === 'file-absent' && target.filePresent).length,
      schema8Archives: schema8Archives.length,
    },
    records,
    newConsumers,
    unmatchedHits,
    targetDefinitions,
    targetReferences,
    schema8Archives,
    selfDescriptions,
    invalidation: ['product-tree', 'inventory-canonical-digest', 'scanner-version', 'scope', 'query-catalog', 'record/target-expectation'],
    failureCategory: null,
    confirmedEndpointCount: relations.length,
    matchedConfirmedRelationCount: observedRelations.length,
    unknownCount,
    tokenHits: productHits.filter((hit) => hit.kind === 'token').length,
    targetReferenceHits: targetReferences.length,
  }

  if (options.reportPath) {
    if (options.mode !== 'zero') throw new LegacyInventoryError('malformed-inventory', '--report 只允许 zero mode')
    const expected = path.resolve(projectRoot, 'artifacts', 'release-evidence', 'v1.1', currentDigest, 'legacy-zero.json')
    if (path.resolve(options.reportPath) !== expected) throw new LegacyInventoryError('malformed-inventory', `report path 必须是 ${posix(path.relative(projectRoot, expected))}`)
    writeReportAtomically(expected, result)
  }
  return result
}

interface CliOptions {
  projectRoot: string
  mode: LegacyCheckMode
  requireIdentity: boolean
  reportPath?: string
}

function parseCliOptions(argv: readonly string[]): CliOptions {
  let projectRoot = defaultProjectRoot
  let mode: LegacyCheckMode = 'ratchet'
  let requireIdentity = false
  let reportPath: string | undefined
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--require-identity') {
      requireIdentity = true
      continue
    }
    if (argument === '--project-root' || argument === '--mode' || argument === '--report') {
      const value = argv[index + 1]
      if (!value) throw new Error(`${argument} 缺少参数`)
      index += 1
      if (argument === '--project-root') projectRoot = path.resolve(value)
      else if (argument === '--report') reportPath = path.resolve(value)
      else if (!LEGACY_CHECK_MODES.includes(value as LegacyCheckMode)) throw new Error('--mode 必须是 ratchet | ready | zero')
      else mode = value as LegacyCheckMode
      continue
    }
    throw new Error(`未知参数：${argument}`)
  }
  return { projectRoot, mode, requireIdentity, reportPath }
}

function main(): void {
  const options = parseCliOptions(process.argv.slice(2))
  const result = checkLegacyConsumers({ projectRoot: options.projectRoot, mode: options.mode, enforceDigest: options.requireIdentity, reportPath: options.reportPath })
  console.log(JSON.stringify(result, null, 2))
}

const invokedPath = process.argv[1]
if (invokedPath && path.resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (error: unknown) {
    if (error instanceof LegacyInventoryError) console.error(`legacy:${error.category}: ${error.message}`)
    else console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
