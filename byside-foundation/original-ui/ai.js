// The foundation backend owns provider configuration and credentials.
let configured = false;
const config = { endpoint: '/api/v1/chat', model: '' };
export function getAIConfig() { return configured ? { ...config } : { endpoint: '', model: '' }; }
export function setAIAvailable(value) { configured = value === true; window.dispatchEvent(new Event('ai-config-changed')); }
export function saveAIConfig() { if (!configured) throw new Error('请在项目 .env 配置 AI 并重启服务'); return { ...config }; }
export function clearAIConfig() { configured = false; window.dispatchEvent(new Event('ai-config-changed')); }
export function isAIConfigured() { return configured; }
export async function requestAI({ messages, imageDataUrl, signal, jsonOutput = false } = {}) {
  const last = [...(messages || [])].reverse().find(item => item.role === 'user');
  const prompt = typeof last?.content === 'string' ? last.content : '';
  const path = imageDataUrl ? '/vision' : '/chat';
  const requestId = crypto.randomUUID();
  const body = imageDataUrl ? { image: imageDataUrl, prompt, requestId } : { text: prompt || '你好', requestId };
  const cancel = () => fetch(`/api/v1${path}/${requestId}/cancel`, { method: 'POST' }).catch(() => {});
  if (signal?.aborted) throw new DOMException('请求已取消', 'AbortError');
  signal?.addEventListener('abort', cancel, { once: true });
  let data;
  try {
    const response = await fetch(`/api/v1${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
    data = await response.json();
    if (!response.ok) throw new Error(data.message || '陪伴服务请求失败');
  } finally { signal?.removeEventListener('abort', cancel); }
  const reply = imageDataUrl ? data.description : data.message.text;
  if (jsonOutput) return JSON.stringify({ reply, mood: 'curious', platePresent: false, foods: [], shouldSpeak: true, observation: imageDataUrl ? reply : '' });
  return reply;
}
