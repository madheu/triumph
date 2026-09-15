// worker-src/events.mjs — anonymous product-event ingestion (D4).
//
// Receives batches from site/js/tracking.js (LDTrack) and lands them in the
// product_events D1 table (DDL: drafts/2026-09-03-product-events-schema.sql,
// executed on prod 2026-09-03). This closes the funnel blind spot: the first
// four funnel stages (view → start → answer → result) are all anonymous, and
// the existing /api/t/attempts endpoint requires login.
//
// Hard rules:
//   - No auth by design (anonymous funnel), but event names are allowlisted and
//     batch size capped so this cannot become a free-form write endpoint.
//   - event_uuid is the idempotency key (client-generated). INSERT OR IGNORE
//     makes retries and sendBeacon double-fires harmless.
//   - PII must never land here. tracking.js strips user_id/email before send;
//     this endpoint additionally caps every text field.

import { json, apiError, readJsonBody } from './http.mjs';

const ALLOWED_EVENTS = new Set([
  'test_view', 'test_start', 'question_answer', 'test_complete',
  'result_view', 'signup_prompt_view', 'signup_start', 'signup_success',
  'study_plan_unlock', 'return_visit', 'retest_start', 'share_click',
  // v1.1 付费漏斗。与 site/js/tracking.js 的 EVENTS、
  // D1 product_events 的 CHECK 约束三处必须同步，漏一处事件就被静默丢弃。
  'upgrade_view', 'checkout_start', 'purchase_success',
]);

const MAX_BATCH = 25;
const MAX_TEXT = 128;

function opt(v, cap = MAX_TEXT) {
  if (v === undefined || v === null) return null;
  const s = String(v).slice(0, cap);
  return s.length ? s : null;
}

function bool01(v) {
  if (v === true) return 1;
  if (v === false) return 0;
  return null;
}

export async function hEvents(request, env) {
  if (!env.TRIUMPH_D1) return apiError('not_configured', { hint: 'D1 binding missing' });
  const parsed = await readJsonBody(request);
  if (parsed.err) return parsed.err;
  const events = Array.isArray(parsed.body.events) ? parsed.body.events : [];
  if (!events.length) return apiError('bad_request', { field: 'events', hint: 'expected non-empty array' });
  if (events.length > MAX_BATCH) return apiError('bad_request', { field: 'events', hint: `max ${MAX_BATCH} per batch` });

  const sql = `INSERT OR IGNORE INTO product_events
    (event_uuid, event, ts, server_ts, visitor_id, session_id, user_id, attempt_id,
     page, test_code, traffic_source, device, score_band, weakest_domain,
     signup_method, content_domain, question_id, correct, elapsed_ms, extra_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

  const now = Date.now();
  const stmts = [];
  // 身份缝合作业：signup_success 到达时收集，INSERT 之后统一回填。
  // 不回填的话，注册前那些匿名事件（test_start / test_complete ...）永远带不上
  // user_id，"注册用户两周后有没有回来重测"这类以账号为主体的分析就查不出来。
  // 漏斗本身用 visitor_id 串，不依赖这一步 —— 缺它损失的是账号视角，不是转化率。
  const stitches = [];
  for (const e of events) {
    if (!e || typeof e !== 'object') continue;
    if (!ALLOWED_EVENTS.has(e.event)) continue;
    if (!e.event_uuid || typeof e.event_uuid !== 'string') continue;
    if (e.event === 'signup_success' && e.user_id && e.visitor_id) {
      stitches.push([opt(e.user_id, 64), opt(e.visitor_id, 64)]);
    }
    let ts = Number(e.ts);
    if (!Number.isFinite(ts) || ts <= 0 || ts > now + 60000) ts = now;
    // Number(null) === 0 —— 直接 Number() 会把「调用方没提供耗时」写成 0，
    // 于是「未知」和「0ms 秒答」在数据里变成同一个值，秒答识别直接失效。
    // 先挡掉缺失值，再只对真正的数字做范围校验。
    let elapsed = null;
    if (e.elapsed_ms !== null && e.elapsed_ms !== undefined && e.elapsed_ms !== '') {
      elapsed = Number(e.elapsed_ms);
      if (!Number.isFinite(elapsed) || elapsed < 0) elapsed = null;
      else if (elapsed > 3600000) elapsed = 3600000;
    }
    stmts.push(env.TRIUMPH_D1.prepare(sql).bind(
      e.event_uuid.slice(0, 64),
      e.event,
      Math.round(ts),
      now,
      opt(e.visitor_id, 64),
      opt(e.session_id, 64),
      opt(e.user_id, 64),
      opt(e.attempt_id, 64),
      opt(e.page),
      opt(e.test_code, 16),
      opt(e.traffic_source, 32),
      opt(e.device, 16),
      opt(e.score_band, 16),
      opt(e.weakest_domain, 64),
      opt(e.signup_method, 16),
      opt(e.content_domain, 64),
      opt(e.question_id, 64),
      bool01(e.correct),
      elapsed === null ? null : Math.round(elapsed),
      e.extra ? JSON.stringify(e.extra).slice(0, 2000) : null,
    ));
  }

  if (!stmts.length) return apiError('bad_request', { hint: 'no valid events in batch' });

  // 只回填同一 visitor_id 下、尚未归属任何账号的事件。
  // 跨设备无法回填（不同设备不同 visitor_id），这是匿名埋点的固有边界，不是缺陷 ——
  // 跨设备恢复由 D3 的 magic link 链路负责，不靠埋点。
  for (const [uid, vid] of stitches) {
    if (!uid || !vid) continue;
    stmts.push(
      env.TRIUMPH_D1
        .prepare('UPDATE product_events SET user_id = ? WHERE visitor_id = ? AND user_id IS NULL')
        .bind(uid, vid),
    );
  }

  await env.TRIUMPH_D1.batch(stmts);
  return json({ accepted: stmts.length - stitches.length, stitched: stitches.length });
}

export const EVENT_ROUTES = {
  '/api/t/events': { POST: hEvents },
};
