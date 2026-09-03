# Audit Report B — Praxis 5002 Distractor Explanations (merged-5002.jsonl)

**范围**：题库 items-5000-series.jsonl 中 test_code=5002、id 5002-108 至 5002-214（含两端），共 **107 题 / 321 条**干扰项解释。

**机械核查**（脚本辅助）：
- 键与题库选项原文逐字对齐：通过（0 处不匹配）
- 无任何键指向正确答案：通过
- 每题恰好 3 条解释：通过
- 字符长度全部在 60–200 区间：通过
- 全部以第三人称动词开头，无 "This is incorrect because…" / "The correct answer is…" 套话：通过
- 同题两条解释词面重合度（Jaccard > 0.5）检测：无触发

## 总判

| 判级 | 条数 |
|------|------|
| OK | 318 |
| MINOR | 3 |
| MAJOR | 0 |

未发现对位错误、事实错误或误导性问题。以下列出全部 MINOR（MAJOR 为空）。

---

## MINOR 明细

### 1. 5002-183 — 键「Because editing comes first」— MINOR
- **原文**：Reverses the sequence; generating ideas precedes polishing, which is why the process is not linear.
- **问题**：末句 "which is why the process is not linear" 逻辑不顺。"编辑在前"只是顺序颠倒，流程依然是线性的（只是排错了序）；把它说成"非线性"的原因，与题干问的"递归性"因果脱节，可能让读者对递归概念产生模糊理解。对位与事实无误，属表述可更精。
- **建议改写**：Reverses the sequence; generating ideas precedes polishing, while recursion comes from writers looping back to earlier stages.

### 2. 5002-174 — 键「Mood is unrelated to setting」与「Setting has no effect」— MINOR
- **原文**：
  - Denies the connection the question asks about; weather, time, and place are classic mood-builders.
  - Repeats the dismissal; the emotional tone of a scene is largely constructed through its setting.
- **问题**：该题两个干扰项本身即为近义复述，导致对应两条解释也互为近义（第三条甚至自认 "Repeats the dismissal"），"三条互异"维度不达标。根源在题项设计，但解释侧仍可通过侧重点分化缓解。
- **建议改写**（保持第一条不动，分化第二条）：Setting alone cannot build mood; the same place reads as ominous or serene only through the atmospheric details an author supplies.

### 3. 5002-172 — 键「They don't understand vocabulary」— MINOR
- **原文**：Targets word knowledge when the gap is abstraction; retelling plots requires little vocabulary depth.
- **问题**："retelling plots requires little vocabulary depth" 说得过满——情节理解本身也依赖词汇，该子命题在语文学理上站不住，尽管主论点（缺口在抽象概括而非词汇）正确。可能让读者误以为词汇与情节理解无关。
- **建议改写**：Targets word knowledge when the gap is abstraction; the student already follows the events but cannot generalize from them to universal ideas.

---

## 结论
321 条解释整体质量高：对位全部准确、教学知识表述符合 Praxis 5002 层级通行认知、风格统一合规。仅 3 处表述层面瑕疵（1 处逻辑衔接、1 处互异性受题项设计拖累、1 处子命题过满），均可选改，不阻塞发布。
