// @vitest-environment node
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { candidateManifest, changedValidationInputs, fixedBehaviorTests, runSelectedTests, selectValidation, verifyExecution,
  changesFromBaseline, discoverValidation, requireSourceBaseline, reusableTests, suiteEvidence,
  requiredConsumerScope,
  type CandidateIdentity, type ExecutionReport } from '../../scripts/check-core-experience-validation'

const identity: CandidateIdentity = { checkout: 'actual-merge-checkout', content: 'uncommitted-combination', policy: 'independent-baseline' }
const plan = selectValidation(['src/core/documents/DocumentSession.ts'])
const passed = (): ExecutionReport => ({ identity: { ...identity }, exitCode: 0,
  boundary: { files: 10, edges: 20, violations: [] },
  vitest: { success: true, testResults: plan.tests.map(name => ({ name: `/candidate/${name}`,
    assertionResults: [{ fullName: 'protected behavior', status: 'passed' }] })) } })
const temporary: string[] = []
afterEach(() => { temporary.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })) })

describe('NI08 trusted obligations and execution evidence', () => {
  it('keeps the small fixed behavior set and separates trusted pure-document N/A', () => {
    expect(plan.tests).toEqual([...fixedBehaviorTests].sort())
    const docs = selectValidation(['docs/development-plan/CURRENT_STATUS.md', 'README.md'])
    expect(docs).toMatchObject({ status: 'not-applicable', tests: [], importBoundaries: false })
    expect(verifyExecution(docs, identity)).toEqual([])
    expect(selectValidation(['src/unknownDynamicRegistry.ts']).status).toBe('selected')
  })

  it('expands IPC, GJS and generated-resource consumers without relying on related import discovery', () => {
    expect(selectValidation(['src/main/ipc.ts']).tests).toContain('tests/unit/g20M16ClipboardIpc.test.ts')
    expect(selectValidation(['src/renderer/composition/owner.ts']).tests).toContain('tests/unit/htmlGrapesProjection.test.ts')
    expect(selectValidation(['src/renderer/documentFiles/html/HtmlStructureEditor.tsx']).tests).toContain('tests/unit/htmlGrapesProjection.test.ts')
    expect(selectValidation(['src/shared/contracts/component-platform.ts']).tests).toEqual(expect.arrayContaining([
      'tests/unit/htmlGrapesProjection.test.ts', 'tests/integration/h1CanonicalContentApply.test.ts',
      'tests/integration/g20ComputeJobRecovery.test.ts',
    ]))
    expect(selectValidation(['scripts/generate-component-builtin-sources.ts']).tests).toContain('tests/unit/componentSourceQ0.test.tsx')
    expect(selectValidation(['src/main/workbench/execution/executionOutcome.ts']).tests).toContain('tests/integration/g20ComputeJobRecovery.test.ts')
  })

  it('accepts completed selected checks and permits reuse only for the same content, checkout and policy', () => {
    expect(verifyExecution(plan, identity, passed())).toEqual([])
    for (const key of ['checkout', 'content', 'policy'] as const) {
      const report = passed()
      report.identity[key] = 'other'
      expect(verifyExecution(plan, identity, report)).toContain(`wrong ${key} identity`)
    }
  })

  it('rejects exit-zero without a report, removed suites and zero matches', () => {
    expect(verifyExecution(plan, identity)).toContain('missing execution report')
    const missing = passed()
    delete missing.vitest
    expect(verifyExecution(plan, identity, missing)).toContain('missing or failed Vitest JSON report')
    const removed = passed()
    removed.vitest!.testResults!.pop()
    expect(verifyExecution(plan, identity, removed).some(error => error.startsWith('zero execution'))).toBe(true)
    const zero = passed()
    zero.vitest!.testResults![0]!.assertionResults = []
    expect(verifyExecution(plan, identity, zero).some(error => error.startsWith('zero execution'))).toBe(true)
  })

  it('rejects skipped/todo/protected failures, a failed process and a bypassed boundary scan', () => {
    for (const status of ['pending', 'skipped', 'todo', 'failed']) {
      const report = passed()
      report.vitest!.testResults![0]!.assertionResults![0]!.status = status
      expect(verifyExecution(plan, identity, report).some(error => error.includes(`(${status})`))).toBe(true)
    }
    const failed = passed()
    failed.exitCode = 1
    expect(verifyExecution(plan, identity, failed)).toContain('selected test process failed or did not finish')
    for (const boundary of [undefined, { files: 0, edges: 0, violations: [] },
      { files: 10, edges: 20, violations: [{ rule: 'core-runtime' }] }]) {
      const report = passed()
      report.boundary = boundary
      expect(verifyExecution(plan, identity, report)).toContain('missing, empty or failed trusted import-boundary report')
    }
  })

  it('binds an uncommitted source, selected test and generated player output to the combination identity', () => {
    const root = mkdtempSync(join(tmpdir(), 'ni08-identity-'))
    temporary.push(root)
    for (const path of ['src', 'tests/unit', 'dist-player']) mkdirSync(join(root, path), { recursive: true })
    writeFileSync(join(root, 'src/owner.ts'), 'export const owner = 1')
    writeFileSync(join(root, 'dist-player/player.iife.js'), 'player-v1')
    writeFileSync(join(root, fixedBehaviorTests[0]), 'protected assertions')
    const first = candidateManifest(root, plan)
    writeFileSync(join(root, 'src/owner.ts'), 'export const owner = 2')
    const second = candidateManifest(root, plan)
    expect(second.digest).not.toBe(first.digest)
    writeFileSync(join(root, 'dist-player/player.iife.js'), 'player-v2')
    expect(candidateManifest(root, plan).digest).not.toBe(second.digest)
    expect(first.entries.find(entry => entry.path === fixedBehaviorTests[1])?.digest).toBe('missing')
  })

  it('does not accept a candidate replacement selector, deleted assertion or widened boundary rule', () => {
    const root = mkdtempSync(join(tmpdir(), 'ni08-review-'))
    temporary.push(root)
    const trusted = join(root, 'trusted'), candidate = join(root, 'candidate')
    for (const directory of [trusted, candidate]) {
      for (const path of ['scripts', 'tests/unit']) mkdirSync(join(directory, path), { recursive: true })
      writeFileSync(join(directory, 'scripts/check-core-experience-validation.ts'), 'trusted selector')
      writeFileSync(join(directory, 'scripts/check-g20-import-boundaries.ts'), 'required source edge')
      writeFileSync(join(directory, fixedBehaviorTests[0]), 'two protected assertions')
    }
    writeFileSync(join(candidate, 'scripts/check-core-experience-validation.ts'), 'exit 0')
    writeFileSync(join(candidate, 'scripts/check-g20-import-boundaries.ts'), 'allow missing source edge')
    rmSync(join(candidate, fixedBehaviorTests[0]))
    expect(changedValidationInputs(trusted, candidate, plan)).toEqual(expect.arrayContaining([
      'scripts/check-core-experience-validation.ts', 'scripts/check-g20-import-boundaries.ts', fixedBehaviorTests[0],
    ]))
    const withSupplement = selectValidation(['tests/unit/newCoverage.test.ts'])
    expect(changedValidationInputs(trusted, candidate, withSupplement, ['tests/unit/newCoverage.test.ts'])).not.toContain('tests/unit/newCoverage.test.ts')
    expect(changedValidationInputs(trusted, candidate, withSupplement)).toContain('tests/unit/newCoverage.test.ts')
  })

  it('reads actual Vitest JSON and rejects a real skipped protected assertion', () => {
    const root = mkdtempSync(join(tmpdir(), 'ni08-vitest-'))
    temporary.push(root)
    const trusted = join(root, 'trusted'), candidate = join(root, 'candidate'), output = join(root, 'report')
    for (const directory of [trusted, candidate, output]) mkdirSync(directory, { recursive: true })
    for (const directory of [trusted, candidate]) symlinkSync(resolve(__dirname, '../../node_modules'), join(directory, 'node_modules'), 'junction')
    writeFileSync(join(trusted, 'vitest.config.ts'), 'export default { test: { environment: "node", setupFiles: [] } }')
    mkdirSync(join(candidate, 'tests/unit'), { recursive: true })
    const actualPlan = { ...plan, tests: ['tests/unit/protected.test.ts'] }
    writeFileSync(join(candidate, actualPlan.tests[0]!), 'import {it,expect} from "vitest"; it("protected",()=>expect(2+2).toBe(4))')
    const boundary = { files: 1, edges: 1, violations: [] }
    const actual = runSelectedTests(trusted, candidate, output, actualPlan, identity, boundary)
    expect(verifyExecution(actualPlan, identity, actual)).toEqual([])
    expect(JSON.parse(readFileSync(join(output, 'vitest.json'), 'utf8')).numPassedTests).toBe(1)
    writeFileSync(join(candidate, actualPlan.tests[0]!), 'import {it} from "vitest"; it.skip("protected",()=>{})')
    const skipped = runSelectedTests(trusted, candidate, output, actualPlan, identity, boundary)
    expect(verifyExecution(actualPlan, identity, skipped).some(error => error.includes('not executed/passed'))).toBe(true)
  }, 30000)
})

describe('NI08 incremental discovery and evidence reuse', () => {
  function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'ni08-incremental-'))
    temporary.push(root)
    const trusted = join(root, 'trusted'), candidate = join(root, 'candidate'), output = join(root, 'report')
    for (const directory of [trusted, candidate, output]) mkdirSync(directory, { recursive: true })
    for (const directory of [trusted, candidate]) symlinkSync(resolve(__dirname, '../../node_modules'), join(directory, 'node_modules'), 'junction')
    writeFileSync(join(trusted, 'vitest.config.ts'), 'export default { test: { environment: "node", setupFiles: [], include: ["tests/unit/**/*.test.ts"] } }')
    return { root, trusted, candidate, output }
  }

  it('unions real Vitest related consumers outside the directory maps with the fixed obligations', async () => {
    const f = fixture()
    const sources = ['src/main/workbench/jobs/HostJobService.ts', 'src/main/workbench/htmlPreview/htmlSourceEdits.ts', 'src/components/table/data.ts']
    for (const [index, source] of sources.entries()) {
      mkdirSync(join(f.candidate, source, '..'), { recursive: true })
      mkdirSync(join(f.candidate, 'tests/unit'), { recursive: true })
      writeFileSync(join(f.candidate, source), 'export const value = 1')
      writeFileSync(join(f.candidate, `tests/unit/consumer${index}.test.ts`), `import {it,expect} from 'vitest'; import {value} from '../../${source.replace(/\.ts$/, '')}'; it('consumer',()=>expect(value).toBe(1))`)
    }
    for (const [index, source] of sources.entries()) {
      const discovered = await discoverValidation(f.trusted, f.candidate, f.output, [source])
      expect(discovered.related).toEqual([`tests/unit/consumer${index}.test.ts`])
      expect(discovered.plan.tests).toEqual(expect.arrayContaining([...fixedBehaviorTests, `tests/unit/consumer${index}.test.ts`]))
      expect(discovered.dependencies[`tests/unit/consumer${index}.test.ts`]).toContain(source)
    }
  }, 30000)

  it('diffs the verified snapshot and reuses only suites whose local source, fixture and config boundaries are unchanged', () => {
    const f = fixture(), baseline = join(f.root, 'baseline')
    const source = 'src/local.ts', other = 'src/unrelated.ts', test = 'tests/unit/courseProjectArchive.test.ts', fixturePath = 'tests/fixtures/course-project-v9/slide-native.json'
    for (const directory of [baseline, f.candidate]) {
      for (const path of ['src', 'tests/unit', 'tests/fixtures/course-project-v9']) mkdirSync(join(directory, path), { recursive: true })
      writeFileSync(join(directory, source), 'previously verified source')
      writeFileSync(join(directory, other), 'previously verified unrelated source')
      writeFileSync(join(directory, test), `const fixtureDir = '../fixtures/course-project-v9'; const mode = process.env.NI08_REUSE_FIXTURE_MODE`)
      writeFileSync(join(directory, fixturePath), '{"value":1}')
    }
    expect(changesFromBaseline(baseline, f.candidate)).toEqual([])
    const localPlan = { ...plan, tests: [test] }, dependencies = { [test]: [source, test] }
    const evidence = suiteEvidence(f.candidate, dependencies)
    const old: ExecutionReport = { ...passed(), evidence,
      vitest: { success: true, testResults: [{ name: `/old/${test}`, assertionResults: [{ status: 'passed', title: 'local' }] }] } }
    writeFileSync(join(f.candidate, other), 'new unrelated source')
    expect(changesFromBaseline(baseline, f.candidate)).toEqual([other])
    expect(candidateManifest(f.candidate, localPlan).digest).not.toBe(candidateManifest(baseline, localPlan).digest)
    expect(reusableTests(localPlan, suiteEvidence(f.candidate, dependencies), old)).toEqual([test])
    writeFileSync(join(f.candidate, fixturePath), '{"value":2}')
    expect(reusableTests(localPlan, suiteEvidence(f.candidate, dependencies), old)).toEqual([])
    writeFileSync(join(f.candidate, fixturePath), '{"value":1}')
    writeFileSync(join(f.candidate, source), 'changed local dependency')
    expect(reusableTests(localPlan, suiteEvidence(f.candidate, dependencies), old)).toEqual([])
    writeFileSync(join(f.candidate, source), 'previously verified source')
    const previousMode = process.env.NI08_REUSE_FIXTURE_MODE
    try {
      process.env.NI08_REUSE_FIXTURE_MODE = `${previousMode ?? 'unset'}-changed`
      expect(reusableTests(localPlan, suiteEvidence(f.candidate, dependencies), old)).toEqual([])
    } finally {
      if (previousMode === undefined) delete process.env.NI08_REUSE_FIXTURE_MODE
      else process.env.NI08_REUSE_FIXTURE_MODE = previousMode
    }
    writeFileSync(join(f.candidate, 'vitest.config.ts'), 'changed config')
    expect(reusableTests(localPlan, suiteEvidence(f.candidate, dependencies), old)).toEqual([])
    expect(reusableTests(localPlan, evidence, { ...old, evidence: undefined })).toEqual([])
  })

  it('binds known joined archive fixture inputs, declines unknown FS reuse and rejects a candidate baseline alias', () => {
    const f = fixture()
    const test = 'tests/unit/courseProjectArchive.test.ts', unknown = 'tests/integration/componentCatalogV8Matrix.test.ts'
    const fixturePath = 'tests/fixtures/course-project-v9/slide-native.json', catalog = 'src/builtInComponentCatalog.ts'
    for (const path of ['tests/unit', 'tests/integration', 'tests/fixtures/course-project-v9', 'src', 'resources/built-in-components'])
      mkdirSync(join(f.candidate, path), { recursive: true })
    writeFileSync(join(f.candidate, test), `import {readFileSync} from 'node:fs'; const fixtureDir = '../fixtures/course-project-v9'; readFileSync(fixtureDir + '/slide-native.json')`)
    writeFileSync(join(f.candidate, fixturePath), '{"native":"valid"}')
    writeFileSync(join(f.candidate, unknown), 'catalog test')
    writeFileSync(join(f.candidate, catalog), `export const directory = 'resources/built-in-components'`)
    const dependencies = { [test]: [test], [unknown]: [unknown, catalog] }
    const before = suiteEvidence(f.candidate, dependencies)
    expect(before[test]!.entries.some(entry => entry.path === fixturePath)).toBe(true)
    expect(before[test]!.reusable).toBe(true)
    expect(before[unknown]!.reusable).toBe(false)
    const old: ExecutionReport = { ...passed(), evidence: before, vitest: { success: true, testResults: [test, unknown]
      .map(name => ({ name, assertionResults: [{ status: 'passed' }] })) } }
    expect(reusableTests({ ...plan, tests: [test, unknown] }, before, old)).toEqual([test])
    writeFileSync(join(f.candidate, fixturePath), '{"native":"changed"}')
    expect(reusableTests({ ...plan, tests: [test, unknown] }, suiteEvidence(f.candidate, dependencies), old)).toEqual([])
    const alias = join(f.root, 'candidate-alias')
    symlinkSync(f.candidate, alias, 'junction')
    expect(() => requireSourceBaseline(alias, f.candidate)).toThrow('not the actual candidate directory')
  })

  it('bounds related candidates to approved/direct consumers and retains unverified opt-in/counterexample obligations', () => {
    const changed = ['src/components/table/data.ts']
    const direct = 'tests/unit/directData.test.ts', transitive = 'tests/unit/sharedCompositionOnly.test.ts'
    const real = 'tests/integration/g20R3LiveNativeJourney.test.ts'
    const scope = requiredConsumerScope(changed, [direct, transitive, real], {
      [direct]: changed, [transitive]: ['src/shared/composition/bootstrap.ts'], [real]: ['src/main/workbench/jobs/HostJobService.ts'],
    })
    expect(scope.plan.tests).toEqual(expect.arrayContaining([...fixedBehaviorTests, 'tests/unit/tableRichEditing.test.tsx', direct]))
    expect(scope.plan.tests).not.toContain(transitive)
    expect(scope.plan.tests).not.toContain(real)
    expect(scope.notSelected.find(item => item.test === real)?.reason).toContain('real-model')
    expect(scope.notSelected.find(item => item.test === transitive)?.reason).toContain('Transitive-only')
    expect(scope.scopeReviewRequired).toEqual([])
    const explicit = requiredConsumerScope([real], [real], {})
    expect(explicit.scopeReviewRequired).toEqual([real])
    const unknown = 'tests/integration/newCounterexample.test.ts'
    expect(requiredConsumerScope([unknown], [unknown], {}).scopeReviewRequired).toEqual([unknown])
    const host = requiredConsumerScope(['src/main/workbench/jobs/HostJobService.ts'], [real], {})
    expect(host.plan.tests).toContain('tests/integration/g20DelegationToolChain.test.ts')
    const condition = requiredConsumerScope(changed, [direct], { [direct]: changed }, { [direct]: 'Trusted baseline requires installed output' })
    expect(condition.notSelected[0]?.reason).toContain('installed output')
  })
})
