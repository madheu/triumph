// worker-src/http.mjs — shared response helpers (Section 1 of the original
// site/_worker.js; ported verbatim during modularization).

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, Mcp-Session-Id, Mcp-Protocol-Version',
  'Access-Control-Max-Age': '86400',
};

export function corsPreflight() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export function withCors(res) {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(CORS_HEADERS)) out.headers.set(k, v);
  return out;
}

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}

/** Structured error catalog — every error carries a code, a human message and a hint. */
export const ERROR_CATALOG = {
  invalid_email:      { status: 400, message: 'The email address is not valid.', hint: 'Provide a valid email address such as you@example.com.' },
  password_too_short: { status: 400, message: 'The password is shorter than 8 characters.', hint: 'Choose a password with at least 8 characters.' },
  same_password:      { status: 400, message: 'The new password is the same as the current one.', hint: 'Choose a password you have not used on this account.' },
  current_password_required: { status: 400, message: 'The current password is required to set a new one.', hint: 'Send current_password together with new_password.' },
  bad_request:        { status: 400, message: 'The request body could not be processed.', hint: 'Send a JSON object that satisfies the schema documented at /openapi.json.' },
  invalid_json:       { status: 400, message: 'The request body is not valid JSON.', hint: 'Send a JSON object with Content-Type: application/json.' },
  already_verified:   { status: 400, message: 'This account is already verified.', hint: 'Use POST /api/login to sign in instead of verifying again.' },
  wrong_code:         { status: 400, message: 'That verification code is not correct.', hint: 'Check the 6-digit code in your email and retry, or use POST /api/resend for a new code.' },
  code_expired:       { status: 400, message: 'The verification code has expired.', hint: 'Request a fresh code with POST /api/resend { "email": "..." }; codes expire after 15 minutes.' },
  invalid_credentials:{ status: 401, message: 'Email or password is incorrect.', hint: 'Verify the credentials and retry. Use POST /api/resend if the account still needs verification.' },
  unauthorized:       { status: 401, message: 'Authentication is required.', hint: 'Send Authorization: Bearer <token> from POST /api/login, or an X-API-Key header.' },
  invalid_api_key:    { status: 401, message: 'The supplied API key is not valid.', hint: 'Pass a valid key in the X-API-Key header, or create one via POST /api/v1/keys.' },
  forbidden_scope:    { status: 403, message: 'The API key does not include the scope required for this endpoint.', hint: 'Recreate the key via POST /api/v1/keys requesting the missing scope listed in the error details.' },
  not_verified:       { status: 403, message: 'This account exists but has not been verified yet.', hint: 'Submit the emailed 6-digit code via POST /api/verify, or request a new one via POST /api/resend.' },
  use_google:         { status: 409, message: 'This account uses Google sign-in — there is no password.', hint: 'Click "Continue with Google" to sign in, or set a password after signing in.' },
  email_taken:        { status: 409, message: 'An account with this email already exists.', hint: 'Use POST /api/login instead, or recover the password from the login page.' },
  not_found:          { status: 404, message: 'The requested resource does not exist.', hint: 'Consult /openapi.json for the list of available endpoints.' },
  conflict:           { status: 409, message: 'The resource conflicts with an existing one.', hint: 'Change the unique field (e.g. slug or id) and retry.' },
  not_registered:     { status: 404, message: 'No account was found for this email.', hint: 'Create the account first with POST /api/register.' },
  method_not_allowed: { status: 405, message: 'HTTP method not allowed for this endpoint.', hint: 'See the allowed methods for this path in /openapi.json.' },
  mail_failed:        { status: 502, message: 'The verification email could not be sent right now.', hint: 'Your account was created; retry with POST /api/resend { "email": "..." } in a moment.' },
  google_not_configured: { status: 503, message: 'Google sign-in is not configured yet.', hint: 'Contact the site owner — Google OAuth credentials are not set up.' },
  too_many_requests:  { status: 429, message: 'Rate limit exceeded.', hint: 'Wait before retrying; free-tier limits reset hourly.' },
  internal_error:     { status: 500, message: 'Unexpected server error.', hint: 'Retry the request; if it persists contact abc15531888397@gmail.com.' },
};

/**
 * Build a structured JSON error response:
 *   { "error": { "code", "message", "hint" }, "status": <http status> }
 * Optional `meta` is merged into error (e.g. { email } for not_verified).
 */
export function apiError(code, meta) {
  const def = ERROR_CATALOG[code] || ERROR_CATALOG.internal_error;
  const err = { code, message: def.message, hint: def.hint };
  if (meta && typeof meta === 'object') Object.assign(err, { details: meta });
  return json({ error: err, status: def.status }, def.status);
}

export function ok(data, status = 200, extraHeaders = {}) {
  return json({ ok: true, ...data }, status, extraHeaders);
}

export async function readJsonBody(request) {
  try {
    const body = await request.json();
    if (body === null || typeof body !== 'object') return { err: apiError('bad_request') };
    return { body };
  } catch (e) {
    return { err: apiError('invalid_json') };
  }
}

/* ---------- outbound fetch guard (SSRF) ---------- */

function isReservedIPv4(h) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  const a = +m[1], b = +m[2];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

function isReservedHost(hostname) {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || /\.(local|localdomain|internal)$/.test(h)) return true;
  if (h === '::' || h === '::1') return true;
  if (/^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]{2}:/.test(h)) return true;
  const v4 = h.includes(':') ? h.split(':').pop() : h; // IPv4-mapped IPv6 tail
  return isReservedIPv4(v4);
}

/**
 * Outbound fetch guard: every upstream call must be https and must not target
 * localhost, loopback, private, link-local or otherwise reserved addresses.
 * All production upstreams (Resend, Mailgun, Creem, Google) are fixed https
 * hosts, so this never rejects a legitimate call.
 */
export async function safeFetch(url, init) {
  const u = new URL(String(url));
  if (u.protocol !== 'https:') throw new Error(`safeFetch: scheme ${u.protocol} is not allowed; use https`);
  if (isReservedHost(u.hostname)) throw new Error(`safeFetch: host ${u.hostname} is reserved/private`);
  return fetch(u, init);
}
