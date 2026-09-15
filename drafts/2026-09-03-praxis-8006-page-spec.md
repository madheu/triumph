# Praxis 8006 页面技术规格（D6 交付物 2/2）

> 对应内容稿：`drafts/2026-09-03-praxis-8006-teaching-reading.md`
> 状态：**8006 文章页 + 练习页均已上线**（线上 200，静态层面已核对）｜本规格是 8002–8005 四页的模板
> ⚠️ **D14 设施接入（§5A/§5B）仅本地完成，未发布** —— 线上仍是旧的单考试行为
> ⚠️ **P0-1（文章页 mini test 点击崩溃）已在本地修复，未发布** —— 线上仍是「点了白屏」的状态，见 §10
> 建立：2026-09-03（D6）｜**修订：2026-09-13（D14 + 上线质检回填）**——清掉 4 项过期/有误项、补上设施接入与 state 分区约束、纠正 FAQ 计数、回填 P0/P1 质检结论

---

## 0. 修订摘要（读这篇先看这里）

D6 初版写在题目交付之前，因此 §5/§7 里有一批「待交付」的假设。D14 复核后，**四项已失效/有误，必须纠正**，否则后续开发会按错的现状动手：

| # | D6 初版的说法 | 2026-09-13 的实际情况 | 影响 |
| --- | --- | --- | --- |
| 1 | §7：8006 题目集「磁盘上零文件」 | ❌ **已过期**。题库已交付：`site/questions-8006.js`（mini，30 题）+ `site/questions-8006-full.js`（练习，200 题） | 模块 2/3 可验收 |
| 2 | §5：`hVerify()` 验证时无条件覆盖 state，注册后结果会丢 | ❌ **已修复**。`worker-src/accounts.mjs` 现走 `mergeStates()`（D3 修复，D14 扩展为按考试合并） | 该技术风险已消除 |
| 3 | §2：结果页 `questions_not_ready` 是「当前状态」 | ❌ **不再是当前状态**，题目已就绪 | 状态机首态改为 `idle` |
| 4 | §2/§3.2：FAQ 是「8 问／8 组」 | ❌ **计数有误**。线上页面可见 FAQ 与 FAQPage JSON-LD 均为 **9 条** | 按 9 条验收 |

另外 **D14 新增两项本规格原未覆盖的约束**（§5A、§5B）：
- **state 必须按考试分区**（否则 8006 的 answers 会覆盖 5001 的）；
- **8006 检测不到 `category` 字段**，导致全站「知识地图」类按二级分类渲染的模块对 8006 不适用。

**验收口径提醒**：§8 区分了「静态已核对」与「端到端交互质检」。后者**尚未做**，
不要因为清单上一片 `[x]` 就以为有人点过一遍。

---

## 1. 页面标识

| 项 | 值 |
| --- | --- |
| URL（文章页） | `/praxis-8006-teaching-reading` |
| URL（练习页） | `/praxis-8006-practice` |
| Title（文章页，线上实测） | `Praxis 8006 Teaching Reading: Format, Content & Practice \| Learndiag` |
| Title（练习页，线上实测） | `Free Praxis 8006 Practice Test — 200 Original Questions` |
| H1（文章页，线上实测） | `Praxis 8006 Teaching Reading: What the Test Covers and How to Prepare` |
| Title 认领的主意图 | 单一：8006 考什么。**不**同时抢「passing score」「which states」「vs 8002」—— 后者分别归 D17 / D16 |
| Meta description | 158 字符内。要点：100 min / 80 SR questions / three content categories / free practice / not affiliated with ETS |
| Canonical | `https://learndiag.com/praxis-8006-teaching-reading` |
| H1 | 与 Title 不同句（已符合）。全站只有 1 个 H1 |
| dateModified | 与正文「Last verified」同日期，且必须同步 |
| 草稿文件 | `drafts/2026-09-03-praxis-8006-teaching-reading.md` |

**Title 长度**：⚠️ **未达标**。文章页 Title 线上实测 **68 字符**（`Praxis 8006 Teaching Reading: Format, Content & Practice | Learndiag`），超出 ≤60 惯例，SERP 大概率截断。此项 **待修**。

> 更正记录（2026-09-13 质检）：本规格此前写「文章页 54 字符 · 已落地」是**错的**。经 `git log -p` 回溯，该 Title 在全部历史提交中恒为 68 字符，从未出现过 54 字符版本——应是把 H1 或别的长度误记到了这里。同期全站体检：47 个 HTML 里 **13 个** Title 超 60 字符（最长 82），属站级遗留问题，非 8006 独有。

⚠️ **练习页 Title 里的「200」是硬数字**，与 `site/questions-8006-full.js` 的题量绑定。题库扩容后必须同步改 Title、meta 与 `site/md/` 镜像——这类「数字散在文案里」的坑参考 MEMORY 的价格改动教训，改的时候脚本化。

---

## 2. 模块清单（D6 要求 7 模块，缺一不可）

| # | 模块 | 静态 HTML 是否可见 | 内容稿对应位置 | 验收点 |
| --- | --- | --- | --- | --- |
| 1 | Hero | ✅ | 标题 + 顶部免责声明 + At a Glance 表 | 考试代码 8006、官方全名、免费、无需信用卡、预计完成时间、**明确非 ETS 官方产品** |
| 2 | 可交互测试 | ✅ 静态 / ❌ **运行时崩溃** | Practice: Free Mini Test | 无 JS 时能看到题干占位；有 JS 时为完整测试（mini 30 题）。**⚠️ 2026-09-13 质检：点击即崩溃，见 §10 P0** |
| 3 | 结果报告 | ❌ 纯客户端（另见练习页） | 规格见 §4 | 总正确率 / 各领域表现 / 最弱领域 / 下一步建议。**不得输出 scaled score** |
| 4 | 考试概览 | ✅ | Is 8006 Right for You + What It Actually Tests | 考什么、内容领域、适用对象、如何确认该不该考 |
| 5 | Study plan | ❌ 纯客户端，接 D3 | 规格见 §5 | 按弱项生成，部分预览，注册后保存完整计划 |
| 6 | FAQ | ✅ | FAQ 段落 | **9 条**问答（线上实测），与正文口径一致，零矛盾 |
| 7 | 官方来源区 | ✅ | Official Sources | ETS 页 + 州页 + 归档源 + **最后核验日期** + 来源局限说明 |

**模块 2 已可验收。** D6 初版写的「题目未交付、mini test 顺延」预案已执行完毕。

---

## 3. 结构化数据

三块 JSON-LD，全部静态直出，不依赖 JS。

### 3.1 Article

```json
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Praxis 8006 Teaching Reading: What the Test Covers and How to Prepare",
  "datePublished": "2026-09-03",
  "dateModified": "2026-09-03",
  "author": { "@type": "Organization", "name": "Learndiag", "url": "https://learndiag.com" },
  "publisher": { "@id": "https://learndiag.com/#organization" },
  "mainEntityOfPage": { "@type": "WebPage", "@id": "https://learndiag.com/praxis-8006-teaching-reading" },
  "about": {
    "@type": "Thing",
    "name": "Praxis Elementary Education Fundamentals: Teaching Reading (8006)"
  }
}
```

⚠️ `dateModified` 必须与正文「Last verified」同步。事实库任何一次更新，两边一起改。这条最容易腐化，**已放进 D14 整站技术检查的 checklist**。

### 3.2 FAQPage

**9 条**，与正文 FAQ 段落**逐字一致**（Google 要求页面上看得见）。问答文本取自内容稿 FAQ 段，此处不重复粘贴，生成时从正文抽取，避免两份漂移。

> ⚠️ 计数纠错（2026-09-13）：D6 初版写「8 问／8 组」，是内容稿大纲里把最后两项合并计数的口径。
> 实测线上页面可见 FAQ 与 FAQPage JSON-LD **均为 9 条 Question**（最后两条 "When should I retake the test?"
> 与 "Is this free practice test official?" 是分开的两条）。以 **9** 为准，验收时按 9 条核。

对应 9 条：
1. What is Praxis 8006?
2. Is Praxis 8006 the same as Praxis 7002?
3. Which states require Praxis 8006?
4. What is the passing score for Praxis 8006?
5. Can I take the content categories separately?
6. How do I know if I should take 8006 or 5205?
7. When are scores released?
8. When should I retake the test?
9. Is this free practice test official?

### 3.3 BreadcrumbList

`Home > Exam Updates > Praxis 8000 Series > Praxis 8006 Teaching Reading`

⚠️ 第三级 `Praxis 8000 Series` 指向 `/praxis-elementary-education-fundamentals`（D12 总 Hub）。**D12 未上线前，该级用纯文本不带链接**，避免面包屑出现死链。

**2026-09-13 复核：D12 Hub 仍未建，线上该 URL 返回 404。** 因此这一级的处理方式（纯文本）目前是**正确且必须保持**的。D12 上线后再改成链接。

---

## 4. 结果页状态机（模块 3）

结果报告的**状态清单**——D6 是全站模板，这里定义的状态数直接决定 D8–D11 的实现量。

| 状态 | 触发条件 | 显示内容 |
| --- | --- | --- |
| `idle` | 尚未开始（题库已就绪，此为首态） | 开始按钮 + 题量/时长/领域说明（静态可见） |
| `in_progress` | 已开始，未答完 | 进度、当前题号、已答数 |
| `complete_unregistered` | 答完，未留邮箱 | 总正确率 / 各领域表现 / 最弱领域 / Week 1 计划前两项 / 重测建议日期 |
| `complete_registered` | 答完且已注册 | 上述 + 完整学习计划 + 错题记录 + 保存标记 |
| `returning_visit` | 已注册用户再次访问 | 上次结果 + 与本次对比（若已重测） |

> 初版的首态 `questions_not_ready` 保留在清单里仅作历史说明，**当前不应出现**；若线上仍能触发，说明题库加载路径有问题（见 §5B 的 bankGlobal 约定）。

**硬约束**：任何状态下都**不显示 scaled score 或 pass probability**。原因是客观的——ETS 未公布 8006 的 raw-to-scaled 换算表，任何数字都是编的。**2026-09-13 线上复核：文章页明确写着「we do not offer a scaled score calculator for this test」，红线已落地，实现时不得违背。**

**最弱领域的判定规则**（30 题样本下的边界）：
- 按领域正确率排序，取最低者。
- 并列时，按官方权重高者优先（Foundational Literacy Skills 40% > Fluency and Vocabulary 30% = Comprehension and Written Expression 30%）。
- 三个领域正确率相同时，**不输出「最弱领域」**，改输出「三个领域表现接近，建议均衡复习」。样本太小时不要假装有区分度。

---

## 5. Study plan 与 D3 注册链路的接入点

本页不自行实现注册。它调用 D3 交付的统一注册组件。契约如下（D3 实现，本页遵守）：

```
RegistrationComponent({
  context: "8006_mini_test",
  payload: {
    test_code: "8006",
    score_pct: <number>,
    weakest_domain: <string|null>,
    domain_scores: { "Foundational Literacy Skills": n, ... },
    attempt_id: <string>,        // 本地生成，用于注册后回填
    client_saved_at: <ISO8601>
  },
  onSuccess: (session) => { /* 原地恢复结果，不重新测试 */ }
})
```

**三条必须满足的行为**：
1. **不跳转。** 注册在同一页面内完成，结果不清空。
2. **原地恢复。** 注册成功后 `attempt_id` 对应的结果从本地回填到账号，用户不重测。
3. **可退出。** 「稍后再说」必须存在且不遮挡结果。

### 5.0 ✅ 原「技术风险」已解除（2026-09-13 更正）

> D6 初版此处标记了一个阻塞：`hVerify()` 验证成功时**无条件覆盖**用户 state，导致「注册后结果丢失」。
> **该风险已修复，不再是阻塞。**

现状（`worker-src/accounts.mjs`，2026-09-13 实测）：

```js
// D3 core fix — merge two diagnostic states instead of letting one clobber the other.
// Before this function existed, hVerify unconditionally overwrote the server state
// with a fresh empty shell, silently destroying a user's completed diagnostic...
export function mergeStates(a, b) {
  const NA = normalizeState(a);
  const NB = normalizeState(b);
  const createdAt = Math.min(NA.createdAt || Infinity, NB.createdAt || Infinity);
  const tests = {};
  for (const code of new Set([...Object.keys(NA.tests), ...Object.keys(NB.tests)])) {
    tests[code] = mergeBuckets(NA.tests[code], NB.tests[code]);
  }
  const prefs = { ...NA.prefs, ...NB.prefs };
  return { v: 2, createdAt: …, updatedAt: Date.now(), prefs, tests };
}
```

`hVerify` 与 `hStatePut` 都走 `mergeStates`，**合并语义已成立**，D3 要消灭的「找不到刚才的结果」在后端层面不复存在。

**D14 的扩展**：合并现在是**按考试分别进行**的（见 §5A），两门考试不再争抢同一个 `answers` 数组。

**残留验收点**：前端在注册成功后是否正确调用了 `syncPush`（把本地 pending 结果推上去），仍属 D3 的实现范围，此处只标记。

---

### 5A. 【D14 新增】state 必须按考试分区

**背景**：8006 上线前，全站 state 是**单考试扁平结构**：

```
{ createdAt, answers[], mastery{}, plan, srs{}, tasks{} }
```

`mergeStates` 按 `answers.length` 判「富者胜」并整份覆盖。这意味着：一个账号同时做 5001 和 8006 时，**后写的那份会整份盖掉前一份**——8006 的 30 条 answers 会顶掉 5001 的几百条。

**D14 已实施的分区结构（v2）**：

```
{
  v: 2,
  createdAt, updatedAt,
  prefs: { … },                    // 全局，不分区（主题/字号等设备级偏好）
  tests: {
    "5001": { answers[], mastery{}, plan, srs{}, tasks{}, examDate },
    "8006": { answers[], mastery{}, plan, srs{}, tasks{}, examDate }
  }
}
```

**对 8006 页面实现的硬约束**：

1. **读写 state 一律走 `tests["8006"]` 桶**，不要碰顶层字段。`quiz-8006.js` 已将 `attempt_8006` 写入 `st.tests['8006']`（含旧结构兜底），照此办理。
2. **不要写迁移脚本。** 服务端 `normalizeState()` 做「读时升级」——旧扁平结构读出来自动归到 `tests["5001"]`。惰性迁移，零批量改 KV。
3. **`prefs` 不分区**（全局共享），但 **`examDate` 分区**（考试日期天然是按考试算的）。
4. **本地存储键要带后缀**：5001 沿用 `triumph_*`（历史键名，零迁移）；8006 用 `triumph_8006_*`。这样两门考试的本机数据不会串。
5. **当前考试由 `triumph_test_code` 这个键承载**（`tracking.js` 写入、`test-switcher.js` 读写、`auth.js` 读取），全站唯一来源，别各页自己造。

**回归保障**：`npm run test:d14` → `test-state-partition.mjs`（31 项，服务端分区）、`test-auth-sync-d14.mjs`（23 项，前端同步层）。

---

### 5B. 【D14 新增】8006 无 `category` 字段 —— 影响「知识地图」类模块

**事实**：8006 题库的字段是 `id, code, subtest, q, options, answer, explain, dex` —— **没有 `category`**。
5001 题库有 `category`（11 个二级分类），全站的「知识地图」模块按它做下钻。

**后果**：任何「按 category 聚合」的模块（典型是 `dashboard.html` 的 Knowledge map）**对 8006 不适用**，直接渲染会：
- 抛 `Cannot read properties of null`（若未做兜底），或
- 画出一张全是「—」的空格子（看起来像坏了）。

**D14 采用的处置**（已实现，作为 D8–D11 的模板）：
- 知识地图降级为**按内容领域（`subtest`）聚合**，而不是二级分类；
- 领域名从**注册表**取，不从题库猜（见下）；
- 文案相应改为 "practice each content domain to light it up"，不沿用 "topic"。

**领域名的唯一数据源 = `site/js/test-registry.js`**：

```
8006 domains: FLS Foundational Literacy Skills (weight 3)
              FLV Fluency and Vocabulary        (weight 2)
              CWE Comprehension and Written Expression (weight 2)
```

⚠️ **契约**：注册表里 `domains[].name` 必须与题库 `question.subtest` **逐字一致**。改名任一侧而不同步另一侧，会让题量统计静默归零。`test-test-registry.mjs` 做双向校验（注册表→题库、题库→注册表）。

**题库全局变量的坑（D14 实测发现并已修）**：
8006 磁盘上有**两个**题库变量：

| 变量 | 题量 | 谁在用 |
| --- | --- | --- |
| `DM_BANK_8006` | 30（FLS 12 / FLV 9 / CWE 9） | `quiz-8006.js` 的 mini test |
| `DM_BANK_8006_FULL` | **200**（FLS 80 / FLV 60 / CWE 60，恰为 40/30/30） | `practice-8006.js` 的练习页 |

注册表的 `bankGlobal` **必须指向 `DM_BANK_8006_FULL`**，因为那才是用户实际刷得到的量，也是练习页 Title 对外承诺的「200」。初版注册表误指向 mini 的 30，导致仪表盘题量与线上文案自相矛盾——**已修正**，并加了 `bankGlobalAliases: ['DM_BANK_8006']` 做兜底（主库未加载时退回）。

**新增考试时的 checklist**：页面上要用的题库变量必须被该页 `<script>` 真正加载；`srs.html` 初版只引了 `questions.js`，切到 8006 会拿到空卡组——已补引 `questions-8006-full.js`。

---

## 6. 静态直出要求（无 JS 也要能看到内容）

- 模块 1 / 4 / 6 / 7 全部为静态 HTML，不依赖 React 或任何客户端渲染。
- 模块 2 的题干与基础说明静态可见；交互层（答题、判分）在 JS 就绪后增强。
- 参照 `site/diagnostic.html` 的 `seo-about` / `seo-block` 两段式做法：正文在 `<body>` 里直出，React 只接管交互区。

---

## 7. 当前阻塞与顺延（2026-09-13 复核）

| 项 | 状态 | 处置 |
| --- | --- | --- |
| 8006 题目集 | ✅ **已交付** | mini 30 题（`questions-8006.js`）+ 练习 200 题（`questions-8006-full.js`）。经 D5 验收后已接入 |
| D12 总 Hub | ❌ 未建（`/praxis-elementary-education-fundamentals` 实测 404） | 面包屑第三级保持纯文本不带链接 |
| D3 注册组件 | ⚠️ 后端合并语义已就绪（§5.0），前端接入待完成 | 本页 Study plan 的注册后行为仍依赖它，先做未注册分支 |
| 8000 系列其余四科（8002–8005） | ❌ 未建 | 本规格是它们的模板；结构不动，只换事实层 |

**不用 5001 旧题凑数。** 5001 的内容领域与 8006 不对应（一个是分科内容考试，一个是阅读教学专业考试），拿旧题冒充新考试会直接砸招牌。

---

## 8. 验收清单（D6 DoD）

**标记约定**（2026-09-13 加，避免把"我 grep 过"当成"有人点过一遍"）：

| 标记 | 含义 |
| --- | --- |
| `[x]` | 已核对：静态抓取线上页 / 读源文件 / 有自动化测试覆盖 |
| `[L]` | **仅本地改动，未发布** —— 线上还不是这个状态 |
| `[ ]` | **未做**（含未做的端到端交互质检） |

> ⚠️ **本清单尚未包含「端到端交互质检」**：即用真实浏览器把 mini test / 练习页从开始做到出结果，
> 核对最弱领域、免费额度拦截、注册回填等**运行时行为**。上面所有 `[x]` 都是**静态层面**的核对
> （HTTP 状态码、HTML 内容、结构化数据、代码路径 grep），**不能替代**点一遍。
> 建议用 `learndiag-live-qa` 技能跑一次无头浏览器真实交互来补齐这一档。

### 8.1 内容与 SEO（静态已核对）

- [x] 静态 HTML 可见核心正文（模块 1/4/6/7）
- [x] Title/H1 只认领一个主意图
- [ ] **Title 长度 ≤ 60 字符 —— 不达标**（文章页线上实测 **68**；练习页 55 达标）。见 §1 更正记录
- [x] canonical 唯一且自指（实测各 1 个，绝对 URL 与真实 URL 完全一致；`rel=alternate` 为空）
- [x] 内链可达（两页内链 7 条全部 200）
- [x] 已进 sitemap（`/sitemap.xml` 36 条 `<loc>`，两条 8006 URL 均在）
- [x] 三块 JSON-LD 均存在：Article + FAQPage + BreadcrumbList（线上实测各 1 块）
- [x] 9 条 FAQ 与正文逐字一致（页面可见数 9 = FAQPage Question 条目数 9）
- [x] 页面每条事实都有来源，来源区列出核验日期
- [x] 顶部免责声明原文照写（实测含 "Not affiliated with ETS"）
- [x] 「Praxis 8006」全篇带 Praxis 前缀（PECT 8006 冲突）
- [x] dateModified = `2026-09-03`，与正文 "Last verified 2026-09-03" 同步
- [ ] 三块结构化数据过 Google Rich Results Test（需人工在 Google 工具里跑，我没跑）
- [ ] 移动端真机表现

### 8.2 题库与结果页

- [x] 练习页题量与题库实数一致（线上 `questions-8006-full.js` 实测 200 条，Title 承诺 200）
- [x] 题库领域名与注册表逐字一致（双向校验自动化，46 项）
- [x] 注册表 `bankGlobal` 指向练习题库而非 mini 题库（防漂移断言已加）
- [x] 结果页代码路径不含 scaled score / pass probability（`practice-8006.js` 第 7、399 行显式拒绝）
- [x] 最弱领域逻辑存在且有样本护栏（`per[d].total < 3` 才参与判定，防小样本编出区分度）
- [x] **端到端（练习页）**：2026-09-13 真浏览器跑通 —— 5 题作答 → 结果页 `0 / 5 correct` + 分领域 + 最弱项 → guest 闸门弹出（CTA `/login?next=/praxis-8006-practice`）→ Start over 仍撞门（配额真拦截）→ 全程无 `scaled score` / `pass probability`
- [x] **端到端（文章页 mini test）**：**2026-09-13 已修复**（本地未发布）—— 真浏览器跑通：点击 Start → `#mini-test` innerHTML `903 → 2252`（修复前为 `0` 空白框）；逐题作答 **30/30 无重复、无遗漏**；结果页 `27% of 30 practice items correct` + 分领域 + 最弱项；`pageerror` 为空。回归测试 `npm run test:quiz8006`（6 项）
- [ ] 注册成功后结果回填（依赖 D3 前端接入，见 §5.0 残留验收点）—— P0-1 修复后链路已可达，但注册需真实邮箱，未在本地跑

### 8.3 D14 新增（设施接入）—— ⚠️ 全部仅本地，未发布

- [L] state 按考试分区，8006 与 5001 互不覆盖（31 项服务端测试 + 23 项前端测试通过）
- [L] 旧扁平 state 读时自动升级，无需迁移脚本
- [L] 本地存储键按考试加后缀，两门考试不串数据
- [L] 设施页（错题本 / SRS / 学习计划 / 仪表盘）支持考试切换
- [L] 知识地图对无 `category` 的考试降级为按领域聚合，不抛错、不画空格子
- [L] 仪表盘题量、子科网格、弱项「gate」名称均按当前考试派生（7 项测试通过）
- [ ] 发布到线上后复验（部署会把并行会话的未提交改动一起带上线，发布前需确认工作区）

### 8.4 待 D8–D11 复用本模板时验证

- [ ] 换事实层后结构零改动（本规格的模板承诺）
- [ ] 新考试的 `bankGlobal` 指向的题库已被相关页面加载
- [ ] 新考试的领域名与题库 `subtest` 逐字一致

---

## 9. 附：本规格涉及的文件

| 文件 | 作用 |
| --- | --- |
| `site/praxis-8006-teaching-reading.html` | 文章页（模块 1/4/6/7） |
| `site/praxis-8006-practice.html` | 练习页（模块 2/3） |
| `site/js/quiz-8006.js` | mini test 逻辑（读 `DM_BANK_8006`） |
| `site/js/practice-8006.js` | 练习页逻辑（读 `DM_BANK_8006_FULL`） |
| `site/questions-8006.js` | mini 题库（30 题） |
| `site/questions-8006-full.js` | 练习题库（200 题） |
| `site/js/test-registry.js` | **领域定义唯一数据源**（D14 新增） |
| `site/js/test-switcher.js` | 考试切换器（D14 新增） |
| `worker-src/accounts.mjs` | state 分区与按考试合并（D14 改造） |
| `site/js/auth.js` | 前端同步层，本地键分区（D14 改造） |
| `tools/test-state-partition.mjs` | 服务端分区回归（31 项） |
| `tools/test-auth-sync-d14.mjs` | 前端同步层回归（23 项） |
| `tools/test-test-registry.mjs` | 注册表与题库一致性回归（46 项） |
| `tools/test-dashboard-multitest.mjs` | 仪表盘多考试派生回归（7 项） |
| `tools/test-quiz-8006.mjs` | 文章页 mini test 端到端回归（6 项，P0 修复配套） |

运行回归：`npm test`（全站 152 项）+ `npm run test:d14`（D14 专项 107 项）+ `npm run test:quiz8006`（8006 mini test 6 项）。一条命令跑全部：`npm run test:all`。

---

## 10. 上线质检回填（2026-09-13）

完整报告：`docs/2026-09-13-8006-launch-qa-recheck.md`（真浏览器只读复检，未部署）。

### P0-1 · 文章页 mini test 点击即崩溃（阻断）

| 项 | 实测 |
| --- | --- |
| 容器 `#mini-test` innerHTML | 点击前 903 → **点击后 0**（空白框） |
| 页面异常 | `TypeError: Cannot read properties of undefined (reading 'subtest')` |
| 根因 | `site/js/quiz-8006.js`：L72 `order` 存的是**题目对象**，L147 却用 `x.id === order[pos]` 拿 **id 比对象** → 恒 `undefined` |
| 复现率 | 100%（本地与线上同一逻辑，两版 md5 差异仅为 D14 的 state 分桶，**不含渲染逻辑**） |

**影响**：文章页对外承诺的「30-question mini test with explanations」是空承诺；8006 侧唯一带「注册 → 保存 → 恢复」的表面就在这个 mini test 上，因此整条注册链路不可达。

#### 修复（2026-09-13，**仅本地，未发布**）

| 项 | 内容 |
| --- | --- |
| 改动 | `site/js/quiz-8006.js` → `buildOrder()` 改为 `shuffle(g[d]).map(q => q.id)`，让 `order` 真正装 id（符合该变量声明的语义） |
| 加固 | `renderQuestion()` 新增缺题兜底：取不到 `q` 时渲染可见错误提示 + `console.error`，把「静默白屏」变成「有提示」，且不掩盖真错 |
| 备份 | `backups/P0-quiz8006-order-20260913/quiz-8006.js.bak` |
| 回归测试 | `tools/test-quiz-8006.mjs`（6 项，`npm run test:quiz8006`）—— 用最小假 DOM **加载真实 quiz-8006.js** 并模拟真实点击路径，不是复制逻辑 |
| 端到端复验 | 本地静态服务 + 无头 chromium：点击后 innerHTML `903 → 2252`；30 题全走完且无重复；结果页正常；`pageerror` 为空 |
| 未做 | 发布。部署会把并行会话的未提交改动一起带上线，发布前需确认工作区 |

### P1-1（**本规格此前未覆盖**）· 练习页零 GA4 收数

- `praxis-8006-practice.html` 是全站 47 个页面里**唯一没有 GA 片段**的页面。
- `site/js/tracking.js:174` 为 `if (typeof global.gtag !== 'function') return;` → 练习页 `window.gtag === undefined`，所有事件**只发自有 `/api/t/events`，GA4 侧 0 收数**。
- 干净网络观测（不挂钩子）：练习页 GA 请求 **0** 条（对照文章页 10 条）。
- ⚠️ 上一版 D7 报告曾判「GA4 双写一致」，那是**探针伪影**——钩子自定义了 `window.gtag`，骗过了上述早退检查。此项是本规格对外验收（Phase 1「会不会练」）的口径缺口。

### 其它（详见报告）

- P1-2 文章页 390px「Official Sources」表格溢出 43px，且被 `overflow-x:hidden` 裁掉、无法横滑。
- P1-3 移动端 `header.nav` 横向 padding 被 `.wrap` 覆盖为 0，与正文 50px 缩进错位（≤760px 才暴露）。
- P2 练习页零结构化数据、无 `<noscript>`；`/favicon.ico` 404。
- 站级：47 页中 13 页 Title > 60 字符（本页 68）。
