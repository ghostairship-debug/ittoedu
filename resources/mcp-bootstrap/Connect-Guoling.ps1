# Distributed with the Windows product. No Node, repository or client-global config.
# stdout is a one-use local connection receipt; consume it directly,
# never copy it into logs, a course project, or a published artifact.
[CmdletBinding()]
param(
  [string]$TaskPath = (Get-Location).Path,
  [string]$Executable,
  [string]$Profile
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

function Quote-NativeArgument([string]$Value) {
  # Windows CommandLineToArgvW quoting, including a path's trailing backslash.
  $escaped = [regex]::Replace($Value, '(\\*)"', '$1$1\"')
  return '"' + [regex]::Replace($escaped, '(\\+)$', '$1$1') + '"'
}

$handoff = $null
$process = $null
try {
  if (-not $Executable) {
    $name = 'guoling-workbench.exe'
    # The portable/unpacked helper is next to its own product resources.
    $adjacent = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ('../../' + $name)))
    if (Test-Path -LiteralPath $adjacent -PathType Leaf) { $Executable = $adjacent }
    if (-not $Executable) {
      $running = @(Get-Process -Name 'guoling-workbench' -ErrorAction SilentlyContinue |
        ForEach-Object { try { $_.Path } catch {} } | Where-Object { $_ } | Select-Object -Unique)
      if ($running.Count -eq 1) { $Executable = $running[0] }
      elseif ($running.Count -gt 1) { throw 'More than one Guoling installation is running. Select the product executable for this task.' }
    }
    if (-not $Executable) {
      $roots = @([Environment]::GetFolderPath('LocalApplicationData'), [Environment]::GetFolderPath('ProgramFiles'))
      $installed = @($roots | Where-Object { $_ } | ForEach-Object {
        $base = $_
        foreach ($relative in @('Programs/果铃工作台', '果铃工作台')) {
          $candidate = Join-Path (Join-Path $base $relative) $name
          if (Test-Path -LiteralPath $candidate -PathType Leaf) { [IO.Path]::GetFullPath($candidate) }
        }
      } | Select-Object -Unique)
      if ($installed.Count -eq 1) { $Executable = $installed[0] }
      elseif ($installed.Count -gt 1) { throw 'More than one Guoling installation was found. Select the product executable for this task.' }
    }
  }
  if (-not $Executable -or -not (Test-Path -LiteralPath $Executable -PathType Leaf)) {
    throw 'Guoling is not installed here. Use the connector distributed inside the Guoling product resources.'
  }
  $Executable = (Resolve-Path -LiteralPath $Executable).ProviderPath
  $arguments = @('--mcp-connect', ('--task-path=' + $TaskPath))
  if ($Profile) { $arguments += '--user-data-dir=' + $Profile }
  # The NSIS Portable wrapper does not pass its extracted child's stdout back
  # to this process. Use the product's guarded, one-use ready handoff for both
  # Portable and unpacked products, without a second service or resident owner.
  $handoff = Join-Path ([IO.Path]::GetTempPath()) ('guoling-mcp-connect-' + [Guid]::NewGuid().ToString('N'))
  [void][IO.Directory]::CreateDirectory($handoff)
  $readyFile = Join-Path $handoff 'ready.json'
  $arguments += '--mcp-ready-file=' + $readyFile
  $start = New-Object Diagnostics.ProcessStartInfo
  $start.FileName = $Executable
  $start.Arguments = ($arguments | ForEach-Object { Quote-NativeArgument $_ }) -join ' '
  $start.WorkingDirectory = (Get-Location).Path
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $start.StandardOutputEncoding = [Text.UTF8Encoding]::new($false)
  $start.StandardErrorEncoding = [Text.UTF8Encoding]::new($false)
  $start.EnvironmentVariables.Remove('ELECTRON_RUN_AS_NODE')
  $start.EnvironmentVariables['VITE_DEV_SERVER_URL'] = ''
  $process = New-Object Diagnostics.Process
  $process.StartInfo = $start
  [void]$process.Start()
  # Drain diagnostics without treating stdout/EOF or a successful short-lived
  # connector exit as the owner's ready boundary. No raw receipt is logged.
  $stdoutDrain = $process.StandardOutput.ReadToEndAsync()
  $stderrDrain = $process.StandardError.ReadToEndAsync()
  while (-not (Test-Path -LiteralPath $readyFile -PathType Leaf)) {
    $process.Refresh()
    if ($process.HasExited) {
      # The atomic reply may have been published after the loop's first check
      # and before the short-lived connector exited. Consume that exact file.
      if (Test-Path -LiteralPath $readyFile -PathType Leaf) { break }
      throw ('Guoling connection failed (exit ' + $process.ExitCode + '); no owner ready receipt.')
    }
    Start-Sleep -Milliseconds 50
  }
  $readyLine = [IO.File]::ReadAllText($readyFile, [Text.Encoding]::UTF8)
  $output = $readyLine.Trim()
  $lineShape = 'lineChars=' + $readyLine.Length + '; trimmedChars=' + $output.Length +
    '; empty=' + [string]::IsNullOrWhiteSpace($readyLine)
  try { $connection = $output | ConvertFrom-Json }
  catch { throw ('Guoling ready receipt is not JSON. ' + $lineShape) }
  if ($connection.status -eq 'failed') { throw ('Guoling connection failed: ' + [string]$connection.message) }
  if ($connection.status -ne 'ready') {
    $parsedType = if ($null -eq $connection) { 'null' } else { $connection.GetType().FullName }
    $statusShape = if ($connection.status -in @('ready', 'failed')) { $connection.status }
      elseif ($null -eq $connection.status) { 'absent' } else { 'other' }
    # Shape only: never include the raw line, its JSON values, or credentials.
    throw ('Guoling did not return a ready connection. ' + $lineShape +
      '; parsedType=' + $parsedType + '; status=' + $statusShape)
  }
  # Keep actual owner workspace/profile/permission/ownership facts intact.
  [Console]::Out.WriteLine($output)
  exit 0
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
} finally {
  if ($null -ne $process) { $process.Dispose() }
  if ($handoff) {
    # Only this script's exact two handoff files and empty directory are removed.
    Remove-Item -LiteralPath (Join-Path $handoff 'ready.json') -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $handoff 'ready.tmp') -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $handoff -Force -ErrorAction SilentlyContinue
  }
}
