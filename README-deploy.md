# 部署说明：Triumph（Cloudflare Pages，wrangler 直传为主）

## 目录结构

```
E:\Triumph\praxis-5001\
├── triumph\            ← 开发源文件（改代码在这里改）
│   ├── index.html      ← 首页（Landing）
│   └── diagnostic.html ← 诊断工具（题库内嵌 DM_BANK，86 题）
├── site\               ← 部署目录（Cloudflare Pages 构建目录，triumph/ 的副本）
│   ├── index.html
│   ├── diagnostic.html
│   ├── robots.txt      ← 屏蔽 /diagnostic.html 进索引
│   └── sitemap.xml
├── （其余 .md/.js/.json 都是开发文件，不部署）
```

## 主流程（当前实际用的方式：wrangler 直传，不依赖 git）

**改代码后：**

1. 修改 `triumph\index.html` / `triumph\diagnostic.html`（题库更新先 `node build-demo-bank.js`）
2. 同步到部署目录：
   ```powershell
   .\sync-site.ps1 "改了什么"
   ```
   （复制 triumph/ → site/；非 git 仓库时跳过 commit，提示用 deploy）
3. 部署（10 秒）：
   ```powershell
   .\deploy.ps1
   ```
   预期输出 **Uploaded 4 files** → 访问 https://triumph-6eq.pages.dev

> ⚠️ 编码注意：项目里所有 `.ps1` 必须是 **UTF-8 带 BOM**，否则 Windows PowerShell 5.1 会把中文按 ANSI 解码导致语法错误。已确认 deploy.ps1 / sync-site.ps1 均带 BOM。

## 备选：GitHub + Cloudflare Pages 自动部署（想自动更新时再配）

### 1. GitHub 建仓库
1. 打开 https://github.com/new
2. 仓库名 `triumph`（或任意），**Public 或 Private 都行**，不要勾选任何初始化选项（空仓库）
3. Create repository

### 2. 连接本地仓库并推送（在你机器终端执行）
```powershell
cd E:\Triumph\praxis-5001
git init
git add -A
git commit -m "triumph site v1"
git branch -M main
git remote add origin https://github.com/<你的用户名>/triumph.git
git push -u origin main
```
（会提示 GitHub 登录，浏览器授权一次即可）

### 3. Cloudflare Pages 连接 GitHub
1. 打开 https://dash.cloudflare.com → **Workers & Pages** → **Pages** → **创建**
2. 选 **"连接到 Git"**（Connect to Git）→ 授权 GitHub → 选 `triumph` 仓库
3. 构建设置：
   - **构建命令（Build command）**：留空（纯静态）
   - **构建输出目录（Build output directory）**：填 `site`
4. 保存并部署 → 拿到 `https://triumph.pages.dev`

配好后每次 push 自动重新部署（约 1 分钟）。**但注意**：项目已有 `triumph-6eq` 这个 Pages 项目名（wrangler 在用），GitHub 方式会新建一个 Pages 项目（新 URL）——两条线可以并存，发帖用哪个 URL 保持一致即可。

## 与当前 Workers 部署的关系

- `triumph.abc15531888397.workers.dev` 是早期手动上传的 Workers 版本
- 现在主 URL 是 **https://triumph-6eq.pages.dev**（发帖/问卷都用这个）
- Workers 旧版可留可弃，两者并存不冲突
