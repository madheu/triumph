# sync-site.ps1 — 同步部署目录并提交 git
# 用法: .\sync-site.ps1 "提交说明"
# 作用: 复制 index.html + diagnostic.html 到 site/ → git add/commit → 提示 push
param([string]$msg = "update site")
$ErrorActionPreference = "Stop"
$proj = "E:\harness\praxis-5001"
$site = "$proj\site"

if (!(Test-Path "$proj\index.html") -or !(Test-Path "$proj\diagnostic.html")) {
  Write-Host "错误: 源文件缺失" -ForegroundColor Red; exit 1
}
Copy-Item "$proj\index.html" -Destination "$site\index.html" -Force
Copy-Item "$proj\diagnostic.html" -Destination "$site\diagnostic.html" -Force
Write-Host "已同步到 site/" -ForegroundColor Green

Push-Location $proj
git add -A
git commit -m $msg
if ($LASTEXITCODE -eq 0) {
  Write-Host "已提交。现在执行 git push 触发自动部署:" -ForegroundColor Yellow
  Write-Host "  git push" -ForegroundColor Cyan
} else {
  Write-Host "提交失败（可能无改动）" -ForegroundColor Red
}
Pop-Location
