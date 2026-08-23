-- Triumph D1 schema v1
-- 目标：后台管理 + 收银台的关系型数据层。
-- 说明：本文件由 `wrangler d1 execute triumph_db --file=db/schema.sql` 执行。
--       D1 是 Cloudflare 的 SQLite 兼容数据库；一张表 = 一个"格子柜"，行 = 一条记录。

-- 身份与权益 ------------------------------------------------------------

-- 用户（KV 里的 users:{email} 是权威，此表为后台查询用的镜像/延伸，含角色与订阅状态）
CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,             -- 与 KV users 的 id 一致（UUID）
  email        TEXT NOT NULL UNIQUE,
  role         TEXT NOT NULL DEFAULT 'user', -- 'user' | 'admin'（后台管理员）
  plan         TEXT NOT NULL DEFAULT 'free', -- 'free' | 'pro'
  subscription_status TEXT,                  -- active | past_due | canceled | expired | null
  current_period_end INTEGER,
  creem_customer_id TEXT,
  created_at   INTEGER,
  verified_at  INTEGER,
  kv_legacy    INTEGER DEFAULT 0             -- 1 = 数据仍以 KV 为准（迁移过渡期）
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- 订阅（Creem 订阅事件落这里；每用户可有历史多条，按 status 判断当前）
CREATE TABLE IF NOT EXISTS subscriptions (
  id                   TEXT PRIMARY KEY,
  user_id              TEXT NOT NULL,
  creem_subscription_id TEXT UNIQUE,
  status               TEXT,   -- active | past_due | canceled | expired
  plan                 TEXT,
  current_period_end   INTEGER,
  created_at           INTEGER,
  canceled_at          INTEGER
);
CREATE INDEX IF NOT EXISTS idx_subs_user ON subscriptions(user_id);

-- 订单 / 支付（payment 与 refund 同一张表，type 区分）
CREATE TABLE IF NOT EXISTS orders (
  id            TEXT PRIMARY KEY,
  user_id       TEXT,
  creem_order_id TEXT,
  amount_cents  INTEGER,
  currency      TEXT,
  type          TEXT,   -- 'payment' | 'refund'
  status        TEXT,   -- 与 Creem 同步：succeeded | refunded | ...
  raw_json      TEXT,   -- Creem 原始回调，审计用
  created_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);

-- Creem webhook 事件去重表（同一 event id 只处理一次）
CREATE TABLE IF NOT EXISTS webhook_events (
  id           TEXT PRIMARY KEY,  -- Creem event id
  type         TEXT,
  payload      TEXT,
  received_at  INTEGER,
  processed_at INTEGER
);

-- 工单与退款 ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tickets (
  id               TEXT PRIMARY KEY,
  user_id          TEXT,
  subject          TEXT,
  status           TEXT DEFAULT 'open',   -- open | pending | resolved
  refund_requested INTEGER DEFAULT 0,
  created_at       INTEGER,
  resolved_at      INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tickets_user ON tickets(user_id);

CREATE TABLE IF NOT EXISTS ticket_messages (
  id         TEXT PRIMARY KEY,
  ticket_id  TEXT NOT NULL,
  author     TEXT,   -- 'user' | 'admin'
  body       TEXT,
  created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tm_ticket ON ticket_messages(ticket_id);

CREATE TABLE IF NOT EXISTS refunds (
  id             TEXT PRIMARY KEY,
  order_id       TEXT,
  creem_refund_id TEXT,
  reason         TEXT,
  status         TEXT,     -- pending | approved | rejected | processed
  operator       TEXT,     -- 后台操作人（管理员邮箱）
  created_at     INTEGER
);

-- 内容与工具 ------------------------------------------------------------

-- 题库（P2 内容管理用；P1 之前先建表，题库主体仍走静态 assets）
CREATE TABLE IF NOT EXISTS questions (
  id             TEXT PRIMARY KEY,          -- 如 5002-001
  external_id    TEXT,                      -- 与 id 相同或旧题库 id
  subtest        TEXT,                      -- 5002/5003/5004/5005
  category       TEXT,
  difficulty     TEXT,                      -- easy | medium | hard
  type           TEXT,                      -- knowledge | ...
  stem_md        TEXT,                      -- 题干（原 question 字段）
  options_json   TEXT,                      -- JSON 数组
  answer_index   INTEGER,
  explanation_md TEXT,
  status         TEXT DEFAULT 'active',     -- draft | active | retired
  source_batch   TEXT,
  created_at     INTEGER,
  updated_at     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_q_subtest ON questions(subtest);
CREATE INDEX IF NOT EXISTS idx_q_cat     ON questions(category);
CREATE INDEX IF NOT EXISTS idx_q_status  ON questions(status);

-- 内容项（计划模板 / 知识地图 / 邮件文案等结构化内容；文章仍在 git/md）
CREATE TABLE IF NOT EXISTS content_items (
  id          TEXT PRIMARY KEY,
  type        TEXT,      -- plan | map | email | ...
  slug        TEXT UNIQUE,
  title       TEXT,
  status      TEXT DEFAULT 'draft',   -- draft | published
  body_md     TEXT,
  meta_json   TEXT,      -- 扩展字段（如 audience: free|pro）
  updated_by  TEXT,
  updated_at  INTEGER
);
CREATE TABLE IF NOT EXISTS content_revisions (
  id            TEXT PRIMARY KEY,
  item_id       TEXT NOT NULL,
  version       INTEGER,
  snapshot_json TEXT,   -- 每次保存的完整快照，可回滚
  edited_by     TEXT,
  created_at    INTEGER
);

-- 工具注册表（可插拔学习工具：开关、人群、配置）
CREATE TABLE IF NOT EXISTS tools (
  slug        TEXT PRIMARY KEY,
  name        TEXT,
  description TEXT,
  icon        TEXT,
  entry       TEXT,      -- 前端模块路径，如 /tools/fraction-drill/index.js
  audience    TEXT DEFAULT 'free',  -- free | pro
  enabled     INTEGER DEFAULT 0,
  sort        INTEGER DEFAULT 0,
  config_json TEXT,
  updated_at  INTEGER
);

-- 行为与审计 ------------------------------------------------------------

-- 做题正确率日汇总（精确统计，不受 Analytics Engine 采样影响）
CREATE TABLE IF NOT EXISTS attempts_daily (
  date      TEXT,       -- YYYY-MM-DD
  user_id   TEXT,
  subtest   TEXT,
  category  TEXT,
  attempted INTEGER DEFAULT 0,
  correct   INTEGER DEFAULT 0,
  PRIMARY KEY (date, user_id, subtest, category)
);

-- 后台操作审计（谁在什么时候对什么做了什么）
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id          TEXT PRIMARY KEY,
  actor       TEXT,      -- 操作者（管理员邮箱）
  action      TEXT,      -- e.g. user.reset_password, refund.approve
  target_type TEXT,      -- user | order | ticket | question | ...
  target_id   TEXT,
  detail_json TEXT,
  ts          INTEGER
);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON admin_audit_log(actor);
CREATE INDEX IF NOT EXISTS idx_audit_ts   ON admin_audit_log(ts);
