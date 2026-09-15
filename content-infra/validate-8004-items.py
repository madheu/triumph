#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
validate-8004-items.py — Praxis 8004 题目验收器（D10）

用途：验收 site/questions-8004.js 里那 30 道 mini test 题库（schema v1）。
      本脚本负责验收，不生产题目。

用法：
    python content-infra/validate-8004-items.py [题目文件] [--legacy <存量jsonl>] [--json-report out.json]

默认题目文件：site/questions-8004.js（从 window.DM_BANK_8004 = [...] 里取顶层数组）
默认存量比对：content-infra/items-5000-series.jsonl（969 题，D2 产出）

与 validate-8006-items.py 的差异（本科特有，均有官方或规格依据）：
    · 三大领域官方名与题量 33 / 23 / 21，30 题样本按比例取 13 / 9 / 8
    · multiple-select 的**本科专属体例**：题干必须是 "Which TWO of the following"，
      **禁止** "Select all that apply"（依据 SC-8004 样题 1 / 8，schema v1 §8）
    · distractor_explanations 升级为 **blocking**：键必须与干扰项集合逐字一致、
      恰好 len(choices) - len(正确答案) 条、每条 60–200 字符（schema v1 §6）
    · 新增 B.C.E. / C.E. 纪年红线：官方 8004 材料用 B.C.E./C.E.，出现 BC/AD 即判错
    · 新增社会学科内容红线：政党、宗教、领土争议、种族、涉华表述一律进人工复核队列
    · 新增第三方培训机构来源扫描（Mometrix / Study.com 等不得当史实来源）

设计原则（继承 D2 / D5 教训）：
    · 独立复算，不信任输入。duplicate_hash 一律按 schema 定义重算并逐条比对。
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
REPO_ROOT = os.path.dirname(SCRIPT_DIR)
DEFAULT_ITEMS = os.path.join(REPO_ROOT, "site", "questions-8004.js")
DEFAULT_LEGACY = os.path.join(SCRIPT_DIR, "items-5000-series.jsonl")

TEST_CODE = 8004
SERIES = "8000"
SUBJECT = "Social Studies"

# 官方领域名 —— 逐字取自 content-infra/official-facts-8000-series.json
# ⚠️ 官方写法是 "and"（United States History, Government and Citizenship），不是 "&"。
CONTENT_DOMAINS = {
    "United States History, Government and Citizenship": 13,
    "Geography, Anthropology and Sociology": 9,
    "World History and Economics": 8,
}
OFFICIAL_DOMAIN_ITEMS = {
    "United States History, Government and Citizenship": 33,
    "Geography, Anthropology and Sociology": 23,
    "World History and Economics": 21,
}
DOMAIN_TOTAL = 30
# 偏离判定：任一领域 ±2 题内接受（30 题样本下 ±2 已是 6.7% 偏移），超出即退回。
DOMAIN_TOLERANCE = 2

# 8004 官方题型：全部 selected-response。multiple-select 是其中一种形态
# （SC-8004 样题 1 / 8），真正违禁的是 numeric-entry / constructed-response。
ALLOWED_QUESTION_TYPES = {"single-select", "multiple-select"}
FORBIDDEN_QUESTION_TYPES = {"numeric-entry", "constructed-response", "essay"}
MULTISELECT_CHOICE_COUNT = 5
MULTISELECT_ANSWER_COUNT = 2
MULTISELECT_STEM_RE = re.compile(r"Which TWO of the following")
BANNED_MULTISELECT_RE = re.compile(r"select all that apply", re.I)

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

# distractor_explanations 写法规范（schema v1 §6）
DEX_MIN_LEN, DEX_MAX_LEN = 60, 200
DEX_BANNED_OPENERS = re.compile(
    r"^\s*(this is (incorrect|wrong) because|this is not|the correct answer is|"
    r"this option is (incorrect|wrong)|the student)",
    re.I,
)
DEX_VAGUE = re.compile(r"is not the best (choice|answer)|is incorrect\b", re.I)

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

# ---- 社会学科内容红线（本科专属）------------------------------------------
# 说明：这些命中**不自动判错**，一律进人工复核队列。
# 依据：D10 任务书红线 —— 政党立场、领土争议、宗教、种族一律回避或采用最中立
# 官方教科书口径；涉华内容按中华人民共和国官方立场表述（台湾/香港/澳门不可表述
# 为独立国家）。题库当前不应出现任何一类，命中即说明有人在扩题时越界。
PARTISAN_PAT = re.compile(
    r"\b(democrat|republican|whig party|federalist party|tory|"
    r"liberal|conservative|left[- ]wing|right[- ]wing|"
    r"vote for|ballot measure|party platform)\b", re.I)
RELIGION_PAT = re.compile(
    r"\b(christian|muslim|jewish|hindu|buddhist|catholic|protestant|islam|judaism|"
    r"church|mosque|synagogue|bible|quran|koran|gospel|creationism)\b", re.I)
TERRITORY_PAT = re.compile(
    r"\b(taiwan|hong kong|macau|macao|tibet|xinjiang|israel|palestine|gaza|west bank|"
    r"crimea|kashmir|kuril|disputed territory|sovereignty over)\b", re.I)
ETHNICITY_PAT = re.compile(
    r"\b(black|white|asian|hispanic|latino|african american|caucasian|"
    r"race relations|racial|ethnic group|minority group)\b", re.I)
CHINA_PAT = re.compile(r"\b(china|chinese|prc|beijing)\b", re.I)
# 第三方培训机构：不得作为史实来源
THIRD_PARTY_PAT = re.compile(
    r"\b(mometrix|study\.com|studies weekly|prepsaret|240 ?tutoring|apexteachers|"
    r"teacherstestprep|cirrus|kaplan|princeton review|quizlet|wikipedia)\b", re.I)
# 已被官方州页否证的错误口径（official-facts-8000-series.json · discredited_claims）
DISCREDITED_PAT = re.compile(
    r"(100\s*[-–]\s*300|100\s*to\s*300|passing score of 240|qualifying score of 240|"
    r"\b240\b\s*(is the|passing|qualifying))", re.I)
# scaled score 承诺：8004 无官方换算表，任何换算承诺都是编的
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
# 纪年红线：官方 8004 材料用 B.C.E. / C.E.，不得用 BC / AD
# ⚠️ 必须先把合法的 B.C.E. / C.E. 整词摘掉再扫，否则 "B.C." 会被当成
#    "B.C.E." 的子串而误报（2026-09-15 实测：30 题全用 B.C.E.，
#    朴素正则把 1 道题错判成 BC/AD 违例）。
BCE_CE_TOKENS = (re.compile(r"\bB\.?\s?C\.?\s?E\.?\b", re.I), re.compile(r"\bC\.?\s?E\.?\b", re.I))
BC_AD_PAT = re.compile(r"\b(B\.?C\.?|A\.?D\.?)\b")
# 解析里引用选项字母 → 与 duplicate_hash 的顺序无关设计冲突
OPTION_LETTER_PAT = re.compile(r"\b(option|choice|answer)\s+[A-E]\b", re.I)


# ---------------------------------------------------------------- 工具函数

def normalize(t):
    """schema duplicate_hash_algorithm 步骤 1：小写 + 移除非 [a-z0-9] 全部字符"""
    return re.sub(r"[^a-z0-9]", "", str(t).lower())


def choice_text(c):
    """选项统一取文本：支持 str 与 {key, text} 对象两种交付形态"""
    if isinstance(c, dict):
        return str(c.get("text", ""))
    return str(c)


def compute_duplicate_hash(stem, choices):
    """
    schema duplicate_hash_algorithm：
      parts = [normalize(stem)] + sorted(normalize(choices))
      payload = "|".join(parts)
      hash = sha256(payload).hexdigest()
    与 Node 侧实现保持一致（映射脚本与校验脚本必须共用同一实现）。
    """
    parts = [normalize(stem)] + sorted(normalize(choice_text(c)) for c in choices)
    return hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()


def extract_bank(raw):
    """
    从 site/questions-8004.js 抽出顶层数组。
    只认 window.DM_BANK_8004 = [...]；抽不到就报错，**不做模糊猜测**（避免把注释
    里的示例当成题库）。
    """
    m = re.search(r"window\.DM_BANK_8004\s*=\s*(\[.*\])\s*;", raw, re.S)
    if not m:
        raise ValueError("未找到 window.DM_BANK_8004 = [...] 顶层数组")
    return json.loads(m.group(1))


def load_items(path):
    """支持 .js（题库产物）/ .jsonl（每行一题）/ .json（顶层数组或 {items:[...]}）"""
    if not os.path.exists(path):
        raise FileNotFoundError(path)
    with open(path, "r", encoding="utf-8") as f:
        raw = f.read().strip()
    if not raw:
        return [], []
    if path.lower().endswith(".js"):
        return extract_bank(raw), []
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


def approx_dupe(a, b):
    """近似查重：题干词集包含度 ≥85%（D2 校验器同款思路）。精确哈希抓不到改词重复。"""
    wa = set(normalize(a).split())
    wb = set(normalize(b).split())
    if not wa or not wb:
        return False
    inter = len(wa & wb)
    return (inter / len(wa) >= 0.85) or (inter / len(wb) >= 0.85)


def answer_list(ca):
    return ca if isinstance(ca, list) else ([ca] if ca is not None else [])


def find_bc_ad(blob):
    """
    摘掉合法的 B.C.E. / C.E. 整词后再找 BC / AD 纪年写法。
    返回匹配串或 None。顺序不能颠倒：先摘 B.C.E. 再摘 C.E.。
    """
    cleaned = blob
    for pat in BCE_CE_TOKENS:
        cleaned = pat.sub(" ", cleaned)
    m = BC_AD_PAT.search(cleaned)
    return m.group(0) if m else None


def item_blob(it):
    """把一题的全部文字拼起来，供红线扫描"""
    parts = [str(it.get(k) or "") for k in ("stimulus", "stem", "explanation")]
    parts += [choice_text(c) for c in (it.get("choices") or [])]
    de = it.get("distractor_explanations")
    if isinstance(de, dict):
        parts += [str(v) for v in de.values()]
    return " ".join(parts)


# ---------------------------------------------------------------- 各项检查

def check_schema(items, errors, warnings):
    """[1] schema 校验：字段齐全、类型正确、枚举合法、官方领域名逐字一致"""
    seen_ids = {}
    for idx, it in enumerate(items):
        tag = it.get("id", f"#<{idx}>")

        missing = [f for f in FIELD_ORDER if f not in it]
        if missing:
            errors.append({"item": tag, "check": "schema", "code": "missing_fields", "detail": missing})
        extra = [k for k in it if k not in FIELD_ORDER]
        if extra:
            errors.append({"item": tag, "check": "schema", "code": "extra_fields", "detail": extra})

        if it.get("test_code") != TEST_CODE:
            errors.append({"item": tag, "check": "schema", "code": "wrong_test_code",
                           "detail": f"expected {TEST_CODE}, got {it.get('test_code')!r}"})
        if it.get("series") != SERIES:
            errors.append({"item": tag, "check": "schema", "code": "wrong_series",
                           "detail": f"expected {SERIES}, got {it.get('series')!r}"})
        if it.get("subject") != SUBJECT:
            errors.append({"item": tag, "check": "schema", "code": "wrong_subject",
                           "detail": f"expected {SUBJECT!r}, got {it.get('subject')!r}"})

        if tag in seen_ids:
            errors.append({"item": tag, "check": "schema", "code": "duplicate_id",
                           "detail": f"first seen at index {seen_ids[tag]}"})
        else:
            seen_ids[tag] = idx

        for f in ("difficulty", "question_type", "source_basis", "review_status"):
            v = it.get(f)
            if v is not None and v not in ENUMS[f]:
                errors.append({"item": tag, "check": "schema", "code": "bad_enum",
                               "detail": f"{f}={v!r}, allowed={sorted(ENUMS[f])}"})

        qt = it.get("question_type")
        if qt in FORBIDDEN_QUESTION_TYPES:
            errors.append({"item": tag, "check": "schema", "code": "forbidden_question_type",
                           "detail": f"{qt!r} — 8004 官方 77 题全部为 selected-response，无此类题型"})

        cd = it.get("content_domain")
        if cd not in CONTENT_DOMAINS:
            err = {"item": tag, "check": "schema", "code": "bad_content_domain",
                   "detail": f"{cd!r} not an official 8004 domain"}
            if cd and "&" in str(cd):
                err["detail"] += "（注意：官方写法是 'and' 不是 '&'）"
            errors.append(err)

        # choices / correct_answer
        ch = it.get("choices")
        if not isinstance(ch, list) or len(ch) < 2:
            errors.append({"item": tag, "check": "schema", "code": "bad_choices",
                           "detail": f"choices must be a list of >=2, got {type(ch).__name__}"})
            continue
        texts = [choice_text(c) for c in ch]
        if len(set(texts)) != len(texts):
            errors.append({"item": tag, "check": "schema", "code": "duplicate_choices",
                           "detail": "choices 中存在完全相同的选项"})

        ca = it.get("correct_answer")
        ca_list = answer_list(ca)
        bad = [a for a in ca_list if a not in texts]
        if bad:
            errors.append({"item": tag, "check": "schema", "code": "correct_answer_not_in_choices",
                           "detail": f"correct_answer={bad!r} 不在 choices 中"})

        # 题型与答案结构一致性
        if qt == "multiple-select":
            if not isinstance(ca, list):
                errors.append({"item": tag, "check": "schema", "code": "multiselect_answer_not_list",
                               "detail": f"question_type=multiple-select 但 correct_answer={ca!r} 不是列表"})
            if len(ca_list) != MULTISELECT_ANSWER_COUNT:
                errors.append({"item": tag, "check": "schema", "code": "multiselect_answer_count",
                               "detail": f"correct_answer 有 {len(ca_list)} 项，官方体例要求恰好 {MULTISELECT_ANSWER_COUNT} 项"})
            if len(texts) != MULTISELECT_CHOICE_COUNT:
                errors.append({"item": tag, "check": "schema", "code": "multiselect_choice_count",
                               "detail": f"choices 有 {len(texts)} 项，官方体例要求 A–E 共 {MULTISELECT_CHOICE_COUNT} 项"})
            if not MULTISELECT_STEM_RE.search(str(it.get("stem", ""))):
                errors.append({"item": tag, "check": "schema", "code": "multiselect_stem_wording",
                               "detail": "题干未见官方写法 'Which TWO of the following'（schema v1 §8）"})
            if BANNED_MULTISELECT_RE.search(str(it.get("stem", ""))):
                errors.append({"item": tag, "check": "schema", "code": "multiselect_banned_wording",
                               "detail": "出现 'Select all that apply' —— 官方 8004 样例不用此写法，判错"})
        elif qt == "single-select" and isinstance(ca, list):
            errors.append({"item": tag, "check": "schema", "code": "singleselect_answer_is_list",
                           "detail": f"question_type=single-select 但 correct_answer={ca!r} 是列表"})

        # stem / explanation 非空
        for f in ("stem", "explanation"):
            v = it.get(f)
            if not isinstance(v, str) or not v.strip():
                errors.append({"item": tag, "check": "schema", "code": "empty_field", "detail": f})

        for f in ("created_at", "updated_at"):
            v = it.get(f)
            if v is not None and not ISO8601_RE.match(str(v)):
                errors.append({"item": tag, "check": "schema", "code": "bad_timestamp",
                               "detail": f"{f}={v!r}, expected ISO-8601 UTC (…Z)"})

        v = it.get("version")
        if not isinstance(v, int) or v < 1:
            errors.append({"item": tag, "check": "schema", "code": "bad_version", "detail": repr(v)})

        h = it.get("duplicate_hash")
        if h is not None and not HASH_RE.match(str(h)):
            errors.append({"item": tag, "check": "schema", "code": "bad_hash_format",
                           "detail": f"duplicate_hash={h!r} 不是 64 位小写 hex"})

        # 完整性缺口（warning，不阻断）
        for f in ("skill", "stimulus"):
            if it.get(f) is None:
                warnings.append({"item": tag, "check": "completeness", "code": f"{f}_null",
                                 "detail": f"{f} 为 null（skill / stimulus 允许为 null，仅登记）"})


def check_distractor_explanations(items, errors, warnings, review_queue, info):
    """
    [2] distractor_explanations —— 本科硬约束，**blocking**。
    8004 是五科中对干扰项解析要求最严的一科，缺一条即返工。
    依据 schema v1 §6：键 = 干扰项选项原文（逐字一致），不含正确答案；
    恰好 len(choices) - len(正确答案) 条；每条 60–200 字符。
    """
    per_item = {}
    for it in items:
        tag = it.get("id")
        ch = [choice_text(c) for c in (it.get("choices") or [])]
        ca_list = answer_list(it.get("correct_answer"))
        want = [c for c in ch if c not in ca_list]
        de = it.get("distractor_explanations")

        if not isinstance(de, dict):
            errors.append({"item": tag, "check": "distractor", "code": "dex_missing",
                           "detail": f"distractor_explanations 必须是对象，实为 {type(de).__name__}"})
            continue

        keys = list(de.keys())
        per_item[tag] = len(keys)

        if len(keys) != len(want):
            errors.append({"item": tag, "check": "distractor", "code": "dex_count",
                           "detail": f"{len(keys)} 条，应为 {len(want)} 条（choices {len(ch)} − 正确答案 {len(ca_list)}）"})
        missing = [w for w in want if w not in de]
        if missing:
            errors.append({"item": tag, "check": "distractor", "code": "dex_key_missing",
                           "detail": f"缺键（须与干扰项逐字一致）：{missing}"})
        not_distractor = [k for k in keys if k not in want]
        if not_distractor:
            code = "dex_key_is_correct_answer" if any(k in ca_list for k in not_distractor) else "dex_key_not_a_choice"
            errors.append({"item": tag, "check": "distractor", "code": code,
                           "detail": f"键不在干扰项集合内：{not_distractor}"})

        for k, v in de.items():
            if not isinstance(v, str) or not v.strip():
                errors.append({"item": tag, "check": "distractor", "code": "dex_empty", "detail": k})
                continue
            n = len(v)
            if n < DEX_MIN_LEN or n > DEX_MAX_LEN:
                errors.append({"item": tag, "check": "distractor", "code": "dex_length",
                               "detail": f"{n} 字符（要求 {DEX_MIN_LEN}–{DEX_MAX_LEN}）：{k[:50]}…"})
            if DEX_BANNED_OPENERS.search(v):
                errors.append({"item": tag, "check": "distractor", "code": "dex_banned_opener",
                               "detail": f"以套话开头，应用第三人称动词直接点错误：{v[:60]}…"})
            if DEX_VAGUE.search(v):
                warnings.append({"item": tag, "check": "distractor", "code": "dex_vague",
                                 "detail": f"疑似空泛套话（is not the best / is incorrect）：{v[:60]}…"})
            if v.strip() == str(it.get("explanation", "")).strip():
                errors.append({"item": tag, "check": "distractor", "code": "dex_duplicates_explanation",
                               "detail": "干扰项解析与正确答案解析完全相同"})

    info["distractor_counts"] = per_item
    info["distractor_total"] = sum(per_item.values())
    info["distractor_incomplete_items"] = [k for k, v in per_item.items() if v != 3]


def check_duplicates(items, legacy_path, errors, warnings, info):
    """[3] 去重：独立复算 hash，批内 + 与 969 题存量跨系列比对"""
    recomputed, hash_mismatch = {}, []
    for it in items:
        h = compute_duplicate_hash(it.get("stem", ""), it.get("choices") or [])
        recomputed[it.get("id", "")] = h
        declared = it.get("duplicate_hash")
        if declared and declared != h:
            hash_mismatch.append({"item": it.get("id"), "declared": declared, "recomputed": h,
                                  "note": "输入文件自带的 hash 与独立复算不一致 —— 以复算值为准"})

    if hash_mismatch:
        errors.append({"check": "dedupe", "code": "hash_mismatch", "count": len(hash_mismatch),
                       "samples": hash_mismatch[:5],
                       "detail": "duplicate_hash 必须与独立复算一致（不信任输入值）"})

    by_hash = {}
    for iid, h in recomputed.items():
        by_hash.setdefault(h, []).append(iid)
    intra = {h: ids for h, ids in by_hash.items() if len(ids) > 1}
    for h, ids in intra.items():
        errors.append({"check": "dedupe", "code": "intra_batch_duplicate",
                       "detail": f"{len(ids)} 题共享 duplicate_hash {h[:12]}…", "items": ids})
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
                           "detail": f"{len(cross)} 题与存量 969 题重复", "items": cross[:20]})
        info["legacy_items_loaded"] = len(legacy_items)
        info["cross_series_duplicates"] = len(cross)
    else:
        info["legacy_items_loaded"] = 0
        info["cross_series_duplicates"] = None
        warnings.append({"check": "dedupe", "code": "legacy_missing",
                         "detail": f"存量题库 {legacy_path} 不存在，跨系列查重未执行"})

    stems = [(it.get("id", ""), it.get("stem", "")) for it in items]
    near = []
    for i in range(len(stems)):
        for j in range(i + 1, len(stems)):
            if approx_dupe(stems[i][1], stems[j][1]):
                near.append({"a": stems[i][0], "b": stems[j][0]})
    if near:
        warnings.append({"check": "dedupe", "code": "near_duplicate_suspect", "count": len(near),
                         "samples": near[:5],
                         "note": "启发式判定（词集包含度 ≥85%），必须人工看原文确认"})
    info["near_duplicates"] = len(near)


def check_distribution(items, errors, warnings, review_queue, info):
    """[4] 领域分布：30 题应为 13 / 9 / 8（官方 33 / 23 / 21 的等比抽样）"""
    counts = Counter(it.get("content_domain") for it in items)
    total = sum(v for k, v in counts.items() if k in CONTENT_DOMAINS)
    unknown = {k: v for k, v in counts.items() if k not in CONTENT_DOMAINS}

    info["domain_counts"] = dict(counts)
    info["domain_total"] = total
    info["official_domain_items"] = OFFICIAL_DOMAIN_ITEMS

    if unknown:
        errors.append({"check": "distribution", "code": "unknown_domain_present", "detail": unknown})

    if total != DOMAIN_TOTAL:
        errors.append({"check": "distribution", "code": "unexpected_total",
                       "detail": f"有效题数 {total}，预期 {DOMAIN_TOTAL}"})

    for dom, want in CONTENT_DOMAINS.items():
        got = counts.get(dom, 0)
        if abs(got - want) > DOMAIN_TOLERANCE:
            errors.append({"check": "distribution", "code": "domain_off_target",
                           "detail": f"{dom}: {got} 题，预期 {want}（容差 ±{DOMAIN_TOLERANCE}）"})

    info["difficulty_counts"] = dict(Counter(it.get("difficulty") for it in items))
    info["question_type_counts"] = dict(Counter(it.get("question_type") for it in items))
    info["source_basis_counts"] = dict(Counter(it.get("source_basis") for it in items))
    info["review_status_counts"] = dict(Counter(it.get("review_status") for it in items))

    # multiple-select 占比：官方 8004 含多选，但未公布比例；只报数，不判达标
    ms = [it.get("id") for it in items if it.get("question_type") == "multiple-select"]
    info["multiple_select_count"] = len(ms)
    info["multiple_select_ids"] = ms
    if not ms:
        errors.append({"check": "distribution", "code": "no_multiple_select",
                       "detail": "8004 是五科中唯一有官方多选实例的科，题库必须含 multiple-select 题"})

    # Tasks of Teaching 占比：官方 10–15%，但正则召回率低，只出候选不判定
    TEACHING_PAT = re.compile(
        r"\b(Ms\.|Mr\.|Mrs\.|the teacher|your students|a student|the class|"
        r"grade \d|first[- ]grade|second[- ]grade|third[- ]grade|fourth[- ]grade|fifth[- ]grade|"
        r"small group|whole[- ]class|lesson plan|during (a|the) lesson|A class|A teacher)\b", re.I)
    scen = [it.get("id") for it in items if TEACHING_PAT.search(str(it.get("stem", "")))]
    info["teaching_scenario_candidates"] = {
        "count": len(scen), "ids": scen, "official_target": "10–15%（ETS 官方口径）",
        "usage": "候选列表，非统计结果。正则召回率低，不得据此计算占比或判定达标",
    }
    review_queue.append({
        "item": "(全批)",
        "reason": "教学情境题（Tasks of Teaching）占比需人工确认",
        "action": f"通读全部 {total} 题，人工判定哪些属于教学情境题，确认占比落在官方 10–15% 区间。"
                  f"正则给出 {len(scen)} 个候选（{scen[:6]}{'…' if len(scen) > 6 else ''}），仅作起点",
    })


def check_answers(items, errors, warnings, review_queue, info):
    """[5] 答案交叉检查 + 事实复核清单（本科核心：历史/政府/公民概念零容忍）"""
    auto_flags = 0
    for it in items:
        tag = it.get("id")
        texts = [choice_text(c) for c in (it.get("choices") or [])]
        ca_list = answer_list(it.get("correct_answer"))
        stem = str(it.get("stem", ""))
        qt = it.get("question_type")

        if qt == "multiple-select":
            review_queue.append({"item": tag,
                                 "reason": f"multiple-select，标注答案 {', '.join(map(str, ca_list))}",
                                 "action": "人工独立重做：每一项都成立，且没有漏掉任何成立的选项"})
            auto_flags += 1

        # 绝对化表述常是干扰项而非答案（仅提示）
        absolute = [t for t in texts if re.match(r"^\s*(all|none|never|always|only)\b", t, re.I)]
        for a in ca_list:
            if a in absolute:
                review_queue.append({"item": tag,
                                     "reason": f"correct_answer 含绝对化表述 {a!r}",
                                     "action": "人工确认是否唯一合理答案；绝对化选项通常是干扰项"})
                auto_flags += 1

        if any(re.search(r"\b(all|none) of the above\b", t, re.I) for t in texts):
            review_queue.append({"item": tag, "reason": "含 all/none of the above 选项",
                                 "action": "人工确认其余选项确实全对/全错"})
            auto_flags += 1

        if re.search(r"\b(NOT|EXCEPT|LEAST|incorrect)\b", stem):
            review_queue.append({"item": tag, "reason": "否定式题干（NOT/EXCEPT/LEAST）",
                                 "action": "重点核验：是否存在第二个同样成立的选项"})
            auto_flags += 1

        # 事实核验提示：本科的历史日期、政府结构、公民概念必须人工逐条过
        if re.search(r"\b(1[0-9]{3}|20[0-2][0-9])\b", stem) or re.search(r"\b(1[0-9]{3}|20[0-2][0-9])\b", str(it.get("explanation", ""))):
            review_queue.append({"item": tag, "reason": "题干或解析中出现具体年份",
                                 "action": "人工核对该年份与所涉事件；年份写错一次整站可信度受损"})
            auto_flags += 1

        # 选项长度异常：正确选项显著长于其他选项，往往是凑出来的（仅单选可判）
        if not isinstance(it.get("correct_answer"), list) and it.get("correct_answer") in texts:
            lens = [len(t) for t in texts]
            ci = texts.index(it.get("correct_answer"))
            others = [l for i, l in enumerate(lens) if i != ci]
            if others and lens[ci] > (sum(others) / len(others)) * 2:
                review_queue.append({"item": tag, "reason": "正确选项长度显著超过其他选项（>2 倍均值）",
                                     "action": "人工确认是否因长度泄露答案"})
                auto_flags += 1

        # 选项间语义高度重叠 —— 第二个合理答案的高发场景
        norms = [normalize(t) for t in texts]
        for i in range(len(norms)):
            for j in range(i + 1, len(norms)):
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
                                   "判断是否存在第二个合理答案必须由人独立完成一遍"})


def check_stem_completeness(items, errors, warnings, review_queue, info):
    """[6] 题干缺条件：外部图表引用 / 禁用题型 / 指代缺失 / 选项字母引用"""
    stimulus_ref, dangling, forbidden, letter_ref = [], [], [], []

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
                               "detail": f"题干引用外部材料（{m.group(0)}）但 stimulus 字段为空 —— 用户看不到材料，废题"})
            else:
                review_queue.append({"item": tag, "reason": "题干引用外部材料，stimulus 字段已填",
                                     "action": "人工确认 stimulus 内容确实完整呈现了题干所需的材料"})

        if DANGLING_REF_PAT.search(stem) and not stim:
            dangling.append({"item": tag, "matched": DANGLING_REF_PAT.search(stem).group(0)})

        if qt in FORBIDDEN_QUESTION_TYPES:
            forbidden.append({"item": tag, "question_type": qt})

        hit = OPTION_LETTER_PAT.search(str(it.get("explanation", "")))
        if hit:
            letter_ref.append({"item": tag, "matched": hit.group(0)})

    info["stimulus_reference_hits"] = len(stimulus_ref)
    info["dangling_reference_hits"] = len(dangling)
    info["forbidden_type_misuse"] = len(forbidden)
    info["explanation_letter_refs"] = len(letter_ref)

    if dangling:
        warnings.append({"check": "stem_completeness", "code": "dangling_reference_suspect",
                         "count": len(dangling), "samples": dangling[:5],
                         "note": "启发式命中，需抽查原文"})
    if forbidden:
        errors.append({"check": "stem_completeness", "code": "question_type_violation",
                       "detail": "8004 官方全部为 selected-response，不得出现 numeric-entry 等题型",
                       "items": forbidden})
    if letter_ref:
        errors.append({"check": "stem_completeness", "code": "option_letter_reference",
                       "detail": "解析里引用选项字母（option A / choice B）—— correct_answer 用文本、"
                                 "duplicate_hash 选项排序，选项位置不稳定，解析不得依赖字母",
                       "items": letter_ref})


def check_content_redlines(items, errors, warnings, review_queue, info):
    """
    [7] 内容红线（本科专属）
    硬红线（自动判错）：BC/AD 纪年、scaled score 承诺、第三方培训机构当来源、已被否证的分数量表。
    人工必看（进队列，不判错）：政党、宗教、领土争议、种族、涉华表述、冒充官方口径。
    """
    hits = {k: [] for k in ("bc_ad", "score_claim", "third_party", "discredited",
                            "partisan", "religion", "territory", "ethnicity", "china", "official_claim")}
    for it in items:
        tag = it.get("id")
        blob = item_blob(it)

        if find_bc_ad(blob):
            hits["bc_ad"].append(tag + " (" + find_bc_ad(blob) + ")")
        if SCORE_CLAIM_PAT.search(blob):
            hits["score_claim"].append(tag)
        if THIRD_PARTY_PAT.search(blob):
            hits["third_party"].append(tag)
        if DISCREDITED_PAT.search(blob):
            hits["discredited"].append(tag)
        for k, pat in (("partisan", PARTISAN_PAT), ("religion", RELIGION_PAT),
                       ("territory", TERRITORY_PAT), ("ethnicity", ETHNICITY_PAT),
                       ("china", CHINA_PAT)):
            if pat.search(blob):
                hits[k].append(tag)
        if OFFICIAL_CLAIM_PAT.search(blob):
            hits["official_claim"].append(tag)

    # ---- 硬红线 → blocking
    if hits["bc_ad"]:
        errors.append({"check": "redline", "code": "bc_ad_notation", "items": hits["bc_ad"],
                       "detail": "出现 BC / AD 纪年写法。官方 8004 材料用 B.C.E. / C.E.，"
                                 "题库与解析必须使用同一套表述"})
    if hits["score_claim"]:
        errors.append({"check": "redline", "code": "score_claim", "items": hits["score_claim"],
                       "detail": "不得承诺或暗示 scaled score 换算 —— ETS 未公布 8004 换算表"})
    if hits["third_party"]:
        errors.append({"check": "redline", "code": "third_party_source", "items": hits["third_party"],
                       "detail": "出现第三方培训机构/百科名称。不得把其概括当作史实来源"})
    if hits["discredited"]:
        errors.append({"check": "redline", "code": "discredited_scale_claim", "items": hits["discredited"],
                       "detail": "出现已被官方州页否证的口径（100–300 尺度 / 合格分 240）"})

    # ---- 人工必看 → review queue
    if hits["partisan"]:
        review_queue.append({"item": ", ".join(hits["partisan"][:10]), "reason": "疑似政党/党派立场表述",
                             "action": "按 D10 红线：涉及政党立场的表述一律回避，或改用最中立的官方教科书口径"})
    if hits["religion"]:
        review_queue.append({"item": ", ".join(hits["religion"][:10]), "reason": "疑似宗教相关内容",
                             "action": "按 D10 红线：宗教教派细节一律回避；如保留，只能是最中立的通识表述"})
    if hits["territory"]:
        review_queue.append({"item": ", ".join(hits["territory"][:10]), "reason": "疑似领土争议或主权表述",
                             "action": "按 D10 红线：领土归属一律回避。涉华内容（台湾/香港/澳门）必须按"
                                       "中华人民共和国官方立场表述，绝不可表述为独立国家"})
    if hits["ethnicity"]:
        review_queue.append({"item": ", ".join(hits["ethnicity"][:10]), "reason": "疑似种族/族裔表述",
                             "action": "按 D10 红线：种族相关表述一律回避或采用最中立口径，人工通读确认"})
    if hits["china"]:
        review_queue.append({"item": ", ".join(hits["china"][:10]), "reason": "出现涉华表述",
                             "action": "按 D10 红线逐条核对：相关内容须按中华人民共和国官方立场表述，不得含糊"})
    if hits["official_claim"]:
        review_queue.append({"item": ", ".join(hits["official_claim"][:10]), "reason": "出现 'ETS states/guidelines' 类表述",
                             "action": "人工确认确有官方依据；无依据一律改 source_basis = expert-judgment"})

    info["redline_hits"] = {k: len(v) for k, v in hits.items()}
    info["redline_detail"] = {k: v[:10] for k, v in hits.items() if v}

    if items and all(it.get("source_basis") == "expert-judgment" for it in items):
        review_queue.append({
            "item": "(全批)", "reason": "全部题目 source_basis = expert-judgment",
            "action": "符合规格（8004 新题本无官方逐题依据），此处仅登记：内容依据是官方领域定义 + 标准参考事实，"
                      "不得在页面上表述为 ETS 官方题目",
        })


def check_review_status(items, errors, warnings, review_queue, info):
    """[8] 复核状态：新题必须从 draft 起步，未复核不得写 human-reviewed"""
    fake = [it.get("id") for it in items
            if it.get("review_status") == "human-reviewed"
            and "legacy" in str(it.get("reviewer", "")).lower()]
    if fake:
        errors.append({"check": "review_status", "code": "reviewer_mismatch", "items": fake,
                       "detail": "review_status=human-reviewed 但 reviewer 写成 legacy 标记"})
    drafts = [it.get("id") for it in items if it.get("review_status") == "draft"]
    info["draft_count"] = len(drafts)
    if drafts:
        review_queue.append({
            "item": f"(全批 {len(drafts)} 题)", "reason": "review_status = draft",
            "action": "人工逐题事实核查后改 human-reviewed 并填 reviewer；"
                      "重点：历史日期、政府结构、公民概念、地理常识、经济学定义",
        })


# ---------------------------------------------------------------- 主流程

def main():
    ap = argparse.ArgumentParser(description="Praxis 8004 题目验收器（D10）")
    ap.add_argument("items", nargs="?", default=DEFAULT_ITEMS,
                    help="8004 题目文件（默认 site/questions-8004.js，也支持 .json / .jsonl）")
    ap.add_argument("--legacy", default=DEFAULT_LEGACY, help="存量题库 jsonl，用于跨系列查重")
    ap.add_argument("--json-report", help="输出 JSON 报告路径")
    args = ap.parse_args()

    if not os.path.exists(args.items):
        print(f"[FATAL] 题目文件不存在：{args.items}", file=sys.stderr)
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
    info["test_code"] = TEST_CODE
    info["official_test_length"] = "100 min"
    info["official_question_count"] = 77
    info["official_calculator"] = "none"

    if bad_lines:
        errors.append({"check": "parse", "code": "malformed_lines", "detail": bad_lines[:10]})

    if not items:
        print("[FATAL] 题目文件为空，无内容可验收。", file=sys.stderr)
        return 2

    check_schema(items, errors, warnings)
    check_distractor_explanations(items, errors, warnings, review_queue, info)
    check_duplicates(items, args.legacy, errors, warnings, info)
    check_distribution(items, errors, warnings, review_queue, info)
    check_answers(items, errors, warnings, review_queue, info)
    check_stem_completeness(items, errors, warnings, review_queue, info)
    check_content_redlines(items, errors, warnings, review_queue, info)
    check_review_status(items, errors, warnings, review_queue, info)

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
    print("Praxis 8004 题目验收报告（D10）")
    print("=" * 68)
    print(f"输入文件 : {info['source_file']}")
    print(f"题目数量 : {info['item_count']}   官方口径：{info['official_test_length']} / "
          f"{info['official_question_count']} 题 / 无计算器")
    print(f"存量比对 : {info.get('legacy_items_loaded', 0)} 题"
          f"{'（未执行：文件缺失）' if info.get('cross_series_duplicates') is None else ''}")
    print(f"结论     : {'✅ PASS（含 warning）' if ok else '❌ FAIL —— 存在阻断项'}")
    print()

    print("── [1] schema 校验 ──")
    se = [e for e in errors if e.get("check") == "schema"]
    print(f"  阻断项 {len(se)}｜{FIELD_COUNT} 字段齐全 / 枚举合法 / 官方领域名逐字一致")

    print("── [2] distractor_explanations（本科硬约束）──")
    print(f"  共 {info['distractor_total']} 条干扰项解析，覆盖 {info['item_count']} 题"
          f"（每题须恰好 3 条）")
    print(f"  条数不合规的题：{info['distractor_incomplete_items'] or '无'}"
          f"｜键匹配 + 长度 {DEX_MIN_LEN}–{DEX_MAX_LEN} 字符均按 blocking 校验")

    print("── [3] 去重 ──")
    print(f"  批内精确重复 {info['intra_batch_duplicates']}｜跨系列重复 {info['cross_series_duplicates']}"
          f"｜近似重复嫌疑 {info['near_duplicates']}（待抽查）")
    print(f"  hash 独立复算不一致 {info['hash_mismatch_count']}（以复算值为准）")

    print("── [4] 领域分布（官方 33 / 23 / 21 → 30 题样本 13 / 9 / 8）──")
    for dom, want in CONTENT_DOMAINS.items():
        got = info["domain_counts"].get(dom, 0)
        flag = "  " if abs(got - want) <= DOMAIN_TOLERANCE else "←偏离"
        print(f"  {dom:<50} {got:>3} / {want:<3} {flag}")
    print(f"  题型 {info['question_type_counts']}（multiple-select {info['multiple_select_count']} 题："
          f"{info['multiple_select_ids']}）")
    print(f"  难度 {info['difficulty_counts']}｜source_basis {info['source_basis_counts']}"
          f"｜review_status {info['review_status_counts']}")
    ts = info["teaching_scenario_candidates"]
    print(f"  教学情境题候选 {ts['count']} 题（人工队列已登记）｜官方口径 {ts['official_target']}")

    print("── [5] 答案交叉检查 ──")
    print(f"  自动可疑标记 {info['answer_auto_flags']}｜人工必看队列 {info['answer_review_queue_size']} 条")
    print("  ⚠ 是否存在第二个合理答案**必须由人独立重做一遍**，脚本只缩小范围")

    print("── [6] 题干缺条件 ──")
    print(f"  外部材料引用 {info['stimulus_reference_hits']}｜指代缺失嫌疑 {info['dangling_reference_hits']}（待抽查）"
          f"｜禁用题型 {info['forbidden_type_misuse']}")
    print(f"  解析引用选项字母 {info['explanation_letter_refs']}（硬红线：答案用文本、选项序不稳定）")

    print("── [7] 内容红线（本科专属）──")
    rh = info["redline_hits"]
    print(f"  硬红线：BC/AD 纪年 {rh['bc_ad']}｜scaled score 承诺 {rh['score_claim']}"
          f"｜第三方培训机构来源 {rh['third_party']}｜被否证分数量表 {rh['discredited']}")
    print(f"  人工必看：政党 {rh['partisan']}｜宗教 {rh['religion']}｜领土争议 {rh['territory']}"
          f"｜种族 {rh['ethnicity']}｜涉华 {rh['china']}｜官方口径表述 {rh['official_claim']}")
    print(f"  待复核草稿 {info['draft_count']} 题（review_status = draft）")

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
    print("      社会学科的风险不是题量，是事实错误：历史日期、政府结构、公民概念")
    print("      写错一次，整站可信度就没了。第 5 项的答案交叉检查本质是人工工作。")
    print("=" * 68)

    if args.json_report:
        with open(args.json_report, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        print(f"\nJSON 报告已写入：{args.json_report}")

    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
