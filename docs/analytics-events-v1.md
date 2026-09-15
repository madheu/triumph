# 产品事件字典 v1.1 · 15 个转化事件与两段漏斗（D4）

> 建立：2026-09-03（D4）｜修订：2026-09-10（v1.1）  
> 状态：**已实施并在线上运行**。v1.0 的接入代码自 2026-09-03 起生效，  
> 至 09-10 累计 215 条事件（21 个访客 / 30 个会话）。  
> 配套：`site/js/tracking.js`（埋点层）、`site/js/signup-hook.js`（诊断页接线）、  
> `site/js/login-tracking.js`（注册页接线）、`site/js/upgrade-tracking.js`（付费页接线）、  
> `worker-src/events.mjs`（接收端点）、`drafts/2026-09-03-product-events-schema.sql`（表结构）



---


## v1.1 修订摘要（2026-09-10）

对生产库直查后发现：**埋点在跑，但有 6 处缺陷让数据不可用**。这些都是静默失败 ——  
前端不报错、后端返回 200、表里也有行，只是字段是空的或语义是错的。  
逐条修复，每条都有对应的回归测试（`test/product-events.test.mjs`）。

| # | 缺陷                                | 证据（生产数据）                                  | 修法                                                                                                                               |
| - | --------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 1 | `elapsed_ms` 恒为 0                 | 106/106 条 question_answer 全为 0，**零 NULL** | `Number(null) === 0` 把缺失值写成了 0。先挡缺失值再校验范围（`events.mjs`）                                                                          |
| 2 | `result_view` 触发率 12.5%           | `test_complete` 16 条，`result_view` 仅 2 条  | `observeOnce` 写死 `threshold: 0.5`，而 `.report` 远高于视口，ratio 上限只有「视口高/元素高」。改为按元素高度自适应                                               |
| 3 | `return_visit` 语义错                | 同一访客 span_hours 出现 0 和 1                  | 原按 session（30 分钟）判定，与字典「> 24h」不符。改为显式比较 `ld_last_visit` 时间戳                                                                      |
| 4 | `correct` / `question_id` 全空      | 106/106 为 NULL                            | 原在点选项后 80ms 读 `.opt.correct`，但该 class 只在 `answered=true` 后才由 React 渲染。改挂到「Next」按钮的捕获阶段（该按钮 `disabled={!answered}`，能点到必然已 reveal） |
| 5 | `content_domain` 存的是 subtest code | 值是 `"5004"` 这类，不是领域名                      | 改为按题干反查题库取 `category`（题库 969 题，题干 969/969 唯一）                                                                                    |
| 6 | `test_start` 被重复埋点                | 同一访客同一秒两条，两个不同 attempt_id                 | diagnostic 内联脚本与 signup-hook 各发一次。统一由内联脚本负责，signup-hook 不再重复                                                                     |

另外新增**付费漏斗 3 个事件**（原 12 个止于 `signup_success`，注册之后整段是黑的，  
转化优化里的付费点与价格锚点做完无法判断效果），D1 的 CHECK 约束已迁移。

**一处口径变更**：`signup_method` 原为 `magic_code`，统一为字典口径 `email_code`  
（它同时也是 login.html 的 密码+验证码 注册路径；`signup_success` 此前恒为 0，无历史包袱）。

---

## 0. 背景与要解决的问题

现状：只知道「4 人完成测试、0 注册」。看不到漏点在哪一步。

现有埋点盘点（全站）：

| 位置                         | 现状                                                             |
| -------------------------- | -------------------------------------------------------------- |
| `site/js/auth.js`          | `gtag("event","sign_up",{method:"email"})` —— **仅此一处**         |
| `worker-src/analytics.mjs` | `/api/t/attempts`，写 `attempts_daily` 表 —— **需登录**，匿名漏斗前四段完全不可见 |
| `site/diagnostic.html`     | GA4 基础配置（G-MSR1Q1G7W9），无自定义事件                                  |

**结论：漏斗前四段（页面访问 → 开始 → 完成 → 看见注册提示）零埋点。**  
这意味着「没人愿意做测试」和「做完了没看见注册入口」在数据上完全无法区分——而这两种情况的修法完全不同。

---

## 1. 双写架构

事件同时写两个地方，各司其职：

```
                    ┌─────────────► GA4 (gtag)
   页面行为 ──► tracking.js
                    └─────────────► POST /api/t/events ──► D1 product_events 表
```

|     | GA4                                                     | 自有 D1 表                                                |
| --- | ------------------------------------------------------- | ------------------------------------------------------ |
| 作用  | 与 GSC / 流量侧对齐，`traffic_source` 天然可得，用于看「哪来的流量转化好」       | 精确漏斗，不采样、不保留期限制，可按 `test_code` × `traffic_source` 自由交叉 |
| 限制  | 有采样（探索报表上限 10M 事件/查询）、自定义维度仅 50 个且需逐个注册、**数据保留默认 2 个月** | 无                                                      |
| 必需性 | 有（要与 GSC 打通）                                            | 有（D4 明确要求「GSC 之外有独立的产品事件看板」）                           |

**为什么不只用 GA4：** 漏斗需要按 `test_code` 与 `traffic_source` 分别拆开看，GA4 里这两个都得注册为自定义维度才能进报表，且交叉分析受采样影响。自有表可任意查询。

---


## 2. 事件字典（15 个）

命名统一 snake_case，以字母开头，仅含字母数字下划线（GA4 硬限制）。

| #  | 事件名                  | 触发时机（精确定义，避免歧义）                                                                               | 必带属性                                                     | GA4 事件名              | Key Event |
| -- | -------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------- | -------------------- | --------- |
| 1  | `test_view`          | 测试页 DOM 就绪且测试区进入视口（`IntersectionObserver` 命中一次即触发，不重复）                                        | page, test_code, traffic_source, device                  | `test_view`          | —         |
| 2  | `test_start`         | 用户点击「Start」，第一题完成渲染                                                                           | ↑ + attempt_id                                           | `test_start`         | —         |
| 3  | `question_answer`    | 每题提交答案时（含「Reveal answer」也算一次作答）                                                               | ↑ + question_id, **content_domain**, correct, elapsed_ms | `question_answer`    | —         |
| 4  | `test_complete`      | 最后一题作答完成，结果计算完毕（**早于** result_view）                                                           | ↑ + score_pct, score_band, weakest_domain                | `test_complete`      | ✅         |
| 5  | `result_view`        | 结果区域渲染完成且可见                                                                                   | ↑                                                        | `result_view`        | —         |
| 6  | `signup_prompt_view` | 注册提示区进入视口                                                                                     | ↑                                                        | `signup_prompt_view` | —         |
| 7  | `signup_start`       | 邮箱输入框首次获得焦点**或**点击主 CTA                                                                       | ↑                                                        | `signup_start`       | —         |
| 8  | `signup_success`     | 注册成功（邮箱验证通过，token 落地）                                                                         | ↑ + signup_method, user_id                               | `sign_up`（保留名，见 §6）  | ✅         |
| 9  | `study_plan_unlock`  | 完整学习计划首次解锁渲染                                                                                  | ↑ + plan_days                                            | `study_plan_unlock`  | ✅         |
| 10 | `return_visit`       | 距上次访问 > 24h 且本地存在历史结果，页面加载时触发一次                                                               | ↑ + days_since_last, has_saved_result                    | `return_visit`       | —         |
| 11 | `retest_start`       | 已注册用户在结果页点击「New diagnostic」/「Retake」                                                          | ↑ + days_since_last_test                                 | `retest_start`       | —         |
| 12 | `share_click`        | 点击任一分享按钮（含 X / Facebook / 复制链接 / native share）                                                | ↑ + share_target                                         | `share_click`        | —         |
| 13 | `upgrade_view`       | 升级页（`/upgrade.html`）加载完成                                                                      | page, traffic_source, device                             | `view_promotion`     | —         |
| 14 | `checkout_start`     | 点「Upgrade to Pro」**且已登录**（真的会跳去 Creem）。未登录时该按钮只是把人送去登录页，不算发起结账                                | ↑ + plan, price, currency                                | `begin_checkout`     | ✅         |
| 15 | `purchase_success`   | 以 `?pro=1` 回跳到升级页。该标记由升级页自身的轮询脚本在 `/api/me` 确认 `plan=pro` **之后**才附加 —— 等价于「后端已确认收款」，不是用户自称付过款 | ↑                                                        | `purchase`           | ✅         |

**Key Event 只选 4 个**（`test_complete` / `sign_up` / `study_plan_unlock` / `purchase`）。  
全部标记会稀释信号，且 GA4 标准版上限 30 个。

### 关键定义的歧义排除

- **`test_view` vs `page_view`**：GA4 自动采 `page_view`。`test_view` 是额外的「测试区可见」信号，用于区分「页面打开了但没看到测试」（长页面滚动率低时这两个数会明显不同）。
- **`test_complete` vs `result_view`**：分开是为了抓「算完了但结果没渲染出来」的技术故障。正常情况下两者应几乎 1:1；若 `test_complete` >> `result_view`，是 bug 不是用户行为。
- **`signup_prompt_view` 用视口判定**：不用「页面渲染」判定。注册提示若在折叠下方，用户没滚到就是没看见——这正是要测的东西。

---

## 3. 属性字典

### 3.1 D4 指定的 7 个

| 属性               | 类型     | 取值                                                              | 取值来源                           |
| ---------------- | ------ | --------------------------------------------------------------- | ------------------------------ |
| `page`           | string | `diagnostic` / `practice` / `praxis-8006-teaching-reading` / …  | `location.pathname` 归一化        |
| `test_code`      | string | `5001` / `8006` / …（字符串，避免前导零与类型问题）                             | 页面常量，不猜                        |
| `traffic_source` | string | `organic` / `direct` / `social` / `referral` / `email` / `paid` | **首次访问时固化**到 localStorage，见 §4 |
| `device`         | string | `mobile` / `tablet` / `desktop`                                 | viewport 宽度断点                  |
| `score_band`     | string | `0-39` / `40-59` / `60-74` / `75-89` / `90-100`                 | 见下方说明                          |
| `weakest_domain` | string | 官方领域名，如 `Foundational Literacy Skills`；并列或无法判定时为 `undetermined` | 结果计算逻辑                         |
| `signup_method`  | string | `email_code` / `magic_link` / `google`                          | 注册流程分支                         |

**`score_band` 为什么用正确率分档，不用 scaled score 区间：**

本站不提供 scaled score 换算（ETS 未公布 8006 换算表，见 D6 内容稿）。若 `score_band` 用 `140-160` 这类区间命名，等于在数据层暗示我们能把正确率映射成分数——这是站内口径不一致的起点，也会让后续读数据的人误以为有换算能力。

用正确率分档，语义清晰且与对外承诺一致。

### 3.2 实现必需的补充属性

| 属性                | 类型            | 说明                                                                          |
| ----------------- | ------------- | --------------------------------------------------------------------------- |
| `visitor_id`      | string        | 匿名访客 ID，UUIDv4，localStorage 持久化。跨会话识别回访用                                    |
| `session_id`      | string        | 单次会话 ID，30 分钟无活动则轮换                                                         |
| `user_id`         | string | null | 注册后填入，用于匿名 → 登录身份缝合                                                         |
| `attempt_id`      | string        | 一次测试的 ID，串联 `test_start` → `question_answer` × N → `test_complete`          |
| `question_id`     | string        | `question_answer` 专用                                                        |
| `content_domain`  | string        | `question_answer` 专用。**D4 明确要求**：月底用它算「哪个领域最常成为 weakest domain」，决定 10 月扩哪一科 |
| `correct`         | boolean       | `question_answer` 专用                                                        |
| `elapsed_ms`      | integer       | `question_answer` 专用，用于识别「秒答」（可能是乱点）                                        |
| `days_since_last` | integer       | `return_visit` / `retest_start` 专用                                          |

**GA4 参数上限 25 个/事件**，上表单事件最多带 12 个，余量充足。

---

## 4. `traffic_source` 的固化（易错点）

漏斗后几步发生在同一域内，`document.referrer` 会变成站内地址。若在注册时才读 referrer，所有注册都会被归为 `direct`，漏斗第五段按来源拆分直接失效。

**做法：** 首次访问时（无 `ld_visitor` 时）判定一次，写入 localStorage，后续所有事件读这个值。

判定顺序：

1. URL 有 `utm_source` / `utm_medium` → 按 `utm_medium` 映射（`cpc`/`paid` → `paid`；`email` → `email`；`social` → `social`）
2. 有 `gclid` / `fbclid` → `paid`
3. `document.referrer` 含 google / bing / duckduckgo / yahoo → `organic`
4. `document.referrer` 含 facebook / instagram / pinterest / reddit / x.com / twitter → `social`
5. `document.referrer` 为空 → `direct`
6. 其他 → `referral`

---

## 5. 漏斗定义与查询

### 5.1 获客段（匿名 → 注册，5 段）

```
段1  页面访问 (test_view)      →  开始测试 (test_start)
段2  开始测试 (test_start)     →  完成测试 (test_complete)
段3  完成测试 (test_complete)  →  看见注册提示 (signup_prompt_view)
段4  看见提示 (signup_prompt_view) → 开始注册 (signup_start)
段5  开始注册 (signup_start)   →  注册成功 (signup_success)
```

### 5.2 付费段（注册 → 付费，3 段，v1.1 新增）

```
段6  注册成功 (signup_success) →  看见升级页 (upgrade_view)
段7  看见升级页 (upgrade_view) →  发起结账 (checkout_start)
段8  发起结账 (checkout_start) →  支付成功 (purchase_success)
```

**为什么必须和获客段分开算**：去重单位不同。获客段用 `visitor_id`（段 3–5 用  
`attempt_id`），付费段只能用 `user_id` —— 付费的前提是已有账号，匿名访客无法进入  
付费段。把两段硬拼成一条 8 段漏斗，分母会在注册那一跳从「访客数」变成「用户数」，  
得到的比率没有意义。

**付费段的已知盲区**：`checkout_start` 需要登录态才能归因到 `user_id`。  
未登录访客点了「Upgrade to Pro」会被送去登录页，这次点击不计入 —— 这是有意为之，  
因为「被送去登录」和「真的发起结账」是两件事。若要观测前者，用 GA4 的  
`begin_checkout` 计数即可（它不带身份）。

**口径定义（必须先定，否则数对不上）：**

- **去重单位**：段 1–2 用 `visitor_id`；段 3–5 用 `attempt_id`（同一访客可能做多次测试）。
- **顺序约束**：后段事件必须时间戳晚于前段，且属于同一 `attempt_id`。
- **时间窗**：默认 24h。跨天完成的测试计入开始日（避免分母漂移）。
- **段 3 的陷阱**：`signup_prompt_view` 早于 `test_complete` 出现（如页面静态渲染了提示区）时，不计入段 3 分子。这是「看见了但还没做完」的无效曝光。


### 查询示例（D1 / SQLite）

```sql
-- 五段漏斗，按 test_code 拆分
WITH ev AS (
  SELECT attempt_id, visitor_id, test_code, traffic_source, event, MIN(ts) AS ts
  FROM product_events
  WHERE ts >= :since AND ts < :until
    AND event IN ('test_view','test_start','test_complete',
                  'signup_prompt_view','signup_start','signup_success')
  GROUP BY attempt_id, visitor_id, test_code, traffic_source, event
),
piv AS (
  SELECT
    attempt_id, test_code, traffic_source,
    MAX(CASE WHEN event='test_view'          THEN ts END) AS t1,
    MAX(CASE WHEN event='test_start'         THEN ts END) AS t2,
    MAX(CASE WHEN event='test_complete'      THEN ts END) AS t3,
    MAX(CASE WHEN event='signup_prompt_view' THEN ts END) AS t4,
    MAX(CASE WHEN event='signup_start'       THEN ts END) AS t5,
    MAX(CASE WHEN event='signup_success'     THEN ts END) AS t6
  FROM ev GROUP BY attempt_id, test_code, traffic_source
)
SELECT
  test_code,
  COUNT(*)                                                     AS stage1_view,
  SUM(CASE WHEN t2 IS NOT NULL AND t2 >= t1 THEN 1 ELSE 0 END) AS stage2_start,
  SUM(CASE WHEN t3 IS NOT NULL AND t3 >= t2 THEN 1 ELSE 0 END) AS stage3_complete,
  SUM(CASE WHEN t4 IS NOT NULL AND t4 >= t3 THEN 1 ELSE 0 END) AS stage4_prompt,
  SUM(CASE WHEN t5 IS NOT NULL AND t5 >= t4 THEN 1 ELSE 0 END) AS stage5_signup_start,
  SUM(CASE WHEN t6 IS NOT NULL AND t6 >= t5 THEN 1 ELSE 0 END) AS stage6_success
FROM piv
GROUP BY test_code;
```

按 `traffic_source` 拆分只需把 `test_code` 换成 `traffic_source`，或两者都放进去做交叉。


### 付费段查询（按 user_id 串）

```sql
-- 注册 → 付费三段漏斗。以 user_id 为去重单位，时间窗建议 30 天
-- （注册到付费可能跨周，24h 窗口会把真实转化漏掉）。
WITH ev AS (
  SELECT user_id, event, MIN(ts) AS ts
  FROM product_events
  WHERE ts >= :since AND ts < :until
    AND user_id IS NOT NULL
    AND event IN ('signup_success','upgrade_view','checkout_start','purchase_success')
  GROUP BY user_id, event
),
piv AS (
  SELECT user_id,
    MAX(CASE WHEN event='signup_success'  THEN ts END) AS t1,
    MAX(CASE WHEN event='upgrade_view'    THEN ts END) AS t2,
    MAX(CASE WHEN event='checkout_start'  THEN ts END) AS t3,
    MAX(CASE WHEN event='purchase_success' THEN ts END) AS t4
  FROM ev GROUP BY user_id
)
SELECT
  COUNT(*)                                                        AS registered,
  SUM(CASE WHEN t2 >= t1 THEN 1 ELSE 0 END)                       AS saw_upgrade,
  SUM(CASE WHEN t3 >= t2 THEN 1 ELSE 0 END)                       AS started_checkout,
  SUM(CASE WHEN t4 >= t3 THEN 1 ELSE 0 END)                       AS paid
FROM piv;
```

```sql
-- 每一段单独看流失，定位卡在哪一步（也用于判断 P1 阶段的付费点改动是否有效）
SELECT event, COUNT(DISTINCT user_id) AS users
FROM product_events
WHERE event IN ('upgrade_view','checkout_start','purchase_success')
  AND ts >= :since
GROUP BY event;
```

**读这两个数要注意**：`orders` / `subscriptions` 两张 D1 表是**权威**的收款记录  
（由 Creem webhook 写入），`product_events` 里的 `purchase_success` 是**前端观测**。  
两者不一致时（比如用户付款后立刻关了页面），以 orders 为准 ——  
它对应的是真金白银，前端只反映「用户在页面上看到了什么」。

### 月底的领域分析（决定 10 月扩哪一科）

```sql
-- 哪个领域最常成为 weakest domain
SELECT content_domain AS weakest_domain, COUNT(DISTINCT attempt_id) AS n
FROM product_events
WHERE event = 'test_complete'
GROUP BY content_domain
ORDER BY n DESC;

-- 交叉验证：该领域的实际正确率是否也最低
SELECT content_domain,
       SUM(CASE WHEN correct THEN 1 ELSE 0 END) * 1.0 / COUNT(*) AS accuracy
FROM product_events
WHERE event = 'question_answer'
GROUP BY content_domain
ORDER BY accuracy ASC;
```

两条查询结论一致才可信。仅「最常成为最弱」但正确率不低，可能是该领域题少或波动大。

---

## 6. GA4 侧必须做的配置（不做 = 白埋）

| # | 配置项               | 位置                                     | 说明                                                                                                                                                         |
| - | ----------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 | 注册事件级自定义维度        | Admin → Custom definitions             | `page`、`test_code`、`traffic_source`、`device`、`score_band`、`weakest_domain`、`signup_method`、`content_domain`、`attempt_id`、`visitor_id` —— **共 10 个**（上限 50） |
| 2 | 数据保留期改为 **14 个月** | Admin → Data settings → Data retention | **默认是 2 个月**。不改成 14 个月，9 月的数据到 11 月就查不到了，D28/D29 的季度对比会断                                                                                                   |
| 3 | 标记 3 个 Key Event  | Admin → Events                         | `test_complete`、`sign_up`、`study_plan_unlock`                                                                                                              |
| 4 | 检查内部流量过滤          | Admin → Data filters                   | 老户自己测试时若开了过滤，开发期调成 Testing 模式，否则本地测试事件全丢                                                                                                                   |

⚠️ **参数不注册为自定义维度，数据能收到但进不了报表。** 这是最常见的埋点失败原因：DebugView 里看得到参数，报表里就是没有。

### 保留事件名冲突

现有 `site/js/auth.js` 用 `gtag("event","sign_up")` —— `sign_up` 是 GA4 **推荐事件名**（保留）。

处置：**GA4 侧继续用 `sign_up`**（保留名有生态价值，可被 Google Ads 识别），自有表用 `signup_success`。两者一一对应，在查询侧做映射，不重复计数。

**不要**把自有事件改名成 `sign_up` 之外的名字再发给 GA4，也不要给 GA4 发两个注册成功事件（会双计）。

### PII 红线

**不得向 GA4 发送 email、姓名、电话等 PII。** GA4 会拒绝含 PII 特征的事件，且有合规风险。注册成功事件只发 `signup_method`，不发邮箱。`user_id` 用内部 UUID，不用邮箱。

---

## 7. 验收标准（D4 DoD）

- [x] 事件全部上报（`product_events` 表逐条确认，截至 2026-09-10 共 215 条）
- [x] 获客段漏斗能按 `test_code` 拆分
- [x] 获客段漏斗能按 `traffic_source` 拆分（实测 direct 15 人 / paid 6 人）
- [x] `question_answer` 事件带 `content_domain`（v1.1 起为真实领域名）
- [x] 付费段漏斗三个事件已接入并用 D1 迁移放行
- [ ] GA4 侧 13 个自定义维度已注册，报表可见 —— **待老户在 GA4 Admin 操作**
- [ ] GA4 数据保留期已改为 14 个月 —— **待老户在 GA4 Admin 操作**
- [ ] GSC 之外存在独立产品事件看板（`/api/admin/analytics/funnel` 或等效页面）
- [x] 匿名 → 登录身份缝合生效（`signup_success` 到达时按 `visitor_id` 回填 `user_id`）

最后一条最难也最容易被跳过：若 `visitor_id` 与 `user_id` 不缝合，注册转化率会永远显示为 0，因为「看广告进来的人」和「注册的人」在数据上是两个身份。

**v1.1 补充的验收项**（全部有回归测试覆盖，见 `test/product-events.test.mjs`）：

- [x] `elapsed_ms` 缺省写 NULL 而非 0
- [x] `observeOnce` 阈值按元素高度自适应
- [x] `return_visit` 按 24h 判定
- [x] `question_answer` 的 `correct` / `question_id` / `content_domain` 有值
- [x] `test_start` / `test_complete` 不再重复上报
- [x] 事件白名单三处同步（tracking.js = events.mjs = D1 CHECK）

---

## 8. 实施前置依赖

| 依赖              | 状态                      | 说明                                                                                                       |
| --------------- | ----------------------- | -------------------------------------------------------------------------------------------------------- |
| 仓库未提交改动         | ⚠️ **110 个**（含已 staged） | 其中含 `site/js/auth.js`、`site/diagnostic.html`、`site/_worker.js` —— 正是本方案要改/接入的文件。**必须等其他会话提交后再实施**，否则互相覆盖 |
| D1 建表权限         | 待确认                     | `product_events` 表需 `wrangler d1 execute` 执行                                                             |
| GA4 后台 Admin 权限 | 待确认                     | 自定义维度注册需 Admin                                                                                           |

---

## 9. 本轮未做的事

- 未修改任何现有代码文件（AGENT.md 第 4 节）
- 未建表、未执行任何 DDL
- 未改 GA4 配置
- 未部署

产出为**方案 + 草案**，落 `docs/` 与 `drafts/`，等批准后实施。
