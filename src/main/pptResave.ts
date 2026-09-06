import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'

// Static script, with paths passed as separate -File arguments. No input becomes PowerShell code.
export const POWERPOINT_RESAVE_SCRIPT = String.raw`param([string]$InputFile, [string]$OutputFile)
$ErrorActionPreference = 'Stop'
$application = $null
$presentation = $null
$security = $null
$alerts = $null
$hadPowerPoint = @(Get-Process POWERPNT -ErrorAction SilentlyContinue).Count -gt 0
try {
  $application = New-Object -ComObject PowerPoint.Application
  $security = $application.AutomationSecurity
  $alerts = $application.DisplayAlerts
  $application.AutomationSecurity = 3
  $application.DisplayAlerts = 1
  $presentation = $application.Presentations.Open($InputFile, -1, -1, 0)
  $presentation.SaveAs($OutputFile, 24)
  Write-Output 'PPT_RESAVE_OK'
} catch {
  Write-Output 'PPT_RESAVE_FAILED'
  exit 2
} finally {
  if ($presentation) { try { $presentation.Close() } catch {}; [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($presentation) }
  if ($application) {
    if ($null -ne $security) { try { $application.AutomationSecurity = $security } catch {} }
    if ($null -ne $alerts) { try { $application.DisplayAlerts = $alerts } catch {} }
    if (-not $hadPowerPoint) { try { if ($application.Presentations.Count -eq 0) { $application.Quit() } } catch {} }
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($application)
  }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}`

export function assertLegacyPpt(bytes: Uint8Array): void {
  const signature = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
  if (bytes.length < 512 || !signature.every((value, index) => bytes[index] === value)) throw new Error('所选文件不是旧版二进制 PPT，请选择原始 .ppt 文件或直接导入 .pptx')
}

export interface PptResaveOptions {
  signal?: AbortSignal
  timeoutMs?: number
  /** A fixed test runner may replace PowerShell; never exposed through IPC. */
  run?: (script: string, source: string, output: string) => ChildProcessWithoutNullStreams
}
export async function resaveLegacyPpt(sourcePath: string, temporaryRoot: string, options: PptResaveOptions = {}): Promise<Uint8Array> {
  if (process.platform !== 'win32' && !options.run) throw new Error('旧 PPT 转换需要 Windows 上安装的 Microsoft PowerPoint；请先另存为 .pptx')
  if (path.extname(sourcePath).toLowerCase() !== '.ppt') throw new Error('请选择 .ppt 文件')
  const stat = await fs.stat(sourcePath)
  if (!stat.isFile() || stat.size > 32 * 1024 * 1024) throw new Error('PPT 不能超过 32 MiB')
  const source = await fs.readFile(sourcePath)
  assertLegacyPpt(source)
  if (options.signal?.aborted) throw new Error('已取消 PPT 转换')
  await fs.mkdir(temporaryRoot, { recursive: true })
  const directory = await fs.mkdtemp(path.join(temporaryRoot, 'ppt-resave-'))
  const input = path.join(directory, 'input.ppt'), output = path.join(directory, 'output.pptx'), script = path.join(directory, 'resave.ps1')
  try {
    await fs.writeFile(input, source, { flag: 'wx' })
    await fs.writeFile(script, POWERPOINT_RESAVE_SCRIPT, { flag: 'wx' })
    const worker = options.run ? options.run(script, input, output) : spawn(
      path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-InputFile', input, '-OutputFile', output],
      { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    )
    worker.stdin.end()
    let cancelled = false, timedOut = false, text = ''
    const cancel = () => { cancelled = true; worker.kill() }
    options.signal?.addEventListener('abort', cancel, { once: true })
    if (options.signal?.aborted) cancel()
    const timeout = setTimeout(() => { timedOut = true; worker.kill() }, options.timeoutMs ?? 90000)
    try {
      const code = await new Promise<number | null>((resolve, reject) => {
        worker.stdout.on('data', data => { text = (text + data.toString()).slice(-1000) })
        worker.stderr.on('data', () => {})
        worker.once('error', reject); worker.once('close', resolve)
      })
      if (cancelled) throw new Error('已取消 PPT 转换')
      if (timedOut) throw new Error('PPT 转换超时；请在 PowerPoint 中检查密码保护或文件损坏，再另存为 .pptx')
      if (code !== 0 || !text.includes('PPT_RESAVE_OK')) throw new Error('PowerPoint 无法转换此文件。请确认已安装 Microsoft PowerPoint，并在其中检查密码保护或文件损坏，再另存为 .pptx')
      const converted = await fs.readFile(output)
      if (converted.length > 32 * 1024 * 1024 || converted[0] !== 0x50 || converted[1] !== 0x4b) throw new Error('PowerPoint 未生成有效的 PPTX 副本')
      return new Uint8Array(converted)
    } finally { clearTimeout(timeout); options.signal?.removeEventListener('abort', cancel) }
  } finally {
    // Resolve and verify the app-owned target before recursive cleanup; never remove sourcePath.
    const resolved = path.resolve(directory)
    if (path.dirname(resolved) !== path.resolve(temporaryRoot) || !path.basename(resolved).startsWith('ppt-resave-')) throw new Error('转换临时路径无效')
    await fs.rm(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
  }
}
