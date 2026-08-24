-- db/seed-tools.sql — 工具注册表种子数据（P2 首批示范）
-- 执行：wrangler d1 execute triumph_db --remote --file=db/seed-tools.sql
-- 说明：
--   - practice / srs 是现有页面改造为"插件示范"的第一批；entry 指向已有页面。
--   - diagnostic 是免费引流入口，永远 enabled。
--   - audience 字段是权益闸门声明：pro 工具前端显示锁定，后端 P3 打通硬拦截。
--   - 幂等：INSERT OR REPLACE（按主键 slug）。

INSERT OR REPLACE INTO tools (slug, name, description, icon, entry, audience, enabled, sort, config_json, updated_at) VALUES
  ('diagnostic', 'Level Diagnostic', 'Full-length readiness check across all four subtests. Predicts your pass probability.', '🎯', '/diagnostic.html', 'free', 1, 10, NULL, strftime('%s','now') * 1000),
  ('practice', 'Question Bank', 'Browse and drill 969 real-style questions by subject and knowledge point.', '📚', '/practice.html', 'free', 1, 20, '{"questions_total":969}', strftime('%s','now') * 1000),
  ('srs', 'Memory Cards (SRS)', 'Spaced-repetition flashcards that resurface weak knowledge points right before you forget them.', '🃏', '/srs.html', 'free', 1, 30, NULL, strftime('%s','now') * 1000);
