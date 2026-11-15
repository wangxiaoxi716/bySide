import { test } from 'node:test';
import assert from 'node:assert/strict';

const base = process.env.TEST_URL;
test('companion, memory, chat and extensions persist through API', { skip: !base }, async () => {
  async function request(path: string, method = 'GET', body?: unknown, token?: string) {
    const response = await fetch(`${base}/api/v1${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json();
    assert.ok(response.ok, JSON.stringify(data));
    return data as any;
  }
  const original = await request('/snapshot');
  await request('/companion', 'PATCH', { character: 'human' });
  const memory = await request('/memories', 'POST', { text: '测试记忆' });
  await request(`/memories/${memory.id}`, 'PATCH', { text: '更新的测试记忆' });
  const chat = await request('/chat', 'POST', { text: '你好', requestId: crypto.randomUUID() });
  assert.ok(chat.message.text);
  const id = `test-${Date.now()}`;
  const ext = await request('/extensions', 'POST', { id, name: 'test', url: 'http://127.0.0.1:4185', permissions: ['growth'] });
  const first = await request(`/extensions/${id}/events`, 'POST', { eventId: 'one', kind: 'test' }, ext.token);
  const second = await request(`/extensions/${id}/events`, 'POST', { eventId: 'one', kind: 'test' }, ext.token);
  assert.equal(first.duplicate, false); assert.equal(second.duplicate, true);
  const denied = await fetch(`${base}/api/v1/extensions/${id}/snapshot`, { headers: { Authorization: `Bearer ${ext.token}` } });
  assert.equal(denied.status, 403);
  await request(`/memories/${memory.id}`, 'DELETE');
  await request('/companion', 'PATCH', { character: original.companion.character });
});
