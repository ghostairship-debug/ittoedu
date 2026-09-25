$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$repository = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$helper = Join-Path $repository 'resources/clipboard-file-list/clipboard-file-list.exe'
if (!(Test-Path -LiteralPath $helper)) { throw 'Fixed helper missing' }
# Materialize all currently advertised raw formats BEFORE changing the clipboard.
$original = [Windows.Forms.Clipboard]::GetDataObject()
$saved = New-Object Windows.Forms.DataObject
$formats = @()
if ($null -ne $original) {
  $formats = @($original.GetFormats($false))
  foreach ($format in $formats) {
    $value = $original.GetData($format, $false)
    if ($null -eq $value) { throw 'A clipboard format cannot be preserved; fixture did not overwrite clipboard' }
    if ($value -is [IO.MemoryStream]) { $value = New-Object IO.MemoryStream(,$value.ToArray()) }
    elseif ($value -is [Drawing.Image]) { $value = $value.Clone() }
    elseif ($value -isnot [string] -and $value -isnot [string[]] -and $value -isnot [byte[]] -and $value -isnot [Collections.Specialized.StringCollection] -and !$value.GetType().IsSerializable) { throw 'A clipboard object cannot be preserved; fixture did not overwrite clipboard' }
    $saved.SetData($format, $false, $value)
    if (!$saved.GetDataPresent($format, $false)) { throw 'Clipboard preservation preflight failed' }
  }
}
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('g20-clipboard-' + [Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $fixture | Out-Null
try {
  $first = Join-Path $fixture 'first.md'; $second = Join-Path $fixture 'second.txt'
  [IO.File]::WriteAllText($first, 'first bytes'); [IO.File]::WriteAllText($second, 'second bytes')
  $drop = New-Object Collections.Specialized.StringCollection
  [void]$drop.Add($first); [void]$drop.Add($second)
  [Windows.Forms.Clipboard]::SetFileDropList($drop)
  $result = & $helper
  if ($LASTEXITCODE -ne 0) { throw 'Fixed clipboard reader failed' }
  $paths = ConvertFrom-Json -InputObject ($result -join [Environment]::NewLine)
  if ($paths.Count -ne 2 -or $paths[0] -ne $first -or $paths[1] -ne $second) { Write-Output ('Fixture actual: ' + $result); Write-Output ('Fixture expected: ' + $first + ' | ' + $second); throw 'CF_HDROP two-file list did not match' }
  if ([IO.File]::ReadAllText($first) -ne 'first bytes' -or [IO.File]::ReadAllText($second) -ne 'second bytes') { throw 'Original file changed' }
  Write-Output 'PASS CF_HDROP: 2 ordinary local files, fixed no-argument helper; source files unchanged'
} finally {
  if ($formats.Count) { [Windows.Forms.Clipboard]::SetDataObject($saved, $true); $restored = [Windows.Forms.Clipboard]::GetDataObject(); foreach ($format in $formats) { if (!$restored.GetDataPresent($format, $false)) { throw 'Original clipboard format restoration failed' } } }
  else { [Windows.Forms.Clipboard]::Clear() }
  if (![IO.Path]::GetFullPath($fixture).StartsWith([IO.Path]::GetTempPath(), [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid fixture cleanup root' }
  Remove-Item -LiteralPath $fixture -Recurse -Force
  Write-Output 'PASS original clipboard formats restored'
}
