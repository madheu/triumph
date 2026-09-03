# 8006 多选题 · 答案重做比对报告（27 题）

**日期**：2026-09-03 深夜
**作答方**：DeepSeek V4 Pro（网页版，受托于老户；老户不作英语判断）
**比对方**：Buddy —— 逐题独立仲裁，非机器直比
**工作表**：`8006-multiselect-redo-worksheet.md`（已剥离答案）
**题库**：`8006-multiselect-normalized.json`

## 结果

| 项 | 数 |
|---|---|
| 与原 KEY 一致 | 25 / 27 |
| **KEY 错误（已修正）** | 1（#13） |
| 作答方错误（KEY 维持） | 1（#21） |
| **按修正后 KEY 一致** | **26 / 27** |

## 分歧 1 · #13 `8006-fluency-028`（hard）—— KEY 错，已修正

**题干**：A comprehensive picture of students' **reading fluency** requires which assessment practices?

- 原 KEY：B, C, **E**（E = Gathering vocabulary evidence from both a formal measure and observations…）
- 作答：B, C

**裁决：删除 E，KEY 改为 B、C。**

依据：流利度 = 准确度（accuracy）、速率（rate）、韵律（prosody）。B（running records 捕捉 accuracy/self-correction/phrasing）和 C（速率数据须配理解检验解读）是标准流利度评估实践。**E 的解析通篇在论证"词汇评估要多源取证"，与题干问的流利度零关联**——解析答的是另一道题，这是典型的模板改编残留（题干从"全面阅读评估"收窄到"流利度"时，E 没跟着改）。

已同步修正：
- `correct_answer` → B、C 两项
- E 的解析从 `explanation` 移入 `distractor_explanations`，改写为指向题干的排除理由
- 复跑验收：PASS、0 阻断（duplicate_hash 只含题干+选项，不受答案修正影响）

## 分歧 2 · #21 `8006-foundational-033`（medium）—— 作答方错，KEY 维持

**题干**：A first-grade teacher wants a complete picture of each student's **foundational literacy development**.

- KEY：A, B, C
- 作答：A, B, C, **D**（D = listening comprehension assessment）

**裁决：维持 ABC，D 不选。**

依据：D 的干扰项解析本身就是正确理由——听力理解测的是 language comprehension（Scarborough 绳索的另一股），与 phonemic awareness / phonics / decoding 不同股。信息有价值，但回答不了"基础读写发展"。作答方被 "complete picture" 诱导多选。

## 方法说明（为什么这个比对可信）

1. 作答完全独立（工作表无答案无解析，已验证零泄漏）
2. 两道分歧均由比对方重新独立审题后裁决，依据写入上文明示
3. #13 属**真答案错误**——27 题重做的机制价值就此兑现：若未重做，上线后考生会因选了"正确的实践"被判错

## 状态

- [x] 27 题答案组合重做 + 比对
- [x] #13 KEY 修正 + 解析归位 + 复验
- [x] 老户对 #13 修正点头（2026-09-03 23:21「可以了」）
- [x] 老户对 27 题批量签字（同轮消息整体确认；其对 #21 的 phonics 疑问经澄清解决——B 选项假词拼读即 phonics 测评，本就在 KEY 内，D 维持不选）
- [x] 已转正：27 题 `review_status` → `human-reviewed`（reviewer 标注 huhu-signoff-2026-09-03），复验 PASS、0 阻断

## 给出题会话的提醒

"comprehensive / complete picture" 类题干在收窄主题域时易留模板残留选项（#13 即此类）。后续批次生成时，凡题干限定某单一构件（如 fluency），逐项检查选项是否仍属该构件。
