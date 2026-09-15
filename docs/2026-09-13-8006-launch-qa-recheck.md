# 8006 上线质检 · 复核报告（2026-09-13）

- **质检对象**：`/praxis-8006-teaching-reading`（标杆页）、`/praxis-8006-practice`（练习页）
- **环境**：生产 `https://learndiag.com`，无头 Chromium 真实点击 + 只读抓取
- **时间**：2026-09-13 12:49–13:05（东八区）
- **上游**：同日 11:40 已有一份 D7 报告 `docs/2026-09-13-8006-launch-qa.md`
- **本报告的性质**：**独立复检**。不复用 D7 的结论，全部重新取一手证据；发现与 D7 不一致处逐条标注。
- **结论**：**不通过 — 1 项 P0 阻断，另有 1 项 P1 为 D7 报告误判（练习页 GA4 为零）**

> ⚠️ **2026-09-13 13:50 更新（本报告之后的状态，勿误读为「仍未修」）**：
> 本报告的 **P0-1（文章页 mini test 点击崩溃）已在本地修复并端到端复验通过，但尚未发布**——
> 线上仍是「点了白屏」。改动与证据见 `drafts/2026-09-03-praxis-8006-page-spec.md` §10，
> 回归测试 `tools/test-quiz-8006.mjs`（`npm run test:quiz8006`）。**P1-1（练习页零 GA4 收数）仍未处理。**

> ✅ **2026-09-13 14:55 更新（本报告全部 P0/P1-N1 现状）**：
> 1. **P0-1 已发布**：2026-09-13 06:30 UTC 部署到生产（`branch main`），线上 `quiz-8006.js` md5 与本地一致，
>    真浏览器复验点击后 `#mini-test` innerHTML 903 → **2046**、`pageerror` 为空。
> 2. **P1-1（练习页零 GA4）已本地修复并网络层验证**：给 `site/praxis-8006-practice.html` 补上与其余 46 页一致的
>    GA 片段；**headless Chrome NetLog A/B 实测：修前（HEAD 版本）`gtag/js` 0 次、GA4 `/g/collect` 0 次；
>    修后 `gtag/js` 正常加载、`/g/collect` 48 次**（对照页 `practice.html` 36 次）。
>    新增守卫 `tools/check-ga-coverage.mjs`（`npm run check:ga`，已并入 `test:all`）——47 页要素齐备，
>    且用修复前的真实文件验明该守卫会红（**不是摆设**）。**此页修复尚未发布**，
>    线上 `/praxis-8006-practice` 目前仍为零收数（`curl … | grep -c googletagmanager` → 0）。
> 3. **P1-2 / P1-3（移动端两项）已本地修复并实测验证**：
>    ① 给文章页 4 张表补上 `.table-scroll` 包裹（站内既有惯例，47 页里 21 页早已这么写，8006 两页是漏网的）；
>    ② 把 `.nav` 的 `padding:28px 0 24px` 简写拆成 `padding-top/padding-bottom`，不再覆盖 `.wrap` 的横向 padding。
>    **实测（390×844）**：导航与正文错位 **50px → 0**；文章页越界元素 18 个、其中「被裁死」**18 → 0**（全部转为可横滑，
>    容器 `scrollWidth=383 / clientWidth=290` → 可横滑 93px）；1440px 桌面回归 0 越界、0 错位。
>    ⚠️ **这两项不是 8006 独有**：全站扫描发现 **20 页**有同样的 50px 错位（清单见 §3.3），本次只修了 8006 两页，
>    其余 18 页**待确认后统一处理**（改的是全站共用的那段内联 CSS，动它会让 20 页导航视觉一起变化，故先请示）。
>    **同样尚未发布。**

> 开工前提：已读 `AGENT.md` 与 `docs/会话锁.md`（空闲）；`git status` 有 106 个未提交改动（老户常态），**未 commit**；所有写操作仅限新建报告文件。

---

## 0. 结论速览

| # | 检查项 | 结果 | 与 D7 的关系 |
|---|---|---|---|
| **P0-1** | 文章页 mini test 点击即崩溃 | ❌ **不通过** | D7 已报，**本轮一手复现，成立** |
| **P1-N1** | 练习页 GA4 收数为零 | ✅ **已修（本地已验，待发布）** | **D7 判「双写一致」，实为误判** ← 本轮纠错 |
| P1-2 | 390px 表格溢出 43px 且无法横滑 | ✅ **已修（本地已验，待发布）** | D7 已报，**复现成立** |
| P1-3 | 移动端导航与正文错位 50px | ✅ **已修 8006 两页（其余 18 页待批）** | D7 已报，**复现成立** |
| P2-1 | 文章页 Title 68 字符 | ⚠️ 不达标 | D7 已报；本轮补充：**站级 13/47 页超标** |
| P2-2 | 练习页零结构化数据 | ⚠️ | D7 已报，**复现成立** |
| P2-3 | 练习页无 `<noscript>` | ⚠️ | D7 已报，**复现成立** |
| P2-4 | `/favicon.ico` 404 | ⚠️ | 本轮新增 |
| C1 | 静态正文可见 | ✅ 通过 | — |
| C2 | Title/H1 单一主意图 | ✅ 通过 | — |
| C3 | FAQ 与正文一致 | ✅ 通过（9 = 9 逐字） | — |
| T1 | canonical 唯一自指 | ✅ 通过 | — |
| T2 | 已进 sitemap | ✅ 通过 | — |
| T3 | 内链可达 | ✅ 通过（7/7 = 200） | — |
| T4 | 结构化数据（文章页） | ✅ 通过 | — |
| **F1** | 练习页 guest 端到端 | ✅ **通过** | D7 判通过，**复现成立** |
| **F6** | 埋点双写 | ⚠️ **文章页通过；练习页 GA4 侧为零** | 见 P1-N1 |

**排除项（老户已确认，不参与判定）**：`.webmcp/bridge.js` 注入（GEO 有意接入）、同页 3 个 GA4 标识同时收数（`G-MSR1Q1G7W9`/`G-41BNJXYJFD`/`G-EJ5Q2X9NBS`，另行排期）。本轮不做来源深挖。

---

## 1. P0-1 · 文章页 mini test 点击即崩溃（阻断）

**一手复现证据**（无头 Chromium，1440×900）：

```
点击前  #mini-test innerHTML 长度 = 903
点击后  #mini-test innerHTML 长度 = 0      ← 空白框
点击后  innerText 长度        = 0
pageerror: TypeError: Cannot read properties of undefined (reading 'subtest')
```

按钮定位：`<button>Start the mini test</button>`，`#mini-test` 容器存在且点击前非空 → 排除「入口没渲染」。

**根因**（`site/js/quiz-8006.js`，类型约定相反）

| 行 | 代码 | 问题 |
|---|---|---|
| L27 | `var order = []; // question ids in presentation order` | 注释说是 **id 数组** |
| L72 | `order = order.concat(shuffle(g[d] \|\| []))` | 实际塞进去的是**题目对象** |
| L147 | `var q = BANK.filter(x => x.id === order[pos])[0]` | 拿 **id 比对象** → 恒 `undefined` |
| L154 | `el('span', null, q.subtest)` | 读 `undefined.subtest` → 抛错，容器停在已清空状态 |

**线上/本地一致性**

| | md5 |
|---|---|
| 线上 `/js/quiz-8006.js` | `08ee2016f7d346502f166e7558f382ef` |
| 工作区 `site/js/quiz-8006.js` | `654e6ba3a53b87c936befbb49a3b7245` |

两版差异**仅为 D14 的 state 分桶改动**（`state.tests['8006']`），**渲染逻辑逐行相同**（比对 L27/L72/L147/L153/L162/L174 一致）。即：**不存在「本地已修、只是没部署」**。

**影响面**：文章页承诺的「30-question mini test with explanations」为空承诺；8006 侧唯一带注册/保存/恢复的表面在这个 mini test 上（练习页 `practice-8006.js` 的闸门只给 `/login` 链接，无原地注册），因此整条注册链路不可达。

**修复方向（建议，未改任何代码）**：统一 `order` 的元素类型，二选一 —— ① `buildOrder` 存 id：`order = order.concat(shuffle(g[d]||[]).map(q => q.id))`；② `renderQuestion` 直接用对象：`var q = order[pos]`。另建议**先取到 `q` 再清空容器**，避免同类异常再留白屏。

---

## 2. P1-N1 · 练习页 GA4 收数为零（**本轮纠错项** · 2026-09-13 14:55 已修复）

> **修复记录**：在 `site/praxis-8006-practice.html` 的 `</style>` 与 `</head>` 之间补入与全站 46 页一致的
> GA 片段（`G-MSR1Q1G7W9`），未改动页面其它任何内容。
> **网络层 A/B 证据（headless Chrome `--log-net-log`，非钩子）**：
>
> | 版本 | `googletagmanager.com/gtag/js` | `google-analytics.com/g/collect` |
> |---|---|---|
> | 修前（HEAD 版本，即下述零收数状态） | **0 次** | **0 次** |
> | 修后（当前工作区） | 正常加载 | **48 次** |
> | 对照：`practice.html`（5001 练习页，一直正常） | 正常加载 | 36 次 |
>
> 同理 `curl` 也能验：修前 `grep -c googletagmanager` = 0，修后 = 2。
> 新增守卫 `tools/check-ga-coverage.mjs`（`npm run check:ga`）防止再出现「唯一一页漏掉」，
> 且已用**修复前的真实文件**验明该守卫确实会报红。

**这是本轮最重要的发现，且直接推翻 D7 报告的一条「通过」结论。**

### 现象

对两页做**不钩任何东西**的纯网络观测，各走一遍完整链路：

| 页面 | 发往 `google-analytics.com` / `googletagmanager.com` 的请求 | 发往自有 `/api/t/events` | `window.gtag` | `dataLayer.length` |
|---|---|---|---|---|
| `/praxis-8006-teaching-reading` | **10 条**（`gtag/js` + 多条 `/g/collect`） | 1 条 | `function` | 5 |
| `/praxis-8006-practice` | **0 条** | 2 条 | **`undefined`** | **0** |

### 根因

1. `site/js/tracking.js:174`：`if (typeof global.gtag !== 'function') return;` —— **页面自带 gtag 才发 GA4**，否则静默早退。
2. 全站 47 个 HTML 体检：**46 个含 GA 片段，`praxis-8006-practice.html` 是唯一一个没有的**。

```
有 GA 片段: 46 / 无: 1
--- 无 GA 的页面 ---
  praxis-8006-practice.html
```

练习页的 `<script>` 清单里也没有 `gtag.js`：
`/.webmcp/bridge.js` · `/js/auth.js` · `/js/logout-btn.js` · `/js/tracking.js` · `/questions-8006-full.js` · `/js/practice-8006.js` · `/js/magic-landing.js` —— **没有任何 GA 引入**。

### 为什么 D7 会误判

D7 的 F6 结论是「GA4 侧与自有侧事件名/数量完全一致（`test_view`1 / `test_start`1 / `question_answer`5 / `test_complete`1 / `signup_prompt_view`1）」。但该结论建立在**钩 `window.gtag`** 之上——钩子**自己定义了一个 `gtag` 函数**，于是 `tracking.js:174` 的类型检查通过了，事件被记进钩子；而真实页面里 `window.gtag` 根本不存在，这些调用**没有任何去处**。

> 教训：钩子会**改变被观测对象的行为**。`tracking.js` 是「有 gtag 才发」的条件分支，钩子恰好把条件喂成了真。核验埋点必须**以网络层（是否真有请求打到 GA）为准**，钩子只能用来读载荷。

### 影响

练习页是 Phase 1 要回答「会不会练」的主战场（`test_view` / `test_start` / `question_answer` / `test_complete` / `signup_prompt_view` / `retest_start` 都在这里）。这些事件**当前在 GA4 里完全看不到**，只有自有端有数。报表口径与实际行为不一致。

### 建议

给 `praxis-8006-practice.html` 补上与其余 46 页一致的 GA 片段（复用现有 `<head>` 模板即可）。**这是对外验收口径的缺口，优先级不低于 P0**（P0 是"点不动"，这条是"动了也没看见"）。

---

## 3. P1 · 其余（D7 已报，本轮复现成立）

### P1-2 · 390px「Official Sources」表格溢出 43px 且无法横滑

390×844 视口，`article.wrap` padding `0px 50px`，视口 390：

| 表格 | 宽度 | 右边界 | 视口 | 判定 |
|---|---|---|---|---|
| #1 / #2 | 290px | 340px | 390 | OK |
| #3（7002 vs 8006） | 317px | 367px | 390 | 超出正文区（340），被裁 |
| **#4（Official Sources）** | **383px** | **433px** | 390 | **溢出 43px** |

- 父容器 `overflow-x: visible`，而 `body { overflow-x: hidden }` → **溢出被直接裁掉，用户既看不到也无法横滑**。
- 同视口下 `praxis-8006-practice` 溢出元素数 **0**（问题仅在标杆页）。
- 页级溢出量：`documentElement.scrollWidth - clientWidth = 0` —— **`scrollWidth` 看不出来**，必须逐元素比 `right > vw` 才能发现（本次全页命中 18 个越界节点）。

**修复（2026-09-13 15:20）**：`.table-scroll` 其实**站内早就有了**（`overflow-x:auto`，47 页里 21 页在用，
含全部 5001 州页与科目页），8006 文章页只是「漏了包裹」→ 给 4 张表补上同样的 `<div class="table-scroll">`（9 行 diff）。

实测（headless Chromium，390×844）：

| | 修前 | 修后 |
|---|---|---|
| 越界元素 | 18 | 18 |
| 其中**被 `body{overflow-x:hidden}` 裁死、不可滑** | **18** | **0** |
| 表格容器 | 无（`table` 直接暴露） | `scrollWidth=383 / clientWidth=290` → **可横滑 93px** |

截图验证：把容器滚到最右，`LAST VERIFIED` 列完整可见（`after-table-scrolled.png`）。
1440px 桌面回归：0 越界、0 错位，无副作用。

### P1-3 · 移动端导航与正文错位（≤760px 暴露）

390px 实测计算样式：

| 元素 | padding | 内容左边界 |
|---|---|---|
| `header.nav` | `28px 0px 24px`（横向 **0**） | 0px |
| `article.wrap` | `0px 50px`（横向 **50px**） | 50px |

导航 wordmark 贴屏幕左缘，正文缩进 50px，左对齐线不一致。根因是 `.nav` 的 `padding` 声明位于 `.wrap` 的 `@media(max-width:760px){.wrap{padding:0 50px}}` 之后，同优先级后者胜出；桌面端被 `.wrap{max-width:760px;margin:0 auto}` 掩盖，故只在窄屏暴露。

**修复（2026-09-13 15:20）**：把 `.nav` 的 `padding:28px 0 24px` 简写拆成 `padding-top:28px;padding-bottom:24px`
—— 横向 padding 交还给 `.wrap`（桌面 40px / 窄屏 50px），导航与正文左对齐线一致。
实测 390×844：**错位 50px → 0**；桌面 1440：0 错位。

### 3.3 ⚠️ 全站范围：20 页有同样的 50px 错位（**本次只修了 8006 两页**）

用 puppeteer 逐页量「导航内容左边界 vs 正文内容左边界」（390×844，本地静态站）：

| 错位 | 页数 | 页面 |
|---|---|---|
| **50px（有问题）** | **20** | alabama / free-practice-test / kentucky / maryland / new-jersey / passing-score-by-state / passing-scores / pennsylvania / registration-guide / south-carolina / subtests-explained / tennessee / virginia / vs-8000-series / 5002 / 5003 / 5004 / 5005 / **8006-practice** / **8006-teaching-reading** |
| 0px（已对齐） | 10 | about / contact / developers / four-gate-strategy / retake-guide / study-guide / vs-7001 / privacy / resources / terms |
| 不适用（无 `article`） | 4 | index / login / mistake-log / srs |

**这批页面共用同一段内联 CSS**（`padding:28px 0 24px` 出现在 34 个 HTML 里），差异在**声明顺序**：
`.nav` 排在 `@media(max-width:760px){.wrap{...}}` 之后的页面就错位，排在前面（或该页没有那条 media 规则）的就对齐。

**顺带发现的同类问题（未修，非 8006 范围）**：

| 页面 | 被裁死元素 | 最大右边界 | 说明 |
|---|---|---|---|
| `developers.html` | 69 | 564 | 表格未包裹，比 8006 严重得多 |
| `praxis-5003-math-study-guide.html` | 4 | 573 | 同上 |

> 建议：把 `padding-top/padding-bottom` 的改法 + `.table-scroll` 包裹统一推到全站（一个脚本即可）。
> **但这两处改的都是导航视觉/页面呈现，且涉及 20+ 个既有页面 → 先请示，不擅自批量改。**

---

## 4. P2

| # | 问题 | 证据 |
|---|---|---|
| P2-1 | 文章页 Title **68 字符**（惯例 ≤60） | `Praxis 8006 Teaching Reading: Format, Content & Practice \| Learndiag`；练习页 55 达标 |
| P2-1b | **站级**：47 个 HTML 中 **13 个** Title > 60（最长 82） | 见下表 |
| P2-2 | 练习页**零结构化数据**（对照：`praxis-5001-free-practice-test` 有 1 块、`diagnostic` 有 2 块） | JSON-LD 块数 = 0 |
| P2-3 | 练习页无 JS 降级：可见文本仅 **1,381** 字符，**无 `<noscript>`、无替代入口**（文章页 13,866 字符） | 去 script 抓取比对 |
| P2-4 | `/favicon.ico` 404（浏览器回落请求） | 网络层实测 |
| P2-5 | 部署漂移：线上 `quiz-8006.js` 与工作区 md5 不一致（差异为未部署的 D14 改动） | 见 §1 |

**Title 超长 TOP（站级遗留，非 8006 独有）**

| 字符数 | 页面 |
|---|---|
| 82 | `praxis-5001-free-practice-test` |
| 82 | `praxis-5001-new-jersey-requirements` |
| 74 | `praxis-5001-vs-8000-series` |
| 74 | `praxis-5004-social-studies-study-guide` |
| 70 | `praxis-5003-math-study-guide` |
| 68 | `praxis-8006-teaching-reading` |

---

## 5. 通过项（证据）

| 项 | 证据 |
|---|---|
| **C1 静态正文** | 文章页去 JS 后可见文本 **13,866 字符**（≈2,132 词）；标题、正文、表格全在静态层 |
| **C2 单一主意图** | H1 唯一：`Praxis 8006 Teaching Reading: What the Test Covers and How to Prepare`；Title 同指 8006 |
| **C3 FAQ 一致** | FAQPage `Question` **9** 条 = 页面可见 `<h3>` 问号 **9** 条，**逐字一致**（含 7002 替代、WV 用 5205、126–152 区间） |
| **事实红线** | FAQ#4 原文「There is no national passing score. Each state sets its own qualifying score. Verified 8000-series qualifying scores range from 126 to 152[2][3][6].」；FAQ#3「Adoption status in the other 48 states is not verified, and we do not publish unverified adoption claims」——**未编造分数线，未发布未核实的州主张** |
| **日期同步** | `dateModified = 2026-09-03` = 正文 `Last verified 2026-09-03` |
| **T1 canonical** | 两页各 **1** 个，绝对 URL，与实际 URL 逐字相同；`rel=alternate` 为空 |
| **T2 sitemap** | `/sitemap.xml` 200，**36** 条 `<loc>`，两条 8006 URL 均在 |
| **T3 内链** | 两页内链 `/`, `/contact`, `/diagnostic`, `/privacy`, `/resources`, `/terms`, 两页互链 —— **7/7 全部 200** |
| **T4 结构化数据（文章页）** | 3 块 JSON-LD（Article / FAQPage / BreadcrumbList）语法全合法；`@id` 引用**均有页内定义**（`https://learndiag.com/#organization`、页面自身 URL），**无悬空引用** |
| **F1 练习页 guest 端到端** | 真浏览器：`Start practicing →` → 5 题作答（`1/5`→`5/5`，含单选即时判分）→ 结果页 `0 / 5 correct (0%)` + 分领域条 + `Weakest category: Fluency & Vocabulary` → **guest 闸门**「You've used your 5 guest questions for this visit」+ CTA `/login?next=/praxis-8006-practice` → 点「Start over」**仍撞门、不进入答题**（配额真拦截）；全程 **零 pageerror** |
| **红线（练习页）** | 结果页全文无 `scaled score` / `pass probability`；代码 L399 显式声明「ETS publishes no scaled conversion for 8006」 |
| **桌面/平板** | 768px 与 1440px 下两页越界元素数均为 **0** |
| **F6（文章页）** | 网络层实测：`dataLayer` 收到 `test_view`，GA4 `/g/collect` 有请求；自有端 `{"accepted":1,"stitched":0}` —— **文章页双写成立** |

---

## 6. 复现步骤

**P0-1**
1. 打开 `https://learndiag.com/praxis-8006-teaching-reading`
2. 滚到 `Practice: Free Praxis 8006 Mini Test`
3. 点「Start the mini test」
4. 观察：容器变空白；Console 报 `TypeError: Cannot read properties of undefined (reading 'subtest')`，栈指向 `quiz-8006.js:154`

**P1-N1**
1. DevTools → Network 筛 `collect`，打开练习页并走一遍答题 → **无任何 GA 请求**；对照打开文章页 → 有 `/g/collect`
2. Console 输入 `typeof window.gtag` → 练习页 `"undefined"`，文章页 `"function"`
3. `curl -s https://learndiag.com/praxis-8006-practice | grep -c googletagmanager` → **0**

**P1-2 / P1-3**
1. DevTools 切 390×844
2. 滚到底部「Official Sources」表格 → 后两列被裁且不能横滑
3. 观察导航 wordmark 贴左缘、正文缩进 50px

---

## 7. 下一步建议

**P0（解除阻断）**
1. 修 `quiz-8006.js` 的 `order` 类型不一致。修完必须重跑：文章页 mini test 全流程 + 被阻断的 5 个事件（`result_view` / `signup_start` / `signup_success` / `study_plan_unlock` / `share_click`）。
2. 修好前**不建议把这个 mini test 入口留在线上** —— 当前是「对外可见但点了白屏」，比不提供更伤。可评估先降级为静态说明。

**P1**

3. ~~**给练习页补 GA 片段**（§2）。这条不影响「能不能用」，但影响「用了有没有被看见」——Phase 1 的「会不会练」正卡在它上面。~~
   → **2026-09-13 14:55 已完成（本地验证通过，待发布）**，详见 §2 修复记录。
4. ~~修移动端表格（横滑容器）与 `.nav` padding 覆盖。~~
   → **2026-09-13 15:20 已完成 8006 两页**（详见 §3.2 / §3.3）。**全站另有 18 页同样的错位 + 2 页更严重的表格溢出，待老户拍板后统一处理。**

**P2**

5. 站级 Title 长度治理（13 页）。注意：Title 长度按**像素**衡量，`≤60 字符` 是站内自定惯例；改的时候**必须连带 `site/md/` 镜像一起改**（MEMORY 已有此条教训）。
6. 练习页补 `<noscript>` 与最小结构化数据。

**流程建议**

本次与 D7 报告的差异暴露出一个可复用的检查项：**「页面是否真的接入了 GA4」应当在埋点验收里单独成条**，且以网络层为准。D7 的埋点验收看的是「事件有没有被调用」，而不是「调用有没有落到 GA4」——**两者在条件分支（`if (typeof gtag !== 'function') return`）存在时会分叉**。已把这条写进 `learndiag-live-qa` 技能。

---

## 8. 证据文件

| 文件 | 内容 |
|---|---|
| `.qa-tmp/recheck-out.json` | mini test 崩溃前后 DOM 状态 + pageerror + 三视口溢出 + 练习页初态 |
| `.qa-tmp/practice-out.json` | 练习页两轮流程轨迹（含误点 Redo misses 的记录） |
| `.qa-tmp/practice2-out.json` | 干净的 guest 端到端：5 题 → 结果页 → 闸门 → Start over 撞门 |
| `.qa-tmp/tracking-out.json` | 埋点载荷（钩子法，仅供读载荷） |
| `.qa-tmp/static-check.mjs` | canonical / JSON-LD / @id / sitemap / 内链 自动核验脚本 |

浏览器脚本存于 `C:\Users\abc27\.workbuddy\binaries\node\workspace\`：`qa-8006-recheck.mjs`、`qa-8006-practice2.mjs`、`qa-ga-net.mjs`、`qa-dl-probe.mjs`、`qa-nav-faq.mjs`。

---

*本报告不修改任何站点代码、不部署、不提交。所有结论来自生产环境只读抓取与真实浏览器交互。仅新建本文件与更新 `drafts/2026-09-03-praxis-8006-page-spec.md`（订正其中两处失实描述）。*
