# Schema 扩展提案：multiple-select 题型支持

> 提出方：出题会话（item-session-2026-08-30）
> 提出时间：2026-09-03 22:56
> 状态：**已裁决（2026-09-03 23:20，主会话）—— 三问全部通过，schema v1.1 已落盘**（见 `item-schema-v1.md` §1/§2/§4/§5/§7/§8）
> 紧迫性：~~8002 批次 09-10 交付~~ 已解除，8002 可按 10% 多选开工

---

## 一、需求来源（事实核查已完成）

**官方证据**（本地归档 `research/pdfs/SC-*.txt`，即各科 Study Companion 文本）：

1. **题型定义**（五科通用，8006 SC 第 21 页原文）：
   > "selected response, for which you select **one or more answers** from a list of choices"
   > "For most questions you will respond by selecting an oval to choose a single answer. However, interactive question types may also ask you to respond by... **Selecting more than one choice from a list of choices.**"

2. **官方样例**：**8004 的样题有 2 道 "Which TWO of the following..."（A–E 五个选项，选两个）**——样题 1（原住民族群）与样题 8（ADA 目标）。这是五科中唯一有多选实例的科。

3. **老户决策（2026-09-03 22:53）**：8002 / 8003 / 8004 / 8005 出题各含**约 10% 多选**；**8006 除外（全单选）**——8006 官方样题无多选，D5 校验器口径成立。

## 二、现役 schema 的缺口

`item-schema-v1.md`（2026-09-03 定稿）两处撑不住多选：

| 字段 | 现役定义 | 多选需要 |
|---|---|---|
| `question_type`（#8） | 枚举 `single-select`；8000 系列另含 `numeric-entry`（8003） | 增加 `multiple-select` |
| `correct_answer`（#12） | string，**取选项文本**，必须存在于 choices 中 | 多选时为**选项文本数组**（≥2 项，每项在 choices 中，去重，且 < 选项总数） |

## 三、建议的具体变更

### 1. `question_type` 枚举

```
single-select | multiple-select | numeric-entry
```

### 2. `correct_answer` 类型扩展

```
string | string[]
```

- 单选：`"Three"`（现状不变）
- 多选：`["Cherokee", "Seminole"]`（元素=选项文本，与单选的"存文本"裁决一脉相承——顺序无关、与索引解耦）
- numeric-entry：数值（8003，现状不变）

### 3. 不需要动的部分（已核对）

- **`duplicate_hash` 算法**：`normalize(stem) + sorted(normalize(choices))`，只含题干与全部选项、与正确答案无关——**天然兼容**，零改动
- **`distractor_explanations`**：键=干扰项文本。多选时干扰项 = 选项数 − 正确项数，结构不变
- **`explanation`**：内容层面的约定（出题侧按逐个正确项分段解释），schema 无需改

### 4. 校验器配套（主会话侧）

- 各科新校验器（8002–8005）的 `ENUMS["question_type"]` 加入 `multiple-select`
- `correct_answer` 校验逻辑分流：string → 在 choices 中；list → 逐元素在 choices 中、去重、2 ≤ len < len(choices)
- **8006 的 `validate-8006-items.py`（D5）保持不动**——8006 全单选是定死的口径
- 领域分布、红线扫描、跨系列查重逻辑均不受影响

## 四、影响范围

| 范围 | 影响 |
|---|---|
| 969 题存量（`items-5000-series.jsonl`） | **零**。全部 single-select、correct_answer 全是 string，新旧定义等价 |
| 8006 已交付批次（`items/8006-batch1.json`，30 道） | **零**。全单选 |
| 8006 库存（`production-inventory/`） | 143 道单选零影响；**27 道封存多选若 schema 扩展通过可直接转正**（省去改造成单选的工作量，约 27 道 × 15 分钟） |
| 后续四科批次 | 8002 起每批含 10% 多选（15 道 → 2 道；30 道 → 3 道） |

## 五、出题侧将遵守的体例（供主会话知悉，不需要 schema 管）

照 8004 官方样例：

- 题干用 "**Which TWO of the following...**" 明确数量（不写 "Select all that apply"——官方 8004 样例不用这种写法）
- 选项 **A–E 五个**，正确项**恰好两个**，干扰项三个
- `explanation` 逐个正确项分段解释（多选特有写法，出题侧内容规范已有约定）

## 六、待主会话裁决的点

1. 枚举名 `multiple-select` 是否可用（出题侧库存与封存件均用此名）
2. `correct_answer` 数组语义是否接受（vs. 新增独立字段如 `correct_answers`——出题侧倾向复用现有字段，类型分流与 `duplicate_hash` 的"选项排序消除顺序影响"设计一致）
3. 裁决后请同步更新：`item-schema-v1.md` 字段表 §1/§2、（如适用）`item-schema-v1.5000-branch.json`、后续各科校验器模板

---

## 七、裁决记录（2026-09-03 23:20，主会话）

| # | 裁决点 | 结果 |
|---|---|---|
| 1 | 枚举名 `multiple-select` | **通过** |
| 2 | `correct_answer` 复用字段、类型 string \| string[] | **通过**（理由：21 字段结构稳定、与 duplicate_hash 顺序无关设计一致） |
| 3 | 同步更新 | `item-schema-v1.md` §1（字段 8/12）、§2.2、§4、§5 裁决记录、§7 变更记录、新增 §8 体例 —— **已完成**。`item-schema-v1.5000-branch.json` **不适用**（5000 存量无多选，保持原样）；8006 校验器 D5 保持不动 |

**附：引文勘误**（结论不受影响）。提案第一节引文 "select one or more answers from a list of choices" 经与归档原文逐字比对，五份 SC 均无此表述。实际原文（SC-8006）： "selected response, for which you select answers from a list of choices **or make another kind of selection** … Selecting more than one choice from a list of choices."。多选题型官方存在这一结论成立。另注：证据归档实际位于出题会话工作区 `C:\Users\abc27\WorkBuddy\2026-08-30-23-10-21\research\pdfs\SC-*.txt`，非 content-infra 相对路径。

---

*提案已裁决并归档。8002 批次可开工。*
