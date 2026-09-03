# PRD · 注册链路重做（D3）

> 版本：v1 ｜ 建立：2026-09-03 ｜ 撰写：Buddy
> 状态：**待评审** —— 本轮未改动任何代码文件（AGENT.md 第 4 节）
> 需求描述遵循 EARS 原则（Ubiquitous / Event-driven / Unwanted / State-driven / Optional）

---

## 1. 背景与目标

### 1.1 现状

| 指标 | 数值 |
| --- | --- |
| 完成测试人数 | 4 |
| 注册人数 | 0 |
| 转化率 | 0%（样本过小，不具统计意义） |

样本不足以算出稳定转化率，但**结构问题不需要靠数据也能定位**：

现行路径是
`完成测试 → 点登录 → 跳转到另一个页面 → 注册 → 找不到刚才的结果`

每一步都在漏人。最致命的是最后一步：**用户做完了测试，注册完却拿不回自己的结果**。这不是转化率问题，是产品失信。

### 1.2 目标路径

`完成测试 → 立即看到基础结果 → 输入邮箱保存 → **原地**解锁完整学习计划 → 以后回来对比进步`

### 1.3 目标（可度量）

| # | 目标 | 度量方式 |
| --- | --- | --- |
| G1 | 消除「注册后拿不回结果」的产品失信 | 端到端跑通：完成 → 留邮箱 → 原地解锁 → 换设备回访能恢复 |
| G2 | 五段漏斗可拆，定位漏点 | D4 的 12 事件上线后，段 3/4/5 有非零数据 |
| G3 | 注册转化不因流程断裂而损失 | 段 4→5（看见提示 → 注册成功）转化率可测 |

**G3 暂不设目标数值。** 理由：4 人的样本下任何目标值都是编的。等 12 事件上线、漏斗有真实数据后再定基线。

### 1.4 不在本次范围

- Google 登录改造（现有可用，保持不动）
- 付费 / Pro 相关流程（D26）
- 8006 页面的注册接入（D6，调用本需求交付的组件）

---

## 2. 用户故事

| # | 作为… | 我想要… | 以便… |
| --- | --- | --- | --- |
| US1 | 刚做完诊断的考生 | 立刻看到我的结果 | 不用先注册就知道自己什么水平 |
| US2 | 想保留结果的考生 | 在结果页里直接留邮箱 | 不用跳走、不用重测 |
| US3 | 对留邮箱有顾虑的考生 | 知道邮箱用来干什么、能退出 | 不被套路 |
| US4 | 两周后回来的考生 | 用邮箱恢复我上次的成绩 | 看到进步 |
| US5 | 换设备的考生 | 在新设备上看到我的计划 | 不受设备限制 |

---

## 3. 需求描述（EARS）

### 3.1 结果呈现（Ubiquitous）

- **R1.1** The system shall display, without requiring any account: overall score, per-domain performance, the weakest domain, and two to three baseline recommendations.
- **R1.2** The system shall not require registration, payment, or a credit card to view the results defined in R1.1.
- **R1.3** The system shall not display any modal, overlay, or interstitial that obstructs the results defined in R1.1.
- **R1.4** The system shall not present a scaled score or score conversion at any point in the result flow.

> R1.4 是硬约束。ETS 未公布 8000 系列的 raw-to-scaled 换算表，任何换算数字都是编的。与 D6 内容稿口径一致。

### 3.2 注册入口（State-driven）

- **R2.1** While the user is unregistered and the result has rendered, the system shall display the registration card inline below the results.
- **R2.2** While the registration card is displayed, the system shall display the primary action label "Save My Results & Build My Study Plan".
- **R2.3** While the registration card is displayed, the system shall display the text "Free during launch. No credit card required."
- **R2.4** While the result is unsaved, the system shall display the text "This result is currently saved on this device only."
- **R2.5** While the registration card is displayed, the system shall display a "Maybe later" control that dismisses the card.

### 3.3 邮箱注册流程（Event-driven）

- **R3.1** When the user submits an email address, the system shall send a single email containing both a magic link and a six-digit verification code.
- **R3.2** When the user submits an email address, the system shall not navigate away from the results page.
- **R3.3** When the user submits an email address, the system shall display the purpose of the email before submission.
- **R3.4** When the user clicks the magic link, the system shall authenticate the user and mark the session as verified.
- **R3.5** When the user enters a valid six-digit code on the results page, the system shall authenticate the user in place.
- **R3.6** When the user is authenticated, the system shall unlock the full study plan, the complete mistake log, and cross-device access without re-running the test.
- **R3.7** When the user is authenticated, the system shall associate the previously unsaved result with the newly created account.

### 3.4 原地解锁（Event-driven）

- **R4.1** When authentication succeeds, the system shall render the unlocked content in the same view, preserving scroll position and all previously displayed results.
- **R4.2** When authentication succeeds, the system shall not reset, clear, or re-compute the result.
- **R4.3** When authentication succeeds, the system shall display the first two items of the Week 1 plan, the weakest domain, and a suggested retake date.

> R4.1/R4.2 是本需求的核心。现行流程的失败点就在这里。

### 3.5 回访与恢复（State-driven / Event-driven）

- **R5.1** While an authenticated user returns to the site, the system shall restore their saved result and study plan.
- **R5.2** When two weeks have elapsed since a saved result, the system shall display the retake prompt "Retake the diagnostic in two weeks and compare your progress."
- **R5.3** When an authenticated user completes a second attempt, the system shall display a before/after comparison.

### 3.6 异常处理（Unwanted）

- **R6.1** If the email address fails format validation, then the system shall display an inline error and shall not send email.
- **R6.2** If the email address is already registered and verified, then the system shall offer sign-in instead of creating a duplicate account.
- **R6.3** If the email provider fails to send, then the system shall display an actionable error and shall preserve the entered email address.
- **R6.4** If the six-digit code is incorrect or expired, then the system shall allow re-entry without losing the current result.
- **R6.5** If the magic link has expired, then the system shall display the code-entry option as the recovery path.
- **R6.6** If the user dismisses the registration card, then the system shall continue to display all results defined in R1.1 and shall not re-prompt during the same session.
- **R6.7** If authentication succeeds on a different device than the one where the test was taken, then the system shall restore the result from the server on the next visit.

### 3.7 可选能力（Optional）

- **R7.1** Where Google sign-in is available, the system shall offer it as an alternative authentication method.
- **R7.2** Where the user has opted in, the system shall send a retake reminder two weeks after a saved result.

---

## 4. 关键设计决策

### 4.1 决策一：magic link 与验证码双轨，不做二选一

D3 要求「邮箱 magic link 优先」。**本方案保留 magic link 为主路径，同时在同一封邮件里附 6 位验证码，允许用户在原页面就地完成验证。**

理由（这是本 PRD 最重要的一条判断）：

magic link 有一个绕不开的体验断点 —— **用户必须离开当前页面去开邮箱。** 移动端尤其明显：做完测试 → 切到邮件 App → 点链接 → 跳回浏览器 → 结果页可能已被回收重载。每一步都是流失点，而我们要的恰恰是「原地解锁」。

单靠 magic link，还会引入一个新问题：链接在**新标签页**打开时，原标签页无从得知验证已完成，用户会卡在「等待中」的状态里。

双轨方案下：
- 想快的 → 留在页面，看邮件里的 6 位码，就地输入，立刻解锁
- 想顺的 → 点邮件链接，自动登录；原页面通过轮询感知到状态变化，自动解锁

两条路径通向同一个结果，用户不用做选择。

**原页面感知 magic link 完成的机制**：提交邮箱后拿一个 `pending_token`，以 3 秒间隔轮询 `/api/magic/status`，最长 10 分钟。同时监听 `storage` 事件作为加速（同一浏览器多标签场景）。轮询是可靠路径，storage 事件只是让它更快，不单独依赖。

### 4.2 决策二：无密码注册

现行 `hRegister` 强制 `password.length >= 8`。本需求下注册**不收集密码**。

理由：
- 结果页内注册，多一个密码框就多一道摩擦，且这个摩擦没有换来任何东西
- 不存密码就不存在密码泄露风险
- magic link / 验证码已经承担了身份验证

已有密码用户的登录路径（`hLogin`）**保持不动**，不迁移、不影响。

### 4.3 决策三：必须修掉 STATE 覆盖缺陷（阻塞项）

**这是本次发现的真实缺陷，不修则 R4.2 无法实现。**

现状 `worker-src/accounts.mjs` 的 `hVerify()`：

```js
rec.verified = true;
await env.TRIUMPH_KV.put(USER_KEY(email), JSON.stringify(rec));
await env.TRIUMPH_KV.put(STATE_KEY(rec.id), JSON.stringify({
  createdAt: Date.now(), answers: [], mastery: {}, plan: null, srs: {}, tasks: {}
}));    // ← 无条件覆盖
```

用户在 A 页面做完测试（结果存本地）→ 注册 → verify → 服务端写入**空 state** → 前端若以服务端 state 为准，结果被清空。

**这正是 D3 要消灭的「找不到刚才的结果」，只是换了层皮。**

修复方向：改为「读-改-写」，且接受前端传入的 pending payload 合并：

```js
const existing = await env.TRIUMPH_KV.get(STATE_KEY(rec.id), 'json').catch(() => null);
const state = existing || { createdAt: Date.now(), answers: [], mastery: {}, plan: null, srs: {}, tasks: {} };
if (pending && !existing) { /* 合并前端结果 */ }
await env.TRIUMPH_KV.put(STATE_KEY(rec.id), JSON.stringify(state));
```

**具体合并策略在实现时定，但必须在设计里写死一种。** 不能留给实现时随机——这是本缺陷产生的根因。

### 4.4 决策四：注册卡片不用弹窗

D3 明确要求「不要强制弹窗封死」。

注册卡片在结果下方**内联展示**，可关闭，关闭后结果完整保留。不使用全屏 modal、不使用滚动劫持、不倒计时。

---

## 5. 接口变更（草案，待评审）

| 方法 | 路径 | 变更 | 说明 |
| --- | --- | --- | --- |
| POST | `/api/magic/request` | **新增** | 提交邮箱 → 发一封含 magic link + 6 位码的邮件 → 返回 `pending_token` |
| GET | `/api/magic/status?token=` | **新增** | 轮询验证状态。返回 `pending` / `verified(+token)` / `expired` |
| POST | `/api/magic/verify` | **新增** | 就地提交 6 位码 → 返回 token；接受 pending result 一并入库 |
| GET | `/api/magic/redeem?token=` | **新增** | magic link 落地点：校验并换发 session token，前端跳转回结果页并带上一次性兑换码 |
| POST | `/api/register` | **保留** | 既有密码路径，不动 |
| POST | `/api/verify` | **修改** | 修掉 §4.3 的无条件覆盖 |
| POST | `/api/login` | 不动 | — |

**邮件模板需同时含两条路径**（magic link 按钮 + 6 位码），并说明用途。

---

## 6. 文案（英文，照 D3 定稿使用）

| 位置 | 文案 |
| --- | --- |
| 主按钮 | `Save My Results & Build My Study Plan` |
| 辅助说明 | `Free during launch. No credit card required.` |
| 风险提醒 | `This result is currently saved on this device only.` |
| 回访理由 | `Retake the diagnostic in two weeks and compare your progress.` |
| 邮箱用途说明 | `We'll email you a link to save your results and build your study plan. No spam. Unsubscribe anytime.` |
| 退出 | `Maybe later` |
| 验证码输入提示 | `Check your email for a 6-digit code — or click the link in the email.` |

---

## 7. 数据指标

本需求的每一步都对应 D4 的事件（事件字典见 `docs/analytics-events-v1.md`）：

| 步骤 | 事件 |
| --- | --- |
| 结果页渲染 | `result_view` |
| 注册卡片进入视口 | `signup_prompt_view` |
| 邮箱框获得焦点 | `signup_start` |
| 验证成功 | `signup_success`（GA4 侧映射为 `sign_up`） |
| 计划解锁 | `study_plan_unlock` |
| 两周后回访 | `return_visit` |
| 重测 | `retest_start` |

**`signup_prompt_view` 必须用视口判定，不能用渲染判定。** 注册卡片在折叠下方时，用户没滚到就是没看见 —— 这正是要测的东西。渲染即触发会让漏斗第四段恒为 100%，失去意义。

---

## 8. 验收标准（DoD）

- [ ] 端到端跑通：完成测试 → 看结果 → 留邮箱 → **原地**解锁 → 换设备回访能恢复
- [ ] 注册过程中不发生页面跳转
- [ ] 注册成功后结果不清空、不需重测（R4.1 / R4.2）
- [ ] 「Maybe later」可见可用，关闭后结果完整保留（R6.6）
- [ ] magic link 与 6 位码两条路径均可用（R3.4 / R3.5）
- [ ] 原页面在用户点邮件链接后自动解锁（§4.1 轮询机制）
- [ ] 已注册邮箱走登录而非重复建号（R6.2）
- [ ] 邮件发送失败时保留已输入邮箱并可重试（R6.3）
- [ ] 服务端不存在「验证即清空 state」的行为（§4.3）
- [ ] 全流程不出现任何 scaled score 或换算数字（R1.4）
- [ ] 12 个事件在本流程内全部上报（与 D4 联调）

---

## 9. 风险与依赖

| # | 风险 | 等级 | 处置 |
| --- | --- | --- | --- |
| 1 | 仓库有 **110 个未提交改动**（含已 staged），其中含 `site/js/auth.js`、`site/diagnostic.html`、`site/_worker.js` —— 正是本需求要改的文件 | **高** | **实施前必须等其他会话提交**。当前动手必然互相覆盖 |
| 2 | `hVerify` 的 state 覆盖缺陷（§4.3） | **高** | 与 D3 同批修，不可拆开 |
| 3 | magic link 邮件进垃圾箱 | 中 | 6 位码路径即为兜底；发信域名 SPF/DKIM 需确认 |
| 4 | 换设备恢复依赖用户已验证邮箱 | 低 | 未验证则结果仅存本地，文案已如实告知 |
| 5 | 依赖 D4 才能验证漏斗改善 | 中 | D4 排在 D3 次日，可承接 |

---

## 10. 待确认问题（需老户拍板）

| # | 问题 | 我的建议 |
| --- | --- | --- |
| Q1 | 是否接受「magic link + 验证码」双轨？D3 原文只提 magic link | **建议接受**。纯 magic link 在移动端流失率高，验证码兜底成本极低 |
| Q2 | 无密码注册是否可接受？现有 `hRegister` 要求 8 位密码 | **建议接受**。已有密码用户登录路径不受影响 |
| Q3 | 是否现在就要改代码？仓库 110 个未提交改动且另一个会话在活动 | **建议等其他会话提交后再动**。本轮只交付 PRD 与方案 |
| Q4 | 邮件发送走哪个服务商？现有 `sendVerificationEmail` 支持 Resend / Mailgun，需确认哪个已配置 | 需你确认 `.dev.vars` 里配了哪个（我不读密钥文件） |
