# validate-8006-items.py 自检记录

> 建立：2026-09-03（D5 准备阶段）
> 目的：证明验收脚本**抓得住已知错误**，而不只是"能跑通"

---

## 0. 为什么要有这个目录

D2 留下的教训：脚本自报 100% 通过，只能证明它自己没抛错。

8006 题目由另一个会话交付，交付时**没人能预先知道题目里有什么问题**。如果验收脚本本身是坏的（永远 PASS），D5 的五项检查就形同虚设，坏题会直接入库上线。

所以这里保留一套**可复现的自检夹具**：故意植入已知缺陷，跑脚本，看它能不能逐条抓出。以后脚本任何一次修改，重跑一次就能确认没改坏。

---

## 1. 怎么跑

```bash
cd content-infra/selftest-8006

# 生成夹具
python make-fixture.py            # 33 题，含 13 类已知缺陷
python make-fixture.py --clean    # 30 题，全部合规

# 跑验收
python ../validate-8006-items.py bad-8006-items.jsonl     # 期望：❌ FAIL
python ../validate-8006-items.py clean-8006-items.jsonl   # 期望：✅ PASS
```

期望结果：**坏夹具 FAIL，干净夹具 PASS。** 任一不符即脚本有问题，不得用于正式验收。

---

## 2. 植入缺陷与抓出结果（坏夹具）

| # | 植入的缺陷 | 期望被判为 | 实际结果 |
|---|---|---|---|
| 1 | `F01` question_type = numeric-entry | 阻断（8006 官方无此题型） | ✅ `bad_enum` + `forbidden_question_type` + `question_type_violation` |
| 2 | `F02` 题干 "According to the table" 但 stimulus 为空 | 阻断（废题） | ✅ `missing_stimulus` |
| 3 | `F03` 题干 "In the passage above" 但 stimulus 为空 | 阻断（废题） | ✅ `missing_stimulus` |
| 4 | `V13` content_domain = "Fluency **&** Vocabulary" | 阻断（官方写法是 and） | ✅ `bad_content_domain` + `unknown_domain_present`，并附带「官方用 and 不是 &」提示 |
| 5 | `V14` explanation 含 "a scaled score of 165" | 阻断（硬红线） | ✅ `score_claim` |
| 6 | `C22` stimulus 含 "© 2019 Scholastic. All rights reserved." | 阻断（硬红线） | ✅ `copyright_risk` |
| 7 | `C23` test_code = 8002 | 阻断 | ✅ `wrong_test_code` |
| 8 | `C24` 否定式题干（NOT） | 进人工队列（不自动判错） | ✅ 人工队列「重点核验是否存在第二个成立选项」 |
| 9 | `C25` 正确选项长度 2 倍于其他选项 | 进人工队列 | ✅ 人工队列「确认是否因长度泄露答案」 |
| 10 | `D01`/`D02` 同题干、选项顺序调换 | 阻断（批内重复） | ✅ `intra_batch_duplicate`，2 题共享同一 hash |
| 11 | `L01` 逐字复制存量 5002-001 | 阻断（跨系列重复） | ✅ `cross_series_duplicate`，与 969 题比对命中 |
| 12 | `L01` duplicate_hash 故意填 64 个 0 | 警告（以复算值为准） | ✅ `hash_mismatch` 1 条 |
| 13 | 上述缺陷导致领域分布失衡 | 提示 | ✅ 输出 14/8/10，其中 `Fluency & Vocabulary` 计入 unknown |

**结果：13 项全部抓出，零漏报。** 退出码 1（FAIL）。

---

## 3. 干净夹具：零误报验证

`clean-8006-items.jsonl`（30 题，领域分布精确 12 / 9 / 9，含完整 distractor_explanations）：

```
结论     : ✅ PASS（含 warning）
阻断项    : 0
批内精确重复 0｜跨系列重复 0｜近似重复嫌疑 0
hash 独立复算不一致 0
领域分布  : FLS 12/12 · F&V 9/9 · CWE 9/9
红线扫描  : 版权 0｜scaled score 承诺 0｜敏感表述 0｜官方口径表述 0
```

**零误报。** 说明脚本不会因为格式合规的题目乱报警。

唯一的 warning 是 `skill`/`stimulus` 为 null 的完整性缺口（30×2=60 条）。这是设计如此——这两字段在 8006 新题里是否要填，取决于出题方，脚本不强行阻断。

---

## 4. 跨语言 hash 一致性（关键）

跨系列查重靠 `duplicate_hash`。存量 969 题的 hash 是 **D2 用 Node 生成的**，本脚本是 **Python**。两边算法若不一致，跨系列查重就是假的——看起来在比对，实际永远比不出重复。

验证方式：用本脚本的 Python 实现重新计算存量 969 题的 hash，与文件中 Node 产出的值逐条比对。

```
Python 复算 vs D2 Node 产出：一致 969 / 不一致 0
```

**完全一致。** 归一化规则（小写 + 移除非 `[a-z0-9]`）、选项排序、`|` 拼接、SHA-256 四个环节两边实现相同。跨系列查重有效。

---

## 5. 幂等性

坏夹具连跑两次，`--json-report` 输出的全量 JSON **完全相同**（verdict、errors 数、review_queue 数、全字段逐字节一致）。

脚本无随机性、无时间依赖，可重复执行。

---

## 6. 已知局限（不要误用这个脚本）

1. **启发式结果一律不是结论。**
   自检过程中实测发现：教学情境题的正则**召回率低**——题干含 "for elementary students at varied levels" 的题目 0 命中，因为规则只匹配 "a student" / "the teacher" / "grade N" 等特定短语。

   原始实现会据此算出「28.1%，超出官方 10–15%」并发警告。**这是拿误报当结论**，已修正：现在只输出候选题 ID，不再算占比、不再判达标，并在人工队列里登记「通读全批人工确认 10–15%」。

2. **答案交叉检查（D5 第 4 项）本质是人工工作。**
   脚本能做的是缩小范围（否定式题干、绝对化正确选项、选项高度重叠、长度泄露），**判断是否存在第二个合理答案必须由人独立重做一遍**。脚本在「自动可疑标记 = 0」时会显式警告：这**不等于**交叉检查通过。

3. **不校验题目内容是否正确。**
   脚本查格式、查重复、查红线，不查「这道阅读教学题的答案是否符合 Science of Reading 原则」。内容准确性靠人工审题。

4. **夹具内容是占位数据**，为触发检查而构造，**不得入库、不得上线**。

---

## 7. 维护约定

改 `validate-8006-items.py` 后，必须重跑本目录两个夹具并确认：

- `bad-8006-items.jsonl` → ❌ FAIL
- `clean-8006-items.jsonl` → ✅ PASS

建议把这两条并入 D14 整站技术检查的 checklist。

---

## 8. 2026-09-03 深夜升级（真实交付驱动）

首批 8006 交付（items/8006-batch1.json，30 题）暴露了验收器三个缺陷，当轮修复并回归：

| # | 缺陷 | 修复 |
|---|---|---|
| 1 | **崩溃**：交付 choices 是 `{key, text}` 对象，脚本按字符串做 `set(ch)` 直接 TypeError | 新增 `choice_text()` / `choice_key()` / `answer_pool()`，全链路（schema、hash、答案检查、红线扫描）统一适配两种形态 |
| 2 | **事实性错误**：把 multiple-select 列为违禁题型。ETS Study Companion 对 selected-response 的官方定义是 "select **one or more** answers"，多选是合法子形态 | `ALLOWED_QUESTION_TYPES = {single-select, multiple-select}`；多选题全部进人工复核队列，并新增题干须含 "Select all that apply" 的一致性检查 |
| 3 | 题型与答案结构一致性无检查 | 新增：multiple-select 必须列表答案且 ≥2 项、single-select 必须非列表答案 |

修复后回归：坏夹具 13 错零漏报、干净夹具零误报（PASS / 0 errors）。

**注意**：多选题的 correct_answer 若是 key（'A'/'B'），schema/hash 归一化取 `text` 参与计算，与 str 形态的存量 969 题保持可比。
