#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
validate-8003-items.py — Praxis 8003 题目验收器（D9）

用途：8003（Elementary Education Fundamentals: Mathematics）题目验收。
      本脚本负责验收，不生产题目。题目交付后直接跑，一次出结果。

用法：
    python content-infra/validate-8003-items.py                    # 默认读 site/questions-8003.js
    python content-infra/validate-8003-items.py <题目文件.json|.jsonl|.js> [--legacy <存量jsonl>] [--json-report out.json]

与 validate-8006-items.py（D5）的差异（8003 特有，全部为口径差异，非放松）：
    1. 题型：8003 官方为 selected-response + **numeric-entry**（ETS 官方考试页直证），
       故 numeric-entry 是**合法**题型；违禁题型改为 constructed-response / essay。
    2. multiple-select 体例：题干必须是 "Which TWO of the following…"（D5 反向要求
       "Select all that apply"，本脚本按 schema §8 判，且**不接受** "Select all that apply"）。
    3. distractor_explanations 对选择题是**阻断项**（恰好 3 条、键与干扰项逐字一致、
       60–200 字符、禁止 "This is incorrect because…" 类开头）；
       numeric-entry 无干扰项，schema 允许 null —— 该题型的**阻断项**改为 explanation 必须
       讲清计算过程（含等号或算式）与正确数值。
    4. numeric-entry 的 choices 为空数组、correct_answer 为纯数字串。schema v1 未规定
       numeric-entry 的 choices 形态，本脚本把「空数组」定为本站口径并在报告中标注，
       以便主会话统一裁决。
    5. 分数量表红线：8003 为 100–200；出现 100–300 / 合格分 240 一律阻断。
    6. 计算器口径红线：只允许 "on-screen scientific calculator provided" 及其同义表述；
       出现「自带计算器 / bring your own」类表述一律阻断。

设计原则（继承 D2/D5 教训）：
    · 独立复算，不信任输入。不采信题目文件自带的 duplicate_hash，按 schema §3 重算并逐条比对。
    · 启发式结果一律标记为「待抽查」，不直接写成结论。
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
ROOT_DIR = os.path.dirname(SCRIPT_DIR)
DEFAULT_LEGACY = os.path.join(SCRIPT_DIR, "items-5000-series.jsonl")
DEFAULT_ITEMS = os.path.join(ROOT_DIR, "site", "questions-8003.js")

TEST_CODE = 8003
SERIES = "8000"
SUBJECT = "Mathematics"

# 官方领域名与题量 —— 取自 content-infra/official-facts-8000-series.json（F1，含 ETS 官方出处）
# ⚠️ 官方写法逐字为：
#    "Numbers and Operations" / "Algebraic Thinking" / "Geometry, Measurement and Data"
#    第三项是 "Measurement and Data"（无 Statistics/Probability，也和 5003 的旧名不同）。
CONTENT_DOMAINS = {
    "Numbers and Operations": 12,
    "Algebraic Thinking": 9,
    "Geometry, Measurement and Data": 9,
}
DOMAIN_TOTAL = 30
# 官方题量比例 28 / 20 / 20（合计 68）。30 题样本下 ±2 已是 6.7% 偏移，超出即退回。
DOMAIN_TOLERANCE = 2
OFFICIAL_WEIGHTS = {"Numbers and Operations": 28, "Algebraic Thinking": 20, "Geometry, Measurement and Data": 20}
OFFICIAL_QUESTION_COUNT = 68

# 8003 官方题型：selected-response（single/multiple）+ numeric-entry（ETS 官方页直证）
ALLOWED_QUESTION_TYPES = {"single-select", "multiple-select", "numeric-entry"}
FORBIDDEN_QUESTION_TYPES = {"constructed-response", "essay"}
NUMERIC_TYPES = {"numeric-entry"}

FIELD_ORDER = [
    "id", "series", "test_code", "subject", "content_domain", "skill",
    "difficulty", "question_type", "stimulus", "stem", "choices",
    "correct_answer", "explanation", "distractor_explanations",
    "source_basis", "review_status", "reviewer", "version",
    "duplicate_hash", "created_at", "updated_at",
]
FIELD_COUNT = len(FIELD_ORDER)  # 21

ENUMS = {
    "series": {"8000"},
    "difficulty": {"easy", "medium", "hard"},
    "question_type": ALLOWED_QUESTION_TYPES,
    "source_basis": {"legacy-unknown", "expert-judgment", "official-source"},
    "review_status": {"draft", "human-reviewed", "rejected"},
}

ISO8601_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$")
HASH_RE = re.compile(r"^[0-9a-f]{64}$")
NUMERIC_ANSWER_RE = re.compile(r"^[+-]?(\d+(\.\d*)?|\.\d+)$")

# distractor_explanations 写法规范（schema §6）
DE_MIN_LEN, DE_MAX_LEN = 60, 200
DE_BANNED_OPEN = re.compile(r"^\s*(This is incorrect|This option|This answer|The correct answer|It is incorrect)", re.I)

# ---------------------------------------------------------------- 启发式规则
# 全部标注为「待抽查」：命中不等于有问题，仅提示人工看原文。

# 外部图表引用：题干要求看图但站点无图 → 废题
STIMULUS_REF_PAT = re.compile(
    r"\b(shown below|the following (table|graph|chart|diagram|figure|passage|excerpt)|"
    r"according to the (table|graph|chart|diagram|figure)|the (table|graph|chart|diagram|figure) above|"
    r"in the passage above|the excerpt above|refer to the (table|figure|diagram))\b",
    re.I,
)
# 指代缺失：题干出现代词但无 stimulus 支撑（"the table's area" 属误报，需抽查）
DANGLING_REF_PAT = re.compile(r"\b(this (passage|excerpt|text)|the passage|the excerpt)\b", re.I)

BIAS_PAT = re.compile(
    r"\b(boys are (better|worse)|girls are (better|worse)|"
    r"(black|white|asian|hispanic|latino) students (typically|usually|naturally)|"
    r"students with disabilities (cannot|can't|are unable)|"
    r"(inner[- ]city|urban) students (typically|usually|tend to))\b",
    re.I,
)
COPYRIGHT_PAT = re.compile(
    r"\b(excerpt (from|copyright)|©|\ball rights reserved\b|reprinted (from|with permission))\b",
    re.I,
)
# scaled score 承诺：8000 系列无官方换算表，任何换算承诺都是编的
SCORE_CLAIM_PAT = re.compile(
    r"\b(scaled score of|your scaled score|converts to a score|"
    r"this (corresponds to|equals) a (scaled )?score|you would (score|earn) (a|approximately))\b",
    re.I,
)
# 错误分数量表（官方为 100–200；第三方宣称的 100–300 / 240 分属 discredited_claims）
BAD_SCALE_PAT = re.compile(r"\b(100\s*[-–—]\s*300|240\b\s*(?:passing|as a passing|to pass)?)", re.I)
BAD_SCALE_STRICT_PAT = re.compile(r"\b100\s*[-–—]\s*300\b|\bpassing score of 240\b", re.I)
# 计算器口径：官方只确认「提供屏幕科学计算器」，不得加码
BAD_CALC_PAT = re.compile(
    r"(bring your own calculator|bring their own calculator|you may bring a calculator|"
    r"your own calculator is permitted|request.{0,20}calculator.{0,20}(approval|accommodation)|"
    r"no calculator is (permitted|allowed))",
    re.I,
)
# 冒充官方口径
OFFICIAL_CLAIM_PAT = re.compile(
    r"\b(ETS (states|requires|confirms|specifies)|according to ETS|"
    r"the official (ETS )?(blueprint|specification)|ETS guidelines)\b",
    re.I,
)
# 教学情境题启发式（用于筛候选，不作占比结论）
TEACHING_SCENARIO_PAT = re.compile(
    r"\b(a student|the student|the teacher|Ms\.|Mr\.|Mrs\.|the class|your students|small group)\b",
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
    if isinstance(c, dict):
        return c.get("key")
    return None


def answer_pool(it):
    ch = it.get("choices") or []
    if ch and all(isinstance(c, dict) for c in ch):
        return {choice_key(c) for c in ch}
    return {choice_text(c) for c in ch}


def compute_duplicate_hash(stem, choices):
    """
    schema §3：parts = [normalize(stem)] + sorted(normalize(choices))
              payload = "|".join(parts); hash = sha256(payload).hexdigest()
    与 D2 的 Node 实现、D5 的 Python 实现逐字一致。
    """
    parts = [normalize(stem)] + sorted(normalize(choice_text(c)) for c in choices)
    return hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()


def extract_js_items(path):
    """从 site/questions-8003.js 里抠出题库数组（window.DM_BANK_8003 = [ … ];）。"""
    with open(path, "r", encoding="utf-8") as f:
        raw = f.read()
    m = re.search(r"window\.\s*DM_BANK_8003\s*=\s*(\[[\s\S]*?\])\s*;", raw)
    if not m:
        raise ValueError("未能在 %s 中定位 window.DM_BANK_8003 = [ ... ];" % path)
    return json.loads(m.group(1)), []


def load_items(path):
    """支持 .js（本站题库）、.jsonl（每行一题）、.json（数组或 {items:[…]}）"""
    if not os.path.exists(path):
        raise FileNotFoundError(path)
    if path.lower().endswith(".js"):
        try:
            return extract_js_items(path)
        except Exception as e:
            raise ValueError("解析题库 JS 失败：%s" % e)
    with open(path, "r", encoding="utf-8") as f:
        raw = f.read().strip()
    if not raw:
        return [], []
    if path.lower().endswith(".jsonl"):
        items, bad_lines = [], []
        for i, line in enumerate(raw.splitlines(), 1):
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


def approx_dupe(a, b):
    """近似查重：题干词集包含度 ≥85%（D5 同款思路，仅作待抽查提示）。"""
    wa = set(normalize(a).split())
    wb = set(normalize(b).split())
    if not wa or not wb:
        return False
    inter = len(wa & wb)
    return (inter / len(wa) >= 0.85) or (inter / len(wb) >= 0.85)


# ---------------------------------------------------------------- 检查一：schema

def check_schema(items, errors, warnings, info):
    """[1] schema 校验：21 字段齐全、类型正确、枚举合法、题型体例正确"""
    seen_ids = {}
    type_counts = Counter()
    stimulus_null = []
    for idx, it in enumerate(items):
        tag = it.get("id", "#<%d>" % idx)
        qt = it.get("question_type")
        type_counts[qt] += 1

        missing = [f for f in FIELD_ORDER if f not in it]
        if missing:
            errors.append({"item": tag, "check": "schema", "code": "missing_fields", "detail": missing})
        extra = [k for k in it if k not in FIELD_ORDER]
        if extra:
            warnings.append({"item": tag, "check": "schema", "code": "extra_fields", "detail": extra})

        if it.get("test_code") != TEST_CODE:
            errors.append({"item": tag, "check": "schema", "code": "wrong_test_code",
                           "detail": "expected %r, got %r" % (TEST_CODE, it.get("test_code"))})
        if it.get("series") != SERIES:
            errors.append({"item": tag, "check": "schema", "code": "wrong_series",
                           "detail": "expected %r, got %r" % (SERIES, it.get("series"))})
        if it.get("subject") != SUBJECT:
            errors.append({"item": tag, "check": "schema", "code": "wrong_subject",
                           "detail": "expected %r, got %r" % (SUBJECT, it.get("subject"))})

        if tag in seen_ids:
            errors.append({"item": tag, "check": "schema", "code": "duplicate_id",
                           "detail": "first seen at index %d" % seen_ids[tag]})
        else:
            seen_ids[tag] = idx

        for f in ("difficulty", "question_type", "source_basis", "review_status"):
            v = it.get(f)
            if v is not None and v not in ENUMS[f]:
                errors.append({"item": tag, "check": "schema", "code": "bad_enum",
                               "detail": "%s=%r, allowed=%s" % (f, v, sorted(ENUMS[f]))})

        if qt in FORBIDDEN_QUESTION_TYPES:
            errors.append({"item": tag, "check": "schema", "code": "forbidden_question_type",
                           "detail": "%r — 8003 官方题型为 selected-response + numeric-entry，无此类" % (qt,)})

        cd = it.get("content_domain")
        if cd not in CONTENT_DOMAINS:
            err = {"item": tag, "check": "schema", "code": "bad_content_domain",
                   "detail": "%r not an official 8003 domain" % (cd,)}
            if cd and "&" in str(cd):
                err["detail"] += "（官方写法用 and，不用 &）"
            if cd and "Statistics" in str(cd):
                err["detail"] += "（那是 5003 的旧名；8003 已改名为 Geometry, Measurement and Data）"
            errors.append(err)

        # stem / explanation 非空
        for f in ("stem", "explanation"):
            v = it.get(f)
            if not isinstance(v, str) or not v.strip():
                errors.append({"item": tag, "check": "schema", "code": "empty_field", "detail": f})

        for f in ("created_at", "updated_at"):
            v = it.get(f)
            if v is not None and not ISO8601_RE.match(str(v)):
                errors.append({"item": tag, "check": "schema", "code": "bad_timestamp",
                               "detail": "%s=%r, expected ISO-8601 UTC (…Z)" % (f, v)})

        v = it.get("version")
        if not isinstance(v, int) or v < 1:
            errors.append({"item": tag, "check": "schema", "code": "bad_version", "detail": repr(v)})

        dh = it.get("duplicate_hash")
        if not isinstance(dh, str) or not HASH_RE.match(dh):
            errors.append({"item": tag, "check": "schema", "code": "bad_duplicate_hash_format",
                           "detail": repr(dh)})

        if it.get("skill") is None:
            warnings.append({"item": tag, "check": "completeness", "code": "skill_null",
                             "detail": "skill 为 null —— 8003 新题应给出考查技能标签"})
        if it.get("stimulus") is None:
            stimulus_null.append(tag)

        # ---- 题型分流
        ch = it.get("choices")
        ca = it.get("correct_answer")

        if qt in NUMERIC_TYPES:
            # numeric-entry：无选项，答案为纯数字串，解释必须讲清计算过程
            if not isinstance(ch, list) or len(ch) != 0:
                errors.append({"item": tag, "check": "schema", "code": "numeric_entry_has_choices",
                               "detail": "numeric-entry 的 choices 应为空数组（本站口径），实际 %r" % (ch,)})
            if not isinstance(ca, str) or not NUMERIC_ANSWER_RE.match(ca):
                errors.append({"item": tag, "check": "schema", "code": "numeric_entry_bad_answer",
                               "detail": "correct_answer 应为纯数字串，实际 %r" % (ca,)})
            if it.get("distractor_explanations") is not None:
                errors.append({"item": tag, "check": "schema", "code": "numeric_entry_has_distractors",
                               "detail": "numeric-entry 无干扰项，distractor_explanations 必须为 null"})
            expl = str(it.get("explanation") or "")
            if not re.search(r"[=×÷/+\-]", expl):
                errors.append({"item": tag, "check": "schema", "code": "numeric_entry_no_work",
                               "detail": "explanation 未见算式 —— numeric-entry 解析必须讲清计算过程"})
            elif ca and str(ca) not in expl:
                errors.append({"item": tag, "check": "schema", "code": "numeric_entry_answer_not_in_explanation",
                               "detail": "explanation 未出现答案 %r，考生无法核对" % (ca,)})
        else:
            if not isinstance(ch, list) or len(ch) < 2:
                errors.append({"item": tag, "check": "schema", "code": "bad_choices",
                               "detail": "choices must be a list of >=2, got %r" % (type(ch).__name__,)})
                continue
            texts = [choice_text(c) for c in ch]
            if len(set(texts)) != len(texts):
                errors.append({"item": tag, "check": "schema", "code": "duplicate_choices",
                               "detail": "choices 中存在完全相同的选项"})
            # 归一化碰撞：normalize() 吃掉运算符与空白，纯符号选项会撞成同一个串。
            # 例如 'n - 5' 与 'n + 5' 都归一化为 'n5' —— 选项文本必须含词。
            nz = [normalize(t) for t in texts]
            if len(set(nz)) != len(nz):
                collide = sorted({x for x in nz if nz.count(x) > 1})
                errors.append({"item": tag, "check": "schema", "code": "choice_normalize_collision",
                               "detail": "选项归一化后相同（需含文字，否则 duplicate_hash 失去区分力）：%r" % (collide,)})
            ans_list = ca if isinstance(ca, list) else [ca]
            ans_norm = {normalize(a) for a in ans_list}
            for t in texts:
                if t not in ans_list and normalize(t) in ans_norm:
                    errors.append({"item": tag, "check": "schema", "code": "distractor_normalize_collision",
                                   "detail": "干扰项与正确答案归一化后相同：%s" % t[:60]})
            pool = answer_pool(it)
            bad = [a for a in ans_list if a not in pool]
            if bad:
                errors.append({"item": tag, "check": "schema", "code": "correct_answer_not_in_choices",
                               "detail": "correct_answer=%r 不在 choices 池中" % (bad,)})

            if qt == "multiple-select":
                if not isinstance(ca, list):
                    errors.append({"item": tag, "check": "schema", "code": "multiselect_answer_not_list",
                                   "detail": "question_type=multiple-select 但 correct_answer=%r 不是列表" % (ca,)})
                elif len(ca) != 2:
                    errors.append({"item": tag, "check": "schema", "code": "multiselect_not_two_answers",
                                   "detail": "multiple-select 应恰好 2 个正确答案，实际 %d 个" % len(ca)})
                if len(ch) != 5:
                    errors.append({"item": tag, "check": "schema", "code": "multiselect_choice_count",
                                   "detail": "multiple-select 体例为 A–E 共 5 项，实际 %d 项" % len(ch)})
                stem = str(it.get("stem") or "")
                if not re.search(r"Which\s+(TWO|two)\s+of\s+the\s+following", stem):
                    errors.append({"item": tag, "check": "schema", "code": "multiselect_instruction",
                                   "detail": '题干必须用 "Which TWO of the following…" 明示数量（schema §8）'})
                if re.search(r"select all that apply", stem, re.I):
                    errors.append({"item": tag, "check": "schema", "code": "multiselect_banned_phrasing",
                                   "detail": '"Select all that apply" 是明令禁止的写法（schema §8）'})
            elif qt == "single-select":
                if isinstance(ca, list):
                    errors.append({"item": tag, "check": "schema", "code": "singleselect_answer_is_list",
                                   "detail": "question_type=single-select 但 correct_answer=%r 是列表" % (ca,)})

            # ---- distractor_explanations：选择题硬约束
            distractors = [t for t in texts if t not in ans_list]
            de = it.get("distractor_explanations")
            if de is None:
                errors.append({"item": tag, "check": "schema", "code": "missing_distractor_explanations",
                               "detail": "选择题必须逐干扰项写解析（schema §1 硬约束），当前为 null"})
            elif not isinstance(de, dict):
                errors.append({"item": tag, "check": "schema", "code": "bad_distractor_explanations_type",
                               "detail": "应为 object，实际 %r" % (type(de).__name__,)})
            else:
                if len(de) != 3:
                    errors.append({"item": tag, "check": "schema", "code": "distractor_count",
                                   "detail": "应恰好 3 条干扰项解析，实际 %d 条" % len(de)})
                for d in distractors:
                    if d not in de:
                        errors.append({"item": tag, "check": "schema", "code": "missing_distractor_key",
                                       "detail": "干扰项缺解析（键须与选项逐字一致）：%s" % d[:60]})
                for k, v in de.items():
                    if k in ans_list:
                        errors.append({"item": tag, "check": "schema", "code": "distractor_key_is_answer",
                                       "detail": "干扰项解析的键命中了正确答案：%s" % k[:60]})
                    if k not in texts:
                        errors.append({"item": tag, "check": "schema", "code": "distractor_key_mismatch",
                                       "detail": "键与任何选项都不逐字一致：%s" % k[:60]})
                    if not isinstance(v, str) or not v.strip():
                        errors.append({"item": tag, "check": "schema", "code": "empty_distractor_explanation",
                                       "detail": k[:60]})
                        continue
                    n = len(v)
                    if n < DE_MIN_LEN or n > DE_MAX_LEN:
                        errors.append({"item": tag, "check": "schema", "code": "distractor_length",
                                       "detail": "%d 字符（要求 %d–%d）：%s" % (n, DE_MIN_LEN, DE_MAX_LEN, k[:40])})
                    if DE_BANNED_OPEN.match(v):
                        errors.append({"item": tag, "check": "schema", "code": "distractor_banned_opening",
                                       "detail": "用了禁止的开头：%s" % v[:40]})

    info["question_type_counts"] = dict(type_counts)
    info["declared_type_counts"] = dict(type_counts)
    info["stimulus_null_count"] = len(stimulus_null)
    if stimulus_null:
        # 合并为一条：8003 的题干一律自含（没有共享阅读材料），逐条刷屏没有信息量
        warnings.append({"check": "completeness", "code": "stimulus_null",
                         "count": len(stimulus_null),
                         "detail": "%d/%d 题 stimulus 为 null（8003 题干自含，属预期；若有共享材料必须回填）"
                                   % (len(stimulus_null), len(items))})


# ---------------------------------------------------------------- 检查二：去重

def check_duplicates(items, legacy_path, errors, warnings, info):
    """[2] 去重：独立复算 hash、批内去重、与 5000 存量跨系列比对"""
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
        errors.append({"check": "dedupe", "code": "hash_mismatch", "count": len(hash_mismatch),
                       "detail": "duplicate_hash 与独立复算不一致（不自报即算过）",
                       "samples": hash_mismatch[:5]})
    info["hash_mismatch_count"] = len(hash_mismatch)

    by_hash = {}
    for iid, h in recomputed.items():
        by_hash.setdefault(h, []).append(iid)
    intra = {h: ids for h, ids in by_hash.items() if len(ids) > 1}
    if intra:
        for h, ids in intra.items():
            errors.append({"check": "dedupe", "code": "intra_batch_duplicate",
                           "detail": "%d 题共享 duplicate_hash %s…" % (len(ids), h[:12]), "items": ids})
    info["intra_batch_duplicates"] = len(intra)

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
                           "detail": "%d 题与 5000 存量重复" % len(cross), "items": cross[:20]})
        info["legacy_items_loaded"] = len(legacy_items)
        info["cross_series_duplicates"] = len(cross)
    else:
        info["legacy_items_loaded"] = 0
        info["cross_series_duplicates"] = None
        warnings.append({"check": "dedupe", "code": "legacy_missing",
                         "detail": "存量题库 %s 不存在，跨系列查重未执行" % legacy_path})

    stems = [(it.get("id", ""), it.get("stem", "")) for it in items]
    near = []
    for i in range(len(stems)):
        for j in range(i + 1, len(stems)):
            if approx_dupe(stems[i][1], stems[j][1]):
                near.append({"a": stems[i][0], "b": stems[j][0]})
    if near:
        warnings.append({"check": "dedupe", "code": "near_duplicate_suspect", "count": len(near),
                         "samples": near[:5],
                         "note": "启发式判定，必须人工看原文确认，勿直接采信"})
    info["near_duplicates"] = len(near)


# ---------------------------------------------------------------- 检查三：领域分布

def check_distribution(items, errors, warnings, review_queue, info):
    """[3] 领域分布：30 题应为 12 / 9 / 9（对应官方 28/20/20）"""
    counts = Counter(it.get("content_domain") for it in items)
    total = sum(v for k, v in counts.items() if k in CONTENT_DOMAINS)
    unknown = {k: v for k, v in counts.items() if k not in CONTENT_DOMAINS}

    info["domain_counts"] = dict(counts)
    info["domain_total"] = total
    if unknown:
        errors.append({"check": "distribution", "code": "unknown_domain_present", "detail": unknown})
    if total != DOMAIN_TOTAL:
        warnings.append({"check": "distribution", "code": "unexpected_total",
                         "detail": "有效题数 %d，预期 %d" % (total, DOMAIN_TOTAL)})

    for dom, want in CONTENT_DOMAINS.items():
        got = counts.get(dom, 0)
        if abs(got - want) > DOMAIN_TOLERANCE:
            errors.append({"check": "distribution", "code": "domain_off_target",
                           "detail": "%s: %d 题，预期 %d（容差 ±%d）" % (dom, got, want, DOMAIN_TOLERANCE)})

    # 与官方题量比例的偏差（信息项，供人工判断）
    ratio_report = []
    for dom, official_n in OFFICIAL_WEIGHTS.items():
        share_official = official_n / float(OFFICIAL_QUESTION_COUNT)
        share_batch = counts.get(dom, 0) / float(DOMAIN_TOTAL)
        ratio_report.append({
            "domain": dom, "official_items": official_n,
            "official_share": round(share_official, 4),
            "batch_items": counts.get(dom, 0), "batch_share": round(share_batch, 4),
            "delta": round(share_batch - share_official, 4),
        })
    info["weight_alignment"] = ratio_report

    info["difficulty_counts"] = dict(Counter(it.get("difficulty") for it in items))
    info["source_basis_counts"] = dict(Counter(it.get("source_basis") for it in items))
    info["review_status_counts"] = dict(Counter(it.get("review_status") for it in items))

    scen = [it.get("id") for it in items if TEACHING_SCENARIO_PAT.search(str(it.get("stem", "")))]
    info["teaching_scenario_candidates"] = {
        "count": len(scen), "ids": scen,
        "official_target": "10–15%（ETS 官方口径）",
        "usage": "候选列表，非统计结果；正则召回率有限，不得据此计算占比或判定达标",
    }

    # 非选择题型占比（8003 的真实差异点，需人工确认体例）
    numeric = [it.get("id") for it in items if it.get("question_type") == "numeric-entry"]
    multi = [it.get("id") for it in items if it.get("question_type") == "multiple-select"]
    info["numeric_entry_items"] = {"count": len(numeric), "ids": numeric}
    info["multiple_select_items"] = {"count": len(multi), "ids": multi}
    if not numeric:
        errors.append({"check": "distribution", "code": "no_numeric_entry",
                       "detail": "8003 官方含 numeric-entry，题库必须含该题型（差异化要点）"})
    if multi and not (2 <= len(multi) <= 5):
        warnings.append({"check": "distribution", "code": "multiselect_share",
                         "detail": "multiple-select %d 题（约 10%% 建议 3 题）" % len(multi)})

    review_queue.append({
        "item": "(全批)",
        "reason": "教学情境题（Tasks of Teaching）占比需人工确认",
        "action": "通读全部 %d 题，人工判定哪些属于教学情境题，确认占比落在官方 10–15%% 区间。"
                  "正则给出 %d 个候选，召回率有限，仅作起点" % (total, len(scen)),
    })


# ---------------------------------------------------------------- 检查四：答案交叉检查

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
        qt = it.get("question_type")

        if qt == "numeric-entry":
            # 数值题的答案可自动复算（人工仍需确认题目本身无第二个合理解）
            review_queue.append({"item": tag,
                                 "reason": "numeric-entry，标注答案 %r" % (ca,),
                                 "action": "人工独立重做：确认答案唯一、且题干写明了需要什么格式（小数/整数/单位）"})
            auto_flags += 1
            continue

        if qt == "multiple-select":
            review_queue.append({"item": tag,
                                 "reason": "multiple-select，标注答案 %s" % ",".join(map(str, ca_list)),
                                 "action": "人工独立重做：每一项的成立与否都要判一遍，且没有漏掉任何成立的选项"})
            auto_flags += 1

        absolute = [t for t in texts if re.match(r"^\s*(all|none|never|always|only)\b", t, re.I)]
        for a in ca_list:
            if a in absolute:
                review_queue.append({"item": tag,
                                     "reason": "correct_answer 含绝对化表述 %r" % (a,),
                                     "action": "人工确认是否唯一合理答案"})
                auto_flags += 1

        if any(re.search(r"\b(all|none) of the above\b", t, re.I) for t in texts):
            review_queue.append({"item": tag, "reason": "含 all/none of the above 选项",
                                 "action": "人工确认其余选项确实全对/全错"})
            auto_flags += 1

        if re.search(r"\b(NOT|EXCEPT|LEAST|incorrect)\b", stem):
            review_queue.append({"item": tag, "reason": "否定式题干（NOT/EXCEPT/LEAST）",
                                 "action": "重点核验：是否存在第二个同样成立的选项"})
            auto_flags += 1

        if not isinstance(ca, list) and ca in texts:
            lens = [len(t) for t in texts]
            ci = texts.index(ca)
            others = [l for i, l in enumerate(lens) if i != ci]
            if others and lens[ci] > (sum(others) / len(others)) * 2:
                review_queue.append({"item": tag, "reason": "正确选项长度显著超过其他选项（>2 倍均值）",
                                     "action": "人工确认是否因长度泄露答案"})
                auto_flags += 1

        norms = [normalize(t) for t in texts]
        for i in range(len(norms)):
            for j in range(i + 1, len(norms)):
                if not norms[i] or not norms[j]:
                    continue
                wi, wj = set(norms[i].split()), set(norms[j].split())
                if wi and wj and len(wi & wj) / min(len(wi), len(wj)) >= 0.8:
                    review_queue.append({"item": tag,
                                         "reason": "选项 %d 与 %d 表述高度重叠（≥80%%）" % (i + 1, j + 1),
                                         "action": "人工确认二者是否有实质区别"})
                    auto_flags += 1

    info["answer_review_queue_size"] = len(review_queue)
    info["answer_auto_flags"] = auto_flags


# ---------------------------------------------------------------- 检查五：题干缺条件

def check_stem_completeness(items, errors, warnings, review_queue, info):
    """[5] 题干缺条件：外部图表引用 / 指代缺失 / 题型违禁"""
    stimulus_ref, dangling, misuse = [], [], []
    for it in items:
        tag = it.get("id")
        stem = str(it.get("stem", ""))
        stim = it.get("stimulus")
        qt = it.get("question_type")

        m = STIMULUS_REF_PAT.search(stem)
        if m:
            stimulus_ref.append({"item": tag, "matched": m.group(0)})
            if not stim:
                errors.append({"item": tag, "check": "stem_completeness", "code": "missing_stimulus",
                               "detail": "题干引用外部材料（%s）但 stimulus 为空 —— 用户看不到材料，废题" % m.group(0)})
            else:
                review_queue.append({"item": tag, "reason": "题干引用外部材料，stimulus 已填",
                                     "action": "人工确认 stimulus 内容确实完整呈现了题干所需材料"})

        if DANGLING_REF_PAT.search(stem) and not stim:
            dangling.append({"item": tag, "matched": DANGLING_REF_PAT.search(stem).group(0)})

        if qt in FORBIDDEN_QUESTION_TYPES:
            misuse.append({"item": tag, "question_type": qt})

        # numeric-entry 的输入格式必须写清（否则考生不知道该填小数还是分数）
        if qt == "numeric-entry":
            if not re.search(r"(Enter|enter)[^.]{0,80}", stem):
                warnings.append({"item": tag, "check": "stem_completeness", "code": "numeric_entry_no_format_hint",
                                 "detail": "numeric-entry 题干未见 Enter 类格式提示 —— 考生无法确定输入形式"})

    info["stimulus_reference_hits"] = len(stimulus_ref)
    info["dangling_reference_hits"] = len(dangling)
    info["forbidden_question_type_hits"] = len(misuse)
    if dangling:
        warnings.append({"check": "stem_completeness", "code": "dangling_reference_suspect",
                         "count": len(dangling), "samples": dangling[:5],
                         "note": "启发式命中，需抽查原文（'a table's area' 属误报）"})
    if misuse:
        errors.append({"check": "stem_completeness", "code": "question_type_violation",
                       "count": len(misuse), "detail": misuse})


# ---------------------------------------------------------------- 内容红线

def check_content_redlines(items, errors, warnings, review_queue, info):
    """内容红线：分数量表 / 计算器加码 / scaled score 承诺 / 版权 / 敏感表述 / 冒充官方口径"""
    hits = {"bad_scale": [], "bad_calculator": [], "score_claim": [], "copyright": [], "bias": [], "official_claim": []}
    for it in items:
        tag = it.get("id")
        blob = " ".join(str(it.get(k) or "") for k in ("stimulus", "stem", "explanation")) + " " + \
               " ".join(choice_text(c) for c in (it.get("choices") or []))
        de = it.get("distractor_explanations")
        if isinstance(de, dict):
            blob += " " + " ".join(str(v) for v in de.values())

        if BAD_SCALE_STRICT_PAT.search(blob):
            hits["bad_scale"].append(tag)
        if BAD_CALC_PAT.search(blob):
            hits["bad_calculator"].append(tag)
        if SCORE_CLAIM_PAT.search(blob):
            hits["score_claim"].append(tag)
        if COPYRIGHT_PAT.search(blob):
            hits["copyright"].append(tag)
        if BIAS_PAT.search(blob):
            hits["bias"].append(tag)
        if OFFICIAL_CLAIM_PAT.search(blob):
            hits["official_claim"].append(tag)

    if hits["bad_scale"]:
        errors.append({"check": "redline", "code": "wrong_score_scale", "items": hits["bad_scale"],
                       "detail": "出现 100–300 尺度或 240 合格分 —— 官方为 100–200，属 discredited claim"})
    if hits["bad_calculator"]:
        errors.append({"check": "redline", "code": "calculator_policy_overreach", "items": hits["bad_calculator"],
                       "detail": "计算器口径加码 —— 官方只确认「提供屏幕科学计算器」，不得写自带或另行申请"})
    if hits["score_claim"]:
        errors.append({"check": "redline", "code": "score_claim", "items": hits["score_claim"],
                       "detail": "不得承诺或暗示 scaled score 换算 —— 8000 系列未公布换算表"})
    if hits["copyright"]:
        errors.append({"check": "redline", "code": "copyright_risk", "items": hits["copyright"],
                       "detail": "可能引用真实出版物原文"})
    if hits["bias"]:
        review_queue.append({"item": ",".join(hits["bias"][:10]), "reason": "敏感表述启发式命中",
                             "action": "人工通读确认是否为刻板印象或价值判断"})
    if hits["official_claim"]:
        review_queue.append({"item": ",".join(hits["official_claim"][:10]), "reason": "出现 'ETS states/guidelines' 类表述",
                             "action": "人工确认确有官方依据；无依据一律改 source_basis = expert-judgment"})

    info["redline_hits"] = {k: len(v) for k, v in hits.items()}


# ---------------------------------------------------------------- 主流程

def main():
    ap = argparse.ArgumentParser(description="Praxis 8003 题目验收器（D9）")
    ap.add_argument("items", nargs="?", default=DEFAULT_ITEMS,
                    help="8003 题目文件（.js / .jsonl / .json），默认 %s" % DEFAULT_ITEMS)
    ap.add_argument("--legacy", default=DEFAULT_LEGACY, help="存量题库 jsonl，用于跨系列查重")
    ap.add_argument("--json-report", help="输出 JSON 报告路径")
    args = ap.parse_args()

    if not os.path.exists(args.items):
        print("[FATAL] 题目文件不存在：%s" % args.items, file=sys.stderr)
        return 2

    try:
        items, bad_lines = load_items(args.items)
    except Exception as e:
        print("[FATAL] 解析失败：%s" % e, file=sys.stderr)
        return 2

    errors, warnings, review_queue, info = [], [], [], OrderedDict()
    info["source_file"] = os.path.abspath(args.items)
    info["item_count"] = len(items)
    info["schema_field_count"] = FIELD_COUNT
    info["subject"] = SUBJECT
    info["test_code"] = TEST_CODE
    info["numeric_entry_choices_convention"] = (
        "schema v1 未规定 numeric-entry 的 choices 形态；本站口径为 choices = []（无选项）、"
        "correct_answer = 纯数字串、distractor_explanations = null。待主会话统一裁决。"
    )

    if bad_lines:
        errors.append({"check": "parse", "code": "malformed_lines", "detail": bad_lines[:10]})
    if not items:
        print("[FATAL] 题目文件为空，无内容可验收。", file=sys.stderr)
        return 2

    check_schema(items, errors, warnings, info)
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

    print("=" * 68)
    print("Praxis 8003 题目验收报告（D9）")
    print("=" * 68)
    print("输入文件 : %s" % info["source_file"])
    print("题目数量 : %d" % info["item_count"])
    print("存量比对 : %d 题%s" % (
        info.get("legacy_items_loaded", 0),
        "（未执行：文件缺失）" if info.get("cross_series_duplicates") is None else ""))
    print("结论     : %s" % ("✅ PASS（含 warning）" if ok else "❌ FAIL —— 存在阻断项"))
    print()

    print("── [1] schema 校验 ──")
    se = [e for e in errors if e.get("check") == "schema"]
    print("  阻断项 %d｜完整性缺口 %d" % (
        len(se), len([w for w in warnings if w.get("check") == "completeness"])))
    print("  字段数 %d（schema v1）/ 题型分布 %s" % (
        FIELD_COUNT, json.dumps(info["question_type_counts"], ensure_ascii=False)))

    print("── [2] 去重 ──")
    print("  批内精确重复 %s｜跨系列重复 %s｜近似重复嫌疑 %d（待抽查）" % (
        info["intra_batch_duplicates"], info["cross_series_duplicates"], info["near_duplicates"]))
    print("  hash 独立复算不一致 %d（以复算值为准）" % info["hash_mismatch_count"])

    print("── [3] 领域分布 ──")
    for dom, want in CONTENT_DOMAINS.items():
        got = info["domain_counts"].get(dom, 0)
        flag = "  " if abs(got - want) <= DOMAIN_TOLERANCE else "←偏离"
        print("  %-40s %3d / %-3d %s" % (dom, got, want, flag))
    for r in info["weight_alignment"]:
        print("    · %-40s 官方 %2d/%d=%.1f%%  本批 %.1f%%  偏差 %+.1fpp" % (
            r["domain"], r["official_items"], OFFICIAL_QUESTION_COUNT,
            r["official_share"] * 100, r["batch_share"] * 100, r["delta"] * 100))
    print("  numeric-entry %d 题｜multiple-select %d 题" % (
        info["numeric_entry_items"]["count"], info["multiple_select_items"]["count"]))
    ts = info["teaching_scenario_candidates"]
    print("  教学情境题候选 %d 题（人工队列已登记）｜官方口径 %s" % (ts["count"], ts["official_target"]))

    print("── [4] 答案交叉检查 ──")
    print("  自动可疑标记 %d｜人工必看队列 %d 条" % (
        info["answer_auto_flags"], info["answer_review_queue_size"]))
    print("  ⚠ 是否存在第二个合理答案必须由人独立重做一遍，脚本只缩小范围")

    print("── [5] 题干缺条件 ──")
    print("  外部材料引用 %d｜指代缺失嫌疑 %d（待抽查）｜违禁题型 %d" % (
        info["stimulus_reference_hits"], info["dangling_reference_hits"],
        info["forbidden_question_type_hits"]))

    print("── 内容红线 ──")
    rh = info["redline_hits"]
    print("  错误分数量表 %d（硬红线）｜计算器口径加码 %d（硬红线）｜scaled score 承诺 %d（硬红线）｜版权 %d（硬红线）" % (
        rh["bad_scale"], rh["bad_calculator"], rh["score_claim"], rh["copyright"]))
    print("  敏感表述 %d（人工必看）｜官方口径表述 %d（人工必看）" % (rh["bias"], rh["official_claim"]))

    if errors:
        print()
        print("── 阻断项明细 ──")
        for e in errors[:30]:
            print("  ✗ [%s] %s :: %s" % (e.get("code"), e.get("item", "-"), str(e.get("detail"))[:110]))

    if warnings:
        print()
        print("── warning（不阻断）──")
        for w in warnings[:12]:
            print("  ! [%s] %s" % (w.get("code"), str(w.get("detail"))[:110]))

    if review_queue:
        print()
        print("── 人工复核队列（脚本无法替代，必须人做）──")
        for r in review_queue[:20]:
            print("  · %s — %s" % (r["item"], r["reason"]))
            print("      → %s" % r["action"])

    print()
    print("=" * 68)
    print("提醒：本脚本只做机械可判部分。「零自动失败」不等于内容合格 ——")
    print("      第 4 项（答案交叉检查）与教学情境题占比本质是人工工作。")
    print("=" * 68)

    if args.json_report:
        with open(args.json_report, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        print("\nJSON 报告已写入：%s" % args.json_report)

    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
