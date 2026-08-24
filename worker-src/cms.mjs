// worker-src/cms.mjs — 公开内容读取 API（P2）
//
//   GET /api/tools              → 工具注册表（仅 enabled=1，按 sort 升序；audience 供前端做权益闸门）
//   GET /api/content?type=&slug=→ 已发布内容条目（仅 status='published'）
//
// 设计要点：
//   - 只读、无鉴权、带 CDN 缓存头（内容变更靠 updated_at 变化 + 短缓存窗口生效）
//   - audience 字段是权益闸门的"声明"：前端据此显示锁/解锁；真正拦截在工具自身加载时
//     由后端二次校验（P3 打通），这里先给数据。
//   - body_md 全量返回（内容量小；未来量大再加分页）

import { json, apiError } from './http.mjs';
import { d1All, d1One } from './db.mjs';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

/** GET /api/tools */
export async function hToolsList(request, env) {
  const rows = await d1All(env, `SELECT slug, name, description, icon, entry, audience, config_json FROM tools WHERE enabled = 1 ORDER BY sort ASC`);
  if (rows === null) return json({ ok: true, items: [], note: 'D1 not ready' });
  const items = rows.map(r => {
    let config = r.config_json;
    try { config = typeof r.config_json === 'string' ? JSON.parse(r.config_json) : (r.config_json || null); } catch { config = null; }
    return { ...r, config_json: undefined, config };
  });
  return json({ ok: true, items }, 200, { 'Cache-Control': 'public, max-age=120', ...CORS });
}

/** GET /api/content?type=plan&slug=morning-routine — 已发布内容（列表或单条） */
export async function hContentPublic(request, env) {
  const url = new URL(request.url);
  const type = (url.searchParams.get('type') || '').trim();
  const slug = (url.searchParams.get('slug') || '').trim();

  // 单条模式
  if (slug) {
    if (!/^[a-z0-9-]+$/.test(slug)) return apiError('bad_request', { field: 'slug' });
    const row = await d1One(env, `SELECT id, type, slug, title, body_md, meta_json, updated_at FROM content_items WHERE slug = ? AND status = 'published'`, [slug]);
    if (!row) return apiError('not_found', { field: 'slug' });
    let meta = row.meta_json;
    try { meta = typeof row.meta_json === 'string' ? JSON.parse(row.meta_json) : (row.meta_json || null); } catch { meta = null; }
    return json({ ok: true, item: { ...row, meta_json: undefined, meta } }, 200, { 'Cache-Control': 'public, max-age=120', ...CORS });
  }

  // 列表模式（可按 type 过滤；不返回 body_md 减少载荷）
  const rows = type
    ? await d1All(env, `SELECT id, type, slug, title, meta_json, updated_at FROM content_items WHERE status = 'published' AND type = ? ORDER BY updated_at DESC`, [type])
    : await d1All(env, `SELECT id, type, slug, title, meta_json, updated_at FROM content_items WHERE status = 'published' ORDER BY updated_at DESC`);
  if (rows === null) return json({ ok: true, items: [], note: 'D1 not ready' });
  const items = rows.map(r => {
    let meta = r.meta_json;
    try { meta = typeof r.meta_json === 'string' ? JSON.parse(r.meta_json) : (r.meta_json || null); } catch { meta = null; }
    return { ...r, meta_json: undefined, meta };
  });
  return json({ ok: true, items }, 200, { 'Cache-Control': 'public, max-age=120', ...CORS });
}

export const CMS_ROUTES = {
  '/api/tools': { GET: hToolsList },
  '/api/content': { GET: hContentPublic },
};
