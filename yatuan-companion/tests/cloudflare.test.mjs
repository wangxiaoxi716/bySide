import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi, makeConfig, validateMessages } from '../functions/api/[[path]].js';

const ORIGIN = 'https://byside.pages.dev';
const FAKE_AI_KEY = 'fake-cloudflare-test-ai-key';
const FAKE_TTS_KEY = 'fake-cloudflare-test-tts-key';
const ENV = { YATUAN_AI_ENDPOINT: 'https://provider.example/v1/chat/completions', YATUAN_AI_MODEL: 'fixed-model', YATUAN_AI_KEY: FAKE_AI_KEY, YATUAN_TTS_KEY: FAKE_TTS_KEY };
const MESSAGES = [{ role: 'user', content: '今天吃什么？' }];
const answer = (content = '我陪你一起吃饭。') => new Response(JSON.stringify({ choices: [{ message: { content } }], internalSecret: FAKE_AI_KEY }));
const audio = (extra = '') => new Response(JSON.stringify({ code: 0, data: btoa('fake-mp3') }) + '\n' + JSON.stringify({ code: 20000000 }) + extra);

function fixture(options = {}) {
  const calls = [];
  const handler = createApi({ fetchImpl: async (url, init) => { calls.push({ url, ...init, payload: JSON.parse(init.body) }); return url.includes('openspeech.') ? audio() : answer(); }, ...options });
  const request = (path = '/api/chat/completions', body = { messages: MESSAGES }, { env = ENV, headers = {}, ...init } = {}) => handler({ request: new Request(ORIGIN + path, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body), ...init }), env });
  return { calls, handler, request, health: (env = ENV) => handler({ request: new Request(ORIGIN + '/api/health'), env }) };
}

test('Pages health matches the frontend contract and does not expose secrets', async () => {
  const app = fixture();
  assert.deepEqual(await (await app.health({})).json(), { configured: false, model: '', endpoint: '/api/chat/completions' });
  const response = await app.health();
  assert.deepEqual(await response.json(), { configured: true, model: 'fixed-model', endpoint: '/api/chat/completions' });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  for (const path of ['/api/chat/completions', '/api/tts']) {
    const unavailable = await app.request(path, { messages: MESSAGES, text: '你好' }, { env: {} });
    assert.equal(unavailable.status, 503);
    assert.equal((await unavailable.json()).error.code, 'not_configured');
  }
  assert.equal(app.calls.length, 0);
});

test('cloud configuration accepts only fixed HTTPS endpoints and clean credentials', () => {
  assert.equal(makeConfig(ENV).configured, true);
  for (const endpoint of ['http://localhost:9000/api', 'https://user:secret@example.test/api', 'https://example.test/api?key=secret', 'https://example.test/api#fragment', 'https://example.test/api?', 'https://example.test/a b', 'https://example.test/a\\b']) {
    assert.throws(() => makeConfig({ ...ENV, YATUAN_AI_ENDPOINT: endpoint }));
  }
  assert.throws(() => makeConfig({ ...ENV, YATUAN_AI_KEY: 'bad\nkey' }));
  assert.throws(() => makeConfig({ ...ENV, YATUAN_TTS_KEY: 'bad\nkey' }));
});

test('Workers-compatible manual redirects reject upstream relocation without following it', async () => {
  let calls = 0;
  const app = fixture({ fetchImpl: async (_url, init) => {
    if (!['follow', 'manual'].includes(init.redirect)) throw new TypeError('Invalid redirect value');
    assert.equal(init.redirect, 'manual');
    calls += 1;
    return new Response('', { status: 302, headers: { Location: 'https://different-host.example/collect' } });
  } });
  for (const path of ['/api/chat/completions', '/api/tts']) {
    const response = await app.request(path, { messages: MESSAGES, text: '你好' });
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error.code, 'upstream_error');
  }
  assert.equal(calls, 2);
});

test('all paid routes require same-origin JSON POST and reject other API paths', async () => {
  const app = fixture();
  for (const path of ['/api/chat/completions', '/api/tts']) {
    for (const headers of [{ Origin: '' }, { Origin: 'https://foreign.example' }, { Origin: 'https://evil.byside.pages.dev' }, { 'Sec-Fetch-Site': 'cross-site' }]) assert.equal((await app.request(path, {}, { headers })).status, 403);
    assert.equal((await app.request(path, {}, { method: 'OPTIONS', body: undefined })).status, 405);
    assert.equal((await app.request(path, {}, { headers: { 'Content-Type': 'text/plain' } })).status, 415);
  }
  assert.equal((await app.request('/api/not-real')).status, 404);
  assert.equal((await app.request('/api/health')).status, 405);
  assert.equal(app.calls.length, 0);
});

test('JSON uploads are bounded by actual bytes as well as Content-Length', async () => {
  const app = fixture();
  assert.equal((await app.request(undefined, '{bad json')).status, 400);
  assert.equal((await app.request(undefined, { messages: MESSAGES }, { headers: { 'Content-Length': String(2 * 1024 * 1024 + 1) } })).status, 413);
  assert.equal((await app.request(undefined, { messages: [{ role: 'user', content: '中'.repeat(800_000) }] })).status, 413);
  assert.equal((await app.request('/api/tts', { text: 'x'.repeat(2 * 1024 * 1024) })).status, 413);
  assert.equal(app.calls.length, 0);
});

test('slow incoming streams are canceled and time out', async () => {
  let canceled = false;
  const stream = new ReadableStream({ cancel() { canceled = true; } });
  const app = fixture({ bodyTimeoutMs: 10 });
  const response = await app.request(undefined, {}, { body: stream, duplex: 'half' });
  assert.equal(response.status, 408);
  assert.equal(canceled, true);
  assert.equal(app.calls.length, 0);
});

test('chat pins upstream configuration, strips injected options and hides metadata', async () => {
  const app = fixture();
  const response = await app.request(undefined, { messages: MESSAGES, model: 'attacker-model', endpoint: 'https://wrong.example', stream: true, max_tokens: 999_999, key: 'evil' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { choices: [{ message: { role: 'assistant', content: '我陪你一起吃饭。' } }] });
  assert.equal(app.calls[0].url, ENV.YATUAN_AI_ENDPOINT);
  assert.equal(app.calls[0].headers.Authorization, `Bearer ${FAKE_AI_KEY}`);
  assert.equal(app.calls[0].redirect, 'manual');
  assert.deepEqual(app.calls[0].payload, { model: 'fixed-model', messages: MESSAGES, stream: false, max_tokens: 1000 });
});

test('multimodal validation preserves bounded local images and strips unknown fields', async () => {
  const app = fixture();
  const image = { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,YWJjZA==', detail: 'high' } };
  assert.equal((await app.request(undefined, { messages: [{ role: 'user', content: [{ type: 'text', text: '看看' }, image] }] })).status, 200);
  assert.deepEqual(app.calls[0].payload.messages[0].content[1], { type: 'image_url', image_url: { url: image.image_url.url } });
  for (const body of [null, { messages: [] }, { messages: Array(65).fill(MESSAGES[0]) }, { messages: [{ role: 'tool', content: 'hello' }] }, { messages: [{ role: 'user', content: 'x'.repeat(16001) }] }, { messages: [{ role: 'assistant', content: [image] }] }, { messages: [{ role: 'user', content: Array(5).fill(image) }] }, { messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://example.test/a.png' } }] }] }]) assert.throws(() => validateMessages(body));
});

test('only supported JSON format and official DeepSeek thinking configuration are forwarded', async () => {
  for (const host of ['api.deepseek.com', 'api.deepseek.com.evil.test', 'other.example']) {
    const app = fixture();
    await app.request(undefined, { messages: MESSAGES, response_format: { type: 'json_object', schema: 'strip' }, thinking: { type: 'enabled' } }, { env: { ...ENV, YATUAN_AI_ENDPOINT: `https://${host}/chat/completions` } });
    assert.deepEqual(app.calls[0].payload.response_format, { type: 'json_object' });
    assert.deepEqual(app.calls[0].payload.thinking, host === 'api.deepseek.com' ? { type: 'disabled' } : undefined);
  }
});

test('chat rejects oversized or malformed upstream replies and scrubs both secrets', async () => {
  for (const result of ['invalid JSON', JSON.stringify({ choices: [] }), 'x'.repeat(2 * 1024 * 1024 + 1), JSON.stringify({ choices: [{ message: { content: 'x'.repeat(100_001) } }] })]) {
    const app = fixture({ fetchImpl: async () => new Response(result) });
    assert.equal((await app.request()).status, 502);
  }
  const app = fixture({ fetchImpl: async () => answer(`oops ${FAKE_AI_KEY} ${FAKE_TTS_KEY}`) });
  const response = await app.request();
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.equal(body.includes(FAKE_AI_KEY), false);
  assert.equal(body.includes(FAKE_TTS_KEY), false);
  assert.match(body, /已隐藏密钥/);
});

test('upstream failures and TTS errors never echo provider text or credentials', async () => {
  const providerSecret = `Authorization ${FAKE_AI_KEY} ${FAKE_TTS_KEY}`;
  for (const path of ['/api/chat/completions', '/api/tts']) {
    for (const status of [302, 401, 429, 500]) {
      const app = fixture({ fetchImpl: async () => new Response(providerSecret, { status }) });
      const response = await app.request(path, { messages: MESSAGES, text: '你好' });
      assert.equal(response.status, status === 429 ? 429 : 502);
      const body = await response.text();
      assert.equal(body.includes(FAKE_AI_KEY), false);
      assert.equal(body.includes(FAKE_TTS_KEY), false);
      assert.equal(body.includes('Authorization'), false);
    }
  }
  const app = fixture({ fetchImpl: async () => new Response(JSON.stringify({ code: 400, message: providerSecret })) });
  const response = await app.request('/api/tts', { text: '你好' });
  assert.equal(response.status, 502);
  assert.equal((await response.text()).includes(providerSecret), false);
});

test('chat and TTS deadlines abort both waiting fetches and response streams', async () => {
  for (const path of ['/api/chat/completions', '/api/tts']) {
    let signal;
    const app = fixture({ timeoutMs: 10, ttsTimeoutMs: 10, fetchImpl: (_url, init) => { signal = init.signal; return new Promise(() => {}); } });
    assert.equal((await app.request(path, { messages: MESSAGES, text: '你好' })).status, 504);
    assert.equal(signal.aborted, true);
    let canceled = false;
    const streamed = fixture({ timeoutMs: 10, ttsTimeoutMs: 10, fetchImpl: async () => new Response(new ReadableStream({ cancel() { canceled = true; } })) });
    const response = await streamed.request(path, { messages: MESSAGES, text: '你好' });
    assert.equal(response.status, 504);
    assert.equal(canceled, true);
  }
});

test('per-minute and concurrency limits cover chat and TTS together and recover', async () => {
  let clock = 1;
  const app = fixture({ maxRequestsPerMinute: 2, now: () => clock });
  assert.equal((await app.request()).status, 200);
  assert.equal((await app.request('/api/tts', { text: '你好' })).status, 200);
  const limited = await app.request();
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '5');
  clock += 60_001;
  assert.equal((await app.request()).status, 200);
  let resolveUpstream, started;
  const didStart = new Promise((resolve) => { started = resolve; });
  const concurrent = fixture({ maxConcurrent: 1, fetchImpl: () => new Promise((resolve) => { resolveUpstream = resolve; started(); }) });
  const pending = concurrent.request();
  await didStart;
  assert.equal((await concurrent.request('/api/tts', { text: '你好' })).status, 429);
  resolveUpstream(answer());
  assert.equal((await pending).status, 200);
});

test('TTS supports an independent key, fixes speaker/format and caps text at 1600 characters', async () => {
  const app = fixture();
  const response = await app.request('/api/tts', { text: ' 中'.repeat(1700), speaker: 'injected', model: 'injected' }, { env: { YATUAN_TTS_KEY: FAKE_TTS_KEY } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'audio/mpeg');
  assert.equal(response.headers.get('content-length'), '8');
  assert.equal(await response.text(), 'fake-mp3');
  assert.equal(app.calls[0].headers['X-Api-Key'], FAKE_TTS_KEY);
  assert.equal(app.calls[0].redirect, 'manual');
  assert.equal(app.calls[0].payload.req_params.text.length, 1600);
  assert.equal(app.calls[0].payload.req_params.speaker, 'zh_female_vv_uranus_bigtts');
  assert.deepEqual(app.calls[0].payload.req_params.audio_params, { format: 'mp3', sample_rate: 24000 });
  for (const body of [null, [], {}, { text: '  ' }, { text: {} }, { text: 123 }]) assert.equal((await app.request('/api/tts', body)).status, 400);
});

test('TTS bounds both encoded responses and decoded audio and rejects malformed data', async () => {
  const cases = ['x'.repeat(8 * 1024 * 1024 + 1), JSON.stringify({ code: 0, data: btoa('x'.repeat(5 * 1024 * 1024 + 1)) }), JSON.stringify({ code: 0, data: '?!@#' }), JSON.stringify({ code: 20000000 }), 'not-json', 'null'];
  for (const result of cases) {
    const app = fixture({ fetchImpl: async () => new Response(result) });
    assert.equal((await app.request('/api/tts', { text: '你好' })).status, 502);
  }
});
