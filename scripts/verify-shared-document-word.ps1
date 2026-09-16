param([string]$FixtureDirectory = 'output/r19-shared-document')
$ErrorActionPreference = 'Stop'
$fixtureRoot = (Resolve-Path -LiteralPath $FixtureDirectory).Path
$sourcePath = Join-Path $fixtureRoot 'math-acceptance.docx'
$editedPath = Join-Path $fixtureRoot 'math-word-edited.docx'
$wordApp = New-Object -ComObject Word.Application
$wordDoc = $null
function Normalize-MathText([string]$Value) { return $Value.Normalize([Text.NormalizationForm]::FormKC).Replace("`r", '') }
$checks = @(
    @{ Name='fraction exponent'; Expected='2'; New='3'; Get={ param($doc) $doc.OMaths.Item(1).Functions.Item(1).Frac.Den.Functions.Item(1).ScrSup.Sup.Range } },
    @{ Name='root degree'; Expected='3'; New='4'; Get={ param($doc) $doc.OMaths.Item(2).Functions.Item(3).Rad.Deg.Range } },
    @{ Name='superscript'; Expected='2'; New='4'; Get={ param($doc) $doc.OMaths.Item(3).Functions.Item(1).ScrSup.Sup.Range } },
    @{ Name='subscript'; Expected='i'; New='j'; Get={ param($doc) $doc.OMaths.Item(3).Functions.Item(3).ScrSub.Sub.Range } },
    @{ Name='combined subscript'; Expected='i'; New='k'; Get={ param($doc) $doc.OMaths.Item(3).Functions.Item(5).ScrSubSup.Sub.Range } },
    @{ Name='combined superscript'; Expected='n+1'; New='n+2'; Get={ param($doc) $doc.OMaths.Item(3).Functions.Item(5).ScrSubSup.Sup.Range } },
    @{ Name='sum upper limit'; Expected='n'; New='5'; Get={ param($doc) $doc.OMaths.Item(5).Functions.Item(1).Nary.Sup.Range } },
    @{ Name='sum operand'; Expected='2'; New='3'; Get={ param($doc) $doc.OMaths.Item(5).Functions.Item(1).Nary.E.Functions.Item(1).ScrSup.Sup.Range } },
    @{ Name='product upper limit'; Expected='n'; New='6'; Get={ param($doc) $doc.OMaths.Item(6).Functions.Item(1).Nary.Sup.Range } },
    @{ Name='product operand'; Expected='i'; New='j'; Get={ param($doc) $doc.OMaths.Item(6).Functions.Item(1).Nary.E.Functions.Item(1).ScrSub.Sub.Range } },
    @{ Name='integral upper limit'; Expected='1'; New='2'; Get={ param($doc) $doc.OMaths.Item(7).Functions.Item(1).Nary.Sup.Range } },
    @{ Name='integrand exponent'; Expected='2'; New='3'; Get={ param($doc) $doc.OMaths.Item(7).Functions.Item(1).Nary.E.Functions.Item(1).ScrSup.Sup.Range } },
    @{ Name='aligned denominator'; Expected='R'; New='r'; Get={ param($doc) $doc.OMaths.Item(8).Functions.Item(1).EqArray.E.Item(2).Functions.Item(2).Frac.Den.Range } },
    @{ Name='cases exponent'; Expected='2'; New='3'; Get={ param($doc) $doc.OMaths.Item(9).Functions.Item(2).Delim.E.Item(1).Functions.Item(1).Mat.Cell(1,1).Functions.Item(1).ScrSup.Sup.Range } },
    @{ Name='matrix denominator'; Expected='2'; New='4'; Get={ param($doc) $doc.OMaths.Item(10).Functions.Item(1).Delim.E.Item(1).Functions.Item(1).Mat.Cell(1,2).Functions.Item(1).Frac.Den.Range } }
)
$results = [Collections.Generic.List[object]]::new()
try {
    $wordApp.Visible = $false
    Write-Output 'Opening fixture'
    $wordDoc = $wordApp.Documents.Open($sourcePath, $false, $false)
    if ($wordDoc.OMaths.Count -ne 10) { throw 'Expected ten native equations' }
    Write-Output 'Exporting original Word render'
    $wordDoc.ExportAsFixedFormat((Join-Path $fixtureRoot 'math-word-original.pdf'), 17)
    foreach ($check in $checks) {
        Write-Output ('Editing ' + $check.Name)
        $range = & $check.Get $wordDoc
        $before = Normalize-MathText $range.Text
        if ($before -ne $check.Expected) { throw ($check.Name + ': expected ' + $check.Expected + ', got ' + $before) }
        $range.Text = $check.New
    }
    # Modify a relation/coefficient and a condition inside their actual Word ranges.
    foreach ($change in @(@{Index=4;Find='1';Replace='2'}, @{Index=4;Find=[string][char]0x2264;Replace=[string][char]0x003C}, @{Index=9;Find='0';Replace='1'})) {
        $range = $wordDoc.OMaths.Item($change.Index).Range.Duplicate
        $range.Find.ClearFormatting()
        if (-not $range.Find.Execute($change.Find)) { throw 'Math find failed' }
        $range.Text = $change.Replace
    }
    Write-Output 'Saving edited fixture'
    $wordDoc.SaveAs2($editedPath, 16)
    $wordDoc.Close(0)
    $wordDoc = $wordApp.Documents.Open($editedPath, $false, $true)
    if ($wordDoc.OMaths.Count -ne 10) { throw 'Equation structure lost on reopen' }
    foreach ($check in $checks) {
        $range = & $check.Get $wordDoc
        $actual = Normalize-MathText $range.Text
        if ($actual -ne $check.New) { throw ($check.Name + ': changed argument did not survive reopen: ' + $actual) }
        $results.Add(@{ name=$check.Name; before=$check.Expected; after=$actual; reopened=$true })
    }
    if ((Normalize-MathText $wordDoc.OMaths.Item(4).Range.Text) -notmatch 'x<2') { throw 'Relation change lost' }
    $matrix = $wordDoc.OMaths.Item(10).Functions.Item(1).Delim.E.Item(1).Functions.Item(1).Mat
    if ((Normalize-MathText $matrix.Cell(1,1).Range.Text) -ne '1' -or (Normalize-MathText $matrix.Cell(2,1).Range.Text) -ne 'x' -or (Normalize-MathText $matrix.Cell(2,2).Range.Text) -ne 'ai') { throw 'Unrelated matrix cell changed' }
    $wordDoc.ExportAsFixedFormat((Join-Path $fixtureRoot 'math-word-edited.pdf'), 17)
    @{ status='passed'; version=$wordApp.Version; build=$wordApp.Build; equations=$wordDoc.OMaths.Count; checks=$results; editedFile=$editedPath } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $fixtureRoot 'word-verification.json') -Encoding utf8
    Write-Output ('Word ' + $wordApp.Version + ': native equation edits saved and reopened')
} finally {
    if ($null -ne $wordDoc) { $wordDoc.Close(0) }
    $wordApp.Quit()
}
