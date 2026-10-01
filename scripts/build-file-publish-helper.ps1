param([switch]$Check)
$ErrorActionPreference = 'Stop'
$repository = Split-Path $PSScriptRoot -Parent
$source = Join-Path $repository 'resources/file-publish/Program.cs'
$binary = Join-Path $repository 'resources/file-publish/file-publish.exe'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
if (!(Test-Path -LiteralPath $compiler)) { throw 'Windows .NET Framework compiler is required for the fixed file-publish helper' }
if ($Check) {
  if (!(Test-Path -LiteralPath $binary) -or (Get-Item -LiteralPath $binary).LastWriteTimeUtc -lt (Get-Item -LiteralPath $source).LastWriteTimeUtc) { throw 'File-publish helper is missing or stale' }
  return
}
& $compiler /nologo /optimize+ /target:exe /platform:anycpu "/out:$binary" $source
if ($LASTEXITCODE -ne 0) { throw 'File-publish helper compilation failed' }
