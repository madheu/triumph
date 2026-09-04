# Learndiag Pinterest 启动包

> 目标：把 learndiag.com 已有的指南/工具页，转成 pin 图，在 Pinterest（对教师人群的"第二个搜索引擎"）获取常青流量。
> 预期：2–4 周开始有自然曝光与跳站点击，之后是持续复利，不像 FB 帖 48h 就凉。
> 前提：你有 Pinterest 账号（商业/创作者账号，免费）。

---

## 第 0 步 · 账号设置（先做，1 次搞定）

1. **账号类型**：确认是 Business 账号（pinterest.com/business），免费。个人号功能受限。
2. **Claim 域名（最关键，不做白做）**：
   - 进 Pinterest → 右上头像 → Settings → Claim website / 认领网站
   - 填 `learndiag.com`，选"用 HTML 标签验证"或"上传文件验证"
   - 验证文件放到 `E:/Triumph/praxis-5001/site/` 根目录 → 重新部署
   - 效果：头像旁出现 ✓，Pinterest Analytics 能统计外链点击数，你发的链接才记到 Learndiag 头上
3. **账号名 & bio**（别用个人杂号）：
   - 名字：Learndiag
   - Bio：`Free Praxis 5001 practice tests & readiness diagnostics. 969 original questions. Passing scores by state.`
   - 头像：用 learndiag.com 的 favicon/logo（og-image 同源）
   - Profile 链接：learndiag.com

---

## 第 1 步 · Board 规划（关键词命名，Pinterest 靠搜索）

按主题建 6 个 board，board 名本身含搜索词：

| Board | 放什么 |
|---|---|
| Praxis 5001 Study Tips | 复习策略、四门闸口法 |
| Praxis Passing Scores by State | 各州分数卡、州要求页 |
| Free Praxis Practice Tests | 免费模拟题、诊断入口 |
| Praxis Elementary Education (5002–5005) | 分科指南（数学/阅读/社科/科学） |
| Teacher Certification | 报名、重考、注册指南 |
| Praxis Math Help (5003) | 数学题卡、数学复习 |

---

## 第 2 步 · 首批 12 张 pin（直接照做）

**埋链接的正确姿势**：新建 pin 时，网页链接（Website 字段）= 该内容的落地页 URL，**不是主页**。图卡文案见下。

| # | 图卡大字（放图上） | Pin 标题（含关键词，≤100字符） | Pin 描述（2–3 句+CTA） | 落地链接 | Board |
|---|---|---|---|---|---|
| 1 | 你所在的州，Praxis 5001 要考多少分？ | Praxis 5001 Passing Scores by State — Free Guide | Wondering what score you need on the Praxis 5001? See passing scores for every state, plus which states have alternate certification paths. Free guide. | /praxis-5001-passing-score-by-state | Praxis Passing Scores by State |
| 2 | 969 道原创题 · 免费 | Free Praxis 5001 Practice Test — 969 Original Questions | Take a free Praxis 5001 practice test with 969 original questions, instant scoring and a pass-probability estimate. No sign-up walls. | /praxis-5001-free-practice-test | Free Praxis Practice Tests |
| 3 | 考 4 门，别背 4 本书 | Praxis 5001 Study Guide — The Four-Gate Strategy | Stop re-reading everything. The four-gate strategy tells you exactly where to spend study time across the four subtests. Free study guide. | /praxis-5001-four-gate-strategy | Praxis 5001 Study Tips |
| 4 | Praxis 5001 到底考什么？ | Praxis 5001 Subtests Explained — 4 Tests, One Plan | Reading, Math, Social Studies, Science — what's actually on each Praxis 5001 subtest and how they're weighted. | /praxis-5001-subtests-explained | Praxis Elementary Education (5002–5005) |
| 5 | 挂了？这是重考的正确打开方式 | Praxis 5001 Retake Guide — Score Reporting & Re-test Rules | Failed the Praxis 5001? Learn retake rules, score reporting windows and how long to wait before testing again. | /praxis-5001-retake-guide | Teacher Certification |
| 6 | Praxis 数学救星：5003 复习路线 | Praxis 5003 Math Study Guide — Free Prep | Praxis 5003 math concepts broken down simply, with free practice. Perfect for the math subtest of the 5001 series. | /praxis-5003-math-study-guide | Praxis Math Help (5003) |
| 7 | 5005 科学：别被术语吓退 | Praxis 5005 Science Study Guide | Life, Earth, and physical science for the Praxis 5005 — what to prioritize so you don't drown in vocabulary. | /praxis-5005-science-study-guide | Praxis Elementary Education (5002–5005) |
| 8 | Virginia 考生必看 | Praxis 5001 Virginia Requirements — Passing Score & More | Teaching in Virginia? Here's the Praxis 5001 score Virginia requires plus the license steps after you pass. | /praxis-5001-virginia-requirements | Praxis Passing Scores by State |
| 9 | Pennsylvania 考生必看 | Praxis 5001 Pennsylvania Requirements — What You Need | PA teaching candidate? See the Praxis 5001 scores Pennsylvania expects and your next steps to certification. | /praxis-5001-pennsylvania-requirements | Praxis Passing Scores by State |
| 10 | Tennessee 考生必看 | Praxis 5001 Tennessee Requirements — Passing Scores | Tennessee bound? Praxis 5001 score requirements for TN, plus which tests you take instead in some cases. | /praxis-5001-tennessee-requirements | Praxis Passing Scores by State |
| 11 | 你只剩 N 周，该先做哪套题？ | Praxis 5001 Study Planner — Weekly Prep Schedule | A week-by-week Praxis 5001 study planner that tells you exactly what to drill each day before test day. | /study-planner | Praxis 5001 Study Tips |
| 12 | 算一下你的通过概率 | Free Praxis 5001 Score Checker & Pass Probability | Answer a few questions and see your Praxis 5001 pass probability before you book the test date. | /diagnostic | Free Praxis Practice Tests |

### 落地链接（直接复制，已带 UTM 追踪）

Cloudflare 那边的 token 读不到来源（referer）维度，所以用 UTM 参数让 GA4 能识别。发 pin 时把下面整条 URL 填进"网页链接"字段：

| # | 完整落地链接 |
|---|---|
| 1 | `https://learndiag.com/praxis-5001-passing-score-by-state?utm_source=pinterest&utm_medium=pin&utm_campaign=scores_by_state` |
| 2 | `https://learndiag.com/praxis-5001-free-practice-test?utm_source=pinterest&utm_medium=pin&utm_campaign=free_practice` |
| 3 | `https://learndiag.com/praxis-5001-four-gate-strategy?utm_source=pinterest&utm_medium=pin&utm_campaign=four_gate` |
| 4 | `https://learndiag.com/praxis-5001-subtests-explained?utm_source=pinterest&utm_medium=pin&utm_campaign=subtests` |
| 5 | `https://learndiag.com/praxis-5001-retake-guide?utm_source=pinterest&utm_medium=pin&utm_campaign=retake` |
| 6 | `https://learndiag.com/praxis-5003-math-study-guide?utm_source=pinterest&utm_medium=pin&utm_campaign=math_5003` |
| 7 | `https://learndiag.com/praxis-5005-science-study-guide?utm_source=pinterest&utm_medium=pin&utm_campaign=science_5005` |
| 8 | `https://learndiag.com/praxis-5001-virginia-requirements?utm_source=pinterest&utm_medium=pin&utm_campaign=state_va` |
| 9 | `https://learndiag.com/praxis-5001-pennsylvania-requirements?utm_source=pinterest&utm_medium=pin&utm_campaign=state_pa` |
| 10 | `https://learndiag.com/praxis-5001-tennessee-requirements?utm_source=pinterest&utm_medium=pin&utm_campaign=state_tn` |
| 11 | `https://learndiag.com/study-planner?utm_source=pinterest&utm_medium=pin&utm_campaign=study_planner` |
| 12 | `https://learndiag.com/diagnostic?utm_source=pinterest&utm_medium=pin&utm_campaign=diagnostic` |

> 站点已装 GA4（G-MSR1Q1G7W9），带 UTM 后可在 GA4 → 获客 → 流量获取 里看到 pinterest 来源会话，用来判断"图→点击→诊断"这条链通不通。

**图片规格**：竖版 2:3，1000×1500px，PNG/JPG。
**图卡设计**：极简文字卡 = 白底/浅底 + 一个品牌色标题 + 大字问题 + 底部放 `learndiag.com`。别用 AI 插画风、别堆元素。参考 og-image.png 的克制感。可以在 Canva 建一个 1000×1500 模板，后续 12 张批量换字，一张图约 3 分钟。

---

## 第 3 步 · 发布节奏（别猛灌）

- **第 1 周**：每天发 2–3 张（上面 12 张分 4–5 天发完，不要一天全发）
- **第 2 周起**：每天 1–2 张。新素材来源：州页（还有 AL/KY/MD/NJ/SC 没 pin）、5002/5004 指南、score-calculator、mock-exam
- **重发机制**：表现好的 pin（点击前 3）隔 3–4 周重发一次，Pinterest 允许重复 pin 不惩罚，这是它和 FB 的本质区别
- 时间：美东早间/晚间（用户刷手机时段），用 Pinterest 自带的 schedule 或手动都行

---

## 第 4 步 · 验证（2–4 周后看）

- Pinterest Analytics → 看 **Outbound clicks**（跳站点击）与 saves（收藏数）。收藏多=内容对路但链接没埋好；点击多=链路通
- 对照工具：learndiag.com 近 30 天 CF 请求曲线有没有 Pinterest 来源的小峰（CF 能看到 referer 是 pinterest.com）
- 判断标准：4 周内 outbound clicks 从 0 → 每周有稳定个位数增长 = 启动成功，继续加量。没动 = 换图卡标题/主题再试，别恋战

---

## 别踩的坑

- **商标**：标题/描述里不写 "official ETS"、"Praxis by ETS" 这类，保持 Learndiag 原创措辞（跟站内一致）
- **别发裸链接文字 pin**：Pinterest 是图平台，没有图的 pin 没曝光
- **别用图库照片**：教师备考搜索要的是"干货感"，实拍图/插画转化差，文字卡最稳
- **别一次发完**：Pinterest 对爆发式发布不友好，细水长流
- **域名没 claim 就开跑** = 白干，第 0 步一定要先做
