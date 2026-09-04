# HANDOFF.md — 项目交接文档（给新智能体）

> 创建：2026-08-28（Learndiag 品牌切换 + 域名迁移完成后）
> 用途：让新接手的智能体在 5 分钟内掌握项目全貌、当前状态、关键规则、下一步。
> 重要：本文档是**最新事实**。项目里其他 .md 文档（维护手册、README-deploy、brand-spec 等）可能含**过时信息**，以本文档为准（详见第 8 节"过时信息纠正"）。

---

## 1. 一句话项目

**Learndiag**（前身品牌名 Triumph）：帮助美国小学教师资格考试 **Praxis 5001** 考生免费刷题（969 题）、做水平诊断、预测通过概率的在线备考网站。

- **产品名**：Learndiag（2026-08-28 从 Triumph 改名，用户定）
- **主域名**：`https://learndiag.com`（NS 在 Cloudflare 全托管）
- **旧域名**：`https://trytriumph.de5.net` → 现在 301 到 learndiag.com（保留，别删）
- **已退订域名**：`praxis5001.com`（用户因 ETS 商标侵权隐患主动退订并删除，勿恢复）

---

## 2. 技术栈与架构

```
E:\Triumph\praxis-5001\
├── site\                  ★ 线上网站本体（静态 HTML/CSS/JS + 数据）
│   ├── *.html             各页面（首页/登录/诊断/刷题/22 篇 SEO 文章）
│   ├── images\            22 张文章 SEO 配图（og:image，1200x630 PNG）
│   ├── _worker.js         ★ 后端大脑（由 worker-src 打包生成，勿手改）
│   ├── js\auth.js         前端认证（window.TriumphAuth，勿改技术标识）
│   ├── data\questions-api.json  题库（969 题）
│   └── .well-known\       MCP / agent-skills 声明
├── worker-src\            ★ 后端源码（拆分子模块，改这里）
│   ├── worker.mjs         总入口（含 canonical 301 逻辑）
│   ├── accounts.mjs       注册/登录/验证码
│   ├── google-auth.mjs    Google OAuth（PKCE）
│   ├── billing.mjs        Creem 支付
│   ├── admin.mjs          后台管理
│   ├── apicatalog.mjs     RFC 9727 api-catalog 文档 + 首页 RFC 8288 Link 发现头
│   └── ...                （其余模块）
├── build-worker.mjs       esbuild 打包 worker-src → site/_worker.js
├── deploy.ps1             一键部署
├── wrangler.toml          Cloudflare 配置（KV/D1 绑定、vars）
├── gen-article-images.js  ★ 生成文章 SEO 配图（SVG→PNG，sharp）
├── add-og-images.js       给文章页插 og:image/og:url
└── seo-publish.js         从 SEO/*.md 生成文章 HTML
```

**技术要点**：
- Cloudflare **Pages** 项目名 `triumph`（技术标识，不改）
- Worker 带 **canonical 301**：非 canonical host（如 pages.dev、旧域名）→ 301 → `learndiag.com`；豁免 `/api/`、`/mcp`、`/.well-known/`
- 认证：KV `users:<email>` 存 PBKDF2 哈希 + JWT（HS256，30 天）
- 邮件：**Resend**，发件人 `Learndiag <verify@learndiag.com>`（域名已验证）
- 支付：**Creem**（Merchant of Record），测试模式
- 数据：KV（用户/状态/验证码）+ D1（订单/订阅/工单/题库后台）

---

## 3. 当前状态（2026-08-28）

**已上线且验证通过**：
- ✅ 品牌 Triumph → Learndiag（全站页面显示）
- ✅ 主域名切到 learndiag.com（旧域名 301，权重迁移中）
- ✅ Google OAuth（新 Google Cloud 项目 + 新凭据，已发布到生产）
- ✅ 22 篇 SEO 文章各有专属 og:image
- ✅ Resend 域名验证 + SPF 修正（root 和 send 子域都 allow amazonses）
- ✅ Creem 品牌/域名/邮箱已改（用户手动）
- ✅ GSC 验证记录在 DNS
- ✅ Google 已收录首页（品牌词 "learndiag" 排第一）
- ✅ Agent discovery Link 头（2026-08-29）：首页响应带 RFC 8288 Link 头
  （`api-catalog`/`service-desc`/`service-doc`/`describedby` 四个关系），
  新增 `/.well-known/api-catalog`（RFC 9264 Linkset + RFC 9727 profile），
  isitagentready.com 扫描 `checks.discoverability.linkHeaders` = pass
- ✅ Content Signals（2026-08-29）：robots.txt 每个 User-agent 组都声明
  `Content-Signal: ai-train=yes, search=yes, ai-input=yes`（全允许，与站点
  公开/欢迎 AI 的定位一致；值是发布者偏好，改语义只需改这一行），
  isitagentready.com 扫描 `checks.botAccessControl.contentSignals` = pass

**进行中 / 待办**：
- ⏳ GSC：resources 页报"noindex"是旧快照，需「请求编入索引」重抓
- ⏳ GSC 提交 sitemap：`https://learndiag.com/sitemap.xml`
- ⏳ Bing Webmaster 提交同样 sitemap
- ⏳ 等 22 篇文章被 Google 收录（内容词排名 2-6 周起效）
- ⏳ 测一次注册验证码邮件（确认能收到、不进垃圾箱）
- ⏳ Google OAuth 发布已做，但建议确认外部账号（非 owner）能登录

---

## 4. 关键规则（改代码前必读，用户明确要求）

### 4.1 品牌 vs 技术标识（最重要）
**页面显示的品牌** = `Learndiag`（已全站替换完成）。
**技术标识** = 含 `triumph` 的标识，**绝不能改**，改了坏功能/丢数据：

| 技术标识 | 位置 | 为什么不能改 |
|---|---|---|
| `window.TriumphAuth` | site/js/auth.js + 所有页面 JS | 全站前端调用它 |
| `triumph_token` / `triumph_*` | localStorage keys | 改 key 丢用户登录/数据 |
| `env.TRIUMPH_KV` / `TRIUMPH_D1` | worker-src + wrangler.toml | Cloudflare 绑定名，改则崩 |
| `triumph-api` | API service 标识 | 已签发 key 兼容 |
| `triumph-6eq.pages.dev` | Cloudflare 生成子域 | 平台生成 |
| `triumph` | wrangler 项目名 / MCP server name | 部署/协议绑定 |
| `#triumph_token=` | Google OAuth 回跳 fragment | 前后端约定一致 |

> 品牌改名边界：只改"页面显示给用户的品牌文字"（title/meta/wordmark/文案/邮件模板）。详细规则见 `brand-spec.md`。

### 4.2 架构规则
- ❌ 不要手改 `site/_worker.js`（机器生成，被构建覆盖）→ 改 `worker-src/` 后 `node build-worker.mjs`
- ❌ 不要把密钥写进 `site/` 任何文件
- ✅ 部署前 `npm test` 确认 `fail 0`
- ✅ 部署用 `deploy.ps1`（内部自动构建+上传）
- ⚠️ `triumph/` 文件夹是过时旧稿，勿同步内容

### 4.3 部署环境
- 需走代理：`$env:HTTPS_PROXY='http://127.0.0.1:7890'`
- 线上验证**必须直连**（清代理 + `curl --resolve host:443:<ip>`），否则被本地代理劫持假 410
- Cloudflare Pages OAuth token 在 `C:\Users\abc27\AppData\Roaming\xdg.config\.wrangler\config\default.toml`（到期需用户重新 `wrangler login`）

---

## 5. 外部服务清单（凭据在 Cloudflare Secrets）

| 服务 | 用途 | 凭据名 | 状态 |
|---|---|---|---|
| Cloudflare Pages | 托管/域名 | （wrangler OAuth） | 在线 |
| Google Cloud OAuth | Google 登录 | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | 新项目已配 |
| Resend | 发邮件 | `RESEND_API_KEY` + `EMAIL_FROM` | 域名已验证 |
| Creem | 支付 | `CREEM_*` | 测试模式 |
| KV/D1 | 数据 | `TRIUMPH_KV` / `TRIUMPH_D1` | 在线 |

**线上环境变量**（Cloudflare 控制台 → Workers & Pages → triumph → Settings → Variables and Secrets）：
- `EMAIL_FROM` = `Learndiag <verify@learndiag.com>`
- `GOOGLE_CLIENT_ID` = `1069445820702-qpfq4s0rmpf088qsu2e22ichfaifnn3u.apps.googleusercontent.com`
- 其余为 Secrets（JWT_SECRET / RESEND_API_KEY / CREEM_* / GOOGLE_CLIENT_SECRET）

---

## 6. 关键文件与脚本

| 文件 | 作用 | 何时用 |
|---|---|---|
| `site/_worker.js` | 后端 | 部署产物，勿手改 |
| `worker-src/worker.mjs` | canonical 301 逻辑（约 L60-88） | 改域名重定向 |
| `worker-src/constants.mjs` | `BASE = 'https://learndiag.com'` | 域名相关 |
| `gen-article-images.js` | 生成文章 SEO 图 | 新增文章时 |
| `add-og-images.js` | 插 og:image | 新增文章时 |
| `seo-publish.js` | md → 文章 HTML | 发布新 SEO 文章 |
| `verify-seo.ps1` | 部署前 SEO 检查 | 部署文章前 |
| `deploy.ps1` | 一键部署 | 每次上线 |
| `docs/维护手册.md` | 运维手册（有旧信息，见第 8 节） | 运维 |

---

## 7. 常见坑（本会话踩过，别再踩）

1. **PowerShell `-match` 大小写不敏感**：查"Triumph 残留"时会把 `window.TriumphAuth` 等技术标识误判为品牌——用大小写敏感正则或 `[regex]::Matches` 区分
2. **Resend DNS 记录类型**：DKIM 是 TXT（`resend._domainkey`），SPF 在 `send` 子域——别查 CNAME/root
3. **代理劫持**：本机代理（PigLiteCore :7890）会劫持某些域名返回假 410/停放页——线上验证必须直连（清代理 + `--resolve`）
4. **Cloudflare Pages token 权限**：wrangler OAuth token 只有 Pages 权限，查不了 DNS 记录（用公共 DNS / 权威 NS 查）
5. **品牌替换保护顺序**：先保护 `window.TriumphAuth` 再替换，否则会误伤
6. **SPF 只能一条**：改已有的，别新增
7. **Google 检查工具的 noindex 可能是旧快照**：页面实际 index,follow 时，先「请求编入索引」重抓，别急着改代码

---

## 8. 过时信息纠正（旧文档里已不正确的）

| 旧文档说法 | 实际（以本文档为准） |
|---|---|
| 主域名 `trytriumph.de5.net`（维护手册/README-deploy） | 主域名是 **learndiag.com**；de5.net 已 301 |
| 品牌 Triumph（brand-spec v2、各 md） | 品牌是 **Learndiag** |
| `EMAIL_FROM = verify@trytriumph.de5.net` | `verify@learndiag.com` |
| MAILGUN 为备用发信 | 只用 Resend，MAILGUN 已不用 |
| 旧 Google Client ID `604363082038-...` | 新 Client ID `1069445820702-...` |
| pages.dev 是测试用 | 仍是，但 canonical 会 301 到 learndiag.com |

---

## 9. 下一步（新智能体接手后按此推进）

1. **GSC 收尾**：对 `https://learndiag.com/resources`「请求编入索引」；提交 sitemap `https://learndiag.com/sitemap.xml`
2. **Bing Webmaster**：提交同样 sitemap（或从 GSC 导入）
3. **验证邮件**：注册一个新邮箱测试验证码邮件（查收件箱/垃圾箱）
4. **监控收录**：等 22 篇文章被 Google 收录，关注内容词排名
5. **备份提交**：`git add -A && git commit -m "handoff snapshot"`（当前工作区有未提交的域名/品牌改动）

---

## 10. 联系方式 / 决策记录

- 产品名「Learndiag」：用户定（2026-08-28），技术标识保留 triumph 是用户明确要求
- praxis5001.com：已退订删除（商标风险），勿恢复
- 付费：Creem 审核中，免费功能全开放（<1000 用户验证期）
- 视觉系统：用户拒绝 WorkBuddy 生成的 logo SVG，不要部署/改外观
