// worker-src/mcp.mjs — MCP server, Streamable HTTP, JSON-RPC 2.0 (Section 7
// of the original site/_worker.js, ported verbatim).

import { json, apiError, corsPreflight, withCors } from './http.mjs';
import { BASE, API_VERSION } from './constants.mjs';
import { loadBank, loadStats, filterQuestions, paginate, publicQuestion, VALID_SUBTESTS } from './bank.mjs';

const MCP_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26'];
const MCP_LATEST = MCP_PROTOCOL_VERSIONS[0];

const MCP_SERVER_INFO = { name: 'triumph', title: 'Triumph — Praxis 5001 study tool', version: API_VERSION };

const MCP_INSTRUCTIONS =
  'Triumph is a free Praxis 5001 (Elementary Education: Multiple Subjects) readiness tool. ' +
  'Use it when a teacher candidate asks for Praxis 5001 practice questions, subtest/blueprint information, ' +
  'question-bank statistics, or links to the study guides. All tools are read-only and free; no authentication required.';

async function mcpToolListSubtests(env) {
  const stats = await loadStats(env);
  return { stats };
}
async function mcpToolGetQuestions(env, args) {
  const bank = await loadBank(env);
  const params = new URLSearchParams();
  if (args.subtest) params.set('subtest', String(args.subtest));
  if (args.category) params.set('category', String(args.category));
  if (args.search) params.set('search', String(args.search));
  if (args.limit) params.set('limit', String(args.limit));
  if (args.offset) params.set('offset', String(args.offset));
  const filtered = filterQuestions(bank, params);
  if (filtered.err) throw new Error(filtered.err.error.details ? JSON.stringify(filtered.err.error.details) : 'invalid arguments');
  const page = paginate(filtered.items, params);
  return page;
}
async function mcpToolRandomQuestions(env, args) {
  const bank = await loadBank(env);
  const params = new URLSearchParams();
  if (args.subtest) params.set('subtest', String(args.subtest));
  if (args.category) params.set('category', String(args.category));
  const filtered = filterQuestions(bank, params);
  if (filtered.err) throw new Error('invalid arguments');
  let count = Number.isInteger(args.count) ? args.count : 5;
  count = Math.max(1, Math.min(50, count));
  const pool = filtered.items;
  const picked = [];
  for (let i = 0; i < pool.length; i++) {
    if (picked.length < count) picked.push(pool[i]);
    else {
      const j = Math.floor(Math.random() * (i + 1));
      if (j < count) picked[j] = pool[i];
    }
  }
  return { count: picked.length, total_pool: pool.length, items: picked.map(publicQuestion) };
}
async function mcpToolListGuides(env) {
  const guides = [
    ['Praxis 5001 Study Guide', '/praxis-5001-study-guide'],
    ['Four-Gate Strategy', '/praxis-5001-four-gate-strategy'],
    ['Retake Guide', '/praxis-5001-retake-guide'],
    ['5001 vs 7001', '/praxis-5001-vs-7001'],
    ['5001 vs 8000 Series', '/praxis-5001-vs-8000-series'],
    ['5002 Study Guide', '/praxis-5002-study-guide'],
    ['5003 Math Study Guide', '/praxis-5003-math-study-guide'],
    ['5004 Social Studies Study Guide', '/praxis-5004-social-studies-study-guide'],
    ['5005 Science Study Guide', '/praxis-5005-science-study-guide'],
  ];
  return {
    guides: guides.map(([title, path]) => ({
      title,
      html_url: BASE + path,
      markdown_url: BASE + '/md' + path + '.md',
    })),
    note: 'Every guide also serves text/markdown when requested with Accept: text/markdown.',
  };
}

const MCP_TOOLS = [
  {
    name: 'list_subtests',
    title: 'List Praxis 5001 subtests',
    description: 'List the four Praxis 5001 subtests (5002 reading, 5003 math, 5004 social studies, 5005 science) with question counts and content categories in the Triumph bank.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    readOnlyHint: true,
  },
  {
    name: 'get_questions',
    title: 'Get practice questions',
    description: 'Fetch original Praxis 5001 practice questions with answer options, the correct answer and an explanation. Filter by subtest code (5002|5003|5004|5005), category, or a search string.',
    inputSchema: {
      type: 'object',
      properties: {
        subtest: { type: 'string', enum: VALID_SUBTESTS, description: 'Subtest code filter' },
        category: { type: 'string', description: 'Content-category name filter (case-insensitive)' },
        search: { type: 'string', description: 'Case-insensitive substring filter on the question text' },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 20, description: 'Page size' },
        offset: { type: 'integer', minimum: 0, default: 0, description: 'Pagination offset' },
      },
      additionalProperties: false,
    },
    readOnlyHint: true,
  },
  {
    name: 'get_random_questions',
    title: 'Get random practice questions',
    description: 'Draw random original Praxis 5001 practice questions, optionally restricted to one subtest or category. Useful for quick quizzes.',
    inputSchema: {
      type: 'object',
      properties: {
        count: { type: 'integer', minimum: 1, maximum: 50, default: 5, description: 'How many questions to draw' },
        subtest: { type: 'string', enum: VALID_SUBTESTS, description: 'Subtest code filter' },
        category: { type: 'string', description: 'Content-category name filter' },
      },
      additionalProperties: false,
    },
    readOnlyHint: true,
  },
  {
    name: 'get_bank_stats',
    title: 'Get question-bank statistics',
    description: 'Get counts of available practice questions per subtest and per content category.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    readOnlyHint: true,
  },
  {
    name: 'list_study_guides',
    title: 'List study guides',
    description: 'List Triumph\u2019s free Praxis 5001 study-guide articles with their HTML and markdown URLs.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    readOnlyHint: true,
  },
];

async function mcpToolCall(name, args, env) {
  switch (name) {
    case 'list_subtests': return mcpToolListSubtests(env);
    case 'get_questions': return mcpToolGetQuestions(env, args || {});
    case 'get_random_questions': return mcpToolRandomQuestions(env, args || {});
    case 'get_bank_stats': return mcpToolListSubtests(env);
    case 'list_study_guides': return mcpToolListGuides(env);
    default: return null; // unknown tool
  }
}

function jsonRpcResult(id, result) {
  return json({ jsonrpc: '2.0', id, result }, 200, { 'Cache-Control': 'no-store' });
}
function jsonRpcError(id, code, message, data) {
  const err = { code, message };
  if (data !== undefined) err.data = data;
  return json({ jsonrpc: '2.0', id, error: err }, 200, { 'Cache-Control': 'no-store' });
}

export async function handleMcp(request, env) {
  if (request.method === 'OPTIONS') return corsPreflight();
  if (request.method === 'GET' || request.method === 'DELETE') {
    // Streamable HTTP allows servers that do not offer SSE listening / session
    // termination to reject GET/DELETE with 405.
    const res = jsonRpcError(null, -32000, `Method ${request.method} not supported by this server; use POST with a JSON-RPC message.`, { allowed_methods: ['POST'] });
    res.headers.set('Allow', 'POST, OPTIONS');
    const out = new Response(res.body, { status: 405, headers: res.headers });
    return withCors(out);
  }
  if (request.method !== 'POST') {
    return withCors(apiError('method_not_allowed', { allowed: ['POST'] }));
  }

  const contentType = (request.headers.get('Content-Type') || '').split(';')[0].trim();
  if (contentType !== 'application/json') {
    return withCors(jsonRpcError(null, -32600, 'Invalid Request: Content-Type must be application/json.'));
  }

  let message;
  try {
    message = await request.json();
  } catch (e) {
    return withCors(jsonRpcError(null, -32700, 'Parse error'));
  }

  const messages = Array.isArray(message) ? message : [message];
  const responses = [];
  for (const msg of messages) {
    responses.push(await handleMcpMessage(msg, env));
  }
  const nonNull = responses.filter(Boolean);
  if (!nonNull.length) return withCors(new Response(null, { status: 202 })); // notifications only
  const body = Array.isArray(message) ? nonNull : nonNull[0];
  return withCors(json(body, 200, { 'Cache-Control': 'no-store' }));
}

async function handleMcpMessage(msg, env) {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') {
    return { jsonrpc: '2.0', id: msg && msg.id !== undefined ? msg.id : null, error: { code: -32600, message: 'Invalid Request' } };
  }
  const { id, method, params } = msg;
  const isNotification = id === undefined || id === null;

  try {
    switch (method) {
      case 'initialize': {
        const requested = params && params.protocolVersion;
        const negotiated = MCP_PROTOCOL_VERSIONS.includes(requested) ? requested : MCP_LATEST;
        if (isNotification) return null;
        return {
          jsonrpc: '2.0', id,
          result: {
            protocolVersion: negotiated,
            capabilities: { tools: { listChanged: false } },
            serverInfo: MCP_SERVER_INFO,
            instructions: MCP_INSTRUCTIONS,
          },
        };
      }
      case 'notifications/initialized':
        return null; // notification → no response
      case 'ping':
        return isNotification ? null : { jsonrpc: '2.0', id, result: {} };
      case 'tools/list':
        if (isNotification) return null;
        return { jsonrpc: '2.0', id, result: { tools: MCP_TOOLS } };
      case 'tools/call': {
        const name = params && params.name;
        const args = params && typeof params.arguments === 'object' ? params.arguments : {};
        let data;
        try {
          data = await mcpToolCall(name, args, env);
        } catch (e) {
          if (isNotification) return null;
          return { jsonrpc: '2.0', id, error: { code: -32603, message: 'Internal error', data: String(e && e.message || e) } };
        }
        if (data === null || data === undefined) {
          // unknown tool name
          if (isNotification) return null;
          return { jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown tool: ${name}` } };
        }
        if (isNotification) return null;
        return {
          jsonrpc: '2.0', id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
            structuredContent: data,
            isError: false,
          },
        };
      }
      default:
        return isNotification ? null : { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
    }
  } catch (e) {
    if (isNotification) return null;
    return { jsonrpc: '2.0', id, error: { code: -32603, message: 'Internal error', data: String(e && e.message || e) } };
  }
}
