import { spawn } from 'node:child_process'
import path from 'node:path'

export interface WindowsSpeechVoice { name: string; culture: string }
export interface LocalSpeechSynthesizer {
  voices(): Promise<readonly WindowsSpeechVoice[]>
  synthesize(input: { text: string; voice: string }, signal: AbortSignal): Promise<Uint8Array>
}

// The program is fixed. Task text and voice names travel only as JSON stdin;
// neither a model command nor an authored expression is ever evaluated.
// https://learn.microsoft.com/en-us/dotnet/api/system.speech.synthesis.speechsynthesizer
const program = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$synth = $null
$wave = $null
try {
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  Add-Type -AssemblyName System.Speech
  $synth = [System.Speech.Synthesis.SpeechSynthesizer]::new()
  if ($request.operation -eq 'voices') {
    $voices = @($synth.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object {
      @{ name = $_.VoiceInfo.Name; culture = $_.VoiceInfo.Culture.Name }
    })
    [Console]::Out.Write((@{ voices = $voices } | ConvertTo-Json -Compress -Depth 4))
  } elseif ($request.operation -eq 'synthesize') {
    $synth.SelectVoice([string]$request.voice)
    $wave = [IO.MemoryStream]::new()
    $synth.SetOutputToWaveStream($wave)
    $synth.Speak([string]$request.text)
    $synth.SetOutputToNull()
    [Console]::Out.Write((@{ audioBase64 = [Convert]::ToBase64String($wave.ToArray()) } | ConvertTo-Json -Compress))
  } else { throw 'Unsupported fixed speech operation' }
} catch {
  [Console]::Out.Write((@{ error = $_.Exception.Message } | ConvertTo-Json -Compress))
  exit 1
} finally {
  if ($null -ne $synth) { $synth.Dispose() }
  if ($null -ne $wave) { $wave.Dispose() }
}
`
const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(program, 'utf16le').toString('base64')]

/** Desktop-owned System.Speech, separate from the untrusted local.run sandbox. */
export class WindowsSpeechSynthesizer implements LocalSpeechSynthesizer {
  private voiceCache?: Promise<readonly WindowsSpeechVoice[]>

  private invoke(request: { operation: 'voices' } | { operation: 'synthesize'; text: string; voice: string }, signal?: AbortSignal): Promise<Record<string, unknown>> {
    if (process.platform !== 'win32') return Promise.reject(new Error('本机语音生成只支持已安装 System.Speech 声库的 Windows 桌面'))
    signal?.throwIfAborted()
    const executable = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    return new Promise((resolve, reject) => {
      const child = spawn(executable, args, { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] })
      const output: Buffer[] = []
      const abort = () => { child.kill() }
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) abort()
      child.stdout.on('data', chunk => { output.push(Buffer.from(chunk)) })
      // JSON stdout carries the scoped error. Consume stderr to keep the helper
      // pipe flowing without returning its encoded program or incidental output.
      child.stderr.resume()
      child.stdin.on('error', () => { /* close/error below owns the result */ })
      child.once('error', reject)
      child.once('close', code => {
        signal?.removeEventListener('abort', abort)
        if (signal?.aborted) { reject(signal.reason); return }
        let result: Record<string, unknown>
        try { result = JSON.parse(Buffer.concat(output).toString('utf8').replace(/^\uFEFF/, '')) as Record<string, unknown> }
        catch { reject(new Error('Windows 本机语音未返回可用的结果')); return }
        if (code !== 0 || typeof result.error === 'string') {
          reject(new Error(typeof result.error === 'string' ? `Windows 本机语音不可用：${result.error}` : `Windows 本机语音进程退出：${code}`)); return
        }
        resolve(result)
      })
      child.stdin.end(JSON.stringify(request), 'utf8')
    })
  }

  voices(): Promise<readonly WindowsSpeechVoice[]> {
    return this.voiceCache ??= this.invoke({ operation: 'voices' }).then(result => {
      const values = Array.isArray(result.voices) ? result.voices : []
      const voices = values.filter((value): value is WindowsSpeechVoice => !!value && typeof value === 'object'
        && typeof value.name === 'string' && !!value.name.trim() && typeof value.culture === 'string')
      if (!voices.length) throw new Error('Windows 本机没有可用的已启用语音声库')
      return voices
    })
  }

  async synthesize(input: { text: string; voice: string }, signal: AbortSignal): Promise<Uint8Array> {
    const result = await this.invoke({ operation: 'synthesize', ...input }, signal)
    if (typeof result.audioBase64 !== 'string' || !result.audioBase64) throw new Error('Windows 本机语音未生成录音')
    return new Uint8Array(Buffer.from(result.audioBase64, 'base64'))
  }
}
