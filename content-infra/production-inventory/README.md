# 8006 生产库存（出题会话）

> 维护方：出题会话（item-session-2026-08-30）
> 更新：2026-09-03 23:35 —— 数字勘误（143→173、batch1 情境题数纠正）；多选已归一化转正

## ⚠️ 勘误（2026-09-03 23:35，出题会话自查 + 主会话 answer-review 抓出）

本 README 前一版有两处数据错误，已更正：

1. **`8006-single.json` 是 173 道，不是 143 道**（笔误；173+27=200，与 id_map 的 200 条吻合）
2. **batch1 的教学情境题是 18 道（60%），不是"4 道 13.3%"**。挑选脚本的计数只统计了"走情境优先通道"的 4 道，难度配额补齐时未排除其余情境题，导致 14 道情境题经普通通道混入，而报告只数了通道数。**30 题里 18/24 情境题入选，ToT 占比 60%，超官方 10–15% 口径约 4 倍**——题目本身成立（主会话逐题复核 30/30 答案一致），属蓝图代表性问题，处置见 `../items/8006-batch1-answer-review.md` §4（待老户裁决：照常上线但页面文案不称"模拟真题蓝图"，或从单选池换 10–15 道直接知识型题）。

## 内容

| 文件 | 内容 | 说明 |
|---|---|---|
| `8006-single.json` | **173 道单选**（schema v1.1 口径） | 库存主体。D5 schema 层零阻断、与 969 存量跨系列查重零重复、duplicate_hash 实算（主会话 22:30 复验报告 `8006-single-validation.json`，3 条 error 均为 domain_off_target——D5 的 12/9/9 目标是给 30 题批次设的，对 173 题库存跑必然偏，非质量问题） |
| `8006-multiselect-normalized.json` | **27 道多选（已转正）** | 主会话 23:23 归一化到 schema v1.1；答案经外部模型独立重做 + 仲裁，**#13 fluency-028 的 KEY 真错误已修正**（E 为模板残留）；`review_status: human-reviewed`（huhu-signoff-2026-09-03），复验 PASS。**注意：8006 的 D5 校验器口径仍是全单选，此 27 道不得进 8006 交付批次**——它们是现役格式的多选题素材库，真正可用武之地是 8002–8005 的 10% 多选配额（改科目元数据后可复用） |
| `8006-multiselect-quarantine.json` | 27 道多选（封存原件，旧口径） | 历史存档，勿再使用；以 normalized 版为准 |
| `8006-multiselect-redo-diff.md` | 多选答案重做比对报告 | 25/27 一致、1 KEY 修正、1 维持；含 #13 的裁决依据 |
| `8006-single-validation.json` / `8006-multiselect-normalized-validation.json` / `8006-multiselect-validation.json` | 主会话的复验报告 | |
| `id_map.json` | 新旧 id 对照（200 条） | `8006-PPA-0006` → `8006-foundational-006` 等 |
| `sidecar.json` | 教学情境题清单（24 道） | schema 无 tasks_of_teaching 字段，情境题占比靠此清单留档 |

## 已交付

`../items/8006-batch1.json` —— 30 道全部 single-select（领域 12/9/9、难度 10/10/10），取自单选池，D5 验收 PASS。**教学情境题 18 道（60%）超官方配额**，处置待老户裁决（见上方勘误 2）。答案交叉检查：主会话独立作答 30/30 一致（`../items/8006-batch1-answer-review.md`）。

## 口径适配记录（2026-09-03 22:00）

旧口径（WorkBuddy 会话目录版 schema）→ 现役口径（E:\Triumph\praxis-5001\content-infra\item-schema-v1.md，v1.1）的九处差异：

1. `content_domain`：`Fluency & Vocabulary` → **`Fluency and Vocabulary`**（官方逐字校验，`&` 一律判错）
2. `choices`：`[{key,text}]` 对象数组 → **`[text]` 字符串数组**
3. `correct_answer`：选项 key（"A"）→ **选项全文文本**（v1.1 起 multiple-select 为文本数组）
4. `distractor_explanations`：键从 key → **选项文本**
5. `duplicate_hash`：`sha256:PENDING_ON_INGEST` → **实算 SHA-256**（normalize 后 `|` 拼、选项排序消除顺序影响；校验器独立复算）
6. `review_status`：`ai-reviewed` → **`draft`**（新题一律从 draft 起步）
7. `source_basis`：长文本描述 → **枚举 `expert-judgment`**
8. `test_code`：字符串 `"8006"` → **整数 `8006`**
9. ~~multiple-select 不在合法枚举~~ → **v1.1（23:19）已扩枚举**：8002–8005 合法、每批约 10%；8006 仍全单选（D5 口径不变）

适配脚本：`adapt_e_schema.py`（出题会话工作区 items/ 下），适配后 D5 验收 PASS。

## 给后续批次的教训（2026-09-03 深夜补）

- **"comprehensive / complete picture" 类题干收窄主题域时易留模板残留选项**（#13 即此类：题干从"全面阅读评估"收窄到"流利度"，选项 E 没跟着改）。后续生成时凡题干限定单一构件，逐项检查选项是否仍属该构件。
- **挑选子集时情境题要设总量上限**：只给"优先通道"不设排除条件，情境题会从普通通道混入，计数只看通道就会漏报（本次 4 vs 实际 18 的事故）。
