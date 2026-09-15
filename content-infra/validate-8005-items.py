#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
validate-8005-items.py — Praxis 8005（Science）题目验收器 · D11

用途：验收 8005 mini test 题库是否符合 item-schema-v1（21 字段），并额外做两件
      8006 / 8004 校验器没有覆盖的事：
        ① 科学科专有的内容红线（变量控制表述、迷思概念写法、scaled score 承诺、
           争议议题的价值判断、被证伪的第三方口径）
        ② 页面口径守卫（8005 的「各领域题量」是 triangulated，页面不得出现精确断言）

用法：
    python validate-8005-items.py                       # 默认读 ../site/questions-8005.js
    python validate-8005-items.py <题目文件.json|.jsonl|.js>
    python validate-8005-items.py --json-report out.json

默认存量比对：content-infra/items-5000-series.jsonl（969 题），用于跨系列查重。

设计原则（继承 D2 / D5 教训）：
    · 独立复算，不信任输入：duplicate_hash 一律按 schema §3 重算，自报值只作对照。
    · 启发式结果标「待人工复核」，不直接当结论；命中不等于有问题。
    · 零依赖，仅标准库。

退出码：0 = 全部通过（含 warning）｜1 = 存在 blocking 失败｜2 = 用法/文件错误
"""

import argparse
import hashlib
import json
import os
import re
import sys
from collections import Counter, OrderedDict

# ---------------------------------------------------------------- 常量

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(SCRIPT_DIR)

SITE = os.path.join(ROOT, "site")
DEFAULT_ITEMS_JS = os.path.join(SITE, "questions-8005.js")
DEFAULT_LEGACY = os.path.join(SCRIPT_DIR, "items-5000-series.jsonl")

# 站点页面（页面口径守卫用）
PAGES = {
    "guide": os.path.join(SITE, "praxis-8005-science.html"),
    "practice": os.path.join(SITE, "praxis-8005-practice.html"),
}

TEST_CODE = 8005
SERIES = "8000"
SUBJECT = "Science"
JS_MARKER = "window.DM_BANK_8005_ITEMS"

# 官方领域名 —— 取自 official-facts-8000-series.json
# ⚠️ 该文件同时标注：这三个名字可用，但「题量分布」verification_status = triangulated，
#    故本校验器只校验名字，不校验题量比例（题量比例不构成验收条件）。
CONTENT_DOMAINS = {
    "Earth and Space Science": 10,
    "Life Science": 10,
    "Physical Science": 10,
}
DOMAIN_TOTAL = 30
DOMAIN_TOLERANCE = 2

FIELD_ORDER = [
    "id", "series", "test_code", "subject", "content_domain", "skill",
    "difficulty", "question_type", "stimulus", "stem", "choices",
    "correct_answer", "explanation", "distractor_explanations",
    "source_basis", "review_status", "reviewer", "version",
    "duplicate_hash", "created_at", "updated_at",
]
FIELD_COUNT = len(FIELD_ORDER)  # 21

ENUMS = {
    "series": {SERIES},
    "difficulty": {"easy", "medium", "hard"},
    "question_type": {"single-select", "multiple-select"},
    "source_basis": {"legacy-unknown", "expert-judgment", "official-source"},
    "review_status": {"draft", "human-reviewed", "rejected"},
}
FORBIDDEN_QUESTION_TYPES = {"numeric-entry", "constructed-response", "essay"}

ISO8601_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$")
HASH_RE = re.compile(r"^[0-9a-f]{64}$")

DEX_MIN, DEX_MAX = 60, 200
DEX_BAD_OPENERS = re.compile(
    r"^\s*(this is (incorrect|wrong)|the correct answer is|it is (incorrect|wrong)|"
    r"incorrect because|the student|this option)", re.I)
DEX_BANNED_PHRASES = re.compile(
    r"(is not the best choice|does not fit|is incorrect because|no explanation)", re.I)

# ---------------------------------------------------------------- 科学科启发式

# 外部材料引用但 stimulus 为空 → 废题（含「the table / the data」这类指向）
STIMULUS_REF_PAT = re.compile(
    r"\b(shown below|the following (table|graph|chart|diagram|figure|data|passage)|"
    r"according to the (table|graph|chart|diagram|figure|data)|"
    r"the (table|graph|chart|diagram|figure|data|counts) (above|below)|"
    r"(supported|shown|indicated) by the (table|graph|chart|data|counts)|"
    r"best supported by the (table|data|counts)|"
    r"refer to the (table|figure|diagram))\b",
    re.I,
)

# 实验设计题：术语一致性（不自动判退，进人工复核队列）
DESIGN_TERMS = ("independent variable", "dependent variable",
                "controlled variable", "control group", "held constant", "same in every")

# 被证伪的第三方口径（official-facts-8000-series.json · discredited_claims）
DISCREDITED_PAT = re.compile(r"(100\s*[-–]\s*300|passing score of 240|240 to pass|score of 240)", re.I)
# 其它考试格式错配（8005 是 90 分钟 / 74 题）
WRONG_FORMAT_PAT = re.compile(r"\b(100\s*(minutes|min)\b|55 questions|68 questions|77 questions|80 questions)", re.I)

# scaled score 承诺 —— 全站红线
SCORE_CLAIM_PAT = re.compile(
    r"\b(scaled score of|your scaled score|converts to a score|this (corresponds to|equals) a (scaled )?score|"
    r"you would (score|earn) (a|approximately))\b",
    re.I,
)
# 冒充官方口径
OFFICIAL_CLAIM_PAT = re.compile(
    r"\b(ETS (states|requires|confirms|specifies|says)|according to ETS|"
    r"the official (ETS )?(blueprint|specification)|ETS guidelines)\b",
    re.I,
)
# 争议议题的价值判断 / 非标准科学口径（只提示，不判退；采用标准教材口径是允许的）
VALUE_JUDGMENT_PAT = re.compile(
    r"\b(hoax|not real|fake science|just a theory|unproven theory|so-?called|"
    r"believers|deniers|propaganda|agenda)\b",
    re.I,
)
# 刻板印象 / 群体归因
BIAS_PAT = re.compile(
    r"\b(boys are (better|worse)|girls are (better|worse)|"
    r"(black|white|asian|hispanic|latino) students (typically|usually|naturally)|"
    r"(christian|muslim|jewish|hindu) (students|families|children) (typically|usually)|"
    r"students with disabilities (cannot|can't|are unable)|"
    r"(inner[- ]city|urban) students (typically|usually|tend to))\b",
    re.I,
)
# 版权风险
COPYRIGHT_PAT = re.compile(
    r"\b(excerpt (from|copyright)|©|\ball rights reserved\b|reprinted (from|with permission)|"
    r"from the book|published by (scholastic|penguin|harpercollins|macmillan|houghton))\b",
    re.I,
)

# 数值 + 单位：逐条列出供人工复核（物理单位、天文数据、化学计量）
UNIT_HINT_PAT = re.compile(
    r"\d+(?:[.,]\d+)?\s*(?:°\s?C|°\s?F|degrees Celsius|degrees Fahrenheit|kJ|kg|g\b|mg|cm|mm|km|m\b|"
    r"m/s|km/h|seconds|minutes|hours|percent|%)"
)

# 页面口径守卫：领域名后 90 字符内出现 24/25/26 之类精确题量
DOMAIN_COUNT_PAT = [
    re.compile(r"(Earth and Space Science|Life Science|Physical Science)[^.\n]{0,90}?\b(1[0-9]|2[0-9]|3[0-9])\b\s*(questions|items)", re.I),
    re.compile(r"\b(2[0-9])\s+(Earth and Space Science|Life Science|Physical Science)\s+(questions|items)", re.I),
    re.compile(r"(Earth and Space Science|Life Science|Physical Science)\s*(—|–|-|:)\s*2[0-9]\b", re.I),
]


# ---------------------------------------------------------------- 工具函数

def normalize(t):
    """schema §3 步骤 1：小写 + 移除全部非 [a-z0-9] 字符"""
    return re.sub(r"[^a-z0-9]", "", str(t).lower())


def compute_duplicate_hash(stem, choices):
    """
    schema §3：parts = [normalize(stem)] + sorted(normalize(choice))
              payload = "|".join(parts) → sha256 hex
    与 map-legacy-5001-to-schema-v1.mjs / validate-8006-items.py 逐字一致。
    """
    parts = [normalize(stem)] + sorted(normalize(c) for c in choices)
    return hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()


def extract_js_items(path):
    """从 site/questions-8005.js 里取出 schema v1 数组（纯 JSON，可 raw_decode）"""
    with open(path, "r", encoding="utf-8") as f:
        raw = f.read()
    at = raw.find(JS_MARKER)
    if at < 0:
        raise ValueError("JS 题库里找不到标记 %s" % JS_MARKER)
    start = raw.find("[", at)
    if start < 0:
        raise ValueError("标记 %s 之后找不到 JSON 数组" % JS_MARKER)
    dec = json.JSONDecoder()
    items, _ = dec.raw_decode(raw[start:])
    return items


def load_items(path):
    if not os.path.exists(path):
        raise FileNotFoundError(path)
    if path.lower().endswith(".js"):
        return extract_js_items(path), []
    with open(path, "r", encoding="utf-8") as f:
        raw = f.read().strip()
    if not raw:
        return [], []
    if path.lower().endswith(".jsonl"):
        items, bad = [], []
        for i, line in enumerate(raw.splitlines(), 1):
            line = line.strip()
            if not line:
                continue
            try:
                items.append(json.loads(line))
            except json.JSONDecodeError as e:
                bad.append({"line": i, "error": str(e)})
        return items, bad
    data = json.loads(raw)
    if isinstance(data, list):
        return data, []
    if isinstance(data, dict):
        for key in ("items", "questions", "data"):
            if isinstance(data.get(key), list):
                return data[key], []
        return [data], []
    return [], [{"line": 0, "error": "unrecognized JSON structure"}]


def answer_list(ca):
    return ca if isinstance(ca, list) else ([ca] if ca is not None else [])


# ---------------------------------------------------------------- [1] schema

def check_schema(items, errors, warnings, review_queue, info):
    seen_ids = {}
    for idx, it in enumerate(items):
        tag = it.get("id", "#<%d>" % idx)

        missing = [f for f in FIELD_ORDER if f not in it]
        if missing:
            errors.append({"item": tag, "check": "schema", "code": "missing_fields", "detail": missing})
        extra = [k for k in it if k not in FIELD_ORDER]
        if extra:
            errors.append({"item": tag, "check": "schema", "code": "extra_fields",
                           "detail": extra, "note": "schema v1 为定长 21 字段，多余字段视为阻断"})
        if len(it) != FIELD_COUNT:
            warnings.append({"item": tag, "check": "schema", "code": "field_count",
                             "detail": "实际 %d 字段，期望 %d" % (len(it), FIELD_COUNT)})

        if it.get("test_code") != TEST_CODE:
            errors.append({"item": tag, "check": "schema", "code": "wrong_test_code",
                           "detail": "expected %s, got %r" % (TEST_CODE, it.get("test_code"))})
        elif not isinstance(it.get("test_code"), int):
            errors.append({"item": tag, "check": "schema", "code": "test_code_not_int",
                           "detail": "test_code 必须为整数，实际 %s" % type(it.get("test_code")).__name__})
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
                           "detail": "%r — 8005 官方题面为 selected-response" % qt})

        cd = it.get("content_domain")
        if cd not in CONTENT_DOMAINS:
            err = {"item": tag, "check": "schema", "code": "bad_content_domain",
                   "detail": "%r not an official 8005 domain" % (cd,)}
            if cd and "&" in str(cd):
                err["detail"] += "（官方写法不含 &）"
            if cd and str(cd).endswith("Sciences"):
                err["detail"] += "（注意：Steps 代码名用 Sciences 复数，content_domain 用单数）"
            errors.append(err)

        # choices / correct_answer
        ch = it.get("choices")
        if not isinstance(ch, list) or len(ch) < 2:
            errors.append({"item": tag, "check": "schema", "code": "bad_choices",
                           "detail": "choices 必须是长度 ≥2 的数组，实际 %s" % type(ch).__name__})
        else:
            if len(set(ch)) != len(ch):
                errors.append({"item": tag, "check": "schema", "code": "duplicate_choices",
                               "detail": "choices 中存在完全相同的选项"})
            ca = it.get("correct_answer")
            ans = answer_list(ca)
            pool = set(ch)
            bad = [a for a in ans if a not in pool]
            if bad:
                errors.append({"item": tag, "check": "schema", "code": "correct_answer_not_in_choices",
                               "detail": "correct_answer=%r 不在 choices 中（必须用选项原文，不得用索引）" % (bad,)})
            if qt == "multiple-select":
                if not isinstance(ca, list):
                    errors.append({"item": tag, "check": "schema", "code": "multiselect_answer_not_list",
                                   "detail": "question_type=multiple-select 但 correct_answer=%r 不是数组" % (ca,)})
                else:
                    if len(ca) != 2:
                        errors.append({"item": tag, "check": "schema", "code": "multiselect_answer_count",
                                       "detail": "体例要求恰好 2 项，实际 %d 项" % len(ca)})
                    if len(set(ca)) != len(ca):
                        errors.append({"item": tag, "check": "schema", "code": "multiselect_answer_duplicated",
                                       "detail": repr(ca)})
                if len(ch) != 5:
                    errors.append({"item": tag, "check": "schema", "code": "multiselect_choice_count",
                                   "detail": "体例要求 A–E 共 5 项，实际 %d 项" % len(ch)})
                if not re.search(r"Which TWO of the following", str(it.get("stem", ""))):
                    errors.append({"item": tag, "check": "schema", "code": "multiselect_wrong_prompt",
                                   "detail": "题干必须用 'Which TWO of the following...'（禁止 'Select all that apply'）"})
            if qt == "single-select":
                if isinstance(ca, list):
                    errors.append({"item": tag, "check": "schema", "code": "singleselect_answer_is_list",
                                   "detail": "question_type=single-select 但 correct_answer 是数组"})
                elif len(ch) != 4:
                    warnings.append({"item": tag, "check": "schema", "code": "single_choice_count",
                                     "detail": "单选一般为 4 项，实际 %d 项" % len(ch)})

        for f in ("stem", "explanation"):
            v = it.get(f)
            if not isinstance(v, str) or not v.strip():
                errors.append({"item": tag, "check": "schema", "code": "empty_field", "detail": f})

        for f in ("created_at", "updated_at"):
            v = it.get(f)
            if v is not None and not ISO8601_RE.match(str(v)):
                errors.append({"item": tag, "check": "schema", "code": "bad_timestamp",
                               "detail": "%s=%r，需 ISO-8601 UTC（…Z）" % (f, v)})

        v = it.get("version")
        if not isinstance(v, int) or v < 1:
            errors.append({"item": tag, "check": "schema", "code": "bad_version", "detail": repr(v)})

        dh = it.get("duplicate_hash")
        if not isinstance(dh, str) or not HASH_RE.match(dh):
            errors.append({"item": tag, "check": "schema", "code": "bad_duplicate_hash",
                           "detail": "需 64 位小写 hex，实际 %r" % (dh,)})

        for f in ("skill",):
            if it.get(f) is None:
                warnings.append({"item": tag, "check": "completeness", "code": "%s_null" % f,
                                 "detail": "本批新题应补齐（存量缺口口径不适用于 8005）"})
        # stimulus 为 null 在科学科属正常（只有图表/材料题才带 stimulus），故只记 info
        if it.get("stimulus") is None:
            info.setdefault("stimulus_null_ids", []).append(it.get("id"))

        if it.get("review_status") == "draft":
            review_queue.append({"item": tag, "reason": "review_status = draft（机稿未人工复核）",
                                 "action": "人工复核科学事实（单位、数据、概念）后改 human-reviewed"})

    info["review_status_counts"] = dict(Counter(i.get("review_status") for i in items))
    info["source_basis_counts"] = dict(Counter(i.get("source_basis") for i in items))


# ---------------------------------------------------------------- [2] 去重

def approx_dupe(a, b):
    wa = set(re.findall(r"[a-z0-9]+", normalize(a)))
    wb = set(re.findall(r"[a-z0-9]+", normalize(b)))
    if not wa or not wb:
        return False
    inter = len(wa & wb)
    return (inter / len(wa) >= 0.85) or (inter / len(wb) >= 0.85)


def check_duplicates(items, legacy_path, errors, warnings, info):
    recomputed, mismatch = {}, []
    for it in items:
        h = compute_duplicate_hash(it.get("stem", ""), it.get("choices") or [])
        recomputed[it.get("id", "")] = h
        if it.get("duplicate_hash") and it["duplicate_hash"] != h:
            mismatch.append({"item": it.get("id"), "declared": it["duplicate_hash"], "recomputed": h})

    if mismatch:
        errors.append({"check": "dedupe", "code": "hash_mismatch",
                       "detail": "自报 hash 与独立复算不一致（以复算值为准）",
                       "count": len(mismatch), "samples": mismatch[:5]})
    info["hash_mismatch_count"] = len(mismatch)

    by_hash = {}
    for iid, h in recomputed.items():
        by_hash.setdefault(h, []).append(iid)
    intra = {h: ids for h, ids in by_hash.items() if len(ids) > 1}
    for h, ids in intra.items():
        errors.append({"check": "dedupe", "code": "intra_batch_duplicate",
                       "detail": "%d 题共享 duplicate_hash %s…" % (len(ids), h[:12]), "items": ids})
    info["intra_batch_duplicates"] = len(intra)

    legacy_hashes = set()
    if legacy_path and os.path.exists(legacy_path):
        legacy_items, _ = load_items(legacy_path)
        for it in legacy_items:
            h = it.get("duplicate_hash") or compute_duplicate_hash(it.get("stem", ""), it.get("choices") or [])
            legacy_hashes.add(h)
        cross = [iid for iid, h in recomputed.items() if h in legacy_hashes]
        if cross:
            errors.append({"check": "dedupe", "code": "cross_series_duplicate",
                           "detail": "%d 题与存量 969 题重复" % len(cross), "items": cross[:20]})
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
                         "detail": "待抽查配对：%s" % (near[:5],),
                         "samples": near[:5],
                         "note": "启发式（词集包含度 ≥85%），必须人工看原文确认"})
    info["near_duplicates"] = len(near)


# ---------------------------------------------------------------- [3] 领域分布

def check_distribution(items, errors, warnings, info):
    counts = Counter(it.get("content_domain") for it in items)
    total = sum(v for k, v in counts.items() if k in CONTENT_DOMAINS)
    unknown = {k: v for k, v in counts.items() if k not in CONTENT_DOMAINS}
    info["domain_counts"] = dict(counts)
    info["domain_total"] = total

    if unknown:
        errors.append({"check": "distribution", "code": "unknown_domain_present", "detail": unknown})
    if total != DOMAIN_TOTAL:
        warnings.append({"check": "distribution", "code": "unexpected_total",
                         "detail": "有效题数 %d，期望 %d" % (total, DOMAIN_TOTAL)})
    for dom, want in CONTENT_DOMAINS.items():
        got = counts.get(dom, 0)
        if abs(got - want) > DOMAIN_TOLERANCE:
            errors.append({"check": "distribution", "code": "domain_off_target",
                           "detail": "%s: %d 题，期望 %d（容差 ±%d）" % (dom, got, want, DOMAIN_TOLERANCE)})

    info["difficulty_counts"] = dict(Counter(it.get("difficulty") for it in items))
    info["question_type_counts"] = dict(Counter(it.get("question_type") for it in items))

    stim = [it.get("id") for it in items if it.get("stimulus")]
    design = [it.get("id") for it in items if "experimental design" in str(it.get("skill") or "").lower()]
    info["stimulus_item_ids"] = stim
    info["design_item_ids"] = design
    info["stimulus_item_count"] = len(stim)
    info["design_item_count"] = len(design)
    if len(stim) + len(design) < 4:
        warnings.append({"check": "distribution", "code": "few_data_or_design_items",
                         "detail": "图表题/实验设计题合计 %d 题，本科差异化要求至少 3–4 题" % (len(stim) + len(design))})
    multi = info["question_type_counts"].get("multiple-select", 0)
    if not (0.05 * total <= multi <= 0.15 * total):
        warnings.append({"check": "distribution", "code": "multiselect_share",
                         "detail": "multiple-select %d/%d，体例建议约 10%%" % (multi, total)})


# ---------------------------------------------------------------- [4] 干扰项解析

def check_distractor_explanations(items, errors, warnings, review_queue, info):
    lens = []
    for it in items:
        tag = it.get("id")
        ch = it.get("choices") or []
        ans = answer_list(it.get("correct_answer"))
        distractors = [c for c in ch if c not in ans]
        dex = it.get("distractor_explanations")

        if not isinstance(dex, dict):
            errors.append({"item": tag, "check": "distractors", "code": "dex_missing",
                           "detail": "distractor_explanations 必须为对象（硬约束：逐干扰项写解析）"})
            continue

        keys, want = set(dex.keys()), set(distractors)
        if keys != want:
            errors.append({"item": tag, "check": "distractors", "code": "dex_keys_mismatch",
                           "detail": "键与干扰项不一致；多出=%s 缺少=%s" % (sorted(keys - want), sorted(want - keys)),
                           "note": "键必须是干扰项选项原文，与 choices 逐字一致，且不含正确答案"})
        if len(dex) != 3:
            errors.append({"item": tag, "check": "distractors", "code": "dex_count",
                           "detail": "恰好 3 条，实际 %d 条" % len(dex)})

        for k, v in dex.items():
            if not isinstance(v, str) or not v.strip():
                errors.append({"item": tag, "check": "distractors", "code": "dex_empty", "detail": k})
                continue
            n = len(v)
            lens.append(n)
            if not (DEX_MIN <= n <= DEX_MAX):
                errors.append({"item": tag, "check": "distractors", "code": "dex_length",
                               "detail": "%d 字符（要求 %d–%d 字符）:: %s" % (n, DEX_MIN, DEX_MAX, v[:60])})
            if DEX_BAD_OPENERS.search(v):
                errors.append({"item": tag, "check": "distractors", "code": "dex_bad_opener",
                               "detail": "禁止以 'This is incorrect because…' / 'The correct answer is…' / 'The student…' 开头 :: %s" % v[:60]})
            if DEX_BANNED_PHRASES.search(v):
                errors.append({"item": tag, "check": "distractors", "code": "dex_boilerplate",
                               "detail": "空泛套话 :: %s" % v[:60]})
            # 与正确答案解析重复（整句重合 → 提示）
            if it.get("explanation") and v.strip() and v.strip() in str(it["explanation"]):
                warnings.append({"item": tag, "check": "distractors", "code": "dex_duplicates_explanation",
                                 "detail": "干扰项解析与 explanation 完全重合"})
        # 正确答案解析不得复述「答案为 X」这类空话
        de = it.get("explanation") or ""
        if len(de) < 80:
            warnings.append({"item": tag, "check": "distractors", "code": "explanation_short",
                             "detail": "%d 字符，可能讲不清" % len(de)})

    if lens:
        info["dex_length_min"] = min(lens)
        info["dex_length_max"] = max(lens)
        info["dex_length_avg"] = round(sum(lens) / len(lens), 1)
        info["dex_total"] = len(lens)
    if not errors:
        review_queue.append({"item": "(全批)", "reason": "干扰项解析的「教学正确性」无法自动判定",
                             "action": "逐条人工确认：① 是否真的点出该选项的错误 ② 有没有把对的写成错的（科学事实）"})


# ---------------------------------------------------------------- [5] 科学内容红线

def check_science_redlines(items, errors, warnings, review_queue, info):
    hits = {"stimulus_missing": [], "discredited": [], "wrong_format": [], "score_claim": [],
            "official_claim": [], "value_judgment": [], "bias": [], "copyright": []}
    numeric_facts = []

    for it in items:
        tag = it.get("id")
        stem = str(it.get("stem") or "")
        expl = str(it.get("explanation") or "")
        dex = it.get("distractor_explanations") or {}
        blob = " ".join([str(it.get("stimulus") or ""), stem, expl,
                         " ".join(str(v) for v in dex.values())])

        if STIMULUS_REF_PAT.search(stem) and not it.get("stimulus"):
            hits["stimulus_missing"].append({"item": tag, "matched": STIMULUS_REF_PAT.search(stem).group(0)})
        if DISCREDITED_PAT.search(blob):
            hits["discredited"].append(tag)
        if WRONG_FORMAT_PAT.search(blob):
            hits["wrong_format"].append(tag)
        if SCORE_CLAIM_PAT.search(blob):
            hits["score_claim"].append(tag)
        if OFFICIAL_CLAIM_PAT.search(blob):
            hits["official_claim"].append(tag)
        if VALUE_JUDGMENT_PAT.search(blob):
            hits["value_judgment"].append(tag)
        if BIAS_PAT.search(blob):
            hits["bias"].append(tag)
        if COPYRIGHT_PAT.search(blob):
            hits["copyright"].append(tag)

        for m in UNIT_HINT_PAT.finditer(blob):
            numeric_facts.append({"item": tag, "value": m.group(0).strip()})

        # 变量控制：涉及独立变量就必须同时交代因变量与受控条件
        low = blob.lower()
        if "independent variable" in low:
            if "dependent variable" not in low or not any(t in low for t in
                                                          ("controlled variable", "control group", "held constant", "same in every")):
                review_queue.append({"item": tag, "reason": "出现 independent variable 但未同时交代 dependent variable / 受控条件",
                                     "action": "人工确认变量控制表述完整且自洽（红线：不得把对照组与受控变量说反）"})
        if "control group" in low and not any(t in low for t in
                                             ("controlled variable", "held constant", "same in every", "baseline")):
            review_queue.append({"item": tag, "reason": "提到 control group 但未见与其对照的受控变量/基线表述",
                                 "action": "人工确认 control group（对照组）与 controlled variable（受控变量）没有混用"})

    # 硬红线
    if hits["stimulus_missing"]:
        errors.append({"check": "redline", "code": "missing_stimulus",
                       "detail": "题干引用外部材料但 stimulus 为空 —— 用户看不到材料，废题",
                       "items": hits["stimulus_missing"][:10]})
    if hits["discredited"]:
        errors.append({"check": "redline", "code": "discredited_claim", "items": hits["discredited"],
                       "detail": "出现被证伪的第三方口径（100-300 尺度 / 合格分 240）"})
    if hits["wrong_format"]:
        errors.append({"check": "redline", "code": "wrong_test_format", "items": hits["wrong_format"],
                       "detail": "出现与 8005 不符的考试格式（8005 = 90 分钟 / 74 题）"})
    if hits["score_claim"]:
        errors.append({"check": "redline", "code": "score_claim", "items": hits["score_claim"],
                       "detail": "不得承诺或暗示 scaled score 换算 —— ETS 未公布 8005 换算表"})
    if hits["copyright"]:
        errors.append({"check": "redline", "code": "copyright_risk", "items": hits["copyright"],
                       "detail": "可能引用真实出版物原文"})

    # 非硬红线 → 人工队列
    for key, reason, action in [
        ("official_claim", "出现 'ETS states/requires' 类表述",
         "人工确认确有官方依据；无依据一律改 source_basis = expert-judgment"),
        ("value_judgment", "争议议题出现价值判断/贬损词",
         "人工确认采用标准科学教材口径，不做价值判断（进化论、气候变化等）"),
        ("bias", "敏感表述启发式命中", "人工通读确认是否为刻板印象或群体归因"),
    ]:
        if hits[key]:
            review_queue.append({"item": ",".join(hits[key][:10]), "reason": reason, "action": action})

    info["redline_hits"] = {k: len(v) for k, v in hits.items()}
    info["numeric_fact_mentions"] = numeric_facts
    info["numeric_fact_sample"] = numeric_facts[:40]


# ---------------------------------------------------------------- [6] 页面口径守卫

def _sentences(text):
    return re.split(r"(?<=[.!?])\s+", text)


def _claim_is_refuted(text, match, negations=("does not", "do not", "is not", "are not", "wrong",
                                              "refut", "myth", "not repeat", "never")):
    """
    判断某处命中是否处于「反驳口径」的句子里。
    8006/8004 页都有一句固定的反诈提示：「That the 8000 series uses a 100–300 scale with a 240
    passing score. It does not.」——把这种「点名辟谣」误判为违规，会让守卫失去意义。
    故按句判断：命中所在句若含否定/辟谣词，则降级为提示，不阻断。
    """
    for s in _sentences(text):
        if match.group(0) in s and any(n in s.lower() for n in negations):
            return True
    return False


def check_pages(errors, warnings, review_queue, info):
    report = {}
    for name, path in PAGES.items():
        page = {"path": path, "exists": os.path.exists(path)}
        if not os.path.exists(path):
            warnings.append({"check": "pages", "code": "page_missing", "detail": path})
            report[name] = page
            continue
        with open(path, "r", encoding="utf-8") as f:
            html = f.read()
        # 去掉结构化数据与注释，只查可见文案
        body = re.sub(r"<script[^>]*type=\"application/ld\+json\"[^>]*>[\s\S]*?</script>", " ", html)
        body = re.sub(r"<!--[\s\S]*?-->", " ", body)

        # (a) 不得给精确的 8005 领域题量
        bad_domain_counts = []
        for pat in DOMAIN_COUNT_PAT:
            for m in pat.finditer(body):
                bad_domain_counts.append(m.group(0).strip()[:120])
        page["domain_count_claims"] = bad_domain_counts
        if bad_domain_counts:
            errors.append({"check": "pages", "code": "precise_domain_count",
                           "detail": "8005 领域题量为 triangulated，页面不得给精确断言", "page": path,
                           "samples": bad_domain_counts[:5]})

        # (b) 被证伪口径（点名辟谣的句子不算）/ 把 100 分钟安到 8005 头上
        refuted = []
        asserted = []
        for m in DISCREDITED_PAT.finditer(body):
            (refuted if _claim_is_refuted(body, m) else asserted).append(m.group(0))
        page["discredited_refuted"] = refuted
        page["discredited_asserted"] = asserted
        if asserted:
            errors.append({"check": "pages", "code": "page_discredited_claim", "page": path,
                           "detail": asserted[:5]})

        # 只有当 100 分钟被安到 8005 头上时才算错。
        # 允许两种合法用法：① 句子里的 100 分钟明确属于其它科目（other four / 8002 / 8006 …）
        #                  ② 8005 出现在 100 分钟之后、且句中有其它科目作对照
        OTHER_TEST_CTX = re.compile(r"(other four|other tests|the others|8002|8003|8004|8006|5001|5005)", re.I)
        wrong_len = []
        for m in re.finditer(r"100\s*(?:minutes|min)\b", body, re.I):
            for s in _sentences(body):
                if m.group(0) not in s:
                    continue
                before = s[:s.find(m.group(0))]
                misattributed = bool(re.search(r"(8005|this test)", before, re.I))
                if misattributed or not OTHER_TEST_CTX.search(s):
                    wrong_len.append(s.strip()[:140])
                break
        page["wrong_length_100min"] = wrong_len
        if wrong_len:
            errors.append({"check": "pages", "code": "page_wrong_length", "page": path,
                           "detail": "把 100 分钟安到 8005 上 —— 8005 是 90 分钟（其余四科才是 100）",
                           "samples": wrong_len[:3]})

        # (c) 必写事实（已 confirmed 的格式事实，两页都要写清）
        page["has_90min"] = bool(re.search(r"90[-\s]?minute", body, re.I))
        page["has_74"] = bool(re.search(r"\b74\b", body))
        page["has_calculator"] = bool(re.search(r"scientific calculator", body, re.I))
        for k, label in (("has_90min", "90 分钟"), ("has_74", "74 题"), ("has_calculator", "科学计算器")):
            if not page[k]:
                errors.append({"check": "pages", "code": "page_missing_fact", "page": path,
                               "detail": "页面未出现已确认事实：%s" % label})

        # (d) 内链
        page["links"] = {t: bool(re.search(re.escape(t), body)) for t in
                         ("/praxis-elementary-education-fundamentals",
                          "/praxis-5005-science-study-guide",
                          "/praxis-8005-science",
                          "/praxis-8005-practice")}
        required = (["/praxis-elementary-education-fundamentals", "/praxis-5005-science-study-guide",
                     "/praxis-8005-practice"] if name == "guide" else
                    ["/praxis-elementary-education-fundamentals", "/praxis-5005-science-study-guide",
                     "/praxis-8005-science"])
        for t in required:
            if not page["links"][t]:
                errors.append({"check": "pages", "code": "missing_internal_link", "page": path,
                               "detail": "缺少内链 %s" % t})

        # (e) FAQ 段内 h3 与 FAQPage 结构化数据条数一致（只看 FAQ 段，其它章节的 h3 不计）
        faq_body = body
        m1 = re.search(r"<h2>\s*Frequently Asked Questions\s*</h2>", body)
        m2 = re.search(r"<h2>\s*Official Sources\s*</h2>", body)
        if m1 and m2 and m2.start() > m1.start():
            faq_body = body[m1.end():m2.start()]
        n_ld = 0
        for blob in re.findall(r"<script[^>]*type=\"application/ld\+json\"[^>]*>([\s\S]*?)</script>", html):
            try:
                data = json.loads(blob)
            except Exception:
                errors.append({"check": "pages", "code": "bad_jsonld", "page": path,
                               "detail": "JSON-LD 解析失败"})
                continue
            if data.get("@type") == "FAQPage":
                n_ld = len(data.get("mainEntity", []))
        n_h3 = len(re.findall(r"<h3[^>]*>", faq_body))
        page["faq_h3"] = n_h3
        page["faq_jsonld"] = n_ld
        if n_ld and n_h3 and n_ld != n_h3:
            errors.append({"check": "pages", "code": "faq_mismatch", "page": path,
                           "detail": "可见 FAQ 条目 %d 条，FAQPage 结构化数据 %d 条" % (n_h3, n_ld)})

        # (f) script 配平 + GA 片段（与 tools/check-ga-coverage.mjs 同口径的轻量复核）
        page["script_open"] = len(re.findall(r"<script\b", html))
        page["script_close"] = len(re.findall(r"</script>", html))
        if page["script_open"] != page["script_close"]:
            errors.append({"check": "pages", "code": "script_unbalanced", "page": path,
                           "detail": "script 标签不配平：%d 开 / %d 闭" % (page["script_open"], page["script_close"])})
        page["has_ga"] = bool(re.search(r'googletagmanager\.com/gtag/js\?id=G-MSR1Q1G7W9', html))

        report[name] = page

    info["pages"] = report


# ---------------------------------------------------------------- 主流程

def main():
    ap = argparse.ArgumentParser(description="Praxis 8005 题目验收器（D11）")
    ap.add_argument("items", nargs="?", default=DEFAULT_ITEMS_JS,
                    help="题目文件（.js / .json / .jsonl），默认 %s" % DEFAULT_ITEMS_JS)
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

    check_schema(items, errors, warnings, review_queue, info)
    check_duplicates(items, args.legacy, errors, warnings, info)
    check_distribution(items, errors, warnings, info)
    check_distractor_explanations(items, errors, warnings, review_queue, info)
    check_science_redlines(items, errors, warnings, review_queue, info)
    check_pages(errors, warnings, review_queue, info)

    ok = not errors
    report = {"verdict": "PASS" if ok else "FAIL", "source_file": info["source_file"],
              "item_count": info["item_count"], "errors": errors, "warnings": warnings,
              "human_review_queue": review_queue, "info": info}

    print("=" * 70)
    print("Praxis 8005 题目验收报告（D11 · Science）")
    print("=" * 70)
    print("输入文件 : %s" % info["source_file"])
    print("题目数量 : %d" % info["item_count"])
    print("存量比对 : %d 题%s" % (info.get("legacy_items_loaded", 0),
                                 "（未执行：文件缺失）" if info.get("cross_series_duplicates") is None else ""))
    print("结论     : %s" % ("✅ PASS（含 warning）" if ok else "❌ FAIL —— 存在阻断项"))
    print()

    print("── [1] schema 校验（%d 字段）──" % FIELD_COUNT)
    print("  阻断项 %d｜完整性缺口 %d｜review_status %s"
          % (len([e for e in errors if e.get("check") == "schema"]),
             len([w for w in warnings if w.get("check") == "completeness"]),
             info.get("review_status_counts")))
    print()
    print("── [2] 去重 ──")
    print("  批内精确重复 %d｜跨系列重复 %s｜近似重复嫌疑 %d（待抽查）｜hash 复算不一致 %d"
          % (info["intra_batch_duplicates"], info["cross_series_duplicates"],
             info["near_duplicates"], info["hash_mismatch_count"]))
    print()
    print("── [3] 领域分布（题量比例为 triangulated，仅作均衡性检查）──")
    for dom, want in CONTENT_DOMAINS.items():
        got = info["domain_counts"].get(dom, 0)
        flag = "  " if abs(got - want) <= DOMAIN_TOLERANCE else "←偏离"
        print("  %-26s %3d / %-3d %s" % (dom, got, want, flag))
    print("  图表题（带 stimulus）%d 题｜实验设计题 %d 题｜题型 %s"
          % (info["stimulus_item_count"], info["design_item_count"], info["question_type_counts"]))
    print("  难度 %s" % info["difficulty_counts"])
    print()
    print("── [4] 干扰项解析（硬约束：恰好 3 条）──")
    print("  解析条数 %d｜长度 min %s / avg %s / max %s 字符"
          % (info.get("dex_total", 0), info.get("dex_length_min"), info.get("dex_length_avg"),
             info.get("dex_length_max")))
    print()
    print("── [5] 科学内容红线 ──")
    rh = info["redline_hits"]
    print("  硬红线：缺 stimulus %d｜被证伪口径 %d｜错格式 %d｜scaled score 承诺 %d｜版权 %d"
          % (rh["stimulus_missing"], rh["discredited"], rh["wrong_format"], rh["score_claim"], rh["copyright"]))
    print("  人工必看：官方口径表述 %d｜价值判断 %d｜刻板印象 %d"
          % (rh["official_claim"], rh["value_judgment"], rh["bias"]))
    print("  含数值+单位的表述 %d 处（抽样 8 条，全部进人工复核清单）" % len(info["numeric_fact_mentions"]))
    for nf in info["numeric_fact_sample"][:8]:
        print("    · %s :: %s" % (nf["item"], nf["value"]))
    print()
    print("── [6] 页面口径守卫 ──")
    for name, page in info["pages"].items():
        if not page.get("exists"):
            print("  %-9s ✗ 页面缺失：%s" % (name, page["path"]))
            continue
        print("  %-9s 领域题量精确断言 %d｜100min 出现 %d｜90min %s｜74 %s｜计算器 %s｜FAQ h3 %s / JSON-LD %s｜script %d/%d"
              % (name, len(page["domain_count_claims"]), len(page["wrong_length_100min"]),
                 page["has_90min"], page["has_74"], page["has_calculator"],
                 page["faq_h3"], page["faq_jsonld"], page["script_open"], page["script_close"]))

    if errors:
        print()
        print("── 阻断项明细 ──")
        for e in errors[:40]:
            print("  ✗ [%s] %s :: %s" % (e.get("code"), e.get("item", e.get("page", "-")),
                                          str(e.get("detail"))[:130]))
    if warnings:
        print()
        print("── warning ──")
        for w in warnings[:20]:
            print("  · [%s] %s :: %s" % (w.get("code"), w.get("item", w.get("page", "-")),
                                          str(w.get("detail"))[:110]))

    print()
    print("── 人工复核队列（脚本无法替代）──")
    print("  共 %d 条" % len(review_queue))

    print()
    print("=" * 70)
    print("提醒：本脚本只做机械可判部分。「零自动失败」不等于内容合格 ——")
    print("      科学事实（单位、数据、概念）与干扰项解释的教学正确性必须由人逐条过。")
    print("=" * 70)

    if args.json_report:
        with open(args.json_report, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        print("\nJSON 报告已写入：%s" % args.json_report)

    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
