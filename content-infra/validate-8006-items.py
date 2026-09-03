#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
validate-8006-items.py — Praxis 8006 题目验收器（D5）

用途：8006 题目由另一会话按 schema v1 生产。本脚本负责验收，不生产题目。
      题目交付后直接跑，五项检查 + 内容红线扫描一次出结果。

用法：
    python validate-8006-items.py <题目文件.jsonl|.json> [--legacy <存量jsonl>] [--json-report out.json]

默认存量比对文件：同目录下的 items-5000-series.jsonl（969 题，D2 产出）

五项检查：
    [1] schema 校验    —— 字段齐全、类型正确、枚举合法（含官方领域名逐字比对）
    [2] 去重           —— duplicate_hash 独立复算，批内 + 与 969 题存量跨系列比对
    [3] 领域分布       —— 30 题应为 12 / 9 / 9，偏离判定见 DOMAIN_TARGET
    [4] 答案交叉检查   —— 自动可判部分 + 生成必须人工复核的清单
    [5] 题干缺条件     —— 外部图表引用、numeric-entry 误用、指代缺失
    附加：内容红线扫描 —— 刻板印象、版权风险、scaled score 承诺、非官方口径冒充

设计原则（继承 D2 教训）：
    · 独立复算，不信任输入。脚本不采用题目文件自带的 duplicate_hash 字段值，
      而是按 schema 定义的算法重新计算并逐条比对。自报的值只能证明它自己写了值。
    · 启发式结果一律标记为「待抽查」，不直接写成结论。扫描出来的数字不是事实。
    · 零依赖，只用标准库。Python 3.8+。

退出码：0 = 全部通过（含 warning）｜1 = 存在 blocking 失败｜2 = 用法/文件错误
"""

import argparse
import hashlib
import json
import os
import re
import sys
from collections import Counter, OrderedDict

# ---------------------------------------------------------------- 常量定义

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_LEGACY = os.path.join(SCRIPT_DIR, "items-5000-series.jsonl")

TEST_CODE = 8006
SERIES = "8000"

# 官方领域名 —— 取自 ETS V5 宣传册原文（docs/sources/ets-...-V5-2025.pdf）
# ⚠️ 官方写法是 "Fluency and Vocabulary"（and），不是 "Fluency & Vocabulary"。
#    D5 事项描述里用的 & 是简写，脚本按官方名严格校验，& 写法一律判错。
CONTENT_DOMAINS = {
    "Foundational Literacy Skills": 12,
    "Fluency and Vocabulary": 9,
    "Comprehension and Written Expression": 9,
}
DOMAIN_TOTAL = 30
# 偏离判定：任一领域 ±2 题内接受（30 题样本下 ±2 已是 6.7% 偏移），超出即退回。
DOMAIN_TOLERANCE = 2

# 8006 官方题型：全部 selected-response（含单选与多选两种形态）。
# multiple-select 是 selected-response 的合法子形态（ETS 考题常见 "Select all that apply"），
# 但多选题答案组合极易出错，全部进人工复核队列。
# 真正违禁的是 numeric-entry / constructed-response —— 官方明确 8006 无此类题型。
ALLOWED_QUESTION_TYPES = {"single-select", "multiple-select"}
FORBIDDEN_QUESTION_TYPES = {"numeric-entry", "constructed-response", "essay"}

FIELD_ORDER = [
    "id", "series", "test_code", "subject", "content_domain", "skill",
    "difficulty", "question_type", "stimulus", "stem", "choices",
    "correct_answer", "explanation", "distractor_explanations",
    "source_basis", "review_status", "reviewer", "version",
    "duplicate_hash", "created_at", "updated_at",
]
FIELD_COUNT = len(FIELD_ORDER)  # 21（D5 事项描述写 20，此处以 schema field_order 为准，出入见报告）

ENUMS = {
    "series": {"8000"},
    "difficulty": {"easy", "medium", "hard"},
    "question_type": ALLOWED_QUESTION_TYPES,
    "source_basis": {"legacy-unknown", "expert-judgment", "official-source"},
    "review_status": {"draft", "human-reviewed", "rejected"},
}
SUBJECT = "Teaching Reading"

ISO8601_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$")
HASH_RE = re.compile(r"^[0-9a-f]{64}$")

# ---------------------------------------------------------------- 启发式规则
# 全部标注为「待抽查」：命中不等于有问题，仅提示人工看原文。

# 外部图表引用：题干要求看图但站点无图 → 废题
STIMULUS_REF_PAT = re.compile(
    r"\b(shown below|the following (table|graph|chart|diagram|figure|passage|excerpt)|"
    r"according to the (table|graph|chart|diagram|figure)|the (table|graph|chart|diagram|figure) above|"
    r"in the passage above|the excerpt above|refer to the (table|figure|diagram))\b",
    re.I,
)
# 指代缺失：题干出现代词但无 stimulus 支撑
DANGLING_REF_PAT = re.compile(r"\b(this (passage|excerpt|text)|the passage|the excerpt|the student's response)\b", re.I)

# 刻板印象 / 敏感价值判断命中词（命中即人工必看，不自动判退）
BIAS_PAT = re.compile(
    r"\b(boys are (better|worse)|girls are (better|worse)|"
    r"(black|white|asian|hispanic|latino) students (typically|usually|naturally)|"
    r"(christian|muslim|jewish|hindu) (students|families|children) (typically|usually)|"
    r"students with disabilities (cannot|can't|are unable)|"
    r"(inner[- ]city|urban) students (typically|usually|tend to)|"
    r"low[- ]income (students|families) (typically|usually|naturally))\b",
    re.I,
)
# 版权风险：可能引用真实出版物原文
COPYRIGHT_PAT = re.compile(
    r"\b(excerpt (from|copyright)|©|\ball rights reserved\b|reprinted (from|with permission)|"
    r"from the book|published by (scholastic|penguin|harpercollins|macmillan|houghton))\b",
    re.I,
)
# scaled score 承诺：8006 无官方换算表，任何换算承诺都是编的
SCORE_CLAIM_PAT = re.compile(
    r"\b(scaled score of|your scaled score|converts to a score|"
    r"this (corresponds to|equals) a (scaled )?score|you would (score|earn) (a|approximately))\b",
    re.I,
)
# 冒充官方口径
OFFICIAL_CLAIM_PAT = re.compile(
    r"\b(ETS (states|requires|confirms|specifies)|according to ETS|"
    r"the official (ETS )?(blueprint|specification)|ETS guidelines)\b",
    re.I,
)
# 教学情境题启发式（用于统计 10–15% 占比，结果标「待抽查」）
TEACHING_SCENARIO_PAT = re.compile(
    r"\b(Ms\.|Mr\.|Mrs\.|the teacher|your students|a student|the class|"
    r"grade \d|first[- ]grade|second[- ]grade|third[- ]grade|fourth[- ]grade|fifth[- ]grade|"
    r"small group|whole[- ]class|lesson plan|during (a|the) lesson)\b",
    re.I,
)


# ---------------------------------------------------------------- 工具函数

def normalize(t):
    """schema duplicate_hash_algorithm 步骤 1：小写 + 移除非 [a-z0-9] 全部字符"""
    return re.sub(r"[^a-z0-9]", "", str(t).lower())


def choice_text(c):
    """选项统一取文本：支持 str 与 {key, text} 对象两种交付形态"""
    if isinstance(c, dict):
        return str(c.get("text", ""))
    return str(c)


def choice_key(c):
    """{key, text} 形态的选项标识（如 'A'）；str 形态返回 None"""
    if isinstance(c, dict):
        return c.get("key")
    return None


def answer_pool(it):
    """correct_answer 的合法取值池：{key,text} 形态用 key 集合，str 形态用文本集合"""
    ch = it.get("choices") or []
    if ch and all(isinstance(c, dict) for c in ch):
        return {choice_key(c) for c in ch}
    return {choice_text(c) for c in ch}


def compute_duplicate_hash(stem, choices):
    """
    schema duplicate_hash_algorithm：
      parts = [normalize(stem)] + sorted(normalize(choices))
      payload = "|".join(parts)
      hash = sha256(payload).hexdigest()
    与 D2 的 Node 实现保持一致（映射脚本与校验脚本必须共用同一实现）。
    choices 支持 str 与 {key,text} 对象两种形态（对象取 text 参与归一化）。
    """
    parts = [normalize(stem)] + sorted(normalize(choice_text(c)) for c in choices)
    return hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()


def load_items(path):
    """支持 .jsonl（每行一题）与 .json（顶层数组或 {items:[...]}）"""
    if not os.path.exists(path):
        raise FileNotFoundError(path)
    with open(path, "r", encoding="utf-8") as f:
        raw = f.read().strip()
    if not raw:
        return []
    if path.lower().endswith(".jsonl"):
        items, bad_lines = [], []
        for i, line in enumerate(f_content_lines(raw), 1):
            line = line.strip()
            if not line:
                continue
            try:
                items.append(json.loads(line))
            except json.JSONDecodeError as e:
                bad_lines.append({"line": i, "error": str(e)})
        return items, bad_lines
    data = json.loads(raw)
    if isinstance(data, list):
        return data, []
    if isinstance(data, dict):
        for key in ("items", "questions", "data"):
            if isinstance(data.get(key), list):
                return data[key], []
        return [data], []
    return [], [{"line": 0, "error": "unrecognized JSON structure"}]


def f_content_lines(raw):
    return raw.splitlines()


def approx_dupe(a, b):
    """
    近似查重：题干词集包含度 ≥85%（D2 校验器同款思路）。
    精确哈希抓不到「改词重复」，这层是唯一能发现的方式。
    """
    wa = set(normalize(a).split())
    wb = set(normalize(b).split())
    if not wa or not wb:
        return False
    inter = len(wa & wb)
    return (inter / len(wa) >= 0.85) or (inter / len(wb) >= 0.85)


# ---------------------------------------------------------------- 五项检查

def check_schema(items, errors, warnings):
    """[1] schema 校验：字段齐全、类型正确、枚举合法"""
    seen_ids = {}
    for idx, it in enumerate(items):
        tag = it.get("id", f"#<{idx}>")

        # 字段齐全
        missing = [f for f in FIELD_ORDER if f not in it]
        if missing:
            errors.append({"item": tag, "check": "schema", "code": "missing_fields", "detail": missing})
        extra = [k for k in it if k not in FIELD_ORDER]
        if extra:
            warnings.append({"item": tag, "check": "schema", "code": "extra_fields", "detail": extra})

        # test_code / series
        if it.get("test_code") != TEST_CODE:
            errors.append({"item": tag, "check": "schema", "code": "wrong_test_code",
                           "detail": f"expected {TEST_CODE}, got {it.get('test_code')!r}"})
        if it.get("series") != SERIES:
            errors.append({"item": tag, "check": "schema", "code": "wrong_series",
                           "detail": f"expected {SERIES}, got {it.get('series')!r}"})
        if it.get("subject") != SUBJECT:
            errors.append({"item": tag, "check": "schema", "code": "wrong_subject",
                           "detail": f"expected {SUBJECT!r}, got {it.get('subject')!r}"})

        # id 唯一
        if tag in seen_ids:
            errors.append({"item": tag, "check": "schema", "code": "duplicate_id",
                           "detail": f"first seen at index {seen_ids[tag]}"})
        else:
            seen_ids[tag] = idx

        # 枚举
        for f in ("difficulty", "question_type", "source_basis", "review_status"):
            v = it.get(f)
            if v is not None and v not in ENUMS[f]:
                errors.append({"item": tag, "check": "schema", "code": "bad_enum",
                               "detail": f"{f}={v!r}, allowed={sorted(ENUMS[f])}"})

        # 题型：8006 官方全为 selected-response
        qt = it.get("question_type")
        if qt in FORBIDDEN_QUESTION_TYPES:
            errors.append({"item": tag, "check": "schema", "code": "forbidden_question_type",
                           "detail": f"{qt!r} — 8006 官方 80 题全部为 selected-response，无此类题型"})

        # content_domain 官方名逐字校验
        cd = it.get("content_domain")
        if cd not in CONTENT_DOMAINS:
            err = {"item": tag, "check": "schema", "code": "bad_content_domain",
                   "detail": f"{cd!r} not an official 8006 domain"}
            if cd and "&" in str(cd):
                err["detail"] += "（注意：官方写法是 'and' 不是 '&'，例如 Fluency and Vocabulary）"
            errors.append(err)

        # choices / correct_answer（支持 str 与 {key,text} 对象形态；answer 支持单选/多选）
        ch = it.get("choices")
        if not isinstance(ch, list) or len(ch) < 2:
            errors.append({"item": tag, "check": "schema", "code": "bad_choices",
                           "detail": f"choices must be a list of >=2, got {type(ch).__name__}"})
        else:
            texts = [choice_text(c) for c in ch]
            keys = [choice_key(c) for c in ch]
            if len(set(texts)) != len(texts):
                errors.append({"item": tag, "check": "schema", "code": "duplicate_choices",
                               "detail": "choices 中存在完全相同的选项"})
            ca = it.get("correct_answer")
            ans_list = ca if isinstance(ca, list) else [ca]
            pool = answer_pool(it)
            bad = [a for a in ans_list if a not in pool]
            if bad:
                errors.append({"item": tag, "check": "schema", "code": "correct_answer_not_in_choices",
                               "detail": f"correct_answer={bad!r} 不在 choices 池 {sorted(pool)[:6]} 中"})
            # 题型与答案结构一致性
            qt = it.get("question_type")
            if qt == "multiple-select" and not isinstance(ca, list):
                errors.append({"item": tag, "check": "schema", "code": "multiselect_answer_not_list",
                               "detail": f"question_type=multiple-select 但 correct_answer={ca!r} 不是列表"})
            if qt == "multiple-select" and isinstance(ca, list) and len(ca) < 2:
                errors.append({"item": tag, "check": "schema", "code": "multiselect_single_answer",
                               "detail": f"multiple-select 仅 {len(ca)} 个正确答案，应改标 single-select"})
            if qt == "single-select" and isinstance(ca, list):
                errors.append({"item": tag, "check": "schema", "code": "singleselect_answer_is_list",
                               "detail": f"question_type=single-select 但 correct_answer={ca!r} 是列表"})
            if qt == "multiple-select" and not re.search(r"select all that apply", str(it.get("stem", "")), re.I):
                warnings.append({"item": tag, "check": "schema", "code": "multiselect_missing_instruction",
                                 "detail": "multiple-select 题干未见 'Select all that apply' —— 考生无法知道是多选"})

        # stem / explanation 非空
        for f in ("stem", "explanation"):
            v = it.get(f)
            if not isinstance(v, str) or not v.strip():
                errors.append({"item": tag, "check": "schema", "code": "empty_field", "detail": f})

        # 时间格式
        for f in ("created_at", "updated_at"):
            v = it.get(f)
            if v is not None and not ISO8601_RE.match(str(v)):
                errors.append({"item": tag, "check": "schema", "code": "bad_timestamp",
                               "detail": f"{f}={v!r}, expected ISO-8601 UTC (…Z)"})

        # version
        v = it.get("version")
        if not isinstance(v, int) or v < 1:
            errors.append({"item": tag, "check": "schema", "code": "bad_version", "detail": repr(v)})

        # 完整性缺口（warning，不阻断）
        for f in ("distractor_explanations", "skill", "stimulus"):
            if it.get(f) is None:
                warnings.append({"item": tag, "check": "completeness", "code": f"{f}_null",
                                 "detail": "schema 要求但为 null —— 8006 新题不应沿用存量缺口，建议补齐"})
        de = it.get("distractor_explanations")
        if isinstance(de, dict) and ch and len(de) < len(ch) - 1:
            warnings.append({"item": tag, "check": "completeness", "code": "incomplete_distractor_explanations",
                             "detail": f"{len(de)} 条干扰项解释，应为 {len(ch) - 1} 条"})


def check_duplicates(items, legacy_path, errors, warnings, info):
    """[2] 去重：独立复算 hash，批内 + 跨系列与存量比对"""
    recomputed, hash_mismatch = {}, []
    for it in items:
        stem, ch = it.get("stem", ""), it.get("choices") or []
        h = compute_duplicate_hash(stem, ch)
        recomputed[it.get("id", "")] = h
        declared = it.get("duplicate_hash")
        if declared and declared != h:
            hash_mismatch.append({
                "item": it.get("id"), "declared": declared, "recomputed": h,
                "note": "输入文件自带的 hash 与独立复算不一致 —— 以复算值为准",
            })

    if hash_mismatch:
        warnings.append({"check": "dedupe", "code": "hash_mismatch", "count": len(hash_mismatch),
                         "samples": hash_mismatch[:5]})

    # 批内精确重复
    by_hash = {}
    for iid, h in recomputed.items():
        by_hash.setdefault(h, []).append(iid)
    intra = {h: ids for h, ids in by_hash.items() if len(ids) > 1}
    if intra:
        for h, ids in intra.items():
            errors.append({"check": "dedupe", "code": "intra_batch_duplicate",
                           "detail": f"{len(ids)} 题共享 duplicate_hash {h[:12]}…", "items": ids})
    info["intra_batch_duplicates"] = len(intra)
    info["hash_mismatch_count"] = len(hash_mismatch)

    # 与存量 969 题跨系列比对
    legacy_hashes = set()
    if legacy_path and os.path.exists(legacy_path):
        legacy_items, _ = load_items(legacy_path)
        for it in legacy_items:
            h = it.get("duplicate_hash")
            if h is None:
                h = compute_duplicate_hash(it.get("stem", ""), it.get("choices") or [])
            legacy_hashes.add(h)
        cross = [iid for iid, h in recomputed.items() if h in legacy_hashes]
        if cross:
            errors.append({"check": "dedupe", "code": "cross_series_duplicate",
                           "detail": f"{len(cross)} 题与存量 969 题重复", "items": cross[:20]})
        info["legacy_items_loaded"] = len(legacy_items)
        info["cross_series_duplicates"] = len(cross)
    else:
        info["legacy_items_loaded"] = 0
        info["cross_series_duplicates"] = None
        warnings.append({"check": "dedupe", "code": "legacy_missing",
                         "detail": f"存量题库 {legacy_path} 不存在，跨系列查重未执行 —— 不可用 duplicate_hash 之外的键替代"})

    # 批内近似重复（改词重复）
    stems = [(it.get("id", ""), it.get("stem", "")) for it in items]
    near = []
    for i in range(len(stems)):
        for j in range(i + 1, len(stems)):
            if approx_dupe(stems[i][1], stems[j][1]):
                near.append({"a": stems[i][0], "b": stems[j][0]})
    if near:
        warnings.append({"check": "dedupe", "code": "near_duplicate_suspect",
                         "count": len(near), "samples": near[:5],
                         "note": "启发式判定（词集包含度 ≥85%），必须人工看原文确认，勿直接采信"})
    info["near_duplicates"] = len(near)


def check_distribution(items, errors, warnings, review_queue, info):
    """[3] 领域分布：30 题应为 12 / 9 / 9"""
    counts = Counter(it.get("content_domain") for it in items)
    total = sum(v for k, v in counts.items() if k in CONTENT_DOMAINS)
    unknown = {k: v for k, v in counts.items() if k not in CONTENT_DOMAINS}

    info["domain_counts"] = dict(counts)
    info["domain_total"] = total

    if unknown:
        errors.append({"check": "distribution", "code": "unknown_domain_present",
                       "detail": unknown})

    if total != DOMAIN_TOTAL:
        warnings.append({"check": "distribution", "code": "unexpected_total",
                         "detail": f"有效题数 {total}，预期 {DOMAIN_TOTAL}。分布按实际总数复核"})

    for dom, want in CONTENT_DOMAINS.items():
        got = counts.get(dom, 0)
        if abs(got - want) > DOMAIN_TOLERANCE:
            errors.append({"check": "distribution", "code": "domain_off_target",
                           "detail": f"{dom}: {got} 题，预期 {want}（容差 ±{DOMAIN_TOLERANCE}）"})

    # 难度与认知层级分布（信息项，供人工判断）
    info["difficulty_counts"] = dict(Counter(it.get("difficulty") for it in items))
    info["source_basis_counts"] = dict(Counter(it.get("source_basis") for it in items))

    # 教学情境题占比：只做候选筛选，不算百分比、不判达标
    #
    # ⚠️ 实测（2026-09-03 自检）：该正则召回率低。自检夹具中题干含 "for elementary
    #    students at varied levels" 的题目 0 命中，因为规则只匹配 "a student" /
    #    "the teacher" / "grade N" 等特定短语，不匹配孤立的 "students"。
    #    用它算出的百分比既漏报又不可比 —— 拿它判定"是否达到官方 10–15%"是拿误报当结论。
    #    故此处只输出候选题供人工通读，不产出占比判定。
    scen = [it.get("id") for it in items if TEACHING_SCENARIO_PAT.search(str(it.get("stem", "")))]
    info["teaching_scenario_candidates"] = {
        "count": len(scen),
        "ids": scen,
        "official_target": "10–15%（ETS 官方口径）",
        "usage": "候选列表，非统计结果。正则召回率低（实测会漏掉题干中仅出现 'students' 的题），"
                 "不得据此计算占比或判定达标",
    }
    info["teaching_scenario_candidate_count"] = len(scen)

    # 教学情境题占比确认 —— 这是人工工作，脚本不做判断
    review_queue.append({
        "item": "(全批)",
        "reason": "教学情境题（Tasks of Teaching）占比需人工确认",
        "action": f"通读全部 {total} 题，人工判定哪些属于教学情境题，确认占比落在官方 10–15% 区间。"
                  f"正则给出 {len(scen)} 个候选（{scen[:6]}{'…' if len(scen) > 6 else ''}），"
                  f"但召回率低，仅作起点，不得当作结论",
    })


def check_answers(items, errors, warnings, review_queue, info):
    """[4] 答案交叉检查：自动可判部分 + 人工复核清单"""
    auto_flags = 0
    for it in items:
        tag = it.get("id")
        ch = it.get("choices") or []
        texts = [choice_text(c) for c in ch]
        ca = it.get("correct_answer")
        ca_list = ca if isinstance(ca, list) else ([ca] if ca is not None else [])
        stem = str(it.get("stem", ""))

        # 多选题：答案组合是高发错误区，全部进人工复核
        if it.get("question_type") == "multiple-select":
            review_queue.append({"item": tag,
                                 "reason": f"multiple-select，标注答案 {','.join(map(str, ca_list))}",
                                 "action": "人工独立重做：每一项都成立，且没有漏掉任何成立的选项"})
            auto_flags += 1

        # 绝对化表述常是干扰项而非答案（非必然，仅提示）
        absolute = [t for t in texts if re.match(r"^\s*(all|none|never|always|only)\b", t, re.I)]
        for a in ca_list:
            if a in absolute:
                review_queue.append({"item": tag, "reason": f"correct_answer 含绝对化表述 {a!r}（all/none/never/always/only）",
                                     "action": "人工确认是否唯一合理答案；绝对化选项通常是干扰项"})
                auto_flags += 1

        # all/none of the above 类选项存在时，需检查逻辑自洽
        if any(re.search(r"\b(all|none) of the above\b", t, re.I) for t in texts):
            review_queue.append({"item": tag, "reason": "含 all/none of the above 选项",
                                 "action": "人工确认其余选项确实全对/全错"})
            auto_flags += 1

        # 题干否定式（NOT / EXCEPT）—— 最易出现两个合理答案
        if re.search(r"\b(NOT|EXCEPT|LEAST|incorrect)\b", stem):
            review_queue.append({"item": tag, "reason": "否定式题干（NOT/EXCEPT/LEAST）",
                                 "action": "重点核验：是否存在第二个同样成立的选项"})
            auto_flags += 1

        # 选项长度异常：正确选项显著长于其他选项，往往是凑出来的（仅单选可判）
        if not isinstance(ca, list) and ca in texts:
            lens = [len(t) for t in texts]
            ci = texts.index(ca)
            others = [l for i, l in enumerate(lens) if i != ci]
            if others and lens[ci] > (sum(others) / len(others)) * 2:
                review_queue.append({"item": tag, "reason": "正确选项长度显著超过其他选项（>2 倍均值）",
                                     "action": "人工确认是否因长度泄露答案"})
                auto_flags += 1

        # 选项间语义高度重叠 —— 第二个合理答案的高发场景
        norms = [normalize(t) for t in texts]
        for i in range(len(norms)):
            for j in range(i + 1, len(norms)):
                if not norms[i] or not norms[j]:
                    continue
                wi, wj = set(norms[i].split()), set(norms[j].split())
                if wi and wj and len(wi & wj) / min(len(wi), len(wj)) >= 0.8:
                    review_queue.append({"item": tag, "reason": f"选项 {i+1} 与 {j+1} 表述高度重叠（≥80%）",
                                         "action": "人工确认二者是否有实质区别"})
                    auto_flags += 1

    info["answer_review_queue_size"] = len(review_queue)
    info["answer_auto_flags"] = auto_flags
    if not review_queue:
        warnings.append({"check": "answers", "code": "no_auto_flags",
                         "detail": "自动检查未发现可疑项。**这不等于交叉检查通过** —— "
                                   "判断是否存在第二个合理答案必须由人独立完成一遍，本脚本无法替代"})


def check_stem_completeness(items, errors, warnings, review_queue, info):
    """[5] 题干缺条件：外部图表引用 / numeric-entry 误用 / 指代缺失"""
    stimulus_ref = []
    dangling = []
    numeric_misuse = []

    for it in items:
        tag = it.get("id")
        stem = str(it.get("stem", ""))
        stim = it.get("stimulus")
        qt = it.get("question_type")

        if STIMULUS_REF_PAT.search(stem):
            stimulus_ref.append({"item": tag, "matched": STIMULUS_REF_PAT.search(stem).group(0)})
            # 有 stimulus 字段则可自洽；无则必为废题
            if not stim:
                errors.append({"item": tag, "check": "stem_completeness", "code": "missing_stimulus",
                               "detail": f"题干引用外部材料（{STIMULUS_REF_PAT.search(stem).group(0)}）"
                                         f"但 stimulus 字段为空 —— 用户看不到材料，废题"})
            else:
                review_queue.append({"item": tag, "reason": "题干引用外部材料，stimulus 字段已填",
                                     "action": "人工确认 stimulus 内容确实完整呈现了题干所需的材料"})

        if DANGLING_REF_PAT.search(stem) and not stim:
            dangling.append({"item": tag, "matched": DANGLING_REF_PAT.search(stem).group(0)})

        if qt in FORBIDDEN_QUESTION_TYPES:
            numeric_misuse.append({"item": tag, "question_type": qt})

    info["stimulus_reference_hits"] = len(stimulus_ref)
    info["dangling_reference_hits"] = len(dangling)
    info["numeric_entry_misuse"] = len(numeric_misuse)

    if dangling:
        warnings.append({"check": "stem_completeness", "code": "dangling_reference_suspect",
                         "count": len(dangling), "samples": dangling[:5],
                         "note": "启发式命中，需抽查原文（如 'a table's area' 指桌子面积而非表格，属误报）"})
    if numeric_misuse:
        errors.append({"check": "stem_completeness", "code": "question_type_violation",
                       "count": len(numeric_misuse),
                       "detail": "8006 官方全部为 selected-response，不得出现 numeric-entry 等题型"})


def check_content_redlines(items, errors, warnings, review_queue, info):
    """内容红线扫描：刻板印象 / 版权 / scaled score 承诺 / 冒充官方口径"""
    hits = {"bias": [], "copyright": [], "score_claim": [], "official_claim": []}
    for it in items:
        tag = it.get("id")
        blob = " ".join(str(it.get(k) or "") for k in ("stimulus", "stem", "explanation")) + " " + \
               " ".join(choice_text(c) for c in (it.get("choices") or []))
        de = it.get("distractor_explanations")
        if isinstance(de, dict):
            blob += " " + " ".join(str(v) for v in de.values())

        if BIAS_PAT.search(blob):
            hits["bias"].append(tag)
        if COPYRIGHT_PAT.search(blob):
            hits["copyright"].append(tag)
        if SCORE_CLAIM_PAT.search(blob):
            hits["score_claim"].append(tag)
        if OFFICIAL_CLAIM_PAT.search(blob):
            hits["official_claim"].append(tag)

    # 版权与 scaled score 是硬红线 —— 自动判错
    if hits["copyright"]:
        errors.append({"check": "redline", "code": "copyright_risk",
                       "items": hits["copyright"],
                       "detail": "可能引用真实出版物原文。8006 的 stimulus 一律须原创或改写"})
    if hits["score_claim"]:
        errors.append({"check": "redline", "code": "score_claim",
                       "items": hits["score_claim"],
                       "detail": "不得承诺或暗示 scaled score 换算 —— ETS 未公布 8006 换算表"})

    # 刻板印象与官方口径：必须人工看，不自动判退
    if hits["bias"]:
        review_queue.append({"item": ",".join(hits["bias"][:10]), "reason": "敏感表述启发式命中",
                             "action": "人工通读确认是否为刻板印象或价值判断（读障/宗教/族裔/性别/残障相关一律严查）"})
    if hits["official_claim"]:
        review_queue.append({"item": ",".join(hits["official_claim"][:10]), "reason": "出现 'ETS states/guidelines' 类表述",
                             "action": "人工确认确有官方依据；无依据一律改 source_basis = expert-judgment，"
                                       "涉及 IDA 标准与结构化识字（Orton-Gillingham）的表述须与 ETS 官方口径一致"})

    info["redline_hits"] = {k: len(v) for k, v in hits.items()}
    info["redline_bias_items"] = hits["bias"][:10]
    info["redline_official_claim_items"] = hits["official_claim"][:10]


# ---------------------------------------------------------------- 主流程

def main():
    ap = argparse.ArgumentParser(description="Praxis 8006 题目验收器（D5）")
    ap.add_argument("items", help="8006 题目文件（.jsonl 或 .json）")
    ap.add_argument("--legacy", default=DEFAULT_LEGACY, help="存量题库 jsonl，用于跨系列查重")
    ap.add_argument("--json-report", help="输出 JSON 报告路径")
    args = ap.parse_args()

    if not os.path.exists(args.items):
        print(f"[FATAL] 题目文件不存在：{args.items}", file=sys.stderr)
        print("  8006 题目由另一会话交付。文件未到 → 本脚本无输入，D5 无法验收。", file=sys.stderr)
        return 2

    try:
        items, bad_lines = load_items(args.items)
    except Exception as e:
        print(f"[FATAL] 解析失败：{e}", file=sys.stderr)
        return 2

    errors, warnings, review_queue, info = [], [], [], OrderedDict()
    info["source_file"] = os.path.abspath(args.items)
    info["item_count"] = len(items)
    info["schema_field_count"] = FIELD_COUNT
    info["schema_field_count_note"] = "D5 事项描述写 20 字段，schema v1 field_order 实际为 21。以 field_order 为准，出入待 T0 确认"

    if bad_lines:
        errors.append({"check": "parse", "code": "malformed_lines", "detail": bad_lines[:10]})

    if not items:
        print("[FATAL] 题目文件为空，无内容可验收。", file=sys.stderr)
        return 2

    check_schema(items, errors, warnings)
    check_duplicates(items, args.legacy, errors, warnings, info)
    check_distribution(items, errors, warnings, review_queue, info)
    check_answers(items, errors, warnings, review_queue, info)
    check_stem_completeness(items, errors, warnings, review_queue, info)
    check_content_redlines(items, errors, warnings, review_queue, info)

    ok = not errors
    report = {
        "verdict": "PASS" if ok else "FAIL",
        "source_file": info["source_file"],
        "item_count": info["item_count"],
        "errors": errors,
        "warnings": warnings,
        "human_review_queue": review_queue,
        "info": info,
    }

    # ---- 人读输出
    print("=" * 68)
    print("Praxis 8006 题目验收报告（D5）")
    print("=" * 68)
    print(f"输入文件 : {info['source_file']}")
    print(f"题目数量 : {info['item_count']}")
    print(f"存量比对 : {info.get('legacy_items_loaded', 0)} 题"
          f"{'（未执行：文件缺失）' if info.get('cross_series_duplicates') is None else ''}")
    print(f"结论     : {'✅ PASS（含 warning）' if ok else '❌ FAIL —— 存在阻断项'}")
    print()

    print("── [1] schema 校验 ──")
    se = [e for e in errors if e.get("check") == "schema"]
    print(f"  阻断项 {len(se)}｜完整性缺口 {len([w for w in warnings if w.get('check') == 'completeness'])}")

    print("── [2] 去重 ──")
    print(f"  批内精确重复 {info['intra_batch_duplicates']}｜跨系列重复 {info['cross_series_duplicates']}"
          f"｜近似重复嫌疑 {info['near_duplicates']}（待抽查）")
    print(f"  hash 独立复算不一致 {info['hash_mismatch_count']}（以复算值为准）")

    print("── [3] 领域分布 ──")
    for dom, want in CONTENT_DOMAINS.items():
        got = info["domain_counts"].get(dom, 0)
        flag = "  " if abs(got - want) <= DOMAIN_TOLERANCE else "←偏离"
        print(f"  {dom:<42} {got:>3} / {want:<3} {flag}")
    ts = info["teaching_scenario_candidates"]
    print(f"  教学情境题候选 {ts['count']} 题（人工队列已登记）｜官方口径 {ts['official_target']}")
    print(f"    ⚠ {ts['usage']}")

    print("── [4] 答案交叉检查 ──")
    print(f"  自动可疑标记 {info['answer_auto_flags']}｜人工必看队列 {info['answer_review_queue_size']} 条")
    print("  ⚠ 是否存在第二个合理答案**必须由人独立重做一遍**，脚本只缩小范围")

    print("── [5] 题干缺条件 ──")
    print(f"  外部材料引用 {info['stimulus_reference_hits']}｜指代缺失嫌疑 {info['dangling_reference_hits']}（待抽查）"
          f"｜题型违规 {info['numeric_entry_misuse']}")

    print("── 内容红线 ──")
    print(f"  版权风险 {info['redline_hits']['copyright']}（硬红线）｜scaled score 承诺 "
          f"{info['redline_hits']['score_claim']}（硬红线）")
    print(f"  敏感表述 {info['redline_hits']['bias']}（人工必看）｜官方口径表述 "
          f"{info['redline_hits']['official_claim']}（人工必看）")

    if errors:
        print()
        print("── 阻断项明细 ──")
        for e in errors[:30]:
            print(f"  ✗ [{e.get('code')}] {e.get('item', '-')} :: {str(e.get('detail'))[:110]}")

    if review_queue:
        print()
        print("── 人工复核队列（脚本无法替代，必须人做）──")
        for r in review_queue[:20]:
            print(f"  · {r['item']} — {r['reason']}")
            print(f"      → {r['action']}")

    print()
    print("=" * 68)
    print("提醒：本脚本只做机械可判部分。「零自动失败」不等于内容合格 ——")
    print("      D5 五项检查中的第 4 项（答案交叉检查）本质是人工工作。")
    print("=" * 68)

    if args.json_report:
        with open(args.json_report, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        print(f"\nJSON 报告已写入：{args.json_report}")

    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
