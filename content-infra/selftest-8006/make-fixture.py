#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
make-fixture.py — validate-8006-items.py 的自检夹具生成器

目的：证明验收脚本**抓得住已知错误**，而不只是"能跑通"。

D2 的教训：脚本自报 100% 通过，只能证明它自己没抛错。
所以这个夹具故意植入 12 类已知缺陷，跑验收脚本后应逐条被抓出。

    python make-fixture.py            # 生成 bad-8006-items.jsonl（含 12 类缺陷）
    python make-fixture.py --clean    # 生成 clean-8006-items.jsonl（应全部通过）

夹具题目是占位内容，不是真实 8006 题目，不得入库、不得上线。
"""

import argparse
import hashlib
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LEGACY = os.path.join(os.path.dirname(HERE), "items-5000-series.jsonl")

FLS = "Foundational Literacy Skills"
FANDV = "Fluency and Vocabulary"
CWE = "Comprehension and Written Expression"


def normalize(t):
    return re.sub(r"[^a-z0-9]", "", str(t).lower())


def dup_hash(stem, choices):
    parts = [normalize(stem)] + sorted(normalize(c) for c in choices)
    return hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()


def mk(i, domain, stem, choices, correct, explanation=None, **over):
    item = {
        "id": i,
        "series": "8000",
        "test_code": 8006,
        "subject": "Teaching Reading",
        "content_domain": domain,
        "skill": None,
        "difficulty": "medium",
        "question_type": "single-select",
        "stimulus": None,
        "stem": stem,
        "choices": choices,
        "correct_answer": correct,
        "explanation": explanation or "Placeholder explanation for fixture validation purposes only.",
        "distractor_explanations": None,
        "source_basis": "expert-judgment",
        "review_status": "draft",
        "reviewer": "selftest-fixture",
        "version": 1,
        "duplicate_hash": None,
        "created_at": "2026-09-03T00:00:00Z",
        "updated_at": "2026-09-03T00:00:00Z",
    }
    item.update(over)
    item["duplicate_hash"] = dup_hash(item["stem"], item["choices"])
    return item


def build_bad():
    items = []
    n = 0

    # ---- 12 道 Foundational Literacy Skills（其中 1 道为缺陷题）
    for k in range(12):
        n += 1
        iid = f"F{n:02d}"
        if k == 0:
            # 缺陷 1：numeric-entry —— 8006 官方全部为 selected-response
            items.append(mk(
                iid, FLS,
                "A student reads the word 'stop' as 'tops'. How many phonemes does the student need to blend?",
                ["Two", "Three", "Four", "Five"], "Four",
                question_type="numeric-entry"))
        elif k == 1:
            # 缺陷 2：题干引用外部材料但 stimulus 为空 —— 废题
            items.append(mk(
                iid, FLS,
                "According to the table below, which phonics pattern should be introduced first?",
                ["Short vowels", "Consonant blends", "Digraphs", "Silent e"], "Short vowels"))
        elif k == 2:
            # 缺陷 3：指代缺失（the passage above 但无 stimulus）
            items.append(mk(
                iid, FLS,
                "In the passage above, which word contains a vowel team?",
                ["boat", "cat", "ship", "dog"], "boat"))
        else:
            items.append(mk(
                iid, FLS,
                f"[FLS-{k}] Which instructional activity best develops phonemic awareness in kindergarten?",
                ["Segmenting spoken words into phonemes", "Reading leveled texts aloud",
                 "Writing personal narratives", "Memorizing high-frequency words"],
                "Segmenting spoken words into phonemes"))

    # ---- 9 道 Fluency and Vocabulary（其中 2 道为缺陷题）
    for k in range(9):
        n += 1
        iid = f"V{n:02d}"
        if k == 0:
            # 缺陷 4：官方领域名写成 & 而非 and
            items.append(mk(
                iid, "Fluency & Vocabulary",
                "Which assessment provides the best measure of a student's oral reading fluency?",
                ["A timed one-minute reading of connected text",
                 "A word list read in isolation", "A silent comprehension quiz",
                 "A phonics screening"], "A timed one-minute reading of connected text"))
        elif k == 1:
            # 缺陷 5：scaled score 承诺 —— ETS 未公布 8006 换算表
            items.append(mk(
                iid, FANDV,
                "A teacher wants to build academic vocabulary for tier-two words. Which routine is most effective?",
                ["Repeated exposure with morphological analysis", "Single dictionary definition",
                 "Silent reading only", "Weekly spelling test"],
                "Repeated exposure with morphological analysis",
                explanation="Correct answers at this level typically correspond to a scaled score of 165 "
                            "on the official Praxis scale."))
        else:
            items.append(mk(
                iid, FANDV,
                f"[F&V-{k}] Which strategy best supports a student whose reading is accurate but labored?",
                ["Repeated reading with feedback", "Decodable text only",
                 "Silent sustained reading", "Phonetic spelling drills"],
                "Repeated reading with feedback"))

    # ---- 9 道 Comprehension and Written Expression（含多项缺陷）
    for k in range(9):
        n += 1
        iid = f"C{n:02d}"
        if k == 0:
            # 缺陷 6：版权风险 —— 可能引用真实出版物原文
            items.append(mk(
                iid, CWE,
                "Which question best promotes inferential comprehension during a read-aloud?",
                ["Why do you think the character acted that way?", "What is the title?",
                 "How many pages?", "Who is the author?"],
                "Why do you think the character acted that way?",
                stimulus="Excerpt from a leveled reader. © 2019 Scholastic. All rights reserved. "
                         "Reprinted with permission."))
        elif k == 1:
            # 缺陷 7：test_code 写错
            items.append(mk(
                iid, CWE,
                "Which graphic organizer best supports compare-and-contrast comprehension?",
                ["Venn diagram", "Story map", "KWL chart", "Timeline"], "Venn diagram",
                test_code=8002))
        elif k == 2:
            # 缺陷 8：否定式题干（应进人工复核队列，不是自动判错）
            items.append(mk(
                iid, CWE,
                "Which of the following is NOT a characteristic of effective comprehension instruction?",
                ["Explicit strategy modeling", "Teacher-led discussion only",
                 "Gradual release of responsibility", "Think-alouds"],
                "Teacher-led discussion only"))
        elif k == 3:
            # 缺陷 9：正确选项显著长于其他选项（长度泄露答案）
            items.append(mk(
                iid, CWE,
                "Which statement about text structure instruction is most accurate?",
                ["It helps readers", "No effect", "Rarely useful", "Optional"],
                "It helps readers organize and retain information by making the author's organizational "
                "pattern explicit, which supports both recall and summarization across content areas"))
        else:
            items.append(mk(
                iid, CWE,
                f"[CWE-{k}] Which practice best connects reading and writing instruction?",
                ["Writing in response to reading", "Copying spelling words",
                 "Timed grammar drills", "Independent silent reading only"],
                "Writing in response to reading"))

    # ---- 缺陷 10/11：批内重复（同题干，选项顺序不同）
    dup_stem = "Which of the following is a hallmark of structured literacy instruction?"
    dup_choices_a = ["Systematic and cumulative sequence", "Whole-language immersion",
                     "Incidental word exposure", "Unstructured independent reading"]
    items.append(mk("D01", FLS, dup_stem, dup_choices_a, dup_choices_a[0]))
    items.append(mk("D02", FLS, dup_stem, list(reversed(dup_choices_a)), dup_choices_a[0]))

    # ---- 缺陷 12：与存量 969 题跨系列重复（直接复制 5002-001）
    if os.path.exists(LEGACY):
        with open(LEGACY, "r", encoding="utf-8") as f:
            first = json.loads(f.readline())
        items.append(mk(
            "L01", CWE,
            first["stem"], list(first["choices"]), first["correct_answer"],
            explanation="Copied verbatim from legacy bank to test cross-series duplicate detection."))

    # ---- 缺陷 13：duplicate_hash 自报错误（与独立复算不一致）
    if items:
        items[-1]["duplicate_hash"] = "0" * 64

    return items


def build_clean():
    """30 道全对题，领域分布 12/9/9，无缺陷 —— 用于验证脚本不会误报"""
    items = []
    plans = [
        (FLS, 12, "phonological awareness"),
        (FANDV, 9, "oral reading fluency"),
        (CWE, 9, "reading comprehension"),
    ]
    n = 0
    for domain, count, topic in plans:
        for k in range(count):
            n += 1
            items.append(mk(
                f"OK{n:03d}", domain,
                f"[clean-{n}] Which instructional approach best supports {topic} "
                f"for elementary students at varied levels? (variant {k})",
                [f"Evidence-based explicit instruction in {topic} with monitoring",
                 f"Incidental exposure to {topic}",
                 f"Delayed instruction until {topic} develops naturally",
                 f"Exclusive reliance on peer tutoring for {topic}"],
                f"Evidence-based explicit instruction in {topic} with monitoring",
                explanation=f"Explicit, monitored instruction in {topic} is supported by the "
                            f"Science of Reading research base. This is fixture content only.",
                source_basis="expert-judgment",
                review_status="human-reviewed",
                distractor_explanations={f"Incidental exposure to {topic}": "Insufficient for most learners.",
                                         f"Delayed instruction until {topic} develops naturally": "Delays needed support.",
                                         f"Exclusive reliance on peer tutoring for {topic}": "Not a substitute for instruction."}))
    return items


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--clean", action="store_true", help="生成干净夹具（应全部通过）")
    args = ap.parse_args()

    items = build_clean() if args.clean else build_bad()
    name = "clean-8006-items.jsonl" if args.clean else "bad-8006-items.jsonl"
    out = os.path.join(HERE, name)
    with open(out, "w", encoding="utf-8") as f:
        for it in items:
            f.write(json.dumps(it, ensure_ascii=False) + "\n")
    print(f"已生成 {len(items)} 题 → {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
