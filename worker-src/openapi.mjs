// worker-src/openapi.mjs — OpenAPI 3.1 specification, single source of truth
// (Section 8 of the original site/_worker.js, ported verbatim) plus the
// minimal deterministic YAML serializer.

import { BASE, API_VERSION } from './constants.mjs';
import { KNOWN_SCOPES } from './keys.mjs';
import { VALID_SUBTESTS } from './bank.mjs';

const errorSchemaRef = { $ref: '#/components/schemas/Error' };

function jsonResponse(description, schema) {
  return { description, content: { 'application/json': { schema } } };
}

function stdErrors(...codes) {
  const responses = {
    400: jsonResponse('Bad request — structured error envelope.', errorSchemaRef),
    401: jsonResponse('Unauthorized — structured error envelope.', errorSchemaRef),
    404: jsonResponse('Not found — structured error envelope.', errorSchemaRef),
    500: jsonResponse('Server error — structured error envelope.', errorSchemaRef),
  };
  const map = { 403: 'Forbidden', 409: 'Conflict', 429: 'Too many requests', 405: 'Method not allowed' };
  for (const c of codes) if (map[c]) responses[c] = jsonResponse(map[c] + ' — structured error envelope.', errorSchemaRef);
  return responses;
}

const SCOPES_DESC = Object.assign({}, ...KNOWN_SCOPES.map(s => ({ [s]: `Read access to ${s.split(':')[0]} resources` })));

export const openApiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'Learndiag API',
    version: API_VERSION,
    summary: 'Public API for the Learndiag Praxis 5001 readiness tool: practice-question bank, subtest metadata and account sync.',
    description:
      'Learndiag is a free Praxis 5001 (Elementary Education: Multiple Subjects) study tool. ' +
      'This API exposes the public practice-question bank (969 original questions across four subtests), ' +
      'bank statistics, and the same account endpoints the web app uses.\n\n' +
      '**Authentication tiers**\n\n' +
      '- Anonymous: all `GET /api/v1/*` reads work with no credentials (public tier).\n' +
      `- Scoped API key: send \`X-API-Key: tri_live_...\`. Create a free key with \`POST /api/v1/keys\`. Scopes: ${KNOWN_SCOPES.join(', ')}.\n` +
      '- Bearer JWT: account endpoints (`/api/state`) use the token returned by `POST /api/login`.\n\n' +
      'All errors use one structured envelope: `{ "error": { "code", "message", "hint" }, "status" }`.',
    contact: { name: 'Learndiag support', email: 'abc15531888397@gmail.com', url: `${BASE}/contact` },
    termsOfService: `${BASE}/terms-of-service.md`,
  },
  servers: [{ url: BASE, description: 'Production' }],
  tags: [
    { name: 'public-data', description: 'Read-only question bank endpoints (anonymous access allowed)' },
    { name: 'api-keys', description: 'Self-serve scoped API key management' },
    { name: 'account', description: 'Account creation, verification and cloud state sync used by the web app' },
  ],
  paths: {
    '/api/v1/health': {
      get: {
        tags: ['public-data'],
        operationId: 'getHealth',
        summary: 'Service health check',
        description: 'Returns service availability, version and the list of public endpoints. Suitable as an uptime probe.',
        security: [],
        responses: {
          200: jsonResponse('Service is healthy.', {
            type: 'object',
            properties: {
              ok: { type: 'boolean', const: true },
              service: { type: 'string', const: 'triumph-api' },
              version: { type: 'string' },
              time: { type: 'string', format: 'date-time' },
              endpoints: { type: 'array', items: { type: 'string' } },
              docs: { type: 'string', format: 'uri' },
            },
          }),
        },
      },
    },
    '/api/v1/meta': {
      get: {
        tags: ['public-data'],
        operationId: 'getApiMeta',
        summary: 'Product and subtest metadata',
        description: 'Returns the four Praxis 5001 subtests with their content categories, per-subtest question counts and pointers to the developer documentation.',
        security: [{ ApiKeyAuth: ['meta:read'] }],
        responses: {
          200: jsonResponse('Metadata about the question bank.', { $ref: '#/components/schemas/MetaResponse' }),
          ...stdErrors(),
        },
      },
    },
    '/api/v1/stats': {
      get: {
        tags: ['public-data'],
        operationId: 'getQuestionStats',
        summary: 'Question-bank statistics',
        description: 'Counts of practice questions per subtest and per content category.',
        security: [{ ApiKeyAuth: ['stats:read'] }],
        responses: {
          200: jsonResponse('Bank statistics.', { $ref: '#/components/schemas/StatsResponse' }),
          ...stdErrors(403),
        },
      },
    },
    '/api/v1/questions': {
      get: {
        tags: ['public-data'],
        operationId: 'listQuestions',
        summary: 'List practice questions',
        description: 'Paginated access to the full original question bank. Filter by subtest code, content category, or a case-insensitive substring search on the question text.',
        security: [{ ApiKeyAuth: ['questions:read'] }],
        parameters: [
          { name: 'subtest', in: 'query', schema: { type: 'string', enum: VALID_SUBTESTS }, description: 'Subtest code filter' },
          { name: 'category', in: 'query', schema: { type: 'string' }, description: 'Case-insensitive exact category-name filter' },
          { name: 'search', in: 'query', schema: { type: 'string' }, description: 'Case-insensitive substring match on question text' },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 }, description: 'Page size' },
          { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 }, description: 'Pagination offset' },
        ],
        responses: {
          200: jsonResponse('A page of questions.', { $ref: '#/components/schemas/QuestionPage' }),
          ...stdErrors(403),
        },
      },
    },
    '/api/v1/questions/random': {
      get: {
        tags: ['public-data'],
        operationId: 'getRandomQuestions',
        summary: 'Random practice questions',
        description: 'Draws random questions from the bank (optionally filtered). Useful for generating quick quizzes.',
        security: [{ ApiKeyAuth: ['questions:read'] }],
        parameters: [
          { name: 'count', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 50, default: 5 }, description: 'Number of questions to draw' },
          { name: 'subtest', in: 'query', schema: { type: 'string', enum: VALID_SUBTESTS }, description: 'Subtest code filter' },
          { name: 'category', in: 'query', schema: { type: 'string' }, description: 'Category filter' },
        ],
        responses: {
          200: jsonResponse('Randomly drawn questions.', { $ref: '#/components/schemas/RandomQuestionSet' }),
          ...stdErrors(403),
        },
      },
    },
    '/api/v1/keys': {
      post: {
        tags: ['api-keys'],
        operationId: 'createApiKey',
        summary: 'Create a free scoped API key (self-serve)',
        description: 'Issues a free-tier API key immediately — no account required. The key is returned once; store it securely. Rate limited to 10 keys per hour per IP.',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateKeyRequest' },
              examples: {
                anonymous: { value: { scopes: ['questions:read'] } },
                attributed: { value: { email: 'you@example.com', scopes: ['meta:read', 'questions:read', 'stats:read'] } },
              },
            },
          },
        },
        responses: {
          201: jsonResponse('Key created. The plaintext key appears exactly once in this response.', { $ref: '#/components/schemas/CreateKeyResponse' }),
          ...stdErrors(429),
        },
      },
    },
    '/api/v1/keys/verify': {
      get: {
        tags: ['api-keys'],
        operationId: 'verifyApiKey',
        summary: 'Verify an API key and inspect its scopes',
        description: 'Confirms a key is valid and returns the scopes it holds. Pass the key as the X-API-Key header.',
        security: [{ ApiKeyAuth: KNOWN_SCOPES }],
        responses: {
          200: jsonResponse('Key is valid.', {
            type: 'object',
            properties: {
              ok: { type: 'boolean', const: true },
              valid: { type: 'boolean', const: true },
              scopes: { type: 'array', items: { type: 'string', enum: KNOWN_SCOPES } },
              tier: { type: 'string', const: 'free' },
              created_at: { type: 'string', format: 'date-time' },
            },
          }),
          ...stdErrors(),
        },
      },
    },
    '/api/register': {
      post: {
        tags: ['account'],
        operationId: 'registerAccount',
        summary: 'Register an account',
        description: 'Creates an unverified account and emails a 6-digit verification code. Responds with `need_verify: true`; activate with `POST /api/verify`.',
        security: [],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Credentials' } } } },
        responses: {
          200: jsonResponse('Account created; verification email sent.', {
            type: 'object',
            properties: { need_verify: { type: 'boolean', const: true }, message: { type: 'string' } },
          }),
          ...stdErrors(409, 429),
        },
      },
    },
    '/api/login': {
      post: {
        tags: ['account'],
        operationId: 'loginAccount',
        summary: 'Log in',
        description: 'Verifies credentials and returns a JWT (30-day expiry) plus the user record. Unverified accounts receive a structured `not_verified` error.',
        security: [],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Credentials' } } } },
        responses: {
          200: jsonResponse('Authenticated.', {
            type: 'object',
            properties: {
              token: { type: 'string', description: 'JWT; send as Authorization: Bearer <token>' },
              user: { $ref: '#/components/schemas/User' },
              verified: { type: 'boolean', const: true },
            },
          }),
          ...stdErrors(),
        },
      },
    },
    '/api/verify': {
      post: {
        tags: ['account'],
        operationId: 'verifyAccount',
        summary: 'Activate an account with the emailed code',
        description: 'Checks the 6-digit code, marks the account verified and returns a JWT.',
        security: [],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/VerifyRequest' } } } },
        responses: {
          200: jsonResponse('Account verified; JWT returned.', {
            type: 'object',
            properties: { token: { type: 'string' }, user: { $ref: '#/components/schemas/User' }, verified: { type: 'boolean', const: true } },
          }),
          ...stdErrors(404),
        },
      },
    },
    '/api/resend': {
      post: {
        tags: ['account'],
        operationId: 'resendVerificationCode',
        summary: 'Resend the verification email',
        description: 'Generates and emails a fresh 6-digit code (valid 15 minutes).',
        security: [],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/EmailOnly' } } } },
        responses: {
          200: jsonResponse('Code sent.', { type: 'object', properties: { ok: { type: 'boolean', const: true } } }),
          ...stdErrors(404),
        },
      },
    },
    '/api/logout': {
      post: {
        tags: ['account'],
        operationId: 'logoutAccount',
        summary: 'Log out (client-side token removal)',
        description: 'Kept for interface completeness: tokens are removed client-side; this endpoint simply acknowledges.',
        security: [],
        responses: { 200: jsonResponse('Acknowledged.', { type: 'object', properties: { ok: { type: 'boolean', const: true } } }) },
      },
    },
    '/api/me': {
      get: {
        tags: ['account'],
        operationId: 'getCurrentUser',
        summary: 'Current authenticated user',
        description: 'Resolves the Bearer token to the user record.',
        security: [{ BearerAuth: [] }],
        responses: {
          200: jsonResponse('The authenticated user.', { type: 'object', properties: { user: { $ref: '#/components/schemas/User' } } }),
          ...stdErrors(),
        },
      },
    },
    '/api/state': {
      get: {
        tags: ['account'],
        operationId: 'getState',
        summary: 'Read the caller’s synced study state',
        description: 'Returns the cloud-synced study state (answers, mastery, plan, spaced-repetition data) for the authenticated user.',
        security: [{ BearerAuth: [] }],
        responses: {
          200: jsonResponse('Current state (may be null for a fresh account).', {
            type: 'object',
            properties: { state: { $ref: '#/components/schemas/StudyState' } },
          }),
          ...stdErrors(),
        },
      },
      put: {
        tags: ['account'],
        operationId: 'putState',
        summary: 'Write the caller’s synced study state',
        description: 'Overwrites the cloud copy of the study state. A timestamp is added server-side.',
        security: [{ BearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/PutStateRequest' } } } },
        responses: {
          200: jsonResponse('State saved.', { type: 'object', properties: { ok: { type: 'boolean', const: true } } }),
          ...stdErrors(),
        },
      },
    },
  },
  components: {
    securitySchemes: {
      ApiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
        description: 'Self-serve scoped key. Free tier — create via POST /api/v1/keys.',
        'x-scopes': SCOPES_DESC,
      },
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'JWT issued by POST /api/login or POST /api/verify.',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        description: 'Structured error envelope returned by every non-2xx response.',
        properties: {
          error: {
            type: 'object',
            properties: {
              code: { type: 'string', description: 'Stable machine-readable error code, e.g. invalid_email.' },
              message: { type: 'string', description: 'Human-readable summary.' },
              hint: { type: 'string', description: 'Actionable resolution hint for agents.' },
              details: { type: 'object', description: 'Optional machine-readable context (offending field, allowed values, etc.).' },
            },
            required: ['code', 'message', 'hint'],
          },
          status: { type: 'integer', description: 'Mirrors the HTTP status code.' },
        },
        required: ['error', 'status'],
      },
      Question: {
        type: 'object',
        properties: {
          id: { type: 'string', examples: ['5002-001'] },
          subtest_code: { type: 'string', enum: VALID_SUBTESTS },
          subtest: { type: 'string' },
          category: { type: 'string' },
          question: { type: 'string' },
          options: { type: 'array', items: { type: 'string' } },
          answer_index: { type: 'integer', minimum: 0, maximum: 3 },
          answer_text: { type: 'string' },
          explanation: { type: 'string' },
        },
        required: ['id', 'subtest_code', 'subtest', 'category', 'question', 'options', 'answer_index', 'answer_text', 'explanation'],
      },
      QuestionPage: {
        type: 'object',
        properties: {
          ok: { type: 'boolean', const: true },
          total: { type: 'integer', description: 'Total matching questions before pagination.' },
          count: { type: 'integer', description: 'Questions on this page.' },
          limit: { type: 'integer' },
          offset: { type: 'integer' },
          items: { type: 'array', items: { $ref: '#/components/schemas/Question' } },
        },
      },
      RandomQuestionSet: {
        type: 'object',
        properties: {
          ok: { type: 'boolean', const: true },
          count: { type: 'integer' },
          total_pool: { type: 'integer' },
          items: { type: 'array', items: { $ref: '#/components/schemas/Question' } },
        },
      },
      MetaResponse: {
        type: 'object',
        properties: {
          product: { type: 'string', const: 'Learndiag' },
          description: { type: 'string' },
          base_url: { type: 'string', format: 'uri' },
          subtests: { type: 'object', description: 'Map of subtest code → { name, questionCount, categories[] }' },
          total_questions: { type: 'integer' },
          passing_model: { type: 'string' },
          docs: { type: 'object', properties: {
            openapi: { type: 'string', format: 'uri' },
            developers: { type: 'string', format: 'uri' },
            mcp: { type: 'string', format: 'uri' },
            llms: { type: 'string', format: 'uri' },
          } },
        },
      },
      StatsResponse: {
        type: 'object',
        properties: {
          ok: { type: 'boolean', const: true },
          total: { type: 'integer' },
          generatedAt: { type: 'string', format: 'date' },
          subtests: { type: 'object' },
        },
      },
      CreateKeyRequest: {
        type: 'object',
        properties: {
          email: { type: 'string', format: 'email', description: 'Optional — lets us contact you about breaking changes.' },
          scopes: { type: 'array', items: { type: 'string', enum: KNOWN_SCOPES }, default: KNOWN_SCOPES, description: 'Least-privilege scopes for this key.' },
        },
      },
      CreateKeyResponse: {
        type: 'object',
        properties: {
          ok: { type: 'boolean', const: true },
          key: { type: 'string', pattern: '^tri_live_[0-9a-f]{40}$', description: 'Plaintext key — shown exactly once.' },
          scopes: { type: 'array', items: { type: 'string' } },
          tier: { type: 'string', const: 'free' },
          note: { type: 'string' },
          docs: { type: 'string', format: 'uri' },
        },
        required: ['ok', 'key', 'scopes', 'tier'],
      },
      Credentials: {
        type: 'object',
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 8 },
        },
        required: ['email', 'password'],
      },
      EmailOnly: {
        type: 'object',
        properties: { email: { type: 'string', format: 'email' } },
        required: ['email'],
      },
      VerifyRequest: {
        type: 'object',
        properties: {
          email: { type: 'string', format: 'email' },
          code: { type: 'string', minLength: 6, maxLength: 6, description: '6-digit code from the verification email.' },
        },
        required: ['email', 'code'],
      },
      User: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' }, email: { type: 'string', format: 'email' } },
        required: ['id', 'email'],
      },
      PutStateRequest: {
        type: 'object',
        properties: { state: { $ref: '#/components/schemas/StudyState' } },
        required: ['state'],
      },
      StudyState: {
        type: 'object',
        description: 'Free-form study-state document (answers, mastery map, plan, SRS data, exam date).',
        properties: {
          answers: { type: 'array', items: { type: 'object' } },
          mastery: { type: 'object' },
          plan: { type: ['object', 'null'] },
          srs: { type: 'object' },
          tasks: { type: 'object' },
          examDate: { type: 'string' },
          updatedAt: { type: 'integer', description: 'Set by the server on write.' },
        },
      },
    },
  },
};

/* ---------- minimal deterministic YAML serializer (subset emitter) ---------- */

function yamlScalar(value) {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : JSON.stringify(String(value));
  if (typeof value === 'string') return JSON.stringify(value); // double-quoted ⇒ unambiguous
  throw new TypeError('yamlScalar: unsupported scalar');
}

function yamlEmit(value, indent) {
  const pad = ' '.repeat(indent);
  if (Array.isArray(value)) {
    if (!value.length) return pad + '[]';
    return value.map(item => {
      if (item !== null && typeof item === 'object') {
        const inner = yamlEmit(item, indent + 2);
        return `${pad}-\n${inner}`;
      }
      return `${pad}- ${yamlScalar(item)}`;
    }).join('\n');
  }
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value);
    if (!keys.length) return pad + '{}';
    return keys.map(key => {
      const child = value[key];
      const safeKey = /^[A-Za-z0-9_.\-/]+$/.test(key) ? key : JSON.stringify(key);
      if (child !== null && typeof child === 'object') {
        const isEmpty = (Array.isArray(child) && child.length === 0) ||
          (!Array.isArray(child) && Object.keys(child).length === 0);
        if (isEmpty) return `${pad}${safeKey}: ${Array.isArray(child) ? '[]' : '{}'}`;
        return `${pad}${safeKey}:\n${yamlEmit(child, indent + 2)}`;
      }
      return `${pad}${safeKey}: ${yamlScalar(child)}`;
    }).join('\n');
  }
  return pad + yamlScalar(value);
}

export function specToYaml(spec) {
  return yamlEmit(spec, 0) + '\n';
}
