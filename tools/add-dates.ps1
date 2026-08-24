$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$dir = "E:\Triumph\Triumph SEO"

function Add-Date([string]$file, [string]$date) {
  $c = [System.IO.File]::ReadAllText($file, $utf8NoBom)
  if ($c -notmatch '(?m)^date:') {
    $c = $c -replace "(?m)^(---\r?\n)", ("`$1date: `"" + $date + "`"`n")
    [System.IO.File]::WriteAllText($file, $c, $utf8NoBom)
    Write-Host ("{0} -> {1}" -f (Split-Path $file -Leaf), $date)
  } else {
    Write-Host ("SKIP (has date): " + (Split-Path $file -Leaf))
  }
}

$oldBatch = @(
  "Praxis 5001 vs 8000 Series.md",
  "Praxis 5002 Study Guide.md",
  "Praxis 5003 Math Study Guide.md",
  "Praxis 5004 Social Studies Study Guide.md",
  "Praxis 5005 Science Study Guide.md"
)
foreach ($f in $oldBatch) { Add-Date (Join-Path $dir $f) "2026-08-20" }

$newBatch = @(
  "Praxis 5001 Free Practice Test.md",
  "Praxis 5001 Passing Scores.md",
  "Praxis 5001 Registration Guide.md",
  "State Virginia Praxis 5001 Requirements.md",
  "State Tennessee Praxis 5001 Requirements.md",
  "State New Jersey Praxis 5001 Requirements.md",
  "State South Carolina Praxis 5001 Requirements.md",
  "State Kentucky Praxis 5001 Requirements.md"
)
foreach ($f in $newBatch) { Add-Date (Join-Path $dir $f) "2026-08-24" }
