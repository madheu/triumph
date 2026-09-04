// worker-src/magic.mjs — passwordless auth: magic link + 6-digit code, dual-path (D3).
//
// Decision record (PRD-注册链路重做-v1.md §11, owner-approved 2026-09-03):
//   Q1 dual-track accepted — pure magic link forces the user off the result page
//      (fatal on mobile); the 6-digit code lets them unlock in place.
//   Q2 passwordless signup accepted — no password field on the result page.
//      Existing password users keep /api/login untouched; magic-created accounts
//      are flagged magicOnly:true (no hash) and hLogin points them back here.
//   Q4 email via Resend (Mailgun kept as fallback, same as sendVerificationEmail).
//   Owner addition: the email must tell the user to open the link directly from
//   the email app — copying it into a browser recreates the lost-session problem.
//
// Cross-tab handshake (the hard part):
//   The email link cannot hand a JWT to the original tab (session lives in
//   localStorage, not cookies). So the link goes to /api/magic/redeem, which
//   completes the signup server-side and stores the SAME JWT under
//   magicdone:<request_id> (TTL 10 min). The original tab polls
//   /api/magic/status?request_id=... and picks the token up when it appears.
//   Both paths (link click, code entry) converge on completeSignup().

import { json, apiError, readJsonBody, safeFetch } from './http.mjs';
import { signJwt } from './crypto.mjs';
import { USER_KEY, CODE_KEY, STATE_KEY, mergeStates } from './accounts.mjs';

const MAGIC_REQ_KEY = id => `magicreq:${id}`;
const MAGIC_TOKEN_KEY = t => `magictoken:${t}`;
const MAGIC_DONE_KEY = id => `magicdone:${id}`;
export const MAGIC_PENDING_KEY = email => `magicpending:${email.toLowerCase().trim()}`;

const TTL_SECONDS = 15 * 60;
const PENDING_STATE_MAX_BYTES = 64 * 1024;

function genCode() {
  let code = '';
  for (let i = 0; i < 6; i++) code += Math.floor(Math.random() * 10);
  return code;
}

function randToken() {
  return crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function sendMagicEmail(env, email, code, linkUrl) {
  const from = env.EMAIL_FROM || '';
  if (!from) throw new Error('EMAIL_FROM not configured');
  const html = `<div style="font-family:Georgia,serif;max-width:480px;margin:0 auto">
    <p>Your Learndiag sign-in code is:</p>
    <p style="font-size:30px;letter-spacing:6px;font-weight:bold;color:#A67D7A">${code}</p>
    <p style="margin:22px 0">
      <a href="${linkUrl}" style="background:#C09D9B;color:#332E2B;padding:13px 26px;text-decoration:none;border-radius:4px;display:inline-block;font-family:Arial,sans-serif;font-size:15px">Unlock my forecast</a>
    </p>
    <p style="font-size:14px;line-height:1.6;color:#3C3733"><strong>Tip:</strong> open this link directly from your email app — don't copy it into another browser. The code above works anywhere: type it on the page you came from and your results unlock instantly.</p>
    <p style="color:#6E6760;font-size:12px">This code expires in 15 minutes. Learndiag · independent Praxis 5001 study tool · not affiliated with ETS</p>
  </div>`;

  if (env.RESEND_API_KEY) {
    const res = await safeFetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + env.RESEND_API_KEY },
      body: JSON.stringify({ from, to: [email], subject: 'Your Learndiag code: ' + code, html }),
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
    form.set('subject', 'Your Learndiag code: ' + code);
    form.set('html', html);
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

// Shared completion: mark verified, merge server + pending states, issue JWT.
// Every path (code entry, email link) lands here exactly once per request_id.
async function completeSignup(env, email, requestId) {
  const recJson = await env.TRIUMPH_KV.get(USER_KEY(email));
  if (!recJson) return { err: apiError('not_registered') };
  const rec = JSON.parse(recJson);

  if (!rec.verified) {
    rec.verified = true;
    await env.TRIUMPH_KV.put(USER_KEY(email), JSON.stringify(rec));
  }

  // D3 core fix, same rule as the hVerify patch: NEVER wipe a completed
  // diagnostic with a fresh empty state. Merge — the record with more answers
  // wins; pending results captured at request time fill an empty account.
  const serverState = await env.TRIUMPH_KV.get(STATE_KEY(rec.id), 'json').catch(() => null);
  let pending = null;
  try {
    pending = await env.TRIUMPH_KV.get(MAGIC_PENDING_KEY(email), 'json');
  } catch (e) { /* no pending payload */ }
  const merged = mergeStates(serverState, pending);

  await env.TRIUMPH_KV.put(STATE_KEY(rec.id), JSON.stringify({ ...merged, updatedAt: Date.now() }));
  await env.TRIUMPH_KV.delete(MAGIC_PENDING_KEY(email));
  await env.TRIUMPH_KV.delete(CODE_KEY(email));

  const jwt = await signJwt({ sub: rec.id, email, iat: Date.now(), exp: Date.now() + 30 * 86400000 }, env.JWT_SECRET);
  if (requestId) {
    // Cross-tab handshake: the link-clicking tab completed the signup; the
    // original tab picks the session up via /api/magic/status.
    await env.TRIUMPH_KV.put(MAGIC_DONE_KEY(requestId), JSON.stringify({ token: jwt }), { expirationTtl: 600 });
  }
  return { jwt, userId: rec.id, state: merged };
}

async function hMagicRequest(request, env) {
  const parsed = await readJsonBody(request);
  if (parsed.err) return parsed.err;
  const email = String(parsed.body.email || '').trim().toLowerCase();
  if (!validEmail(email)) return apiError('invalid_email');

  // Create a passwordless account shell if this email is new. Existing verified
  // users reuse this flow as passwordless login — no password is ever asked.
  const existingJson = await env.TRIUMPH_KV.get(USER_KEY(email));
  if (!existingJson) {
    await env.TRIUMPH_KV.put(USER_KEY(email), JSON.stringify({
      id: crypto.randomUUID(), email, verified: false, magicOnly: true, createdAt: Date.now(),
    }));
  } else {
    const existing = JSON.parse(existingJson);
    if (existing.magicOnly && !existing.verified) {
      // keep the original id so a half-finished attempt keeps its state key
    }
  }

  const code = genCode();
  await env.TRIUMPH_KV.put(CODE_KEY(email), JSON.stringify({ code, exp: Date.now() + TTL_SECONDS * 1000, email }), { expirationTtl: TTL_SECONDS });

  // 来源页：从邮箱点开链接后回哪儿。默认 /diagnostic。
  // 只接受站内单斜杠相对路径 —— 否则这就是个开放重定向，
  // 任何人都能拿 learndiag.com 的域名把用户送到外部站点。
  const rawNext = String(parsed.body.next || '');
  const next = /^\/(?!\/)[^\s\\]*$/.test(rawNext) ? rawNext : '/diagnostic';

  const requestId = crypto.randomUUID();
  const linkToken = randToken();
  await env.TRIUMPH_KV.put(MAGIC_REQ_KEY(requestId), JSON.stringify({ email, exp: Date.now() + TTL_SECONDS * 1000 }), { expirationTtl: TTL_SECONDS });
  await env.TRIUMPH_KV.put(MAGIC_TOKEN_KEY(linkToken), JSON.stringify({ email, requestId, next, exp: Date.now() + TTL_SECONDS * 1000 }), { expirationTtl: TTL_SECONDS });

  // The result snapshot the user is about to lose by signing up — captured
  // here so server-side merge can restore it after verification (D3 §4.3).
  const pending = parsed.body.pending_state;
  if (pending && typeof pending === 'object' && !Array.isArray(pending)) {
    const payload = JSON.stringify(pending);
    if (payload.length <= PENDING_STATE_MAX_BYTES) {
      await env.TRIUMPH_KV.put(MAGIC_PENDING_KEY(email), payload, { expirationTtl: TTL_SECONDS });
    }
  }

  const url = new URL(request.url);
  const linkUrl = `${url.origin}/api/magic/redeem?token=${linkToken}`;
  try {
    await sendMagicEmail(env, email, code, linkUrl);
  } catch (e) {
    return apiError('mail_failed', { email });
  }
  return json({ request_id: requestId, expires_in: TTL_SECONDS });
}

async function hMagicStatus(request, env) {
  const url = new URL(request.url);
  const requestId = String(url.searchParams.get('request_id') || '');
  if (!requestId) return apiError('bad_request', { field: 'request_id' });
  const doneJson = await env.TRIUMPH_KV.get(MAGIC_DONE_KEY(requestId));
  if (doneJson) {
    const done = JSON.parse(doneJson);
    return json({ status: 'done', token: done.token });
  }
  return json({ status: 'pending' });
}

async function hMagicVerify(request, env) {
  const parsed = await readJsonBody(request);
  if (parsed.err) return parsed.err;
  const email = String(parsed.body.email || '').trim().toLowerCase();
  const code = String(parsed.body.code || '').trim();
  const requestId = String(parsed.body.request_id || '') || null;

  const storedJson = await env.TRIUMPH_KV.get(CODE_KEY(email));
  if (!storedJson) return apiError('code_expired');
  const stored = JSON.parse(storedJson);
  if (stored.exp < Date.now()) return apiError('code_expired');
  if (stored.code !== code) return apiError('wrong_code');

  const done = await completeSignup(env, email, requestId);
  if (done.err) return done.err;
  return json({ token: done.jwt, user: { id: done.userId, email }, state: done.state });
}

// Email-link landing: browser-navigated (no CORS wrapper), completes the
// signup server-side, then hands the browser back to the diagnostic page.
// The original tab picks up the session via /api/magic/status polling.
async function hMagicRedeem(request, env) {
  const url = new URL(request.url);
  const token = String(url.searchParams.get('token') || '');
  const fail = msg => new Response(
    `<!doctype html><meta charset="utf-8"><title>Learndiag</title><p style="font-family:sans-serif;padding:40px;text-align:center">${msg} You can close this tab and enter the 6-digit code on the original page instead.</p>`,
    { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
  if (!token) return fail('This sign-in link is incomplete.');
  const recJson = await env.TRIUMPH_KV.get(MAGIC_TOKEN_KEY(token));
  if (!recJson) return fail('This sign-in link has expired (links last 15 minutes).');
  const rec = JSON.parse(recJson);
  if (rec.exp < Date.now()) return fail('This sign-in link has expired (links last 15 minutes).');

  const done = await completeSignup(env, rec.email, rec.requestId);
  if (done.err) return fail('Something went wrong completing your sign-in.');
  await env.TRIUMPH_KV.delete(MAGIC_TOKEN_KEY(token)); // single use

  // 跨设备：把会话交给点链接的这台设备。
  //
  // 原实现只写 magicdone:<request_id>，靠发起页轮询 /api/magic/status 取 token。
  // 那只覆盖「同一台设备的另一个标签页」——真换设备（手机读邮件点链接）时，
  // 新设备跳过去是未登录状态，刚保存的成绩拿不回来，D3 验收最后一条挂在这里。
  //
  // 用 URL fragment（#）而不是 query（?）传 token：
  //   · fragment 不随 Referer 外泄、不进服务器访问日志；
  //   · 服务端仍然只认一次性 token，fragment 本身不构成新的攻击面。
  const target = rec.next || '/diagnostic';
  const sep = target.indexOf('#') >= 0 ? '&' : '#';
  return Response.redirect(`${url.origin}${target}${sep}magic=${encodeURIComponent(done.jwt)}`, 302);
}

export const MAGIC_ROUTES = {
  '/api/magic/request': { POST: hMagicRequest },
  '/api/magic/status':  { GET: hMagicStatus },
  '/api/magic/verify':  { POST: hMagicVerify },
  '/api/magic/redeem':  { GET: hMagicRedeem },
};
