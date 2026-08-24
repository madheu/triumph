$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$files = @(
  "site\index.html",
  "site\diagnostic.html",
  "site\practice.html",
  "site\dashboard.html",
  "site\praxis-5001-study-guide.html",
  "site\praxis-5001-four-gate-strategy.html",
  "site\praxis-5001-retake-guide.html",
  "site\praxis-5001-vs-7001.html",
  "site\resources.html",
  "site\md\resources.md"
)
foreach ($rel in $files) {
  $path = Join-Path "E:\Triumph\praxis-5001" $rel
  $c = [System.IO.File]::ReadAllText($path, [System.Text.UTF8Encoding]::new($false))
  $c = $c.Replace("`r`n", "`n")
  [System.IO.File]::WriteAllText($path, $c, $utf8NoBom)
}
Write-Host "normalized line endings to LF for $($files.Count) files"
