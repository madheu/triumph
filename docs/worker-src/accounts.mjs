// worker-src/accounts.mjs — account API handlers (Section 4 of the original
// site/_worker.js, ported verbatim).
// ------------------------------------------------------------------
// Success response shapes are unchanged from the original Pages Functions;
// only error responses are upgraded to the structured
// { error: { code, message, hint } } envelope (auth.js understands both).

import { json, apiError, ok, readJsonBody, safeFetch } from './http.mjs';
import { hashPassword, timingSafeEqual, signJwt, verifyJwt, bearerToken } from './crypto.mjs';

export const USER_KEY = email => `users:${email.toLowerCase().trim()}`;
export const STATE_KEY = id => `state:${id}`;
export const CODE_KEY = email => `verify:${email.toLowerCase().trim()}`;

// D3 core fix — merge two diagnostic states instead of letting one clobber the
// other. Before this function existed, hVerify unconditionally overwrote the
// server state with a fresh empty shell, silently destroying a user's completed
// diagnostic the moment they verified their account. The exact bug D3 exists to
// kill, one layer deeper than the frontend.
//
// Rule: the record with more answered questions wins; top-level keys of the
// richer record take precedence, the poorer record fills anything missing.
// Ties go to the server record. Both inputs may be null/invalid.
export function mergeStates(a, b) {
  const base = { createdAt: Date.now(), answers: [], mastery: {}, plan: null, srs: {}, tasks: {} };
  const A = (a && typeof a === 'object' && !Array.isArray(a)) ? a : null;
  const B = (b && typeof b === 'object' && !Array.isArray(b)) ? b : null;
  if (!A && !B) return base;
  if (!A) return { ...base, ...B };
  if (!B) return { ...base, ...A };
  const aAns = Array.isArray(A.answers) ? A.answers.length : Object.keys(A.answers || {}).length;
  const bAns = Array.isArray(B.answers) ? B.answers.length : Object.keys(B.answers || {}).length;
  const rich = bAns > aAns ? B : A;
  const poor = rich === A ? B : A;
  return { ...base, ...poor, ...rich };
}

function genCode() {
  let code = '';
  for (let i = 0; i < 6; i++) code += Math.floor(Math.random() * 10);
  return code;
}

async function sendVerificationEmail(env, email, code) {
  // Ported verbatim from functions/api/_shared.js
  const from = env.EMAIL_FROM || '';
  if (!from) throw new Error('EMAIL_FROM not configured');
  if (env.RESEND_API_KEY) {
    const res = await safeFetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + env.RESEND_API_KEY },
      body: JSON.stringify({
        from,
        to: [email],
        subject: 'Your Learndiag verification code',
        html: `<p>Your Learndiag verification code is:</p>
               <p style="font-size:28px;letter-spacing:4px;font-weight:bold;color:#A67D7A">${code}</p>
               <p>Enter this code to activate your account. It expires in 15 minutes.</p>
               <p style="color:#6E6760;font-size:12px">Learndiag · independent Praxis 5001 study tool · not affiliated with ETS</p>`,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error('resend_failed:' + res.status + (body ? ':' + body.slice(0, 300) : ''));
    }
    return true;
  }
  if (env.MAILGUN_API_KEY && env.MAILGUN_DOMAIN) {
    const form = new URLSearchParams();
    form.set('from', from);
    form.set('to', email);
    form.set('subject', 'Your Learndiag verification code');
    form.set('html', `<p>Your Learndiag verification code is:</p><p style="font-size:28px;letter-spacing:4px;font-weight:bold;color:#A67D7A">${code}</p><p>Expires in 15 minutes.</p>`);
    const res = await safeFetch(`https://api.mailgun.net/v3/${env.MAILGUN_DOMAIN}/messages`, {
      method: 'POST',
      headers: { 'Authorization': 'Basic ' + btoa('api:' + env.MAILGUN_API_KEY) },
      body: form,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error('mailgun_failed:' + res.status + (body ? ':' + body.slice(0, 300) : ''));
    }
    return true;
  }
  throw new Error('no_mail_provider');
}

async function hRegister(request, env) {
  const parsed = await readJsonBody(request);
  if (parsed.err) return parsed.err;
  const email = String(parsed.body.email || '').trim().toLowerCase();
  const password = String(parsed.body.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return apiError('invalid_email');
  if (password.length < 8) return apiError('password_too_short');

  let userId;
  const existingJson = await env.TRIUMPH_KV.get(USER_KEY(email));
  if (existingJson) {
    const existing = JSON.parse(existingJson);
    if (existing.verified) return apiError('email_taken');
    userId = existing.id;
  } else {
    userId = crypto.randomUUID();
  }

  const { saltHex, hashHex } = await hashPassword(password);
  await env.TRIUMPH_KV.put(USER_KEY(email), JSON.stringify({
    id: userId, email, saltHex, hashHex, verified: false, createdAt: Date.now(),
  }));

  const code = genCode();
  await env.TRIUMPH_KV.put(CODE_KEY(email), JSON.stringify({ code, exp: Date.now() + 15 * 60000, email }), { expirationTtl: 900 });

  try {
    await sendVerificationEmail(env, email, code);
    return json({ need_verify: true, message: 'Verification email sent.' });
  } catch (e) {
    return apiError('mail_failed', { email });
  }
}

async function hLogin(request, env) {
  const parsed = await readJsonBody(request);
  if (parsed.err) return parsed.err;
  const email = String(parsed.body.email || '').trim().toLowerCase();
  const password = String(parsed.body.password || '');

  const recJson = await env.TRIUMPH_KV.get(USER_KEY(email));
  if (!recJson) return apiError('invalid_credentials');
  const rec = JSON.parse(recJson);

  // Google-only accounts have no password hash — tell the user to sign in with
  // Google instead of failing with a confusing "incorrect password".
  if (!rec.hashHex && rec.googleSub) {
    return apiError('use_google', { email });
  }
  // Magic-only accounts (created via /api/magic, passwordless, D3) — same idea:
  // point them at the flow that actually works instead of "incorrect password".
  if (!rec.hashHex && rec.magicOnly) {
    return apiError('use_magic', { email });
  }

  const { hashHex } = await hashPassword(password, rec.saltHex);
  if (!timingSafeEqual(hashHex, rec.hashHex)) return apiError('invalid_credentials');
  if (!rec.verified) return apiError('not_verified', { email });

  const jwt = await signJwt({ sub: rec.id, email, iat: Date.now(), exp: Date.now() + 30 * 86400000 }, env.JWT_SECRET);
  return json({ token: jwt, user: { id: rec.id, email }, verified: true });
}

async function hVerify(request, env) {
  const parsed = await readJsonBody(request);
  if (parsed.err) return parsed.err;
  const email = String(parsed.body.email || '').trim().toLowerCase();
  const code = String(parsed.body.code || '').trim();

  const recJson = await env.TRIUMPH_KV.get(USER_KEY(email));
  if (!recJson) return apiError('not_registered');
  const rec = JSON.parse(recJson);
  if (rec.verified) return apiError('already_verified');

  const storedJson = await env.TRIUMPH_KV.get(CODE_KEY(email));
  if (!storedJson) return apiError('code_expired');
  const stored = JSON.parse(storedJson);
  if (!timingSafeEqual(stored.code, code)) return apiError('wrong_code');
  if (stored.exp < Date.now()) return apiError('code_expired');

  rec.verified = true;
  await env.TRIUMPH_KV.put(USER_KEY(email), JSON.stringify(rec));

  // D3 fix: the user may have completed the diagnostic BEFORE verifying (the
  // frontend now sends pending_state with this request). Merging — never
  // overwriting — is the whole point; this used to write a fresh empty state
  // and silently destroy their results.
  const serverState = await env.TRIUMPH_KV.get(STATE_KEY(rec.id), 'json').catch(() => null);
  const pendingState = (parsed.body.pending_state && typeof parsed.body.pending_state === 'object'
    && !Array.isArray(parsed.body.pending_state)) ? parsed.body.pending_state : null;
  const merged = mergeStates(serverState, pendingState);
  await env.TRIUMPH_KV.put(STATE_KEY(rec.id), JSON.stringify({ ...merged, updatedAt: Date.now() }));
  await env.TRIUMPH_KV.delete(CODE_KEY(email));

  const jwt = await signJwt({ sub: rec.id, email, iat: Date.now(), exp: Date.now() + 30 * 86400000 }, env.JWT_SECRET);
  return json({ token: jwt, user: { id: rec.id, email }, verified: true });
}

async function hResend(request, env) {
  const parsed = await readJsonBody(request);
  if (parsed.err) return parsed.err;
  const email = String(parsed.body.email || '').trim().toLowerCase();

  const recJson = await env.TRIUMPH_KV.get(USER_KEY(email));
  if (!recJson) return apiError('not_registered');
  const rec = JSON.parse(recJson);
  if (rec.verified) return apiError('already_verified');

  const code = genCode();
  await env.TRIUMPH_KV.put(CODE_KEY(email), JSON.stringify({ code, exp: Date.now() + 15 * 60000, email }), { expirationTtl: 900 });
  try {
    await sendVerificationEmail(env, email, code);
    return ok({});
  } catch (e) {
    return apiError('mail_failed', { email });
  }
}

async function hLogout() {
  return ok({});
}

async function hMe(request, env) {
  const user = await verifyJwt(bearerToken(request), env.JWT_SECRET);
  if (!user) return apiError('unauthorized');
  // 补充权益字段（订阅状态，来自 KV 用户记录；P1 起由 Creem webhook 写入）
  let plan = 'free';
  let subscriptionStatus = null;
  let currentPeriodEnd = null;
  const recJson = await env.TRIUMPH_KV.get(USER_KEY(user.email)).catch(() => null);
  if (recJson) {
    const rec = JSON.parse(recJson);
    plan = rec.plan || 'free';
    subscriptionStatus = rec.subscriptionStatus || null;
    currentPeriodEnd = rec.currentPeriodEnd || null;
  }
  return json({
    user: { id: user.sub, email: user.email },
    entitlements: { plan, subscriptionStatus, currentPeriodEnd },
  });
}

async function hStateGet(request, env) {
  const user = await verifyJwt(bearerToken(request), env.JWT_SECRET);
  if (!user) return apiError('unauthorized');
  const state = await env.TRIUMPH_KV.get(STATE_KEY(user.sub), 'json');
  return json({ state });
}

async function hStatePut(request, env) {
  const user = await verifyJwt(bearerToken(request), env.JWT_SECRET);
  if (!user) return apiError('unauthorized');
  const parsed = await readJsonBody(request);
  if (parsed.err) return parsed.err;
  const state = parsed.body.state || {};
  if (typeof state !== 'object' || Array.isArray(state)) return apiError('bad_request', { field: 'state', expected: 'object' });
  state.updatedAt = Date.now();
  await env.TRIUMPH_KV.put(STATE_KEY(user.sub), JSON.stringify(state));
  return ok({});
}

export const ACCOUNT_ROUTES = {
  '/api/register': { POST: hRegister },
  '/api/login':    { POST: hLogin },
  '/api/verify':   { POST: hVerify },
  '/api/resend':   { POST: hResend },
  '/api/logout':   { POST: hLogout },
  '/api/me':       { GET: hMe },
  '/api/state':    { GET: hStateGet, PUT: hStatePut },
};
