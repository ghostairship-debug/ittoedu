import { extractFile, listPackage, statFile } from '@electron/asar'
import { chromium, type Browser, type Page } from '@playwright/test'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { attachmentSnapshotSchema } from '../src/shared/workbench/attachments'
import { BACKGROUND_E2E_ENV } from '../src/main/windowVisibility'
import { prepareElectronLaunchEnvironment } from './electronLaunchEnvironment'
import { collectFileArtifactEvidence, readAsarPackageMetadata, type FileArtifactEvidence } from './releaseArtifactEvidence'
import { assertEquivalentDirectoryEvidence, collectDirectoryEvidence } from './windowsPortabilityEvidence'

export interface PortableSharpArguments { portable: string; unpacked: string; output: string }
const roundsPerArtifact = 5
const execFileAsync = promisify(execFile)
const pause = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds))
const failureOf = (error: unknown): string => error instanceof Error ? error.stack ?? error.message : String(error)
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message) }
async function bounded<T>(action: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try { return await Promise.race([action, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds) })]) }
  finally { clearTimeout(timer) }
}

/** Generated once from a 3×2 opaque PNG; each packaged Main must decode these same original bytes. */
const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNQSlv1H4YZkDkAoncNJ3w5p9sAAAAASUVORK5CYII='
export const sharpSmokePng = Object.freeze({ base64: pngBase64, width: 3, height: 2,
  byteLength: Buffer.from(pngBase64, 'base64').byteLength,
  digest: createHash('sha256').update(Buffer.from(pngBase64, 'base64')).digest('hex') })

export function parsePortableSharpArguments(args: readonly string[], cwd = process.cwd()): PortableSharpArguments {
  const values = new Map<string, string>()
  let selected = false
  for (let index = 0; index < args.length; index++) {
    const flag = args[index]
    if (flag === '--portable-sharp') {
      if (selected) throw new Error('重复参数 --portable-sharp')
      selected = true; continue
    }
    if (!['--portable', '--unpacked', '--output'].includes(flag)) throw new Error(`未知专项参数：${flag}`)
    if (values.has(flag)) throw new Error(`重复参数 ${flag}`)
    const value = args[++index]
    if (!value || value.startsWith('--')) throw new Error(`${flag} 缺少路径`)
    values.set(flag, path.resolve(cwd, value))
  }
  if (!selected || values.size !== 3) throw new Error('用法：--portable-sharp --portable <EXE> --unpacked <EXE> --output <新的报告目录>')
  const portable = values.get('--portable')!, unpacked = values.get('--unpacked')!, output = values.get('--output')!
  if (portable === unpacked) throw new Error('Portable 与目录版必须指定不同的 EXE')
  if (![portable, unpacked].every(filename => path.extname(filename).toLowerCase() === '.exe')) throw new Error('两种制品都必须指定 EXE 文件')
  return { portable, unpacked, output }
}

/** Existing directories, including empty directories, are never reused or cleared. */
export async function createPortableSharpReportDirectory(output: string): Promise<void> {
  await fs.mkdir(path.dirname(output), { recursive: true })
  await fs.mkdir(output)
}

export function assertSharpPngSnapshot(value: unknown) {
  const snapshot = attachmentSnapshotSchema.parse(value)
  const image = snapshot.representations.find(representation => representation.kind === 'image')
  assert(image?.kind === 'image', 'Main 没有返回已解码图片')
  assert(snapshot.mediaType === 'image/png' && image.mediaType === 'image/png', 'Main 返回的图片类型不是 PNG')
  assert(image.width === sharpSmokePng.width && image.height === sharpSmokePng.height, 'Main 解码尺寸与 PNG 不一致')
  assert(snapshot.digest === sharpSmokePng.digest && image.blobRef.digest === sharpSmokePng.digest
    && snapshot.blobRef.digest === sharpSmokePng.digest && snapshot.blobRef.byteLength === sharpSmokePng.byteLength
    && snapshot.byteLength === sharpSmokePng.byteLength && image.blobRef.byteLength === sharpSmokePng.byteLength
    && image.provenance.originalDigest === sharpSmokePng.digest && image.provenance.originalByteLength === sharpSmokePng.byteLength,
  'Main 解码的原件摘要或字节数不一致')
  assert(image.provenance.producer === 'sharp-verified-v1' && image.provenance.complete && !image.provenance.downsampled,
    'Main 没有确认完整 sharp 解码')
  return { width: image.width, height: image.height, digest: snapshot.digest, byteLength: snapshot.byteLength,
    producer: image.provenance.producer }
}

export async function collectSharpPayload(resources: string) {
  const asarPath = path.join(resources, 'app.asar')
  const entries = new Set(listPackage(asarPath, { isPack: false }).map(entry => entry.replaceAll('\\', '/').replace(/^\/+/, '')))
  const packageAt = (entry: string) => JSON.parse(extractFile(asarPath, entry.split('/').join(path.sep)).toString('utf8')) as Record<string, unknown>
  const sharpRoot = 'node_modules/sharp', platformRoot = 'node_modules/@img/sharp-win32-x64'
  const sharpPackage = packageAt(`${sharpRoot}/package.json`), platformPackage = packageAt(`${platformRoot}/package.json`)
  assert(typeof sharpPackage.version === 'string' && sharpPackage.version === platformPackage.version, 'sharp 与 Win64 平台包版本不一致')
  const exports = platformPackage.exports as Record<string, unknown> | undefined
  const platformEntry = exports?.['./sharp.node']
  assert(typeof sharpPackage.main === 'string' && typeof platformEntry === 'string', 'sharp JS 或平台导出入口缺失')
  const jsEntries = [path.posix.join(sharpRoot, sharpPackage.main), `${sharpRoot}/dist/sharp.cjs`, path.posix.join(platformRoot, platformEntry)]
  for (const entry of jsEntries) assert(entry.startsWith('node_modules/') && entries.has(entry), `sharp JS 导出文件不存在：${entry}`)
  const nativeRoot = `${platformRoot}/lib/`
  const nativeEntries = [...entries].filter(entry => entry.startsWith(nativeRoot) && /\.(node|dll)$/.test(entry))
  assert(nativeEntries.filter(entry => entry.endsWith('.node')).length === 1
    && nativeEntries.filter(entry => entry.endsWith('.dll')).length === 2, 'sharp Win64 必须包含一个 .node 与两个相邻 DLL')
  for (const entry of nativeEntries) {
    const metadata = statFile(asarPath, entry.split('/').join(path.sep))
    assert('unpacked' in metadata && metadata.unpacked, `sharp 原生文件没有 ASAR unpacked 标记：${entry}`)
  }
  const nativeDirectory = path.join(`${asarPath}.unpacked`, ...nativeRoot.split('/'))
  const nativeFiles = await collectDirectoryEvidence(nativeDirectory)
  for (const entry of nativeEntries) assert(nativeFiles.some(file => file.path === entry.slice(nativeRoot.length)), `sharp 原生文件没有实体：${entry}`)
  return { resources, asar: await collectFileArtifactEvidence(asarPath), package: readAsarPackageMetadata(asarPath),
    sharpVersion: sharpPackage.version, jsEntries, nativeFiles }
}

function assertSamePayload(expected: Awaited<ReturnType<typeof collectSharpPayload>>, actual: Awaited<ReturnType<typeof collectSharpPayload>>) {
  assert(actual.asar.sha256 === expected.asar.sha256 && actual.asar.sizeBytes === expected.asar.sizeBytes,
    '运行中的 Portable ASAR 与指定目录版不是同一负载')
  assertEquivalentDirectoryEvidence(expected.nativeFiles, actual.nativeFiles)
}

interface OwnedProcess { pid: number; parentPid: number; executable: string; created: string }
async function windowsProcesses(rootPid: number, exactPids: readonly number[] = []): Promise<OwnedProcess[]> {
  // Read the process table, return only this launcher's descendants or captured identities.
  // Paths/arguments never enter PowerShell code; PIDs are validated integers.
  assert([rootPid, ...exactPids].every(pid => Number.isSafeInteger(pid) && pid > 0), '进程编号无效')
  const script = `$ErrorActionPreference='Stop'\n$all=@(Get-CimInstance Win32_Process)\n$owned=[System.Collections.Generic.HashSet[int]]::new()\n[void]$owned.Add(${rootPid})\ndo { $added=$false; foreach($item in $all) { if($owned.Contains([int]$item.ParentProcessId)) { if($owned.Add([int]$item.ProcessId)) { $added=$true } } } } while($added)\n$exact=@(${exactPids.join(',')})\n@($all | Where-Object { $owned.Contains([int]$_.ProcessId) -or $exact -contains [int]$_.ProcessId } | ForEach-Object { [pscustomobject]@{ pid=[int]$_.ProcessId; parentPid=[int]$_.ParentProcessId; executable=[string]$_.ExecutablePath; created=([datetime]$_.CreationDate).ToUniversalTime().ToString('o') } }) | ConvertTo-Json -Compress`
  const { stdout } = await execFileAsync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
    { windowsHide: true, timeout: 10_000 })
  const parsed: unknown = stdout.trim() ? JSON.parse(stdout.trim()) : []
  const values = Array.isArray(parsed) ? parsed : [parsed]
  return values as OwnedProcess[]
}

async function port(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer(); server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') { server.close(); reject(new Error('不能分配 CDP 端口')); return }
      server.close(error => error ? reject(error) : resolve(address.port))
    })
  })
}

async function connect(portNumber: number, child: ChildProcess, stderr: () => string): Promise<Browser> {
  const deadline = Date.now() + 60_000
  let lastError: unknown
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`制品在 CDP 连接前退出：${stderr()}`)
    try { return await chromium.connectOverCDP(`http://127.0.0.1:${portNumber}`, { timeout: 1000 }) }
    catch (error) { lastError = error; await pause(250) }
  }
  throw new Error(`CDP 连接超时：${failureOf(lastError)}\n${stderr()}`)
}

async function desktopPage(browser: Browser): Promise<Page> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    for (const context of browser.contexts()) for (const page of context.pages()) {
      if (page.url() === 'courseware-editor://app/index.html'
        && await page.evaluate(() => Boolean((window as unknown as { desktopAPI?: { attachments?: unknown } }).desktopAPI?.attachments)).catch(() => false)) return page
    }
    await pause(100)
  }
  throw new Error('制品没有建立带附件 API 的正式主窗口')
}

interface RoundEvidence {
  kind: 'portable' | 'unpacked'; round: number; startedAt: string; profile: string; cwd: string;
  launcherPid?: number; main?: OwnedProcess; payload?: Awaited<ReturnType<typeof collectSharpPayload>>;
  decode?: ReturnType<typeof assertSharpPngSnapshot>; failure?: string; shutdown?: { complete: boolean; forced: boolean; failure?: string };
  exitCode?: number | null; signal?: string | null; stderr: string; finishedAt?: string
}

async function runRound(kind: RoundEvidence['kind'], round: number, executable: string, output: string,
  baseline: Awaited<ReturnType<typeof collectSharpPayload>>): Promise<RoundEvidence> {
  const directory = await fs.mkdtemp(path.join(output, `${kind}-${round}-`))
  const evidence: RoundEvidence = { kind, round, startedAt: new Date().toISOString(), profile: path.join(directory, 'profile'),
    cwd: path.join(directory, 'cwd'), stderr: '' }
  await fs.mkdir(evidence.cwd); await fs.mkdir(evidence.profile)
  const environment = { ...process.env, VITE_DEV_SERVER_URL: '', ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', [BACKGROUND_E2E_ENV]: '1' }
  prepareElectronLaunchEnvironment(environment)
  const child = spawn(executable, [`--remote-debugging-port=${await port()}`, `--user-data-dir=${evidence.profile}`],
    { cwd: evidence.cwd, env: environment, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
  evidence.launcherPid = child.pid
  let spawnError: Error | undefined
  child.on('error', error => { spawnError = error })
  child.stderr?.on('data', (bytes: Buffer) => { evidence.stderr += bytes.toString('utf8') })
  let browser: Browser | undefined, page: Page | undefined
  let owned: OwnedProcess[] = []
  try {
    assert(child.pid, '制品没有创建 launcher 进程')
    owned = await windowsProcesses(child.pid)
    assert(owned.some(process => process.pid === child.pid), '没有捕获本轮 launcher 身份，不能签收冷启动')
    const portArgument = child.spawnargs.find(argument => argument.startsWith('--remote-debugging-port='))!
    browser = await connect(Number(portArgument.split('=')[1]), child, () => evidence.stderr)
    const cdp = await browser.newBrowserCDPSession()
    const processes = await cdp.send('SystemInfo.getProcessInfo')
    const mainPid = processes.processInfo.find(process => process.type === 'browser')?.id
    assert(mainPid && Number.isSafeInteger(mainPid), 'CDP 没有返回 Main PID')
    const current = await windowsProcesses(child.pid)
    const launcher = owned.find(process => process.pid === child.pid)!
    assert(current.some(process => process.pid === launcher.pid && process.created === launcher.created), 'launcher 已退出或身份改变，不能绑定 CDP Main')
    for (const process of current) if (!owned.some(value => value.pid === process.pid)) owned.push(process)
    evidence.main = current.find(process => process.pid === mainPid)
    assert(evidence.main?.executable, 'CDP Main 不属于本轮 launcher；可能连接到了既有实例，不计冷启动')
    if (kind === 'unpacked') assert(path.resolve(evidence.main.executable).toLowerCase() === path.resolve(executable).toLowerCase(), '目录版实际 Main EXE 路径不一致')
    evidence.payload = await collectSharpPayload(path.join(path.dirname(evidence.main.executable), 'resources'))
    assertSamePayload(baseline, evidence.payload)
    page = await desktopPage(browser)
    const snapshot = await bounded(page.evaluate(async base64 => {
      const api = (window as unknown as { desktopAPI: { attachments: { receive(input: unknown): Promise<unknown> } } }).desktopAPI
      return api.attachments.receive({ name: 'portable-sharp-smoke.png', bytes: Uint8Array.from(atob(base64), value => value.charCodeAt(0)),
        source: 'paste', mediaType: 'image/png' })
    }, sharpSmokePng.base64), 30_000, 'Main PNG 解码在 30 秒内未完成')
    evidence.decode = assertSharpPngSnapshot(snapshot)
  } catch (error) { evidence.failure = failureOf(spawnError ?? error) }
  finally {
    try {
      if (child.pid) {
        const descendants = await windowsProcesses(child.pid)
        const launcher = owned.find(process => process.pid === child.pid)
        const sameLauncher = launcher && descendants.some(process => process.pid === launcher.pid && process.created === launcher.created)
        if (sameLauncher) for (const process of descendants) if (!owned.some(value => value.pid === process.pid)) owned.push(process)
        if (page) {
          // Change only this fresh test profile's normal close preference; no test IPC or native dialog override.
          await bounded(page.evaluate(async () => {
            const api = (window as unknown as { desktopAPI: { externalMcp?: { configure(patch: unknown): Promise<unknown> } } }).desktopAPI
            await api.externalMcp?.configure({ closeAction: 'quit' })
          }), 5000, '测试 profile 关闭设置未完成').catch(() => undefined)
          await page.close({ runBeforeUnload: true }).catch(() => undefined)
        }
        const remaining = async () => {
          const current = await windowsProcesses(child.pid!, owned.map(process => process.pid))
          return current.filter(process => owned.some(value => value.pid === process.pid && value.created === process.created))
        }
        let alive = await remaining(), forced = false
        const deadline = Date.now() + 10_000
        while (alive.length && Date.now() < deadline) { await pause(250); alive = await remaining() }
        if (alive.length) {
          forced = true
          // Only captured process generations can be terminated. No name-based/global taskkill.
          for (const process of alive) {
            const current = (await windowsProcesses(process.pid, [process.pid])).find(value => value.pid === process.pid)
            if (current?.created === process.created) await execFileAsync('taskkill', ['/PID', String(process.pid), '/T', '/F'], { windowsHide: true }).catch(() => undefined)
          }
          const cleanupDeadline = Date.now() + 5000
          do { await pause(250); alive = await remaining() }
          while ((alive.length || child.exitCode === null && child.signalCode === null) && Date.now() < cleanupDeadline)
        }
        const launcherExited = child.exitCode !== null || child.signalCode !== null
        const unidentifiedDescendants = !sameLauncher && descendants.some(process => process.pid !== child.pid
          && !owned.some(value => value.pid === process.pid && value.created === process.created))
        evidence.shutdown = { complete: Boolean(launcher) && !unidentifiedDescendants && alive.length === 0 && launcherExited, forced,
          ...(forced ? { failure: '正常关闭未结束本轮进程；已仅清理本轮捕获的进程树' } : {}),
          ...(alive.length || !launcherExited || !launcher || unidentifiedDescendants ? { failure: '尚未确认 Main 与 launcher 完全退出，停止后续轮次' } : {}) }
      } else evidence.shutdown = { complete: Boolean(spawnError), forced: false }
    } catch (error) { evidence.shutdown = { complete: false, forced: false, failure: failureOf(error) } }
    await browser?.close().catch(() => undefined)
    evidence.exitCode = child.exitCode; evidence.signal = child.signalCode; evidence.finishedAt = new Date().toISOString()
    if (!evidence.failure && (evidence.exitCode !== 0 || evidence.signal))
      evidence.failure = `本轮没有正常退出：exitCode=${String(evidence.exitCode)}，signal=${evidence.signal ?? 'none'}`
  }
  return evidence
}

/** Focused opt-in check: no builds, exports, existing-profile cleanup or historical report writes. */
export async function verifyPortableSharp(args: readonly string[]): Promise<void> {
  const input = parsePortableSharpArguments(args)
  await createPortableSharpReportDirectory(input.output)
  const report: { startedAt: string; finishedAt?: string; host: unknown; input: PortableSharpArguments; png: typeof sharpSmokePng;
    artifacts?: { portable: FileArtifactEvidence; unpacked: FileArtifactEvidence }; baseline?: Awaited<ReturnType<typeof collectSharpPayload>>;
    rounds: RoundEvidence[]; expectedRounds: number; status: 'failed' | 'passed'; failure?: string; boundary: string } = {
    startedAt: new Date().toISOString(), host: { platform: process.platform, arch: process.arch, node: process.version, os: os.version() },
    input, png: sharpSmokePng, rounds: [], expectedRounds: roundsPerArtifact * 2, status: 'failed',
    boundary: 'Only these specified artifacts on this Windows host are checked. This does not establish results on the fault computer or the cause of intermittent native loading failures. Test profiles and evidence are retained; historical reports and system Temp are not cleared.',
  }
  try {
    assert(process.platform === 'win32' && process.arch === 'x64', 'Portable sharp 实物验证需要 Windows x64；当前未执行启动或解码')
    const [portable, unpacked] = await Promise.all([collectFileArtifactEvidence(input.portable), collectFileArtifactEvidence(input.unpacked)])
    report.artifacts = { portable, unpacked }
    report.baseline = await collectSharpPayload(path.join(path.dirname(input.unpacked), 'resources'))
    let stopped = false
    for (const kind of ['portable', 'unpacked'] as const) {
      for (let round = 1; round <= roundsPerArtifact; round++) {
        const evidence = await runRound(kind, round, input[kind], input.output, report.baseline)
        report.rounds.push(evidence)
        console.log(`${kind} ${round}/${roundsPerArtifact}: ${evidence.failure || evidence.shutdown?.failure || 'PNG 完整解码通过'}`)
        if (!evidence.shutdown?.complete) { stopped = true; break }
      }
      if (stopped) break
    }
    if (report.rounds.length === report.expectedRounds && report.rounds.every(round => !round.failure && round.decode && round.shutdown?.complete && !round.shutdown.failure)) report.status = 'passed'
    else report.failure = `专项验证未通过，已执行 ${report.rounds.length}/${report.expectedRounds} 轮；逐轮失败及退出状态见 rounds`
  } catch (error) { report.failure = failureOf(error) }
  finally {
    report.finishedAt = new Date().toISOString()
    await fs.writeFile(path.join(input.output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  }
  if (report.status !== 'passed') throw new Error(`${report.failure}\n报告：${path.join(input.output, 'report.json')}`)
  console.log(`Portable sharp 专项验证通过，10 轮冷启动及 Main PNG 解码；报告：${path.join(input.output, 'report.json')}`)
}
