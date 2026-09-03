# -*- coding: utf-8 -*-
"""
normalize-multiselect.py — 把 8006-multiselect-quarantine.json（27 题多选）清理为
schema v1 现役口径（content-infra/item-schema-v1.md，2026-09-03 定稿版）的可验收形态。

只做结构与机械字段转换，不改题干/选项内容/答案指向/解析语义：
  [1] test_code: '8006'（str）→ 8006（int）
  [2] content_domain: '&' → 'and'（ETS 官方写法）
  [3] review_status: 'ai-reviewed'（不在枚举）→ 'draft'
  [4] source_basis: 自由文本 → 'expert-judgment'（Learndiag 原创，非官方源）
  [5] duplicate_hash: PENDING 占位 → 实算 SHA-256（裸 hex，与存量 969 题同约定）
  [6] choices: [{key,text}] 对象数组 → [text] 字符串数组（schema v1 口径，见 README 适配记录 #2）
  [7] correct_answer: 选项 key 列表（如 ['A','B','E']）→ 选项全文文本列表（适配记录 #3）
  [8] distractor_explanations: 键从 key → 选项全文文本（适配记录 #4）

原文件不改动；输出 8006-multiselect-normalized.json，供验收器复跑。
"""
import json, os, re, hashlib

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "8006-multiselect-quarantine.json")
DST = os.path.join(HERE, "8006-multiselect-normalized.json")

def normalize(t):
    return re.sub(r"[^a-z0-9]", "", str(t).lower())

def dup_hash(stem, choices):
    parts = [normalize(stem)] + sorted(normalize(c) for c in choices)
    return hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()

d = json.load(open(SRC, encoding="utf-8"))
items = d["items"] if isinstance(d, dict) else d
fixes = {"test_code": 0, "content_domain": 0, "review_status": 0, "source_basis": 0,
         "duplicate_hash": 0, "choices_structure": 0, "correct_answer": 0, "distractor_keys": 0}

for it in items:
    if it.get("test_code") != 8006:
        it["test_code"] = 8006; fixes["test_code"] += 1
    cd = it.get("content_domain")
    if cd and "&" in cd:
        it["content_domain"] = cd.replace(" & ", " and "); fixes["content_domain"] += 1
    if it.get("review_status") not in ("draft", "human-reviewed", "rejected"):
        it["review_status"] = "draft"; fixes["review_status"] += 1
    if it.get("source_basis") not in ("legacy-unknown", "expert-judgment", "official-source"):
        it["source_basis"] = "expert-judgment"; fixes["source_basis"] += 1

    # [6][7][8] 旧结构 → schema v1 现役口径
    ch = it.get("choices") or []
    if ch and all(isinstance(c, dict) for c in ch):
        key2text = {c.get("key"): c.get("text", "") for c in ch}
        it["choices"] = [key2text[c.get("key")] for c in ch]
        fixes["choices_structure"] += 1
        ca = it.get("correct_answer")
        if isinstance(ca, list):
            it["correct_answer"] = [key2text.get(a, a) for a in ca]
            fixes["correct_answer"] += 1
        de = it.get("distractor_explanations")
        if isinstance(de, dict):
            it["distractor_explanations"] = {key2text.get(k, k): v for k, v in de.items()}
            fixes["distractor_keys"] += 1
        texts = it["choices"]
    else:
        texts = [str(c) for c in ch]

    declared = str(it.get("duplicate_hash") or "")
    real = dup_hash(it.get("stem", ""), texts)
    if declared != real:
        it["duplicate_hash"] = real; fixes["duplicate_hash"] += 1

out = {
    "schema_version": 1,
    "batch": "8006-multiselect-normalized",
    "test_code": 8006,
    "produced_by": "main-session-2026-09-03",
    "produced_at": "2026-09-03",
    "_note": ("由 8006-multiselect-quarantine.json 规范化为 schema v1 现役口径（题目内容零改动）："
              "test_code str→int、content_domain &→and、review_status 'ai-reviewed'→'draft'"
              "（原状态不在枚举，语义为仅 AI 审、未经人工）、source_basis→'expert-judgment'、"
              "duplicate_hash PENDING→实算、choices [{key,text}]→[text]、correct_answer key→选项全文、"
              "distractor_explanations 键 key→选项全文，各 27（content_domain 17 题原本已合规）。"
              "口径依据：ETS 官方 8006 页 'a variety of selected-response questions' + Study Companion "
              "selected-response 定义 'select one or more answers'，multiple-select 属合法形态。"
              "正式入库前仍需逐题人工重做答案组合。"),
    "_fix_counts": fixes,
    "items": items,
}
json.dump(out, open(DST, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("写出:", DST)
print("修复计数:", fixes)
