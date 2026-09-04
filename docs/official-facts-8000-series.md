# 官方事实库 · Praxis 8000 系列（Elementary Education Fundamentals）

> 建立：2026-09-03（D1）｜来源回填与复核：2026-09-03（F1）
> 状态：**五科已全部补齐官方来源 URL，每条事实可溯源**
> 配套：`E:\Triumph\AGENT.md`（事实核实硬约束）、`../content-infra/official-facts-8000-series.json`（机器可读版）

---

## 0. 使用规则（改这个文件前必读）

1. **本文件是站内所有考试事实的唯一来源。** 页面、题目、文案引用考试数据时应引这里，不要各自去查。
2. **未核实的不得上线。** `verification_status` 为 `unverified` 或 `triangulated` 的字段，上线前需人工确认。
3. **改任何数字必须同步改三件套**：`official_source_url` + `last_verified` + `verification_status`。缺一条视为未完工。
4. **合格分是州定的，没有全国统一分。** 只有 §5 中已列出的州可写，其余州一律 `Not verified`。
5. 与第三方站点冲突时，**一律以官方为准**。

### 官方 URL 模式（已验证，两种）
| 用途 | 格式 | 示例 |
|---|---|---|
| 考试详情页 | `https://praxis.ets.org/test/<code>.html` | `.../test/8005.html` |
| 州要求页 | `https://praxis.ets.org/state-requirements/<state>-tests.html` | `.../state-requirements/westvirginia-tests.html` |

⚠️ 州名**连写无连字符**：`westvirginia`、`arkansas`。写成 `west-virginia` 会 404（F1 实测）。

---

## 1. 五科速查

| Code | Subject | 时长 | 题量 | 题型 | 计算器 | 状态 |
|---|---|---|---|---|---|---|
| 8002 | Reading and Language Arts | 100 min | 80 | SR | — | confirmed |
| 8003 | Mathematics | 100 min | 68 | SR + numeric-entry | 屏幕科学计算器 | confirmed |
| 8004 | Social Studies | 100 min | 77 | SR | — | confirmed |
| 8005 | Science | **90 min** | 74 | SR | 屏幕科学计算器 | confirmed（内容分布除外） |
| 8006 | Teaching Reading | 100 min | 80 | SR | — | confirmed |

SR = selected-response。五科均含 **10–15% 教学情境题（Tasks of Teaching）**。五科均 **$79.00**。

---

## 2. 分科明细

### 8002 · Reading and Language Arts
- `test_length`: 100 min ／ `question_count`: 80 ／ `question_type`: SR ／ `price`: $79.00
- `content_domains`: Reading 42 ／ Writing, Speaking & Listening 38
- `verification_status`: **confirmed**
- `official_source_url`: https://praxis.ets.org/test/8002.html
- 辅助源（内容类别题量）：[ETS Elementary Education V5 PDF](https://praxis.ets.org/on/demandware.static/-/Library-Sites-ets-praxisLibrary/default/dwa2f093a8/pdfs/Elementary-Education-V5.pdf)
- `last_verified`: 2026-09-03

### 8003 · Mathematics
- `test_length`: 100 min ／ `question_count`: 68 ／ `question_type`: SR + numeric-entry
- `content_domains`: Numbers & Operations 28 ／ Algebraic Thinking 20 ／ Geometry, Measurement & Data 20
- `calculator_policy`: 提供屏幕科学计算器（ETS 建议考前先熟悉计算器功能）
- `verification_status`: **confirmed**
- `official_source_url`: https://praxis.ets.org/test/8003.html
- 辅助源：同上 PDF
- `last_verified`: 2026-09-03

### 8004 · Social Studies
- `test_length`: 100 min ／ `question_count`: 77 ／ `question_type`: SR
- `content_domains`: US History, Government & Citizenship 33 ／ Geography, Anthropology & Sociology 23 ／ World History & Economics 21
- `verification_status`: **confirmed**
- `official_source_url`: https://praxis.ets.org/test/8004.html
- 辅助源：同上 PDF
- `notes`: 官方注明本考试使用 B.C.E. / C.E. 纪年表述（部分世界史教材用 B.C. / A.D.）
- `last_verified`: 2026-09-03

### 8005 · Science
- `test_length`: **90 min** ／ `question_count`: 74 ／ `question_type`: SR
- `calculator_policy`: 提供屏幕科学计算器
- **时长、题量、计算器：`confirmed`**（官方考试页直证，F1 已从 triangulated 升级）
- `content_domains`: Earth & Space Science 24 ／ Life Science 25 ／ Physical Science 25 —— **`triangulated`**
  - 官方考试页**未列**内容类别题量；ETS 官方 PDF 该段被截断
  - 现有分布由 Mometrix 与 Study.com 交叉一致得出
  - ⚠️ 这是全库唯一仍未官方直证的字段，上线前如引用需人工确认
- `official_source_url`: https://praxis.ets.org/test/8005.html
- `last_verified`: 2026-09-03
- `notes`: 另有 10–15% 题目融合科学内容与科学与工程实践（SEP），与教学情境题的 10–15% 不重叠计算口径未明

### 8006 · Teaching Reading
- `test_length`: 100 min ／ `question_count`: 80 ／ `question_type`: SR
- `content_domains`: Foundational Literacy Skills 32 ／ Fluency & Vocabulary 24 ／ Comprehension & Written Expression 24
- `verification_status`: **confirmed**
- `official_source_url`: https://praxis.ets.org/test/8006.html
- 辅助源：同上 PDF
- `notes`: 内容基于 Science of Reading 原则，覆盖 National Reading Panel 五大阅读教学组件
- `last_verified`: 2026-09-03

---

## 3. Praxis Steps（模块化分科考试）

ETS 允许按内容类别分块报考/重考，每个 Step **$39.50**。

| Step Code | 名称 | 归属 |
|---|---|---|
| 8201 | Reading | 8002 |
| 8202 | Writing, Speaking, and Listening | 8002 |
| 8301 | Numbers and Operations | 8003 |
| 8302 | Algebraic Thinking | 8003 |
| 8303 | Geometry, Measurement, and Data | 8003 |
| 8401 | United States History, Government, Citizenship | 8004 |
| 8402 | Geography, Anthropology, Sociology | 8004 |
| 8403 | World History and Economics | 8004 |
| 8501 | Earth and Space Sciences | 8005 |
| 8502 | Life Sciences | 8005 |
| 8503 | Physical Sciences | 8005 |
| 未列 | 8006 的 Steps 代码 | ⚠️ 官方州页未列出，待补 |

来源：https://praxis.ets.org/state-requirements/westvirginia-tests.html（Steps 已在页面可购买）
`last_verified`: 2026-09-03

---

## 4. 关键日期

| 事件 | 日期 | 状态 |
|---|---|---|
| 报名开放 | 2026-02 下旬 | confirmed |
| 首次完整考试 | 2026-03-09 | confirmed |
| 成绩报告开始 | 2026-04-17 | confirmed |
| Praxis Steps 启用（8002–8005） | September 2026 | ⚠️ 三种官方口径，见 §7 |
| Praxis Steps 启用（8006） | 2027 | ⚠️ 同上 |
| 旧系列退役（5001 / 7001 / 5901 / 7811） | August 2028 | confirmed |

---

## 5. 价格

| 项目 | 价格 | 生效 | 来源 |
|---|---|---|---|
| 单科考试 | **$79.00** / 科 | 2026-06-01 起 | 各科官方考试页 |
| 单个 Step | $39.50 | — | WV 州要求页 |
| 3 科打包（8002–8005 任 3） | **$149.49**（省 $87） | — | WV / AR 州要求页 |
| 4 科打包 | **$199.52**（省 $116） | — | WV / AR 州要求页 |
| 早鸟折算 | **$19.75 / 科**（$79 的 25%）至 2026-05-31 | — | [UCA 官方页](https://uca.edu/ocs/testing-information) |

⚠️ **F1 修正**：事实库 v1 记的打包价是 $149.50 / $199.50，官方实际为 **$149.49 / $199.52**，已更正。

---

## 6. 合格分（州定，无全国统一分）

### West Virginia — **Confirmed**
来源：https://praxis.ets.org/state-requirements/westvirginia-tests.html

| 8002 | 8003 | 8004 | 8005 | 8006 |
|---|---|---|---|---|
| 152 | 152 | 147 | 143 | **未采用** |

`notes`: WV 的 Teaching Reading 走 **Praxis 5205**（Teaching Reading: Elementary，$156，合格分 159），**不是 8006**。写 WV 州页面时不要写"8006 待定"，应写"WV 采用 5205"。

### Arkansas — **Confirmed**（来源等级已升级）
来源：https://praxis.ets.org/state-requirements/arkansas-tests.html
（F1 前为 UCA 机构级来源，现已有 ETS 官方州页直证，两者数据一致）

| 8002 | 8003 | 8004 | 8005 | 8006 |
|---|---|---|---|---|
| 137 | 136 | 130 | 126 | 未采用 |

附加规则（AR）：
- 5000 系列可考至 **2027-08-31**，成绩认可至 **2031-08-31**
- ETS 州页显示旧系列 "Accepted through September 1, 2027"
- **2027-08-31 前** 5000 与 8000 成绩可混用（需四个领域各至少一科达标）
- 机构佐证：[UCA Testing Information](https://uca.edu/ocs/testing-information)

### 其余 48 州
`Not verified` —— **不得写入任何页面**。
已验证可用的页面格式：`https://praxis.ets.org/state-requirements/<state>-tests.html`（州名连写）

---

## 7. 已知的官方口径不一致（发布前逐页核对，不要自作主张统一）

### Steps 启用时间 —— **ETS 自家有三种说法**
| 口径 | 出处 |
|---|---|
| **Spring 2026** | ETS 官方 PDF（Elementary-Education-V5.pdf）"Launching Spring 2026" |
| **Summer 2026** | `praxis.ets.org/test/elementary-education-fundamentals-reading-and-language-arts-8002.html`（长 URL 版本）+ [tomorrows-teacher 页](https://praxis.ets.org/tomorrows-teacher/new-elementary-education-fundamentals.html) |
| **September 2026** | `praxis.ets.org/test/8002.html`（短 URL 版本）"enabled in September 2026 for 8002-8005 tests (2027 for 8006)" |

→ 站内统一写 **September 2026**，并注明官方口径有出入。
→ 补充观察：同一考试在 ETS 站上存在**两个 URL 版本**，内容口径不同。引用时优先用短 URL `/test/<code>.html`，它给出的描述最具体。

### 早鸟折扣窗口
原始窗口至 2026-05-31（UCA 佐证 $19.75/科），但 8006 考试页显示预约 2026-10-31 前仍可享 75% off。
→ **逐页核对**，不要照抄。

### 8005 内容分布
官方页未列、官方 PDF 截断 → 仍 `triangulated`。

---

## 8. 已识别的错误信息（本站不得采信）

| 错误说法 | 出处 | 官方事实 |
|---|---|---|
| 8000 系列为 100–300 分尺度、合格分 240 | Prepsaret 等第三方站点 | **100–200 尺度**；WV/AR 合格分均在 126–152 |
| 8002 是 55 题 / 1 小时 15 分 / $130 / 合格分 157 | apexteachersprep.com | **80 题 / 100 分钟 / $79 / 州定（WV 152、AR 137）** |

⚠️ apexteachersprep 这类站点把自己包装成"官方蓝图"，实际数据错误严重。**第三方一律只当线索。**

---

## 9. 遗留问题

| # | 问题 | 优先级 |
|---|---|---|
| 1 | 8005 内容类别题量（24/25/25）无官方直证，官方 PDF 该段截断 | **P1** —— 全库唯一未官方直证的字段 |
| 2 | 8006 的 Steps 代码未在任何官方页列出 | P2 |
| 3 | 其余 48 州合格分未核实 | P1 |
| 4 | 全站检索第三方错误信息残留（100–300 尺度 / 240 分 / 55 题等） | P1 |

### F1 本次已解决
- 五科 `official_source_url` 全部回填并逐条点开确认
- 8005 的时长 / 题量 / 计算器从 `triangulated` 升为 `confirmed`
- WV / AR 州要求页 URL 回填，AR 来源等级从"机构级"升级为 ETS 官方
- 修正打包价：$149.50 → **$149.49**、$199.50 → **$199.52**
- 补录 Steps 代码表（§3）、WV 采用 5205 而非 8006、早鸟折算 $19.75/科
