// Example independent extension. Run after starting bySide with node examples/extension.mjs.
import { createServer } from 'node:http';
const api = 'http://127.0.0.1:4173/api/v1';
const id = `example-${Date.now()}`;
const server = createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'POST' && req.url === '/actions/hello') res.end(JSON.stringify({ message: '你好，芽团！' }));
  else { res.statusCode = 404; res.end(JSON.stringify({ message: 'unknown action' })); }
});
await new Promise(resolve => server.listen(4185, '127.0.0.1', resolve));
async function request(path, body, token) {
  const response = await fetch(api + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(result));
  return result;
}
try {
  const extension = await request('/extensions', { id, name: '示例扩展', url: 'http://127.0.0.1:4185', permissions: ['growth', 'respond'] });
  console.log('动作结果', await request(`/extensions/${id}/actions/hello`, {}));
  await request(`/extensions/${id}/respond`, { text: '今天也一起慢慢长大。' }, extension.token);
  console.log('成长事件', await request(`/extensions/${id}/events`, { eventId: 'example-1', kind: 'example.completed' }, extension.token));
  console.log('重复事件', await request(`/extensions/${id}/events`, { eventId: 'example-1', kind: 'example.completed' }, extension.token));
} finally { server.close(); }
