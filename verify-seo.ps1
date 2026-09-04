# verify-seo.ps1 - pre-publish local SEO verification (pure ASCII on purpose; PS 5.1 safe)
$ErrorActionPreference = 'Stop'
$site = 'E:\Triumph\praxis-5001\site'
$script:fail = 0

function Check($name, $ok, $detail) {
  if ($ok) { Write-Host ("PASS  " + $name) -ForegroundColor Green }
  else { $script:fail++; Write-Host ("FAIL  " + $name + $(if ($detail) { "  => [" + $detail + "]" })) -ForegroundColor Red }
}

$EN  = [char]0x2013  # en dash
$EM  = [char]0x2014  # em dash

# ---------- 1. new pages: canonical / title / H1 ----------
$t1 = "Praxis 5001 Passing Scores by State (2026)"
$h1_1 = "Praxis 5001 Passing Scores by State (2026): Qualifying Scores for 5002" + $EN + "5005"
$t2 = "Praxis 5001 Subtests Explained (5002-5005)"
$h1_2 = "Praxis 5001 Subtests Explained: What's on 5002, 5003, 5004, and 5005"
$pages = @(
  @{ f = 'praxis-5001-passing-score-by-state.html'; slug = 'praxis-5001-passing-score-by-state'; title = $t1; h1 = $h1_1 },
  @{ f = 'praxis-5001-subtests-explained.html';     slug = 'praxis-5001-subtests-explained';     title = $t2; h1 = $h1_2 }
)
foreach ($p in $pages) {
  $raw = Get-Content -LiteralPath (Join-Path $site $p.f) -Raw -Encoding UTF8
  $canonExpected = '<link rel="canonical" href="https://learndiag.com/' + $p.slug + '">'
  Check "$($p.slug): canonical -> learndiag.com" ($raw.Contains($canonExpected)) $canonExpected
  $tExpected = '<title>' + $p.title + ' | Learndiag</title>'
  Check "$($p.slug): <title>" ($raw.Contains($tExpected)) $tExpected
  $h1s = [regex]::Matches($raw, '<h1>(.*?)</h1>', 'Singleline')
  $h1Ok = ($h1s.Count -ge 1)
  foreach ($h in $h1s) { if ($h.Groups[1].Value -ne $p.h1) { $h1Ok = $false } }
  Check "$($p.slug): single matching H1" $h1Ok ($(if ($h1s.Count -gt 0) { ($h1s | ForEach-Object { $_.Groups[1].Value }) -join ' || ' } else { 'no H1' }))
}

# homepage title contains target keyword
$idx = Get-Content -LiteralPath (Join-Path $site 'index.html') -Raw -Encoding UTF8
$idxTitle = ''
$m = [regex]::Match($idx, '<title[^>]*>([\s\S]*?)</title>')
if ($m.Success) { $idxTitle = $m.Groups[1].Value }
Write-Host ("INFO  index <title>: " + $idxTitle)
Check 'index.html title contains "Free Praxis 5001 Practice Test"' ($idxTitle -like '*Free Praxis 5001 Practice Test*') $idxTitle
$h1tags = [regex]::Matches($idx, '<h1[^>]*>([\s\S]*?)</h1>')
foreach ($h in $h1tags) { Write-Host ("INFO  index <h1>: " + (($h.Groups[1].Value -replace '\s+',' ').Trim())) }

# ---------- 2. internal links (/praxis-5001-* and /diagnostic) ----------
$htmlFiles = Get-ChildItem -LiteralPath $site -Filter *.html -File
$linkMap = @{}
foreach ($f in $htmlFiles) {
  $c = Get-Content -LiteralPath $f.FullName -Raw -Encoding UTF8
  foreach ($mt in [regex]::Matches($c, 'href="(/[^"#"]*)"')) {
    $u = $mt.Groups[1].Value
    if ($u -like '/praxis-5001*' -or $u -eq '/diagnostic') {
      if (-not $linkMap.ContainsKey($u)) { $linkMap[$u] = 0 }
      $linkMap[$u]++
    }
  }
}
$broken = @()
foreach ($k in $linkMap.Keys) {
  $target = Join-Path $site ($k.TrimStart('/') + '.html')
  if (-not (Test-Path -LiteralPath $target)) { $broken += ($k + ' (used ' + $linkMap[$k] + 'x)') }
}
Write-Host ("INFO  unique internal targets checked: " + $linkMap.Count)
Check 'all internal links resolve to existing files' ($broken.Count -eq 0) ($broken -join ', ')

$res = Get-Content -LiteralPath (Join-Path $site 'resources.html') -Raw -Encoding UTF8
Check 'resources.html links both new articles' (($res.Contains('href="/praxis-5001-passing-score-by-state"')) -and ($res.Contains('href="/praxis-5001-subtests-explained"')))
$smpRaw = Get-Content -LiteralPath (Join-Path $site 'sitemap.xml') -Raw -Encoding UTF8
Check 'sitemap.xml lists both new URLs' (($smpRaw.Contains('<loc>https://learndiag.com/praxis-5001-passing-score-by-state</loc>')) -and ($smpRaw.Contains('<loc>https://learndiag.com/praxis-5001-subtests-explained</loc>')))

# ---------- 3. sitemap.xml well-formed + lastmod ----------
try {
  $xml = New-Object System.Xml.XmlDocument
  $xml.Load((Join-Path $site 'sitemap.xml'))
  $nodes = @($xml.SelectNodes('//*[local-name()="url"]'))
  Write-Host ("INFO  sitemap parsed OK, <url> count = " + $nodes.Count)
  Check 'sitemap.xml is well-formed XML and non-empty' ($nodes.Count -gt 0)
  $map = @{}
  foreach ($n in $nodes) { $map[$n.SelectSingleNode('./*[local-name()="loc"]').InnerText] = $n.SelectSingleNode('./*[local-name()="lastmod"]').InnerText }
  $homeLm = $map['https://learndiag.com/']
  $resLm  = $map['https://learndiag.com/resources']
  $a1 = $map['https://learndiag.com/praxis-5001-passing-score-by-state']
  $a2 = $map['https://learndiag.com/praxis-5001-subtests-explained']
  Write-Host ("INFO  home lastmod=$homeLm resources lastmod=$resLm article1=$a1 article2=$a2")
  Check 'homepage lastmod = 2026-08-30' ($homeLm -eq '2026-08-30') $homeLm
  Check 'resources lastmod = 2026-08-30' ($resLm -eq '2026-08-30') $resLm
  Check 'passing-score-by-state lastmod = 2026-08-30' ($a1 -eq '2026-08-30') $a1
  Check 'subtests-explained lastmod = 2026-08-25' ($a2 -eq '2026-08-25') $a2
} catch {
  Check 'sitemap.xml is well-formed XML' $false $_.Exception.Message
}

# ---------- 4. llms.txt entries ----------
$ltx = Get-Content -LiteralPath (Join-Path $site 'llms.txt') -Raw -Encoding UTF8
$l1 = "- [Praxis 5001 Passing Scores by State](https://learndiag.com/praxis-5001-passing-score-by-state): verified 2026 qualifying scores per subtest for states using the 5001, states that don't, and how to verify."
$l2 = "- [Praxis 5001 Subtests Explained](https://learndiag.com/praxis-5001-subtests-explained): what's on 5002, 5003, 5004, and 5005 " + $EM + " counts, timing, categories, scoring."
Check 'llms.txt entry: passing-score-by-state' ($ltx.Contains($l1))
Check 'llms.txt entry: subtests-explained' ($ltx.Contains($l2))

# ---------- 5. robots.txt hygiene ----------
$rbPath = Join-Path $site 'robots.txt'
if (Test-Path -LiteralPath $rbPath) {
  $rbBytes = [System.IO.File]::ReadAllBytes($rbPath)
  $bom = ($rbBytes.Length -ge 3 -and $rbBytes[0] -eq 0xEF -and $rbBytes[1] -eq 0xBB -and $rbBytes[2] -eq 0xBF)
  Check 'robots.txt: no UTF-8 BOM' (-not $bom) 'BOM breaks live directives'
  $rb = Get-Content -LiteralPath $rbPath -Raw -Encoding UTF8
  Check 'robots.txt: Sitemap line points to learndiag.com' ($rb.Contains('Sitemap: https://learndiag.com/sitemap.xml')) 'missing or wrong sitemap line'
  $disallows = [regex]::Matches($rb, '(?im)^\s*Disallow\s*:')
  Check 'robots.txt: no Disallow rules blocking indexable pages' ($disallows.Count -eq 0) (($disallows | ForEach-Object { $_.Value.Trim() }) -join ' | ')
  $smpOk = $smpRaw.Contains('<loc>https://learndiag.com/tools</loc>')
  Check 'sitemap.xml lists /tools (indexable, no longer orphan)' $smpOk '<loc>https://learndiag.com/tools</loc>'
  $toolsRaw = Get-Content -LiteralPath (Join-Path $site 'tools.html') -Raw -Encoding UTF8
  Check 'tools.html: index,follow + canonical /tools' (($toolsRaw.Contains('<meta name="robots" content="index, follow"')) -and ($toolsRaw.Contains('<link rel="canonical" href="https://learndiag.com/tools"'))) 'missing robots meta or canonical'
} else {
  Check 'robots.txt exists' $false $rbPath
}

Write-Host ''
if ($script:fail -eq 0) { Write-Host '=== ALL CHECKS PASSED ===' -ForegroundColor Green; exit 0 }
else { Write-Host ("=== " + $script:fail + " CHECK(S) FAILED ===") -ForegroundColor Red; exit 1 }
