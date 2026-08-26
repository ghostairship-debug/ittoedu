import { createHash } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
} from 'node:fs'
import { extname, relative, resolve } from 'node:path'

export type InputDomain = 'source' | 'semantic' | 'config' | 'tool'

export interface RepoIndexConfig {
  schemaVersion: 1
  tsconfigPaths: string[]
  scanRoots: string[]
  includeExtensions: string[]
  excludePathPrefixes: string[]
  excludeFiles: string[]
  semanticRoot: string
  configFiles: string[]
  toolPathPrefixes: string[]
  toolFiles: string[]
}

export interface InputInventoryRecord {
  path: string
  domain: InputDomain
  contentHash: string
  bytes: number
}

export interface InputInventoryResult {
  records: readonly InputInventoryRecord[]
  hashes: Record<InputDomain, string>
}

const DOMAIN_ORDER: readonly InputDomain[] = ['source', 'semantic', 'config', 'tool']

function toSlashes(path: string): string {
  return path.replace(/\\/g, '/')
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function normalizedRelativePath(repoRoot: string, absolutePath: string): string {
  const path = toSlashes(relative(repoRoot, absolutePath)).replace(/^\.\//, '')
  if (path === '' || path === '.' || path === '..' || path.startsWith('../')) {
    throw new Error(`Input path is outside the repository: ${absolutePath}`)
  }
  return path
}

function normalizedConfiguredPath(path: string): string {
  const normalized = toSlashes(path).replace(/^\.\//, '').replace(/\/+$/, '')
  if (
    normalized.length === 0 ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.startsWith('/')
  ) {
    throw new Error(`Config paths must be repository-relative: ${path}`)
  }
  return normalized
}

function pathMatchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`)
}

function assertStringArray(value: unknown, field: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`repo-index config field ${field} must be a string array`)
  }
}

export function loadRepoIndexConfig(
  repoRoot: string,
  configPath = 'repo-index/config.json',
): RepoIndexConfig {
  const absolutePath = resolve(repoRoot, configPath)
  const parsed = JSON.parse(readFileSync(absolutePath, 'utf8')) as Record<string, unknown>
  if (parsed.schemaVersion !== 1) {
    throw new Error('repo-index config schemaVersion must be 1')
  }

  const tsconfigPaths = parsed.tsconfigPaths
  const scanRoots = parsed.scanRoots
  const includeExtensions = parsed.includeExtensions
  const excludePathPrefixes = parsed.excludePathPrefixes
  const excludeFiles = parsed.excludeFiles
  const configFiles = parsed.configFiles
  const toolPathPrefixes = parsed.toolPathPrefixes
  const toolFiles = parsed.toolFiles
  assertStringArray(tsconfigPaths, 'tsconfigPaths')
  assertStringArray(scanRoots, 'scanRoots')
  assertStringArray(includeExtensions, 'includeExtensions')
  assertStringArray(excludePathPrefixes, 'excludePathPrefixes')
  assertStringArray(excludeFiles, 'excludeFiles')
  assertStringArray(configFiles, 'configFiles')
  assertStringArray(toolPathPrefixes, 'toolPathPrefixes')
  assertStringArray(toolFiles, 'toolFiles')
  if (typeof parsed.semanticRoot !== 'string') {
    throw new Error('repo-index config field semanticRoot must be a string')
  }

  return {
    schemaVersion: 1,
    tsconfigPaths: tsconfigPaths.map(normalizedConfiguredPath).sort(compareText),
    scanRoots: scanRoots.map(normalizedConfiguredPath).sort(compareText),
    includeExtensions: includeExtensions.map((extension) => extension.toLowerCase()).sort(compareText),
    excludePathPrefixes: excludePathPrefixes.map(normalizedConfiguredPath).sort(compareText),
    excludeFiles: excludeFiles.map(normalizedConfiguredPath).sort(compareText),
    semanticRoot: normalizedConfiguredPath(parsed.semanticRoot),
    configFiles: configFiles.map(normalizedConfiguredPath).sort(compareText),
    toolPathPrefixes: toolPathPrefixes.map(normalizedConfiguredPath).sort(compareText),
    toolFiles: toolFiles.map(normalizedConfiguredPath).sort(compareText),
  }
}

export function normalizeTextBytes(bytes: Buffer): Buffer {
  const text = bytes.toString('utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  return Buffer.from(text, 'utf8')
}

function sha256(bytes: Buffer | string): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

export function hashInputBytes(bytes: Buffer): string {
  return sha256(normalizeTextBytes(bytes))
}

export function createInputInventoryRecord(
  path: string,
  domain: InputDomain,
  bytes: Buffer,
): InputInventoryRecord {
  const normalized = normalizeTextBytes(bytes)
  return {
    path,
    domain,
    contentHash: sha256(normalized),
    bytes: normalized.byteLength,
  }
}

export function classifyInputPath(path: string, config: RepoIndexConfig): InputDomain {
  const normalized = normalizedConfiguredPath(path)
  const explicitDomains: InputDomain[] = []

  if (pathMatchesPrefix(normalized, config.semanticRoot)) {
    explicitDomains.push('semantic')
  }
  if (config.configFiles.includes(normalized)) {
    explicitDomains.push('config')
  }
  if (
    config.toolFiles.includes(normalized) ||
    config.toolPathPrefixes.some((prefix) => pathMatchesPrefix(normalized, prefix))
  ) {
    explicitDomains.push('tool')
  }

  if (explicitDomains.length > 1) {
    throw new Error(
      `Input path belongs to multiple strict hash domains: ${normalized} -> ${explicitDomains.join(', ')}`,
    )
  }
  return explicitDomains[0] ?? 'source'
}

function isExcluded(path: string, config: RepoIndexConfig): boolean {
  return (
    config.excludeFiles.includes(path) ||
    config.excludePathPrefixes.some((prefix) => pathMatchesPrefix(path, prefix))
  )
}

function enumerateInputPaths(repoRoot: string, config: RepoIndexConfig): string[] {
  const paths = new Map<string, string>()
  const includedExtensions = new Set(config.includeExtensions)

  const visit = (absolutePath: string): void => {
    const relativePath = normalizedRelativePath(repoRoot, absolutePath)
    if (isExcluded(relativePath, config)) {
      return
    }

    const stat = lstatSync(absolutePath)
    if (stat.isSymbolicLink()) {
      return
    }
    if (stat.isDirectory()) {
      for (const name of readdirSync(absolutePath).sort(compareText)) {
        visit(resolve(absolutePath, name))
      }
      return
    }
    if (!stat.isFile() || !includedExtensions.has(extname(relativePath).toLowerCase())) {
      return
    }

    const key = process.platform === 'win32' ? relativePath.toLowerCase() : relativePath
    const existing = paths.get(key)
    if (existing && existing !== relativePath) {
      throw new Error(`Case-colliding repository paths cannot be indexed: ${existing}, ${relativePath}`)
    }
    paths.set(key, relativePath)
  }

  for (const root of config.scanRoots) {
    const absoluteRoot = resolve(repoRoot, root)
    if (!existsSync(absoluteRoot)) {
      throw new Error(`Configured scan root does not exist: ${root}`)
    }
    visit(absoluteRoot)
  }

  return [...paths.values()].sort(compareText)
}

function aggregateDomainHash(
  domain: InputDomain,
  records: readonly InputInventoryRecord[],
): string {
  const content = records
    .filter((record) => record.domain === domain)
    .map((record) => `${record.path}\0${record.domain}\0${record.contentHash}\n`)
    .join('')
  return sha256(content)
}

export function collectInputInventory(
  repoRoot: string,
  config: RepoIndexConfig,
): InputInventoryResult {
  const records = enumerateInputPaths(repoRoot, config).map((path) => {
    const bytes = readFileSync(resolve(repoRoot, path))
    return createInputInventoryRecord(path, classifyInputPath(path, config), bytes)
  })

  for (const requiredPath of [
    ...config.tsconfigPaths,
    ...config.configFiles,
    ...config.toolFiles,
  ]) {
    if (!records.some((record) => record.path === requiredPath)) {
      throw new Error(`Required strict input is unowned or excluded: ${requiredPath}`)
    }
  }

  return {
    records,
    hashes: Object.fromEntries(
      DOMAIN_ORDER.map((domain) => [domain, aggregateDomainHash(domain, records)]),
    ) as Record<InputDomain, string>,
  }
}
