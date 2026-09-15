#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
validate-8002-items.py — Praxis 8002 题目验收器（D8）

由 content-infra/validate-8006-items.py（D5）改写，改动点逐条列在文件末尾「与 8006 校验器的差异」。

用法：
    python content-infra/validate-8002-items.py [题目文件.json|.jsonl] [--legacy <存量jsonl>] [--json-report out.json]

默认题目文件：同目录下 items/8002-batch1.json（8002 batch1，30 题，draft）
默认存量比对：同目录下 items-5000-series.jsonl（969 题，D2 产出）

五项检查：
    [1] schema 校验    —— 21 字段齐全、类型正确、枚举合法、官方领域名逐字比对
    [2] distractor 硬约束 —— 逐干扰项解析恰好 3 条、键=干扰项原文、60–200 字符
    [3] 去重           —— duplicate_hash 独立复算，批内 + 与 969 题存量跨系列比对
    [4] 领域分布       —— 30 题应为 16 / 14（按官方 42 : 38 比例）
    [5] 题干缺条件     —— 外部图表引用、numeric-entry 误用、指代缺失、多选体例
    附加：内容红线扫描 —— 刻板印象、版权风险、scaled score 承诺、非官方口径冒充

设计原则（继承 D2/D5 教训）：
    · 独立复算，不信任输入。duplicate_hash 与 distractor 键一律重新计算后比对。
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
DEFAULT_ITEMS = os.path.join(SCRIPT_DIR, "items", "8002-batch1.json")
DEFAULT_LEGACY = os.path.join(SCRIPT_DIR, "items-5000-series.jsonl")

TEST_CODE = 8002
SERIES = "8000"
SUBJECT = "Reading and Language Arts"

# 官方领域名 —— 取自 content-infra/official-facts-8000-series.json
#   （本体来源：ETS Elementary Education V5 PDF，verification_status = confirmed）
# ⚠️ 官方写法是 "Writing, Speaking and Listening"（无牛津逗号），
#    不是 5002 的 "Writing, Speaking, and Listening"。逐字校验，不得沿用 5000 系列写法。
CONTENT_DOMAINS = {
    "Reading": 16,
    "Writing, Speaking and Listening": 14,
}
DOMAIN_TOTAL = 30
# 偏离判定：任一领域 ±2 题内接受（30 题样本下 ±2 已是 6.7% 偏移）；超出即退回。
DOMAIN_TOLERANCE = 2

# 8002 官方 question_type 只有 selected-response（官方考试页 + V5 PDF），
# 因此 single-select / multiple-select 合法，numeric-entry 等一律违禁。
# multiple-select 仅 8002–8005 可用，体例见 item-schema-v1.md §8。
ALLOWED_QUESTION_TYPES = {"single-select", "multiple-select"}
FORBIDDEN_QUESTION_TYPES = {"numeric-entry", "constructed-response", "essay", "order"}

MULTI_STEM_REQUIRED = re.compile(r"Which TWO of the following", re.I)
MULTI_STEM_FORBIDDEN = re.compile(r"select all that apply", re.I)

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

# distractor_explanations 写法规范（item-schema-v1.md §6）——硬约束
DEX_MIN, DEX_MAX = 60, 200
DEX_BAD_OPENERS = re.compile(r"^\s*(this is incorrect|the correct answer is|that is wrong)", re.I)
DEX_FILLER = re.compile(r"\b(is not the best choice|is incorrect because|is wrong because)\b", re.I)

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
# scaled score 承诺：8000 系列无官方换算表，任何换算承诺都是编的
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
# 教学情境题启发式（用于统计 Tasks of Teaching 候选，结果标「待抽查」）
TEACHING_SCENARIO_PAT = re.compile(
    r"\b(Ms\.|Mr\.|Mrs\.|the teacher|your students|a student|students'|the class|"
    r"grade \d|first[- ]grade|second[- ]grade|third[- ]grade|fourth[- ]grade|fifth[- ]grade|"
    r"small group|whole[- ]class|lesson plan|during (a|the) lesson)\b",
    re.I,
)


# ---------------------------------------------------------------- 工具函数

def normalize(t):
    """schema duplicate_hash 步骤 1：小写 + 移除非 [a-z0-9] 全部字符"""
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


def answer_list(it):
    """correct_answer 归一为列表"""
    ca = it.get("correct_answer")
    if ca is None:
        return []
    return ca if isinstance(ca, list) else [ca]


def compute_duplicate_hash(stem, choices):
    """
    schema duplicate_hash 算法：
      parts = [normalize(stem)] + sorted(normalize(choices))
      payload = "|".join(parts)
      hash = sha256(payload).hexdigest()
    与 D2 的 Node 实现、D5 的 8006 校验器共用同一实现。
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


# ---------------------------------------------------------------- 检查

def check_schema(items, errors, warnings):
    """[1] schema 校验：字段齐全、类型正确、枚举合法"""
    seen_ids = {}
    for idx, it in enumerate(items):
        tag = it.get("id", "#<%d>" % idx)

        missing = [f for f in FIELD_ORDER if f not in it]
        if missing:
            errors.append({"item": tag, "check": "schema", "code": "missing_fields", "detail": missing})
        extra = [k for k in it if k not in FIELD_ORDER]
        if extra:
            errors.append({"item": tag, "check": "schema", "code": "extra_fields", "detail": extra})

        if it.get("test_code") != TEST_CODE:
            errors.append({"item": tag, "check": "schema", "code": "wrong_test_code",
                           "detail": "expected %s, got %r" % (TEST_CODE, it.get("test_code"))})
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

        qt = it.get("question_type")
        if qt in FORBIDDEN_QUESTION_TYPES:
            errors.append({"item": tag, "check": "schema", "code": "forbidden_question_type",
                           "detail": "%r — 8002 官方只有 selected-response，无此类题型" % (qt,)})

        cd = it.get("content_domain")
        if cd not in CONTENT_DOMAINS:
            err = {"item": tag, "check": "schema", "code": "bad_content_domain",
                   "detail": "%r not an official 8002 domain" % (cd,)}
            if cd and re.search(r"Speaking,\s+and\s+Listening", str(cd)):
                err["detail"] += "（注意：8002 官方写法是 'Writing, Speaking and Listening'，无牛津逗号；" \
                                 "带逗号的写法属 5002）"
            if cd and "&" in str(cd):
                err["detail"] += "（注意：官方写法用 'and' 不是 '&'）"
            errors.append(err)

        ch = it.get("choices")
        if not isinstance(ch, list) or len(ch) < 2:
            errors.append({"item": tag, "check": "schema", "code": "bad_choices",
                           "detail": "choices must be a list of >=2, got %s" % type(ch).__name__})
        else:
            texts = [choice_text(c) for c in ch]
            if len(set(texts)) != len(texts):
                errors.append({"item": tag, "check": "schema", "code": "duplicate_choices",
                               "detail": "choices 中存在完全相同的选项"})
            ca = it.get("correct_answer")
            pool = answer_pool(it)
            ans = answer_list(it)
            bad = [a for a in ans if a not in pool]
            if bad:
                errors.append({"item": tag, "check": "schema", "code": "correct_answer_not_in_choices",
                               "detail": "correct_answer=%r 不在 choices 池 %s 中" % (bad, sorted(pool)[:6])})

            # 题型与答案结构一致性（schema §4 类型分流）
            if qt == "multiple-select":
                if not isinstance(ca, list):
                    errors.append({"item": tag, "check": "schema", "code": "multiselect_answer_not_list",
                                   "detail": "question_type=multiple-select 但 correct_answer=%r 不是列表" % (ca,)})
                else:
                    if len(set(ca)) != len(ca):
                        errors.append({"item": tag, "check": "schema", "code": "multiselect_duplicate_answer",
                                       "detail": "correct_answer 有重复项 %r" % (ca,)})
                    if len(ca) != 2:
                        errors.append({"item": tag, "check": "schema", "code": "multiselect_wrong_answer_count",
                                       "detail": "multiple-select 正确项须恰好 2 个，现有 %d 个" % len(ca)})
                    if len(ca) >= len(texts):
                        errors.append({"item": tag, "check": "schema", "code": "multiselect_no_distractor",
                                       "detail": "correct_answer 占满全部选项，至少须留一个干扰项"})
                if len(texts) != 5:
                    errors.append({"item": tag, "check": "schema", "code": "multiselect_choice_count",
                                   "detail": "multiple-select 体例为 A–E 五项，现有 %d 项" % len(texts)})
                if not MULTI_STEM_REQUIRED.search(str(it.get("stem", ""))):
                    errors.append({"item": tag, "check": "schema", "code": "multiselect_missing_which_two",
                                   "detail": "multiple-select 题干须用 'Which TWO of the following...' 明确数量"})
                if MULTI_STEM_FORBIDDEN.search(str(it.get("stem", ""))):
                    errors.append({"item": tag, "check": "schema", "code": "multiselect_forbidden_instruction",
                                   "detail": "禁用 'Select all that apply' 写法（schema §8）"})
            if qt == "single-select" and isinstance(ca, list):
                errors.append({"item": tag, "check": "schema", "code": "singleselect_answer_is_list",
                               "detail": "question_type=single-select 但 correct_answer=%r 是列表" % (ca,)})
            if qt == "single-select" and re.search(r"Which TWO", str(it.get("stem", ""))):
                errors.append({"item": tag, "check": "schema", "code": "singleselect_stem_is_multi",
                               "detail": "single-select 题干出现 'Which TWO'，与题型矛盾"})

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

        h = it.get("duplicate_hash")
        if not HASH_RE.match(str(h or "")):
            errors.append({"item": tag, "check": "schema", "code": "bad_duplicate_hash_format",
                           "detail": "duplicate_hash=%r 不是 64 位小写 hex" % (h,)})

        # skill 不得为 null（schema §1：不得由认知层级推导，但新题必须给出 skill 标签）
        if it.get("skill") is None:
            warnings.append({"item": tag, "check": "completeness", "code": "skill_null",
                             "detail": "skill 为 null —— 新题应给出考查技能标签"})


def check_distractor_explanations(items, errors, warnings):
    """[2] distractor_explanations 硬约束（8002 起为 blocking）"""
    total, checked = 0, 0
    for it in items:
        tag = it.get("id")
        ch = it.get("choices") or []
        texts = [choice_text(c) for c in ch]
        ans = answer_list(it)
        de = it.get("distractor_explanations")

        if not isinstance(de, dict):
            errors.append({"item": tag, "check": "distractors", "code": "dex_not_object",
                           "detail": "distractor_explanations 必须为对象，现有 %s" % type(de).__name__})
            continue

        # 键必须取自 choices，且不得指向正确答案
        for k in de:
            total += 1
            if k not in texts:
                errors.append({"item": tag, "check": "distractors", "code": "dex_key_not_in_choices",
                               "detail": "键 %r 与任何选项都不逐字一致" % (k[:60],)})
            elif k in ans:
                errors.append({"item": tag, "check": "distractors", "code": "dex_key_is_correct_answer",
                               "detail": "键 %r 是正确答案，不得为它写干扰项解析" % (k[:60],)})

        # 条数必须恰好 3
        expected = len(texts) - len(ans)
        if expected != 3:
            errors.append({"item": tag, "check": "distractors", "code": "unexpected_distractor_count",
                           "detail": "choices %d 项 - 正确 %d 项 = %d 个干扰项，本批次体例要求恰好 3 个"
                                     % (len(texts), len(ans), expected)})
        if len(de) != 3:
            errors.append({"item": tag, "check": "distractors", "code": "dex_count_not_three",
                           "detail": "distractor_explanations 现有 %d 条，必须恰好 3 条（缺一条即退回）" % len(de)})
        if len(set(de.keys())) != len(de):
            errors.append({"item": tag, "check": "distractors", "code": "dex_duplicate_keys",
                           "detail": "distractor_explanations 存在重复键"})

        # 逐条写法与长度
        for k, v in de.items():
            if not isinstance(v, str) or not v.strip():
                errors.append({"item": tag, "check": "distractors", "code": "dex_empty",
                               "detail": "键 %r 的解析为空" % (k[:60],)})
                continue
            checked += 1
            if not (DEX_MIN <= len(v) <= DEX_MAX):
                errors.append({"item": tag, "check": "distractors", "code": "dex_length",
                               "detail": "键 %r 的解析 %d 字符，须在 %d–%d 之间"
                                         % (k[:40], len(v), DEX_MIN, DEX_MAX)})
            if DEX_BAD_OPENERS.search(v):
                errors.append({"item": tag, "check": "distractors", "code": "dex_bad_opener",
                               "detail": "键 %r 的解析以禁用套话开头（This is incorrect / The correct answer is）" % (k[:40],)})
            if DEX_FILLER.search(v):
                errors.append({"item": tag, "check": "distractors", "code": "dex_filler",
                               "detail": "键 %r 的解析含空泛套话（is not the best choice 等）" % (k[:40],)})
            if v.strip() == str(it.get("explanation", "")).strip():
                errors.append({"item": tag, "check": "distractors", "code": "dex_equals_explanation",
                               "detail": "键 %r 的解析与 explanation 完全相同" % (k[:40],)})
    return {"dex_total": total, "dex_checked": checked}


def check_duplicates(items, legacy_path, errors, warnings, info):
    """[3] 去重：独立复算 hash，批内 + 跨系列与存量比对"""
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
                       "samples": hash_mismatch[:5],
                       "detail": "duplicate_hash 独立复算不一致 —— 该条不通过"})

    by_hash = {}
    for iid, h in recomputed.items():
        by_hash.setdefault(h, []).append(iid)
    intra = {h: ids for h, ids in by_hash.items() if len(ids) > 1}
    if intra:
        for h, ids in intra.items():
            errors.append({"check": "dedupe", "code": "intra_batch_duplicate",
                           "detail": "%d 题共享 duplicate_hash %s…" % (len(ids), h[:12]), "items": ids})
    info["intra_batch_duplicates"] = len(intra)
    info["hash_mismatch_count"] = len(hash_mismatch)

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
                           "detail": "%d 题与存量 969 题重复（含 5002 RLA 存量）" % len(cross),
                           "items": cross[:20]})
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
        warnings.append({"check": "dedupe", "code": "near_duplicate_suspect",
                         "count": len(near), "samples": near[:5],
                         "note": "启发式判定（词集包含度 ≥85%），必须人工看原文确认，勿直接采信"})
    info["near_duplicates"] = len(near)


def check_distribution(items, errors, warnings, review_queue, info):
    """[4] 领域分布：30 题应为 16 / 14（官方 42 : 38）"""
    counts = Counter(it.get("content_domain") for it in items)
    total = sum(v for k, v in counts.items() if k in CONTENT_DOMAINS)
    unknown = {k: v for k, v in counts.items() if k not in CONTENT_DOMAINS}

    info["domain_counts"] = dict(counts)
    info["domain_total"] = total

    if unknown:
        errors.append({"check": "distribution", "code": "unknown_domain_present", "detail": unknown})

    if total != DOMAIN_TOTAL:
        warnings.append({"check": "distribution", "code": "unexpected_total",
                         "detail": "有效题数 %d，预期 %d。分布按实际总数复核" % (total, DOMAIN_TOTAL)})

    for dom, want in CONTENT_DOMAINS.items():
        got = counts.get(dom, 0)
        if abs(got - want) > DOMAIN_TOLERANCE:
            errors.append({"check": "distribution", "code": "domain_off_target",
                           "detail": "%s: %d 题，预期 %d（容差 ±%d）" % (dom, got, want, DOMAIN_TOLERANCE)})

    info["difficulty_counts"] = dict(Counter(it.get("difficulty") for it in items))
    info["source_basis_counts"] = dict(Counter(it.get("source_basis") for it in items))
    info["question_type_counts"] = dict(Counter(it.get("question_type") for it in items))
    info["review_status_counts"] = dict(Counter(it.get("review_status") for it in items))

    # 多选题占比（schema §8：每批约 10%）
    multi = sum(1 for it in items if it.get("question_type") == "multiple-select")
    info["multiple_select_count"] = multi
    info["multiple_select_share"] = round(multi / total, 3) if total else 0

    # 教学情境题候选：只做候选筛选，不算百分比、不判达标（正则召回率低）
    scen = [it.get("id") for it in items if TEACHING_SCENARIO_PAT.search(str(it.get("stem", "")))]
    info["teaching_scenario_candidates"] = {
        "count": len(scen),
        "ids": scen,
        "official_target": "10–15%（ETS 官方口径，适用于 Elementary Education Fundamentals 全科）",
        "usage": "候选列表，非统计结果。正则召回率低，不得据此计算占比或判定达标",
    }
    review_queue.append({
        "item": "(全批)",
        "reason": "教学情境题（Tasks of Teaching）占比需人工确认",
        "action": "通读全部 %d 题，人工判定哪些题干把内容嵌在教学情境里，确认占比落在官方 10–15%% 区间。"
                  "正则给出 %d 个候选，召回率低，仅作起点" % (total, len(scen)),
    })


def check_answers(items, errors, warnings, review_queue, info):
    """[5] 答案交叉检查：自动可判部分 + 人工复核清单"""
    auto_flags = 0
    for it in items:
        tag = it.get("id")
        ch = it.get("choices") or []
        texts = [choice_text(c) for c in ch]
        ca = it.get("correct_answer")
        ca_list = answer_list(it)
        stem = str(it.get("stem", ""))

        if it.get("question_type") == "multiple-select":
            review_queue.append({"item": tag,
                                 "reason": "multiple-select，标注答案 %s" % ",".join(map(str, ca_list)),
                                 "action": "人工独立重做：每一项都成立，且没有漏掉任何成立的选项"})
            auto_flags += 1

        absolute = [t for t in texts if re.match(r"^\s*(all|none|never|always|only)\b", t, re.I)]
        for a in ca_list:
            if a in absolute:
                review_queue.append({"item": tag,
                                     "reason": "correct_answer 含绝对化表述 %r（all/none/never/always/only）" % (a,),
                                     "action": "人工确认是否唯一合理答案；绝对化选项通常是干扰项"})
                auto_flags += 1

        if any(re.search(r"\b(all|none) of the above\b", t, re.I) for t in texts):
            review_queue.append({"item": tag, "reason": "含 all/none of the above 选项",
                                 "action": "人工确认其余选项确实全对/全错"})
            auto_flags += 1

        if re.search(r"\b(NOT|EXCEPT|LEAST|incorrect)\b", stem):
            review_queue.append({"item": tag, "reason": "否定式题干（NOT/EXCEPT/LEAST/incorrect）",
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
                    review_queue.append({"item": tag, "reason": "选项 %d 与 %d 表述高度重叠（≥80%%）" % (i + 1, j + 1),
                                         "action": "人工确认二者是否有实质区别（语法类最小对立对属正常现象）"})
                    auto_flags += 1

    info["answer_review_queue_size"] = len(review_queue)
    info["answer_auto_flags"] = auto_flags
    if not review_queue:
        warnings.append({"check": "answers", "code": "no_auto_flags",
                         "detail": "自动检查未发现可疑项。**这不等于交叉检查通过** —— "
                                   "判断是否存在第二个合理答案必须由人独立完成一遍"})


def check_stem_completeness(items, errors, warnings, review_queue, info):
    """题干缺条件：外部图表引用 / 题型误用 / 指代缺失"""
    stimulus_ref, dangling, numeric_misuse = [], [], []

    for it in items:
        tag = it.get("id")
        stem = str(it.get("stem", ""))
        stim = it.get("stimulus")
        qt = it.get("question_type")

        if STIMULUS_REF_PAT.search(stem):
            hit = STIMULUS_REF_PAT.search(stem).group(0)
            stimulus_ref.append({"item": tag, "matched": hit})
            if not stim:
                errors.append({"item": tag, "check": "stem_completeness", "code": "missing_stimulus",
                               "detail": "题干引用外部材料（%s）但 stimulus 字段为空 —— 用户看不到材料，废题" % hit})
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
    info["stimulus_used"] = sum(1 for it in items if it.get("stimulus"))

    if dangling:
        warnings.append({"check": "stem_completeness", "code": "dangling_reference_suspect",
                         "count": len(dangling), "samples": dangling[:5],
                         "note": "启发式命中，需抽查原文（如 'a table's area' 指桌子面积而非表格，属误报）"})
    if numeric_misuse:
        errors.append({"check": "stem_completeness", "code": "question_type_violation",
                       "count": len(numeric_misuse),
                       "detail": "8002 官方只有 selected-response，不得出现 numeric-entry 等题型"})


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

    if hits["copyright"]:
        errors.append({"check": "redline", "code": "copyright_risk", "items": hits["copyright"],
                       "detail": "可能引用真实出版物原文。stimulus 一律须原创或改写"})
    if hits["score_claim"]:
        errors.append({"check": "redline", "code": "score_claim", "items": hits["score_claim"],
                       "detail": "不得承诺或暗示 scaled score 换算 —— ETS 未公布 8000 系列换算表"})

    if hits["bias"]:
        review_queue.append({"item": ",".join(hits["bias"][:10]), "reason": "敏感表述启发式命中",
                             "action": "人工通读确认是否为刻板印象或价值判断"})
    if hits["official_claim"]:
        review_queue.append({"item": ",".join(hits["official_claim"][:10]),
                             "reason": "出现 'ETS states/guidelines' 类表述",
                             "action": "人工确认确有官方依据；无依据一律改 source_basis = expert-judgment"})

    info["redline_hits"] = {k: len(v) for k, v in hits.items()}
    info["redline_bias_items"] = hits["bias"][:10]
    info["redline_official_claim_items"] = hits["official_claim"][:10]


# ---------------------------------------------------------------- 主流程

def main():
    ap = argparse.ArgumentParser(description="Praxis 8002 题目验收器（D8）")
    ap.add_argument("items", nargs="?", default=DEFAULT_ITEMS,
                    help="8002 题目文件（.json 或 .jsonl），默认 %s" % DEFAULT_ITEMS)
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

    if bad_lines:
        errors.append({"check": "parse", "code": "malformed_lines", "detail": bad_lines[:10]})

    if not items:
        print("[FATAL] 题目文件为空，无内容可验收。", file=sys.stderr)
        return 2

    check_schema(items, errors, warnings)
    dex_info = check_distractor_explanations(items, errors, warnings)
    info.update(dex_info)
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
    print("Praxis 8002 题目验收报告（D8）")
    print("=" * 68)
    print("输入文件 : %s" % info["source_file"])
    print("题目数量 : %d" % info["item_count"])
    print("存量比对 : %s 题%s" % (info.get("legacy_items_loaded", 0),
                                  "（未执行：文件缺失）" if info.get("cross_series_duplicates") is None else ""))
    print("结论     : %s" % ("PASS（含 warning）" if ok else "FAIL —— 存在阻断项"))
    print()

    print("── [1] schema 校验 ──")
    se = [e for e in errors if e.get("check") == "schema"]
    print("  阻断项 %d｜字段数 %d｜完整性 warning %d"
          % (len(se), FIELD_COUNT, len([w for w in warnings if w.get("check") == "completeness"])))

    print("── [2] distractor_explanations 硬约束 ──")
    de = [e for e in errors if e.get("check") == "distractors"]
    print("  条目 %d 条｜逐条长度与写法已检 %d 条｜阻断项 %d"
          % (info.get("dex_total", 0), info.get("dex_checked", 0), len(de)))
    print("  要求：每题恰好 3 条、键=干扰项原文逐字一致、%d–%d 字符" % (DEX_MIN, DEX_MAX))

    print("── [3] 去重 ──")
    print("  批内精确重复 %s｜跨系列重复 %s｜近似重复嫌疑 %s（待抽查）"
          % (info["intra_batch_duplicates"], info["cross_series_duplicates"], info["near_duplicates"]))
    print("  hash 独立复算不一致 %s" % info["hash_mismatch_count"])

    print("── [4] 领域分布 ──")
    for dom, want in CONTENT_DOMAINS.items():
        got = info["domain_counts"].get(dom, 0)
        flag = "  " if abs(got - want) <= DOMAIN_TOLERANCE else "←偏离"
        print("  %-34s %3d / %-3d %s" % (dom, got, want, flag))
    print("  题型 %s｜难度 %s" % (info["question_type_counts"], info["difficulty_counts"]))
    print("  multiple-select %d 题（占比 %.0f%%，schema §8 目标约 10%%）"
          % (info["multiple_select_count"], info["multiple_select_share"] * 100))
    print("  stimulus 使用 %d 题｜教学情境题候选 %d 题（人工队列已登记）"
          % (info.get("stimulus_used", 0), info["teaching_scenario_candidates"]["count"]))

    print("── [5] 题干缺条件 ──")
    print("  外部材料引用 %d｜指代缺失嫌疑 %d（待抽查）｜题型违规 %d"
          % (info["stimulus_reference_hits"], info["dangling_reference_hits"], info["numeric_entry_misuse"]))

    print("── 内容红线 ──")
    print("  版权风险 %d（硬红线）｜scaled score 承诺 %d（硬红线）"
          % (info["redline_hits"]["copyright"], info["redline_hits"]["score_claim"]))
    print("  敏感表述 %d（人工必看）｜官方口径表述 %d（人工必看）"
          % (info["redline_hits"]["bias"], info["redline_hits"]["official_claim"]))

    if errors:
        print()
        print("── 阻断项明细 ──")
        for e in errors[:30]:
            print("  ✗ [%s] %s :: %s" % (e.get("code"), e.get("item", "-"), str(e.get("detail"))[:110]))

    if review_queue:
        print()
        print("── 人工复核队列（脚本无法替代，必须人做）──")
        for r in review_queue[:20]:
            print("  · %s — %s" % (r["item"], r["reason"]))
            print("      → %s" % r["action"])

    print()
    print("=" * 68)
    print("提醒：本脚本只做机械可判部分。「零自动失败」不等于内容合格 ——")
    print("      答案交叉检查（是否存在第二个合理答案）本质是人工工作。")
    print("=" * 68)

    if args.json_report:
        with open(args.json_report, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        print("\nJSON 报告已写入：%s" % args.json_report)

    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())


# ---------------------------------------------------------------- 与 8006 校验器的差异
#
# 1. TEST_CODE 8006 → 8002；SUBJECT "Teaching Reading" → "Reading and Language Arts"。
# 2. CONTENT_DOMAINS 换成 8002 的两个官方领域（Reading 16 / Writing, Speaking and Listening 14），
#    并按官方 42 : 38 比例设定目标；旧科名带牛津逗号（Writing, Speaking, and Listening）
#    会命中专门的错误提示，防止从 5000 系列误抄。
# 3. 新增 blocking 检查：distractor_explanations 恰好 3 条、键必须逐字取自 choices、
#    键不得指向正确答案、每条 60–200 字符、禁用 "This is incorrect" 开头与空泛套话。
#    （8006 校验器把这类缺口记为 warning；8002 起按 schema §4「硬约束」升级为阻断项。）
# 4. multiple-select 从「warning：题干缺 Select all that apply」改为
#    「error：必须用 'Which TWO of the following' 且禁用 'Select all that apply'」（schema §8）。
# 5. 新增 multiple-select 结构校验：A–E 五项、正确项恰好 2 个、去重、至少留一个干扰项、
#    答案必须是数组；single-select 反向校验（不得是数组、题干不得出现 Which TWO）。
# 6. FORBIDDEN_QUESTION_TYPES 加入 order（本批不产出排序题）。
# 7. duplicate_hash 格式不合法、复算不一致，从 warning 升为 blocking。
# 8. 默认题目文件改为 items/8002-batch1.json，无需命令行参数即可自检。
# 9. 额外输出题型/难度/review_status 分布、multiple-select 占比、stimulus 使用数。
