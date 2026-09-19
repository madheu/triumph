# 重复 URL 与 noindex 修复记录 — /upgrade、/diagnostic、/practice、/dashboard

- **日期**：2026-09-19
- **触发**：老户报「/upgrade、/upgrade.html、/diagnostic、/practice 有重复 URL，/upgrade 与 /upgrade.html、/dashboard 与 /dashboard.html，总是有 noindex」
- **状态**：代码已改并全量验证通过，**尚未 commit、尚未部署**（改动未上线）

---

## 1. 线上实测基线（改动前，curl 2026-09-19 20:4x）

| URL | 状态 | meta robots | canonical |
|---|---|---|---|
| `/diagnostic` | 200 | `index, follow` | ✅ `/diagnostic` |
| `/practice` | 200 | `index, follow` | ✅ `/practice` |
| `/upgrade` | 200 | `noindex, nofollow` | ❌ 无 |
| `/dashboard` | 200 | `noindex, nofollow` | ✅ `/dashboard` |
| `/diagnostic.html` | 301 → `/diagnostic` | — | — |
| `/practice.html` | 301 → `/practice` | — | — |
| `/upgrade.html` | 308 → `/upgrade` | — | — |
| `/dashboard.html` | 308 → `/dashboard` | — | — |

**结论**
1. `/diagnostic`、`/practice` 线上**早已是 `index, follow`**。GSC 若仍报 noindex，是**旧快照**，
   走「请求编入索引」重抓即可，**不需要改代码**（与 `HANDOFF.md` 第 7 条同款教训）。
2. `/dashboard` 的 noindex 是**正确判断**（登录后应用页），保持不变。
3. `/upgrade` 是**代码里写死的 noindex**，且缺 canonical → 本次放开。
4. 重复 URL 的跳转**功能上已生效**：`/diagnostic.html`、`/practice.html` 是 worker 显式 301
   （`worker-src/worker.mjs:143-144`），其余由 **Cloudflare Pages 自动 308**（站内无 `_redirects`）。
   301/308 对 Google 均为永久跳转，**无索引风险**，只是状态码不统一、规则不可见。
5. `worker-src/` 中**没有 X-Robots-Tag 响应头**，noindex 只来自页面 meta。
6. `sitemap.xml` 未收录 `/upgrade`、`/dashboard` → 不存在「sitemap 收录了 noindex 页」的冲突。

---

## 2. 重复 URL「总是清不掉」的根因

站内有 **11 处硬编码 `.html` 形式的站内 URL**。Googlebot 会执行 JS，
这些路径每轮爬取都在把重复地址重新喂给 Google，所以 GSC 里的重复 URL 永远清不干净。

> ⚠️ **排查教训**：第一遍只搜 `--include="*.html"`，漏掉了 `site/js/*.js` 里的 3 处 CTA 链接
> （最初误报为 8 处）。**站内链接扫描必须覆盖 `site/js/`。**

| # | 文件 | 位置 | 改动 |
|---|---|---|---|
| 1 | `site/dashboard.html` | Pro 工具卡 | `"upgrade.html"` → `"upgrade"`（相对，与同页 `practice`/`srs`/`login` 写法一致） |
| 2 | `site/diagnostic.html` | 付费墙按钮 | `location.href="/upgrade.html"` → `"/upgrade"` |
| 3 | `site/drill.html` | 付费墙按钮 | 同上 |
| 4 | `site/mock-exam.html` | 付费墙按钮 | 同上 |
| 5 | `site/practice.html` | 付费墙按钮 | 同上 |
| 6 | `site/upgrade.html` | 未登录点升级 | `"/login.html?next=/upgrade.html"` → `"/login?next=/upgrade"` |
| 7 | `site/upgrade.html` | 付款确认后刷新 | `"/upgrade.html?pro=1"` → `"/upgrade?pro=1"` |
| 8 | `site/js/report.js` | 第 636 行 CTA | `'/upgrade.html'` → `'/upgrade'` |
| 9 | `site/js/practice-8006.js` | 第 157 行 Guest/Free 提示 | `<a href="/upgrade.html">Go Pro</a>` → `/upgrade` |
| 10 | `site/js/practice-8006.js` | 第 361 行用量上限 CTA | `cta.href = '/upgrade.html'` → `'/upgrade'` |
| 11 | `worker-src/billing.mjs` | 第 129 行 Creem 回跳 | `'/upgrade.html?checkout=done'` → `'/upgrade?checkout=done'` |

**第 11 项是功能问题，不只是 SEO**：付费成功后原要多经一次 308 跳转。
前端 `site/upgrade.html` 靠 `?checkout=done` 启动「付款确认中」轮询，**该 query 已保留**。

---

## 3. /upgrade 放开索引的配套改动

`site/upgrade.html`
- `<meta name="robots">`：`noindex, nofollow` → **`index, follow`**
- 新增 `<link rel="canonical" href="https://learndiag.com/upgrade">`
- 新增 `og:title` / `og:description` / `og:type` / `og:url` / `og:site_name`
  （原有 `og:image`、`twitter:*`、`description` 保留不动）

`site/sitemap.xml`
- 新增 `/upgrade` 条目（`lastmod` 2026-09-19，`changefreq` monthly，`priority` 0.6），置于 `/tools` 之后

未做（评估后认为不需要）：
- `/upgrade` **未加入 `worker-src/content.mjs` 的 `MD_ROUTES`** —— 该页是交易页，
  无可用 md 镜像；不在白名单时 worker 正常返回 HTML，不会 406。
- 未补 `upgrade.md` 镜像。

---

## 4. 同步更新的测试

| 文件 | 改动 |
|---|---|
| `test/p1-billing.test.mjs` | 第 162 行硬断言 `success_url` 改为 `https://learndiag.com/upgrade?checkout=done`；注释里的行号引用改为文件级引用 |

**未动**：`test/build-sync.test.mjs:4` 里那句 `.../upgrade.html?checkout=done` —— 那是
记录 2026-09-11「假绿」事故的**历史描述**，属于史实，保留。
`test/product-events.test.mjs` 里的 `site/upgrade.html` 是**文件名**（文件仍叫 upgrade.html），正确，未动。

---

## 5. 验证记录

| 项 | 结果 |
|---|---|
| `npm run build:worker` | `site/_worker.js` 198.8kb，产物已与 `worker-src/` 同步 |
| `npm test` | **152 / 152 通过**（含 build-sync 守卫、smoke-worker、p1-billing、agentic） |
| `npm run test:all` | 全部 `# fail 0`（+ test:d14、quiz8006 21 项、quiz8000、check:ga 57 页、check:babel 5 页） |
| 真浏览器冒烟 `.qa-tmp/qa-smoke.mjs` | **12 / 12 ✓**（dashboard/diagnostic/drill/mock-exam/practice/upgrade × 桌面 1440 + 移动 390），`htmlLen` 均 > 200，**pageerror 全为空** |
| 残留扫描 | 全站无遗漏，仅 `.mimosa/hook-state/**/*.source` 基线快照内有一处 `"/upgrade.html"` |

> `site/.mimosa/hook-state/*.source` 是**页面编辑器的改动基线快照**，
> 手改会让 hook 误判为大范围改动 —— **不要动**。

---

## 6. 上线后待办

1. **本次改动尚未部署** → 部署后重新 curl 确认：
   `/upgrade` 返回 `index, follow` + canonical；`/upgrade.html` 仍 308；sitemap 含 `/upgrade`。
2. GSC：
   - `/diagnostic`、`/practice` → 用 **「请求编入索引」** 重抓，清掉旧 noindex 快照（**不要改代码**）
   - `/upgrade` → 请求编入索引
   - 观察「重复网页，Google 选择了不同的规范网页」里 `/upgrade.html`、`/dashboard.html` 是否逐步消失
3. 未纳入本次范围（**已发现，未改**）：`worker-src/google-auth.mjs:234` 仍写
   `${base}/login.html${frag}` —— Google 登录回调后跳 `login.html` 再 308 到 `/login`，
   每次 Google 登录多一次跳转。该值**不是** OAuth `redirect_uri`（那个是 `/api/auth/google/callback`），
   改成 `/login` 属低风险，但需单独确认。
