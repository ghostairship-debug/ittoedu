import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'

// Static script, with paths passed as separate -File arguments. No input becomes PowerShell code.
export const POWERPOINT_RESAVE_SCRIPT = String.raw`param([string]$InputFile, [string]$OutputFile)
$ErrorActionPreference = 'Stop'
$cancelFile = Join-Path $PSScriptRoot 'cancel'
$ownershipFile = Join-Path $PSScriptRoot 'powerpoint-owner.json'
$application = $null
$presentation = $null
$security = $null
$alerts = $null
$ownsApplication = $false
$existingPowerPointIds = @(Get-Process POWERPNT -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
function Confirm-NotCancelled {
  if (Test-Path -LiteralPath $cancelFile) { throw [OperationCanceledException]::new('PPT conversion cancelled') }
}
try {
  Confirm-NotCancelled
  $application = New-Object -ComObject PowerPoint.Application
  try {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class GuolingPptWindow {
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
}
'@
    [uint32]$applicationProcessId = 0
    [void][GuolingPptWindow]::GetWindowThreadProcessId([IntPtr]$application.HWND, [ref]$applicationProcessId)
    $applicationProcess = Get-Process -Id $applicationProcessId -ErrorAction Stop
    $ownsApplication = $applicationProcess.ProcessName -eq 'POWERPNT' -and
      $existingPowerPointIds -notcontains [int]$applicationProcessId -and $application.Presentations.Count -eq 0
    $owner = @{ owned = $ownsApplication; processId = [int]$applicationProcessId;
      startTicks = $applicationProcess.StartTime.ToUniversalTime().Ticks.ToString() }
    [IO.File]::WriteAllText($ownershipFile, ($owner | ConvertTo-Json -Compress))
  } catch {
    # An unavailable window handle must not reject a convertible presentation.
    # Without a precise identity cancellation remains cooperative, never global.
    $ownsApplication = $false
  }
  Confirm-NotCancelled
  $security = $application.AutomationSecurity
  $alerts = $application.DisplayAlerts
  $application.AutomationSecurity = 3
  $application.DisplayAlerts = 1
  Confirm-NotCancelled
  $presentation = $application.Presentations.Open($InputFile, -1, -1, 0)
  Confirm-NotCancelled
  $presentation.SaveAs($OutputFile, 24)
  Confirm-NotCancelled
  Write-Output 'PPT_RESAVE_OK'
} catch {
  Write-Output 'PPT_RESAVE_FAILED'
  exit 2
} finally {
  if ($presentation) { try { $presentation.Close() } catch {}; [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($presentation) }
  if ($application) {
    if ($null -ne $security) { try { $application.AutomationSecurity = $security } catch {} }
    if ($null -ne $alerts) { try { $application.DisplayAlerts = $alerts } catch {} }
    if ($ownsApplication -or $existingPowerPointIds.Count -eq 0) { try { if ($application.Presentations.Count -eq 0) { $application.Quit() } } catch {} }
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($application)
  }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}`

// Only the COM window's recorded process may be terminated. A reused user
// process, an unavailable identity or a recycled PID remains untouched.
export const POWERPOINT_CANCEL_SCRIPT = String.raw`param([string]$OwnershipFile)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $OwnershipFile)) { exit 0 }
$owner = Get-Content -LiteralPath $OwnershipFile -Raw | ConvertFrom-Json
if ($owner.owned -ne $true) { exit 0 }
$applicationProcess = Get-Process -Id ([int]$owner.processId) -ErrorAction SilentlyContinue
if (-not $applicationProcess) { exit 0 }
if ($applicationProcess.ProcessName -ne 'POWERPNT' -or
    $applicationProcess.StartTime.ToUniversalTime().Ticks.ToString() -ne [string]$owner.startTicks) { exit 0 }
$applicationProcess.Kill()
$applicationProcess.WaitForExit()
`

function powershellPath(): string {
  return path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

async function cancelOwnedApplication(ownership: string, script: string): Promise<void> {
  // Cancellation may arrive before COM creates its process; the worker sees
  // the marker immediately after acquisition and then performs normal cleanup.
  try { if (JSON.parse(await fs.readFile(ownership, 'utf8')).owned !== true) return }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
  const helper = spawn(powershellPath(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', script, '-OwnershipFile', ownership], { shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
  helper.stderr.on('data', () => {})
  await new Promise<void>((resolve, reject) => {
    helper.once('error', reject)
    helper.once('close', code => code === 0 ? resolve() : reject(new Error('PowerPoint 取消清理未完成')))
  })
}

export function assertLegacyPpt(bytes: Uint8Array): void {
  const signature = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
  if (bytes.length < 512 || !signature.every((value, index) => bytes[index] === value)) throw new Error('所选文件不是旧版二进制 PPT，请选择原始 .ppt 文件或直接导入 .pptx')
}

export interface PptResaveOptions {
  signal?: AbortSignal
  /** A fixed test runner may replace PowerShell; never exposed through IPC. */
  run?: (script: string, source: string, output: string) => ChildProcessWithoutNullStreams
}
export async function resaveLegacyPpt(sourcePath: string, temporaryRoot: string, options: PptResaveOptions = {}): Promise<Uint8Array> {
  if (process.platform !== 'win32' && !options.run) throw new Error('旧 PPT 转换需要 Windows 上安装的 Microsoft PowerPoint；请先另存为 .pptx')
  if (path.extname(sourcePath).toLowerCase() !== '.ppt') throw new Error('请选择 .ppt 文件')
  const stat = await fs.stat(sourcePath)
  if (!stat.isFile()) throw new Error('PPT 必须是普通文件')
  const source = await fs.readFile(sourcePath)
  assertLegacyPpt(source)
  if (options.signal?.aborted) throw new Error('已取消 PPT 转换')
  await fs.mkdir(temporaryRoot, { recursive: true })
  const directory = await fs.mkdtemp(path.join(temporaryRoot, 'ppt-resave-'))
  const input = path.join(directory, 'input.ppt'), output = path.join(directory, 'output.pptx'), script = path.join(directory, 'resave.ps1')
  const cancelFile = path.join(directory, 'cancel'), ownership = path.join(directory, 'powerpoint-owner.json'), cancelScript = path.join(directory, 'cancel.ps1')
  try {
    await fs.writeFile(input, source, { flag: 'wx' })
    await fs.writeFile(script, POWERPOINT_RESAVE_SCRIPT, { flag: 'wx' })
    await fs.writeFile(cancelScript, POWERPOINT_CANCEL_SCRIPT, { flag: 'wx' })
    const worker = options.run ? options.run(script, input, output) : spawn(
      powershellPath(),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-InputFile', input, '-OutputFile', output],
      { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    )
    worker.stdin.end()
    let cancelled = false, text = '', cancellation: Promise<void> | undefined, cancellationError: unknown
    const cancel = () => {
      cancelled = true
      cancellation ??= fs.writeFile(cancelFile, 'cancelled').then(() => cancelOwnedApplication(ownership, cancelScript))
        .catch(error => { cancellationError = error })
    }
    options.signal?.addEventListener('abort', cancel, { once: true })
    if (options.signal?.aborted) cancel()
    try {
      const code = await new Promise<number | null>((resolve, reject) => {
        worker.stdout.on('data', data => { text = (text + data.toString()).slice(-1000) })
        worker.stderr.on('data', () => {})
        worker.once('error', reject); worker.once('close', resolve)
      })
      // The Office call and the worker's finally are over. Do not launch a
      // new cleanup helper while the completed output is being read/removed.
      options.signal?.removeEventListener('abort', cancel)
      await cancellation
      if (cancellationError) throw new Error('PPT 转换进程已结束，但取消清理未能确认；当前原文件保持不变')
      if (cancelled) throw new Error('已取消 PPT 转换')
      if (code !== 0 || !text.includes('PPT_RESAVE_OK')) throw new Error('PowerPoint 无法转换此文件。请确认已安装 Microsoft PowerPoint，并在其中检查密码保护或文件损坏，再另存为 .pptx')
      const converted = await fs.readFile(output)
      if (options.signal?.aborted) throw new Error('已取消 PPT 转换')
      if (converted[0] !== 0x50 || converted[1] !== 0x4b) throw new Error('PowerPoint 未生成有效的 PPTX 副本')
      return new Uint8Array(converted)
    } finally { options.signal?.removeEventListener('abort', cancel) }
  } finally {
    // Resolve and verify the app-owned target before recursive cleanup; never remove sourcePath.
    const resolved = path.resolve(directory)
    if (path.dirname(resolved) !== path.resolve(temporaryRoot) || !path.basename(resolved).startsWith('ppt-resave-')) throw new Error('转换临时路径无效')
    await fs.rm(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
  }
}
