// worker-src/bank.mjs — question bank data (Section 2 of the original
// site/_worker.js; loaded once per isolate via ASSETS, ported verbatim).

import { apiError } from './http.mjs';

let _bankPromise = null;
let _statsPromise = null;

export function loadBank(env) {
  if (!_bankPromise) {
    _bankPromise = env.ASSETS.fetch(new Request('https://assets.internal/data/questions-api.json'))
      .then(r => { if (!r.ok) throw new Error(`question bank asset unavailable (HTTP ${r.status})`); return r.json(); })
      .then(b => {
        if (!Array.isArray(b)) throw new Error('question bank asset malformed');
        return b;
      });
  }
  return _bankPromise;
}

export function loadStats(env) {
  if (!_statsPromise) {
    _statsPromise = env.ASSETS.fetch(new Request('https://assets.internal/data/stats.json'))
      .then(r => { if (!r.ok) throw new Error(`stats asset unavailable (HTTP ${r.status})`); return r.json(); })
      .then(s => {
        if (!s || typeof s !== 'object' || !s.subtests) throw new Error('stats asset malformed');
        return s;
      });
  }
  return _statsPromise;
}

/** Map a raw bank entry to its public API shape. */
export function publicQuestion(q) {
  return {
    id: q.id,
    subtest_code: q.code,
    subtest: q.subtest,
    category: q.category,
    question: q.q,
    options: q.options,
    answer_index: q.answer,
    answer_text: Array.isArray(q.options) ? q.options[q.answer] : undefined,
    explanation: q.explain,
  };
}

export const VALID_SUBTESTS = ['5002', '5003', '5004', '5005'];

export function filterQuestions(bank, params) {
  let items = bank;
  const subtest = params.get('subtest');
  if (subtest) {
    const s = String(subtest).trim();
    if (!VALID_SUBTESTS.includes(s)) return { err: apiError('bad_request', { field: 'subtest', allowed: VALID_SUBTESTS }) };
    items = items.filter(q => q.code === s);
  }
  const category = params.get('category');
  if (category) items = items.filter(q => q.category.toLowerCase() === String(category).trim().toLowerCase());
  const search = params.get('search');
  if (search) items = items.filter(q => q.q.toLowerCase().includes(String(search).trim().toLowerCase()));
  return { items };
}

export function paginate(items, params) {
  let limit = parseInt(params.get('limit') || '20', 10);
  let offset = parseInt(params.get('offset') || '0', 10);
  if (isNaN(limit) || limit < 1) limit = 20;
  if (limit > 100) limit = 100;
  if (isNaN(offset) || offset < 0) offset = 0;
  return {
    total: items.length,
    count: Math.min(limit, Math.max(0, items.length - offset)),
    limit,
    offset,
    items: items.slice(offset, offset + limit).map(publicQuestion),
  };
}
