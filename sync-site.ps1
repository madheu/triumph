# sync-site.ps1 — 同步开发文件到部署目录
# 用法: .\sync-site.ps1 "提交说明"
# 作用: 复制 triumph/index.html + triumph/diagnostic.html 到 site/ → 若在 git 仓库则 commit → 提示 push
param([string]$msg = "update site")
$ErrorActionPreference = "Stop"
$proj = $PSScriptRoot
$src = "$proj\triumph"     # 开发源（文件已整理进 triumph/ 子目录）
$site = "$proj\site"

if (!(Test-Path "$src\index.html") -or !(Test-Path "$src\diagnostic.html")) {
  Write-Host "错误: triumph/ 源文件缺失" -ForegroundColor Red; exit 1
}
Copy-Item "$src\index.html" -Destination "$site\index.html" -Force
Copy-Item "$src\diagnostic.html" -Destination "$site\diagnostic.html" -Force
Write-Host "已同步到 site/" -ForegroundColor Green

# git 部分：仅在 git 仓库内执行（本项目用 deploy.ps1 直传，非 git 仓库时跳过）
Push-Location $proj
$inRepo = $false
try { git rev-parse --is-inside-work-tree 2>&1 | Out-Null; if ($LASTEXITCODE -eq 0) { $inRepo = $true } } catch { $inRepo = $false }
if ($inRepo) {
  git add -A
  git commit -m $msg
  if ($LASTEXITCODE -eq 0) {
    Write-Host "已提交。现在执行 git push 触发自动部署:" -ForegroundColor Yellow
    Write-Host "  git push" -ForegroundColor Cyan
  } else {
    Write-Host "提交失败（可能无改动）" -ForegroundColor Red
  }
} else {
  Write-Host "非 git 仓库，跳过 commit/push。部署请运行: .\deploy.ps1" -ForegroundColor Yellow
}
Pop-Location
