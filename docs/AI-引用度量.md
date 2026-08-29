# AI 引用度量（AI-Native Distribution Metrics）— Learndiag

> 目的：让第七节「MCP / AI 原生分发」可度量、可复盘。第七节的核心论点是：
> *"当 ChatGPT / Claude / Perplexity 能发现并调用你的 API 来回答备考问题时，就获得了 AI 搜索时代的原生流量入口。"*
> 没有数字，这个论点就只是营销。本文件定义三类指标 + 怎么查 + 维护规则。

## 指标一：AI 抓取（Discovery）——AI 是否发现并爬取你的内容

**口径**：Cloudflare Analytics（zone: `learndiag.com`），按 `clientRequest.userAgent` 过滤主流 AI bot / 爬虫。

**怎么查**（Cloudflare 控制台 → Analytics → GraphQL，或导出）：
- 用 HTTP Requests（按 User-Agent 分组）看各 bot 的请求数趋势。
- 关注的 User-Agent 片段：`GPTBot`、`ChatGPT-User`、`OAI-SearchBot`、`ClaudeBot`、`Claude-Web`、`anthropic-ai`、`Google-Extended`、`PerplexityBot`、`Perplexity-User`、`Applebot-Extended`、`DeepSeekBot`、`Bytespider`、`CCBot`、`meta-externalagent`、`ora-agent`、`Amazonbot`。
- 简单基线：每周看一次"非浏览器 UA 的页面请求数是否 > 0、是否增长"。全 0 = 极可能是边缘层 AI 封锁（见 README-deploy §7 de5.net 教训，务必在 Cloudflare 控制台确认 learndiag.com zone 没开 Bot Fight Mode / AI Audit 封锁）。

## 指标二：MCP 调用（Activation）——AI 是否真的调用了 API

**口径**：Cloudflare Analytics 按路径过滤 `/mcp`（MCP 端点只有 POST；`/api/v1/*` 同理可按路径看）。
- 看 `/mcp` 的请求量、`tools/list` 与 `tools/call` 的占比（可从 worker 日志/Logpush 看 JSON-RPC method）。
- 可选（更精确）：给 `worker-src/mcp.mjs` 的 `tools/call` 加一个 D1/KV 计数器 + admin 端点，把每次调用记下来。**默认不做**——先以 CF Analytics 路径口径为准，成本为零；等有真实调用量再决定是否加表。
- `/api/v1/*` 的匿名请求也计入（REST 是 MCP 的同等表面）。

## 指标三：AI 引用（Outcome）——AI 回答里是否出现 learndiag.com

**口径**：人工抽检 + 记录，按月复盘。这个最慢、最值钱。
- 定期用 ChatGPT / Claude / Perplexity / Google AI Overviews 问几类真实问题：
  - "Praxis 5001 passing score in Kentucky"
  - "Praxis 5001 math practice questions on fractions"
  - "what's on the Praxis 5001 social studies subtest"
- 看回答是否引用 / 链接 `learndiag.com`、是否给出我们的数据（如 969 题、四科结构）。
- 记录表：

| 日期 | 引擎/问题 | 是否引用 | 引用链接/数据 | 备注 |
|---|---|---|---|---|
| 2026-08-29 | 基线（文章发布前） | — | — | 建立基线 |

> 说明：AI 引用无法用 GA 精确统计，只能抽检；但它是"原生流量入口"成立的最直接证据。

## 维护规则：发布新内容时必须做"三件套"

新增任何页面/文章/路由后，**一次性同步三处**，否则 AI 会发现不了它：

1. **`site/sitemap.xml`** — 加 `<url>`（注意用 canonical 域名 + 合理 lastmod）
2. **`site/llms.txt`** — 在对应小节加一行链接（Content pages / Study guides / State guides）
3. **IndexNow** — 部署后执行 `node tools/submit-indexnow.mjs <slug>`（工具已指向 `learndiag.com`）

> 规则来源：第七节 DoD。任何新内容若只更新了 sitemap 而漏掉 llms.txt，等于对 AI 客户端隐藏了入口。

## 相关入口（验证命令）

```powershell
# MCP 握手
curl.exe -s -X POST https://learndiag.com/mcp -H "Content-Type: application/json" `
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
# llms.txt
curl.exe -s https://learndiag.com/llms.txt
# 健康
curl.exe -s https://learndiag.com/api/v1/health
# IndexNow 全量提交（部署后）
node tools/submit-indexnow.mjs
```

> ⚠️ 线上验证必须直连（清本地代理 `HTTP(S)_PROXY` + `NO_PROXY=*`），否则本地代理会劫持返回假响应（HANDOFF 常见坑 3）。

## 复盘节奏

- 每 2 周：指标一 + 指标二（10 分钟，看趋势）。
- 每月：指标三抽检 + 文章/目录提交效果复盘（外链提交包第 8 节进度表）。
- 若 3 个月 MCP 调用量仍为 0：先查边缘层 AI 封锁，再考虑把 MCP 端点提交到更多目录 / 出开发者文章（即本文档配套的 `how-i-built-an-mcp-server-for-praxis-5001.md`）。
