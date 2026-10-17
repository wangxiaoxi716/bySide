// Cloudflare Pages Functions: Web APIs only; the local Node server stays separate.
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
const MAX_TTS_RESPONSE_BYTES = 8 * 1024 * 1024;
const TTS_ENDPOINT = 'https://openspeech.bytedance.com/api/v3/tts/unidirectional';
const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'SAMEORIGIN',
  'Permissions-Policy': 'camera=(self), microphone=(self)',
};

class RequestError extends Error {
  constructor(status, message, code = 'invalid_request') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', ...headers } });
}

export function makeConfig(values = {}) {
  const endpoint = String(values.YATUAN_AI_ENDPOINT || '').trim();
  const model = String(values.YATUAN_AI_MODEL || '').trim();
  const key = String(values.YATUAN_AI_KEY || '').trim();
  const ttsKey = String(values.YATUAN_TTS_KEY || '').trim();
  const badConfig = () => new RequestError(503, '云端 AI 配置格式不正确，请检查 Cloudflare 环境变量。', 'invalid_configuration');
  if (ttsKey.length > 4096 || /[\u0000-\u001f\u007f]/.test(ttsKey)) throw badConfig();
  if (!endpoint || !model || !key) return { configured: false, endpoint: '', model: '', key: '', ttsKey };
  if (endpoint.length > 2048 || model.length > 120 || key.length > 4096 || /[\s\\\u0000-\u001f\u007f]/.test(endpoint) || /[\u0000-\u001f\u007f]/.test(model + key)) throw badConfig();
  let url;
  try { url = new URL(endpoint); } catch { throw badConfig(); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || endpoint.includes('?') || endpoint.includes('#')) throw badConfig();
  return { configured: true, endpoint: url.href, model, key, ttsKey };
}

export function validateMessages(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !Array.isArray(body.messages) || !body.messages.length || body.messages.length > 64) throw new RequestError(400, '对话需包含 1 至 64 条消息。');
  let totalText = 0, images = 0;
  const text = (value) => {
    if (typeof value !== 'string' || value.length > 16_000 || (totalText += value.length) > 100_000) throw new RequestError(400, '对话文字过长或格式不正确。');
    return value;
  };
  return body.messages.map((message) => {
    if (!message || !['system', 'developer', 'user', 'assistant'].includes(message.role)) throw new RequestError(400, '对话角色格式不正确。');
    if (typeof message.content === 'string') return { role: message.role, content: text(message.content) };
    if (!Array.isArray(message.content) || !message.content.length || message.content.length > 8) throw new RequestError(400, '对话内容格式不正确。');
    const content = message.content.map((part) => {
      if (part?.type === 'text') return { type: 'text', text: text(part.text) };
      if (part?.type !== 'image_url' || message.role !== 'user' || ++images > 4) throw new RequestError(400, '图片只能附在用户消息中，每次最多 4 张。');
      const url = part.image_url?.url;
      if (typeof url !== 'string' || url.length > 1_850_000 || !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(url)) throw new RequestError(400, '请发送压缩后的 JPEG、PNG 或 WebP 图片。');
      return { type: 'image_url', image_url: { url } };
    });
    return { role: message.role, content };
  });
}

// Bound both uploaded data and upstream responses without Node Buffer or .text().
async function readBytes(body, limit, tooLarge, signal) {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks = [];
  let bytes = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    if (signal.aborted) throw signal.reason;
    while (true) {
      const { done, value } = await reader.read();
      if (signal.aborted) throw signal.reason;
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) { abort(); throw tooLarge; }
      chunks.push(value);
    }
    const result = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
    return result;
  } finally {
    signal.removeEventListener('abort', abort);
    reader.releaseLock();
  }
}

async function withDeadline(request, milliseconds, timeoutError, operation) {
  const controller = new AbortController();
  const disconnected = () => controller.abort(new RequestError(400, '请求传输中断。', 'request_aborted'));
  const timer = setTimeout(() => controller.abort(timeoutError), milliseconds);
  request.signal.addEventListener('abort', disconnected, { once: true });
  if (request.signal.aborted) disconnected();
  let rejectAbort;
  const aborted = new Promise((_, reject) => { rejectAbort = () => reject(controller.signal.reason); });
  controller.signal.addEventListener('abort', rejectAbort, { once: true });
  try {
    if (controller.signal.aborted) throw controller.signal.reason;
    return await Promise.race([operation(controller.signal), aborted]);
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener('abort', disconnected);
    controller.signal.removeEventListener('abort', rejectAbort);
  }
}

async function readJson(request, timeoutMs) {
  return withDeadline(request, timeoutMs, new RequestError(408, '请求传输超时，请重试。', 'request_timeout'), async (signal) => {
    const bytes = await readBytes(request.body, MAX_BODY_BYTES, new RequestError(413, '图片或对话过大，请缩小图片后重试。'), signal);
    try { return JSON.parse(new TextDecoder().decode(bytes)); }
    catch { throw new RequestError(400, '请求必须是有效的 JSON。'); }
  });
}

async function chat(request, body, messages, config, fetchImpl, timeoutMs) {
  return withDeadline(request, timeoutMs, new RequestError(504, 'AI 服务响应超时，请稍后重试。', 'upstream_timeout'), async (signal) => {
    try {
      const payload = { model: config.model, messages, stream: false, max_tokens: 1000 };
      if (new URL(config.endpoint).hostname === 'api.deepseek.com') payload.thinking = { type: 'disabled' };
      if (body.response_format?.type === 'json_object') payload.response_format = { type: 'json_object' };
      const upstream = await fetchImpl(config.endpoint, {
        method: 'POST', redirect: 'manual', signal,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${config.key}` },
        body: JSON.stringify(payload),
      });
      if (!upstream.ok) {
        void upstream.body?.cancel().catch(() => {});
        throw new RequestError(upstream.status === 429 ? 429 : 502, upstream.status === 429 ? 'AI 服务额度不足或请求过于频繁，请稍后再试。' : 'AI 服务未接受请求，请检查云端接口、模型、密钥或账户额度。', 'upstream_error');
      }
      const bytes = await readBytes(upstream.body, MAX_BODY_BYTES, new RequestError(502, 'AI 回复过长，请缩短问题后重试。', 'upstream_error'), signal);
      let result;
      try { result = JSON.parse(new TextDecoder().decode(bytes)); }
      catch { throw new RequestError(502, 'AI 服务返回格式不正确，请确认支持 Chat Completions。', 'upstream_error'); }
      const content = result?.choices?.[0]?.message?.content;
      let reply = typeof content === 'string' ? content : Array.isArray(content) ? content.map((part) => typeof part?.text === 'string' ? part.text : '').join('') : '';
      if (!reply.trim() || reply.length > 100_000) throw new RequestError(502, 'AI 未返回有效回复，请确认接口支持 Chat Completions。', 'upstream_error');
      for (const secret of [config.key, config.ttsKey]) if (secret) reply = reply.split(secret).join('[已隐藏密钥]');
      return json(200, { choices: [{ message: { role: 'assistant', content: reply.trim() } }] });
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      if (error instanceof RequestError) throw error;
      throw new RequestError(502, '无法连接 AI 服务，请检查云端接口配置。', 'upstream_error');
    }
  });
}

async function tts(request, text, config, fetchImpl, timeoutMs) {
  return withDeadline(request, timeoutMs, new RequestError(504, 'TTS 服务响应超时，请稍后重试。', 'upstream_timeout'), async (signal) => {
    try {
      const upstream = await fetchImpl(TTS_ENDPOINT, {
        method: 'POST', redirect: 'manual', signal,
        headers: { 'X-Api-Key': config.ttsKey, 'X-Api-Resource-Id': 'seed-tts-2.0', 'Content-Type': 'application/json' },
        body: JSON.stringify({ req_params: { text, speaker: 'zh_female_vv_uranus_bigtts', audio_params: { format: 'mp3', sample_rate: 24000 } } }),
      });
      if (!upstream.ok) {
        void upstream.body?.cancel().catch(() => {});
        throw new RequestError(upstream.status === 429 ? 429 : 502, 'TTS 服务未能处理请求，请检查云端密钥和配额。', 'upstream_error');
      }
      const bytes = await readBytes(upstream.body, MAX_TTS_RESPONSE_BYTES, new RequestError(502, '音频数据过大。', 'upstream_error'), signal);
      const audioChunks = [];
      let audioBytes = 0;
      for (const line of new TextDecoder().decode(bytes).split('\n')) {
        if (!line.trim()) continue;
        let chunk;
        try { chunk = JSON.parse(line); }
        catch { throw new RequestError(502, 'TTS 服务返回格式不正确。', 'upstream_error'); }
        // Never log or echo provider messages: they can include credential data.
        if (chunk?.code === 20000000) continue;
        if (chunk?.code !== 0) throw new RequestError(502, 'TTS 服务未能生成音频，请检查云端密钥和配额。', 'upstream_error');
        if (!chunk.data) continue;
        if (typeof chunk.data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(chunk.data)) throw new RequestError(502, 'TTS 服务返回格式不正确。', 'upstream_error');
        const decoded = atob(chunk.data);
        audioBytes += decoded.length;
        if (audioBytes > MAX_AUDIO_BYTES) throw new RequestError(502, '音频数据过大。', 'upstream_error');
        audioChunks.push(Uint8Array.from(decoded, (character) => character.charCodeAt(0)));
      }
      if (!audioBytes) throw new RequestError(502, 'TTS 服务未返回音频数据。', 'upstream_error');
      const audio = new Uint8Array(audioBytes);
      let offset = 0;
      for (const chunk of audioChunks) { audio.set(chunk, offset); offset += chunk.length; }
      return new Response(audio, { headers: { ...SECURITY_HEADERS, 'Content-Type': 'audio/mpeg', 'Content-Length': String(audioBytes) } });
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      if (error instanceof RequestError) throw error;
      throw new RequestError(502, '无法连接 TTS 服务，请检查云端密钥配置。', 'upstream_error');
    }
  });
}

export function createApi({ fetchImpl = fetch, timeoutMs = 28_000, ttsTimeoutMs = 30_000, bodyTimeoutMs = 15_000, maxRequestsPerMinute = 30, maxConcurrent = 2, now = Date.now } = {}) {
  // These counters are shared only by requests handled in the same Worker isolate.
  // Production-wide quotas need Cloudflare rate limiting, Access or a Durable Object.
  let active = 0;
  let requestTimes = [];
  return async ({ request, env = {} }) => {
    try {
      const url = new URL(request.url);
      if (!['/api/health', '/api/chat/completions', '/api/tts'].includes(url.pathname)) throw new RequestError(404, '接口不存在。');
      if (url.pathname === '/api/health') {
        if (request.method !== 'GET') throw new RequestError(405, '此接口仅支持 GET。');
        const config = makeConfig(env);
        return json(200, { configured: config.configured, model: config.configured ? config.model : '', endpoint: '/api/chat/completions' });
      }
      if (request.method !== 'POST') throw new RequestError(405, '此接口仅支持 POST。');
      if (request.headers.get('origin') !== url.origin || request.headers.get('sec-fetch-site') === 'cross-site') throw new RequestError(403, '请从同一网址的芽团页面发起请求。', 'forbidden_origin');
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) throw new RequestError(415, '请求需使用 application/json。');
      if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) throw new RequestError(413, '图片或对话过大，请缩小图片后重试。');
      const config = makeConfig(env);
      const isTts = url.pathname === '/api/tts';
      if (isTts ? !config.ttsKey : !config.configured) throw new RequestError(503, isTts ? '尚未配置 TTS：请在 Cloudflare 中填写 YATUAN_TTS_KEY。' : '尚未配置 AI：请在 Cloudflare 中填写接口、模型和密钥。', 'not_configured');
      const body = await readJson(request, bodyTimeoutMs);
      let messages, text;
      if (isTts) {
        if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.text !== 'string' || !body.text.trim()) throw new RequestError(400, '请提供要合成的文字。');
        text = body.text.trim().slice(0, 1600);
      } else messages = validateMessages(body);
      const timestamp = now();
      requestTimes = requestTimes.filter((time) => time > timestamp - 60_000);
      if (active >= maxConcurrent || requestTimes.length >= maxRequestsPerMinute) throw new RequestError(429, '请求较频繁，请稍等几秒再试。', 'rate_limit');
      requestTimes.push(timestamp);
      active += 1;
      try {
        return await (isTts ? tts(request, text, config, fetchImpl, ttsTimeoutMs) : chat(request, body, messages, config, fetchImpl, timeoutMs));
      } finally { active -= 1; }
    } catch (error) {
      const known = error instanceof RequestError;
      return json(known ? error.status : 500, { error: { code: known ? error.code : 'internal_error', message: known ? error.message : '云端服务暂时无法处理请求，请稍后重试。' } }, error?.status === 429 ? { 'Retry-After': '5' } : {});
    }
  };
}

export const onRequest = createApi();
