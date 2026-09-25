param([switch]$Check)
$ErrorActionPreference = 'Stop'
$repository = Split-Path $PSScriptRoot -Parent
$source = Join-Path $repository 'resources/clipboard-file-list/Program.cs'
$binary = Join-Path $repository 'resources/clipboard-file-list/clipboard-file-list.exe'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
if (!(Test-Path -LiteralPath $compiler)) { throw 'Windows .NET Framework C# compiler is required for the fixed clipboard helper' }
if ($Check) {
  if (!(Test-Path -LiteralPath $binary) -or (Get-Item -LiteralPath $binary).LastWriteTimeUtc -lt (Get-Item -LiteralPath $source).LastWriteTimeUtc) { throw 'Clipboard helper is missing or older than its source; run this script without -Check' }
  return
}
& $compiler /nologo /optimize+ /target:exe /platform:anycpu /reference:System.Web.Extensions.dll "/out:$binary" $source
if ($LASTEXITCODE -ne 0) { throw 'Clipboard helper compilation failed' }
