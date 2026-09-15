-- product_events · v1.1 事件字典迁移（付费漏斗）
--
-- 执行日期：2026-09-10
-- 背景：原 CHECK 约束把事件名硬锁在 12 个。付费漏斗要新增
--       upgrade_view / checkout_start / purchase_success，
--       不加就写不进去 —— events.mjs 会返回 "no valid events"，
--       前端 sendBeacon 静默丢弃，埋点等于没做。
--
-- SQLite 不支持 ALTER TABLE ... DROP CONSTRAINT，只能重建表。
-- 全程在一个事务内完成，其他连接看不到中间态。
-- 迁移前已导出备份：db/backup-product_events-20260910.{json,sql}
--
-- 回滚方式：从上述 .sql 备份重建（DROP 后回灌）。

BEGIN;

CREATE TABLE product_events_new (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,

  event_uuid     TEXT    NOT NULL UNIQUE,   -- 客户端生成，幂等键
  event          TEXT    NOT NULL,
  ts             INTEGER NOT NULL,          -- 客户端事件时间（ms）
  server_ts      INTEGER NOT NULL,          -- 服务端接收时间（ms）

  visitor_id     TEXT,
  session_id     TEXT,
  user_id        TEXT,

  attempt_id     TEXT,
  page           TEXT,
  test_code      TEXT,
  traffic_source TEXT,
  device         TEXT,

  score_band     TEXT,
  weakest_domain TEXT,
  signup_method  TEXT,

  content_domain TEXT,
  question_id    TEXT,
  correct        INTEGER,
  elapsed_ms     INTEGER,

  extra_json     TEXT,

  -- v1.1：12 个原有事件 + 3 个付费漏斗事件
  CHECK (event IN (
    'test_view', 'test_start', 'question_answer', 'test_complete',
    'result_view', 'signup_prompt_view', 'signup_start', 'signup_success',
    'study_plan_unlock', 'return_visit', 'retest_start', 'share_click',
    'upgrade_view', 'checkout_start', 'purchase_success'
  ))
);

INSERT INTO product_events_new SELECT * FROM product_events;

DROP TABLE product_events;

ALTER TABLE product_events_new RENAME TO product_events;

CREATE INDEX IF NOT EXISTS idx_pe_event_ts  ON product_events(event, ts);
CREATE INDEX IF NOT EXISTS idx_pe_attempt   ON product_events(attempt_id);
CREATE INDEX IF NOT EXISTS idx_pe_visitor   ON product_events(visitor_id);
CREATE INDEX IF NOT EXISTS idx_pe_user      ON product_events(user_id);
CREATE INDEX IF NOT EXISTS idx_pe_tc_event  ON product_events(test_code, event);
CREATE INDEX IF NOT EXISTS idx_pe_src_event ON product_events(traffic_source, event);
CREATE INDEX IF NOT EXISTS idx_pe_domain    ON product_events(content_domain, event);

COMMIT;
