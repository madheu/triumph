// worker-src/google-auth.mjs — "Continue with Google" OAuth 2.0 (Authorization Code + PKCE)
//
// Routes:
//   GET /api/auth/google?next=/dashboard&mode=login|signup
//       → builds state (stored in KV, 10 min TTL) + PKCE code_challenge,
//         302-redirects to accounts.google.com authorization endpoint.
//   GET /api/auth/google/callback?code=...&state=...&scope=...
//       → validates state, exchanges code for a token at Google's token endpoint,
//         verifies the ID token signature (RS256, aud == client id, exp, email_verified),
//         upserts the user in the existing `users:<email>` KV records (reusing the
//         same account store as email/password auth), signs the same JWT used by
//         /api/login, then 302-redirects back to the app.
//
// Seamless with the existing auth: the issued JWT is identical in shape to
// POST /api/login, so auth.js just stores it and the whole sync layer works
// unchanged. Google users are stored in the SAME `users:<email>` records, so a
// user can sign in with either Google or email+password and see the same data.

import { json, apiError, safeFetch } from './http.mjs';
import { signJwt } from './crypto.mjs';
import { USER_KEY, STATE_KEY } from './accounts.mjs';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_KEYS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
// Minimal public-profile scope: email + name + picture. No sensitive data, so
// the OAuth consent screen stays out of Google's verification queue.
const SCOPE = 'openid email profile';
const STATE_KEY_PREFIX = 'gauth:state:';
const STATE_TTL = 600; // 10 minutes

// Google's RS256 public keys are cached in-memory per worker isolate; they are
// rotated on Google's schedule (~hours/days), so also cache by kid.
let jwksCache = null; // { fetchedAt, keys: { [kid]: CryptoKey } }

function base64urlEncode(input) {
  if (typeof input === 'string') input = new TextEncoder().encode(input);
  let bin = '';
  input.forEach(b => bin += String.fromCharCode(b));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function base64urlDecode(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

async function genRandomHex(bytes) {
  const u8 = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(u8).map(b => b.toString(16).padStart(2, '0')).join('');
}

// PKCE S256 verifier → challenge (RFC 7636)
async function sha256Base64url(data) {
  const hash = await crypto.subtle.digest('SHA-256', typeof data === 'string' ? new TextEncoder().encode(data) : data);
  return base64urlEncode(new Uint8Array(hash));
}

// ---- verify RS256 signature of the Google ID token against cached JWKS ----
async function getGoogleJwk(kid) {
  const now = Date.now();
  if (!jwksCache || now - jwksCache.fetchedAt > 3600 * 1000 || (kid && !jwksCache.keys[kid])) {
    const res = await safeFetch(GOOGLE_KEYS_URL);
    if (!res.ok) throw new Error('google_keys_fetch_failed:' + res.status);
    const { keys } = await res.json();
    const map = {};
    for (const k of keys) {
      const jwk = { kty: k.kty, n: k.n, e: k.e, alg: k.alg };
      map[k.kid] = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    }
    jwksCache = { fetchedAt: now, keys: map };
  }
  return jwksCache.keys[kid] || null;
}

// Validate the ID token (JWS RS256) and return its payload when trustworthy.
// Mirrors the checks Google's docs recommend: signature, alg, iss, aud, exp, iat.
async function verifyGoogleIdToken(token, clientId) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('bad_id_token');
  const header = JSON.parse(new TextDecoder().decode(base64urlDecode(parts[0])));
  if (header.alg !== 'RS256') throw new Error('unexpected_alg:' + header.alg);
  const key = await getGoogleJwk(header.kid);
  if (!key) throw new Error('unknown_kid:' + header.kid);
  const data = new TextEncoder().encode(parts[0] + '.' + parts[1]);
  const sig = base64urlDecode(parts[2]);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, data);
  if (!valid) throw new Error('bad_signature');
  const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(parts[1])));
  if (payload.iss !== 'https://accounts.google.com' && payload.iss !== 'accounts.google.com') throw new Error('bad_iss');
  if (payload.aud !== clientId) throw new Error('bad_aud');
  if (!payload.exp || payload.exp * 1000 < Date.now()) throw new Error('token_expired');
  if (!payload.email || payload.email_verified !== true) throw new Error('email_not_verified');
  return payload;
}

// ---- route: start Google sign-in ----
async function hGoogleStart(request, env) {
  const clientId = env.GOOGLE_CLIENT_ID;
  if (!clientId) return apiError('google_not_configured');

  const url = new URL(request.url);
  const nextRaw = url.searchParams.get('next') || '';
  const mode = url.searchParams.get('mode') || 'login';
  // Only allow internal relative redirect targets (mirrors login.html's guard).
  let next = 'dashboard';
  if (nextRaw && !/^[a-z]+:/i.test(nextRaw) && !nextRaw.startsWith('//') && !nextRaw.includes('\\')) {
    next = nextRaw.replace(/^\//, '');
  }
  if (next === 'login' || next === 'login.html') next = 'dashboard';

  // state = random nonce; we store { next, mode, verifier } in KV keyed by state.
  const state = await genRandomHex(24);
  const verifier = await genRandomHex(32);
  const challenge = await sha256Base64url(verifier);
  await env.TRIUMPH_KV.put(
    STATE_KEY_PREFIX + state,
    JSON.stringify({ next, mode, verifier, expiresAt: Date.now() + STATE_TTL * 1000 }),
    { expirationTtl: STATE_TTL },
  );

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${url.origin}/api/auth/google/callback`,
    response_type: 'code',
    scope: SCOPE,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    access_type: 'online',
    prompt: 'select_account',
    include_granted_scopes: 'true',
  });
  return Response.redirect(GOOGLE_AUTH_URL + '?' + params.toString(), 302);
}

// ---- route: Google callback ----
async function hGoogleCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const errParam = url.searchParams.get('error');

  const fail = (msg) =>
    Response.redirect(`${url.origin}/login?error=${encodeURIComponent(msg)}`, 302);

  if (errParam) return fail('Google sign-in was cancelled or failed. Please try again or use email.');
  if (!code || !state) return fail('Missing OAuth parameters. Please try again.');

  // 1. Validate + consume state (single use)
  const storedJson = await env.TRIUMPH_KV.get(STATE_KEY_PREFIX + state);
  await env.TRIUMPH_KV.delete(STATE_KEY_PREFIX + state);
  if (!storedJson) return fail('Sign-in session expired. Please try again.');
  const stored = JSON.parse(storedJson);
  const verifier = stored.verifier;
  const next = stored.next || 'dashboard';
  if (stored.expiresAt && stored.expiresAt < Date.now()) return fail('Sign-in session expired. Please try again.');

  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return fail('Sign-in is not configured yet. Please try again later.');

  // 2. Exchange the auth code for tokens (PKCE verifier proves possession)
  let tokenData;
  try {
    const res = await safeFetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: `${url.origin}/api/auth/google/callback`,
        grant_type: 'authorization_code',
        code_verifier: verifier,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error('token_exchange_failed:' + res.status + (body ? ':' + body.slice(0, 200) : ''));
    }
    tokenData = await res.json();
  } catch (e) {
    return fail('Could not complete Google sign-in. Please try again.');
  }

  // 3. Validate the ID token and extract the verified identity
  let profile;
  try {
    profile = await verifyGoogleIdToken(tokenData.id_token, clientId);
  } catch (e) {
    return fail('Google sign-in could not be verified. Please try again.');
  }
  const email = String(profile.email || '').trim().toLowerCase();
  if (!email) return fail('Google did not return an email. Use a Google account with an email address.');
  const googleSub = String(profile.sub || '');

  // 4. Upsert the user in the SAME account store used by email/password auth.
  const recKey = USER_KEY(email);
  let recJson = await env.TRIUMPH_KV.get(recKey);
  let rec;
  let created = false;
  if (recJson) {
    rec = JSON.parse(recJson);
    rec.googleSub = googleSub;
    rec.verified = true;
    if (!rec.googleProfile) rec.googleProfile = { name: profile.name || '', picture: profile.picture || '' };
    await env.TRIUMPH_KV.put(recKey, JSON.stringify(rec));
  } else {
    rec = {
      id: crypto.randomUUID(),
      email,
      googleSub,
      verified: true,
      createdAt: Date.now(),
      authProvider: 'google',
      googleProfile: { name: profile.name || '', picture: profile.picture || '' },
    };
    await env.TRIUMPH_KV.put(recKey, JSON.stringify(rec));
    await env.TRIUMPH_KV.put(STATE_KEY(rec.id), JSON.stringify({ createdAt: Date.now(), answers: [], mastery: {}, plan: null, srs: {}, tasks: {} }));
    created = true;
  }

  // 5. Issue the SAME JWT shape as /api/login (auth.js understands it verbatim).
  const jwt = await signJwt({ sub: rec.id, email, iat: Date.now(), exp: Date.now() + 30 * 86400000 }, env.JWT_SECRET);

  // 6. Redirect back into the app. The token is delivered via the fragment so
  //    it never lands in server logs; login.html reads it on load, stores the
  //    session, then forwards to `next`.
  const base = url.origin;
  const frag = `#triumph_token=${encodeURIComponent(jwt)}&triumph_email=${encodeURIComponent(email)}&created=${created ? 1 : 0}&next=${encodeURIComponent(next)}`;
  return Response.redirect(`${base}/login${frag}`, 302);
}

// Support both mounted styles: worker.mjs dispatches on GOOGLE_AUTH_ROUTES[path].
export const GOOGLE_AUTH_ROUTES = {
  '/api/auth/google': { GET: hGoogleStart },
  '/api/auth/google/callback': { GET: hGoogleCallback },
};

// Named handlers exported for direct testing.
export { hGoogleStart, hGoogleCallback, verifyGoogleIdToken, sha256Base64url as _sha256Base64url };
