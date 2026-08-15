# 部署说明：Cloudflare Pages + GitHub 自动部署

## 目录结构

```
E:\harness\praxis-5001\
├── site\                 ← 唯一的部署目录（Cloudflare Pages 构建目录）
│   ├── index.html        ← 首页（Landing）
│   └── diagnostic.html   ← 诊断工具
├── （其余 .md/.js/.json 都是开发文件，不部署）
```

**改代码后的流程**：修改 `E:\harness\praxis-5001\index.html` / `diagnostic.html` 后，需要**同步到 site/** 再 commit——`sync-site.ps1` 脚本帮你完成（复制 + commit，如下）。

## 一次性设置（你只需做一次，约 10 分钟）

### 1. GitHub 建仓库
1. 打开 https://github.com/new
2. 仓库名 `triumph`（或任意），**Public 或 Private 都行**，不要勾选任何初始化选项（空仓库）
3. Create repository

### 2. 连接本地仓库并推送（在你机器终端执行）
```powershell
cd E:\harness\praxis-5001
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

## 以后每次改代码（自动部署）

在 `E:\harness\praxis-5001\` 下运行（或让我改完告诉你）：
```powershell
.\sync-site.ps1 "改了什么：移动端留白加大"
```
这个脚本：复制两个 html 到 site/ → git add → commit → **提示你 push**。

然后：
```powershell
git push
```
→ Cloudflare Pages 检测到 push → **自动重新部署**（约 1 分钟）→ 手机刷新即见新版本。

## 可选：全自动（连 push 都省）

Cloudflare Pages 支持 **GitHub Actions 或 Webhook**，或你配置 GitHub 自动推送。最省事的是：
- 安装一个"文件监控 + 自动 git commit/push"的小工具（如 watchman），或
- 用 VS Code 的 Git 面板点一下 push

## 与当前 Workers 部署的关系

- 你的 `triumph.abc15531888397.workers.dev` 是手动上传的 Workers 版本
- Pages 配好后用 `triumph.pages.dev`（新 URL），发帖时用新 URL
- 两个可以并存，Pages 才是"改完自动更新"的那个
