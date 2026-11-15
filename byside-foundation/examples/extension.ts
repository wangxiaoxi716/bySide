// Independent local extension. Start the foundation, then: npx tsx examples/extension.ts
import { createServer } from 'node:http';
import { BySideClient, BySideExtensionClient, type ExtensionManifest } from '../sdk/client';

const baseUrl = process.env.BYSIDE_API_URL || 'http://127.0.0.1:4173/api/v1';
const port = Number(process.env.BYSIDE_EXAMPLE_PORT || 4185);
const id = `example-${Date.now()}`;
const manifest: ExtensionManifest = {
  protocolVersion: '1.0', id, name: '示例能力', url: `http://127.0.0.1:${port}`,
  permissions: ['read', 'growth', 'respond'], actions: ['hello'], events: ['companion.updated'],
};
const service = createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'POST' && req.url === '/actions/hello') res.end(JSON.stringify({ message: '你好，芽团！' }));
  else { res.statusCode = 404; res.end(JSON.stringify({ message: '动作不存在' })); }
});
async function main() {
  await new Promise<void>(resolve => service.listen(port, '127.0.0.1', resolve));
  const stop = new AbortController();
  try {
  const foundation = new BySideClient(baseUrl);
  const registration = await foundation.registerExtension(manifest);
  const extension = new BySideExtensionClient(id, registration.token, baseUrl);
  const listener = (async () => {
    try { for await (const event of extension.subscribe(0, stop.signal)) { console.log('收到事件', event.id, event.type); break; } }
    catch (error) { if (!stop.signal.aborted) throw error; }
  })();
  console.log('伙伴当前成长', (await extension.snapshot()).companion.growth);
  console.log('基座调用扩展动作', await foundation.invokeAction(id, 'hello', {}));
  console.log('第一次提交', await extension.growth('activity-1', 'example.completed'));
  console.log('重复提交', await extension.growth('activity-1', 'example.completed'));
  await extension.respond('今天也一起慢慢长大。');
  await Promise.race([listener, new Promise(resolve => setTimeout(resolve, 3000))]);
  } finally { stop.abort(); service.close(); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
