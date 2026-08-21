# deploy.ps1 一键部署 Triumph 到 Cloudflare Pages
# 用法: .\deploy.ps1           部署 site/ 目录
# 首次使用（只需一次）:
#   npm install -g wrangler
#   wrangler login              # 浏览器授权 Cloudflare
# 之后每次改完代码运行本脚本即可，10 秒部署完成
# 部署 URL: https://triumph-6eq.pages.dev
$ErrorActionPreference = "Stop"
# 从脚本自身位置推导项目根目录（迁移后无需改路径）
$proj = $PSScriptRoot
$site = "$proj\site"

if (!(Test-Path "$site\index.html") -or !(Test-Path "$site\diagnostic.html")) {
  Write-Host "错误: site/ 缺少部署文件，先运行 .\sync-site.ps1" -ForegroundColor Red
  exit 1
}

# 1. 确保 wrangler 可用
$wrangler = Get-Command wrangler -ErrorAction SilentlyContinue
if (-not $wrangler) {
  Write-Host "未找到 wrangler，正在安装（需要网络，几分钟）..." -ForegroundColor Yellow
  npm install -g wrangler
  if ($LASTEXITCODE -ne 0) { Write-Host "wrangler 安装失败，请手动运行: npm install -g wrangler" -ForegroundColor Red; exit 1 }
}

# 2. 登录检查
$whoami = wrangler whoami 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Host "需登录 Cloudflare，浏览器将弹出授权..." -ForegroundColor Yellow
  wrangler login
}

# 3. 部署 site/ 到 Pages（项目名 triumph；--commit-dirty=true 避免 git 无 HEAD 时判文件未变）
Write-Host "Deploying..." -ForegroundColor Cyan
Push-Location $proj
wrangler pages deploy $site --project-name triumph --branch main --commit-dirty=true
$code = $LASTEXITCODE
Pop-Location

if ($code -eq 0) {
  Write-Host "`n=== DEPLOY OK ===" -ForegroundColor Green
  Write-Host "URL: https://triumph-6eq.pages.dev" -ForegroundColor Cyan
  Write-Host "Tip: hard-refresh on phone (close tab, reopen) to bypass cache." -ForegroundColor Yellow
} else {
  Write-Host "Deploy failed, see errors above." -ForegroundColor Red
}
