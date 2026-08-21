// _shared.js — Pages Functions 共享工具（密码哈希 + JWT + KV）
// 被 functions/api/*.js 复用

const enc = new TextEncoder();
const dec = new TextDecoder();

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

// ---------- 密码哈希：PBKDF2-SHA256 ----------
export async function hashPassword(password, saltHex) {
  const salt = saltHex ? hexToBytes(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 },
    key, 256
  );
  return { saltHex: bytesToHex(salt), hashHex: bytesToHex(new Uint8Array(bits)) };
}
function hexToBytes(h) { const a = []; for (let i = 0; i < h.length; i += 2) a.push(parseInt(h.slice(i, i + 2), 16)); return new Uint8Array(a); }
function bytesToHex(b) { return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join(''); }
export function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// ---------- JWT（HMAC-SHA256） ----------
function b64url(s) { return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function b64urlBytes(u8) { let bin = ''; u8.forEach(x => bin += String.fromCharCode(x)); return b64url(bin); }
function bytesFromB64url(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}
export async function signJwt(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const data = b64url(JSON.stringify(header)) + '.' + b64url(JSON.stringify(payload));
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return data + '.' + b64urlBytes(new Uint8Array(sig));
}
export async function verifyJwt(token, secret) {
  try {
    const [h, p, s] = token.split('.');
    if (!h || !p || !s) return null;
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('HMAC', key, bytesFromB64url(s), enc.encode(h + '.' + p));
    if (!ok) return null;
    const payload = JSON.parse(dec.decode(bytesFromB64url(p)));
    if (payload.exp && payload.exp < Date.now()) return null;
    return payload;
  } catch (e) { return null; }
}

// ---------- KV helpers ----------
export const USER_KEY = email => `users:${email.toLowerCase().trim()}`;
export const STATE_KEY = id => `state:${id}`;
export const CODE_KEY = email => `verify:${email.toLowerCase().trim()}`;

// ---------- 邮箱验证码 ----------
export function genCode() {
  let code = '';
  for (let i = 0; i < 6; i++) code += Math.floor(Math.random() * 10);
  return code;
}

// ---------- 邮件发送（MailChannels 免费通道，已弃用）备用：SMTP via Mailgun/Resend
// 统一出口：env.EMAIL_FROM 为发件地址，优先用 Resend/Mailgun 风格 API（env.EMAIL_API_KEY）
export async function sendVerificationEmail(env, email, code) {
  // 方案1：Resend（推荐，免费额度）— env.RESEND_API_KEY
  if (env.RESEND_API_KEY) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + env.RESEND_API_KEY },
      body: JSON.stringify({
        from: env.EMAIL_FROM || 'onboarding@resend.dev',
        to: [email],
        subject: 'Your Triumph verification code',
        html: `<p>Your Triumph verification code is:</p>
               <p style="font-size:28px;letter-spacing:4px;font-weight:bold;color:#A67D7A">${code}</p>
               <p>Enter this code to activate your account. It expires in 15 minutes.</p>
               <p style="color:#6E6760;font-size:12px">Triumph · independent Praxis 5001 study tool · not affiliated with ETS</p>`,
      }),
    });
    if (!res.ok) throw new Error('resend_failed:' + res.status);
    return true;
  }
  // 方案2：Mailgun — env.MAILGUN_API_KEY + env.MAILGUN_DOMAIN
  if (env.MAILGUN_API_KEY && env.MAILGUN_DOMAIN) {
    const form = new URLSearchParams();
    form.set('from', env.EMAIL_FROM || 'Triumph <verify@' + env.MAILGUN_DOMAIN + '>');
    form.set('to', email);
    form.set('subject', 'Your Triumph verification code');
    form.set('html', `<p>Your Triumph verification code is:</p><p style="font-size:28px;letter-spacing:4px;font-weight:bold;color:#A67D7A">${code}</p><p>Expires in 15 minutes.</p>`);
    const res = await fetch(`https://api.mailgun.net/v3/${env.MAILGUN_DOMAIN}/messages`, {
      method: 'POST',
      headers: { 'Authorization': 'Basic ' + btoa('api:' + env.MAILGUN_API_KEY) },
      body: form,
    });
    if (!res.ok) throw new Error('mailgun_failed:' + res.status);
    return true;
  }
  throw new Error('no_mail_provider');
}
