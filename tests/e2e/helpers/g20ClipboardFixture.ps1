$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
# A test-only STA keeper materializes the original formats before any mutation.
# EOF and every error both restore them. Product code never invokes this script.
$original = [Windows.Forms.Clipboard]::GetDataObject()
$saved = New-Object Windows.Forms.DataObject
$formats = @()
if ($null -ne $original) {
  $formats = @($original.GetFormats($false))
  foreach ($format in $formats) {
    $value = $original.GetData($format, $false)
    if ($null -eq $value) { throw 'Clipboard cannot be preserved; no mutation made' }
    if ($value -is [IO.MemoryStream]) { $value = New-Object IO.MemoryStream(,$value.ToArray()) }
    elseif ($value -is [Drawing.Image]) { $value = $value.Clone() }
    elseif ($value -isnot [string] -and $value -isnot [string[]] -and $value -isnot [byte[]] -and $value -isnot [Collections.Specialized.StringCollection] -and !$value.GetType().IsSerializable) { throw 'Clipboard object cannot be preserved; no mutation made' }
    $saved.SetData($format, $false, $value)
  }
}
try {
  [Console]::WriteLine('{"ready":true}')
  while ($null -ne ($line = [Console]::ReadLine())) {
    $command = ConvertFrom-Json -InputObject $line
    switch ($command.kind) {
      'image' {
        $stream = New-Object IO.MemoryStream(,[Convert]::FromBase64String($command.base64))
        $bitmap = [Drawing.Image]::FromStream($stream)
        try { [Windows.Forms.Clipboard]::SetImage($bitmap) }
        finally { $bitmap.Dispose(); $stream.Dispose() }
      }
      'files' {
        $drop = New-Object Collections.Specialized.StringCollection
        foreach ($file in $command.paths) { [void]$drop.Add($file) }
        [Windows.Forms.Clipboard]::SetFileDropList($drop)
      }
      'text' { [Windows.Forms.Clipboard]::SetText($command.text) }
      default { throw 'Unsupported clipboard fixture command' }
    }
    [Console]::WriteLine('{"set":true}')
  }
} finally {
  if ($formats.Count) {
    [Windows.Forms.Clipboard]::SetDataObject($saved, $true)
    $restored = [Windows.Forms.Clipboard]::GetDataObject()
    foreach ($format in $formats) { if (!$restored.GetDataPresent($format, $false)) { throw 'Original clipboard restoration failed' } }
  } else { [Windows.Forms.Clipboard]::Clear() }
  [Console]::WriteLine('{"restored":true}')
}
