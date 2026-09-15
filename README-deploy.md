# 部署说明：Learndiag（Cloudflare Pages，wrangler 直传为主）

> 2026-08-22 更新：**`site\` 现在是唯一事实来源**（triumph\ 里的 index.html 是过时旧稿，
> `sync-site.ps1` 已加保护默认拒绝执行）。API 全部搬进 `site\_worker.js`（Pages 高级模式），
> `functions\` 目录已删除。改动后直接跑 `.\deploy.ps1`。

## 目录结构

```
E:\Learndiag\praxis-5001\
├── site\                        ← 部署目录（唯一事实来源，wrangler pages deploy 直接上传）
│   ├── _worker.js               ← ★ 全部 API / MCP / Markdown 协商逻辑（Pages 高级模式）
│   ├── index.html               ← 首页（含 SSR 静态内容 + JSON-LD + og:image）
│   ├── about/contact/privacy/developers.html ← 信任页 + 开发者门户
│   ├── 404.html                 ← 存在即禁用 SPA 兜底（未知路径返回真 404）
│   ├── openapi.json             ← OpenAPI 3.1 规范（/api/openapi.yaml 由 worker 从同一对象生成）
│   ├── llms.txt / robots.txt / sitemap.xml
│   ├── .well-known\
│   │   ├── mcp\manifest.json + mcp-manifest.json
│   │   └── agent-skills\index.json + */SKILL.md
│   ├── md\*.md                  ← 每个内容页的 Markdown 变体（Accept: text/markdown 协商）
│   └── data\questions-api.json + stats.json（题库 API 数据，由 tools\build-data 类脚本生成）
├── triumph\                     ← ⚠️ 过时开发稿，不要再从这里同步
├── functions\                   ← （已删除；全部移植进 site\_worker.js）
├── cli\                         ← triumph-praxis npm CLI 包（发布需 npm 账号）
├── test\agentic.test.mjs        ← 测试套件：npm test（node --test）
├── tools\html-to-md.mjs         ← HTML → Markdown 转换器（npm run build:md 再生成 md\）
├── deploy.ps1                   ← 部署：wrangler pages deploy site --project-name triumph
└── .dev.vars                    ← 本地 dev 密钥（已 gitignore，勿提交真实密钥）
```

## 主流程

**改代码后：**

1. 直接改 `site\` 里的文件（首页 SSR 静态区与 JSX 组件需人工保持一致，见 index.html 内注释）
2. 本地验证：
   ```powershell
   npm test                                   # 45 项单元/集成测试
   wrangler pages dev site --port 8799 --binding JWT_SECRET=dev --compatibility-date=2026-08-18
   ```
3. 部署（10 秒）：`.\deploy.ps1` → https://triumph-6eq.pages.dev

## site\_worker.js 负责什么

| 路由 | 行为 |
| --- | --- |
| `/api/register·login·verify·resend·logout·me·state` | 原 Pages Functions 移植版；错误统一为 `{error:{code,message,hint},status}` |
| `/api/v1/*` | 公共只读 API（health/meta/stats/questions/random）+ 自助范围 API key |
| `/mcp` | MCP Streamable HTTP（JSON-RPC：initialize/tools/list/tools/call），无鉴权只读 |
| `/.well-known/api-catalog` | RFC 9727 API 目录（RFC 9264 Linkset 格式 + profile）；GET/HEAD 均带 Link 头 |
| 首页 `/` | RFC 8288 Link 发现头：api-catalog / service-desc（openapi.json）/ service-doc（/developers）/ describedby（llms.txt） |
| `Accept: text/markdown` | 内容页协商出 `md\*.md`，带 `Vary: Accept, Accept-Encoding`；无法满足才 406 |
| 其余 | 原样走 `env.ASSETS.fetch`（静态行为、缓存头与之前完全一致） |

注意：`_worker.js` 存在时 Cloudflare Pages **不再执行 functions\ 目录** —— 这就是删掉它的原因。

## 上线验证清单（部署后跑一遍）

```powershell
curl.exe -s -H "Accept: text/markdown" https://learndiag.com/      # text/markdown + Vary
curl.exe -s https://learndiag.com/api/v1/health
curl.exe -s -X POST https://learndiag.com/mcp -H "Content-Type: application/json" ^
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
curl.exe -s -o NUL -w "%{http_code}" https://learndiag.com/no-page # 应为 404
node tools\verify-live-home.mjs                                          # 先 curl 首页存 %TEMP%\live-home.html
```

**支付相关（2026-09-11 起，每次部署后必跑）**：

```powershell
npm run live-check                                                       # ★ 一条命令：Creem 五变量配对没有，应 11/11 全绿
curl.exe -s -o NUL -w "%{http_code}" -X POST https://learndiag.com/api/billing/report-checkout ^
  -H "Content-Type: application/json" -d "{}"                            # 400 = 路由在；404 = 新 worker 没部署上去
curl.exe -s -o NUL -w "%{http_code}" -X POST https://learndiag.com/api/billing/webhook -d "{}"   # 恒 401（验签在跑）
```

> 判读口诀：**变量改了不部署 = 完全不生效**（`live-check` 会 A 层绿、B 层红，症状极像"支付坏了"）。
> `/api/diagnostic/report` 未部署 = **404**、已部署 = **400**。详见 `docs/维护手册.md` §7。

## ⚠️ de5.net 区域级 AI 封锁（仓库外，需要 Cloudflare 控制台）

de5.net zone 开着 **Cloudflare 托管 robots.txt + AI bot 封拦**（AI Audit / Bot Fight Mode）。
它在边缘把我们的 robots.txt 前面拼接了 `User-agent: ClaudeBot/GPTBot/Google-Extended... Disallow: /`，
并对数据中心 IP 的 AI 爬虫弹挑战。**仓库内任何改动都覆盖不了它**。要彻底通过 agent 可达性审计，
需要在管理面板操作（de5.net zone 所有者账号）：

1. Security → Bots → 关闭 **Bot Fight Mode**（或加跳过规则放行已验证 AI crawler）
2. AI Audit（Scrapers & Crawlers）→ 关闭 **托管 robots.txt / Block AI bots**，
   至少把 GPTBot、ClaudeBot、ChatGPT-User、PerplexityBot、Google-Extended、Applebot-Extended 设为 Allow
3. 若 de5.net 不是你的 zone：把自定义域名换成自己注册的域名再绑定到这个 Pages 项目。

若不处理，Ora 审计的 #2/#3（bot 检测拦截）会继续失败——尽管站点本身对所有 UA 都返回 200。

## 备选：GitHub + Cloudflare Pages 自动部署（想自动更新时再配）

### 1. GitHub 建仓库
1. 打开 https://github.com/new
2. 仓库名 `triumph`（或任意），Public 或 Private 都行，不要勾选初始化选项

### 2. 连接本地仓库并推送
```powershell
cd E:\Learndiag\praxis-5001
git init; git add -A; git commit -m "triumph site v2 (agent-ready)"
git branch -M main
git remote add origin https://github.com/<你的用户名>/triumph.git
git push -u origin main
```

### 3. Cloudflare Pages 连接 GitHub
构建命令留空，输出目录填 `site`。注意 GitHub 方式会新建另一个 Pages 项目（新 URL）。

> ⚠️ 编码注意：项目里所有 `.ps1` 必须是 **UTF-8 带 BOM**。
