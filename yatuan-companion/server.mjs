import http from 'node:http';
import path from 'node:path';
import { readFile, realpath, stat } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const ENV_KEYS = new Set(['YATUAN_AI_ENDPOINT', 'YATUAN_AI_MODEL', 'YATUAN_AI_KEY']);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.webm': 'video/webm' };

class RequestError extends Error {
  constructor(status, message, code = 'invalid_request') { super(message); this.status = status; this.code = code; }
}

// Deliberately supports a small dotenv subset; values are never evaluated or expanded.
export function parseEnv(source) {
  const result = {};
  for (const line of String(source).replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match || !ENV_KEYS.has(match[1])) continue;
    let value = match[2].trim();
    if (value.startsWith('"') || value.startsWith("'")) {
      const quote = value[0];
      const end = value.lastIndexOf(quote);
      if (end === 0 || !/^(?:\s*#.*)?$/.test(value.slice(end + 1))) throw new Error('本地 .env 的引号格式不正确。');
      value = value.slice(1, end);
    } else value = value.replace(/\s+#.*$/, '').trim();
    if (/[\u0000-\u001f\u007f]/.test(value)) throw new Error('本地 .env 包含不支持的控制字符。');
    result[match[1]] = value;
  }
  return result;
}

export function makeConfig(values = {}, { allowLocalUpstream = false } = {}) {
  const endpoint = String(values.YATUAN_AI_ENDPOINT || '').trim();
  const model = String(values.YATUAN_AI_MODEL || '').trim();
  const key = String(values.YATUAN_AI_KEY || '').trim();
  const unconfigured = { configured: false, endpoint: '', model: '', key: '' };
  if (!endpoint || !model || !key) return unconfigured;
  if (endpoint.length > 2048 || model.length > 120 || key.length > 4096 || /[\s\\\u0000-\u001f\u007f]/.test(endpoint) || /[\u0000-\u001f\u007f]/.test(model + key)) throw new Error('AI 配置格式不正确，请检查本地 .env。');
  let url;
  try { url = new URL(endpoint); } catch { throw new Error('AI 接口地址格式不正确。'); }
  const localMock = allowLocalUpstream && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !localMock) || url.username || url.password || url.search || url.hash || endpoint.includes('?') || endpoint.includes('#')) throw new Error('AI 接口必须使用不含认证信息、查询参数或片段的 HTTPS 完整地址。');
  return { configured: true, endpoint: url.href, model, key };
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function fail(res, error) {
  if (!res.destroyed && !res.writableEnded) json(res, error.status || 500, { error: { code: error.code || 'internal_error', message: error.status ? error.message : '本地服务暂时无法处理请求，请稍后重试。' } });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let bytes = 0, tooLarge = false;
    const chunks = [];
    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (tooLarge) return;
      if (bytes > MAX_BODY_BYTES) { tooLarge = true; chunks.length = 0; reject(new RequestError(413, '图片或对话过大，请缩小图片后重试。')); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new RequestError(400, '请求必须是有效的 JSON。')); }
    });
    req.on('error', () => reject(new RequestError(400, '请求传输中断。')));
    req.on('aborted', () => reject(new RequestError(400, '请求传输中断。')));
  });
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

async function boundedResponse(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new RequestError(502, 'AI 服务没有返回可读取的数据。', 'upstream_error');
  const chunks = []; let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > MAX_BODY_BYTES) { await reader.cancel(); throw new RequestError(502, 'AI 回复过长，请缩短问题后重试。', 'upstream_error'); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new RequestError(502, 'AI 服务返回格式不正确，请确认支持 Chat Completions。', 'upstream_error'); }
}

export function createYatuanServer({ config = makeConfig(), distDir = path.join(ROOT, 'dist'), timeoutMs = 28_000, maxRequestsPerMinute = 30, maxConcurrent = 2, fetchImpl = fetch } = {}) {
  let active = 0;
  let requestTimes = [];
  const distRoot = path.resolve(distDir);
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self)');
    try {
      const port = server.address()?.port;
      const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
      if (!allowedHosts.has(req.headers.host)) throw new RequestError(403, '此服务仅接受本机访问。', 'forbidden_origin');
      if (req.url?.startsWith('//') || !req.url?.startsWith('/')) throw new RequestError(400, '请求地址不正确。');
      const base = `http://${req.headers.host}`;
      const url = new URL(req.url, base);
      if (url.pathname === '/api/health') {
        if (req.method !== 'GET') throw new RequestError(405, '此接口仅支持 GET。');
        return json(res, 200, { configured: Boolean(config.configured), model: config.configured ? config.model : '', endpoint: '/api/chat/completions' });
      }
      if (url.pathname === '/api/chat/completions') {
        if (req.method !== 'POST') throw new RequestError(405, '此接口仅支持 POST。');
        if (req.headers.origin !== base || req.headers['sec-fetch-site'] === 'cross-site') throw new RequestError(403, '请从本机芽团页面发起 AI 请求。', 'forbidden_origin');
        if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw new RequestError(415, '请求需使用 application/json。');
        if (Number(req.headers['content-length']) > MAX_BODY_BYTES) { req.resume(); throw new RequestError(413, '图片或对话过大，请缩小图片后重试。'); }
        if (!config.configured) { req.resume(); throw new RequestError(503, '尚未配置 AI：请在本机 .env 中填写接口、模型和密钥，然后重启服务。', 'not_configured'); }
        const body = await readJson(req);
        const messages = validateMessages(body);
        const now = Date.now();
        requestTimes = requestTimes.filter((time) => time > now - 60_000);
        if (active >= maxConcurrent || requestTimes.length >= maxRequestsPerMinute) { res.setHeader('Retry-After', '5'); throw new RequestError(429, '请求较频繁，请稍等几秒再试。', 'rate_limit'); }
        requestTimes.push(now); active += 1;
        const controller = new AbortController();
        let timedOut = false;
        const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
        const disconnect = () => { if (!res.writableEnded) controller.abort(); };
        res.once('close', disconnect);
        try {
          const payload = { model: config.model, messages, stream: false, max_tokens: 1000 };
          // This provider defaults to thinking mode; direct companion replies need bounded latency.
          if (new URL(config.endpoint).hostname === 'api.deepseek.com') payload.thinking = { type: 'disabled' };
          if (body.response_format?.type === 'json_object') payload.response_format = { type: 'json_object' };
          const upstream = await fetchImpl(config.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${config.key}` }, body: JSON.stringify(payload), signal: controller.signal, redirect: 'error' });
          if (!upstream.ok) {
            await upstream.body?.cancel();
            throw new RequestError(upstream.status === 429 ? 429 : 502, upstream.status === 429 ? 'AI 服务额度不足或请求过于频繁，请稍后再试。' : 'AI 服务未接受请求，请在本机检查接口、模型、密钥或账户额度。', 'upstream_error');
          }
          const result = await boundedResponse(upstream);
          const content = result?.choices?.[0]?.message?.content;
          let reply = typeof content === 'string' ? content : Array.isArray(content) ? content.map((part) => typeof part?.text === 'string' ? part.text : '').join('') : '';
          if (!reply.trim() || reply.length > 100_000) throw new RequestError(502, 'AI 未返回有效回复，请确认接口支持 Chat Completions。', 'upstream_error');
          // Only public assistant text is returned; upstream metadata and errors are discarded.
          if (config.key) reply = reply.split(config.key).join('[已隐藏密钥]');
          if (!res.destroyed) json(res, 200, { choices: [{ message: { role: 'assistant', content: reply.trim() } }] });
        } catch (error) {
          if (timedOut) throw new RequestError(504, 'AI 服务响应超时，请稍后重试。', 'upstream_timeout');
          if (res.destroyed) return;
          if (error instanceof RequestError) throw error;
          throw new RequestError(502, '无法连接 AI 服务，请检查网络和本机接口配置。', 'upstream_error');
        } finally { clearTimeout(timer); res.removeListener('close', disconnect); active -= 1; }
        return;
      }
      if (url.pathname.startsWith('/api/')) throw new RequestError(404, '接口不存在。');
      if (!['GET', 'HEAD'].includes(req.method)) throw new RequestError(405, '此地址仅支持 GET 或 HEAD。');
      let pathname;
      try { pathname = decodeURIComponent(url.pathname); } catch { throw new RequestError(400, '请求地址不正确。'); }
      if (pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').some((segment) => segment.startsWith('.'))) throw new RequestError(404, '文件不存在。');
      const canonicalRoot = await realpath(distRoot);
      const candidate = path.resolve(canonicalRoot, '.' + pathname + (pathname.endsWith('/') ? 'index.html' : ''));
      if (!candidate.startsWith(canonicalRoot + path.sep)) throw new RequestError(404, '文件不存在。');
      let resolved, metadata;
      try { resolved = await realpath(candidate); metadata = await stat(resolved); }
      catch { throw new RequestError(404, '文件不存在。'); }
      if (!resolved.startsWith(canonicalRoot + path.sep) || !metadata.isFile()) throw new RequestError(404, '文件不存在。');
      const content = req.method === 'HEAD' ? undefined : await readFile(resolved);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(resolved).toLowerCase()] || 'application/octet-stream', 'Content-Length': content?.length ?? metadata.size, 'Cache-Control': 'no-store' });
      res.end(content);
    } catch (error) { fail(res, error); }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  return server;
}

export async function startServer() {
  let fileValues = {};
  try { fileValues = parseEnv(await readFile(path.join(ROOT, '.env'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('无法读取 .env，请检查本地文件格式和权限。'); }
  const values = { ...fileValues };
  for (const name of ENV_KEYS) if (process.env[name] !== undefined) values[name] = process.env[name];
  const config = makeConfig(values);
  const server = createYatuanServer({ config });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(4173, '127.0.0.1', resolve); });
  console.log('芽团本地服务：http://127.0.0.1:4173');
  console.log(config.configured ? 'AI 已配置；密钥仅在本机服务中使用。' : 'AI 尚未配置；请复制 .env.example 为 .env 并填写后重启。');
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  startServer().catch((error) => {
    console.error(error.code === 'EADDRINUSE' ? '4173 端口正在使用，请先关闭之前的本地服务再启动。' : '无法启动芽团服务，请检查 Node.js 版本和本地 .env 配置。');
    process.exitCode = 1;
  });
}
