# Item Schema v1 — Praxis 题库统一数据结构

| | |
|---|---|
| 状态 | **已定稿落盘**（2026-09-03） |
| 适用范围 | 全系列题库条目：5000 系列（5002–5005 存量）、8000 系列（8002–8006 新题） |
| 权威依据 | T0 事项（rAQmza）描述的字段清单与三条硬约束；D2 重建的 5000 分支；8006 校验器实现 |
| 一致性验证 | 与 `item-schema-v1.5000-branch.json`（D2）逐字段一致；与 `validate-8006-items.py` 的 FIELD_ORDER / normalize / join 分隔符逐字一致 |
| 修复的看板事项 | P1「schema v1 文件补落盘 + 与 5000 分支对齐复核」 |

> 历史说明：T0 声明产出本文件但未落盘，D2 依据 T0 描述重建了 5000 分支才得以开工。本文件落盘后即为主文档；分支文件与校验器若与本文件冲突，**以本文件为准并立即修正冲突方**。

---

## 1. 字段定义（21 个，顺序即 field_order）

| # | 字段 | 类型 | 必填 | 说明 |
|---|------|------|------|------|
| 1 | `id` | string | ✅ | 批次内唯一，形如 `5002-001` / `8006-001`。**跨系列查重禁止用 id，只用 `duplicate_hash`**（见 §3） |
| 2 | `series` | string | ✅ | 枚举：`"5000"` \| `"8000"` |
| 3 | `test_code` | integer | ✅ | 5000 系列：5002–5005；8000 系列：8002–8006 |
| 4 | `subject` | string | ✅ | 科目名，按系列分支取值（见 §2） |
| 5 | `content_domain` | string | ✅ | 官方内容分类名，**只取枚举值，不得自造**，按 test_code 分支（见 §2） |
| 6 | `skill` | string \| null | ✅（可为 null） | 考查技能标签。存量无此数据，置 null；**不得由 `type`（knowledge/concept/pedagogy）推导——那是认知层级，不是 skill** |
| 7 | `difficulty` | string | ✅ | 枚举：`easy` \| `medium` \| `hard` |
| 8 | `question_type` | string | ✅ | 枚举：`single-select` \| `multiple-select`；8000 系列另可含 `numeric-entry`（见 §2）。多选仅限 8002–8005（8006 全单选），体例见 §8 |
| 9 | `stimulus` | string \| null | ✅（可为 null） | 题干前的共享阅读材料。存量未拆分，一律 null |
| 10 | `stem` | string | ✅ | 题干，非空 |
| 11 | `choices` | string[] | ✅ | ≥2 项且不得重复；存量全部 4 项 |
| 12 | `correct_answer` | string \| string[] | ✅ | **取选项文本，不是索引**（口径裁决见 §5），且必须存在于 `choices` 中。**类型分流**（2026-09-03 裁决）：single-select / numeric-entry 为 string（现状不变）；multiple-select 为 **string[]**，约束：≥2 项、去重、每项在 `choices` 中、数组长度 < `choices` 长度（至少留一个干扰项）、**顺序无关** |
| 13 | `explanation` | string | ✅ | 正确答案解析，非空 |
| 14 | `distractor_explanations` | object \| null | ✅（可为 null） | **硬约束：新产题目必须逐干扰项写解析，缺一条即退回**。存量 969 题全部缺失，按完整性缺口登记（见 §4）。键为**干扰项选项原文**（与 `choices` 逐字一致），**不含正确答案**；写法规范见 §6 |

## §6 distractor_explanations 写法规范（2026-09-03 定稿）

每条解释面向"选了这个选项的考生"，讲清楚**踩了什么坑**，让用户下次能识别同类错误。风格硬标准：**语言精确而不繁杂**。

1. **结构**：先一句话点明该选项暴露的具体错误/misconception，可再补半句正确思路。教学情景题写"这个教师行为错在哪 + 应该怎么做"。
2. **长度**：60–200 字符，目标 ~100。超长即繁杂，砍；不足以讲清坑点即不精确，重写。
3. **开头**：用第三人称动词直接点错误（"Subtracts before distributing…" / "Treats the simile as literal…"）。禁止 "This is incorrect because…"、"The student…" 等绕口开头。**例外**：选项本身为名词短语（技能名/术语，如 "Decoding"）时，允许以对该名词的直接判断开头（"Speed is not the gap…"）。
4. **禁止**：复述题干、出现 "The correct answer is…"、空泛套话（"is not the best choice"）、与正确答案解析（`explanation`）重复的内容。
5. **键口径**：键 = 干扰项选项原文，与 `choices` 数组逐字一致（含大小写与空格），每题恰好 3 条（choices 为 4 项时；multiple-select 题 choices 为 5 项、正确 2 项，干扰项同样为 3 条），**不含正确答案**。
6. **事实边界**：只依据该题的题干与选项作答；不引入题目外的教材结论。校验器逐条检查键匹配与长度区间。
| 15 | `source_basis` | string | ✅ | 枚举：`legacy-unknown` \| `expert-judgment` \| `official-source`。**无官方依据的写 expert-judgment，不得伪装成官方依据**；无法回溯来源的存量写 legacy-unknown（比 expert-judgment 更保守，明示未知） |
| 16 | `review_status` | string | ✅ | 枚举：`draft` \| `human-reviewed` \| `rejected`。新题从 `draft` 起步；5000 存量固定 `human-reviewed` |
| 17 | `reviewer` | string | ✅ | 审题人。存量无法回溯，统一 `legacy-import` |
| 18 | `version` | integer | ✅ | ≥1，内容修订时递增 |
| 19 | `duplicate_hash` | string | ✅ | 64 位小写 hex（`^[0-9a-f]{64}$`），算法见 §3。校验器必须独立复算，不信任输入值 |
| 20 | `created_at` | string | ✅ | ISO-8601 UTC，`…Z` 结尾 |
| 21 | `updated_at` | string | ✅ | ISO-8601 UTC，`…Z` 结尾 |

> 字段计数裁决：T0 描述自称 20 字段但列出 21 个字段名。**以字段名清单为准，按 21 字段实现**（created_at 与 updated_at 并存），已由 D2 与 8006 校验器共同确认。

---

## 2. 系列分支

### 2.1 5000 系列（存量 969 题）

- **权威分支文件**：`item-schema-v1.5000-branch.json`（含 provenance 与映射细节）
- `subject`：5002 = Reading and Language Arts；5003 = Mathematics；5004 = Social Studies；5005 = Science
- `content_domain`：11 个官方分类（5002 两个 / 5003 三个 / 5004 三个 / 5005 两个），完整枚举与 ETS 官方出处见分支文件
- `question_type`：仅 `single-select`
- `review_status`：仅 `human-reviewed`；`reviewer` = `legacy-import`；`version` = 1
- legacy 默认值：`source_basis` = `legacy-unknown`，`skill`/`stimulus`/`distractor_explanations` = null

### 2.2 8000 系列（8002–8006 新题）

- **权威来源**：科目 / content_domain / 题量权重 → `official-facts-8000-series.json`（F1 产出，含 ETS 官方考试页 URL 与核验状态）；8006 各 domain 分布与内容校验 → `validate-8006-items.py` 的 `CONTENT_DOMAINS`
- 两个改名，**不得从 5000 系列复制分类名**：
  - Earth Science → **Earth and Space Sciences**
  - Geometry and Measurement, Data, Statistics, and Probability → **Geometry, Measurement, and Data**
- `question_type`：`single-select` + `multiple-select` + `numeric-entry`（8003 官方含数字填充题）。multiple-select 仅用于 8002–8005，每批约 10%（老户 2026-09-03 22:53 裁决）；**8006 全单选，D5 校验器口径不变**
- `review_status`：新题一律从 `draft` 起步，人工复核后改 `human-reviewed`

---

## 3. duplicate_hash 算法（跨系列查重唯一依据）

> 实现约定：**所有产题、映射、校验脚本必须共用同一实现**。现有两份实现已逐字核对一致：Node（`map-legacy-5001-to-schema-v1.mjs`）与 Python（`validate-8006-items.py`）。

1. **归一化**：`normalize(t)` = 转小写后，移除全部非 `[a-z0-9]` 字符（标点、空白、连字符、引号一律删除）
2. **组装**：`parts = [normalize(stem)] + [normalize(choice) for choice in choices]`，其中选项部分**按字符串升序排序**（消除选项顺序影响）
3. **拼接**：`payload = parts.join("|")` —— 分隔符为竖线 `|`，stem 在前
4. **哈希**：`duplicate_hash = SHA-256(payload, UTF-8)` 的 64 位小写十六进制

**作用域**：跨批次、跨系列的全局查重键。同一道题改 id、改选项顺序、改大小写标点，哈希不变。**跨系列查重一律用 duplicate_hash，禁止用 id 或题干模糊匹配替代。**

---

## 4. 校验分层

| 层级 | 内容 | 处理 |
|------|------|------|
| **blocking（结构校验）** | 21 字段齐全、无多余字段、类型正确、枚举合法、choices 非空且无重复、correct_answer 合法（**按 question_type 分流**：string → 在 choices 内；string[] → 每元素在 choices 内、去重、2 ≤ len < len(choices)）、duplicate_hash 独立复算一致、批内与跨系列无哈希重复 | 任一失败 → 该条**不通过**，不得入库 |
| **non-blocking（完整性缺口）** | `distractor_explanations` / `skill` / `stimulus` 为 null；correct_answer 为绝对化表述（all/none/never/always/only）等人工复核项 | 记 warning 入人工复核队列，**不阻断**。理由：存量数据结构本就没有这三类信息，属遗留缺口而非映射错误 |

存量缺口量级：干扰项解释缺 **2907 条**（969 × 3）。是否全量补写单独排期评估，见 D2 报告。

---

## 5. 历史口径裁决记录

| 分歧点 | 裁决 | 依据 |
|--------|------|------|
| T0 自称 20 字段 vs 列出 21 个字段名 | 按 **21 字段**实现 | 字段名清单优先于自述计数；D2 与 8006 校验器一致 |
| correct_answer 用索引还是文本 | **选项文本** | duplicate_hash 要求选项排序后哈希，排序后索引失效，故字段必须与顺序无关 |
| 跨系列查重键 | **duplicate_hash**，禁用 id | 5000 批 id 形如 `5002-001`，与 8000 系列存在撞号风险 |
| 哈希拼接分隔符 | `|`（D2 原文未规定，现正式定死） | 两个独立实现已逐字一致，写入 §3 后不得再各自发挥 |
| multiple-select 题型引入（2026-09-03，出题会话提案 → 主会话裁决） | ① 枚举名定为 **`multiple-select`**；② `correct_answer` **复用现有字段、类型扩展为 string \| string[]**（不新增 `correct_answers` 字段） | ① 与现有 kebab-case 枚举命名一致，出题侧库存与封存件已用此名；② 保持 21 字段结构稳定，避免全系列 field_order 变动；文本语义天然顺序无关，与 duplicate_hash 选项排序设计一脉相承。官方依据：SC-8004 样题 1/8 为 "Which TWO"（A–E 选二）；SC-8006 官方题型说明含 "Selecting more than one choice from a list of choices" |

---

## 6. content_domain 官方来源

5000 系列 11 个分类名已取得 ETS 官方依据并核验为逐字一致：

- **来源**：ETS 官方宣传册《The new Praxis Elementary Education Fundamentals tests》（© 2025 ETS），归档于 `docs/sources/ets-elementary-education-fundamentals-brochure-V5-2025.pdf`
- **无公开 URL**：该册面向教育合作伙伴定向发放，官网无下载页。引用时 `official_source_url` 填归档路径，**不得编造 URL**
- 8000 系列分类名的官方考试页 URL 见 `official-facts-8000-series.json`

---

## 7. 变更记录

| 日期 | 变更 | 备注 |
|------|------|------|
| 2026-09-03 | 首次落盘 v1 | 由 D2 会话依据 T0 描述重建并正式定稿；与 5000 分支、8006 校验器三方对齐 |
| 2026-09-03 | v1.1：引入 `multiple-select` 题型 | 采纳出题会话提案（`schema-extension-proposal-multiple-select.md`）：`question_type` 枚举扩展、`correct_answer` 类型扩展为 string \| string[]、§4 校验分流、新增 §8 体例。5000 分支与 8006 校验器（D5）**零改动**（5000 存量与 8006 均全单选，新旧定义等价） |

---

## 8. multiple-select 体例（2026-09-03 v1.1 新增）

依据 8004 官方样例（SC-8004 样题 1 与样题 8，五科中唯一含多选实例的科）：

- **题干**：用 "**Which TWO of the following...**" 明确数量。**禁止** "Select all that apply" 写法（官方 8004 样例不用）
- **选项**：A–E 共 5 项，正确项**恰好 2 项**，干扰项 3 项
- **`correct_answer`**：选项文本数组（如 `["Cherokee", "Seminole"]`），顺序无关
- **`explanation`**：逐个正确项分段解释（多选特有写法，出题侧内容规范）
- **适用范围**：仅 8002–8005，每批约 10%；8006 全单选
- **校验器要求**（8002–8005 新校验器）：`ENUMS["question_type"]` 含 `multiple-select`；`correct_answer` 按 §4 分流校验。`validate-8006-items.py`（D5）保持不动
