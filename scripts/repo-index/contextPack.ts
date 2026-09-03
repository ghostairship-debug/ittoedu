import type {
  ContextPackSize,
  ExclusionSemantic,
  InvariantSemantic,
  QueryCandidate,
  QueryResult,
} from './query'

interface ContextPackLimits {
  maxBytes: number
  maxLines: number
  candidates: number
  paths: number
  edges: number
  tests: number
  invariants: number
  unknowns: number
}

export interface ContextPackResult {
  markdown: string
  bytes: number
  lines: number
  size: ContextPackSize
}

const LIMITS: Record<ContextPackSize, ContextPackLimits> = {
  small: {
    maxBytes: 20 * 1024,
    maxLines: 350,
    candidates: 5,
    paths: 12,
    edges: 8,
    tests: 6,
    invariants: 4,
    unknowns: 8,
  },
  medium: {
    maxBytes: 50 * 1024,
    maxLines: 800,
    candidates: 10,
    paths: 30,
    edges: 18,
    tests: 12,
    invariants: 8,
    unknowns: 16,
  },
  large: {
    maxBytes: 100 * 1024,
    maxLines: 1600,
    candidates: 20,
    paths: 60,
    edges: 36,
    tests: 25,
    invariants: 16,
    unknowns: 30,
  },
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function unique(values: readonly (string | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}

function bullets(values: readonly string[], empty = 'None identified.'): string {
  return values.length > 0
    ? values.map((value) => `- ${value}`).join('\n')
    : `- ${empty}`
}

function shorten(value: string | undefined, max = 360): string | undefined {
  if (!value) return undefined
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`
}

function safeRequestValue(value: string | undefined): string {
  if (!value) return '(none)'
  const normalized = value.normalize('NFKC').replace(/[\r\n\t]+/g, ' ').trim()
  if (/^[A-Za-z]:[\\/]/.test(normalized) || normalized.startsWith('/')) {
    return '[absolute input omitted]'
  }
  return shorten(normalized, 200) ?? '(none)'
}

function candidateLine(candidate: QueryCandidate): string {
  const reasons = candidate.reasons.length > 0 ? `; ${candidate.reasons.join('; ')}` : ''
  return `${candidate.kind} ${candidate.id} — ${candidate.label} (score ${candidate.score}${reasons})`
}

function edgePath(id: string): string | undefined {
  return id.startsWith('file:') ? id.slice('file:'.length) : undefined
}

function consumerLines(result: QueryResult, limit: number): string[] {
  const declared = unique([
    ...(result.matchedFeature?.runtimeConsumers ?? []),
    ...(result.associatedFeatures ?? []).flatMap(
      (feature) => feature.runtimeConsumers ?? [],
    ),
  ])
  const fromEdges = result.relatedEdges.flatMap((edge) => {
    if (!['imports', 'imports_type', 'imports_dynamic', 'tested_by', 're_exports'].includes(edge.kind)) {
      return []
    }
    const from = edgePath(edge.from)
    const to = edgePath(edge.to)
    if (!from || !to) return []
    return [`${edge.kind}: ${from} → ${to}`]
  })
  return unique([
    ...declared.map((path) => `declared consumer: ${path}`),
    ...fromEdges,
  ]).slice(0, limit)
}

function currentStatusLines(result: QueryResult): string[] {
  const feature = result.matchedFeature
  return unique([
    feature ? `statusClass: ${feature.statusClass}` : undefined,
    feature?.owner ? `owner: ${feature.owner}` : undefined,
    shorten(feature?.currentFact) ? `current: ${shorten(feature?.currentFact)}` : undefined,
    shorten(feature?.targetState) ? `target: ${shorten(feature?.targetState)}` : undefined,
    ...result.modules.map((module) =>
      `module ${module.id}: ${module.status}/${module.statusClass}; owner ${module.owner ?? 'unknown'}`,
    ),
    ...(result.associatedFeatures ?? [])
      .filter((associated) => associated.id !== feature?.id)
      .map((associated) =>
        `associated ${associated.id}: ${associated.statusClass}; ${shorten(associated.currentFact) ?? 'semantic evidence only'}`,
      ),
  ])
}

function canonicalLines(result: QueryResult, limit: number): string[] {
  const features = result.matchedFeature
    ? [result.matchedFeature, ...(result.associatedFeatures ?? []).filter(
        (feature) => feature.id !== result.matchedFeature?.id,
      )]
    : result.associatedFeatures ?? []
  const carriers = features.flatMap((feature) => feature.carriers
    ? Object.entries(feature.carriers)
        .sort(([left], [right]) => compareText(left, right))
        .map(([surface, carrier]) => `${feature.id} carrier ${surface}: ${carrier}`)
    : [])
  return unique([
    ...features.flatMap((feature) => [
      ...(feature.canonicalFiles ?? []).map((path) =>
        feature.catalogIntent && feature.catalogBoundaryFiles?.includes(path)
          ? `${feature.id} local Catalog boundary: ${path}`
          : path.includes('/contracts/') || path.startsWith('docs/contracts/')
          ? `${feature.id} contract: ${path}`
          : `${feature.id} canonical: ${path}`,
      ),
      ...(feature.highSignalFiles ?? []).map((path) =>
        `${feature.id} high-signal: ${path}`,
      ),
    ]),
    ...carriers,
  ]).slice(0, limit)
}

function startHerePaths(result: QueryResult, limit: number): string[] {
  const feature = result.matchedFeature
  return unique([
    ...(feature?.canonicalFiles ?? []),
    ...(feature?.entrypoints ?? []),
    ...(result.associatedFeatures ?? []).flatMap((associated) => [
      ...(associated.highSignalFiles ?? []),
      ...(associated.catalogIntent ? associated.catalogBoundaryFiles ?? [] : []),
      ...(associated.canonicalFiles ?? []),
      ...(associated.entrypoints ?? []),
    ]),
    ...result.matchedFiles.map((file) => file.path),
    ...result.matchedSymbols.map((symbol) => `${symbol.file}:${symbol.line}`),
    ...result.candidates.flatMap((candidate) => candidate.paths),
    ...result.relevantPaths,
  ]).slice(0, limit).map((path, index) => `${index + 1}. ${path}`)
}

function writePathLines(result: QueryResult, limit: number): string[] {
  const entrypoints = result.matchedFeature?.entrypoints ?? []
  if (entrypoints.length > 0) {
    return entrypoints.slice(0, limit).map((path) =>
      `${path} — semantic entrypoint; verify the canonical writer before editing`,
    )
  }
  const associatedEntrypoints = unique((result.associatedFeatures ?? []).flatMap(
    (feature) => feature.entrypoints ?? [],
  ))
  if (associatedEntrypoints.length > 0) {
    return associatedEntrypoints.slice(0, limit).map((path) =>
      `${path} — associated candidate entrypoint; low-confidence output does not authorize writing`,
    )
  }
  const paths = unique([
    ...result.matchedFiles.map((file) => file.path),
    ...result.matchedSymbols.map((symbol) => symbol.file),
  ])
  return paths.slice(0, limit).map((path) =>
    `${path} — matched fact only; writer remains unknown until Bootstrap verification`,
  )
}

function testLines(result: QueryResult, limit: number): string[] {
  const declared = unique([
    ...(result.matchedFeature?.highSignalTests ?? []),
    ...(result.matchedFeature?.tests ?? []),
    ...(result.associatedFeatures ?? []).flatMap((feature) => [
      ...(feature.highSignalTests ?? []),
      ...(feature.tests ?? []),
    ]),
  ])
  return unique([
    ...declared.map((path) => `declared test: ${path}`),
    ...result.relatedTests.map((test) =>
      test.runnable && test.command
        ? `${test.file}:${test.line} — ${test.name}; run: ${test.command}`
        : `${test.file}:${test.line} — ${test.name}; ${test.diagnostic ?? 'not directly runnable'}`,
    ),
  ]).slice(0, limit)
}

function mustPreserveLines(
  result: QueryResult,
  invariants: readonly InvariantSemantic[],
  limit: number,
): string[] {
  const preserve = invariants
    .filter((invariant) => invariant.statusClass === 'current-must-preserve')
    .map((invariant) => `${invariant.name} — ${invariant.evidence.join(', ')}`)
  if (result.matchedFeature?.statusClass === 'current-must-preserve') {
    preserve.unshift(
      `${result.matchedFeature.name} current behavior — ${result.matchedFeature.targetState ?? 'preserve current contract'}`,
    )
  }
  return unique(preserve).slice(0, limit)
}

function transitionalLines(result: QueryResult, limit: number): string[] {
  const candidates = result.candidates
    .filter((candidate) => candidate.statusClass === 'transitional-allowance')
    .map((candidate) => `${candidate.id} — ${candidate.label}`)
  const modules = result.modules
    .filter((module) => module.statusClass === 'transitional-allowance')
    .map((module) =>
      `${module.id} — ${module.currentFact ?? module.name}; review gate ${module.reviewGate ?? 'unknown'}`,
    )
  return unique([...candidates, ...modules]).slice(0, limit)
}

function doNotReadLines(exclusions: readonly ExclusionSemantic[], limit: number): string[] {
  return exclusions.slice(0, limit).map((exclusion) =>
    `${exclusion.name} — ${exclusion.reason} (${exclusion.evidence.join(', ')})`,
  )
}

function validationLines(result: QueryResult, limit: number): string[] {
  return unique([
    ...result.relatedTests
      .filter((test) => test.runnable && test.command)
      .map((test) => test.command),
    ...(result.matchedFeature?.tests ?? []).map((path) =>
      path.startsWith('tests/e2e/')
        ? `npx playwright test ${path}`
        : `npx vitest run ${path}`,
    ),
    'npm run repo:index:check',
  ]).slice(0, limit)
}

export function buildContextPack(
  result: QueryResult,
  invariants: readonly InvariantSemantic[],
  exclusions: readonly ExclusionSemantic[],
): ContextPackResult {
  const limits = LIMITS[result.request.size]
  const freshness = result.freshness
  const domainLines = Object.entries(freshness.domainMatches)
    .map(([domain, matches]) => `${domain}: ${matches ? 'match' : 'changed'}`)
  const changed = freshness.changedInputs
    .slice(0, limits.paths)
    .map((input) => `${input.change}: ${input.path}${input.domain ? ` (${input.domain})` : ''}`)
  const dirty = freshness.dirtyInputs
    .slice(0, limits.paths)
    .map((input) => `${input.status}: ${input.path}`)
  const relevantDirty = freshness.relevantDirtyInputs
    .slice(0, limits.paths)
    .map((input) => `${input.status}: ${input.path}`)
  const confidenceLines = [
    `mode: ${result.request.mode}`,
    `input: ${safeRequestValue(result.request.value)}`,
    `confidence: ${result.confidence}`,
    `bootstrap-required: ${result.bootstrapRequired ? 'yes' : 'no'}`,
    ...result.candidates.slice(0, limits.candidates).map(candidateLine),
  ]
  const unknowns = unique([
    ...result.unknowns,
    ...freshness.reasons.map((reason) => `freshness: ${reason}`),
    ...(result.confidence === 'low'
      ? ['Do not select a single write path until manual Bootstrap resolves the ambiguity.']
      : []),
  ]).slice(0, limits.unknowns)

  const markdown = [
    '# Task Context',
    '',
    '## Freshness / Dirty Inputs',
    '',
    bullets([
      `status: ${freshness.status}`,
      `safe-for-implementation: ${freshness.safeForImplementation ? 'yes' : 'no'}`,
      ...domainLines,
      ...changed.map((line) => `strict input ${line}`),
      ...dirty.map((line) => `dirty ${line}`),
      ...relevantDirty.map((line) => `query-relevant dirty ${line}`),
    ]),
    '',
    '## Matched Feature and Confidence',
    '',
    bullets(confidenceLines),
    '',
    '## Current Status',
    '',
    bullets(currentStatusLines(result), 'No matched Feature status; use candidate evidence only.'),
    '',
    '## Canonical Contract and Carrier',
    '',
    bullets(canonicalLines(result, limits.paths), 'Unknown; resolve with manual Bootstrap.'),
    '',
    '## Start Here',
    '',
    bullets(startHerePaths(result, limits.paths), 'No authoritative start path selected.'),
    '',
    '## Write Path',
    '',
    bullets(writePathLines(result, limits.paths), 'Unknown; do not write before Bootstrap verification.'),
    '',
    '## Runtime / Preview / Export Consumers',
    '',
    bullets(consumerLines(result, limits.edges), 'No high-signal consumer is established for this query.'),
    '',
    '## Related Tests',
    '',
    bullets(testLines(result, limits.tests), 'No related test was established.'),
    '',
    '## Current Must Preserve',
    '',
    bullets(mustPreserveLines(result, invariants, limits.invariants)),
    '',
    '## Transitional Legacy',
    '',
    bullets(
      transitionalLines(result, limits.candidates),
      'No transitional Legacy record matched; Legacy candidates remain lower-ranked unless explicitly requested.',
    ),
    '',
    '## Do Not Read Unless Needed',
    '',
    bullets(doNotReadLines(exclusions, limits.candidates)),
    '',
    '## Suggested Minimal Validation',
    '',
    bullets(validationLines(result, limits.tests)),
    '',
    '## Unknowns',
    '',
    bullets(unknowns, 'No additional unknown was recorded.'),
    '',
  ].join('\n')
  const bytes = Buffer.byteLength(markdown, 'utf8')
  const lines = markdown.split('\n').length
  if (bytes > limits.maxBytes || lines > limits.maxLines) {
    throw new Error(
      `Context Pack exceeds ${result.request.size} upper budget: ${bytes}/${limits.maxBytes} bytes, ${lines}/${limits.maxLines} lines`,
    )
  }
  return { markdown, bytes, lines, size: result.request.size }
}
