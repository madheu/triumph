// POST /api/logout — 客户端删 token 即可，端点占位（保持接口完整）
import { json } from './_shared.js';

export async function onRequestPost() {
  return json({ ok: true });
}
