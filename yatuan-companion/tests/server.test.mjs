import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { createYatuanServer, makeConfig, parseEnv, validateMessages } from '../server.mjs';

const FAKE_KEY = 'test-only-never-a-real-key';
const userMessages = [{ role: 'user', content: '今天吃什么？' }];
const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
const close = (server) => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); });

async function fixture(t, { upstreamHandler, configured = true, options = {} } = {}) {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'yatuan-server-test-'));
  const distDir = path.join(temp, 'dist');
  await mkdir(distDir);
  await writeFile(path.join(distDir, 'index.html'), '<title>芽团测试</title>');
  await writeFile(path.join(temp, '.env'), 'secret-file-must-not-be-served');
  await symlink(path.join(temp, '.env'), path.join(distDir, 'leak.txt'));
  const requests = [];
  const upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requests.push({ headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
    if (upstreamHandler) return upstreamHandler(req, res, requests);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: '我陪你一起吃饭。' } }], internalSecret: FAKE_KEY }));
  });
  const upstreamUrl = await listen(upstream);
  const config = configured ? makeConfig({ YATUAN_AI_ENDPOINT: upstreamUrl + '/chat/completions', YATUAN_AI_MODEL: 'fixed-vision-model', YATUAN_AI_KEY: FAKE_KEY }, { allowLocalUpstream: true }) : makeConfig();
  const app = createYatuanServer({ config, distDir, ...options });
  const base = await listen(app);
  t.after(async () => { await Promise.all([close(app), close(upstream)]); await rm(temp, { recursive: true, force: true }); });
  const post = (body = { messages: userMessages }, extra = {}) => fetch(base + '/api/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, ...extra.headers }, body: typeof body === 'string' ? body : JSON.stringify(body), ...Object.fromEntries(Object.entries(extra).filter(([key]) => key !== 'headers')) });
  return { base, post, requests };
}

test('dotenv parser never evaluates values and limits accepted keys', () => {
  assert.deepEqual(parseEnv('# comment\nYATUAN_AI_MODEL="vision" # note\nYATUAN_AI_KEY=literal-$(do-not-run)\nIGNORED=oops'), { YATUAN_AI_MODEL: 'vision', YATUAN_AI_KEY: 'literal-$(do-not-run)' });
  assert.throws(() => parseEnv('YATUAN_AI_KEY="unterminated'));
  assert.throws(() => parseEnv('YATUAN_AI_KEY=abc\u0000'));
});

test('upstream configuration requires a fixed clean HTTPS address in production', () => {
  const values = { YATUAN_AI_MODEL: 'vision', YATUAN_AI_KEY: FAKE_KEY };
  assert.equal(makeConfig({ ...values, YATUAN_AI_ENDPOINT: 'https://example.test/v1/chat/completions' }).configured, true);
  for (const endpoint of ['http://localhost:9000/api', 'https://user:secret@example.test/api', 'https://example.test/api?key=secret', 'https://example.test/api#fragment', 'https://example.test/api?', 'https://example.test/a b']) {
    assert.throws(() => makeConfig({ ...values, YATUAN_AI_ENDPOINT: endpoint }));
  }
  assert.equal(makeConfig({ YATUAN_AI_ENDPOINT: 'https://example.test/api' }).configured, false);
});

test('health exposes only public configuration and missing configuration fails safely', async (t) => {
  const app = await fixture(t, { configured: false });
  const response = await fetch(app.base + '/api/health');
  assert.deepEqual(await response.json(), { configured: false, model: '', endpoint: '/api/chat/completions' });
  const post = await app.post();
  assert.equal(post.status, 503);
  assert.equal((await post.json()).error.code, 'not_configured');
  assert.equal(app.requests.length, 0);
});

test('proxy pins upstream model and authorization, returning only assistant text', async (t) => {
  const app = await fixture(t);
  const response = await app.post({ messages: userMessages, model: 'attacker-model', endpoint: 'https://wrong.example/', stream: true, token: 'not-forwarded' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { choices: [{ message: { role: 'assistant', content: '我陪你一起吃饭。' } }] });
  assert.equal(app.requests[0].headers.authorization, `Bearer ${FAKE_KEY}`);
  assert.deepEqual(app.requests[0].body, { model: 'fixed-vision-model', messages: userMessages, stream: false, max_tokens: 1000 });
  const health = await (await fetch(app.base + '/api/health')).text();
  assert.equal(health.includes(FAKE_KEY), false);
  assert.equal(health.includes('fixed-vision-model'), true);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

test('multimodal requests accept local image data and strip unknown image fields', async (t) => {
  const app = await fixture(t);
  const response = await app.post({ messages: [{ role: 'user', content: [{ type: 'text', text: '看看我的盘子' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,YWJjZA==', detail: 'high' } }] }] });
  assert.equal(response.status, 200);
  assert.deepEqual(app.requests[0].body.messages[0].content[1], { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,YWJjZA==' } });
});

test('JSON output forwards only the explicitly supported json_object format', async (t) => {
  const app = await fixture(t);
  assert.equal((await app.post({ messages: userMessages, response_format: { type: 'json_object', schema: 'must-not-be-forwarded' }, thinking: { type: 'enabled' } })).status, 200);
  assert.deepEqual(app.requests[0].body.response_format, { type: 'json_object' });
  assert.equal('thinking' in app.requests[0].body, false);
  assert.equal((await app.post({ messages: userMessages, response_format: { type: 'json_schema', schema: 'not-supported' } })).status, 200);
  assert.equal('response_format' in app.requests[1].body, false);
});

test('only the configured official DeepSeek host receives disabled thinking', async (t) => {
  for (const host of ['api.deepseek.com', 'another-provider.example', 'api.deepseek.com.other.example']) {
    let captured;
    const app = await fixture(t, { options: {
      config: makeConfig({ YATUAN_AI_ENDPOINT: `https://${host}/chat/completions`, YATUAN_AI_MODEL: 'deepseek-flash', YATUAN_AI_KEY: FAKE_KEY }),
      fetchImpl: async (_url, options) => {
        captured = JSON.parse(options.body);
        return new Response(JSON.stringify({ choices: [{ message: { content: 'mock only' } }] }), { status: 200 });
      },
    } });
    assert.equal((await app.post()).status, 200);
    if (host === 'api.deepseek.com') assert.deepEqual(captured.thinking, { type: 'disabled' });
    else assert.equal('thinking' in captured, false);
    assert.equal(captured.max_tokens, 1000);
  }
});

test('message validation rejects unbounded history, roles, remote images and unsupported types', () => {
  const invalid = [
    { messages: [] }, { messages: Array(65).fill(userMessages[0]) },
    { messages: [{ role: 'tool', content: 'do something' }] },
    { messages: [{ role: 'user', content: 'x'.repeat(16_001) }] },
    { messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://example.test/food.png' } }] }] },
    { messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/gif;base64,YWJjZA==' } }] }] },
    { messages: [{ role: 'assistant', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,YWJjZA==' } }] }] },
    { messages: [{ role: 'user', content: Array(5).fill({ type: 'image_url', image_url: { url: 'data:image/png;base64,YWJjZA==' } }) }] },
  ];
  for (const body of invalid) assert.throws(() => validateMessages(body));
});

test('POST requires same origin and loopback Host', async (t) => {
  const app = await fixture(t);
  for (const headers of [{ Origin: 'https://foreign.example' }, { Origin: '' }, { Origin: app.base, 'Sec-Fetch-Site': 'cross-site' }, { Host: 'foreign.example:4173', Origin: 'http://foreign.example:4173' }]) {
    const response = await app.post(undefined, { headers });
    assert.equal(response.status, 403);
  }
  assert.equal(app.requests.length, 0);
});

test('JSON, content type and total payload bounds are enforced', async (t) => {
  const app = await fixture(t);
  assert.equal((await app.post('{bad json')).status, 400);
  assert.equal((await app.post(undefined, { headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await app.post({ messages: [{ role: 'user', content: 'x'.repeat(2 * 1024 * 1024) }] })).status, 413);
  assert.equal(app.requests.length, 0);
});

test('static server serves only dist and blocks dotfiles, traversal and outside symlinks', async (t) => {
  const app = await fixture(t);
  const homepage = await fetch(app.base + '/');
  assert.equal(homepage.status, 200);
  assert.match(await homepage.text(), /芽团测试/);
  assert.equal((await fetch(app.base + '/', { method: 'HEAD' })).status, 200);
  for (const pathname of ['/.env', '/../.env', '/%2e%2e/%2eenv', '/..%2f.env', '/leak.txt', '/package.json', '/server.mjs']) {
    const response = await fetch(app.base + pathname);
    assert.equal(response.status, 404, pathname);
    assert.equal((await response.text()).includes('secret-file'), false);
  }
});

test('upstream errors never echo secrets or upstream bodies', async (t) => {
  const app = await fixture(t, { upstreamHandler: (_req, res) => { res.writeHead(401); res.end(`error authorization Bearer ${FAKE_KEY}`); } });
  const response = await app.post();
  assert.equal(response.status, 502);
  const body = await response.text();
  assert.equal(body.includes(FAKE_KEY), false);
  assert.equal(body.includes('authorization'), false);
});

test('upstream redirects are not followed and secrets in success text are redacted', async (t) => {
  const redirect = await fixture(t, { upstreamHandler: (_req, res) => { res.writeHead(302, { Location: 'https://should-never-be-contacted.invalid/' }); res.end(); } });
  assert.equal((await redirect.post()).status, 502);
  const success = await fixture(t, { upstreamHandler: (_req, res) => { res.end(JSON.stringify({ choices: [{ message: { content: `Oops ${FAKE_KEY}` } }] })); } });
  const response = await success.post();
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.equal(body.includes(FAKE_KEY), false);
  assert.equal(body.includes('已隐藏密钥'), true);
});

test('slow upstream is aborted with a safe timeout response', async (t) => {
  const app = await fixture(t, { options: { timeoutMs: 40 }, upstreamHandler: () => {} });
  const response = await app.post();
  assert.equal(response.status, 504);
  assert.equal((await response.json()).error.code, 'upstream_timeout');
});

test('per-minute requests and concurrent upstream calls are bounded', async (t) => {
  const limited = await fixture(t, { options: { maxRequestsPerMinute: 2 } });
  assert.equal((await limited.post()).status, 200);
  assert.equal((await limited.post()).status, 200);
  const rateLimited = await limited.post();
  assert.equal(rateLimited.status, 429);
  assert.equal(rateLimited.headers.get('retry-after'), '5');
  const pending = [];
  const concurrent = await fixture(t, { options: { maxConcurrent: 1 }, upstreamHandler: (_req, res) => pending.push(res) });
  const first = concurrent.post();
  for (let attempt = 0; attempt < 50 && pending.length === 0; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(pending.length, 1);
  assert.equal((await concurrent.post()).status, 429);
  pending[0].end(JSON.stringify({ choices: [{ message: { content: '完成' } }] }));
  assert.equal((await first).status, 200);
});
