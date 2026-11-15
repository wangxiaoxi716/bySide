import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, execFileSync, ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { PrismaClient } from '@prisma/client';
import WebSocket, { WebSocketServer } from 'ws';
import { BySideClient, BySideExtensionClient } from '../sdk/client';

const root = resolve(__dirname, '..');
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function responseFrame(payload: object, last = false) {
  const data = gzipSync(Buffer.from(JSON.stringify(payload))), seq = Buffer.alloc(4), size = Buffer.alloc(4);
  seq.writeInt32BE(last ? -2 : 1); size.writeUInt32BE(data.length);
  return Buffer.concat([Buffer.from([0x11, last ? 0x93 : 0x91, 0x11, 0]), seq, size, data]);
}

test('isolated foundation, extension protocol and Doubao speech bridge', { timeout: 60000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'byside-integration-'));
  const database = join(dir, 'test.db');
  const sql = execFileSync(join(root, 'node_modules/.bin/prisma'), ['migrate', 'diff', '--from-empty', '--to-schema-datamodel', join(root, 'server/prisma/schema.prisma'), '--script'], { encoding: 'utf8' });
  const init = spawnSync('sqlite3', [database], { input: sql, encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  const dbUrl = `file:${database}`;
  const db = new PrismaClient({ datasourceUrl: dbUrl });
  let releaseChat: (() => void) | undefined, signalChat: (() => void) | undefined, chatCount = 0;
  let chatStarted = new Promise<void>(resolveStarted => { signalChat = resolveStarted; });
  let signalTtsStarted: (() => void) | undefined, signalTtsCancelled: (() => void) | undefined;
  const ttsStarted = new Promise<void>(resolveStarted => { signalTtsStarted = resolveStarted; });
  const ttsCancelled = new Promise<void>(resolveCancelled => { signalTtsCancelled = resolveCancelled; });
  let providerKey = '', providerResource = '', audioBytes = 0, startParams: any;
  const provider = createServer(async (req, res) => {
    const parts: Buffer[] = []; for await (const chunk of req) parts.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(parts).toString() || '{}');
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/chat') {
      chatCount++;
      if (body.messages.at(-1).content === '并发成长') { signalChat?.(); await new Promise<void>(done => { releaseChat = done; }); }
      res.end(JSON.stringify({ choices: [{ message: { content: '模拟模型回复' } }] }));
    } else if (req.url === '/tts') {
      providerKey = String(req.headers['x-api-key']); providerResource = String(req.headers['x-api-resource-id']);
      if (body.req_params.text === 'tts-cancel') { res.on('close', () => signalTtsCancelled?.()); signalTtsStarted?.(); return; }
      res.end(`${JSON.stringify({ code: 0, data: Buffer.from('fake-mp3').toString('base64') })}\n${JSON.stringify({ code: 20000000 })}\n`);
    } else if (req.url === '/actions/hello') res.end(JSON.stringify({ message: '扩展回应' }));
    else { res.statusCode = 404; res.end('{}'); }
  });
  const asr = new WebSocketServer({ server: provider, path: '/asr' });
  asr.on('connection', (ws, req) => {
    providerKey = String(req.headers['x-api-key']); providerResource = String(req.headers['x-api-resource-id']);
    ws.on('message', raw => {
      const data = Buffer.from(raw as Buffer), kind = data[1] >> 4, flags = data[1] & 0xf;
      const body = gunzipSync(data.subarray(8));
      if (kind === 1) startParams = JSON.parse(body.toString());
      else if (kind === 2 && !(flags & 2)) {
        audioBytes += body.length;
        ws.send(responseFrame({ result: { text: '你好', utterances: [{ text: '你好', definite: false }] } }));
        ws.send(responseFrame({ result: { text: '你好呀', utterances: [{ text: '你好呀', definite: true, start_time: 0, end_time: 800 }] } }));
        ws.send(responseFrame({ result: { text: '你好呀', utterances: [{ text: '你好呀', definite: true, start_time: 0, end_time: 800 }] } }));
      } else if (flags & 2) ws.send(responseFrame({}, true));
    });
  });
  await new Promise<void>(resolveListen => provider.listen(0, '127.0.0.1', resolveListen));
  const providerPort = (provider.address() as any).port;
  const temporaryPort = createServer();
  await new Promise<void>(resolveListen => temporaryPort.listen(0, '127.0.0.1', resolveListen));
  const port = (temporaryPort.address() as any).port;
  await new Promise<void>(resolveClose => temporaryPort.close(() => resolveClose()));
  const base = `http://127.0.0.1:${port}/api/v1`;
  let child: ChildProcess | undefined, serverLog = '';
  const start = async (withSpeech = true) => {
    child = spawn(process.execPath, ['server/dist/main.js'], { cwd: root, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', BYSIDE_DATABASE_URL: dbUrl, YATUAN_AI_ENDPOINT: `http://127.0.0.1:${providerPort}/chat`, YATUAN_AI_MODEL: 'fake', YATUAN_AI_KEY: 'fake', VOLC_SPEECH_API_KEY: withSpeech ? 'test-key' : '', YATUAN_TTS_KEY: '', VOLC_ASR_ENDPOINT: `ws://127.0.0.1:${providerPort}/asr`, VOLC_TTS_ENDPOINT: `http://127.0.0.1:${providerPort}/tts` }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout?.on('data', data => { serverLog += data; }); child.stderr?.on('data', data => { serverLog += data; });
    for (let i = 0; i < 100; i++) { if (child.exitCode !== null) throw new Error(`server exited: ${serverLog}`); try { if ((await fetch(`${base}/health`)).ok) return; } catch {} await delay(100); }
    throw new Error(`server not ready: ${serverLog}`);
  };
  const stop = async () => { if (child && child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); } child = undefined; };
  const request = async (path: string, method = 'GET', body?: unknown, token?: string) => {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const data: any = await response.json(); return { status: response.status, data };
  };
  try {
    await start();
    const owner = new BySideClient(base);
    assert.equal((await owner.capabilities()).extensionProtocolVersion, '1.0');
    const reg = await owner.registerExtension({ protocolVersion: '1.0', id: 'test-extension', name: '测试', url: `http://127.0.0.1:${providerPort}`, permissions: ['read', 'growth', 'respond'], actions: ['hello'], events: ['companion.updated'] });
    const extension = new BySideExtensionClient(reg.id, reg.token, base);
    assert.deepEqual(await owner.invokeAction(reg.id, 'hello', {}), { message: '扩展回应' });
    assert.equal((await request(`/extensions/${reg.id}/actions/undeclared`, 'POST', {})).status, 404);
    assert.equal((await request('/snapshot', 'GET', undefined, reg.token)).status, 403);
    assert.equal((await request(`/extensions/${reg.id}/snapshot`)).status, 403);
    const limited = await owner.registerExtension({ protocolVersion: '1.0', id: 'limited', name: '只成长', url: `http://127.0.0.1:${providerPort}`, permissions: ['growth'], actions: [], events: [] });
    assert.equal((await request('/extensions/limited/snapshot', 'GET', undefined, limited.token)).status, 403);
    assert.equal((await request('/extensions/limited/respond', 'POST', { text: '不允许' }, limited.token)).status, 403);
    const initial = (await owner.snapshot()).companion.growth;
    const chat = owner.chat('并发成长', 'request-one');
    await chatStarted;
    assert.equal((await extension.growth('activity-one', 'example.completed')).duplicate, false);
    assert.equal((await extension.growth('activity-one', 'example.completed')).duplicate, true);
    releaseChat?.();
    const first = await chat;
    assert.equal((await owner.snapshot()).companion.growth, initial + 2);
    assert.equal((await owner.chat('并发成长', 'request-one')).message.id, first.message.id);
    assert.equal(chatCount, 1);
    assert.equal((await request('/chat', 'POST', { text: '不同内容', requestId: 'request-one' })).status, 400);
    assert.equal((await request('/chat', 'POST', { text: '超长 ID', requestId: 'a'.repeat(101) })).status, 400);
    assert.equal((await fetch(`${base}/chat/unknown/cancel`, { method: 'POST' })).status, 201);
    const missing = await request('/memories/nonexistent', 'DELETE');
    assert.equal(missing.status, 404); assert.equal(missing.data.error, 'Not Found');
    const cursor = (await db.event.findFirst({ orderBy: { id: 'desc' } }))?.id || 0;
    await db.event.createMany({ data: Array.from({ length: 505 }, (_, i) => ({ type: 'test.replay', data: JSON.stringify({ i }) })) });
    const controller = new AbortController();
    const response = await fetch(`${base}/events?after=${cursor}`, { signal: controller.signal });
    const reader = response.body!.getReader(), decoder = new TextDecoder();
    let all = '', ids: number[] = [];
    while (!ids.length) { const chunk = await reader.read(); all += decoder.decode(chunk.value, { stream: true }); ids = [...all.matchAll(/^id:\s*(\d+)\s*$/gm)].map(match => Number(match[1])); }
    await request('/memories', 'POST', { text: '重放期间的新事件' });
    while (ids.length < 506) { const chunk = await reader.read(); all += decoder.decode(chunk.value, { stream: true }); ids = [...all.matchAll(/^id:\s*(\d+)\s*$/gm)].map(match => Number(match[1])); }
    assert.equal(new Set(ids).size, 506); assert.ok(ids.every((id, index) => index === 0 || id > ids[index - 1]));
    controller.abort(); await reader.cancel().catch(() => {});
    const last = (await db.event.findFirst({ orderBy: { id: 'desc' } }))!.id;
    const eventAbort = new AbortController();
    const iterator = extension.subscribe(last, eventAbort.signal);
    const next = iterator.next();
    await request('/memories', 'POST', { text: '不在订阅清单的事件' });
    await extension.respond('来自扩展的回应');
    const event = await next;
    assert.equal(event.value?.type, 'companion.updated');
    eventAbort.abort(); await iterator.return(undefined);
    const tts = await request('/speech', 'POST', { text: '你好' });
    assert.equal(Buffer.from(tts.data.audio, 'base64').toString(), 'fake-mp3');
    assert.equal(providerKey, 'test-key'); assert.equal(providerResource, 'seed-tts-2.0');
    const cancelTts = new AbortController();
    const slowTts = fetch(`${base}/speech`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'tts-cancel' }), signal: cancelTts.signal });
    await ttsStarted; cancelTts.abort(); await assert.rejects(slowTts);
    await Promise.race([ttsCancelled, delay(3000).then(() => { throw new Error('TTS upstream did not cancel'); })]);
    const speech = new WebSocket(`ws://127.0.0.1:${port}/api/v1/speech/asr/stream`);
    const messages: any[] = [];
    await new Promise<void>((resolveSpeech, reject) => {
      const timeout = setTimeout(() => reject(new Error('speech timeout')), 5000);
      speech.on('error', reject);
      speech.on('message', raw => {
        const message = JSON.parse(raw.toString()); messages.push(message);
        if (message.type === 'ready') speech.send(Buffer.alloc(6400));
        if (message.type === 'final') speech.send(JSON.stringify({ type: 'finish' }));
        if (message.type === 'ended') { clearTimeout(timeout); resolveSpeech(); }
      });
    });
    assert.ok(messages.some(m => m.type === 'partial' && m.text === '你好'));
    assert.ok(messages.some(m => m.type === 'final' && m.text === '你好呀'));
    assert.equal(messages.filter(m => m.type === 'final').length, 1);
    assert.equal(audioBytes, 6400); assert.equal(startParams.audio.rate, 16000);
    assert.equal(providerResource, 'volc.seedasr.sauc.duration');
    const invalidSpeech = new WebSocket(`ws://127.0.0.1:${port}/api/v1/speech/asr/stream`);
    const invalidCode = await new Promise<string>((resolveSpeech, reject) => {
      invalidSpeech.on('error', reject);
      invalidSpeech.on('message', raw => { const message = JSON.parse(raw.toString()); if (message.type === 'ready') invalidSpeech.send(Buffer.alloc(1)); if (message.type === 'error') resolveSpeech(message.code); });
    });
    assert.equal(invalidCode, 'invalid-audio');
    const sameTime = new Date('2020-01-01T00:00:00.000Z');
    await db.message.createMany({ data: Array.from({ length: 210 }, (_, index) => ({ id: `synthetic-${index}`, role: index % 2 ? 'assistant' : 'user', text: `message-${index}`, createdAt: sameTime })) });
    const latest = await owner.snapshot();
    assert.equal(latest.messages.length, 200);
    assert.equal(latest.messages[0].text, 'message-10');
    assert.equal(latest.messages.at(-1)?.text, 'message-209');
    const docs: any = await (await fetch(`http://127.0.0.1:${port}/api/docs-json`)).json();
    assert.ok(docs.paths['/api/v1/chat'].post.requestBody);
    assert.ok(docs.paths['/api/v1/extensions/{id}/stream'].get);
    await stop(); await start(false);
    assert.equal((await owner.chat('并发成长', 'request-one')).message.id, first.message.id);
    assert.equal((await owner.snapshot()).companion.growth, initial + 2);
    assert.equal((await request('/health')).data.speech.asrConfigured, false);
    const noKey = new WebSocket(`ws://127.0.0.1:${port}/api/v1/speech/asr/stream`);
    const noKeyCode = await new Promise<string>((resolveSpeech, reject) => { noKey.on('error', reject); noKey.on('message', raw => { const value = JSON.parse(raw.toString()); if (value.type === 'error') resolveSpeech(value.code); }); });
    assert.equal(noKeyCode, 'not-configured');
    const exampleProbe = createServer();
    await new Promise<void>(resolveListen => exampleProbe.listen(0, '127.0.0.1', resolveListen));
    const examplePort = (exampleProbe.address() as any).port;
    await new Promise<void>(resolveClose => exampleProbe.close(() => resolveClose()));
    const example = spawn(join(root, 'node_modules/.bin/tsx'), ['examples/extension.ts'], { cwd: root, env: { ...process.env, BYSIDE_API_URL: base, BYSIDE_EXAMPLE_PORT: String(examplePort) }, stdio: ['ignore', 'pipe', 'pipe'] });
    let exampleOutput = ''; example.stdout?.on('data', data => { exampleOutput += data; }); example.stderr?.on('data', data => { exampleOutput += data; });
    const [code] = await once(example, 'exit');
    assert.equal(code, 0, exampleOutput); assert.match(exampleOutput, /重复提交/); assert.match(exampleOutput, /收到事件/);
  } finally {
    releaseChat?.(); await stop(); await db.$disconnect();
    asr.clients.forEach(client => client.terminate()); asr.close();
    await new Promise<void>(resolveClose => provider.close(() => resolveClose()));
    await rm(dir, { recursive: true, force: true });
  }
});
