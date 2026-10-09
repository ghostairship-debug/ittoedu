# Independent packaged acceptance. Run with Windows PowerShell 5.1 after Root/E freeze the candidate.
# No source imports, Node/WSL, model calls, forced exit, or global environment changes.
[CmdletBinding()]
param(
  [string]$Candidate = 'D:\果铃工作台\output\teacher-runtime-evidence\windows-dir-candidate\win-unpacked',
  [int]$DiagnosticSeconds = 180,
  [string]$ReuseWorkspace,
  [int]$ConnectionPort = 45123
)
$ErrorActionPreference = 'Stop'
$root = 'D:\果铃工作台'
$outputRoot = Join-Path $root 'output\teacher-runtime-evidence'
$run = Join-Path $outputRoot ('packaged-compute-' + [Guid]::NewGuid().ToString('N'))
$workspace = Join-Path $run 'workspace'
if ($ReuseWorkspace) { $workspace = [IO.Path]::GetFullPath($ReuseWorkspace) }
$profile = Join-Path $run 'profile'
$temporary = Join-Path $run 'temporary'
$utf8 = New-Object Text.UTF8Encoding($false)
$script:Credentials = New-Object 'System.Collections.Generic.List[string]'
$script:RpcNumber = 0
$script:Ready = $null
$clientA = $null
$owner = $null
$failure = $null
$facts = [ordered]@{ status = 'running'; candidate = $Candidate; directory = $run; billingCalls = 0;
  scope = $(if ($ReuseWorkspace) { 'gui-reuse-explicit-port' } else { 'complete-packaged-compute' });
  computeExecuted = $false; mcp = $false; compute = $false; gui = $false; detach = $false; naturalExit = $false; gaps = @() }
$originalLocation = (Get-Location).Path
$environmentNames = @('PATH', 'TEMP', 'TMP', 'COURSEWARE_E2E_BACKGROUND', 'ELECTRON_RUN_AS_NODE', 'VITE_DEV_SERVER_URL')
$originalEnvironment = @{}
foreach ($key in $environmentNames) { $originalEnvironment[$key] = [Environment]::GetEnvironmentVariable($key, 'Process') }

function Assert-True([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Same-Path([string]$Left, [string]$Right) {
  return [String]::Equals([IO.Path]::GetFullPath($Left), [IO.Path]::GetFullPath($Right), [StringComparison]::OrdinalIgnoreCase)
}
function Safe-Message([string]$Message) {
  foreach ($secret in $script:Credentials) { if ($secret) { $Message = $Message.Replace($secret, '[redacted]') } }
  return $Message
}
function Checkpoint([string]$Stage, $Data = @{}) {
  $entry = [ordered]@{ time = [DateTime]::UtcNow.ToString('o'); stage = $Stage; facts = $Data }
  [IO.File]::AppendAllText((Join-Path $run 'checkpoint.jsonl'), ($entry | ConvertTo-Json -Depth 12 -Compress) + "`n", $utf8)
}
function Quote-Argument([string]$Value) {
  $escaped = [regex]::Replace($Value, '(\\*)"', '$1$1\"')
  return '"' + [regex]::Replace($escaped, '(\\+)$', '$1$1') + '"'
}
function Connect-Product {
  # Capture both streams in memory: the helper's stdout contains a one-use bearer.
  $start = New-Object Diagnostics.ProcessStartInfo
  $start.FileName = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $helper, '-TaskPath', $task, '-Profile', $profile)
  $start.Arguments = ($arguments | ForEach-Object { Quote-Argument $_ }) -join ' '
  $start.WorkingDirectory = $workspace
  $start.UseShellExecute = $false; $start.CreateNoWindow = $true
  $start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
  $start.StandardOutputEncoding = $utf8
  $start.StandardErrorEncoding = $utf8
  $process = New-Object Diagnostics.Process
  $process.StartInfo = $start
  [void]$process.Start()
  # The one-use helper writes one complete receipt line; a resident can retain
  # inherited pipe handles after that helper exits. Start this reader in line mode.
  $stdout = $process.StandardOutput.ReadLineAsync(); $stderr = $process.StandardError.ReadToEndAsync()
  Assert-True ($process.WaitForExit(90000)) 'Distributed helper did not settle within the test diagnostic wait; no process was killed.'
  Checkpoint 'helper.exited' @{ exitCode = $process.ExitCode; stdoutTask = [string]$stdout.Status; stderrTask = [string]$stderr.Status }
  if ($process.ExitCode -ne 0) {
    # Read only completed tasks. A live resident may still retain inherited pipe handles.
    # Never persist an arbitrary line: JSON/parser errors can contain the entire bearer receipt.
    $diagnostic = @{ exitCode = $process.ExitCode; stdoutTask = [string]$stdout.Status; stderrTask = [string]$stderr.Status }
    if ($stderr.IsFaulted) { $diagnostic.stderrExceptionType = $stderr.Exception.GetBaseException().GetType().FullName }
    elseif ($stderr.Status -eq [Threading.Tasks.TaskStatus]::RanToCompletion) {
      $errorText = [string]$stderr.Result
      $diagnostic.stderrCharacters = $errorText.Length
      $diagnostic.stderrCategory = 'unclassified'
      if ($errorText -match 'null-valued expression|Object reference not set') { $diagnostic.stderrCategory = 'null-result' }
      elseif ($errorText -match 'ConvertFrom-Json|Invalid JSON|Unexpected character|JSON primitive') { $diagnostic.stderrCategory = 'json-parse' }
      elseif ($errorText -match 'Guoling connection failed') { $diagnostic.stderrCategory = 'connector-exit' }
      elseif ($errorText -match 'did not return a ready connection') { $diagnostic.stderrCategory = 'ready-receipt-missing' }
      elseif ($errorText -match 'Cannot find path|not installed here|Access is denied') { $diagnostic.stderrCategory = 'path-or-permission' }
      $errno = [regex]::Match($errorText, '\b(ENOENT|EACCES|EPERM|ECONNREFUSED|EADDRINUSE)\b')
      if ($errno.Success) { $diagnostic.errno = $errno.Value }
    }
    if ($stdout.IsFaulted) { $diagnostic.stdoutExceptionType = $stdout.Exception.GetBaseException().GetType().FullName }
    elseif ($stdout.Status -eq [Threading.Tasks.TaskStatus]::RanToCompletion) {
      $diagnostic.stdoutCharacters = ([string]$stdout.Result).Length
    }
    Checkpoint 'helper.failed-diagnostic' $diagnostic
  }
  Assert-True ($process.ExitCode -eq 0) ('Distributed helper exited with code ' + $process.ExitCode)
  $receiptLine = $stdout.Result
  # The asynchronous first-line read is finished before any subsequent read on
  # this reader. Skip only legal leading whitespace; never wait for stream EOF.
  while ($null -ne $receiptLine -and [string]::IsNullOrWhiteSpace($receiptLine)) {
    $receiptLine = $process.StandardOutput.ReadLine()
  }
  Assert-True ($null -ne $receiptLine) 'Distributed helper ended before a complete JSON receipt.'
  try { $connection = $receiptLine | ConvertFrom-Json }
  catch { throw ('Distributed helper receipt was not JSON. lineCharacters=' + $receiptLine.Length) }
  Assert-True ($connection.status -eq 'ready' -and [bool]$connection.token) 'Distributed helper did not supply an actual ready receipt.'
  $script:Credentials.Add([string]$connection.token)
  return $connection
}
function Invoke-ProductRpc($Headers, [string]$Method, $Parameters, [bool]$Notification = $false) {
  $message = @{ jsonrpc = '2.0'; method = $Method; params = $Parameters }
  $id = $null
  if (-not $Notification) { $script:RpcNumber++; $id = $script:RpcNumber; $message.id = $id }
  Checkpoint 'rpc.before' @{ method = $Method; id = $id; tool = $Parameters.name }
  $bytes = $utf8.GetBytes(($message | ConvertTo-Json -Depth 40 -Compress))
  $response = Invoke-WebRequest -UseBasicParsing -Uri $script:Ready.endpoint -Method Post -Headers $Headers `
    -ContentType 'application/json' -Body $bytes -TimeoutSec 60
  Checkpoint 'rpc.after' @{ method = $Method; id = $id; http = [int]$response.StatusCode; tool = $Parameters.name }
  if ($Notification) { return [pscustomobject]@{ Response = $response; Rpc = $null } }
  if ([string]$response.Headers['Content-Type'] -like 'text/event-stream*') {
    $matching = @($response.Content -split '\r?\n' | Where-Object { $_.StartsWith('data: ') } | ForEach-Object {
      $_.Substring(6) | ConvertFrom-Json
    } | Where-Object { $_.id -eq $id })
    Assert-True ($matching.Count -gt 0) 'MCP stream ended without the matching RPC receipt; do not replay a side effect.'
    $rpc = $matching[-1]
  } else { $rpc = $response.Content | ConvertFrom-Json }
  Assert-True ($rpc.id -eq $id) 'MCP returned a different RPC identity.'
  if ($rpc.error) { throw ('RPC ' + $Method + ' failed: ' + (Safe-Message ([string]$rpc.error.message))) }
  return [pscustomobject]@{ Response = $response; Rpc = $rpc }
}
function Open-Session([string]$Name) {
  $headers = @{ Authorization = 'Bearer ' + $script:Ready.token; Accept = 'application/json, text/event-stream' }
  $reply = Invoke-ProductRpc $headers 'initialize' @{ protocolVersion = '2025-11-25'; capabilities = @{};
    clientInfo = @{ name = $Name; version = '1' } }
  $session = [string]$reply.Response.Headers['Mcp-Session-Id']
  Assert-True ([bool]$session) 'Initialize did not return a session identity.'
  $script:Credentials.Add($session)
  $headers['Mcp-Session-Id'] = $session
  $headers['Mcp-Protocol-Version'] = [string]$reply.Rpc.result.protocolVersion
  $initialized = Invoke-ProductRpc $headers 'notifications/initialized' @{} $true
  Assert-True ([int]$initialized.Response.StatusCode -eq 202) 'Initialized notification was not accepted.'
  return $headers
}
function Invoke-Tool($Headers, [string]$Name, $Arguments, [bool]$AllowPending = $false) {
  $reply = Invoke-ProductRpc $Headers 'tools/call' @{ name = $Name; arguments = $Arguments }
  $result = $reply.Rpc.result.structuredContent.result
  Assert-True ($null -ne $result) ('Missing formal result for ' + $Name)
  if ($result.kind -eq 'error') { throw ($Name + ': ' + $result.code + ': ' + (Safe-Message ([string]$result.message))) }
  $data = $result.data
  $status = [string]$data.status
  $pending = $AllowPending -and $status -in @('preparing', 'running')
  Assert-True (-not $reply.Rpc.result.isError -or $pending) ($Name + ' did not return a successful formal receipt; status=' + $status)
  Checkpoint 'tool.receipt' @{ name = $Name; kind = $result.kind; status = $status }
  return $data
}
function Record-Recent {
  if ($clientA -and $script:Ready) {
    try {
      # Read only; never resend compute.run/artifact.save after a missing reply.
      $recent = Invoke-Tool $clientA 'operation.recent' @{ limit = 20 }
      $safe = @($recent.operations | ForEach-Object { @{ tool = $_.tool; status = $_.status; delivered = $_.delivered } })
      Checkpoint 'unknown.lookup' @{ operations = $safe }
    } catch { Checkpoint 'unknown.lookup-unavailable' @{ message = Safe-Message $_.Exception.Message } }
  }
}

$python = @'
import os, json, sys
from pathlib import Path
import numpy as np
import pandas as pd
import matplotlib
from matplotlib import pyplot as plt, font_manager
import js
assert __name__ == '__main__'
assert os.getcwd() == '/job/output'
assert os.environ['GUOLING_INPUT_DIR'] == '/job/input'
assert os.environ['GUOLING_OUTPUT_DIR'] == '/job/output'
assert not hasattr(js, 'process') and not hasattr(js, 'require') and not hasattr(js, 'computeWorkerAPI')
original = Path('/job/input/班级分数.csv').read_text()
try:
    Path('/job/input/班级分数.csv').write_text('must not replace teacher input')
except OSError:
    readonly = True
else:
    raise AssertionError('Teacher input accepted a write')
assert Path('/job/input/班级分数.csv').read_text() == original
Path('/job/work/alias-check.txt').write_text('same output owner')
assert Path('alias-check.txt').read_text() == 'same output owner'
Path('alias-check.txt').unlink()
assert str(Path('/job/work').resolve()) == '/job/output'
data = pd.read_csv('/job/input/班级分数.csv')
means = data.groupby('班级')['分数'].mean()
total = float(np.mean(data['分数'].to_numpy()))
assert means.to_dict() == {'一班': 90.0, '二班': 80.0} and total == 85.0
pd.DataFrame({'班级': list(means.index) + ['总均分'], '平均分': list(means.values) + [total]}).to_csv('summary.csv', index=False, encoding='utf-8')
font_path = font_manager.findfont(font_manager.FontProperties(family='Noto Sans SC'), fallback_to_default=False)
font = font_manager.FontProperties(fname=font_path)
assert font.get_name() == 'Noto Sans SC' and matplotlib.get_backend().lower() == 'agg'
Path('charts').mkdir()
fig, axis = plt.subplots(figsize=(5, 3), dpi=120)
axis.bar(list(means.index), list(means.values), color=['#1188cc', '#24a070'])
axis.set_title('班级成绩均分', fontproperties=font)
axis.set_xlabel('班级', fontproperties=font)
axis.set_ylabel('平均分', fontproperties=font)
for label in axis.get_xticklabels(): label.set_fontproperties(font)
fig.tight_layout()
fig.savefig('charts/班级均分.png')
plt.close(fig)
Path('probe.json').write_text(json.dumps({'means': {key: float(value) for key, value in means.items()}, 'total': total,
    'inputReadOnly': readonly, 'cwd': os.getcwd(), 'workAlias': str(Path('/job/work').resolve()),
    'env': {key: os.environ[key] for key in ['GUOLING_INPUT_DIR', 'GUOLING_OUTPUT_DIR']},
    'fontFamily': font.get_name(), 'numpyVersion': np.__version__, 'pandasVersion': pd.__version__}, ensure_ascii=False))
print('一班均分90，二班均分80，总均分85')
sys.exit(0)
'@

try {
  Assert-True ($DiagnosticSeconds -ge 60) 'Use a diagnostic wait of at least 60 seconds; this is not a product execution deadline.'
  Assert-True ($ReuseWorkspace -or $ConnectionPort -eq 45123) 'An explicit connection port is reserved for the GUI-only reuse fixture.'
  if ($ReuseWorkspace) {
    Assert-True (Test-Path -LiteralPath $workspace -PathType Container) 'The existing evidence workspace is missing; do not recreate it.'
    $priorEvidence = Join-Path (Split-Path -Parent $workspace) 'facts.json'
    $prior = [IO.File]::ReadAllText($priorEvidence, $utf8) | ConvertFrom-Json
    Assert-True ($prior.mcp -and $prior.compute -and @($prior.deliveries | Where-Object { $_.status -eq 'written' }).Count -eq 3) 'The prior fixture has no actual MCP and three written compute artifacts.'
    foreach ($name in @('connection-example.md', 'summary.csv', '班级均分.png', 'probe.json')) {
      Assert-True ((Test-Path -LiteralPath (Join-Path $workspace $name) -PathType Leaf) -and (Get-Item -LiteralPath (Join-Path $workspace $name)).Length -gt 0) ('Required existing evidence file is missing or empty: ' + $name)
    }
    $facts.priorEvidence = $priorEvidence
    $facts.reusedWorkspace = $workspace
  }
  foreach ($directory in @($run, $workspace, $profile, $temporary)) { [void][IO.Directory]::CreateDirectory($directory) }
  $Candidate = [IO.Path]::GetFullPath($Candidate)
  $exe = Join-Path $Candidate 'guoling-workbench.exe'
  # Existing frozen receipts still reference the original executable name.
  if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { $exe = Join-Path $Candidate 'ittoedu-courseware-editor.exe' }
  $helper = Join-Path $Candidate 'resources\mcp-bootstrap\Connect-Guoling.ps1'
  Assert-True ((Test-Path -LiteralPath $exe -PathType Leaf) -and (Test-Path -LiteralPath $helper -PathType Leaf) `
    -and (Test-Path -LiteralPath (Join-Path $Candidate 'resources\app.asar') -PathType Leaf)) 'Packaged executable, self-locating helper, or app.asar is missing.'
  $task = Join-Path $workspace 'connection-example.md'
  $bodyMarker = 'Packaged teacher computation 90 80 85'
  if (-not $ReuseWorkspace) {
    [IO.File]::WriteAllText($task, ('# ' + $bodyMarker + "`n`nTeacher fixture remains unchanged.`n"), $utf8)
    [IO.File]::WriteAllText((Join-Path $workspace '班级分数.csv'), "班级,分数`n一班,80`n一班,100`n二班,70`n二班,90`n", $utf8)
  }
  # System32 can contain the OS wsl.exe launcher even when WSL is uninstalled.
  # All required executables are absolute; restrict only this process/children's PATH.
  $env:PATH = "$env:SystemRoot\System32\WindowsPowerShell\v1.0"
  $env:TEMP = $temporary; $env:TMP = $temporary; $env:COURSEWARE_E2E_BACKGROUND = '0'
  $env:ELECTRON_RUN_AS_NODE = $null; $env:VITE_DEV_SERVER_URL = $null
  Set-Location -LiteralPath $workspace
  foreach ($command in @('node', 'tsx', 'wsl')) {
    Assert-True ($null -eq (Get-Command $command -CommandType Application -ErrorAction SilentlyContinue)) ('External runtime unexpectedly remains on local PATH: ' + $command)
  }
  if ($ReuseWorkspace) {
    # The existing default-port bootstrap proof remains valid. This postcondition
    # gets its own public endpoint because an unrelated development owner uses 45123.
    if ($ConnectionPort -eq 0) {
      $listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0)
      try { $listener.Start(); $ConnectionPort = $listener.LocalEndpoint.Port } finally { $listener.Stop() }
    }
    Assert-True ($ConnectionPort -ge 1024 -and $ConnectionPort -le 65535) 'Explicit public port is outside the supported range.'
    $handoff = Join-Path $temporary ('guoling-mcp-connect-' + [Guid]::NewGuid().ToString('N'))
    [void][IO.Directory]::CreateDirectory($handoff)
    $readyFile = Join-Path $handoff 'ready.json'
    $launchArguments = @('--headless-mcp', ('--workspace=' + $workspace), ('--port=' + $ConnectionPort),
      ('--user-data-dir=' + $profile), ('--mcp-ready-file=' + $readyFile))
    Checkpoint 'isolated.headless.before' @{ port = $ConnectionPort; workspace = $workspace; priorEvidence = $priorEvidence }
    $prestarted = Start-Process -FilePath $exe -ArgumentList (($launchArguments | ForEach-Object { Quote-Argument $_ }) -join ' ') `
      -WorkingDirectory $workspace -WindowStyle Hidden -PassThru
    [void]$prestarted.Handle
    try {
      $readyDeadline = [DateTime]::UtcNow.AddSeconds(90)
      while (-not (Test-Path -LiteralPath $readyFile -PathType Leaf) -and [DateTime]::UtcNow -lt $readyDeadline -and -not $prestarted.HasExited) { Start-Sleep -Milliseconds 100 }
      Assert-True (Test-Path -LiteralPath $readyFile -PathType Leaf) 'The isolated public headless launch did not supply ready; no process was killed or launch repeated.'
      try { $initialReady = [IO.File]::ReadAllText($readyFile, $utf8) | ConvertFrom-Json }
      catch { throw 'The isolated public ready receipt was not JSON; raw bearer content is omitted.' }
      if ($initialReady.token) { $script:Credentials.Add([string]$initialReady.token) }
      Assert-True ($initialReady.status -eq 'ready' -and $initialReady.mode -eq 'headless' -and $initialReady.ownership -eq 'owned' `
        -and $initialReady.pid -eq $prestarted.Id -and -not $initialReady.workspaceMismatch `
        -and (Same-Path $initialReady.workspace $workspace) -and (Same-Path $initialReady.profile $profile)) 'Explicit headless launch returned a different owner or workspace.'
      $facts.connectionPort = $ConnectionPort
      Checkpoint 'isolated.headless.ready' @{ pid = $prestarted.Id; port = $ConnectionPort; ownership = $initialReady.ownership }
    } finally {
      foreach ($name in @('ready.json', 'ready.tmp')) { $handoffFile = Join-Path $handoff $name; if (Test-Path -LiteralPath $handoffFile -PathType Leaf) { Remove-Item -LiteralPath $handoffFile -Force } }
      [IO.Directory]::Delete($handoff)
    }
  }
  Checkpoint 'headless.connect.before' @{ cwd = $workspace; externalRuntimeOnPath = $false }
  $script:Ready = Connect-Product
  $expectedOwnership = if ($ReuseWorkspace) { 'attached' } else { 'owned' }
  Assert-True ($script:Ready.mode -eq 'headless' -and $script:Ready.ownership -eq $expectedOwnership -and -not $script:Ready.workspaceMismatch) 'Expected the actual headless owner in the isolated profile.'
  if ($ReuseWorkspace) { Assert-True ($script:Ready.pid -eq $initialReady.pid -and $script:Ready.endpoint -eq $initialReady.endpoint -and $script:Ready.token -eq $initialReady.token) 'Self-locating helper attached to a different isolated owner or endpoint.' }
  Assert-True ((Same-Path $script:Ready.profile $profile) -and (Same-Path $script:Ready.workspace $workspace) `
    -and $script:Ready.permission -eq 'workspace') 'Connection returned a different profile, workspace, or permission.'
  $owner = [Diagnostics.Process]::GetProcessById([int]$script:Ready.pid)
  [void]$owner.Handle # Retain the live kernel process handle so the exit code remains observable after PID removal.
  Assert-True ((Same-Path $owner.MainModule.FileName $exe) -and -not $owner.HasExited) 'Ready PID is not the actual packaged executable owner.'
  $facts.ownerPid = $owner.Id
  Checkpoint 'headless.ready' @{ pid = $owner.Id; mode = $script:Ready.mode; ownership = $script:Ready.ownership; executable = $owner.MainModule.FileName }
  $clientA = Open-Session 'Packaged teacher acceptance A'
  $catalog = (Invoke-ProductRpc $clientA 'tools/list' @{}).Rpc.result.tools
  foreach ($name in @('file.open', 'compute.run', 'job.wait', 'job.status', 'artifact.save', 'workbench.state', 'operation.recent')) {
    Assert-True (@($catalog | Where-Object { $_.name -eq $name }).Count -eq 1) ('Default public catalog lacks ' + $name)
  }
  $opened = Invoke-Tool $clientA 'file.open' @{ path = 'connection-example.md' }
  Assert-True ([bool]$opened.documentId -and [bool]$opened.target) 'File open did not return an actual document and target.'
  $documentId = [string]$opened.documentId
  $state = Invoke-Tool $clientA 'workbench.state' @{}
  Assert-True (@($state.documents | Where-Object { $_.documentId -eq $documentId -and (Same-Path $_.path $task) -and -not $_.dirty }).Count -eq 1) 'Headless document list does not contain the unchanged teacher file.'
  $facts.mcp = $true; $facts.documentId = $documentId

  if (-not $ReuseWorkspace) {
  Checkpoint 'compute.before'
  $facts.computeExecuted = $true
  $started = Invoke-Tool $clientA 'compute.run' @{ code = $python; sources = @('班级分数.csv');
    outputNames = @('summary.csv', 'charts/班级均分.png', 'probe.json') } $true
  Assert-True ([bool]$started.job) 'Compute run did not supply its software-owned job identity.'
  $job = [string]$started.job
  $deadline = [DateTime]::UtcNow.AddSeconds($DiagnosticSeconds)
  $observed = Invoke-Tool $clientA 'job.status' @{ kind = 'compute'; job = $job }
  while ($observed.status -in @('preparing', 'running')) {
    Assert-True ([DateTime]::UtcNow -lt $deadline) 'Packaged compute exceeded the test diagnostic wait; job was not replayed or forcibly stopped.'
    $observed = Invoke-Tool $clientA 'job.wait' @{ kind = 'compute'; job = $job; milliseconds = 30000 }
    Checkpoint 'compute.observed' @{ job = $job; status = $observed.status }
  }
  if ($observed.status -ne 'ready') {
    $logs = Invoke-Tool $clientA 'job.logs' @{ kind = 'compute'; job = $job; after = 0; limit = 100 }
    Checkpoint 'compute.failed' @{ status = $observed.status; reason = Safe-Message ([string]$observed.snapshot.reason);
      entries = @($logs.entries | ForEach-Object { @{ stream = $_.stream; message = Safe-Message ([string]$_.message) } }) }
  }
  Assert-True ($observed.kind -eq 'compute' -and $observed.jobId -eq $job -and $observed.status -eq 'ready' `
    -and $observed.snapshot.exitCode -eq 0 -and -not $observed.snapshot.stopped) 'Actual packaged Python did not finish ready with exit 0.'
  $deliveries = @(
    @{ name = 'summary.csv'; destination = 'summary.csv' },
    @{ name = 'charts/班级均分.png'; destination = '班级均分.png' },
    @{ name = 'probe.json'; destination = 'probe.json' }
  )
  $safeReceipts = @()
  foreach ($delivery in $deliveries) {
    $matches = @($observed.snapshot.artifacts | Where-Object { $_.name -eq $delivery.name -and $_.byteLength -gt 0 })
    Assert-True ($matches.Count -eq 1) ('Ready receipt lacks useful artifact ' + $delivery.name)
    $saved = Invoke-Tool $clientA 'artifact.save' @{ kind = 'compute'; job = $job; name = $matches[0].name; destination = $delivery.destination }
    $wanted = Join-Path $workspace $delivery.destination
    Assert-True ($saved.status -eq 'written' -and $saved.sourceKind -eq 'compute' -and (Same-Path $saved.path $wanted) `
      -and $saved.byteLength -gt 0 -and (Test-Path -LiteralPath $wanted -PathType Leaf)) 'Artifact delivery did not confirm a real new file.'
    Assert-True ((Get-Item -LiteralPath $wanted).Length -eq $saved.byteLength) 'Physical artifact length does not match its delivery receipt.'
    $safeReceipts += @{ name = $delivery.name; status = $saved.status; path = $saved.path; byteLength = $saved.byteLength }
  }
  $rows = @(Import-Csv -LiteralPath (Join-Path $workspace 'summary.csv') -Encoding UTF8)
  Assert-True ($rows.Count -eq 3) 'Summary CSV did not contain exactly three calculated rows.'
  foreach ($expectation in @(@{ name = '一班'; mean = 90 }, @{ name = '二班'; mean = 80 }, @{ name = '总均分'; mean = 85 })) {
    $row = @($rows | Where-Object { $_.'班级' -eq $expectation.name })
    Assert-True ($row.Count -eq 1 -and [double]::Parse([string]$row[0].'平均分', [Globalization.CultureInfo]::InvariantCulture) -eq $expectation.mean) 'Calculated CSV means differ from 90/80/85.'
  }
  $probe = [IO.File]::ReadAllText((Join-Path $workspace 'probe.json'), $utf8) | ConvertFrom-Json
  Assert-True ($probe.means.'一班' -eq 90 -and $probe.means.'二班' -eq 80 -and $probe.total -eq 85 -and $probe.inputReadOnly `
    -and $probe.cwd -eq '/job/output' -and $probe.workAlias -eq '/job/output' `
    -and $probe.env.GUOLING_INPUT_DIR -eq '/job/input' -and $probe.env.GUOLING_OUTPUT_DIR -eq '/job/output' `
    -and $probe.fontFamily -eq 'Noto Sans SC' -and $probe.numpyVersion -match '^\d+\.' -and $probe.pandasVersion -match '^\d+\.') 'Delivered probe does not confirm the actual packages, Chinese font, means, and filesystem ABI.'
  Add-Type -AssemblyName System.Drawing
  $pngPath = Join-Path $workspace '班级均分.png'
  $image = New-Object Drawing.Bitmap($pngPath)
  try {
    Assert-True ($image.Width -eq 600 -and $image.Height -eq 360) 'Chinese PNG is not the actual requested 600x360 plot.'
    $colored = 0; $ink = 0
    for ($y = 0; $y -lt $image.Height; $y += 2) { for ($x = 0; $x -lt $image.Width; $x += 2) {
      $pixel = $image.GetPixel($x, $y)
      if (($pixel.B -gt 110 -and $pixel.B -gt $pixel.R + 30) -or ($pixel.G -gt 100 -and $pixel.G -gt $pixel.R + 30)) { $colored++ }
      if ($y -lt 60 -and $pixel.R -lt 180 -and $pixel.G -lt 180 -and $pixel.B -lt 180) { $ink++ }
    } }
    Assert-True ($colored -gt 300 -and $ink -gt 20) 'Actual PNG lacks chart colors or visible title ink; retain it for direct Chinese glyph review.'
    $facts.png = @{ path = $pngPath; width = $image.Width; height = $image.Height; coloredSamples = $colored; titleInkSamples = $ink }
  } finally { $image.Dispose() }
  $facts.compute = $true; $facts.job = $job; $facts.deliveries = $safeReceipts; $facts.probe = $probe
  Checkpoint 'compute.written' @{ job = $job; csvMeans = @(90, 80, 85); png = $pngPath; font = $probe.fontFamily }
  } else {
    Checkpoint 'compute.reused-evidence' @{ priorEvidence = $priorEvidence; computeExecuted = $false; artifactWrites = 0 }
  }

  # Native UI access is checked after the independent MCP/compute segment.
  Add-Type -AssemblyName System.Drawing
  try { Add-Type -AssemblyName UIAutomationClient; Add-Type -AssemblyName UIAutomationTypes }
  catch { $facts.gaps += 'Native UI Automation unavailable: ' + (Safe-Message $_.Exception.Message); throw 'Native UI Automation is unavailable; independent MCP and packaged compute evidence is preserved.' }
  Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;
public static class TeacherPackagedWindow {
  delegate bool Callback(IntPtr window, IntPtr parameter);
  [DllImport("user32.dll")] static extern bool EnumWindows(Callback callback, IntPtr parameter);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window, uint message, IntPtr wparam, IntPtr lparam);
  [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr window, IntPtr dc, uint flags);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll")] static extern bool IsWindowEnabled(IntPtr window);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point point);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr window, uint flag);
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll", SetLastError=true)] static extern uint SendInput(uint count, Input[] inputs, int size);
  [StructLayout(LayoutKind.Sequential)] struct Rect { public int left, top, right, bottom; }
  [StructLayout(LayoutKind.Sequential)] struct MouseInput { public int x, y; public uint data, flags, time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct Input { public uint type; public MouseInput mouse; }
  public static IntPtr[] VisibleWindows(int pid) {
    var result = new List<IntPtr>();
    EnumWindows((window, unused) => { uint actual; GetWindowThreadProcessId(window, out actual);
      if (actual == pid && IsWindowVisible(window)) result.Add(window); return true; }, IntPtr.Zero);
    return result.ToArray();
  }
  public static string Title(IntPtr window) { var text = new StringBuilder(1024); GetWindowText(window, text, text.Capacity); return text.ToString(); }
  public static void ClickExit(IntPtr dialog, IntPtr button, int pid) {
    IntPtr previousDpi=SetThreadDpiAwarenessContext(new IntPtr(-4));
    try {
    uint dialogPid, buttonPid; GetWindowThreadProcessId(dialog, out dialogPid); GetWindowThreadProcessId(button, out buttonPid);
    if (dialogPid != pid || buttonPid != pid || Title(dialog) != "关闭果铃" || Title(button) != "退出"
      || !IsWindowVisible(dialog) || !IsWindowVisible(button) || !IsWindowEnabled(button)) throw new Exception("Native Exit identity or visibility changed");
    SetForegroundWindow(dialog);
    Rect rect; if (!GetWindowRect(button, out rect) || rect.right <= rect.left || rect.bottom <= rect.top) throw new Exception("Exit button has no actual bounds");
    int x=rect.left+(rect.right-rect.left)/2, y=rect.top+(rect.bottom-rect.top)/2;
    IntPtr hit=WindowFromPoint(new Point(x,y)); uint hitPid; GetWindowThreadProcessId(hit,out hitPid);
    if (hitPid != pid || GetAncestor(hit,2) != dialog) throw new Exception("Native click point is not in the owned close dialog");
    if (!SetCursorPos(x,y)) throw new Exception("Native pointer did not reach the Exit control");
    var inputs=new Input[] { new Input { type=0, mouse=new MouseInput { flags=0x0002 } }, new Input { type=0, mouse=new MouseInput { flags=0x0004 } } };
    if (SendInput(2,inputs,Marshal.SizeOf(typeof(Input))) != 2) throw new Exception("Native mouse click was not delivered");
    } finally { if (previousDpi != IntPtr.Zero) SetThreadDpiAwarenessContext(previousDpi); }
  }
  public static void Capture(IntPtr window, int pid, string filename) {
    uint actual; GetWindowThreadProcessId(window, out actual);
    if (actual != pid) throw new Exception("Capture target does not belong to the fixture owner");
    Rect rect; if (!GetWindowRect(window, out rect) || rect.right <= rect.left || rect.bottom <= rect.top) throw new Exception("Window has no visible bounds");
    using (var image = new Bitmap(rect.right-rect.left, rect.bottom-rect.top)) {
      using (var graphics = Graphics.FromImage(image)) {
        IntPtr dc = graphics.GetHdc(); bool captured;
        try { captured = PrintWindow(window, dc, 2); } finally { graphics.ReleaseHdc(dc); }
        if (!captured) throw new Exception("PrintWindow did not capture the owned editor");
      }
      image.Save(filename, ImageFormat.Png);
    }
  }
}
'@
  $guiArguments = @(('--user-data-dir=' + $profile), $task)
  $secondary = Start-Process -FilePath $exe -ArgumentList (($guiArguments | ForEach-Object { Quote-Argument $_ }) -join ' ') `
    -WorkingDirectory $workspace -WindowStyle Hidden -PassThru
  Assert-True ($secondary.WaitForExit(20000) -and $secondary.ExitCode -eq 0) 'Actual packaged second instance did not hand off and exit 0.'
  $uiDeadline = [DateTime]::UtcNow.AddSeconds(30)
  $mainHandle = [IntPtr]::Zero
  while ($mainHandle -eq [IntPtr]::Zero -and [DateTime]::UtcNow -lt $uiDeadline) {
    foreach ($handle in [TeacherPackagedWindow]::VisibleWindows($owner.Id)) {
      if ([TeacherPackagedWindow]::Title($handle) -match '果铃|Courseware|ittoedu') { $mainHandle = $handle; break }
    }
    if ($mainHandle -eq [IntPtr]::Zero) { Start-Sleep -Milliseconds 100 }
  }
  Assert-True ($mainHandle -ne [IntPtr]::Zero) 'Promoted owner did not expose an actual visible editor window.'
  $mainTitle = [TeacherPackagedWindow]::Title($mainHandle)
  $native = [System.Windows.Automation.AutomationElement]::FromHandle($mainHandle)
  Assert-True ($native.Current.ProcessId -eq $owner.Id) 'UI Automation root does not belong to the packaged owner.'
  $guiReady = Connect-Product
  Checkpoint 'gui.connection.identity' @{ mode = $guiReady.mode; ownership = $guiReady.ownership;
    pidMatches = $guiReady.pid -eq $owner.Id; profileMatches = Same-Path $guiReady.profile $profile;
    workspaceMatches = Same-Path $guiReady.workspace $workspace; workspaceMismatch = $guiReady.workspaceMismatch;
    tokenMatches = $guiReady.token -eq $script:Ready.token; endpointMatches = $guiReady.endpoint -eq $script:Ready.endpoint }
  Assert-True ($guiReady.mode -eq 'gui' -and $guiReady.ownership -eq 'attached' -and $guiReady.pid -eq $owner.Id `
    -and -not $guiReady.workspaceMismatch -and (Same-Path $guiReady.profile $profile) -and (Same-Path $guiReady.workspace $workspace) `
    -and $guiReady.token -eq $script:Ready.token -and $guiReady.endpoint -eq $script:Ready.endpoint) 'GUI promotion did not retain the same actual owner and connection.'
  $clientB = Open-Session 'Packaged teacher acceptance B'
  $uiDeadline = [DateTime]::UtcNow.AddSeconds(20)
  do {
    $guiState = Invoke-Tool $clientB 'workbench.state' @{}
    if ($guiState.activeDocument.documentId -eq $documentId) { break }
    Start-Sleep -Milliseconds 200
  } while ([DateTime]::UtcNow -lt $uiDeadline)
  Assert-True ($guiState.activeDocument.documentId -eq $documentId `
    -and @($guiState.documents | Where-Object { $_.documentId -eq $documentId -and -not $_.dirty -and (Same-Path $_.path $task) }).Count -eq 1) 'GUI lost the original document identity or selected another document.'
  $bodySeen = $false
  $uiDeadline = [DateTime]::UtcNow.AddSeconds(30)
  while (-not $bodySeen -and [DateTime]::UtcNow -lt $uiDeadline) {
    $elements = $native.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    foreach ($element in $elements) {
      if ($element.Current.IsOffscreen) { continue }
      $visible = [string]$element.Current.Name
      $pattern = $null
      if ($element.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$pattern)) {
        $visible += ' ' + $pattern.DocumentRange.GetText(10000)
      }
      $pattern = $null
      if ($element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) { $visible += ' ' + $pattern.Current.Value }
      if ($visible.Contains($bodyMarker)) { $bodySeen = $true; break }
    }
    if (-not $bodySeen) { Start-Sleep -Milliseconds 200 }
  }
  $mainPng = Join-Path $run 'owned-main.png'
  [TeacherPackagedWindow]::Capture($mainHandle, $owner.Id, $mainPng)
  Checkpoint 'gui.visible' @{ pid = $owner.Id; title = $mainTitle; bodyMarkerVisible = $bodySeen; screenshot = $mainPng }
  Assert-True ($bodySeen) 'Actual visible editor did not expose the teacher file body; screenshot retained.'
  $facts.gui = $true; $facts.mainWindow = @{ title = $mainTitle; bodyMarkerVisible = $bodySeen; screenshot = $mainPng; documentId = $documentId }
  $deleted = Invoke-WebRequest -UseBasicParsing -Uri $script:Ready.endpoint -Method Delete -Headers $clientA -TimeoutSec 60
  Assert-True ([int]$deleted.StatusCode -eq 204) 'DELETE session A did not return 204.'
  $clientA = $null
  $remaining = (Invoke-ProductRpc $clientB 'tools/list' @{}).Rpc.result.tools
  Assert-True (@($remaining).Count -gt 0 -and -not $owner.HasExited) 'Detach A stopped the owner or session B.'
  $stillOpen = Invoke-Tool $clientB 'workbench.state' @{}
  Assert-True (@($stillOpen.documents | Where-Object { $_.documentId -eq $documentId }).Count -eq 1) 'B could not observe the retained document after A detached.'
  $facts.detach = $true
  Checkpoint 'detach.isolated' @{ http = 204; remainingToolCount = @($remaining).Count; documentId = $documentId; ownerAlive = $true }

  # The original B session remains connected until the actual normal close completes.
  Assert-True ([TeacherPackagedWindow]::PostMessage($mainHandle, 0x0112, [IntPtr]0xF060, [IntPtr]::Zero)) 'Native SC_CLOSE was not posted to the owned window.'
  $dialog = $null
  $uiDeadline = [DateTime]::UtcNow.AddSeconds(20)
  $pidCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $owner.Id)
  $nameCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, '关闭果铃')
  $dialogCondition = New-Object System.Windows.Automation.AndCondition($pidCondition, $nameCondition)
  while (-not $dialog -and [DateTime]::UtcNow -lt $uiDeadline) {
    $dialog = $native.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $dialogCondition)
    if (-not $dialog) { Start-Sleep -Milliseconds 100 }
  }
  Assert-True ($null -ne $dialog) 'Actual owned close dialog was not found; no alternative window or forced exit was used.'
  $exitCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, '退出')
  $exitButton = $dialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $exitCondition)
  Assert-True ($null -ne $exitButton) 'Actual native dialog did not expose its Exit choice.'
  $invoke = $null
  if ($exitButton.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invoke)) {
    $invoke.Invoke()
    $exitCarrier = 'native-uia-invoke'
  } else {
    [TeacherPackagedWindow]::ClickExit([IntPtr]$dialog.Current.NativeWindowHandle, [IntPtr]$exitButton.Current.NativeWindowHandle, $owner.Id)
    $exitCarrier = 'native-mouse-SendInput'
  }
  Checkpoint 'native.exit.invoked' @{ pid = $owner.Id; dialog = '关闭果铃'; choice = '退出'; carrier = $exitCarrier }
  Assert-True ($owner.WaitForExit(30000)) 'Owned editor did not exit within the diagnostic wait after its normal Exit choice; no force was used.'
  Assert-True ($owner.ExitCode -eq 0) 'Owned product did not provide a confirmed natural exit code 0.'
  $facts.naturalExit = $true; $facts.exitCode = $owner.ExitCode
  $facts.status = 'passed'
  Checkpoint 'natural.exit' @{ pid = $owner.Id; exitCode = $owner.ExitCode; forced = $false }
} catch {
  $failure = Safe-Message $_.Exception.Message
  if (Test-Path -LiteralPath $run -PathType Container) {
    Checkpoint 'failed' @{ message = $failure; line = $_.InvocationInfo.ScriptLineNumber }
    Record-Recent
  }
  $facts.status = if ($facts.compute -and $facts.gaps.Count -gt 0) { 'partial' } else { 'failed' }
  $facts.failure = $failure
} finally {
  foreach ($key in $environmentNames) { [Environment]::SetEnvironmentVariable($key, $originalEnvironment[$key], 'Process') }
  Set-Location -LiteralPath $originalLocation
  if ($owner) {
    try { $facts.ownerStillAlive = -not $owner.HasExited } catch { $facts.ownerStillAlive = $null }
  }
  if (Test-Path -LiteralPath $run -PathType Container) {
    # Deliberately omit ready receipts, endpoint credentials, headers, initialize instructions and tool bodies.
    [IO.File]::WriteAllText((Join-Path $run 'facts.json'), ($facts | ConvertTo-Json -Depth 20), $utf8)
  }
}
[Console]::Out.WriteLine(($facts | ConvertTo-Json -Depth 20))
if ($facts.status -eq 'passed') { exit 0 }
if ($facts.status -eq 'partial') { exit 2 }
exit 1
