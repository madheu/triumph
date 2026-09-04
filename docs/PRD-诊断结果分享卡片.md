# PRD · 诊断结果分享卡片（Share My Result）

| 项 | 内容 |
|---|---|
| 版本 | v1.0 |
| 日期 | 2026-08-30 |
| 提出人 | 老户 |
| 撰写 | Buddy |
| 状态 | 待评审 |
| 目标上线 | P0 建议 2026-09-12 前（见 §3 时间窗说明） |

---

## 1. 背景

### 1.1 业务背景

《5001 备考行为地图》已验证一个情绪节点：**考生通过后强烈庆祝、主动晒分**。这是全链路里唯一一个用户自发产生传播动作的时刻。

当前社区分发（《社区分发-本周执行包.md》）的核心瓶颈是：A 类可转化问题（"我 raw 分 24 能不能过"）频率低，靠人肉蹲守是线性增长，一天触达上限就是发帖数。**唯一能打破线性天花板的机制，是让用户替我们发帖。**

本需求即为此：把诊断结果做成一张可下载的卡片，让用户在 Facebook 群组、Reddit、TikTok 里主动晒，卡片自带回流入口。

### 1.2 产品背景

- 域名：learndiag.com
- 诊断入口：`/diagnostic`（12 题，四科各 3 题，约 8 分钟）
- 结果页：估计 scaled score + 最弱科目（weakest gate）+ 通过概率

### 1.3 为什么现在做

**有一个 32 天的硬时间窗。** `site/diagnostic.html:452` 存在时间闸门：

```
PAYWALL_DEADLINE = new Date('2026-10-01T00:00:00Z')
```

- 2026-10-01 前：登录即解锁完整报告
- 2026-10-01 后：仅 Pro 可见完整报告，其余显示锁定 + 升级引导

**后果**：若分享卡片在 10-01 之后才上线，免费用户看到的将是**锁定页**，无结果可晒，病毒循环直接断掉。且待收费墙生效后再补做，等于在一个月内同时叠加"开始收费"和"新增病毒入口"两个变量，无法归因。

**建议：P0 赶在 2026-09-12 前上线，留出 2 周纯免费期的干净数据用于对比。**

---

## 2. 现状核查结论（影响范围，务必先读）

动手前我逐项核了线上代码，有 5 个事实与"加个分享按钮"的直觉不符。**其中 F1、F2 是硬前置，不做就根本没有东西可分享。**

### F1 · 诊断页没有州选择器，卡片核心卖点目前无法渲染

`site/diagnostic.html:342`：

```js
function DM_passProbability(avgScore) {
  // mock: 160 is demo passing line; 140..180 maps to 5%..95%
  return Math.max(5, Math.min(95, Math.round(5 + (avgScore - 140) * 2.25)));
}
```

及格线是**硬编码的 160**，全站无任何"用户所在州"输入。

这意味着：**"告诉你离你所在州的通过线还差多少"——我们对外反复强调的唯一差异化卖点，在代码里并不存在。**

> 连带影响：《社区分发-本周执行包.md》深链映射表里，凡涉及"你州线要多少"的答案模块，目前只能导向静态州页，无法导向个性化结果。这不是文案问题，是能力缺口。

**结论：州选择器 + 州线数据是本需求的 P0 前置，不是可选项。**

### F2 · 州及格线数据只以散文形式存在于 HTML 里，无结构化存储

全库搜索 `cut_score` / `passing_score` / `state_line`：**零命中**。`db/schema.sql` 无相关表。

已核实数据（来源 `site/praxis-5001-passing-score-by-state.html:160-165`）：

| 州 | 5002 阅读 | 5003 数学 | 5004 社科 | 5005 科学 | 状态 |
|---|---|---|---|---|---|
| Virginia | 157 | 157 | 155 | 159 | 已核实 |
| Tennessee | 157 | 157 | 155 | 159 | 已核实 |
| New Jersey | 157 | 157 | 155 | 159 | 已核实 |
| Kentucky | 157 | 157 | 155 | 159 | 已核实 |
| South Carolina | 157 | 157 | 155 | 159 | 已核实，但**正在迁移到 5901/7811**，截止期 2026-08 / 2027-08 视路径而定 |

**不用 5001 的州（PA / MD / AL / NC）**：不能显示"距线差多少"，必须走另一套提示（见 FR-14）。

**结论：需新建 `state_cut_scores` 表并做一次性数据迁移。可核实州仅 5 个，其余州必须走"未核实"降级路径，禁止拍脑袋填数。**

### F3 · 诊断结果只存在 localStorage，服务端无记录

`site/diagnostic.html:485-493` 全部结果写入 localStorage：

```js
localStorage.setItem('triumph_last_score', String(avg));
localStorage.setItem('triumph_last_pass', String(passPct));
localStorage.setItem('triumph_weakest', ...);
```

无 `diagnostic_runs` 表，无任何服务端记录。

**结论：P1 的分享链接必须先落库，需新建两张表。P0（纯客户端下载 PNG）可绕开。**

### F4 · 生产环境是 Cloudflare Workers，无 Node runtime，`sharp` 不可用

- 部署目标：`site/` → Cloudflare Pages + `_worker.js`（`build-worker.mjs` 打包 `worker-src/*.mjs`）
- `sharp` 仅出现在 `package.json` dependencies 与本地构建脚本（`gen-article-images.js`），**生产环境不可用**
- 站点 OG 图目前是静态文件 `site/og-image.png`

**结论：服务端动态 OG 图不能复用 sharp，需另选方案（见 §7.3，含 spike 建议）。**

### F5 · 打分模型是 mock，晒出去的数字不可靠

`site/diagnostic.html:336-345`：

```js
function DM_estimateScore(subtestAccs) {
  const per = subtestAccs.map(a => 140 + a * 40);   // 线性映射
  ...
}
```

- 每科仅 3 题，答对率只能是 0 / 0.33 / 0.67 / 1
- scaled score = `140 + 正确率 × 40` → 只可能是 140 / 153 / 167 / 180
- 通过概率 = 线性 5%–95%，非《诊断模型设计.md》§3 设计的 logistic 模型

**风险**：用户把 "180 / 95%" 晒到教师社群里，等于我们以产品名义对外发布一个由 12 道题线性外推的数字。考生群体对分数极度敏感（行为地图里"我 raw 分 24 能不能过"是高频问题），一旦被人拆穿"这分数是编的"，砸的是招牌。

**结论：卡片设计必须扬"实测"避"建模"。详见 §6 卡片信息架构——这是本 PRD 最关键的设计决策。**

---

## 3. 目标与非目标

### 3.1 目标

| 编号 | 目标 | 衡量指标 |
|---|---|---|
| G1 | 让用户自发在社群晒结果，突破人肉分发的线性天花板 | 分享卡生成数 / 诊断完成数 ≥ 8%（首月） |
| G2 | 卡片自带回流，把曝光变新用户 | 分享带来的新访客 → 新诊断启动 ≥ 15% |
| G3 | 补齐"距州线差多少"能力缺口，而非只做一个按钮 | 州选择器使用率 ≥ 60% |
| G4 | 在收费墙生效前拿到干净的病毒循环基线 | P0 于 2026-09-12 前上线 |

### 3.2 非目标（本期不做）

- ❌ 不做排行榜 / 社交关系 / 关注
- ❌ 不做分数校准（IRT 或真实通过率回归）—— 见 §11 R1
- ❌ 不做未核实州的数据编造 —— 只做降级提示
- ❌ 不做 5002–5005 的独立分享卡（先验证 5001 单卡跑通）
- ❌ 不做视频 / GIF 卡片

---

## 4. 用户故事

| ID | 角色 | 故事 |
|---|---|---|
| US-1 | 刚考完诊断的考生 | 作为刚做完诊断的考生，我想把结果存成一张图发到备考群，这样能跟一起考的人交流进度，也能给自己留个起点标记 |
| US-2 | 使用手机的考生 | 作为手机用户，我想一键把卡片分享到 Facebook 群，而不是先下载再手动找图 |
| US-3 | 未登录用户 | 作为没登录的考生，我也想拿到卡片，不应该被强制注册才能用这个功能 |
| US-4 | 看到别人卡片的用户 | 作为群里的旁观者，我想知道这张图是哪来的、我能不能也测一下，这样我才会点进去 |
| US-5 | 已通过考试的考生 | 作为已经通过的人，我想晒"我过了"而不只是"我测了"，这样更有成就感 |
| US-6 | 非 5001 州的用户 | 作为宾州的考生，我不该看到"你距 5001 线差 X 分"，因为我州根本不考这个 |

---

## 5. 功能需求（EARS 格式）

### 5.1 州选择（P0 前置）

> **FR-1** The system shall provide a state selector on the diagnostic intro screen, before the user begins the session.
>
> **FR-2** When the user selects a state, the system shall persist the selection to `localStorage` key `triumph_state` and reuse it on subsequent visits.
>
> **FR-3** The system shall offer "Not listed / Not sure" as a selectable option in addition to the 50 states and DC.
>
> **FR-4** While no state is selected, the system shall use a default reference line of 160 and shall label all score comparisons as "vs. a typical state line (160)" rather than naming a state.
>
> **FR-5** The system shall allow changing the state from the report screen, and when the state changes the system shall recompute all comparisons without requiring re-taking the diagnostic.
>
> **FR-6** If the user selects a state whose `exam_family` is not `5001` (currently PA, MD, AL, NC, and SC during transition), then the system shall suppress all cut-score comparisons and shall instead display: "[State] does not use Praxis 5001 for elementary certification. [Link to the state's requirements page]."
>
> **FR-7** If the user selects a state with `verified_at` older than 180 days, then the system shall append "Last verified [date] — confirm with your state board before registering." to any cut score display.

### 5.2 卡片生成（P0）

> **FR-8** Where a diagnostic result exists, the system shall display a "Share my result" button on the report screen.
>
> **FR-9** When the user activates "Share my result", the system shall render a preview of the share card and shall offer two actions: "Download image" and "Share".
>
> **FR-10** When the user activates "Download image", the system shall produce a PNG file of 1080 × 1080 pixels and save it to the user's device with filename `praxis-5001-diagnostic-[YYYY-MM-DD].png`.
>
> **FR-11** Where `navigator.canShare` reports support for file sharing, when the user activates "Share", the system shall invoke `navigator.share()` with the generated PNG and the text defined in §6.4.
>
> **FR-12** If `navigator.share()` is unavailable or rejects with `AbortError`, then the system shall fall back to the download flow in FR-10 without displaying an error.
>
> **FR-13** When rendering the card, the system shall wait for `document.fonts.ready` before drawing text, and shall not draw text with a webfont that has not finished loading.
>
> **FR-14** If canvas rendering fails for any reason, then the system shall hide the share panel, display "Sharing isn't available on this browser right now." and shall emit the `share_card_render_failed` event with the error message.

### 5.3 卡片内容（P0）

> **FR-15** The card shall display the user's weakest subtest as the primary headline, in the format "My weakest gate: [Subtest Name] ([code])".
>
> **FR-16** The card shall display a horizontal bar for each of the four subtests showing measured accuracy (correct / attempted), labeled with the subtest code and short name.
>
> **FR-17** The card shall display the sample size as "Based on 12 questions" in the footer.
>
> **FR-18** Where a verified state is selected, the card shall display the gap between the estimated subtest score and the state cut score, in the format "[code] [+/-N] vs [State] line".
>
> **FR-19** The card shall display any estimated scaled score with the suffix "est." and shall render it at no larger than 60% of the size of the weakest-gate headline.
>
> **FR-20** The card shall display the Learndiag wordmark and the URL `learndiag.com/diagnostic` in the footer.
>
> **FR-21** The card shall not display the user's name, email, or any other personal identifier unless the user has explicitly entered a display name (P1, see FR-27).
>
> **FR-22** The card shall use the palette defined in §6.3 only.

### 5.4 分享链接与公开页（P1）

> **FR-23** When a diagnostic completes, the system shall POST the run to `/api/diagnostic/runs` and store the returned `run_id`.
>
> **FR-24** When the user activates "Get a shareable link", the system shall create a share card record and return a short URL of the form `https://learndiag.com/s/[cardId]`.
>
> **FR-25** The system shall generate `cardId` as 10 characters of base58 from a CSPRNG source, and shall never derive it from the user id, email, or a sequential counter.
>
> **FR-26** When a request arrives at `/s/[cardId]` with a valid id and `visibility = 'public'`, the system shall return an HTML page containing the card data and a primary CTA "Take the free diagnostic".
>
> **FR-27** Where the user has provided a display name, the system shall render it on the public page; otherwise the system shall render "A Praxis candidate".
>
> **FR-28** If the requested `cardId` does not exist or its visibility is not `public`, then the system shall return HTTP 404 with the standard 404 page and shall not reveal whether the id ever existed.
>
> **FR-29** The system shall provide a "Delete this card" control on the share panel, and when activated the system shall set `visibility = 'private'` within 60 seconds and shall stop serving the public page.
>
> **FR-30** If a user deletes their account, then the system shall set all of that user's share cards to `visibility = 'private'` in the same transaction.

### 5.5 社交平台预览图（P1，需 spike）

> **FR-31** Where `/s/[cardId]` is served, the system shall emit OpenGraph and Twitter Card meta tags pointing at a PNG image unique to that card.
>
> **FR-32** The OG image shall contain the same information hierarchy as the downloadable card defined in §6.2.
>
> **FR-33** If OG image generation fails or exceeds the Workers CPU budget, then the system shall fall back to the static `og-image.png` and shall emit `og_generation_failed`.

---

## 6. 卡片设计规格

### 6.1 为什么这样设计（回应 F5）

这是本 PRD 最重要的一节。可用的信息有两类：

| 信息 | 性质 | 可靠性 |
|---|---|---|
| 四科实测正确率（3 题中答对几题） | **测量值** | 真实，但样本极小 |
| scaled score（140/153/167/180） | **模型外推值** | 不可靠，只有 4 个可能取值 |
| 通过概率（线性 5%-95%） | **模型外推值** | 不可靠，且不是设计文档里的 logistic |

**决策：卡片主打"测量值 + 身份认同"，弱化"模型值"。**

理由有三：

1. **诚实**：晒 3/3 全对是事实；晒 "180 分" 是从 3 道题外推的。
2. **可传播性**：**"My weakest gate is Mathematics. Anyone else?" 是一个提问，不是一份成绩单。** 在 Facebook 群里，提问比成绩单更容易引来回帖，而回帖正是我们要的 A 类互动场景。
3. **抗拆穿**：教师社群对分数敏感。正确率是自证的，scaled score 需要信任我们模型——这个信任我们现在还不配要。

**"weakest gate" 这个词也别换掉**：它是我们已经在站内、在社区文案里反复使用的术语，卡片是它第一次出圈。术语一致性本身就是品牌资产。

### 6.2 信息层级（自上而下）

```
┌─────────────────────────────────┐
│                                 │
│   FREE DIAGNOSTIC · 12 Qs       │  ← eyebrow, 11px, --ink-soft
│                                 │
│   My weakest gate               │  ← 32px Instrument Serif, --ink
│   Mathematics                   │  ← 56px Instrument Serif, --accent
│                                 │
│   5002  ████████████░░░  2/3    │
│   5003  ████████░░░░░░░  1/3  ← │  ← 最弱科高亮
│   5004  ███████████████  3/3    │
│   5005  ██████████░░░░░  2/3    │
│                                 │
│   ─────────────────────────     │
│                                 │
│   vs Virginia line              │  ← 14px, --ink-soft（仅已核实州）
│   +10   −4   +25   +8           │  ← 18px mono，对应 5002/5003/5004/5005
│   Estimated score 167 est.      │  ← 13px, --ink-soft, 弱化
│   · 3 of 4 above the line       │
│                                 │
│   ─────────────────────────     │
│                                 │
│   Learndiag.                    │  ← wordmark, --accent
│   learndiag.com/diagnostic      │  ← 12px, --ink-soft
│   Based on 12 questions         │  ← 11px, --ink-soft
│                                 │
└─────────────────────────────────┘
```

### 6.3 视觉规格

沿用 `brand-spec.md` v3 莫兰迪色板（**不得引入新色**）：

| 用途 | Token | 值 |
|---|---|---|
| 卡片底色 | `--bg` | `#F2EFE9` |
| 卡片边框 / 分隔线 | `--line` | `#D8D1C5` |
| 进度条轨道 | `--bg-soft` | `#E8E3D8` |
| 主文案 | `--ink` | `#3C3733` |
| 次级文案 | `--ink-soft` | `#6E6760` |
| 小面积强调（wordmark 句点） | `--accent` | `#C09D9B` |
| **大面积强调（weakest gate 标题、进度条填充）** | `--accent-deep` | `#A67D7A` |

> 主标题用 `--accent-deep` 而非 `--accent`：`#C09D9B` 在 `#F2EFE9` 底上对比度偏低，撑不住 56px 的主标题。`--accent` 只用于小面积点缀。

字体（沿用品牌规范，禁止替换）：
- Display：`"Instrument Serif", Georgia, serif`
- Body：`"Instrument Sans", system-ui, sans-serif`
- 数字：`ui-monospace, "SF Mono", Menlo, monospace`

**进度条表示"实测正确率"，不表示"达标与否"**：
- 轨道：`--bg-soft` `#E8E3D8`；填充：`--accent-deep` `#A67D7A`
- 四根条**统一配色**，最弱科靠"条最短"自然凸显，另加一条 2px 左侧标记条 + 科目名用 `--accent-deep`
- 达标与否**不在进度条上表达**，只在下方"vs [State] line"用正负数字表达

**禁止 traffic light 配色**：不用绿色表示"过"、红色表示"挂"。莫兰迪色系下高饱和色会破坏品牌，且色盲用户不可读。差距一律用**数字 + 正负号**表达。唯一例外：低于州线的数字可用 `--color-text-danger` 级别的深红作**文字色**（仅文字，不用于填充），因为数字本身已带负号，颜色只是二次编码。

**为什么进度条只画正确率**：正确率是测量值，州线差距是模型值（见 §6.1）。把两者混在同一根条上，会让"我 3/3 全对"和"我肯定能过"在视觉上变成一回事——这正是我们要避免的误导。

尺寸：
- 输出：1080 × 1080 px（Facebook feed 最优 1:1）
- 内部 canvas：`1080 * devicePixelRatio`，绘制时 `ctx.scale(2, 2)`，导出仍为 1080
- 格式：PNG（`toBlob('image/png')`）

### 6.4 分享文案

**Web Share API 文本：**
```
My weakest Praxis 5001 gate: Mathematics. Took the free 12-question diagnostic — took 8 minutes.
```

**公开页 OG 描述（P1）：**
```
A Praxis 5001 candidate's diagnostic result — weakest gate, per-subtest accuracy, and gap to their state's passing line. Take the free 12-question diagnostic.
```

**不写"我考了 180 分"这类句子。** 文案里出现任何绝对分数，都必须带 "est."。

---

## 7. 技术方案

### 7.1 运行环境约束

| 项 | 现状 |
|---|---|
| 部署 | `site/` → Cloudflare Pages，`_worker.js` 由 `build-worker.mjs` 打包 `worker-src/*.mjs` |
| 前端 | React 18 UMD + `@babel/standalone` 浏览器内编译（`site/diagnostic.html:77-79`） |
| 数据库 | Cloudflare D1（schema 见 `db/schema.sql`） |
| 埋点 | GA4（G-MSR1Q1G7W9）+ Cloudflare Analytics Engine + `attempts_daily` |
| 服务端图像 | **不可用**（sharp 仅本地构建，见 F4） |

### 7.2 P0 方案：纯客户端 Canvas

**不引入任何新依赖。** 卡片是四根条 + 几行字，Canvas 2D 完全够用，不需要 html2canvas。

实现位置：`site/diagnostic.html` 的 `<script type="text/babel">` 块内新增 `DM_ShareCard` 组件 + `DM_renderCard()` 纯函数。

```js
// 伪代码，说明时序关键点
async function DM_renderCard(result, state) {
  await document.fonts.ready;                       // FR-13：字体未加载完成时 fillText 会静默回退
  await Promise.all([
    document.fonts.load('400 56px "Instrument Serif"'),
    document.fonts.load('400 16px "Instrument Sans"'),
  ]);
  const canvas = document.createElement('canvas');
  canvas.width = 1080 * 2; canvas.height = 1080 * 2;
  const ctx = canvas.getContext('2d');
  ctx.scale(2, 2);
  // ...draw...
  return new Promise(res => canvas.toBlob(res, 'image/png'));
}
```

**关键点：**
- `document.fonts.ready` 之前不能 `fillText`，否则衬线字体静默回退成 system-ui，卡片立刻变廉价。**这是最容易翻车的地方。**
- `toBlob` 是异步的，不能同步取值。
- iOS Safari 对 `navigator.share` 的文件大小有软限制，1080×1080 PNG 约 150–400KB，在安全范围内。

### 7.3 P1 方案：分享链接 + OG 图（含 spike 建议）

**链接部分无争议**，按 §8 的表结构 + §9 的接口做即可。

**OG 图部分需要技术 spike，不建议直接排期。** 三个候选：

| 方案 | 说明 | 风险 |
|---|---|---|
| A. `workers-og`（Satori + resvg wasm） | 社区成熟方案，Workers 可用 | 约 1.2MB wasm 进 bundle；需验证 Workers CPU 限制下生成耗时（目标 < 800ms） |
| B. Cloudflare Browser Rendering | 截图 | 需付费套餐，冷启动慢，为一张卡片不划算 |
| C. 不做动态 OG，卡片只走下载路径 | 用户手动发图 | 失去 URL 分享的预览优势 |

**建议：先只做 P0，看 `share_card_downloaded` 数据。若下载转化健康（≥ 8%）再投 spike 做 A。**

理由：在 Facebook 群组里，用户本来就是**发图**而不是发链接。动态 OG 的价值主要在 Twitter / LinkedIn / iMessage，而这些不是我们的主战场。**不要为一个次要渠道先付主要成本。**

### 7.4 州线数据初始化

一次性脚本（放 `tools/`），把 §2 F2 表格的 5 州数据写入 `state_cut_scores`：

```sql
INSERT INTO state_cut_scores (state_code, subtest, cut_score, exam_family, source_url, verified_at, note) VALUES
('VA','5002',157,'5001', '...', '2026-08-30', NULL),
...
('SC','5003',157,'5001', '...', '2026-08-30', 'Mid-transition to 5901/7811; confirm pathway before registering'),
('PA','5002',NULL,'PECT', '...', '2026-08-30', 'PreK-4 uses PECT; 5001 not accepted for elementary'),
...
```

**纪律：`cut_score` 为 NULL 表示"不适用"，与"未知"区分。** 未知州不入库（查不到就走 FR-4 默认 160 + 明确标注"typical"）。

---

## 8. 数据模型变更

新增三张表，追加到 `db/schema.sql`：

```sql
-- 州及格线（含"本州不用 5001"的表达）
CREATE TABLE IF NOT EXISTS state_cut_scores (
  state_code   TEXT NOT NULL,          -- VA / TN / NJ / KY / SC / PA / ...
  subtest      TEXT NOT NULL,          -- 5002 | 5003 | 5004 | 5005
  cut_score    INTEGER,                -- NULL = 本州不适用该科（exam_family != 5001）
  exam_family  TEXT NOT NULL,          -- 5001 | 5901 | 7811 | PECT | none
  source_url   TEXT,                   -- 一手来源，必须填
  verified_at  TEXT,                   -- YYYY-MM-DD
  note         TEXT,                   -- 迁移中 / 附加要求等提示
  PRIMARY KEY (state_code, subtest)
);

-- 诊断运行记录
CREATE TABLE IF NOT EXISTS diagnostic_runs (
  id              TEXT PRIMARY KEY,
  user_id         TEXT,                -- 可空：未登录也能测
  state_code      TEXT,                -- 可空
  subtest_json    TEXT NOT NULL,       -- {"5002":{"correct":2,"attempted":3}, ...}
  est_score       INTEGER,             -- 可为 NULL
  est_pass_pct    INTEGER,
  weakest_subtest TEXT,                -- 5002..5005
  model_version   TEXT NOT NULL,       -- 关键：'linear-v1'，模型换代后可识别旧数据
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runs_user ON diagnostic_runs(user_id, created_at DESC);

-- 分享卡片（公开可见，id 不得可枚举）
CREATE TABLE IF NOT EXISTS share_cards (
  id           TEXT PRIMARY KEY,       -- 10 位 base58，CSPRNG
  run_id       TEXT NOT NULL,
  user_id      TEXT,
  display_name TEXT,                   -- 可空，默认 "A Praxis candidate"
  visibility   TEXT NOT NULL DEFAULT 'public',  -- public | private
  view_count   INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cards_vis ON share_cards(visibility, created_at DESC);
```

**为什么 `model_version` 必须入库**：F5 指出当前是线性 mock。等到《诊断模型设计.md》§3 的 logistic 模型（或真实校准）上线后，历史卡片上的数字会与新版不一致。没有版本字段，将来无法区分"老模型算的旧卡"和"新模型算的新卡"，也无法决定要不要重算或下线旧卡。

---

## 9. 接口设计

新增路由，注册到 `worker-src/worker.mjs` 的 `/api/` 分发链（参照 `ATTEMPT_ROUTES` 的写法，约 line 202）：

```js
export const DIAGNOSTIC_ROUTES = {
  '/api/diagnostic/runs':   { POST: hRunCreate },
  '/api/diagnostic/states': { GET:  hStateList },   // 返回 state_cut_scores 全量，前端缓存 24h
};
export const SHARE_ROUTES = {
  '/api/share/cards':          { POST: hCardCreate },
  '/api/share/cards/:id':      { DELETE: hCardRevoke },  // 软删除：visibility='private'
};
```

| 接口 | 方法 | 鉴权 | 说明 |
|---|---|---|---|
| `/api/diagnostic/states` | GET | 无 | 州线全量，公开数据，`Cache-Control: public, max-age=86400` |
| `/api/diagnostic/runs` | POST | 可选（登录则关联 user_id） | 未登录也允许，返回 `run_id` |
| `/api/share/cards` | POST | 可选 | body: `{run_id, display_name?}`，返回 `{id, url}` |
| `/api/share/cards/:id` | DELETE | **必须** | 仅创建者本人或 admin，返回 204 |
| `/s/:cardId` | GET | 无 | 公开 HTML 页，含 OG meta |

**限流**：`POST /api/share/cards` 按 IP 限速 20 次/小时，防刷。

**隐私**：`/s/:cardId` 页面**不得**包含 user_id、email、session token。返回体里只出现 display_name（用户主动填写）与诊断结果数据。

---

## 10. 埋点需求

### 10.1 事件表

| 事件名 | 触发时机 | 关键参数 |
|---|---|---|
| `state_selected` | 用户在诊断前选州 | `state_code`, `exam_family` |
| `share_panel_opened` | 点击 Share my result | `run_id`, `weakest_subtest` |
| `share_card_rendered` | 卡片 canvas 渲染成功 | `run_id`, `duration_ms` |
| `share_card_render_failed` | 渲染失败（FR-14） | `error_message`, `ua` |
| `share_card_downloaded` | 下载 PNG | `run_id`, `has_state` |
| `share_card_native_shared` | `navigator.share` 成功 | `run_id`, `platform` |
| `share_link_created` | P1 生成分享链接 | `run_id`, `card_id` |
| `share_page_viewed` | P1 公开页 PV | `card_id`, `referrer` |
| `share_page_cta_clicked` | P1 公开页点 CTA | `card_id` |

### 10.2 漏斗（本需求的核心看板）

```
诊断完成
  ↓  share_panel_opened / 诊断完成          ← 目标 ≥ 25%
分享面板打开
  ↓  share_card_rendered / opened           ← 目标 100%（掉这里就是 bug）
卡片渲染成功
  ↓  (downloaded + native_shared) / rendered ← 目标 ≥ 35%
卡片被带走
  ↓  [P1] share_page_viewed                 ← 渠道曝光
曝光
  ↓  新会话启动诊断 / share_page_viewed      ← 目标 ≥ 15%
新用户进入诊断
```

**首月北极星：`share_card_downloaded / 诊断完成数 ≥ 8%`。**

**必须监控的失败率**：`share_card_render_failed`。Canvas 在旧 Android WebView、iOS 低电量模式、隐私模式下都可能失败。这个事件如果 >2%，说明方案要改（改用 SVG → 服务端转 PNG）。

### 10.3 渠道归因

- 分享公开页带 `?utm_source=share_card&utm_medium=social&utm_campaign=diag_share`
- GA4 中按 `referrer` 分组看 facebook.com / reddit.com / t.co 来源
- 人工分发（我们在群里贴链接）用不同 `utm_campaign`，避免和用户自发分享混在一起

---

## 11. 风险与依赖

| ID | 风险 | 等级 | 应对 |
|---|---|---|---|
| R1 | **打分模型是 mock（F5），晒出去的数字不可靠** | 高 | 卡片主打实测正确率 + weakest gate；分数带 "est." 且视觉弱化（FR-19）；`model_version` 入库；真实校准另立需求 |
| R2 | **10-01 收费墙与病毒循环冲突** | 高 | 见 §12 Q1，需产品决策 |
| R3 | OG 图在 Workers 上生成的可行性与成本未知 | 中 | P1 先 spike，不做则降级为静态 OG（FR-33） |
| R4 | Canvas webfont 时序导致字体回退 | 中 | FR-13 强制 `await document.fonts.ready`；QA 必须在 iOS Safari 实测 |
| R5 | 公开页泄露 PII | 中 | FR-21 / FR-27 / FR-28 三重约束；上线前做隐私走查 |
| R6 | 只有 5 州数据可核实，其余州用户看到"假精确"数字 | 中 | 未知州不入库；FR-4 走默认 160 并明确标注 "typical" |
| R7 | 卡片在社群里被当成广告，引发反感 | 中 | 卡片本身零 CTA 硬推销，仅 footer 一个 URL；文案用提问句式而非成绩单句式 |
| R8 | 样本仅 3 题/科，用户晒出 0/3 会被嘲笑 | 低 | FR-17 强制显示 "Based on 12 questions"；考虑在 0 分科旁加小字 "small sample"（可选） |

---

## 12. 待确认问题（评审时必须给出答案）

| # | 问题 | 我的建议 |
|---|---|---|
| **Q1** | **2026-10-01 收费墙生效后，分享卡片是否保持永久免费？** | **建议是。** 结果卡片免费、详细报告/学习计划 Pro。理由：病毒循环一旦被收费墙切断，之后重建成本远高于少收的那点钱。这是本 PRD 最重要的决策，且**必须在 9 月内定**，否则 10-01 会自己替我们决定 |
| Q2 | 未核实州（45 个）怎么处理？ | 显示 "typical state line (160)" 并明确标注 typical，不编造具体数字。等有真实数据再逐州补 |
| Q3 | 卡片上要不要放"我通过了"（US-5）这种成就态？ | 本期不做。诊断 ≠ 真实考试，我们没有真实成绩，标"通过"是虚假陈述 |
| Q4 | P1 的 OG 动态图做不做？ | 先看 P0 下载转化数据，≥8% 再投入（见 §7.3） |
| Q5 | 未登录用户能否生成分享链接？ | 能（降低门槛），但链接关联到 `user_id = NULL`，用户后续无法删除——需在 UI 明确提示"未登录创建的链接无法撤回" |
| Q6 | 是否需要中文版卡片？ | 不做。目标用户在美东教师社群，英文卡片才能被转发 |

---

## 13. 验收标准

### 13.1 P0 功能验收

- [ ] 诊断首页出现州选择器，含 50 州 + DC + "Not listed / Not sure"
- [ ] 选择 PA / MD / AL / NC 后，结果页显示"本州不用 5001"提示，且**不显示**任何 cut score 对比（FR-6）
- [ ] 选择 SC 后显示迁移提示（FR-6 note）
- [ ] 结果页出现 "Share my result" 按钮
- [ ] 点击后渲染出预览卡片，视觉符合 §6.2 信息层级、§6.3 配色
- [ ] 卡片上 scaled score 带 "est." 且字号 ≤ weakest gate 标题的 60%（FR-19）
- [ ] 未选州时卡片显示 "vs a typical state line"，不指名具体州（FR-4）
- [ ] 点击 Download 得到 1080×1080 PNG，文件名符合 FR-10
- [ ] 移动端（iOS Safari + Android Chrome）点击 Share 调起系统分享面板
- [ ] 桌面端（无 navigator.share）点击 Share 走下载，不报错（FR-12）
- [ ] **iOS Safari 上卡片字体为 Instrument Serif，未回退成 system-ui**（FR-13，肉眼可验）
- [ ] 卡片上不出现任何用户姓名/邮箱（FR-21）

### 13.2 P0 埋点验收

- [ ] 9 个事件（P0 部分 7 个）全部上报 GA4 且参数完整
- [ ] `share_card_render_failed` 能在本地通过 mock 失败路径触发

### 13.3 P1 验收（如排期）

- [ ] `/api/diagnostic/runs` 落库成功，`model_version` 字段非空
- [ ] 生成的短链为 10 位 base58，连续生成 100 次无可枚举规律
- [ ] `/s/[cardId]` 返回 200 且 OG meta 正确
- [ ] 不存在的 cardId 返回 404 且不泄露存在性（FR-28）
- [ ] 删除卡片后 60 秒内 `/s/[cardId]` 返回 404
- [ ] 删除用户账号后其全部卡片不可访问（FR-30）
- [ ] 抓包确认 `/s/[cardId]` 响应中不含 user_id / email / token

### 13.4 非功能验收

- [ ] 卡片渲染耗时 < 300ms（中位，移动端）
- [ ] `site/diagnostic.html` 体积增加 < 30KB（不引入新依赖）
- [ ] 未引入任何新的 npm 依赖（P0 硬性要求）
- [ ] 通过现有测试套件 `npm test`（`test/agentic.test.mjs` 等 8 个文件）

---

## 14. 任务拆解与排期建议

### P0（建议 2026-09-12 前上线）

| # | 任务 | 负责角色 | 估时 | 依赖 |
|---|---|---|---|---|
| T1 | 新建 `state_cut_scores` 表 + 5 州数据迁移脚本 | 后端 | 0.5d | 无 |
| T2 | 州选择器 UI（诊断首页 + 结果页可改）+ localStorage 持久化 | 前端 | 1d | T1 |
| T3 | 结果页接入州线：FR-6 降级提示、FR-7 过期提示 | 前端 | 0.5d | T2 |
| T4 | `DM_renderCard()` canvas 渲染函数（含字体时序处理） | 前端 | 1.5d | T3 |
| T5 | 分享面板 UI + Download + Web Share 降级 | 前端 | 1d | T4 |
| T6 | 埋点接入（7 个 P0 事件）+ GA4 漏斗看板 | 前端/数据 | 0.5d | T5 |
| T7 | 移动端实测（iOS Safari / Android Chrome）+ 视觉走查 | 测试 | 0.5d | T5 |
| T8 | 隐私走查：确认卡片不含 PII | 产品/测试 | 0.25d | T5 |

**关键路径 T1 → T2 → T3 → T4 → T5，合计约 5.25 人日。**

### P1（视 P0 数据决定）

| # | 任务 | 估时 | 前置 |
|---|---|---|---|
| T9 | `diagnostic_runs` / `share_cards` 建表 | 0.25d | 无 |
| T10 | 三个 API + `/s/:cardId` 公开页 | 1.5d | T9 |
| T11 | 卡片删除 / 账号删除联动（FR-29 / FR-30） | 0.5d | T10 |
| T12 | **OG 图技术 spike（workers-og）** | 0.5d spike | 无，可与 P0 并行 |
| T13 | OG 图正式实现（若 spike 通过） | 1.5d | T12 |

### 排期冲突提示

T1–T8 与《社区分发-本周执行包.md》的人工分发节奏并行，不冲突——**但 T3（州线接入）上线后，执行包里涉及"你州线要多少"的答案模块必须同步更新为带深链的个性化话术**，否则会出现"文案承诺了能力，产品兑现不了"的落差。这个同步动作需要内容侧配合，建议单开一个事项。

---

## 15. 附录：关键代码位置

| 内容 | 位置 |
|---|---|
| 诊断页主文件 | `site/diagnostic.html`（908 行，React UMD + Babel 内联） |
| 打分 mock（F5） | `site/diagnostic.html:336-345` |
| 收费墙常量（§1.3） | `site/diagnostic.html:452` |
| localStorage 结果存储（F3） | `site/diagnostic.html:485-493` |
| 报告组件 | `site/diagnostic.html:434` `DM_Report` |
| 州线数据（散文形式） | `site/praxis-5001-passing-score-by-state.html:158-176` |
| DB schema | `db/schema.sql` |
| Worker 路由分发 | `worker-src/worker.mjs:146-227` |
| 埋点路由范例 | `worker-src/analytics.mjs:116-122` |
| 品牌色板/字体 | `brand-spec.md:39-52` |
| 诊断模型设计（未实现的 logistic） | `诊断模型设计.md` §2-§4 |
| 社区分发执行包 | `../Triumph SEO/社区分发-本周执行包.md` |
