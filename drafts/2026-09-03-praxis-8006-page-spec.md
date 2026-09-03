# Praxis 8006 页面技术规格（D6 交付物 2/2）

> 对应内容稿：`drafts/2026-09-03-praxis-8006-teaching-reading.md`
> 状态：待人工验收 · 未上线 · 未涉及任何现有代码文件
> 建立：2026-09-03（D6）｜本规格是 8002–8005 四页的模板

---

## 0. 这一页为什么是模板

8006 是 8000 系列第一个做的科目。本规格定义的**模块顺序、结构化数据形状、结果页状态机、注册接入点**在 D8–D11 直接复用，只换事实层。

因此这里刻意把「事实」与「结构」分离：内容稿里的事实全部来自 `docs/official-facts-8000-series.md`，本规格只定义结构与行为。后续四科改事实不动结构。

---

## 1. 页面标识

| 项 | 值 |
| --- | --- |
| URL | `/praxis-8006-teaching-reading` |
| Title | `Praxis 8006 Teaching Reading: Test Format, Content & Free Practice \| Learndiag` |
| Title 认领的主意图 | 单一：8006 考什么。**不**同时抢「passing score」「which states」「vs 8002」—— 后者分别归 D17 / D16 |
| Meta description | 158 字符内。要点：100 min / 80 SR questions / three content categories / free practice / not affiliated with ETS |
| Canonical | `https://learndiag.com/praxis-8006-teaching-reading` |
| H1 | 与 Title 不同句，见内容稿。全站只有 1 个 H1 |
| dateModified | 与正文「Last verified」同日期，且必须同步 |
| 草稿文件 | `drafts/2026-09-03-praxis-8006-teaching-reading.md` |

**Title 长度**：当前 88 字符，Google 截断约 60 字符（~580px），会被截在 "Free Practice" 之前。备选短版：`Praxis 8006 Teaching Reading: Format, Content & Practice`（54 字符）。**建议用短版**，把 Free 交给 meta description 承担。

---

## 2. 模块清单（D6 要求 7 模块，缺一不可）

| # | 模块 | 静态 HTML 是否可见 | 内容稿对应位置 | 验收点 |
| --- | --- | --- | --- | --- |
| 1 | Hero | ✅ | 标题 + 顶部免责声明 + At a Glance 表 | 考试代码 8006、官方全名、免费、无需信用卡、预计完成时间、**明确非 ETS 官方产品** |
| 2 | 可交互测试 | ⚠️ 骨架可见，题目待交付 | Practice: Free Mini Test | 无 JS 时能看到题干占位与「题目准备中」说明；有 JS 时为完整测试 |
| 3 | 结果报告 | ❌ 纯客户端 | 规格见 §4 | 总正确率 / 各领域表现 / 最弱领域 / 下一步建议。**不得输出 scaled score** |
| 4 | 考试概览 | ✅ | Is 8006 Right for You + What It Actually Tests | 考什么、内容领域、适用对象、如何确认该不该考 |
| 5 | Study plan | ❌ 纯客户端，接 D3 | 规格见 §5 | 按弱项生成，部分预览，注册后保存完整计划 |
| 6 | FAQ | ✅ | FAQ 段落 | 8 问，与正文口径一致，零矛盾 |
| 7 | 官方来源区 | ✅ | Official Sources | ETS 页 + 州页 + 归档源 + **最后核验日期** + 来源局限说明 |

**模块 2/3/5 当前不可验收**，因为 8006 题目未交付（见 §7）。按 D6 预案：骨架先上，mini test 顺延。

---

## 3. 结构化数据

三块 JSON-LD，全部静态直出，不依赖 JS。

### 3.1 Article

```json
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Praxis 8006 Teaching Reading: What the Test Covers and How to Prepare",
  "datePublished": "2026-09-03",
  "dateModified": "2026-09-03",
  "author": { "@type": "Organization", "name": "Learndiag", "url": "https://learndiag.com" },
  "publisher": { "@id": "https://learndiag.com/#organization" },
  "mainEntityOfPage": { "@type": "WebPage", "@id": "https://learndiag.com/praxis-8006-teaching-reading" },
  "about": {
    "@type": "Thing",
    "name": "Praxis Elementary Education Fundamentals: Teaching Reading (8006)"
  }
}
```

⚠️ `dateModified` 必须与正文「Last verified」同步。事实库任何一次更新，两边一起改。这条最容易腐化，建议放进 D14 整站技术检查的 checklist。

### 3.2 FAQPage

8 条，与正文 FAQ 段落**逐字一致**（Google 要求页面上看得见）。问答文本取自内容稿 FAQ 段，此处不重复粘贴，生成时从正文抽取，避免两份漂移。

对应 8 问：
1. What is Praxis 8006?
2. Is Praxis 8006 the same as Praxis 7002?
3. Which states require Praxis 8006?
4. What is the passing score for Praxis 8006?
5. Can I take the content categories separately?
6. How do I know if I should take 8006 or 5205?
7. When are scores released?
8. When should I retake the test? / Is this free practice test official?（2 条合并计数，实际 9 问 8 组）

### 3.3 BreadcrumbList

`Home > Exam Updates > Praxis 8000 Series > Praxis 8006 Teaching Reading`

⚠️ 第三级 `Praxis 8000 Series` 指向 `/praxis-elementary-education-fundamentals`（D12 总 Hub）。D12 未上线前，该级用纯文本不带链接，避免面包屑出现死链。

---

## 4. 结果页状态机（模块 3）

结果报告的**状态清单**——D6 是全站模板，这里定义的状态数直接决定 D8–D11 的实现量。

| 状态 | 触发条件 | 显示内容 |
| --- | --- | --- |
| `questions_not_ready` | 题目集为空（当前状态） | 「Practice questions are being prepared」+ 领域说明（静态可见） |
| `in_progress` | 已开始，未答完 | 进度、当前题号、已答数 |
| `complete_unregistered` | 答完，未留邮箱 | 总正确率 / 各领域表现 / 最弱领域 / Week 1 计划前两项 / 重测建议日期 |
| `complete_registered` | 答完且已注册 | 上述 + 完整学习计划 + 错题记录 + 保存标记 |
| `returning_visit` | 已注册用户再次访问 | 上次结果 + 与本次对比（若已重测） |

**硬约束**：任何状态下都**不显示 scaled score 或 pass probability**。原因是客观的——ETS 未公布 8006 的 raw-to-scaled 换算表，任何数字都是编的。内容稿 FAQ 里已明说这一点，实现时不得违背。

**最弱领域的判定规则**（30 题样本下的边界）：
- 按领域正确率排序，取最低者。
- 并列时，按官方权重高者优先（Foundational Literacy Skills 40% > Fluency and Vocabulary 30% = Comprehension and Written Expression 30%）。
- 三个领域正确率相同时，**不输出「最弱领域」**，改输出「三个领域表现接近，建议均衡复习」。样本太小时不要假装有区分度。

---

## 5. Study plan 与 D3 注册链路的接入点

本页不自行实现注册。它调用 D3 交付的统一注册组件。契约如下（D3 实现，本页遵守）：

```
RegistrationComponent({
  context: "8006_mini_test",
  payload: {
    test_code: "8006",
    score_pct: <number>,
    weakest_domain: <string|null>,
    domain_scores: { "Foundational Literacy Skills": n, ... },
    attempt_id: <string>,        // 本地生成，用于注册后回填
    client_saved_at: <ISO8601>
  },
  onSuccess: (session) => { /* 原地恢复结果，不重新测试 */ }
})
```

**三条必须满足的行为**：
1. **不跳转。** 注册在同一页面内完成，结果不清空。
2. **原地恢复。** 注册成功后 `attempt_id` 对应的结果从本地回填到账号，用户不重测。
3. **可退出。** 「稍后再说」必须存在且不遮挡结果。

⚠️ **已识别的技术风险（D3 必须解决，否则本页注册后结果会丢）**：
现状 `worker-src/accounts.mjs` 的 `hVerify()` 在验证成功时会**无条件覆盖**用户 state：

```js
await env.TRIUMPH_KV.put(STATE_KEY(rec.id), JSON.stringify({
  createdAt: Date.now(), answers: [], mastery: {}, plan: null, srs: {}, tasks: {}
}));
```

用户先做题（结果存在本地）→ 注册 → verify → 服务端写入空 state → 前端若以服务端 state 为准，结果被清空，正是 D3 想消灭的「找不到刚才的结果」。

**处置方向**（D3 定，此处只标记）：verify 时接受前端传入的 pending payload 并合并，或改为「服务端 state 为空时才初始化」。两种做法都可行，但必须在 D3 设计里写死一种，不能留给实现时随机。

---

## 6. 静态直出要求（无 JS 也要能看到内容）

- 模块 1 / 4 / 6 / 7 全部为静态 HTML，不依赖 React 或任何客户端渲染。
- 模块 2 的题干与基础说明静态可见；交互层（答题、判分）在 JS 就绪后增强。
- 参照 `site/diagnostic.html` 的 `seo-about` / `seo-block` 两段式做法：正文在 `<body>` 里直出，React 只接管交互区。

---

## 7. 当前阻塞与顺延

| 项 | 状态 | 处置 |
| --- | --- | --- |
| 8006 题目集 | ❌ 磁盘上零文件。全盘 `find -iname "*8006*"` 仅命中 `.git` 内部对象；`content-infra/` 下无 8006 题目文件 | 按 D6 预案：骨架先上，mini test 顺延 1–2 天。题目交付后经 D5 验收再接入 |
| D12 总 Hub | ❌ 未建 | 面包屑第三级暂用纯文本 |
| D3 注册组件 | ❌ 未实现 | 本页 Study plan 的注册后行为依赖它，先做未注册分支 |

**不用 5001 旧题凑数。** 5001 的内容领域与 8006 不对应（一个是分科内容考试，一个是阅读教学专业考试），拿旧题冒充新考试会直接砸招牌。

---

## 8. 验收清单（D6 DoD）

- [ ] 静态 HTML 可见核心正文（模块 1/4/6/7）
- [ ] Title/H1 只认领一个主意图
- [ ] canonical 正确
- [ ] Article + FAQPage + Breadcrumb 三块结构化数据通过 Google Rich Results Test
- [ ] 8 条 FAQ 与正文逐字一致
- [ ] 页面每条事实都有来源，来源区列出核验日期
- [ ] 顶部免责声明原文照写
- [ ] 「Praxis 8006」全篇带 Praxis 前缀（PECT 8006 冲突）
- [ ] 结果页不出现任何 scaled score
- [ ] 测试可完成（题目交付后）
- [ ] 结果页输出最弱领域（题目交付后）
- [ ] dateModified 与「Last verified」同步

前 8 项现在可验收。后 3 项待题目交付。
