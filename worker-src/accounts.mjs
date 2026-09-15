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

// ---------------------------------------------------------------------------
// D14 (2026-09-13) — per-test state partition.
//
// Before D14 the state record was flat and single-exam:
//   { createdAt, answers[], mastery{}, plan, srs{}, tasks{} }
// That was fine while 5001 was the only test, but the 8000-series pages write
// to the same record. Two exams sharing one `answers` array means mergeStates
// compared their lengths against each other and the longer one won outright —
// i.e. taking an 8006 mini test could silently overwrite a 5001 diagnostic.
//
// New shape:
//   { v: 2, createdAt, updatedAt, prefs{}, tests: { "5001": {...}, "8006": {...} } }
//
// `prefs` stays global on purpose: theme, dismissals and similar are
// account-level, not exam-level. Everything a user studies for is per-test.
//
// LEGACY MIGRATION RULE: a pre-D14 record has no `tests` key. Its flat fields
// are folded into tests["5001"] — safe because 5001 is the only test that ever
// wrote to it. Migration happens on read (normalizeState) and is idempotent;
// no batch job, no rewriting of stored records until the user's next write.
// ---------------------------------------------------------------------------

export const DEFAULT_TEST = '5001';

// Fields that are account-level and therefore NOT partitioned by test.
const GLOBAL_FIELDS = ['prefs', 'v', 'createdAt', 'updatedAt'];

// Fields every per-test bucket starts with. Kept identical to the pre-D14 base
// so older readers see the same shape they expect inside a bucket.
function emptyBucket() {
  return { answers: [], mastery: {}, plan: null, srs: {}, tasks: {} };
}

function isPlainObject(x) {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

function answerCount(bucket) {
  if (!isPlainObject(bucket)) return 0;
  if (Array.isArray(bucket.answers)) return bucket.answers.length;
  return Object.keys(bucket.answers || {}).length;
}

// Split a record into { global, perTest }. Accepts either shape and always
// returns the v2 view. Never mutates its input.
function splitState(state) {
  const global = {};
  if (!isPlainObject(state)) return { global, perTest: {} };

  if (isPlainObject(state.tests)) {
    // Already v2 (or something close enough). Lift global fields, keep buckets.
    for (const k of GLOBAL_FIELDS) if (state[k] !== undefined) global[k] = state[k];
    const perTest = {};
    for (const code of Object.keys(state.tests)) {
      const bucket = state.tests[code];
      if (isPlainObject(bucket)) perTest[code] = { ...emptyBucket(), ...bucket };
    }
    return { global, perTest };
  }

  // Legacy flat record -> everything non-global becomes the 5001 bucket.
  const legacy = {};
  for (const k of Object.keys(state)) {
    if (GLOBAL_FIELDS.includes(k)) { global[k] = state[k]; continue; }
    legacy[k] = state[k];
  }
  const perTest = {};
  if (Object.keys(legacy).length) perTest[DEFAULT_TEST] = { ...emptyBucket(), ...legacy };
  return { global, perTest };
}

// Public: bring any stored record (old or new) into the v2 shape.
// Idempotent — normalizeState(normalizeState(x)) deep-equals normalizeState(x).
export function normalizeState(state) {
  const { global, perTest } = splitState(state);
  const out = {
    v: 2,
    createdAt: global.createdAt || Date.now(),
    prefs: isPlainObject(global.prefs) ? global.prefs : {},
    tests: perTest,
  };
  if (global.updatedAt) out.updatedAt = global.updatedAt;
  return out;
}

// Merge two buckets for the SAME test. Richer (more answered) wins on
// conflicting keys; the poorer record fills gaps. Mirrors the pre-D14 rule but
// scoped to one test, so 5001 and 8006 can no longer clobber each other.
function mergeBuckets(a, b) {
  if (!isPlainObject(a)) return { ...emptyBucket(), ...(isPlainObject(b) ? b : {}) };
  if (!isPlainObject(b)) return { ...emptyBucket(), ...a };
  const rich = answerCount(b) > answerCount(a) ? b : a;
  const poor = rich === a ? b : a;
  return { ...emptyBucket(), ...poor, ...rich };
}

// D3 core fix — merge two diagnostic states instead of letting one clobber the
// other. Before this function existed, hVerify unconditionally overwrote the
// server state with a fresh empty shell, silently destroying a user's completed
// diagnostic the moment they verified their account. The exact bug D3 exists to
// kill, one layer deeper than the frontend.
//
// D14 extends it: merging is now per-test, so two different exams held by the
// same account stop competing for one shared `answers` array. Ties still go to
// the server record. Both inputs may be null/invalid.
export function mergeStates(a, b) {
  const NA = normalizeState(a);
  const NB = normalizeState(b);

  // `a` is the server record and `b` the incoming one, but createdAt should
  // reflect the earliest sighting of the account, not whichever write landed
  // last.
  const createdAt = Math.min(NA.createdAt || Infinity, NB.createdAt || Infinity);

  const tests = {};
  for (const code of new Set([...Object.keys(NA.tests), ...Object.keys(NB.tests)])) {
    tests[code] = mergeBuckets(NA.tests[code], NB.tests[code]);
  }

  // Global prefs: incoming value wins on conflict, server fills the rest.
  const prefs = { ...NA.prefs, ...NB.prefs };

  return {
    v: 2,
    createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
    updatedAt: Date.now(),
    prefs,
    tests,
  };
}

// Convenience for callers that need one test's bucket without caring about the
// envelope (dashboard aggregation, 8006 reconcile, tests).
export function getTestState(state, testCode = DEFAULT_TEST) {
  return normalizeState(state).tests[testCode] || { ...emptyBucket() };
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
  // D14: always hand back the v2 shape. A pre-D14 record is migrated on read
  // here, so the frontend never has to branch on which structure it got.
  return json({ state: state ? normalizeState(state) : null });
}

async function hStatePut(request, env) {
  const user = await verifyJwt(bearerToken(request), env.JWT_SECRET);
  if (!user) return apiError('unauthorized');
  const parsed = await readJsonBody(request);
  if (parsed.err) return parsed.err;
  const state = parsed.body.state || {};
  if (typeof state !== 'object' || Array.isArray(state)) return apiError('bad_request', { field: 'state', expected: 'object' });

  // D14: normalize before storing. This does two jobs — it upgrades a legacy
  // flat payload (a page that hasn't been updated yet, or a stale tab) into a
  // partitioned record, and it refuses to let a writer that only knows about
  // one test drop the other test's data.
  //
  // Merge against what is already stored rather than replacing: PUT carries the
  // caller's view of the whole record, but that view may be seconds old. Per-test
  // merge means an 8006 write can never erase a 5001 bucket and vice versa.
  const stored = await env.TRIUMPH_KV.get(STATE_KEY(user.sub), 'json').catch(() => null);
  const merged = mergeStates(stored, state);
  await env.TRIUMPH_KV.put(STATE_KEY(user.sub), JSON.stringify(merged));
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
