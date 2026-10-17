// Optional OpenAI-compatible proxy adapter. No service is contacted until requestAI().
// The proxy must enable CORS for this app when hosted on another origin.
// Production API keys belong on the proxy server; this module never accepts or stores them.
const CONFIG_KEY = 'yatuan:ai-config:v1';
const EMPTY_CONFIG = { endpoint: '', model: '' };

function validateConfig({ endpoint = '', model = '' } = {}) {
  if (typeof endpoint !== 'string' || typeof model !== 'string') {
    throw new Error('请填写有效的服务地址和模型名称。');
  }
  const address = endpoint.trim();
  const modelName = model.trim();
  if (!address) throw new Error('请填写你自己的 AI 代理服务地址。');
  if (address.length > 2048 || /[\s\\\u0000-\u001f\u007f]/.test(address)) {
    throw new Error('服务地址格式不正确，请移除空格并检查地址。');
  }
  if (modelName.length > 120 || /[\u0000-\u001f\u007f]/.test(modelName)) {
    throw new Error('模型名称过长或包含无效字符。');
  }
  let url;
  const relative = address.startsWith('/api/');
  try {
    url = relative
      ? new URL(address, globalThis.location?.origin || 'https://app.invalid')
      : new URL(address);
  } catch {
    throw new Error('请使用同源 /api/ 地址、http://localhost 地址，或 HTTPS 代理地址。');
  }
  if (url.username || url.password || /^https?:\/\/[^/]*@/i.test(address)) {
    throw new Error('服务地址不能包含用户名或密码。密钥请只保存在你的代理服务器上。');
  }
  if (url.search || url.hash || address.includes('?') || address.includes('#')) {
    throw new Error('服务地址不能包含查询参数或片段。请勿在地址中填写 API key。');
  }
  if (relative) {
    if (!url.pathname.startsWith('/api/')) {
      throw new Error('同源服务地址需要位于 /api/ 路径下。');
    }
    return { endpoint: url.pathname, model: modelName };
  }
  const localhost = url.protocol === 'http:' && url.hostname === 'localhost';
  if (url.protocol !== 'https:' && !localhost) {
    throw new Error('外部 AI 服务必须使用 HTTPS；本地调试可使用 http://localhost。');
  }
  return { endpoint: url.href, model: modelName };
}

export function getAIConfig() {
  try {
    const saved = globalThis.localStorage?.getItem(CONFIG_KEY);
    if (!saved) return { ...EMPTY_CONFIG };
    return validateConfig(JSON.parse(saved));
  } catch {
    return { ...EMPTY_CONFIG };
  }
}

export function saveAIConfig(config) {
  const checked = validateConfig(config);
  try {
    if (!globalThis.localStorage) throw new Error('Storage unavailable');
    // Only these two public fields are retained, even if callers pass extra fields.
    globalThis.localStorage.setItem(CONFIG_KEY, JSON.stringify(checked));
    return checked;
  } catch {
    throw new Error('浏览器暂时无法保存配置，请检查隐私或存储设置。');
  }
}

export function clearAIConfig() {
  try {
    globalThis.localStorage?.removeItem(CONFIG_KEY);
  } catch {
    throw new Error('暂时无法清除配置，请检查浏览器的存储设置。');
  }
}

export function isAIConfigured() {
  return Boolean(getAIConfig().endpoint);
}

function cancelledError() {
  const error = new Error('本次 AI 请求已取消。');
  error.name = 'AbortError';
  return error;
}

function prepareMessages(messages, imageDataUrl) {
  if (!Array.isArray(messages) || !messages.length) {
    throw new Error('请先输入想和角色说的话。');
  }
  const allowedRoles = new Set(['system', 'developer', 'user', 'assistant']);
  const prepared = messages.map((message) => {
    if (!message || !allowedRoles.has(message.role)) {
      throw new Error('对话内容格式不正确，请重新发送。');
    }
    if (typeof message.content !== 'string' && !Array.isArray(message.content)) {
      throw new Error('对话文字尚未准备好，请重新发送。');
    }
    return { role: message.role, content: Array.isArray(message.content) ? [...message.content] : message.content };
  });
  if (imageDataUrl !== undefined && imageDataUrl !== null) {
    if (typeof imageDataUrl !== 'string' || !/^data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(imageDataUrl)) {
      throw new Error('照片格式不正确，请重新拍摄或上传 PNG、JPG、WebP 或 GIF 图片。');
    }
    if (imageDataUrl.length > 12 * 1024 * 1024) {
      throw new Error('照片过大，请先压缩后再发送。');
    }
    let index = prepared.length - 1;
    while (index >= 0 && prepared[index].role !== 'user') index -= 1;
    if (index < 0) throw new Error('发送照片时，请同时添加一句说明。');
    const content = prepared[index].content;
    prepared[index].content = [
      ...(typeof content === 'string' ? [{ type: 'text', text: content }] : content),
      { type: 'image_url', image_url: { url: imageDataUrl } },
    ];
  }
  return prepared;
}

function responseText(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === 'string' && content.trim()) return content.trim();
  if (Array.isArray(content)) {
    const text = content.map((part) => {
      if (typeof part === 'string') return part;
      return typeof part?.text === 'string' ? part.text : '';
    }).join('').trim();
    if (text) return text;
  }
  if (typeof data?.reply === 'string' && data.reply.trim()) return data.reply.trim();
  throw new Error('AI 服务没有返回可读的回复，请确认代理支持 chat/completions 格式。');
}

export async function requestAI({ messages, imageDataUrl, signal, jsonOutput = false } = {}) {
  const config = getAIConfig();
  if (!config.endpoint) {
    throw new Error('尚未接入 AI 服务，当前为本地演示。请先配置你自己的兼容代理，才能进行真实 AI 对话或图片识别。');
  }
  if (signal?.aborted) throw cancelledError();
  const payload = {
    model: config.model || 'default',
    messages: prepareMessages(messages, imageDataUrl),
    ...(jsonOutput ? { response_format: { type: 'json_object' } } : {}),
    stream: false,
  };
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort();
  signal?.addEventListener('abort', abortFromCaller, { once: true });
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 30_000);
  const sameOrigin = config.endpoint.startsWith('/api/') || (
    globalThis.location?.origin && new URL(config.endpoint).origin === globalThis.location.origin
  );
  try {
    let response;
    try {
      response = await fetch(config.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: sameOrigin ? 'same-origin' : 'omit',
        redirect: 'error',
        signal: controller.signal,
        body: JSON.stringify(payload),
      });
    } catch {
      if (controller.signal.aborted) throw cancelledError();
      throw new Error('无法连接 AI 服务，请检查服务地址、网络与代理的 CORS 设置。');
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error('AI 代理未授权访问。请在代理服务器配置认证与密钥，不要把 API key 填入浏览器。');
    }
    if (response.status === 429) {
      throw new Error('AI 服务请求过于频繁或额度不足，请稍后再试，并检查代理服务额度。');
    }
    if (response.status >= 500) {
      throw new Error('AI 服务暂时出现故障，请稍后重试。');
    }
    if (!response.ok) {
      throw new Error(`AI 服务未接受请求（${response.status}），请检查完整接口地址、模型名称与图片支持能力。`);
    }
    let data;
    try { data = await response.json(); } catch {
      if (controller.signal.aborted) throw cancelledError();
      throw new Error('AI 服务返回了无法读取的数据，请确认接口返回 JSON。');
    }
    if (controller.signal.aborted) throw cancelledError();
    return responseText(data);
  } catch (error) {
    if (timedOut) {
      const timeoutError = new Error('AI 服务超过 30 秒没有响应，请检查代理状态后重试。');
      timeoutError.name = 'TimeoutError';
      throw timeoutError;
    }
    if (signal?.aborted) throw cancelledError();
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}
