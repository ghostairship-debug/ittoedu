import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

// This file and the boundary rule are loaded from a baseline selected by the
// independent integrator. Candidate selectors/package scripts are not authority.
export const fixedBehaviorTests = [
  'tests/unit/g20DocumentSession.test.ts',
  'tests/integration/g20MarkdownRepeatedSelection.test.ts',
] as const

const dynamicConsumers: readonly [RegExp, readonly string[]][] = [
  [/^src\/(?:main\/ipc\.ts|preload\/|shared\/.*(?:ipc|bridge))/i,
    ['tests/unit/g20M16ClipboardIpc.test.ts', 'tests/unit/g20CrossRealmBytes.test.ts']],
  [/^src\/(?:core\/(?:tools|course|drivers)\/|renderer\/(?:grapes|documents?|documentFiles|composition|course|store)\/)/,
    ['tests/unit/tableRichEditing.test.tsx', 'tests/unit/htmlGrapesProjection.test.ts']],
  [/^src\/(?:main\/workbench\/(?:execution|compute|images|contentApply|projectFiles)\/|core\/(?:tools|components)\/|shared\/(?:contracts|workbench)\/)/,
    ['tests/integration/g20ExecutionOutcomeR7.test.ts', 'tests/integration/g20ComputeJobRecovery.test.ts',
      'tests/integration/creationWorkspaceImageRecovery.test.ts', 'tests/integration/h1CanonicalContentApply.test.ts']],
  [/^src\/shared\/(?:contracts|workbench)\//,
    ['tests/unit/tableRichEditing.test.tsx', 'tests/unit/htmlGrapesProjection.test.ts']],
  [/^(?:scripts\/|resources\/built-in-components\/|src\/.*componentSource)/i,
    ['tests/unit/nodeExportHostFontWiring.test.ts', 'tests/unit/componentSourceQ0.test.tsx']],
  [/^vendor\/fonts\/.*\/LICENSE$/, ['tests/unit/bundledFonts.test.ts']],
  [/^\.github\/workflows\/check-contracts\.yml$/, ['tests/unit/scopedValidationWorkflow.test.ts']],
]

// Independently approved first-slice behavior roots. Related is a discovery set,
// not an instruction to expand ordinary edits into model/installation matrices.
const niBehaviorRoots: readonly [RegExp, readonly string[]][] = [
  [/^src\/components\/table\//, ['tests/unit/tableRichEditing.test.tsx']],
  [/^src\/main\/workbench\/htmlPreview\//, ['tests/unit/htmlGrapesProjection.test.ts']],
  [/^src\/main\/workbench\/jobs\/HostJobService\.ts$/, [
    'tests/unit/coreExperienceReadyImageResults.test.ts', 'tests/integration/creationWorkspaceImageRecovery.test.ts',
    'tests/integration/g20ImageContinuationResource.test.ts', 'tests/integration/g20DelegationToolChain.test.ts',
  ]],
]
// These exact NI integration counterexamples have an independent domain handoff.
// A changed test stays mandatory; this adds obligations without approving arbitrary
// candidate selectors or making every transitive model/installation route mandatory.
const approvedNiIntegrationCounterexamples = [
  'tests/integration/g20ArtifactSaveTool.test.ts', 'tests/integration/g20ExecutionDesktop.test.ts',
  'tests/integration/g20ExecutionEngine.test.ts', 'tests/integration/g20ExecutionSettings.test.ts',
  'tests/integration/g20SkillTools.test.ts', 'tests/integration/ni01FinalPayload.test.ts',
  'tests/integration/ni01SafeTextEdits.test.ts', 'tests/integration/ni02RecoveredJobArtifacts.test.ts',
  'tests/integration/ni04ModuleSpecifierClosure.test.ts', 'tests/integration/ni07LocalAndReadonlyJobs.test.ts',
  'tests/integration/ni07LocalExecution.test.ts', 'tests/integration/ni07Steering.test.ts',
] as const
const approvedBehaviors = new Set<string>([...fixedBehaviorTests, ...dynamicConsumers.flatMap(([, tests]) => tests),
  ...niBehaviorRoots.flatMap(([, tests]) => tests), ...approvedNiIntegrationCounterexamples])
const specialRoutes: Readonly<Record<string, string>> = {
  'tests/integration/g20R3LiveNativeJourney.test.ts': 'Explicit real-model route: GUOLING_R3_REAL_NATIVE=1 and existing DeepSeek credentials/fees; not authorized by an ordinary source edit',
  'tests/integration/g20CodexDelegationLive.test.ts': 'Explicit real CLI route: GUOLING_REAL_CODEX_DELEGATION=1; separate authorized Luna/CLI execution',
  'tests/integration/g20ComputeBackend.test.ts': 'Installed Podman route: G20_TEST_PODMAN_IMAGE is required; use the domain handoff for this environment-specific obligation',
  'tests/integration/g20ComputeToolChain.test.ts': 'Installed Podman route: G20_TEST_PODMAN_IMAGE is required; controlled ComputeJob behavior is selected separately',
  'tests/integration/g20M30RealComputeJourney.test.ts': 'Pinned local Podman image/Ubuntu route; ordinary edits do not install or execute its real-compute matrix',
}

const policyPaths = [
  '.github/workflows/check-contracts.yml', 'scripts/check-core-experience-validation.ts',
  'scripts/check-g20-import-boundaries.ts', 'vitest.config.ts', 'tests/setup.ts',
  'package.json', 'package-lock.json',
]
const slash = (path: string) => path.replaceAll('\\', '/')
const digest = (text: string | Uint8Array) => createHash('sha256').update(text).digest('hex')
const isTest = (path: string) => /^tests\/(?:unit|integration)\/.*\.test\.[tj]sx?$/.test(path)

export interface ValidationPlan {
  status: 'selected' | 'not-applicable'
  reason: string
  tests: string[]
  importBoundaries: boolean
}

export function selectValidation(changed: readonly string[], requiredConsumers: readonly string[] = []): ValidationPlan {
  const code = changed.some(path => /^(?:src\/|tests\/|scripts\/|resources\/|artifacts\/|vendor\/|\.github\/workflows\/)|^(?:package(?:-lock)?\.json|(?:tsconfig.*\.json)|(?:vite.*\.ts)|playwright\.config\.ts)$/.test(path))
  if (!code) return { status: 'not-applicable', reason: 'No executable, test, generated-resource or validation input changed', tests: [], importBoundaries: false }
  const tests = new Set<string>([...fixedBehaviorTests, ...requiredConsumers])
  for (const path of changed) {
    if (isTest(path) && (path.startsWith('tests/unit/') || approvedBehaviors.has(path))) tests.add(path)
    for (const [pattern, consumers] of dynamicConsumers) if (pattern.test(path)) consumers.forEach(test => tests.add(test))
    for (const [pattern, consumers] of niBehaviorRoots) if (pattern.test(path)) consumers.forEach(test => tests.add(test))
  }
  return { status: 'selected', reason: 'Fixed behavior, approved NI/dynamic roots, direct affected ordinary unit consumers and this scope\'s approved counterexamples', tests: [...tests].sort(), importBoundaries: true }
}

export function requiredConsumerScope(changed: readonly string[], related: readonly string[], directImports: Record<string, string[]>,
  baselineConditions: Record<string, string> = {}) {
  const base = selectValidation(changed)
  const mandatory = new Set(base.tests)
  const notSelected: { test: string; reason: string }[] = []
  const scopeReviewRequired: string[] = []
  for (const test of [...new Set([...related, ...changed.filter(isTest)])]) {
    const condition = specialRoutes[test] ?? baselineConditions[test]
    if (condition) {
      mandatory.delete(test)
      notSelected.push({ test, reason: condition })
      if (changed.includes(test) || base.tests.includes(test)) scopeReviewRequired.push(test)
    } else if (mandatory.has(test)) {
      continue
    } else if (test.startsWith('tests/unit/') && directImports[test]?.some(path => changed.includes(path))) {
      mandatory.add(test)
    } else if (changed.includes(test) && test.startsWith('tests/integration/')) {
      notSelected.push({ test, reason: 'New/changed integration counterexample needs the current domain owner/T scope handoff; no candidate exclude is accepted' })
      scopeReviewRequired.push(test)
    } else {
      notSelected.push({ test, reason: directImports[test]?.some(path => changed.includes(path))
        ? 'Direct integration candidate outside the current approved NI behavior roots; domain-specific execution is outside this slice'
        : 'Transitive-only related candidate outside this slice\'s approved behavior roots/direct ordinary unit consumers; not an additional mandatory model/GUI/installation route' })
    }
  }
  return { plan: { ...base, tests: [...mandatory].sort() }, notSelected, scopeReviewRequired }
}

export interface CandidateIdentity {
  checkout: string
  content: string
  policy: string
}
interface VitestReport {
  success?: boolean
  testResults?: { name: string; assertionResults?: { status: string; fullName?: string; title?: string }[] }[]
}
export interface ExecutionReport {
  identity: CandidateIdentity
  exitCode: number | null
  vitest?: VitestReport
  boundary?: { files: number; edges: number; violations: unknown[] }
  evidence?: Record<string, ReturnType<typeof manifest> & { reusable?: boolean; reason?: string }>
  reused?: { sourceReport: string; tests: string[]; origin: CandidateIdentity }
}

/** The caller supplies the current candidate identity, never the report itself. */
export function verifyExecution(plan: ValidationPlan, identity: CandidateIdentity, report?: ExecutionReport): string[] {
  if (plan.status === 'not-applicable') return []
  if (!report) return ['missing execution report']
  const errors: string[] = []
  for (const key of ['checkout', 'content', 'policy'] as const)
    if (identity[key] !== report.identity[key]) errors.push(`wrong ${key} identity`)
  if (report.exitCode !== 0) errors.push('selected test process failed or did not finish')
  if (!report.vitest || report.vitest.success !== true) errors.push('missing or failed Vitest JSON report')
  for (const test of plan.tests) {
    const suites = report.vitest?.testResults?.filter(suite => slash(suite.name).endsWith(`/${test}`) || slash(suite.name) === test) ?? []
    const assertions = suites.flatMap(suite => suite.assertionResults ?? [])
    if (!assertions.length) errors.push(`zero execution or missing suite: ${test}`)
    for (const assertion of assertions) if (assertion.status !== 'passed')
      errors.push(`not executed/passed: ${test}: ${assertion.fullName ?? assertion.title ?? '<unnamed>'} (${assertion.status})`)
  }
  if (plan.importBoundaries && (!report.boundary || report.boundary.files <= 0 || report.boundary.edges <= 0 || report.boundary.violations.length))
    errors.push('missing, empty or failed trusted import-boundary report')
  return errors
}

function filesUnder(root: string, path: string): string[] {
  const absolute = join(root, path)
  if (!existsSync(absolute)) return []
  if (statSync(absolute).isFile()) return [path]
  return readdirSync(absolute, { withFileTypes: true }).flatMap(entry => {
    const child = slash(join(path, entry.name))
    return entry.isDirectory() ? filesUnder(root, child) : entry.isFile() ? [child] : []
  })
}

function manifest(root: string, paths: readonly string[]) {
  const entries = [...new Set(paths)].sort().map(path => ({ path,
    digest: existsSync(join(root, path)) ? digest(readFileSync(join(root, path))) : 'missing' }))
  // Identity only: this digest cannot establish behavior correctness.
  return { entries, digest: digest(JSON.stringify(entries)) }
}

/** Source baseline is the integrator's already-verified snapshot, not Git HEAD. */
export function changesFromBaseline(baseline: string, candidate: string): string[] {
  const empty: ValidationPlan = { status: 'not-applicable', reason: '', tests: [], importBoundaries: false }
  const before = new Map(candidateManifest(baseline, empty).entries.map(entry => [entry.path, entry.digest]))
  const after = new Map(candidateManifest(candidate, empty).entries.map(entry => [entry.path, entry.digest]))
  return [...new Set([...before.keys(), ...after.keys()])].filter(path => before.get(path) !== after.get(path)).sort()
}

export function requireSourceBaseline(baseline: string, candidate: string): void {
  if (realpathSync(baseline).toLowerCase() === realpathSync(candidate).toLowerCase())
    throw new Error('baseline-root must be the integrator-selected already-verified snapshot, not the actual candidate directory')
}

function trustedConfig(trusted: string, candidate: string, output: string, tests?: readonly string[]): string {
  const config = join(output, tests ? 'vitest.run.config.mts' : 'vitest.discover.config.mts')
  writeFileSync(config, `import base from ${JSON.stringify(slash(join(trusted, 'vitest.config.ts')))};\nexport default {...base, root: ${JSON.stringify(candidate)}, resolve: {...base.resolve, alias: {...base.resolve?.alias, '@': ${JSON.stringify(join(candidate, 'src'))}}}, test: {...base.test${tests ? `, include: ${JSON.stringify(tests)}` : ''}}};\n`)
  return config
}

/** Vitest's existing static related selection; no tests or candidate selectors run. */
export async function discoverValidation(trusted: string, candidate: string, output: string, changed: readonly string[]) {
  const initial = selectValidation(changed)
  if (initial.status === 'not-applicable') return { plan: initial, related: [] as string[], dependencies: {} as Record<string, string[]>,
    directImports: {} as Record<string, string[]>, notSelected: [] as { test: string; reason: string }[], scopeReviewRequired: [] as string[] }
  const { createVitest } = await import(pathToFileURL(join(trusted, 'node_modules/vitest/dist/node.js')).href) as typeof import('vitest/node')
  const ctx = await createVitest('test', { config: trustedConfig(trusted, candidate, output), root: candidate, watch: false,
    related: changed.filter(path => /^(?:src|tests|scripts)\//.test(path)).map(path => resolve(candidate, path)) })
  try {
    const relatedSpecs = await ctx.getRelevantTestSpecifications()
    const related = relatedSpecs.map(spec => slash(relative(candidate, spec.moduleId)))
    const directImports: Record<string, string[]> = {}
    const baselineConditions: Record<string, string> = {}
    for (const spec of relatedSpecs) {
      const test = slash(relative(candidate, spec.moduleId))
      const transformed = spec.project.vite.environments.ssr.moduleGraph.getModuleById(spec.moduleId)?.transformResult
        ?? await spec.project.vite.environments.ssr.transformRequest(spec.moduleId)
      directImports[test] = [...transformed?.deps ?? [], ...transformed?.dynamicDeps ?? []].map(dep =>
        slash(relative(candidate, dep.startsWith('/@fs/') ? dep.slice(process.platform === 'win32' ? 5 : 4) : join(candidate, dep))))
      if (existsSync(join(trusted, test))) {
        const source = readFileSync(join(trusted, test), 'utf8')
        const guard = source.match(/(?:it|test|describe)\.skipIf\([^\n]+/)?.[0]
        if (guard && /process\.env|process\.platform|existsSync/.test(source))
          baselineConditions[test] = `Trusted baseline has an explicit opt-in/environment/installed-output condition: ${guard.slice(0, 180)}; current slice does not claim that route passed`
      }
    }
    const scope = requiredConsumerScope(changed, related, directImports, baselineConditions)
    const plan = scope.plan
    const specs = await ctx.globTestSpecifications(plan.tests)
    const dependencies: Record<string, string[]> = {}
    for (const spec of specs) {
      const visited = new Set<string>()
      const visit = async (path: string): Promise<void> => {
        if (visited.has(path)) return
        visited.add(path)
        const transformed = spec.project.vite.environments.ssr.moduleGraph.getModuleById(path)?.transformResult
          ?? await spec.project.vite.environments.ssr.transformRequest(path)
        for (const dep of [...transformed?.deps ?? [], ...transformed?.dynamicDeps ?? []]) {
          const absolute = dep.startsWith('/@fs/') ? dep.slice(process.platform === 'win32' ? 5 : 4) : join(candidate, dep)
          if (!absolute.includes('node_modules') && existsSync(absolute)) await visit(absolute)
        }
      }
      await visit(spec.moduleId)
      dependencies[slash(relative(candidate, spec.moduleId))] = [...visited].map(path => slash(relative(candidate, path))).sort()
    }
    return { ...scope, related: [...new Set(related)].sort(), dependencies, directImports }
  } finally { await ctx.close() }
}

/** Bind each suite to its dependency/fixture/config boundary, not the whole candidate. */
const completeReplayInputs: Readonly<Record<string, readonly string[]>> = {
  'tests/unit/g20DocumentSession.test.ts': ['tests/fixtures/course-project-v9'],
  'tests/integration/g20MarkdownRepeatedSelection.test.ts': [], // In-memory fixture, no external file input.
  'tests/unit/courseProjectArchive.test.ts': ['tests/fixtures/course-project-v9'],
  'tests/unit/scopedValidationWorkflow.test.ts': ['.github/workflows/check-contracts.yml'],
}

export function suiteEvidence(candidate: string, dependencies: Record<string, string[]>) {
  return Object.fromEntries(Object.entries(dependencies).map(([test, inputs]) => {
    const paths = new Set([...inputs, ...policyPaths,
      ...readdirSync(candidate).filter(path => /^(?:tsconfig.*\.json|vite.*\.ts)$/.test(path))])
    const environment = new Set<string>()
    for (const input of inputs) {
      const text = readFileSync(join(candidate, input), 'utf8')
      for (const match of text.matchAll(/process\.env(?:\.([A-Za-z_][A-Za-z0-9_]*)|\[['"]([^'"]+)['"]\])/g)) environment.add(match[1] ?? match[2]!)
    }
    const complete = Object.hasOwn(completeReplayInputs, test)
    for (const path of completeReplayInputs[test] ?? []) {
      if (!existsSync(join(candidate, path))) paths.add(path)
      else filesUnder(candidate, path).forEach(file => paths.add(file))
    }
    const result = manifest(candidate, [...paths])
    const entries = [...result.entries,
      { path: 'runtime:node-platform', digest: digest(`${process.version}/${process.platform}/${process.arch}`) },
      ...[...environment].sort().map(name => ({ path: `env:${name}`, digest: digest(process.env[name] ?? '<unset>') }))]
    return [test, { entries, digest: digest(JSON.stringify(entries)), reusable: complete,
      reason: complete ? 'Explicit reviewed input boundary plus static dependencies/config/runtime' : 'Reuse unavailable: dynamic filesystem/input boundary has not been confirmed complete; execute normally' }]
  }))
}

export function reusableTests(plan: ValidationPlan, evidence: NonNullable<ExecutionReport['evidence']>, report?: ExecutionReport): string[] {
  if (!report?.evidence) return []
  return plan.tests.filter(test => evidence[test]?.reusable === true && report.evidence![test]?.reusable === true
    && report.evidence![test]?.digest === evidence[test]!.digest
    && verifyExecution({ ...plan, tests: [test], importBoundaries: false }, report.identity, report).length === 0)
}

export function candidateManifest(root: string, plan: ValidationPlan) {
  return manifest(root, [...filesUnder(root, 'src'), ...filesUnder(root, 'resources'),
    ...filesUnder(root, 'artifacts'), ...filesUnder(root, 'scripts'), ...filesUnder(root, 'vendor'),
    ...filesUnder(root, 'tests'), ...filesUnder(root, 'dist-player'), ...plan.tests, ...policyPaths,
    ...readdirSync(root).filter(path => /^(?:tsconfig.*\.json|vite.*\.ts)$/.test(path))])
}

export function changedValidationInputs(trusted: string, candidate: string, plan: ValidationPlan, supplementalTests: readonly string[] = []): string[] {
  return [...policyPaths, ...plan.tests].filter(path => {
    // New supplemental tests do not erase baseline obligations. Existing selected
    // assertions and rule inputs require independent confirmation if changed.
    if (!existsSync(join(trusted, path))) return !supplementalTests.includes(path) || fixedBehaviorTests.some(test => test === path)
    return !existsSync(join(candidate, path))
      || digest(readFileSync(join(trusted, path))) !== digest(readFileSync(join(candidate, path)))
  })
}

function git(root: string, args: string[]): string {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr || `git ${args[0]} failed`)
  return args.includes('-z') ? result.stdout : result.stdout.trim()
}

export function runSelectedTests(trusted: string, candidate: string, output: string,
  plan: ValidationPlan, identity: CandidateIdentity, boundary: ExecutionReport['boundary']): ExecutionReport {
  const vitestPath = join(output, 'vitest.json')
  rmSync(vitestPath, { force: true })
  // Use the trusted config, but bind its root and @ alias to the tested candidate.
  const config = trustedConfig(trusted, candidate, output, plan.tests)
  const run = spawnSync(process.execPath, [join(trusted, 'node_modules/vitest/vitest.mjs'), 'run', ...plan.tests,
    '--config', config, '--reporter=json', `--outputFile=${vitestPath}`], { cwd: candidate, stdio: 'inherit' })
  return { identity, exitCode: run.status, boundary,
    ...(existsSync(vitestPath) ? { vitest: JSON.parse(readFileSync(vitestPath, 'utf8')) } : {}) }
}

async function main() {
  const args = process.argv.slice(2)
  const option = (name: string) => args[args.indexOf(name) + 1]
  for (const name of ['--trusted-root', '--candidate-root', '--base-sha', '--candidate-sha', '--output'])
    if (!args.includes(name) || !option(name)) throw new Error(`required: ${name}`)
  const trusted = resolve(option('--trusted-root')!)
  const candidate = resolve(option('--candidate-root')!)
  const output = resolve(option('--output')!)
  const baseline = args.includes('--baseline-root') ? resolve(option('--baseline-root')!) : undefined
  if (!baseline && process.env.GITHUB_ACTIONS !== 'true')
    throw new Error('local validation requires --baseline-root selected from the already-verified source snapshot')
  if (baseline) requireSourceBaseline(baseline, candidate)
  if (slash(trusted).toLowerCase() === slash(candidate).toLowerCase())
    throw new Error('trusted policy must be a separate independently selected baseline copy')
  if (slash(resolve(__filename)) !== slash(join(trusted, 'scripts/check-core-experience-validation.ts')))
    throw new Error('execute the checker from the independently selected trusted root')
  const checkout = git(candidate, ['rev-parse', 'HEAD'])
  if (checkout !== option('--candidate-sha')) throw new Error('candidate checkout differs from expected integration checkout')
  // Compare base to actual checkout (PR merge candidate when Actions checks it out),
  // and include local tracked/untracked edits. SHA alone is not a worktree identity.
  const changed = new Set(baseline ? changesFromBaseline(baseline, candidate)
    : git(candidate, ['diff', '--name-only', '-z', option('--base-sha')!, 'HEAD']).split('\0').filter(Boolean))
  if (!baseline) {
    git(candidate, ['diff', '--name-only', '-z', 'HEAD']).split('\0').filter(Boolean).forEach(path => changed.add(path))
    git(candidate, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean).forEach(path => changed.add(path))
  }
  mkdirSync(output, { recursive: true })
  const discovery = await discoverValidation(trusted, candidate, output, [...changed].map(slash))
  const plan = discovery.plan
  const policy = manifest(trusted, [...policyPaths, ...plan.tests])
  const content = candidateManifest(candidate, plan)
  const identity: CandidateIdentity = { checkout, content: content.digest, policy: policy.digest }
  const baselineTests = new Set(baseline ? filesUnder(baseline, 'tests')
    : git(candidate, ['ls-tree', '-r', '--name-only', '-z', option('--base-sha')!, '--', 'tests']).split('\0'))
  const supplementalTests = plan.tests.filter(test => !baselineTests.has(test))
  const reviewRequired = changedValidationInputs(trusted, candidate, plan, supplementalTests)
  const summary = { identity, base: option('--base-sha'), baselineRoot: baseline,
    baselineIdentity: baseline ? candidateManifest(baseline, { ...plan, tests: [] }).digest : option('--base-sha'),
    trustedRoot: trusted, candidateRoot: candidate,
    changed: [...changed].sort(), plan, reviewRequired, inputs: content.entries, policyInputs: policy.entries,
    relatedTests: discovery.related, directImports: discovery.directImports, dependencies: discovery.dependencies, reusedTests: [] as string[],
    reuseUnavailable: [] as { test: string; reason: string }[],
    notSelected: discovery.notSelected, scopeReviewRequired: discovery.scopeReviewRequired,
    status: plan.status === 'not-applicable' ? 'not-applicable' : 'unverified', errors: [] as string[] }
  const summaryPath = join(output, 'validation.json')
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2))
  if (plan.status === 'not-applicable') { process.stdout.write('NI08: not-applicable (trusted scope)\n'); return }
  // A changed rule/assertion is a review decision. It is never accepted because
  // the candidate's own replacement returns exit 0. Install the approved version
  // in the trusted source, then rerun this same checker; no candidate approval flag.
  if (reviewRequired.length) {
    summary.errors.push(`independent approval of validation inputs required: ${reviewRequired.join(', ')}`)
  } else {
    const evidence = suiteEvidence(candidate, discovery.dependencies)
    summary.reuseUnavailable = Object.entries(evidence).filter(([, input]) => !input.reusable)
      .map(([test, input]) => ({ test, reason: input.reason }))
    const previousPath = args.includes('--reuse-report') ? resolve(option('--reuse-report')!) : undefined
    const previous: ExecutionReport | undefined = previousPath ? JSON.parse(readFileSync(previousPath, 'utf8')) : undefined
    const reused = reusableTests(plan, evidence, previous)
    const boundaryModule = await import(pathToFileURL(join(trusted, 'scripts/check-g20-import-boundaries.ts')).href)
    const boundary = boundaryModule.scanImportBoundaries(candidate) as ExecutionReport['boundary']
    const pending = plan.tests.filter(test => !reused.includes(test))
    const execution: ExecutionReport = pending.length
      ? runSelectedTests(trusted, candidate, output, { ...plan, tests: pending }, identity, boundary)
      : { identity, boundary, exitCode: 0, vitest: { success: true, testResults: [] } }
    execution.evidence = evidence
    if (previous && reused.length && execution.vitest?.testResults) {
      execution.vitest!.testResults!.push(...previous.vitest!.testResults!.filter(suite =>
        reused.some(test => slash(suite.name).endsWith(`/${test}`) || slash(suite.name) === test)))
      execution.reused = { sourceReport: previousPath!, tests: reused, origin: previous.identity }
      summary.reusedTests = reused
    }
    writeFileSync(join(output, 'execution.json'), JSON.stringify(execution, null, 2))
    summary.errors.push(...verifyExecution(plan, identity, execution))
    if (discovery.scopeReviewRequired.length) summary.errors.push(`Current scope has unverified behavior/counterexample obligations requiring the existing domain owner/T handoff: ${discovery.scopeReviewRequired.join(', ')}`)
    if (candidateManifest(candidate, plan).digest !== identity.content) summary.errors.push('candidate inputs changed during validation')
    if (manifest(trusted, [...policyPaths, ...plan.tests]).digest !== identity.policy) summary.errors.push('trusted policy inputs changed during validation')
    summary.status = discovery.scopeReviewRequired.length ? 'unverified' : summary.errors.length ? 'failed' : 'passed'
  }
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2))
  process.stdout.write(`NI08: ${summary.status}; checkout=${checkout}; content=${identity.content}; report=${summaryPath}\n`)
  summary.errors.forEach(error => process.stderr.write(`${error}\n`))
  if (summary.status !== 'passed') process.exitCode = 1
}

if (process.argv[1] && slash(resolve(process.argv[1])) === slash(resolve(__filename))) {
  main().catch(error => { process.stderr.write(`NI08 unverified: ${String(error)}\n`); process.exitCode = 1 })
}
