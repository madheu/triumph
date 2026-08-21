# 给 Hermes 的出题指令模板

> 用途：让 Hermes 用 praxis-question-writer skill 批量出题（消耗中转站 token）
> 前置：skill 已装在 `C:\Users\abc27\.hermes\skills\praxis-question-writer\`
> **官方大纲（必做第一步）**：出任何题之前，Hermes 必须先获取官方 Study Companion 大纲
> （skill §0 强制流程；Hermes 无网络限制，可直接下载 ETS 官方 PDF）

## 指令模板 0（首次必做：获取官方大纲，只需做一次）

```
请使用 praxis-question-writer 技能，先执行 §0（Official Blueprint First）：
1. 下载 Praxis 5001 官方 Study Companion PDF（尝试 https://www.ets.org/praxis/prepare/materials/
   或 https://parapro.ets.org/test-5001.html，找不到就用 skill §0.1 里的镜像来源）
2. 提取四科大纲：5002/5003/5004/5005 的 content categories、每类题数、题型格式
3. 把提取结果整理成 markdown 保存到 E:\Triumph\praxis-5001\assets\official-blueprint-5001.md
4. 如果下载成功，把 PDF 也保存到 E:\Triumph\praxis-5001\assets\StudyCompanion-5001-official.pdf
然后告诉我：四科各有哪些 categories、各类题数比例、blueprint 版本。
```

## 指令模板 1（首次小批量试跑，大纲到手后跑这个）

```
请使用 praxis-question-writer 技能。
官方大纲已就绪（E:\Triumph\praxis-5001\assets\official-blueprint-5001.md），
出题前先读它，按官方 categories 和题量比例来。
为 Praxis 5001 出 8 道原创练习题：
- 科目：5002 Mathematics
- 类别：从官方大纲 5002 的 categories 里选 2 个（各 4 道）
- 难度：easy 2 / medium 4 / hard 2；题型：knowledge 2 / concept 4 / pedagogy 2
- 全部 100% 原创（不复制 ETS 或第三方内容），按 SKILL.md 第 5 节 JSON 输出
  （blueprint 字段标 official），id 从 5002-001 开始，保存到 C:\Users\abc27\.hermes\out\5002-batch1.json
- 每道按第 4 节 self-check 自检，没把握的标 "review": true
```

## 指令模板 2（批量扩充）

```
继续用 praxis-question-writer 技能。官方大纲同前。
已有题库：<上批文件路径>
请追加 10 道 5003 Reading & Language Arts 题目：
- 按官方大纲 5003 的 categories 分配题量（比例对齐官方）
- 难度 20/50/30，题型 30/40/30，id 接着现有序列
- 输出新 JSON 并说明追加的 id
```

## 指令模板 3（全四科首轮，题库初版）

```
用 praxis-question-writer 技能，按官方大纲出 Praxis 5001 首轮题库，分 4 批：
批1: 5002 Mathematics 20 题（按官方 categories 比例）
批2: 5003 Reading & Language Arts 20 题（按官方比例）
批3: 5004 Social Studies 20 题（按官方比例）
批4: 5005 Science 16 题（按官方比例）
每批难度 20/50/30、题型 30/40/30，JSON 输出到独立文件，blueprint 标 official。
全部原创，按质量准则自检，低置信度标 review。最后输出 4 个文件路径清单。
```

## 省钱提示

- 每次小批量（5–10 题）比一次 100 题质量高、出错少（省返工 token）
- 让 Hermes 输出 JSON 到文件而不是粘贴对话里，省输出 token
- 出完把 JSON 文件给我（或拷到 E:\Triumph\praxis-5001\），我做质量审计 + 版权抽查 + 接入 Diagnostic Demo
