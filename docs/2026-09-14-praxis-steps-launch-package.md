# /praxis-steps（S1）上线包

**状态：已打包，未发布。** 本地全链路验证通过（静态自检 + 真浏览器冒烟 + 内容协商），**未部署、未提交**。
**建立日期：2026-09-14**

---

## 一、待部署文件

**新建（未跟踪）**

| 文件 | 说明 |
|---|---|
| `site/praxis-steps.html` | 页面本体。三块 JSON-LD 静态直出（Article / FAQPage 13 条 / BreadcrumbList 三级纯文本）；已含全站统一的 `favicon.svg` + `apple-touch-icon.png` |
| `site/md/praxis-steps.md` | `Accept: text/markdown` 镜像，由 `tools/html-to-md.mjs` 生成（非手工，可重复生成） |
| `site/images/praxis-steps.png` | 1200×630 分享卡，复用站内制式版式（同 `gen-article-images.js` 的 SVG 模板） |

**改动（已跟踪）**

| 文件 | 改动 |
|---|---|
| `site/sitemap.xml` | +1 条 `/praxis-steps`（weekly / 0.8），36 → 37 条 |
| `worker-src/content.mjs` | `MD_ROUTES` 增加 `'/praxis-steps'` |
| `tools/html-to-md.mjs` | `PAGES` 增加 `'praxis-steps'`（保证 md 可被 `npm run build:md` 重生成，不漂移） |
| `site/_worker.js` | `npm run build:worker` 产物，198.8kb |

> ⚠️ `site/_worker.js` 编译自 `worker-src/` 的**全部**当前状态，其中包含其他并行会话的未提交改动。
> 上线前用 `git status` 确认工作区，避免把别人的半成品带上线。

---

## 二、上线命令

```bash
cd E:/Triumph/praxis-5001
npm run build:worker                       # 必需：刷新 _worker.js 产物
node tools/deploy-state.mjs                # 部署前基线
node "C:/Users/abc27/AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/bin/wrangler.js" \
  pages deploy site --project-name triumph --branch main --commit-dirty=true
node tools/deploy-state.mjs                # 部署后核对
```

**部署后必做**

1. 线上冒烟：`node .qa-tmp/qa-steps.mjs` 改为打线上域名跑一遍（或手工开 `/praxis-steps` 两视口看一眼）。
2. 内容协商线上验证：`curl -H "Accept: text/markdown" https://learndiag.com/praxis-steps | head`。
3. sitemap 提交（GSC / IndexNow）—— `/praxis-steps` 已就位，无需再改文件。
4. 看板回写 S1 状态。

---

## 三、上线前置决策（需要老户定）

### P0-1：`/praxis-5001-vs-8000-series` 与本页口径冲突

既有对比页（HTML + `site/md/` 镜像**两处**）写着：

> "category-level testing through Praxis Steps **launches for the 8002–8005 tests in September 2026**, with the 8006
> Teaching Reading following in **2027** … ETS's own wording also matters: the modular option applies 'if your state
> accepts' the redesigned tests — **so far, states have not announced adoption dates**."

与本页实测冲突两点：

1. **时态**：对比页说 9 月"将上线"，本页实测 `available now`（2026-09-14）。
2. **州采用**：对比页说"尚无州公布采用"，本页实测 **West Virginia 已采用**并列出全部 11 个 Step 代码与 $39.50 单价（官方州页原文）。

**建议：S1 上线时同步改对比页那 3 句**（约 60 词的改动）。理由：这是硬事实冲突，且本页有官方源；
两页同时在线会自相矛盾，而这是老户最介意的准确性问题。
改的话**必须连 `site/md/praxis-5001-vs-8000-series.md` 一起改**（md 是 AI 爬虫读的那份）。

### P0-2：反向内链

站内目前**没有任何页面链向 `/praxis-steps`**（新页是孤岛，不利于收录）。
建议在 `/praxis-5001-vs-8000-series` 的 "What Praxis Steps Changes" 一节、
以及 `/praxis-8006-teaching-reading` 相关段落各加一条指向 `/praxis-steps` 的内链——
正好与 P0-1 的同一次改动合并执行。

---

## 四、验证证据（2026-09-14，本地）

**静态自检** `node .qa-tmp/verify-steps.mjs` → **ALL PASS**

- JSON-LD 3 块均可解析；题型齐备 Article + FAQPage + BreadcrumbList
- FAQ 可见 13 条 = JSON-LD 13 条，**题干与答案全文逐字一致**（唯一差异是 `[n]` 引用标记，JSON-LD 侧不带）
- `datePublished` = `dateModified` = `2026-09-14` = 正文 `Last verified`
- 站内链接 8 个全部命中本地文件；`/praxis-8000-series-state-requirements` 死链已清除
- `<script>` 10/10、`<style>` 2/2、`<article>` 1/1 配平
- 18 个关键数字/代码在 HTML 与 md 两侧一致
- sitemap 37 条 `<loc>` = 37 条 `<url>`，以 `</urlset>` 收尾

**真浏览器冒烟** `node .qa-tmp/qa-steps.mjs`（1440×900 与 390×844 双视口）→ **ALL PASS**

- `pageerror` 两视口均为空；`article` 渲染高度 12657px / 23925px
- **横向留白回归面**：三个 `.wrap`（nav / article / footer）
  1440 视口 `left=340 width=760 padL=40px` 三者一致；390 视口 `left=0 width=390 padL=50px` 三者一致；
  **无一处横向 padding 被清零**，无横向溢出
- WV Step 表 12 行（1 表头 + 11 数据）× 4 列
- `og:image` / `canonical` 指向自身；8006 内链 200

**内容协商** `node .qa-tmp/negotiate-check.mjs` → **ALL PASS**（9 组 Accept 组合 + 既有页面回归）

**站内测试套件** `npm run test:all` → 全段通过，GA 守卫 **48/48**、babel 守卫 5/5

**发布前事实复核**（2026-09-14 实时）

- ETS 三个来源 URL 全部 200；`/test/8002.html` 与 `/test/8006.html` 已 **301** 到新 slug，
  来源表已直接指向最终 URL
- WV 州要求页为 JS 渲染，`curl` 拿不到 Step 列表——**必须用无头浏览器渲染后取 DOM**。
  渲染后确认：11 个 Step 代码与名称、$39.50 单价、$149.49 / $199.52 批量价、
  全科 Qualifying score（8002=152、8003=152、8004=147、8005=143）、Step 无 cut score

---

## 五、本轮新增的写作增强（相对 v2 草稿）

- **WV Step 对照表**：11 行，`全科（州线）| Step 代码 | Step 名称 | Step 单价`。
  这是站内目前**唯一一处已核实的州线数据**（此前全站零州线）。
- 死链段落改为："Every Steps adoption finding we have verified is listed on this page…
  We do not treat a missing listing as proof of non-adoption"——无链接、无虚假承诺。
- 来源表 [4][5] 指向 301 后的最终 URL。

---

## 六、顺手发现的既有问题（本轮未改）

1. **`praxis-8006-practice.html` 与 `praxis-8006-teaching-reading.html` 缺全站统一的两个 icon 标签**
   （`favicon.svg` / `apple-touch-icon.png`）。全站 45/48 页有，缺的正好是 8006 生成器产出的那两页
   ——生成器没带这两个标签。`node tools/patch-seo-heads.mjs` 可幂等补齐，但它**扫全站 `site/*.html`**，
   会同时改动并行会话正在编辑的文件，需挑工作区干净的时机跑。
2. **`praxis-8006-teaching-reading.html` 的 md 镜像不在生成器白名单里**
   （`tools/html-to-md.mjs` 的 `PAGES` 没有它），意味着它的 md 靠手改维护，容易与 HTML 漂移。
   可考虑把该页也加进 `PAGES`（本页已加）。
3. `patch-seo-heads.mjs` 会把 `og:image` 里的 `og-image.png` 归一为 `og-image-learndiag-v1.png`，
   但**不动文章专属图**——本页用的是 `praxis-steps.png`，重跑该脚本不会被改。

