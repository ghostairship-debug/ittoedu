import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, posix, relative, resolve } from 'node:path'

import { createTypeScriptIndexAdapter } from './typescriptAdapter'
import type {
  IndexedExport,
  IndexedExportBinding,
  IndexedSourceFile,
  IndexedTestCase,
  IndexedTopLevelSymbol,
} from './model'
import {
  classifyInputPath,
  collectInputInventory,
  loadRepoIndexConfig,
  normalizeTextBytes,
  type InputInventoryRecord,
  type RepoIndexConfig,
} from './inputInventory'
import {
  compareGeneratedFiles,
  hasGeneratedDifference,
  readGeneratedDirectory,
  replaceGeneratedDirectoryAtomically,
  serializeJson,
  serializeJsonLines,
  writeGeneratedFiles,
  type GeneratedDifference,
  type GeneratedFileMap,
} from './writeGenerated'

const GENERATED_SCHEMA_VERSION = 1
const GENERATOR_VERSION = 1
const STATUS_CLASSES = new Set([
  'current-must-preserve',
  'current-debt',
  'target-acceptance',
  'transitional-allowance',
])

interface GeneratedFactBase {
  schemaVersion: 1
  origin: 'generated'
  statusClass: 'current-must-preserve'
  evidence: readonly string[]
}

interface FileFact extends GeneratedFactBase {
  id: string
  path: string
  kind: string
  bytes: number
  contentHash: string
  projects: readonly string[]
  exports: readonly string[]
  tags: readonly string[]
}

interface SymbolFact extends GeneratedFactBase {
  id: string
  file: string
  name: string
  kind: string
  line: number
  endLine: number
  exported: boolean
  exportedAs: readonly string[]
  isDefault: boolean
  jsDoc?: string
}

interface TestFact extends GeneratedFactBase {
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

interface EdgeFact extends GeneratedFactBase {
  id: string
  kind: string
  from: string
  to: string
  specifier?: string
  line?: number
  resolved: boolean
  exportedName?: string
  localName?: string
  isTypeOnly?: boolean
  isDefault?: boolean
}

interface RepoIndexBuild {
  generatedFiles: Map<string, Buffer>
  summary: RepoIndexSummary
}

export interface RepoIndexSummary {
  inputCount: number
  fileCount: number
  symbolCount: number
  edgeCount: number
  testCount: number
  contractCount: number
  scriptCount: number
  docCount: number
  projectFileCounts: Record<string, number>
  outputBytes: number
}

export interface RepoIndexCheckResult {
  ok: boolean
  difference: GeneratedDifference
  summary: RepoIndexSummary
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function toSlashes(path: string): string {
  return path.replace(/\\/g, '/')
}

function generatedBase(evidence: string[]): GeneratedFactBase {
  return {
    schemaVersion: GENERATED_SCHEMA_VERSION,
    origin: 'generated',
    statusClass: 'current-must-preserve',
    evidence: [...evidence].sort(compareText),
  }
}

function flattenExportNames(exports: readonly IndexedExport[]): string[] {
  return [...new Set(exports.flatMap((entry) => entry.names))].sort(compareText)
}

function fileKind(path: string, isTypeScript: boolean): string {
  if (isTypeScript) return 'typescript'
  if (path.endsWith('.md')) return 'markdown'
  if (path.startsWith('docs/contracts/') || path.startsWith('artifacts/contracts/')) {
    return 'contract'
  }
  if (path.endsWith('.json')) return 'json'
  if (path.endsWith('.css')) return 'css'
  if (path.endsWith('.html')) return 'html'
  if (path.endsWith('.svg')) return 'svg'
  if (path.endsWith('.ps1')) return 'powershell'
  return extname(path).replace(/^\./, '') || 'text'
}

function fileTags(path: string, inventory: InputInventoryRecord): string[] {
  const tags = new Set<string>([inventory.domain])
  const first = path.split('/')[0]
  if (first) tags.add(first)
  for (const area of ['renderer', 'player', 'shared', 'main', 'preload', 'unit', 'integration', 'e2e']) {
    if (path.split('/').includes(area)) tags.add(area)
  }
  if (path.includes('/contracts/')) tags.add('contract')
  if (path.endsWith('.test.ts') || path.endsWith('.test.tsx') || path.includes('/tests/')) {
    tags.add('test')
  }
  return [...tags].sort(compareText)
}

export function createFileFact(
  input: InputInventoryRecord,
  scan?: IndexedSourceFile,
): FileFact {
  return {
    ...generatedBase([input.path]),
    id: `file:${input.path}`,
    path: input.path,
    kind: fileKind(input.path, scan !== undefined),
    bytes: input.bytes,
    contentHash: input.contentHash,
    projects: scan?.projects ?? [],
    exports: scan ? flattenExportNames(scan.exports) : [],
    tags: fileTags(input.path, input),
  }
}

function shouldIndexSymbol(
  symbol: IndexedTopLevelSymbol,
  exportedLocalNames: ReadonlySet<string> = new Set(),
): boolean {
  if (symbol.exported || exportedLocalNames.has(symbol.name)) return true
  if (symbol.kind !== 'const' && symbol.kind !== 'let' && symbol.kind !== 'var') return true
  return /^[A-Z][A-Z0-9_]*$/.test(symbol.name)
}

function symbolId(file: string, symbol: IndexedTopLevelSymbol): string {
  return `symbol:${file}#${symbol.kind}:${symbol.name}:${symbol.line}`
}

function virtualExportSymbolId(file: string, exportedName: string, line: number): string {
  return `symbol:${file}#export-alias:${exportedName}:${line}`
}

interface ExportTarget {
  binding: IndexedExportBinding
  line: number
  targetId: string
}

interface ScanSymbolFacts {
  facts: SymbolFact[]
  exportTargets: ExportTarget[]
}

function buildScanSymbolFacts(scan: IndexedSourceFile): ScanSymbolFacts {
  const localExports = scan.exports
    .filter((entry) => !entry.moduleSpecifier)
    .flatMap((entry) => entry.bindings.map((binding) => ({ binding, line: entry.line })))
  const exportedByLocalName = new Map<string, Set<string>>()
  for (const { binding } of localExports) {
    if (!binding.localName) continue
    const names = exportedByLocalName.get(binding.localName) ?? new Set<string>()
    names.add(binding.exportedName)
    exportedByLocalName.set(binding.localName, names)
  }
  const exportedLocalNames = new Set(exportedByLocalName.keys())
  const facts = scan.symbols
    .filter((symbol) => shouldIndexSymbol(symbol, exportedLocalNames))
    .map((symbol): SymbolFact => {
      const exportedAs = [...(exportedByLocalName.get(symbol.name) ?? [])]
      if (symbol.exported && exportedAs.length === 0) {
        exportedAs.push(symbol.isDefault ? 'default' : symbol.name)
      }
      exportedAs.sort(compareText)
      return {
        ...generatedBase([scan.path]),
        id: symbolId(scan.path, symbol),
        file: scan.path,
        name: symbol.name,
        kind: symbol.kind,
        line: symbol.line,
        endLine: symbol.endLine,
        exported: symbol.exported || exportedAs.length > 0,
        exportedAs,
        isDefault: symbol.isDefault || exportedAs.includes('default'),
        ...(symbol.jsDoc ? { jsDoc: symbol.jsDoc } : {}),
      }
    })
  const factByLocalName = new Map<string, SymbolFact>()
  for (const fact of facts) {
    if (!factByLocalName.has(fact.name)) {
      factByLocalName.set(fact.name, fact)
    }
  }

  const virtualFacts = new Map<string, SymbolFact>()
  const exportTargets = localExports.map(({ binding, line }) => {
    const localFact = binding.localName
      ? factByLocalName.get(binding.localName)
      : undefined
    if (localFact) {
      return { binding, line, targetId: localFact.id }
    }
    const id = virtualExportSymbolId(scan.path, binding.exportedName, line)
    if (!virtualFacts.has(id)) {
      virtualFacts.set(id, {
        ...generatedBase([scan.path]),
        id,
        file: scan.path,
        name: binding.exportedName,
        kind: 'export-alias',
        line,
        endLine: line,
        exported: true,
        exportedAs: [binding.exportedName],
        isDefault: binding.exportedName === 'default',
      })
    }
    return { binding, line, targetId: id }
  })

  return {
    facts: [...facts, ...virtualFacts.values()].sort((left, right) => compareText(left.id, right.id)),
    exportTargets,
  }
}

function testId(file: string, test: IndexedTestCase): string {
  return `test:${file}#${test.kind}:${test.line}:${test.name}`
}

function testExecution(path: string): Pick<TestFact, 'runnable' | 'command' | 'diagnostic'> {
  if (path.startsWith('tests/e2e/')) {
    return { runnable: true, command: `npx playwright test ${path}` }
  }
  if (path.startsWith('tests/unit/') || path.startsWith('tests/integration/')) {
    return { runnable: true, command: `npx vitest run ${path}` }
  }
  return {
    runnable: false,
    diagnostic: path.startsWith('scripts/repo-index/fixtures/')
      ? 'Parser fixture; execute through tests/unit/repoIndexTypeScriptAdapter.test.ts.'
      : 'No repository test runner includes this statically detected test path.',
  }
}

function moduleCandidates(fromPath: string, specifier: string): string[] {
  let base: string | undefined
  const pathSpecifier = specifier.replace(/[?#].*$/, '')
  if (pathSpecifier.startsWith('.')) {
    base = posix.normalize(posix.join(posix.dirname(fromPath), pathSpecifier))
  } else if (pathSpecifier.startsWith('@/')) {
    base = posix.join('src', pathSpecifier.slice(2))
  }
  if (!base) return []

  const withoutJsExtension = base.replace(/\.(?:mjs|cjs|js|jsx)$/i, '')
  const bases = withoutJsExtension === base ? [base] : [base, withoutJsExtension]
  return [...new Set(bases.flatMap((candidate) => [
    candidate,
    `${candidate}.ts`,
    `${candidate}.tsx`,
    `${candidate}.mts`,
    `${candidate}.cts`,
    `${candidate}.d.ts`,
    `${candidate}.json`,
    `${candidate}/index.ts`,
    `${candidate}/index.tsx`,
    `${candidate}/index.mts`,
    `${candidate}/index.cts`,
    `${candidate}/index.d.ts`,
  ]))]
}

function resolveModulePath(
  fromPath: string,
  specifier: string,
  indexedPaths: ReadonlySet<string>,
): string | undefined {
  return moduleCandidates(fromPath, specifier)
    .find((candidate) => indexedPaths.has(candidate))
}

function edgeId(
  kind: string,
  from: string,
  to: string,
  line?: number,
  discriminator?: string,
): string {
  return `edge:${kind}:${from}->${to}${line === undefined ? '' : `:${line}`}${
    discriminator ? `:${discriminator}` : ''
  }`
}

function deduplicateEdges(edges: readonly EdgeFact[]): EdgeFact[] {
  const records = new Map<string, EdgeFact>()
  for (const edge of edges) {
    records.set(edge.id, edge)
  }
  return [...records.values()].sort((left, right) => compareText(left.id, right.id))
}

function readJson(repoRoot: string, path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(repoRoot, path), 'utf8')) as Record<string, unknown>
}

function semanticCollections(repoRoot: string): Record<string, unknown>[] {
  return [
    'repo-index/semantic/features.json',
    'repo-index/semantic/invariants.json',
    'repo-index/semantic/modules.json',
    'repo-index/semantic/exclusions.json',
  ].map((path) => readJson(repoRoot, path))
}

function semanticRecords(collection: Record<string, unknown>): Record<string, unknown>[] {
  const key = Object.keys(collection).find((candidate) => candidate !== 'schemaVersion')
  const value = key ? collection[key] : undefined
  if (!key || !Array.isArray(value)) {
    throw new Error('Semantic files must contain schemaVersion and one record array')
  }
  return value as Record<string, unknown>[]
}

function validateSemantic(repoRoot: string): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = []
  const pathFields = new Set([
    'canonicalFiles',
    'entrypoints',
    'evidence',
    'runtimeConsumers',
    'tests',
  ])

  for (const collection of semanticCollections(repoRoot)) {
    if (collection.schemaVersion !== 1) {
      throw new Error('Semantic collection schemaVersion must be 1')
    }
    for (const record of semanticRecords(collection)) {
      if (
        record.schemaVersion !== 1 ||
        record.origin !== 'semantic' ||
        typeof record.id !== 'string' ||
        !STATUS_CLASSES.has(String(record.statusClass))
      ) {
        throw new Error(`Invalid semantic record provenance: ${String(record.id)}`)
      }
      if (
        record.statusClass === 'transitional-allowance' &&
        typeof record.removalPhase !== 'string' &&
        typeof record.reviewGate !== 'string'
      ) {
        throw new Error(`Transitional semantic record lacks removal/review gate: ${record.id}`)
      }

      for (const field of pathFields) {
        const values = record[field]
        if (values === undefined) continue
        if (!Array.isArray(values) || values.some((value) => typeof value !== 'string')) {
          throw new Error(`Semantic ${String(record.id)} field ${field} must be paths`)
        }
        for (const value of values as string[]) {
          if (
            /^[A-Za-z]:[\\/]/.test(value) ||
            value.startsWith('/') ||
            value.includes('\\') ||
            value === '..' ||
            value.startsWith('../')
          ) {
            throw new Error(`Semantic paths must be repository-relative POSIX paths: ${value}`)
          }
          if (!existsSync(resolve(repoRoot, value))) {
            throw new Error(`Semantic evidence path does not exist: ${value}`)
          }
        }
      }
      records.push(record)
    }
  }
  return records.sort((left, right) => compareText(String(left.id), String(right.id)))
}

export function verifyContractArtifactHash(
  repoRoot: string,
  artifactPath: string,
  expectedSha256: string,
): void {
  const artifact = resolve(repoRoot, artifactPath)
  if (!existsSync(artifact)) {
    throw new Error(`Contract artifact does not exist: ${artifactPath}`)
  }
  const actual = createHash('sha256').update(readFileSync(artifact)).digest('hex')
  const expected = expectedSha256.replace(/^sha256:/, '').toLowerCase()
  if (actual !== expected) {
    throw new Error(
      `Contract artifact hash mismatch: ${artifactPath} expected ${expected} but found ${actual}`,
    )
  }
}

function buildContracts(
  repoRoot: string,
  inventory: readonly InputInventoryRecord[],
  packageJson: Record<string, unknown>,
): Record<string, unknown> {
  const manifest = readJson(repoRoot, 'artifacts/contracts/contract-manifest.json')
  const manifestContracts = Array.isArray(manifest.contracts)
    ? manifest.contracts as Record<string, unknown>[]
    : []
  for (const contract of manifestContracts) {
    const artifact = `artifacts/contracts/${String(contract.file)}`
    const source = String(contract.sourceOfTruth)
    if (!existsSync(resolve(repoRoot, source))) {
      throw new Error(`Contract manifest references a missing path: ${artifact} / ${source}`)
    }
    verifyContractArtifactHash(repoRoot, artifact, String(contract.sha256))
  }

  const scripts = packageJson.scripts as Record<string, string>
  return {
    schemaVersion: 1,
    origin: 'generated',
    statusClass: 'current-must-preserve',
    evidence: ['artifacts/contracts/contract-manifest.json'],
    manifestVersion: manifest.manifestVersion,
    generationCommand: manifest.generationCommand,
    checkCommands: Object.entries(scripts)
      .filter(([name]) => name.includes('contract'))
      .sort(([left], [right]) => compareText(left, right))
      .map(([name, command]) => ({ name, command })),
    contracts: manifestContracts
      .map((contract) => ({
        name: contract.name,
        sourceOfTruth: contract.sourceOfTruth,
        artifact: `artifacts/contracts/${String(contract.file)}`,
        sha256: contract.sha256,
      }))
      .sort((left, right) => compareText(String(left.name), String(right.name))),
    sourceFiles: inventory
      .map((record) => record.path)
      .filter((path) => path.startsWith('src/shared/contracts/'))
      .sort(compareText),
    humanDocs: inventory
      .map((record) => record.path)
      .filter((path) => path.startsWith('docs/contracts/'))
      .sort(compareText),
  }
}

function scriptCategory(name: string): string {
  return name.includes('check') || name.includes('verify') || name.includes('validate')
    ? 'check'
    : name.includes('test')
      ? 'test'
      : name.includes('build') || name.includes('generate')
        ? 'build'
        : name.includes('dev') || name === 'start'
          ? 'run'
          : 'other'
}

function buildScripts(
  inventory: readonly InputInventoryRecord[],
  packageJson: Record<string, unknown>,
): Record<string, unknown> {
  const scripts = packageJson.scripts as Record<string, string>
  return {
    schemaVersion: 1,
    origin: 'generated',
    statusClass: 'current-must-preserve',
    evidence: ['package.json', 'scripts'],
    packageScripts: Object.entries(scripts)
      .sort(([left], [right]) => compareText(left, right))
      .map(([name, command]) => ({ name, command, category: scriptCategory(name) })),
    entrypoints: inventory
      .map((record) => record.path)
      .filter((path) => path.startsWith('scripts/') && !path.includes('/fixtures/'))
      .map((path) => ({
        path,
        role: path.startsWith('scripts/repo-index/') || path === 'scripts/generate-repo-index.ts'
          ? 'repo-index-tool'
          : 'project-tool',
      }))
      .sort((left, right) => compareText(left.path, right.path)),
  }
}

function markdownTitle(text: string, path: string): string {
  const title = text.match(/^#\s+(.+)$/m)?.[1]?.trim()
  return title || posix.basename(path)
}

function markdownLinkTarget(rawTarget: string): string {
  const trimmed = rawTarget.trim()
  if (trimmed.startsWith('<')) {
    const closing = trimmed.indexOf('>')
    return closing >= 0 ? trimmed.slice(1, closing) : trimmed
  }
  return trimmed.split(/\s+['"]/)[0]
}

function stripFencedMarkdown(text: string): string {
  const lines = text.split('\n')
  let fenceCharacter: '`' | '~' | undefined
  let fenceLength = 0
  return lines.map((line) => {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/)?.[1]
    if (!fenceCharacter) {
      if (marker) {
        fenceCharacter = marker[0] as '`' | '~'
        fenceLength = marker.length
        return ''
      }
      return line
    }
    if (
      marker &&
      marker[0] === fenceCharacter &&
      marker.length >= fenceLength &&
      /^\s{0,3}(?:`{3,}|~{3,})\s*$/.test(line)
    ) {
      fenceCharacter = undefined
      fenceLength = 0
    }
    return ''
  }).join('\n')
}

function referenceLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLowerCase()
}

function markdownAnchorSlug(heading: string): string {
  return heading
    .replace(/<[^>]*>/g, '')
    .replace(/[`*_~]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
}

function markdownAnchors(text: string): Set<string> {
  const stripped = stripFencedMarkdown(text)
  const anchors = new Set<string>()
  const duplicateCounts = new Map<string, number>()
  for (const line of stripped.split('\n')) {
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/)?.[1]
    if (heading) {
      const base = markdownAnchorSlug(heading)
      if (base) {
        const duplicate = duplicateCounts.get(base) ?? 0
        duplicateCounts.set(base, duplicate + 1)
        anchors.add(duplicate === 0 ? base : `${base}-${duplicate}`)
      }
    }
    for (const match of line.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)) {
      anchors.add(match[1].toLowerCase())
    }
  }
  return anchors
}

function validateMarkdownTarget(
  repoRoot: string,
  sourcePath: string,
  sourceText: string,
  rawTarget: string,
): string | undefined {
  const target = markdownLinkTarget(rawTarget)
  if (
    target.length === 0 ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(target)
  ) {
    return undefined
  }
  const hashIndex = target.indexOf('#')
  const rawPath = (hashIndex >= 0 ? target.slice(0, hashIndex) : target).split('?', 1)[0]
  const rawFragment = hashIndex >= 0 ? target.slice(hashIndex + 1) : ''
  let decodedPath: string
  let decodedFragment: string
  try {
    decodedPath = decodeURIComponent(rawPath)
    decodedFragment = decodeURIComponent(rawFragment).toLowerCase()
  } catch {
    decodedPath = rawPath
    decodedFragment = rawFragment.toLowerCase()
  }
  if (decodedPath.includes('\\')) {
    throw new Error(`Markdown links must use POSIX paths: ${sourcePath} -> ${target}`)
  }

  const normalized = decodedPath.length === 0
    ? sourcePath
    : toSlashes(relative(
        repoRoot,
        resolve(repoRoot, posix.dirname(sourcePath), decodedPath),
      ))
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`Markdown link escapes repository: ${sourcePath} -> ${target}`)
  }
  const absoluteTarget = resolve(repoRoot, normalized)
  if (!existsSync(absoluteTarget)) {
    throw new Error(`Markdown link target does not exist: ${sourcePath} -> ${target}`)
  }
  if (decodedFragment && normalized.endsWith('.md')) {
    const targetText = normalized === sourcePath
      ? sourceText
      : normalizeTextBytes(readFileSync(absoluteTarget)).toString('utf8')
    if (!markdownAnchors(targetText).has(decodedFragment)) {
      throw new Error(
        `Markdown link anchor does not exist: ${sourcePath} -> ${target}`,
      )
    }
  }
  return decodedFragment ? `${normalized}#${decodedFragment}` : normalized
}

export function validateMarkdownLinks(
  repoRoot: string,
  path: string,
  text: string,
): string[] {
  const stripped = stripFencedMarkdown(text)
  const rawTargets = new Set<string>()
  const definitions = new Map<string, string>()

  for (const match of stripped.matchAll(/^\s{0,3}\[([^\]]+)\]:\s*(<[^>]+>|\S+)/gm)) {
    const label = referenceLabel(match[1])
    const target = match[2]
    definitions.set(label, target)
    rawTargets.add(target)
  }
  for (const match of stripped.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    rawTargets.add(match[1])
  }
  for (const match of stripped.matchAll(/!?\[([^\]]+)\]\[([^\]]*)\]/g)) {
    const label = referenceLabel(match[2] || match[1])
    const target = definitions.get(label)
    if (!target) {
      throw new Error(`Markdown reference is undefined: ${path} -> [${label}]`)
    }
    rawTargets.add(target)
  }

  const links = new Set<string>()
  for (const target of rawTargets) {
    const normalized = validateMarkdownTarget(repoRoot, path, text, target)
    if (normalized) {
      links.add(normalized)
    }
  }
  return [...links].sort(compareText)
}

function buildDocs(
  repoRoot: string,
  inventory: readonly InputInventoryRecord[],
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    origin: 'generated',
    statusClass: 'current-must-preserve',
    evidence: ['README.md', 'docs'],
    documents: inventory
      .filter((record) => record.path.endsWith('.md'))
      .map((record) => {
        const text = normalizeTextBytes(readFileSync(resolve(repoRoot, record.path))).toString('utf8')
        return {
          path: record.path,
          title: markdownTitle(text, record.path),
          links: validateMarkdownLinks(repoRoot, record.path, text),
        }
      })
      .sort((left, right) => compareText(left.path, right.path)),
  }
}

function assertGeneratedPurity(
  repoRoot: string,
  generatedFiles: GeneratedFileMap,
): void {
  const normalizedRoot = toSlashes(resolve(repoRoot)).toLowerCase()
  const windowsRoot = resolve(repoRoot).toLowerCase()
  const forbiddenKeys = /"(?:generatedAt|timestamp|gitHead|head|username|user|hostname|machine|absolutePath)"\s*:/i

  for (const [name, bytes] of generatedFiles) {
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      throw new Error(`Generated file contains UTF-8 BOM: ${name}`)
    }
    const text = bytes.toString('utf8')
    if (text.includes('\r')) {
      throw new Error(`Generated file contains non-LF newlines: ${name}`)
    }
    const lower = text.toLowerCase()
    if (lower.includes(normalizedRoot) || lower.includes(windowsRoot)) {
      throw new Error(`Generated file leaks the absolute repository path: ${name}`)
    }
    if (forbiddenKeys.test(text)) {
      throw new Error(`Generated file contains a forbidden nondeterministic field: ${name}`)
    }
    if (name === 'input-inventory.jsonl' && text.includes('repo-index/generated/')) {
      throw new Error('Generated output is included in its own strict input inventory')
    }
  }
}

function projectCounts(scans: readonly IndexedSourceFile[], config: RepoIndexConfig): Record<string, number> {
  return Object.fromEntries(config.tsconfigPaths.map((project) => [
    project,
    scans.filter((scan) => scan.projects.includes(project)).length,
  ]))
}

function buildFacts(repoRoot: string): RepoIndexBuild {
  const config = loadRepoIndexConfig(repoRoot)
  const inventoryResult = collectInputInventory(repoRoot, config)
  const inventoryByPath = new Map(inventoryResult.records.map((record) => [record.path, record]))
  const semantic = validateSemantic(repoRoot)
  const packageJson = readJson(repoRoot, 'package.json')

  const adapter = createTypeScriptIndexAdapter({ repoRoot })
  let scans: IndexedSourceFile[]
  try {
    adapter.loadProjects(config.tsconfigPaths)
    scans = adapter.listFiles().map((membership) => adapter.scanFile(membership.path))
  } finally {
    adapter.dispose()
  }
  const scanByPath = new Map(scans.map((scan) => [scan.path, scan]))
  for (const scan of scans) {
    const input = inventoryByPath.get(scan.path)
    if (!input) {
      throw new Error(`TypeScript project file is not owned by a strict input domain: ${scan.path}`)
    }
    if (classifyInputPath(scan.path, config) !== input.domain) {
      throw new Error(`TypeScript input domain changed during generation: ${scan.path}`)
    }
  }

  const fileFacts: FileFact[] = inventoryResult.records.map((input) =>
    createFileFact(input, scanByPath.get(input.path)),
  )

  const symbolFactsByPath = new Map(
    scans.map((scan) => [scan.path, buildScanSymbolFacts(scan)] as const),
  )
  const symbolFacts: SymbolFact[] = [...symbolFactsByPath.values()]
    .flatMap((entry) => entry.facts)
    .sort((left, right) => compareText(left.id, right.id))

  const indexedPaths = new Set(inventoryResult.records.map((record) => record.path))
  const relatedByTest = new Map<string, Set<string>>()
  for (const scan of scans) {
    if (scan.tests.length === 0) continue
    const related = relatedByTest.get(scan.path) ?? new Set<string>()
    for (const imported of scan.imports) {
      const resolved = resolveModulePath(scan.path, imported.moduleSpecifier, indexedPaths)
      if (resolved) related.add(resolved)
    }
    relatedByTest.set(scan.path, related)
  }

  const testFacts: TestFact[] = scans.flatMap((scan) =>
    scan.tests.map((test) => ({
      ...generatedBase([scan.path]),
      id: testId(scan.path, test),
      file: scan.path,
      kind: test.kind,
      name: test.name,
      line: test.line,
      suite: test.suite ?? [],
      ...testExecution(scan.path),
      relatedFiles: [...(relatedByTest.get(scan.path) ?? [])].sort(compareText),
    })),
  ).sort((left, right) => compareText(left.id, right.id))

  const edges: EdgeFact[] = []
  for (const scan of scans) {
    const from = `file:${scan.path}`
    const scanSymbolFacts = symbolFactsByPath.get(scan.path)!
    for (const symbol of scanSymbolFacts.facts) {
      const to = symbol.id
      edges.push({
        ...generatedBase([scan.path]),
        id: edgeId('contains', from, to, symbol.line),
        kind: 'contains',
        from,
        to,
        line: symbol.line,
        resolved: true,
      })
    }
    for (const target of scanSymbolFacts.exportTargets) {
      edges.push({
        ...generatedBase([scan.path]),
        id: edgeId(
          'exports',
          from,
          target.targetId,
          target.line,
          target.binding.exportedName,
        ),
        kind: 'exports',
        from,
        to: target.targetId,
        line: target.line,
        resolved: true,
        exportedName: target.binding.exportedName,
        ...(target.binding.localName ? { localName: target.binding.localName } : {}),
        isTypeOnly: target.binding.isTypeOnly,
        isDefault: target.binding.exportedName === 'default',
      })
    }
    for (const test of scan.tests) {
      const to = testId(scan.path, test)
      edges.push({
        ...generatedBase([scan.path]),
        id: edgeId('contains', from, to, test.line),
        kind: 'contains',
        from,
        to,
        line: test.line,
        resolved: true,
      })
    }
    for (const imported of scan.imports) {
      const resolvedPath = resolveModulePath(scan.path, imported.moduleSpecifier, indexedPaths)
      const kind = imported.kind === 'dynamic'
        ? 'imports_dynamic'
        : imported.isTypeOnly
          ? 'imports_type'
          : 'imports'
      const to = resolvedPath
        ? `file:${resolvedPath}`
        : `module:${imported.moduleSpecifier}`
      edges.push({
        ...generatedBase([scan.path]),
        id: edgeId(kind, from, to, imported.line),
        kind,
        from,
        to,
        specifier: imported.moduleSpecifier,
        line: imported.line,
        resolved: resolvedPath !== undefined,
      })
      if (resolvedPath?.startsWith('src/shared/contracts/')) {
        edges.push({
          ...generatedBase([scan.path, resolvedPath]),
          id: edgeId('references_contract', from, `file:${resolvedPath}`, imported.line),
          kind: 'references_contract',
          from,
          to: `file:${resolvedPath}`,
          line: imported.line,
          resolved: true,
        })
      }
      if (scan.tests.length > 0 && resolvedPath) {
        edges.push({
          ...generatedBase([scan.path, resolvedPath]),
          id: edgeId('tested_by', `file:${resolvedPath}`, from),
          kind: 'tested_by',
          from: `file:${resolvedPath}`,
          to: from,
          resolved: true,
        })
      }
    }
    for (const exported of scan.exports) {
      if (!exported.moduleSpecifier) continue
      const resolvedPath = resolveModulePath(scan.path, exported.moduleSpecifier, indexedPaths)
      const to = resolvedPath
        ? `file:${resolvedPath}`
        : `module:${exported.moduleSpecifier}`
      edges.push({
        ...generatedBase([scan.path]),
        id: edgeId('re_exports', from, to, exported.line),
        kind: 're_exports',
        from,
        to,
        specifier: exported.moduleSpecifier,
        line: exported.line,
        resolved: resolvedPath !== undefined,
      })
    }
  }

  for (const record of semantic) {
    if (!String(record.id).startsWith('module:') || !Array.isArray(record.entrypoints)) continue
    for (const path of record.entrypoints as string[]) {
      edges.push({
        ...generatedBase([path]),
        id: edgeId('entrypoint_of', `file:${path}`, String(record.id)),
        kind: 'entrypoint_of',
        from: `file:${path}`,
        to: String(record.id),
        resolved: true,
      })
    }
  }

  const edgeFacts = deduplicateEdges(edges)
  const contracts = buildContracts(repoRoot, inventoryResult.records, packageJson)
  const scripts = buildScripts(inventoryResult.records, packageJson)
  const docs = buildDocs(repoRoot, inventoryResult.records)
  const contractCount = (contracts.contracts as unknown[]).length +
    (contracts.sourceFiles as unknown[]).length +
    (contracts.humanDocs as unknown[]).length
  const scriptCount = (scripts.packageScripts as unknown[]).length +
    (scripts.entrypoints as unknown[]).length
  const docCount = (docs.documents as unknown[]).length
  const parserVersion = String(
    (packageJson.devDependencies as Record<string, unknown>).typescript,
  )

  const manifest = {
    schemaVersion: GENERATED_SCHEMA_VERSION,
    generatorVersion: GENERATOR_VERSION,
    sourceTreeHash: inventoryResult.hashes.source,
    semanticHash: inventoryResult.hashes.semantic,
    configHash: inventoryResult.hashes.config,
    toolHash: inventoryResult.hashes.tool,
    inputCount: inventoryResult.records.length,
    inputDomainCounts: Object.fromEntries(
      (['source', 'semantic', 'config', 'tool'] as const).map((domain) => [
        domain,
        inventoryResult.records.filter((record) => record.domain === domain).length,
      ]),
    ),
    fileCount: fileFacts.length,
    symbolCount: symbolFacts.length,
    edgeCount: edgeFacts.length,
    testCount: testFacts.length,
    contractCount,
    scriptCount,
    docCount,
    projects: config.tsconfigPaths.map((path) => ({
      path,
      fileCount: scans.filter((scan) => scan.projects.includes(path)).length,
    })),
    parser: { name: 'typescript', version: parserVersion },
    pathFormat: 'repository-relative-posix',
    textNormalization: 'utf8-no-bom-lf',
  }

  const generatedFiles = new Map<string, Buffer>([
    ['manifest.json', serializeJson(manifest)],
    ['input-inventory.jsonl', serializeJsonLines(inventoryResult.records)],
    ['files.jsonl', serializeJsonLines(fileFacts)],
    ['symbols.jsonl', serializeJsonLines(symbolFacts)],
    ['edges.jsonl', serializeJsonLines(edgeFacts)],
    ['tests.jsonl', serializeJsonLines(testFacts)],
    ['contracts.json', serializeJson(contracts)],
    ['scripts.json', serializeJson(scripts)],
    ['docs.json', serializeJson(docs)],
  ])
  assertGeneratedPurity(repoRoot, generatedFiles)

  const summary: RepoIndexSummary = {
    inputCount: inventoryResult.records.length,
    fileCount: fileFacts.length,
    symbolCount: symbolFacts.length,
    edgeCount: edgeFacts.length,
    testCount: testFacts.length,
    contractCount,
    scriptCount,
    docCount,
    projectFileCounts: projectCounts(scans, config),
    outputBytes: [...generatedFiles.values()]
      .reduce((total, bytes) => total + bytes.byteLength, 0),
  }
  return { generatedFiles, summary }
}

export function generateRepoIndexToDirectory(
  repoRoot: string,
  outputDirectory: string,
): RepoIndexSummary {
  const build = buildFacts(resolve(repoRoot))
  writeGeneratedFiles(resolve(outputDirectory), build.generatedFiles)
  return build.summary
}

export function writeRepoIndex(repoRoot: string): RepoIndexSummary {
  const root = resolve(repoRoot)
  const build = buildFacts(root)
  replaceGeneratedDirectoryAtomically(
    resolve(root, 'repo-index/generated'),
    build.generatedFiles,
  )
  return build.summary
}

export function checkRepoIndex(
  repoRoot: string,
  expectedDirectory?: string,
): RepoIndexCheckResult {
  const root = resolve(repoRoot)
  const build = buildFacts(root)
  const temporary = mkdtempSync(resolve(tmpdir(), 'ittoedu-repo-index-check-'))
  try {
    writeGeneratedFiles(temporary, build.generatedFiles)
    const temporaryFiles = readGeneratedDirectory(temporary)
    const committedFiles = readGeneratedDirectory(
      expectedDirectory ? resolve(expectedDirectory) : resolve(root, 'repo-index/generated'),
    )
    const internalDifference = compareGeneratedFiles(build.generatedFiles, temporaryFiles)
    if (hasGeneratedDifference(internalDifference)) {
      throw new Error('Temporary repo-index output differs from the in-memory deterministic build')
    }
    const difference = compareGeneratedFiles(temporaryFiles, committedFiles)
    return {
      ok: !hasGeneratedDifference(difference),
      difference,
      summary: build.summary,
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

export function hashGeneratedDirectory(directory: string): string {
  const files = readGeneratedDirectory(directory)
  const hash = createHash('sha256')
  for (const [name, bytes] of [...files.entries()].sort(([left], [right]) => compareText(left, right))) {
    hash.update(name)
    hash.update('\0')
    hash.update(bytes)
    hash.update('\n')
  }
  return `sha256:${hash.digest('hex')}`
}

export function generatedDirectoryStats(directory: string): Record<string, number> {
  return Object.fromEntries(
    [...readGeneratedDirectory(directory).entries()]
      .map(([name, bytes]) => [name, bytes.byteLength] as const)
      .sort(([left], [right]) => compareText(left, right)),
  )
}
