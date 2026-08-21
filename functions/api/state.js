// GET/PUT /api/state — 云端状态读写
import { json, verifyJwt, STATE_KEY } from './_shared.js';

async function auth(context) {
  const { request, env } = context;
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const user = token ? await verifyJwt(token, env.JWT_SECRET) : null;
  return user;
}

export async function onRequestGet(context) {
  const user = await auth(context);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const state = await context.env.TRIUMPH_KV.get(STATE_KEY(user.sub), 'json');
  return json({ state });
}

export async function onRequestPut(context) {
  const user = await auth(context);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const { request, env } = context;
  const body = await request.json().catch(() => ({}));
  const state = body.state || {};
  if (typeof state !== 'object') return json({ error: 'bad_state' }, 400);
  state.updatedAt = Date.now();
  await env.TRIUMPH_KV.put(STATE_KEY(user.sub), JSON.stringify(state));
  return json({ ok: true });
}
