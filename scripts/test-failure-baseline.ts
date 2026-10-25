import { spawn, spawnSync, execFileSync } from 'node:child_process'
import { createWriteStream, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

// Diagnostic only: consumes the existing product command, never accepts or updates failures implicitly.
type Observation = { file: string; fullName: string; occurrence: number; status: string; message: string }
type Report = { testResults: { name: string; status: string; message: string; assertionResults: {
  fullName: string; status: string; failureMessages?: string[] | null
}[] }[]; numTotalTests: number; numFailedTests: number; success: boolean }
type Entry = { file: string; fullName: string; occurrence: number; observations: string[]; classification: string; message: string }
type Baseline = { version: number; metadata: Record<string, unknown>; issues: string[]; entries: Entry[]; comparison?: Record<string, Entry[]> }
async function main() {
const args = process.argv.slice(2)
const option = (key: string) => { const i = args.indexOf(key); return i < 0 ? undefined : args[i + 1] }
const record = option('--record'), check = option('--check'), output = record ?? option('--output')
if (Boolean(record) === Boolean(check) || !output) throw new Error('使用 --record <file> 或 --check <baseline> --output <file>')
const workers = Number(option('--workers') ?? 3)
if (!Number.isInteger(workers) || workers < 1) throw new Error('--workers 必须为正整数')
const root = process.cwd(), relative = (name: string) => path.relative(root, path.resolve(name)).replaceAll('\\', '/')
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const product = pkg.scripts['test:product'] as string
if (!product.startsWith('vitest run ')) throw new Error('test:product已改变，需核对诊断范围')
const scope = product.slice('vitest run '.length).trim().split(/\s+/)
const cli = path.resolve('node_modules/vitest/vitest.mjs')
const runDir = path.resolve('output/test-baseline', new Date().toISOString().replaceAll(/[:.]/g, '-'))
mkdirSync(runDir, { recursive: true })
const issues: string[] = []
const git = (...cmd: string[]) => execFileSync('git', cmd, { encoding: 'utf8' }).trim()
const metadata: Record<string, unknown> = {
  head: git('rev-parse', 'HEAD'), dirtyAtStart: git('status', '--short'), node: process.version,
  vitest: JSON.parse(readFileSync('node_modules/vitest/package.json', 'utf8')).version,
  productCommand: product, workers, startedAt: new Date().toISOString(), rawDirectory: relative(runDir),
}
const inventoryPath = path.join(runDir, 'files.json')
const inventory = spawnSync(process.execPath, [cli, 'list', ...scope, '--filesOnly', `--json=${inventoryPath}`], { encoding: 'utf8' })
if (inventory.status !== 0) throw new Error(`测试文件发现失败：${inventory.stderr}`)
const discovered = JSON.parse(readFileSync(inventoryPath, 'utf8')) as (string | { file: string })[]
const expectedFiles = discovered.map(item => relative(typeof item === 'string' ? item : item.file))
if (!expectedFiles.length || new Set(expectedFiles).size !== expectedFiles.length) throw new Error('文件发现为空或有重复，未运行')
metadata.expectedFiles = expectedFiles
async function run(label: string, filters: string[], expected: string[]): Promise<Observation[]> {
  const reportPath = path.join(runDir, `${label}.json`), logPath = path.join(runDir, `${label}.log`)
  const log = createWriteStream(logPath)
  const started = Date.now()
  console.log(`${label}: ${expected.length} files; log ${relative(logPath)}`)
  const code = await new Promise<number | null>((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'run', ...scope, ...filters, `--maxWorkers=${workers}`,
      '--reporter=default', '--reporter=json', `--outputFile.json=${reportPath}`], { stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false })
    child.once('error', reject)
    child.once('close', value => { log.end(() => resolve(value)) })
  })
  if (code !== 0 && code !== 1) issues.push(`${label}: runner exit ${code}`)
  let report: Report
  try { report = JSON.parse(readFileSync(reportPath, 'utf8')) } catch { issues.push(`${label}: JSON报告缺失或损坏`); return [] }
  const logText = readFileSync(logPath, 'utf8')
  if (/Vitest caught \d+ unhandled error|Unhandled Errors|Failed to load config|Global setup failed/i.test(logText)) issues.push(`${label}: 运行器／全局错误，见原始日志`)
  if (/Some tests are still running when generating the JSON report/.test(logText)) issues.push(`${label}: JSON生成时仍有运行中的测试`)
  const files = report.testResults.map(file => relative(file.name))
  for (const file of expected) if (!files.includes(file)) issues.push(`${label}: 未报告文件 ${file}`)
  for (const file of files) if (!expected.includes(file)) issues.push(`${label}: 意外文件 ${file}`)
  if (new Set(files).size !== files.length) issues.push(`${label}: 重复文件报告`)
  const observations: Observation[] = []
  for (const file of report.testResults) {
    const counts = new Map<string, number>()
    for (const test of file.assertionResults) {
      if (test.status === 'pending') issues.push(`${label}: ${relative(file.name)} / ${test.fullName} 报告为pending，未完成`)
      const occurrence = (counts.get(test.fullName) ?? 0) + 1; counts.set(test.fullName, occurrence)
      observations.push({ file: relative(file.name), fullName: test.fullName, occurrence, status: test.status,
        message: (test.failureMessages ?? []).join('\n').slice(0, 1800) })
    }
    // A nested suite hook can fail with an empty file.message and no failed assertion.
    // A file-level pass is also an explicit observation, so a former load failure can be resolved.
    if (file.status === 'passed' || file.status === 'failed' && (file.message || !file.assertionResults.some(test => test.status === 'failed'))) observations.push({
      file: relative(file.name), fullName: '<file>', occurrence: 1, status: file.status,
      message: file.message.slice(0, 1800) || (file.status === 'failed' ? '文件／套件失败，具体错误见同次运行日志' : ''),
    })
  }
  if (report.numTotalTests !== observations.filter(o => o.fullName !== '<file>').length) issues.push(`${label}: 用例总数与报告明细不一致`)
  if (code === 1 && !observations.some(o => o.status === 'failed')) issues.push(`${label}: 非零退出但无失败明细`)
  metadata[label] = { exitCode: code, durationMs: Date.now() - started, tests: report.numTotalTests, failures: report.numFailedTests, files: files.length }
  console.log(`${label}: ${report.numTotalTests} tests, ${report.numFailedTests} failed, ${files.length} files`)
  return observations
}
const first = await run('initial', [], expectedFiles)
const failedFiles = [...new Set(first.filter(o => o.status === 'failed').map(o => o.file))]
const observations = [...first]
// Re-run failed files once each, in their own process. Passing siblings are observed too.
for (const [index, file] of failedFiles.entries()) observations.push(...await run(`retry-${index + 1}`, [file], [file]))
const key = (e: Pick<Entry, 'file' | 'fullName' | 'occurrence'>) => JSON.stringify([e.file, e.fullName, e.occurrence])
const grouped = new Map<string, Observation[]>()
for (const o of observations) { const k = key(o); grouped.set(k, [...grouped.get(k) ?? [], o]) }
const entries: Entry[] = [...grouped.values()].map(group => {
  const statuses = group.map(o => o.status), failed = statuses.filter(s => s === 'failed').length
  const classification = failed >= 2 ? 'stable-failure' : failed ? 'flaky' : statuses.every(s => s === 'passed') ? 'passed' : 'not-passed'
  return { file: group[0].file, fullName: group[0].fullName, occurrence: group[0].occurrence,
    observations: statuses, classification, message: group.find(o => o.message)?.message ?? '' }
})
const duplicates = entries.filter(e => e.occurrence > 1)
if (duplicates.length) issues.push(`${duplicates.length}条同文件同名重复用例，保留记录，比较未决`)
const result: Baseline = { version: 1, metadata, issues, entries }
let newStable = 0
if (check) {
  const old = JSON.parse(readFileSync(check, 'utf8')) as Baseline
  if (old.version !== 1 || old.issues.length) issues.push('起点版本不支持或起点有不完整证据；比较存在未决')
  if (old.metadata.productCommand !== product) issues.push('起终点产品范围不同')
  const oldByKey = new Map(old.entries.map(e => [key(e), e]))
  const currentByKey = new Map(entries.map(e => [key(e), e]))
  const comparison: Record<string, Entry[]> = { newStable: [], fixed: [], becameFlaky: [], masked: [], unresolved: [] }
  for (const e of entries) {
    const previous = oldByKey.get(key(e))
    const masked = !previous?.observations.some(status => status === 'passed' || status === 'failed')
      && old.entries.some(p => p.file === e.file && p.fullName === '<file>' && p.classification !== 'passed')
    const duplicate = e.occurrence > 1 || old.entries.some(p => p.file === e.file && p.fullName === e.fullName && p.occurrence > 1)
    if (duplicate) { comparison.unresolved.push(e); continue }
    if (e.classification === 'stable-failure' && previous?.classification !== 'stable-failure') {
      if (masked && e.fullName !== '<file>') comparison.masked.push(e)
      else comparison.newStable.push(e)
    }
  }
  for (const e of old.entries.filter(e => e.observations.some(status => status === 'passed' || status === 'failed'))) {
    if (e.fullName === '<file>' && e.classification === 'passed') continue
    const now = currentByKey.get(key(e))
    const duplicate = e.occurrence > 1 || old.entries.some(p => p.file === e.file && p.fullName === e.fullName && p.occurrence > 1)
      || entries.some(p => p.file === e.file && p.fullName === e.fullName && p.occurrence > 1)
    if (duplicate) { comparison.unresolved.push(now ?? e); continue }
    const currentFileError = entries.some(p => p.file === e.file && p.fullName === '<file>' && p.classification !== 'passed')
    if (!now || !now.observations.some(status => status === 'passed' || status === 'failed') || currentFileError && e.fullName !== '<file>') comparison.unresolved.push(now ?? e)
    else if (e.classification === 'stable-failure' && now.classification === 'passed') comparison.fixed.push(now)
    else if (e.classification === 'stable-failure' && now.classification === 'flaky') comparison.becameFlaky.push(now)
  }
  if (comparison.masked.length || comparison.unresolved.length) issues.push('存在遮蔽／缺失／未执行或重复对应未决，不能宣称比较闭合')
  result.comparison = comparison; newStable = comparison.newStable.length
  console.log(`new stable ${newStable}; fixed ${comparison.fixed.length}; became flaky ${comparison.becameFlaky.length}; masked ${comparison.masked.length}; unresolved ${comparison.unresolved.length}`)
}
metadata.completedAt = new Date().toISOString(); metadata.reportComplete = !issues.length
metadata.dirtyAtEnd = git('status', '--short')
mkdirSync(path.dirname(path.resolve(output)), { recursive: true })
writeFileSync(output, JSON.stringify(result, null, 2) + '\n')
const counts = entries.reduce<Record<string, number>>((sum, e) => { sum[e.classification] = (sum[e.classification] ?? 0) + 1; return sum }, {})
console.log(JSON.stringify({ output, counts, issues }))
process.exitCode = issues.length ? 2 : newStable ? 1 : 0
}
main().catch(error => { console.error(error); process.exitCode = 2 })
