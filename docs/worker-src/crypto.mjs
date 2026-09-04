// worker-src/crypto.mjs — PBKDF2 + JWT helpers (ported verbatim from the
// inlined functions/api/_shared.js block in the original site/_worker.js).

const enc = new TextEncoder();
const dec = new TextDecoder();

export async function hashPassword(password, saltHex) {
  const salt = saltHex ? hexToBytes(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256);
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
    const okv = await crypto.subtle.verify('HMAC', key, bytesFromB64url(s), enc.encode(h + '.' + p));
    if (!okv) return null;
    const payload = JSON.parse(dec.decode(bytesFromB64url(p)));
    if (payload.exp && payload.exp < Date.now()) return null;
    return payload;
  } catch (e) { return null; }
}

export function bearerToken(request) {
  return (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
}
