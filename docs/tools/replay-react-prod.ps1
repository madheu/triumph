$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

# Safe rewrite: read as UTF-8 explicitly, replace literal ASCII strings, write UTF-8 no BOM.
$files = @(
  "site\index.html",
  "site\diagnostic.html",
  "site\practice.html",
  "site\dashboard.html",
  "site\praxis-5001-study-guide.html",
  "site\praxis-5001-four-gate-strategy.html",
  "site\praxis-5001-retake-guide.html",
  "site\praxis-5001-vs-7001.html"
)

$reactUrlOld = 'https://unpkg.com/react@18.3.1/umd/react.development.js'
$reactUrlNew = 'https://unpkg.com/react@18.3.1/umd/react.production.min.js'
$reactHash   = 'sha384-DGyLxAyjq0f9SPpVevD6IgztCFlnMF6oW/XQGmfe+IsZ8TqEiDrcHkMLKI6fiB/Z'
$domUrlOld   = 'https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js'
$domUrlNew   = 'https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js'
$domHash     = 'sha384-gTGxhz21lVGYNMcdJOyq01Edg0jhn/c22nsx0kyqP0TxaV5WVdsSH1fSDUf5YJj1'

foreach ($rel in $files) {
  $path = Join-Path "E:\Triumph\praxis-5001" $rel
  $c = [System.IO.File]::ReadAllText($path, [System.Text.UTF8Encoding]::new($false))
  # Swap dev React for production build (URL + SRI integrity)
  $idx = $c.IndexOf($reactUrlOld)
  if ($idx -ge 0) {
    $c = $c.Replace($reactUrlOld, $reactUrlNew)
    $start = $c.IndexOf('integrity="', $c.IndexOf($reactUrlNew)) + 'integrity="'.Length
    $end = $c.IndexOf('"', $start)
    $c = $c.Remove($start, $end - $start).Insert($start, $reactHash)
  }
  $idx = $c.IndexOf($domUrlOld)
  if ($idx -ge 0) {
    $c = $c.Replace($domUrlOld, $domUrlNew)
    $start = $c.IndexOf('integrity="', $c.IndexOf($domUrlNew)) + 'integrity="'.Length
    $end = $c.IndexOf('"', $start)
    $c = $c.Remove($start, $end - $start).Insert($start, $domHash)
  }
  # Defer the three CDN scripts (React, ReactDOM, Babel)
  $c = $c.Replace('<script src="https://unpkg.com/', '<script defer src="https://unpkg.com/')
  [System.IO.File]::WriteAllText($path, $c, $utf8NoBom)
  Write-Host ("updated: " + $rel)
}
