-- product_events · 产品事件流表（D4）
--
-- 状态：**已于 2026-09-03 23:30 对生产库 triumph_db 执行**（老户批准"现在跑"）。
-- 2026-09-10 更新至 v1.1：CHECK 约束加入 3 个付费漏斗事件。
--   增量迁移脚本：db/migrations/2026-09-10-product-events-v1.1.sql
--   迁移前备份：db/backup-product_events-20260910.{json,sql}
--   本文件的 CHECK 列表与迁移后的线上结构一致，新建库可直接用。
--
-- 设计取舍：
--   · 宽表而非 EAV。事件属性固定，宽表查询简单，D1 是 SQLite，列多不构成问题。
--   · 不建预聚合表。当前真实独立用户 < 30/月，直查 events 表毫秒级。
--     若日事件量超过 10 万再考虑 funnel_daily 预聚合，届时加表不改这张。
--   · event_uuid 客户端生成，服务端唯一约束做幂等 —— 批量上报重试不能双计。

CREATE TABLE IF NOT EXISTS product_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,

  -- 事件标识
  event_uuid     TEXT    NOT NULL UNIQUE,   -- 客户端生成，幂等键
  event          TEXT    NOT NULL,          -- 见 docs/analytics-events-v1.md §2
  ts             INTEGER NOT NULL,          -- 客户端事件时间（ms）
  server_ts      INTEGER NOT NULL,          -- 服务端接收时间（ms）

  -- 身份（匿名 → 登录缝合）
  visitor_id     TEXT,                      -- 匿名访客，localStorage 持久化
  session_id     TEXT,                      -- 单次会话，30 分钟轮换
  user_id        TEXT,                      -- 注册后回填；未登录为 NULL

  -- 上下文
  attempt_id     TEXT,                      -- 一次测试，串联 start→answer×N→complete
  page           TEXT,
  test_code      TEXT,
  traffic_source TEXT,
  device         TEXT,

  -- 结果相关
  score_band     TEXT,
  weakest_domain TEXT,
  signup_method  TEXT,

  -- 题目级
  content_domain TEXT,
  question_id    TEXT,
  correct        INTEGER,                   -- 0/1，仅 question_answer
  elapsed_ms     INTEGER,                   -- 仅 question_answer

  -- 扩展位（不在枚举里的属性放这里，避免频繁加列）
  extra_json     TEXT,

  -- 事件名硬约束：写错直接拒绝，防止脏数据污染漏斗。
  -- v1.1：12 个原有事件 + 3 个付费漏斗事件（upgrade_view / checkout_start /
  -- purchase_success）。三处必须同步：本文件、site/js/tracking.js 的 EVENTS、
  -- worker-src/events.mjs 的 ALLOWED_EVENTS —— 漏一处事件就被静默丢弃。
  CHECK (event IN (
    'test_view', 'test_start', 'question_answer', 'test_complete',
    'result_view', 'signup_prompt_view', 'signup_start', 'signup_success',
    'study_plan_unlock', 'return_visit', 'retest_start', 'share_click',
    'upgrade_view', 'checkout_start', 'purchase_success'
  ))
);

-- 查询模式与索引
-- 漏斗查询：按时间窗扫描 + 事件过滤
CREATE INDEX IF NOT EXISTS idx_pe_event_ts    ON product_events(event, ts);
-- 漏斗串联：同一 attempt 的全部事件
CREATE INDEX IF NOT EXISTS idx_pe_attempt     ON product_events(attempt_id);
-- 身份缝合与回访分析
CREATE INDEX IF NOT EXISTS idx_pe_visitor     ON product_events(visitor_id);
CREATE INDEX IF NOT EXISTS idx_pe_user        ON product_events(user_id);
-- 按 test_code 拆漏斗
CREATE INDEX IF NOT EXISTS idx_pe_tc_event    ON product_events(test_code, event);
-- 按 traffic_source 拆漏斗
CREATE INDEX IF NOT EXISTS idx_pe_src_event   ON product_events(traffic_source, event);
-- 月底领域分析（哪个领域最常成为 weakest domain）
CREATE INDEX IF NOT EXISTS idx_pe_domain      ON product_events(content_domain, event);

-- ---------------------------------------------------------------------------
-- 身份缝合：注册后把该 visitor 的历史匿名事件回填 user_id
--
-- 不回填的后果：注册转化率永远显示为 0 —— 「看广告进来的人」和「注册的人」
-- 在数据上是两个身份，漏斗第五段分子恒为空。这是 D4 最容易漏的一步。
--
-- 回填时机：signup_success 时执行。参数 ?1 = user_id，?2 = visitor_id
--
--   UPDATE product_events
--      SET user_id = ?1
--    WHERE visitor_id = ?2
--      AND user_id IS NULL;
--
-- 回填范围说明：只回填该 visitor_id 下同浏览器历史事件。跨设备无法回填
-- （不同设备不同 visitor_id），这是匿名埋点的固有限制，不是缺陷。
-- 跨设备恢复靠 D3 的注册链路（邮箱 → magic link → 账号），不靠埋点。
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 数据保留
--
-- 与 GA4 不同（GA4 默认 2 个月，需手动改 14 个月），D1 无自动清理。
-- 建议：product_events 保留 18 个月后按月归档删除，与 GA4 的 14 个月形成
-- 「近期两边可交叉验证、远期自有表可回溯」的格局。
--
-- 清理语句（手动执行，未自动化）：
--   DELETE FROM product_events WHERE server_ts < (strftime('%s','now') - 18*30*86400) * 1000;
-- ---------------------------------------------------------------------------
