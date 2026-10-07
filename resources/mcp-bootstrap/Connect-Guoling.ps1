# Distributed with the Windows product. No Node, repository or client-global config.
# stdout is a one-use connection receipt, including its bearer; consume it directly,
# never copy it into logs, a course project, or a published artifact.
[CmdletBinding()]
param(
  [string]$TaskPath = (Get-Location).Path,
  [string]$Executable,
  [string]$Profile
)
$ErrorActionPreference = 'Stop'

function Quote-NativeArgument([string]$Value) {
  # Windows CommandLineToArgvW quoting, including a path's trailing backslash.
  $escaped = [regex]::Replace($Value, '(\\*)"', '$1$1\"')
  return '"' + [regex]::Replace($escaped, '(\\+)$', '$1$1') + '"'
}

try {
  if (-not $Executable) {
    $name = 'ittoedu-courseware-editor.exe'
    # The portable/unpacked helper is next to its own product resources.
    $adjacent = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ('../../' + $name)))
    if (Test-Path -LiteralPath $adjacent -PathType Leaf) { $Executable = $adjacent }
    if (-not $Executable) {
      $running = @(Get-Process -Name 'ittoedu-courseware-editor' -ErrorAction SilentlyContinue |
        ForEach-Object { try { $_.Path } catch {} } | Where-Object { $_ } | Select-Object -Unique)
      if ($running.Count -eq 1) { $Executable = $running[0] }
      elseif ($running.Count -gt 1) { throw 'More than one Guoling installation is running. Select the product executable for this task.' }
    }
    if (-not $Executable) {
      $roots = @([Environment]::GetFolderPath('LocalApplicationData'), [Environment]::GetFolderPath('ProgramFiles'))
      $installed = @($roots | Where-Object { $_ } | ForEach-Object {
        $base = $_
        foreach ($relative in @('Programs/ittoedu Courseware Editor', 'ittoedu Courseware Editor')) {
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
  $start = New-Object Diagnostics.ProcessStartInfo
  $start.FileName = $Executable
  $start.Arguments = ($arguments | ForEach-Object { Quote-NativeArgument $_ }) -join ' '
  $start.WorkingDirectory = (Get-Location).Path
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $start.EnvironmentVariables.Remove('ELECTRON_RUN_AS_NODE')
  $start.EnvironmentVariables['VITE_DEV_SERVER_URL'] = ''
  $process = New-Object Diagnostics.Process
  $process.StartInfo = $start
  [void]$process.Start()
  $stdout = $process.StandardOutput.ReadToEndAsync()
  $stderr = $process.StandardError.ReadToEndAsync()
  $process.WaitForExit()
  $output = $stdout.Result.Trim()
  if ($process.ExitCode -ne 0) { throw ('Guoling connection failed: ' + $stderr.Result.Trim()) }
  $connection = $output | ConvertFrom-Json
  if ($connection.status -ne 'ready') { throw 'Guoling did not return a ready connection.' }
  # Keep actual owner workspace/profile/permission/ownership facts intact.
  [Console]::Out.WriteLine($output)
  exit 0
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
