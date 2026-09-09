[CmdletBinding()]
param(
  [string]$SourceRoot,
  [string]$DestinationRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($SourceRoot)) {
  $SourceRoot = Join-Path $projectRoot '.agents\skills'
}

if ([string]::IsNullOrWhiteSpace($DestinationRoot)) {
  if (-not [string]::IsNullOrWhiteSpace($env:COURSEWARE_SKILLS_DESTINATION)) {
    $DestinationRoot = $env:COURSEWARE_SKILLS_DESTINATION
  } else {
    $userProfile = [Environment]::GetFolderPath('UserProfile')
    if ([string]::IsNullOrWhiteSpace($userProfile)) {
      throw 'Cannot resolve the current user profile for Skill installation.'
    }
    $DestinationRoot = Join-Path $userProfile '.agents\skills'
  }
}

$currentSkillNames = @(
  'orchestrate-courseware',
  'build-courseware-project'
)
$retiredSkillNames = @(
  'build-project-v7-courseware',
  'build-project-v8-courseware'
)
$manifestFileName = '.ittoedu-courseware-editor-managed-skills.json'
$sourceId = 'ittoedu-courseware-editor'

# Canonical tree signatures of repository-managed copies released before the
# manifest recorded installed bytes. They authorize a one-time v1 migration;
# an unknown signature is always treated as user-modified. These constants
# were derived from Git commit 79ee9816cbaaa3a99359e9acf5a28d80487747bd,
# not from a user directory. The canonical payload sorts slash-normalized
# relative paths ordinally, then joins "path<TAB>bytes<TAB>lowercase-file-sha"
# records with LF before applying SHA-256.
$knownLegacyTreeSignatures = @{
  'orchestrate-courseware' = @(
    'b3cd58b6a1956eea58a9806dd5651096caf5dc6ee7e24c7f4ead322c98d70a88'
  )
  'build-project-v7-courseware' = @(
    '975b1127475df849f558d3f9e1b434f5948592c0ccd7fbe97931feb72e3f122d'
  )
}

# Tests use synthetic legacy bytes. The override is deliberately unavailable
# unless the child PowerShell process explicitly identifies itself as a test.
if (
  $env:COURSEWARE_SKILLS_TEST_MODE -eq '1' -and
  -not [string]::IsNullOrWhiteSpace($env:COURSEWARE_SKILLS_TEST_V7_SIGNATURE)
) {
  $knownLegacyTreeSignatures['build-project-v7-courseware'] = @(
    $knownLegacyTreeSignatures['build-project-v7-courseware']
  ) + @($env:COURSEWARE_SKILLS_TEST_V7_SIGNATURE.ToLowerInvariant())
}

function Get-NormalizedPath {
  param([Parameter(Mandatory = $true)][string]$Path)

  $providerPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path)
  $fullPath = [System.IO.Path]::GetFullPath($providerPath)
  $pathRoot = [System.IO.Path]::GetPathRoot($fullPath)
  if ($fullPath.Length -gt $pathRoot.Length) {
    return $fullPath.TrimEnd([System.IO.Path]::DirectorySeparatorChar)
  }
  return $fullPath
}

function Test-PathInside {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Root,
    [switch]$AllowRoot
  )

  $separator = [System.IO.Path]::DirectorySeparatorChar
  if ($Path.Equals($Root, [System.StringComparison]::OrdinalIgnoreCase)) {
    return $AllowRoot.IsPresent
  }
  return $Path.StartsWith($Root + $separator, [System.StringComparison]::OrdinalIgnoreCase)
}

function Assert-PlainDirectory {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Label
  )

  if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
    throw "$Label is not a directory: $Path"
  }
  $item = Get-Item -LiteralPath $Path -Force
  if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "$Label cannot be a linked directory: $Path"
  }
  $linkedChild = Get-ChildItem -LiteralPath $Path -Recurse -Force |
    Where-Object { ($_.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0 } |
    Select-Object -First 1
  if ($null -ne $linkedChild) {
    throw "$Label contains a linked entry: $($linkedChild.FullName)"
  }
}

function Get-StringSha256 {
  param([Parameter(Mandatory = $true)][string]$Value)

  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [System.Text.UTF8Encoding]::new($false).GetBytes($Value)
    return [System.BitConverter]::ToString($sha256.ComputeHash($bytes)).Replace('-', '').ToLowerInvariant()
  } finally {
    $sha256.Dispose()
  }
}

function Get-FileSha256 {
  param([Parameter(Mandatory = $true)][string]$Path)

  $stream = [System.IO.File]::OpenRead($Path)
  try {
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
      return [System.BitConverter]::ToString($sha256.ComputeHash($stream)).Replace('-', '').ToLowerInvariant()
    } finally {
      $sha256.Dispose()
    }
  } finally {
    $stream.Dispose()
  }
}

function Test-TransientSkillTreeEntry {
  param([Parameter(Mandatory = $true)][string]$RelativePath)

  $normalized = $RelativePath.Replace('\', '/')
  $segments = @($normalized.Split('/'))
  if (@($segments | Where-Object { $_ -ceq '__pycache__' }).Count -gt 0) {
    return $true
  }
  return $normalized -cmatch '(?i)\.py[co]$'
}

function Get-CanonicalSkillFiles {
  param([Parameter(Mandatory = $true)][string]$Root, [switch]$IncludeLocalRoot)

  return @(
    Get-ChildItem -LiteralPath $Root -File -Recurse -Force |
      Where-Object {
        $relativePath = $_.FullName.Substring($Root.Length) -replace '^[\\/]+', ''
        ($IncludeLocalRoot -or $relativePath -cne 'editor-root.local.json') -and
          -not (Test-TransientSkillTreeEntry -RelativePath $relativePath)
      }
  )
}

function Copy-CanonicalSkillTree {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Destination
  )

  $sourceRoot = (Resolve-Path -LiteralPath $Source).Path.TrimEnd(
    [System.IO.Path]::DirectorySeparatorChar
  )
  New-Item -ItemType Directory -Path $Destination -Force | Out-Null
  foreach ($file in Get-CanonicalSkillFiles -Root $sourceRoot) {
    $relativePath = $file.FullName.Substring($sourceRoot.Length) -replace '^[\\/]+', ''
    $destinationFile = Join-Path $Destination $relativePath
    $destinationDirectory = Split-Path -Parent $destinationFile
    New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
    Copy-Item -LiteralPath $file.FullName -Destination $destinationFile -Force
  }
}

function Get-DirectoryTreeSignature {
  param([Parameter(Mandatory = $true)][string]$Path, [switch]$IncludeLocalRoot)

  if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
    return $null
  }

  Assert-PlainDirectory -Path $Path -Label 'Skill directory'
  $root = (Resolve-Path -LiteralPath $Path).Path.TrimEnd(
    [System.IO.Path]::DirectorySeparatorChar
  )
  [string[]]$entries = @(
    Get-CanonicalSkillFiles -Root $root -IncludeLocalRoot:$IncludeLocalRoot |
      ForEach-Object {
        $relativePath = $_.FullName.Substring($root.Length) -replace '^[\\/]+', ''
        $relativePath = $relativePath.Replace('\', '/')
        $hash = Get-FileSha256 -Path $_.FullName
        "{0}`t{1}`t{2}" -f $relativePath, $_.Length, $hash
      }
  )
  [System.Array]::Sort($entries, [System.StringComparer]::Ordinal)
  return Get-StringSha256 -Value ([string]::Join("`n", $entries))
}

function Test-ValidTreeSignature {
  param([AllowNull()][object]$Value)

  return $Value -is [string] -and $Value -cmatch '^[0-9a-f]{64}$'
}

function Write-Utf8JsonFile {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][object]$Value
  )

  $json = ($Value | ConvertTo-Json -Depth 12) + [Environment]::NewLine
  [System.IO.File]::WriteAllText(
    $Path,
    $json,
    [System.Text.UTF8Encoding]::new($false)
  )
}

function Get-OptionalProperty {
  param(
    [AllowNull()][object]$InputObject,
    [Parameter(Mandatory = $true)][string]$Name
  )

  if ($null -eq $InputObject) {
    return $null
  }
  $property = $InputObject.PSObject.Properties[$Name]
  if ($null -eq $property) {
    return $null
  }
  return $property.Value
}

function Read-ManagedManifest {
  param([Parameter(Mandatory = $true)][string]$Path)

  $state = [ordered]@{
    exists = $false
    schemaVersion = 0
    v1ManagedNames = @()
    v2ManagedSignatures = @{}
    retiredRecords = @{}
    lastTransactionId = $null
  }
  if (-not (Test-Path -LiteralPath $Path)) {
    return $state
  }
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "Managed Skill manifest path is not a file: $Path"
  }

  try {
    $manifest = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    $manifestSource = Get-OptionalProperty -InputObject $manifest -Name 'source'
    $manifestSchemaVersion = Get-OptionalProperty -InputObject $manifest -Name 'schemaVersion'
    $manifestSkills = Get-OptionalProperty -InputObject $manifest -Name 'skills'
    if ($manifestSource -ne $sourceId) {
      throw 'Unexpected manifest owner.'
    }
    $state.exists = $true
    if ($manifestSchemaVersion -eq 1) {
      if ($null -eq $manifestSkills) {
        throw 'Version 1 manifest skills must be an array.'
      }
      $state.schemaVersion = 1
      $state.v1ManagedNames = @(@($manifestSkills) | ForEach-Object { [string]$_ })
      return $state
    }
    if ($manifestSchemaVersion -ne 2) {
      throw 'Unsupported manifest schema.'
    }
    if ($null -eq $manifestSkills -or $manifestSkills -is [string]) {
      throw 'Version 2 manifest skills must be an object.'
    }
    $state.schemaVersion = 2
    foreach ($property in $manifestSkills.PSObject.Properties) {
      $signature = Get-OptionalProperty -InputObject $property.Value -Name 'installedTreeSignature'
      if (-not (Test-ValidTreeSignature -Value $signature)) {
        throw "Managed Skill $($property.Name) has an invalid installedTreeSignature."
      }
      $state.v2ManagedSignatures[$property.Name] = [string]$signature
    }
    $manifestRetiredSkills = Get-OptionalProperty -InputObject $manifest -Name 'retiredSkills'
    if ($null -ne $manifestRetiredSkills) {
      foreach ($property in $manifestRetiredSkills.PSObject.Properties) {
        $record = $property.Value
        $status = Get-OptionalProperty -InputObject $record -Name 'status'
        $lastManagedTreeSignature = Get-OptionalProperty -InputObject $record -Name 'lastManagedTreeSignature'
        $observedTreeSignature = Get-OptionalProperty -InputObject $record -Name 'observedTreeSignature'
        if ($status -notin @('removed', 'not-present', 'preserved-modified', 'preserved-unmanaged')) {
          throw "Retired Skill $($property.Name) has an invalid status."
        }
        if (
          $null -ne $lastManagedTreeSignature -and
          -not (Test-ValidTreeSignature -Value $lastManagedTreeSignature)
        ) {
          throw "Retired Skill $($property.Name) has an invalid lastManagedTreeSignature."
        }
        if (
          $null -ne $observedTreeSignature -and
          -not (Test-ValidTreeSignature -Value $observedTreeSignature)
        ) {
          throw "Retired Skill $($property.Name) has an invalid observedTreeSignature."
        }
        $state.retiredRecords[$property.Name] = $record
      }
    }
    $lastTransactionId = Get-OptionalProperty -InputObject $manifest -Name 'lastTransactionId'
    if ($null -ne $lastTransactionId) {
      $transactionId = [string]$lastTransactionId
      if ($transactionId -cnotmatch '^[0-9a-f]{32}$') {
        throw 'Manifest lastTransactionId is invalid.'
      }
      $state.lastTransactionId = $transactionId
    }
    return $state
  } catch {
    throw "Managed Skill manifest is invalid; inspect it before retrying: $Path. $($_.Exception.Message)"
  }
}

function Test-KnownLegacySignature {
  param(
    [Parameter(Mandatory = $true)][string]$SkillName,
    [Parameter(Mandatory = $true)][string]$Signature
  )

  if (-not $knownLegacyTreeSignatures.ContainsKey($SkillName)) {
    return $false
  }
  return @($knownLegacyTreeSignatures[$SkillName]) -ccontains $Signature
}

function Assert-TransactionOperationPaths {
  param(
    [Parameter(Mandatory = $true)][object]$Operation,
    [Parameter(Mandatory = $true)][string]$Destination,
    [Parameter(Mandatory = $true)][string]$TransactionRoot
  )

  $allowedNames = @($currentSkillNames) + @($retiredSkillNames)
  if ($allowedNames -notcontains [string]$Operation.name) {
    throw "Transaction contains an unexpected Skill name: $($Operation.name)"
  }
  $targetPath = Get-NormalizedPath -Path ([string]$Operation.targetPath)
  $expectedTarget = Get-NormalizedPath -Path (Join-Path $Destination ([string]$Operation.name))
  if (-not $targetPath.Equals($expectedTarget, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Transaction target is outside its exact Skill path: $targetPath"
  }
  foreach ($propertyName in @('stagedPath', 'backupPath')) {
    $value = $Operation.$propertyName
    if ([string]::IsNullOrWhiteSpace([string]$value)) {
      continue
    }
    $normalized = Get-NormalizedPath -Path ([string]$value)
    if (-not (Test-PathInside -Path $normalized -Root $TransactionRoot)) {
      throw "Transaction $propertyName escapes the installer transaction root: $normalized"
    }
  }
}

function Assert-ValidTransactionJournal {
  param(
    [Parameter(Mandatory = $true)][object]$Journal,
    [Parameter(Mandatory = $true)][string]$Destination,
    [Parameter(Mandatory = $true)][string]$TransactionRoot
  )

  $operationRoot = Get-NormalizedPath -Path ([string]$Journal.operationRoot)
  if (-not (Test-PathInside -Path $operationRoot -Root $TransactionRoot)) {
    throw "Transaction operation root escapes the installer transaction root: $operationRoot"
  }
  $manifestBackupPath = Get-NormalizedPath -Path ([string]$Journal.manifestBackupPath)
  if (-not (Test-PathInside -Path $manifestBackupPath -Root $operationRoot)) {
    throw "Transaction manifest backup escapes its operation root: $manifestBackupPath"
  }

  $seenNames = @{}
  foreach ($operation in @($Journal.operations)) {
    Assert-TransactionOperationPaths -Operation $operation -Destination $Destination -TransactionRoot $TransactionRoot
    $name = [string]$operation.name
    if ($seenNames.ContainsKey($name)) {
      throw "Transaction contains duplicate Skill operations: $name"
    }
    $seenNames[$name] = $true
    $kind = [string]$operation.kind
    $oldSignature = Get-OptionalProperty -InputObject $operation -Name 'expectedOldSignature'
    $newSignature = Get-OptionalProperty -InputObject $operation -Name 'expectedNewSignature'
    if ($kind -eq 'install') {
      if (-not (Test-ValidTreeSignature -Value $newSignature)) {
        throw "Install transaction has an invalid new tree signature: $name"
      }
      if ([bool]$operation.hadTarget -and -not (Test-ValidTreeSignature -Value $oldSignature)) {
        throw "Install transaction has an invalid old tree signature: $name"
      }
    } elseif ($kind -eq 'retire') {
      if ($retiredSkillNames -notcontains $name -or -not (Test-ValidTreeSignature -Value $oldSignature)) {
        throw "Retire transaction has an invalid Skill or tree signature: $name"
      }
    } else {
      throw "Transaction contains an unexpected operation kind: $kind"
    }
  }
}

function Remove-VerifiedDirectory {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$AllowedRoot,
    [AllowNull()][string]$ExpectedSignature
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }
  $normalized = Get-NormalizedPath -Path $Path
  if (-not (Test-PathInside -Path $normalized -Root $AllowedRoot)) {
    throw "Refusing to remove installer data outside its exact root: $normalized"
  }
  if (-not (Test-Path -LiteralPath $normalized -PathType Container)) {
    throw "Installer directory path is not a directory: $normalized"
  }
  if (-not [string]::IsNullOrWhiteSpace($ExpectedSignature)) {
    $actual = Get-DirectoryTreeSignature -Path $normalized
    if ($actual -cne $ExpectedSignature) {
      throw "Refusing to remove installer directory whose bytes changed: $normalized"
    }
  } else {
    Assert-PlainDirectory -Path $normalized -Label 'Installer directory'
  }
  Remove-Item -LiteralPath $normalized -Recurse -Force
}

function Get-ManifestTransactionId {
  param([Parameter(Mandatory = $true)][string]$Path)

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    return $null
  }
  try {
    $value = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    $schemaVersion = Get-OptionalProperty -InputObject $value -Name 'schemaVersion'
    $manifestSource = Get-OptionalProperty -InputObject $value -Name 'source'
    $transactionId = Get-OptionalProperty -InputObject $value -Name 'lastTransactionId'
    if (
      $schemaVersion -eq 2 -and
      $manifestSource -eq $sourceId -and
      $transactionId -is [string]
    ) {
      return [string]$transactionId
    }
  } catch {
    return $null
  }
  return $null
}

function Complete-TransactionCleanup {
  param(
    [Parameter(Mandatory = $true)][object]$Journal,
    [Parameter(Mandatory = $true)][string]$JournalPath,
    [Parameter(Mandatory = $true)][string]$Destination,
    [Parameter(Mandatory = $true)][string]$TransactionRoot
  )

  foreach ($operation in @($Journal.operations)) {
    Assert-TransactionOperationPaths -Operation $operation -Destination $Destination -TransactionRoot $TransactionRoot
    if (Test-Path -LiteralPath ([string]$operation.stagedPath)) {
      Remove-VerifiedDirectory -Path ([string]$operation.stagedPath) -AllowedRoot $TransactionRoot -ExpectedSignature ([string]$operation.expectedNewSignature)
    }
    if (Test-Path -LiteralPath ([string]$operation.backupPath)) {
      Remove-VerifiedDirectory -Path ([string]$operation.backupPath) -AllowedRoot $TransactionRoot -ExpectedSignature ([string]$operation.expectedOldSignature)
    }
  }
  if (
    $null -ne $Journal.manifestBackupPath -and
    (Test-Path -LiteralPath ([string]$Journal.manifestBackupPath))
  ) {
    $manifestBackup = Get-NormalizedPath -Path ([string]$Journal.manifestBackupPath)
    if (-not (Test-PathInside -Path $manifestBackup -Root $TransactionRoot)) {
      throw "Manifest backup escapes the installer transaction root: $manifestBackup"
    }
    Remove-Item -LiteralPath $manifestBackup -Force
  }
  $operationRoot = Get-NormalizedPath -Path ([string]$Journal.operationRoot)
  if (Test-Path -LiteralPath $operationRoot) {
    Remove-VerifiedDirectory -Path $operationRoot -AllowedRoot $TransactionRoot -ExpectedSignature $null
  }
  if (Test-Path -LiteralPath $JournalPath) {
    Remove-Item -LiteralPath $JournalPath -Force
  }
}

function Undo-PendingTransaction {
  param(
    [Parameter(Mandatory = $true)][object]$Journal,
    [Parameter(Mandatory = $true)][string]$JournalPath,
    [Parameter(Mandatory = $true)][string]$Destination,
    [Parameter(Mandatory = $true)][string]$TransactionRoot
  )

  $operations = @($Journal.operations)
  [array]::Reverse($operations)
  foreach ($operation in $operations) {
    Assert-TransactionOperationPaths -Operation $operation -Destination $Destination -TransactionRoot $TransactionRoot
    $targetPath = [string]$operation.targetPath
    $backupPath = [string]$operation.backupPath
    $stagedPath = [string]$operation.stagedPath
    $expectedOld = [string]$operation.expectedOldSignature
    $expectedNew = [string]$operation.expectedNewSignature

    if ([string]$operation.kind -eq 'install') {
      if (Test-Path -LiteralPath $backupPath) {
        if (Test-Path -LiteralPath $targetPath) {
          Remove-VerifiedDirectory -Path $targetPath -AllowedRoot $Destination -ExpectedSignature $expectedNew
        }
        Move-Item -LiteralPath $backupPath -Destination $targetPath
      } elseif ([bool]$operation.hadTarget) {
        if (-not (Test-Path -LiteralPath $targetPath -PathType Container)) {
          throw "Cannot recover missing original Skill directory: $targetPath"
        }
        $current = Get-DirectoryTreeSignature -Path $targetPath
        if ($current -cne $expectedOld) {
          throw "Original Skill changed while recovering: $targetPath"
        }
      } elseif (Test-Path -LiteralPath $targetPath) {
        Remove-VerifiedDirectory -Path $targetPath -AllowedRoot $Destination -ExpectedSignature $expectedNew
      }
    } elseif ([string]$operation.kind -eq 'retire') {
      if (Test-Path -LiteralPath $backupPath) {
        if (Test-Path -LiteralPath $targetPath) {
          throw "Cannot restore retired Skill because its target reappeared: $targetPath"
        }
        Move-Item -LiteralPath $backupPath -Destination $targetPath
      } elseif (-not (Test-Path -LiteralPath $targetPath -PathType Container)) {
        throw "Cannot recover missing retired Skill directory: $targetPath"
      } elseif ((Get-DirectoryTreeSignature -Path $targetPath) -cne $expectedOld) {
        throw "Retired Skill changed while recovering: $targetPath"
      }
    } else {
      throw "Unknown transaction operation kind: $($operation.kind)"
    }

    if (Test-Path -LiteralPath $stagedPath) {
      Remove-VerifiedDirectory -Path $stagedPath -AllowedRoot $TransactionRoot -ExpectedSignature $expectedNew
    }
  }

  $operationRoot = Get-NormalizedPath -Path ([string]$Journal.operationRoot)
  if (Test-Path -LiteralPath $operationRoot) {
    Remove-VerifiedDirectory -Path $operationRoot -AllowedRoot $TransactionRoot -ExpectedSignature $null
  }
  if (Test-Path -LiteralPath $JournalPath) {
    Remove-Item -LiteralPath $JournalPath -Force
  }
}

function Recover-PendingTransaction {
  param(
    [Parameter(Mandatory = $true)][string]$JournalPath,
    [Parameter(Mandatory = $true)][string]$ManifestPath,
    [Parameter(Mandatory = $true)][string]$Destination,
    [Parameter(Mandatory = $true)][string]$TransactionRoot
  )

  if (-not (Test-Path -LiteralPath $JournalPath)) {
    return
  }
  if (-not (Test-Path -LiteralPath $JournalPath -PathType Leaf)) {
    throw "Installer transaction journal is not a file: $JournalPath"
  }
  try {
    $journal = Get-Content -LiteralPath $JournalPath -Raw | ConvertFrom-Json
  } catch {
    throw "Installer transaction journal is invalid; inspect it before retrying: $JournalPath"
  }
  if (
    $journal.schemaVersion -ne 1 -or
    $journal.source -ne $sourceId -or
    -not ([string]$journal.destinationRoot).Equals(
      $Destination,
      [System.StringComparison]::OrdinalIgnoreCase
    ) -or
    [string]$journal.operationId -cnotmatch '^[0-9a-f]{32}$'
  ) {
    throw "Installer transaction journal has an unexpected owner or destination: $JournalPath"
  }
  Assert-ValidTransactionJournal -Journal $journal -Destination $Destination -TransactionRoot $TransactionRoot

  if ((Get-ManifestTransactionId -Path $ManifestPath) -ceq [string]$journal.operationId) {
    Complete-TransactionCleanup -Journal $journal -JournalPath $JournalPath -Destination $Destination -TransactionRoot $TransactionRoot
    Write-Output '[Courseware Skills] Recovered a committed installer transaction.'
    return
  }

  Undo-PendingTransaction -Journal $journal -JournalPath $JournalPath -Destination $Destination -TransactionRoot $TransactionRoot
  Write-Output '[Courseware Skills] Rolled back an interrupted installer transaction.'
}

$sourceRootPath = Get-NormalizedPath -Path $SourceRoot
$destinationRootPath = Get-NormalizedPath -Path $DestinationRoot
$separator = [System.IO.Path]::DirectorySeparatorChar

if (-not (Test-Path -LiteralPath $sourceRootPath -PathType Container)) {
  throw "Repository Skill directory not found: $sourceRootPath"
}
Assert-PlainDirectory -Path $sourceRootPath -Label 'Repository Skill directory'

if ($destinationRootPath -eq [System.IO.Path]::GetPathRoot($destinationRootPath)) {
  throw 'The user Skill destination cannot be a drive root.'
}
if (
  $destinationRootPath.Equals($sourceRootPath, [System.StringComparison]::OrdinalIgnoreCase) -or
  $destinationRootPath.StartsWith($sourceRootPath + $separator, [System.StringComparison]::OrdinalIgnoreCase) -or
  $sourceRootPath.StartsWith($destinationRootPath + $separator, [System.StringComparison]::OrdinalIgnoreCase)
) {
  throw 'Repository and user Skill directories cannot contain one another.'
}

New-Item -ItemType Directory -Path $destinationRootPath -Force | Out-Null
Assert-PlainDirectory -Path $destinationRootPath -Label 'User Skill destination'

$destinationParent = Split-Path -Parent $destinationRootPath
$destinationKey = (Get-StringSha256 -Value $destinationRootPath.ToLowerInvariant()).Substring(0, 16)
$transactionRoot = Get-NormalizedPath -Path (
  Join-Path $destinationParent ".ittoedu-courseware-editor-skill-transaction-$destinationKey"
)
if (Test-PathInside -Path $transactionRoot -Root $destinationRootPath -AllowRoot) {
  throw 'Installer transaction data cannot be stored in the Skill discovery root.'
}
New-Item -ItemType Directory -Path $transactionRoot -Force | Out-Null
Assert-PlainDirectory -Path $transactionRoot -Label 'Installer transaction root'

$lockPath = Join-Path $transactionRoot 'installer.lock'
$lockStream = $null
try {
  try {
    $lockStream = [System.IO.File]::Open(
      $lockPath,
      [System.IO.FileMode]::OpenOrCreate,
      [System.IO.FileAccess]::ReadWrite,
      [System.IO.FileShare]::None
    )
  } catch {
    throw "Another Courseware Skill installer is already using: $destinationRootPath"
  }

  $manifestPath = Join-Path $destinationRootPath $manifestFileName
  $journalPath = Join-Path $transactionRoot 'journal.json'
  Recover-PendingTransaction -JournalPath $journalPath -ManifestPath $manifestPath -Destination $destinationRootPath -TransactionRoot $transactionRoot

  $manifestState = Read-ManagedManifest -Path $manifestPath
  $sourceSignatures = @{}
  foreach ($skillName in $currentSkillNames) {
    $sourceSkillPath = Join-Path $sourceRootPath $skillName
    $sourceSkillEntry = Join-Path $sourceSkillPath 'SKILL.md'
    if (-not (Test-Path -LiteralPath $sourceSkillEntry -PathType Leaf)) {
      throw "Skill source is incomplete: $sourceSkillEntry"
    }
    Assert-PlainDirectory -Path $sourceSkillPath -Label 'Skill source'
    $sourceSignatures[$skillName] = Get-DirectoryTreeSignature -Path $sourceSkillPath
  }

  $installPlans = @()
  $desiredManaged = [ordered]@{}
  $installed = @()
  $unchanged = @()
  $preserved = @()

  foreach ($skillName in $currentSkillNames) {
    $sourceSkillPath = Join-Path $sourceRootPath $skillName
    $sourceSignature = [string]$sourceSignatures[$skillName]
    $targetSkillPath = Join-Path $destinationRootPath $skillName
    $targetExists = Test-Path -LiteralPath $targetSkillPath
    $v2Managed = $manifestState.v2ManagedSignatures.ContainsKey($skillName)
    $v1Managed = @($manifestState.v1ManagedNames) -contains $skillName

    if (-not $targetExists) {
      $installPlans += [pscustomobject]@{
        kind = 'install'
        name = $skillName
        sourcePath = $sourceSkillPath
        targetPath = $targetSkillPath
        hadTarget = $false
        expectedOldSignature = $null
        expectedNewSignature = $sourceSignature
      }
      $desiredManaged[$skillName] = $sourceSignature
      continue
    }

    if (-not (Test-Path -LiteralPath $targetSkillPath -PathType Container)) {
      throw "Skill destination is not a directory: $targetSkillPath"
    }
    Assert-PlainDirectory -Path $targetSkillPath -Label 'Skill destination'
    $targetSignature = Get-DirectoryTreeSignature -Path $targetSkillPath

    $safeManagedCopy = $false
    if ($v2Managed) {
      $safeManagedCopy = $targetSignature -ceq [string]$manifestState.v2ManagedSignatures[$skillName]
      if (-not $safeManagedCopy) {
        # Migrate a previously managed signature that included the local root stamp.
        $safeManagedCopy = (Get-DirectoryTreeSignature -Path $targetSkillPath -IncludeLocalRoot) -ceq [string]$manifestState.v2ManagedSignatures[$skillName]
      }
    } elseif ($v1Managed) {
      $safeManagedCopy = (
        $targetSignature -ceq $sourceSignature -or
        (Test-KnownLegacySignature -SkillName $skillName -Signature $targetSignature)
      )
    }

    if (-not $safeManagedCopy) {
      if ($v1Managed -or $v2Managed) {
        $preserved += "$skillName (modified managed copy)"
        continue
      }
      if ($targetSignature -ceq $sourceSignature) {
        $desiredManaged[$skillName] = $sourceSignature
        $unchanged += $skillName
        continue
      }
      $preserved += "$skillName (unmanaged same-name copy)"
      continue
    }

    $desiredManaged[$skillName] = $sourceSignature
    if ($targetSignature -ceq $sourceSignature) {
      $unchanged += $skillName
      continue
    }
    $installPlans += [pscustomobject]@{
      kind = 'install'
      name = $skillName
      sourcePath = $sourceSkillPath
      targetPath = $targetSkillPath
      hadTarget = $true
      expectedOldSignature = $targetSignature
      expectedNewSignature = $sourceSignature
    }
  }

  $retirePlans = @()
  $retiredRemovedNames = @()
  $retiredJson = [ordered]@{}

  foreach ($retiredSkillName in $retiredSkillNames) {
    $retiredTargetPath = Join-Path $destinationRootPath $retiredSkillName
    $retiredRecord = [ordered]@{}
    $existingRetiredRecord = if ($manifestState.retiredRecords.ContainsKey($retiredSkillName)) {
      $manifestState.retiredRecords[$retiredSkillName]
    } else {
      $null
    }
    $existingRetiredStatus = Get-OptionalProperty -InputObject $existingRetiredRecord -Name 'status'
    $existingRetiredLastSignature = Get-OptionalProperty -InputObject $existingRetiredRecord -Name 'lastManagedTreeSignature'
    $v2RetiredInstalledSignature = if ($manifestState.v2ManagedSignatures.ContainsKey($retiredSkillName)) {
      [string]$manifestState.v2ManagedSignatures[$retiredSkillName]
    } elseif (
      $null -ne $existingRetiredRecord -and
      $null -ne $existingRetiredLastSignature
    ) {
      [string]$existingRetiredLastSignature
    } else {
      $null
    }
    $v1RetiredManaged = @($manifestState.v1ManagedNames) -contains $retiredSkillName

    if (Test-Path -LiteralPath $retiredTargetPath) {
      if (-not (Test-Path -LiteralPath $retiredTargetPath -PathType Container)) {
        throw "Retired Skill destination is not a directory: $retiredTargetPath"
      }
      Assert-PlainDirectory -Path $retiredTargetPath -Label 'Retired Skill destination'
      $retiredTargetSignature = Get-DirectoryTreeSignature -Path $retiredTargetPath
      $retireAllowed = (
        (-not [string]::IsNullOrWhiteSpace($v2RetiredInstalledSignature) -and
          $retiredTargetSignature -ceq $v2RetiredInstalledSignature) -or
        ($v1RetiredManaged -and
          (Test-KnownLegacySignature -SkillName $retiredSkillName -Signature $retiredTargetSignature))
      )
      if ($retireAllowed) {
        $retirePlans += [pscustomobject]@{
          kind = 'retire'
          name = $retiredSkillName
          sourcePath = $null
          targetPath = $retiredTargetPath
          hadTarget = $true
          expectedOldSignature = $retiredTargetSignature
          expectedNewSignature = $null
        }
        $retiredRecord.status = 'removed'
        $retiredRecord.lastManagedTreeSignature = $retiredTargetSignature
        $retiredRemovedNames += $retiredSkillName
      } else {
        $retiredRecord.status = if ($v1RetiredManaged -or -not [string]::IsNullOrWhiteSpace($v2RetiredInstalledSignature)) {
          'preserved-modified'
        } else {
          'preserved-unmanaged'
        }
        $retiredRecord.observedTreeSignature = $retiredTargetSignature
        if (-not [string]::IsNullOrWhiteSpace($v2RetiredInstalledSignature)) {
          $retiredRecord.lastManagedTreeSignature = $v2RetiredInstalledSignature
        }
        $preserved += "$retiredSkillName ($($retiredRecord.status))"
      }
    } elseif ($null -ne $existingRetiredRecord -and $existingRetiredStatus -eq 'removed') {
      $retiredRecord.status = 'removed'
      if ($null -ne $existingRetiredLastSignature) {
        $retiredRecord.lastManagedTreeSignature = [string]$existingRetiredLastSignature
      }
    } else {
      $retiredRecord.status = 'not-present'
      if (-not [string]::IsNullOrWhiteSpace($v2RetiredInstalledSignature)) {
        $retiredRecord.lastManagedTreeSignature = $v2RetiredInstalledSignature
      }
    }

    $retiredJson[$retiredSkillName] = $retiredRecord
  }

  $skillsJson = [ordered]@{}
  foreach ($skillName in $currentSkillNames) {
    if ($desiredManaged.Contains($skillName)) {
      $skillsJson[$skillName] = [ordered]@{
        installedTreeSignature = [string]$desiredManaged[$skillName]
      }
    }
  }
  $manifestCore = [ordered]@{
    schemaVersion = 2
    source = $sourceId
    skills = $skillsJson
    retiredSkills = $retiredJson
  }
  $manifestCoreJson = $manifestCore | ConvertTo-Json -Depth 12

  $existingCoreJson = $null
  if ($manifestState.schemaVersion -eq 2) {
    $existingSkills = [ordered]@{}
    foreach ($skillName in $currentSkillNames) {
      if ($manifestState.v2ManagedSignatures.ContainsKey($skillName)) {
        $existingSkills[$skillName] = [ordered]@{
          installedTreeSignature = [string]$manifestState.v2ManagedSignatures[$skillName]
        }
      }
    }
    $existingRetired = [ordered]@{}
    foreach ($retiredSkillName in $retiredSkillNames) {
      if (-not $manifestState.retiredRecords.ContainsKey($retiredSkillName)) {
        continue
      }
      $record = $manifestState.retiredRecords[$retiredSkillName]
      $recordStatus = Get-OptionalProperty -InputObject $record -Name 'status'
      $recordObservedSignature = Get-OptionalProperty -InputObject $record -Name 'observedTreeSignature'
      $recordLastSignature = Get-OptionalProperty -InputObject $record -Name 'lastManagedTreeSignature'
      $copy = [ordered]@{ status = [string]$recordStatus }
      if ($null -ne $recordObservedSignature) {
        $copy.observedTreeSignature = [string]$recordObservedSignature
      }
      if ($null -ne $recordLastSignature) {
        $copy.lastManagedTreeSignature = [string]$recordLastSignature
      }
      $existingRetired[$retiredSkillName] = $copy
    }
    $existingCoreJson = ([ordered]@{
      schemaVersion = 2
      source = $sourceId
      skills = $existingSkills
      retiredSkills = $existingRetired
    }) | ConvertTo-Json -Depth 12
  }

  $needsManifestWrite = $manifestCoreJson -cne $existingCoreJson
  $directoryPlans = @($installPlans)
  if ($retirePlans.Count -gt 0) {
    $directoryPlans += $retirePlans
  }

  if ($directoryPlans.Count -gt 0 -or $needsManifestWrite) {
    $operationId = [Guid]::NewGuid().ToString('N')
    $operationRoot = Join-Path $transactionRoot $operationId
    $stageRoot = Join-Path $operationRoot 'stage'
    $backupRoot = Join-Path $operationRoot 'backup'
    New-Item -ItemType Directory -Path $stageRoot -Force | Out-Null
    New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null

    $journalOperations = @()
    try {
      foreach ($plan in $directoryPlans) {
        $stagedPath = Join-Path $stageRoot $plan.name
        $backupPath = Join-Path $backupRoot $plan.name
        if ($plan.kind -eq 'install') {
          Copy-CanonicalSkillTree -Source $plan.sourcePath -Destination $stagedPath
          if ($plan.hadTarget) {
            $localRootFile = Join-Path $plan.targetPath 'editor-root.local.json'
            if (Test-Path -LiteralPath $localRootFile -PathType Leaf) {
              Copy-Item -LiteralPath $localRootFile -Destination (Join-Path $stagedPath 'editor-root.local.json')
            }
          }
          if ((Get-DirectoryTreeSignature -Path $stagedPath) -cne $plan.expectedNewSignature) {
            throw "Staged Skill verification failed: $($plan.name)"
          }
        }
        $journalOperations += [ordered]@{
          kind = $plan.kind
          name = $plan.name
          targetPath = $plan.targetPath
          stagedPath = $stagedPath
          backupPath = $backupPath
          hadTarget = [bool]$plan.hadTarget
          expectedOldSignature = $plan.expectedOldSignature
          expectedNewSignature = $plan.expectedNewSignature
        }
      }

      $manifestBackupPath = Join-Path $operationRoot 'manifest.previous.json'
      $journal = [ordered]@{
        schemaVersion = 1
        source = $sourceId
        operationId = $operationId
        destinationRoot = $destinationRootPath
        operationRoot = $operationRoot
        manifestBackupPath = $manifestBackupPath
        operations = $journalOperations
      }
      Write-Utf8JsonFile -Path $journalPath -Value $journal

      $leaveInterruptedTransaction = $false
      try {
        foreach ($operation in $journalOperations) {
          if ($operation.kind -eq 'install') {
            if (Test-Path -LiteralPath $operation.targetPath) {
              Move-Item -LiteralPath $operation.targetPath -Destination $operation.backupPath
            }
            Move-Item -LiteralPath $operation.stagedPath -Destination $operation.targetPath
            $installed += [string]$operation.name
          } elseif ($operation.kind -eq 'retire') {
            Move-Item -LiteralPath $operation.targetPath -Destination $operation.backupPath
          }
        }

        if (
          $env:COURSEWARE_SKILLS_TEST_MODE -eq '1' -and
          $env:COURSEWARE_SKILLS_TEST_INTERRUPT_AFTER_DIRECTORIES -eq '1'
        ) {
          $leaveInterruptedTransaction = $true
          throw 'Simulated installer interruption after directory commit.'
        }

        $manifest = [ordered]@{}
        foreach ($property in $manifestCore.GetEnumerator()) {
          $manifest[$property.Key] = $property.Value
        }
        $manifest.lastTransactionId = $operationId
        $manifestTempPath = Join-Path $operationRoot 'manifest.next.json'
        Write-Utf8JsonFile -Path $manifestTempPath -Value $manifest
        if (Test-Path -LiteralPath $manifestPath) {
          [System.IO.File]::Replace(
            $manifestTempPath,
            $manifestPath,
            $manifestBackupPath,
            $true
          )
        } else {
          [System.IO.File]::Move($manifestTempPath, $manifestPath)
        }

        Complete-TransactionCleanup -Journal ([pscustomobject]$journal) -JournalPath $journalPath -Destination $destinationRootPath -TransactionRoot $transactionRoot
      } catch {
        if (-not $leaveInterruptedTransaction) {
          Recover-PendingTransaction -JournalPath $journalPath -ManifestPath $manifestPath -Destination $destinationRootPath -TransactionRoot $transactionRoot
        }
        throw
      }
    } catch {
      if (-not (Test-Path -LiteralPath $journalPath) -and (Test-Path -LiteralPath $operationRoot)) {
        Remove-VerifiedDirectory -Path $operationRoot -AllowedRoot $transactionRoot -ExpectedSignature $null
      }
      throw
    }
  }

  if ($installed.Count -gt 0) {
    Write-Output ('[Courseware Skills] Installed/updated: ' + ($installed -join ', '))
  }
  if ($unchanged.Count -gt 0) {
    Write-Output ('[Courseware Skills] Already current: ' + ($unchanged -join ', '))
  }
  if ($retiredRemovedNames.Count -gt 0) {
    Write-Output ('[Courseware Skills] Retired managed legacy Skill: ' + ($retiredRemovedNames -join ', '))
  }
  if ($preserved.Count -gt 0) {
    Write-Output ('[Courseware Skills] Preserved for manual review: ' + ($preserved -join ', '))
  }
  Write-Output ("[Courseware Skills] User scope: $destinationRootPath")
} finally {
  if ($null -ne $lockStream) {
    $lockStream.Dispose()
  }
}
