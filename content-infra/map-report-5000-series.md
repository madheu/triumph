# D2 · 存量 969 题 → schema v1 映射报告

- 生成时间：2026-09-03T15:40:16.291Z
- 脚本：`content-infra/map-legacy-5001-to-schema-v1.mjs`（零依赖、幂等，可重复执行）
- 输入：`db/import-questions.sql`
- 规格依据：`content-infra/item-schema-v1.5000-branch.json`

## 1. 结论

| 项 | 结果 |
|---|---|
| 解析出的题目条数 | 969 |
| 结构校验（blocking）失败 | **0** |
| 映射成功并落盘 | **969** |
| duplicate_hash 生成 | 969 条，唯一值 969 个，重复组 0 组 |
| 完整性缺口（non-blocking） | 969 题存在缺口 |

**满足 D2 验收标准第 1、2 条：969 题零校验失败，duplicate_hash 全部生成。**

## 2. 分布

### test_code
| 5005 · Science | 343 | 35.4% |
| 5004 · Social Studies | 240 | 24.8% |
| 5002 · Reading and Language Arts | 214 | 22.1% |
| 5003 · Mathematics | 172 | 17.8% |

（表头：test_code · subject | 题数 | 占比）

### content_domain
| 5005 · Life Science | 120 | 12.4% |
| 5002 · Reading | 119 | 12.3% |
| 5005 · Physical Science | 116 | 12.0% |
| 5005 · Earth Science | 107 | 11.0% |
| 5002 · Writing, Speaking, and Listening | 95 | 9.8% |
| 5004 · United States History, Government, and Citizenship | 90 | 9.3% |
| 5004 · World History and Economics | 77 | 7.9% |
| 5003 · Numbers and Operations | 73 | 7.5% |
| 5004 · Geography, Anthropology, and Sociology | 73 | 7.5% |
| 5003 · Algebraic Thinking | 55 | 5.7% |
| 5003 · Geometry and Measurement, Data, Statistics, and Probability | 44 | 4.5% |

（表头：test_code · content_domain | 题数 | 占比）

### difficulty
| medium | 403 | 41.6% |
| hard | 289 | 29.8% |
| easy | 277 | 28.6% |

（表头：difficulty | 题数 | 占比）

### reviewer / review_status / source_basis
- reviewer：legacy-import = 969
- review_status：human-reviewed = 969（存量已上线使用的题，按 D2 规则统一标记）
- source_basis：**legacy-unknown = 969（100.0%）**

## 3. legacy-unknown 清单（验收标准第 3 条）

存量 questions 表只有 `source_batch = '3.0'`（批次号，非出题依据），**没有任何字段记录每题的出题依据**，因此无法回溯来源的题 = 全部 969 条。

- 全量清单：`content-infra/legacy-unknown-items.csv`（含 id / test_code / content_domain / duplicate_hash / 题干前 100 字）
- 按 test_code × content_domain 分组统计见上表

> 说明：清单等于全量，这本身是结论——**这批题的来源追溯能力为零**，后续若要扩写或改写，只能逐题人工复核，无法按批次筛选。

## 4. 完整性缺口（non-blocking，不计入校验失败）

| 缺口字段 | 影响题数 | 说明 |
|---|---|---|
| distractor_explanations | 969 | schema 硬约束 2 要求逐项写干扰项解释；存量只有 1 条正确答案解释，无干扰项解释 |
| skill | 969 | 存量无 skill 数据。注意：存量 `type` 字段（knowledge / concept / pedagogy）是**认知层级**，不是 skill，不可平移 |
| stimulus | 969 | 存量未拆分刺激材料，一律置 null |

### 刺激材料检测（启发式，非精确分类，供人工判断优先级）

- **依赖外部图表的题：0 题**（0.0%）。
  检测口径：题干出现 "shown below" / "the following table" / "use the chart to" / "according to the graph" 等要求查看外部素材的措辞。
  **结果为 0，即这批题不存在"题干要看图但站点没图"的废题风险**——这是一个已排除的风险，无需排期。
  已另行抽查：题干出现 table / chart / map 等名词的共 8 题，抽查均为考察概念本身（如 "a table's area" 指桌子的面积、"purpose of a diagram in an informational text" 问图表的作用、"type of map projection" 问投影类型），不依赖配图。
- **题干内嵌长文本引语的题：4 题**（0.4%）。这些题的被引材料写在题干里，未拆到 stimulus。若未来要做 stimulus 复用或 passage-based 题组，这 4 题可优先人工拆分。
  注意：另有一批题干提及 passage 但并未内嵌原文（如 "A passage describes how…" 直接陈述内容），这部分不需要拆，也未计入此数。

## 5. 时间戳说明

- 存量 `created_at` / `updated_at` 为毫秒时间戳，本脚本统一转为 ISO-8601 UTC。
- 全库去重后共 **1 个不同的 created_at 值**，值样例：2026-08-23T14:46:51.965Z。
- **这是批量导入时间，不是题目创作时间**，不能当作内容新鲜度依据使用。

## 6. 遗留问题与下一步建议

1. **schema v1 文件未落盘（P1）**。T0 声明产出 `content-infra/item-schema-v1.md` 与 `item-schema-v1.example.json`，但二者在仓库磁盘上不存在（已全盘搜索 `E:\Triumph`）。本次按 T0 事项描述中的字段名清单重建了 5000 分支。建议：让 T0 负责会话把文件补落到 `content-infra/`，再复核本分支与其是否一致。
2. **T0 字段计数与清单不一致（P2）**。描述自称 20 字段，实际列出 21 个字段名。本实现按 21 字段（created_at 与 updated_at 并存）。请 T0 负责人确认以哪个为准。
3. **content_domain 枚举的官方来源未取得（P1）**。11 个领域名沿用存量 category 值，与四个第三方备考站公布的 ETS 口径逐字一致，但**未取得 ETS 官方页面或 Study Companion PDF 可核验源**（官方 URL 本次均重定向至首页）。按项目事实核实红线，目前只能标 `triangulated`，**不得对外声明为官方口径**。建议并入 F1 事实核查那条线补 official_source_url。
4. **干扰项解释缺失 = 2907 条待补**（每题 3 个干扰项）。这是后续内容质检（D24）与 8000 系列扩写前必须面对的存量工作量，建议单独排期评估是否值得全量补写。
5. **缺图风险已排除**：依赖外部图表的题为 0，无需排期排查。仅 4 题内嵌长文本引语，属可选优化（拆 stimulus），非缺陷。
6. **跨系列 id 命名空间冲突风险（P2）**。本批 id 形如 `5002-001`，若 8000 系列沿用相似规则可能撞号。本批保留原 id 保证可追溯；跨系列查重请一律用 duplicate_hash，不要用 id。
