import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, execFileSync, ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import WebSocket, { WebSocketServer } from 'ws';

const root = resolve(__dirname, '..');
const delay = (ms: number) => new Promise(resolveDelay => setTimeout(resolveDelay, ms));
function recorder(socket: WebSocket) {
  const events: any[] = [], listeners = new Set<() => void>();
  socket.on('message', (raw, binary) => {
    events.push(binary ? { type: 'binary', data: Buffer.from(raw as Buffer) } : JSON.parse(raw.toString()));
    for (const listener of listeners) listener();
  });
  return {
    events,
    async wait(type: string) {
      const existing = events.find(event => event.type === type); if (existing) return existing;
      return new Promise<any>((resolveEvent, reject) => {
        const timer = setTimeout(() => { listeners.delete(check); reject(new Error(`timed out waiting for ${type}: ${events.map(e => e.type).join(',')}`)); }, 5000);
        const check = () => { const found = events.find(event => event.type === type); if (found) { clearTimeout(timer); listeners.delete(check); resolveEvent(found); } };
        listeners.add(check); check();
      });
    },
  };
}

test('realtime duplex bridge synchronizes chat and closes provider sessions', { timeout: 30000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'byside-realtime-'));
  const database = join(dir, 'test.db'), dbUrl = `file:${database}`;
  const sql = execFileSync(join(root, 'node_modules/.bin/prisma'), ['migrate', 'diff', '--from-empty', '--to-schema-datamodel', join(root, 'server/prisma/schema.prisma'), '--script']);
  const init = spawnSync('sqlite3', [database], { input: sql }); assert.equal(init.status, 0, String(init.stderr));
  const db = new PrismaClient({ datasourceUrl: dbUrl });
  await db.memory.create({ data: { text: '我喜欢喝茶' } });
  await db.message.create({ data: { role: 'user', text: '以前的提问' } });
  await db.message.create({ data: { role: 'assistant', text: '以前的回答' } });
  let sessionRequest: any, providerKey = '', audioFrames = 0, cancelCount = 0, closeCount = 0, toolResult: any;
  const provider = createServer();
  const mock = new WebSocketServer({ server: provider, path: '/duplex' });
  mock.on('connection', (ws, request) => {
    providerKey = String(request.headers['x-api-key']); let sent = false;
    ws.on('message', raw => {
      const event = JSON.parse(raw.toString());
      const send = (value: object) => ws.send(JSON.stringify(value));
      if (event.type === 'session.create') { sessionRequest = event; send({ type: 'session.created', session: { id: 'mock-session' } }); }
      else if (event.type === 'input_audio_buffer.append') {
        assert.equal(Buffer.from(event.audio, 'base64').length, 640); audioFrames++;
        if (!sent) {
          sent = true;
          send({ type: 'conversation.item.input_audio_transcription.started' });
          send({ type: 'conversation.item.input_audio_transcription.delta', text: '请记住' });
          send({ type: 'conversation.item.input_audio_transcription.completed', text: '请记住 我喜欢热茶' });
          send({ type: 'conversation.item.input_audio_transcription.completed', text: '请记住 我喜欢热茶' });
          send({ type: 'response.output_text.delta', delta: '好，' });
          send({ type: 'response.output_text.delta', delta: '我记住了。' });
          send({ type: 'response.output_text.done' });
          send({ type: 'response.output_text.done' });
          send({ type: 'response.output_audio.started' });
          send({ type: 'response.output_audio.delta', delta: Buffer.from([1, 0, 2, 0]).toString('base64') });
          send({ type: 'response.function_call_arguments.done', items: [{ call_id: 'call-1', name: 'get_board', arguments: '{}' }] });
          send({ type: 'conversation.item.input_audio_transcription.started' });
        }
      } else if (event.type === 'response.cancel') { cancelCount++; send({ type: 'response.canceled' }); }
      else if (event.type === 'conversation.item.create') toolResult = event;
      else if (event.type === 'session.close') { closeCount++; send({ type: 'session.closed' }); }
    });
  });
  await new Promise<void>(done => provider.listen(0, '127.0.0.1', done));
  const providerPort = (provider.address() as any).port;
  const probe = createServer(); await new Promise<void>(done => probe.listen(0, '127.0.0.1', done));
  const port = (probe.address() as any).port; await new Promise<void>(done => probe.close(() => done()));
  const base = `http://127.0.0.1:${port}/api/v1`;
  let child: ChildProcess | undefined, output = '';
  const start = async (withKey: boolean) => {
    child = spawn(process.execPath, ['server/dist/main.js'], { cwd: root, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', BYSIDE_DATABASE_URL: dbUrl, YATUAN_REALTIME_PROVIDER: 'doubao', YATUAN_AI_KEY: '', YATUAN_TTS_KEY: '', VOLC_SPEECH_API_KEY: '', VOLC_API_KEY: '', VOLC_REALTIME_API_KEY: withKey ? 'test-realtime-key' : '', VOLC_REALTIME_ENDPOINT: `ws://127.0.0.1:${providerPort}/duplex` }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout?.on('data', data => { output += data; }); child.stderr?.on('data', data => { output += data; });
    for (let i = 0; i < 100; i++) { if (child.exitCode !== null) throw new Error(output); try { if ((await fetch(`${base}/health`)).ok) return; } catch {} await delay(100); }
    throw new Error(`server startup timeout: ${output}`);
  };
  const stop = async () => { if (child && child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); } child = undefined; };
  let client: WebSocket | undefined;
  try {
    await start(true);
    const health: any = await (await fetch(`${base}/health`)).json(); assert.equal(health.speech.realtimeConfigured, true);
    client = new WebSocket(`ws://127.0.0.1:${port}/api/v1/speech/realtime`); const received = recorder(client);
    await once(client, 'open');
    client.send(JSON.stringify({ type: 'session.start', fullDuplex: true, tools: [{ type: 'function', name: 'get_board', description: '读取棋盘', parameters: { type: 'object', properties: {} } }] }));
    const ready = await received.wait('session.ready'); assert.equal(ready.sessionId, 'default');
    assert.equal(providerKey, 'test-realtime-key');
    assert.equal(sessionRequest.session.model, '1.2.6.1');
    assert.equal(sessionRequest.session.audio.input.format.rate, 16000);
    assert.equal(sessionRequest.session.audio.output.format.rate, 24000);
    assert.match(sessionRequest.session.instructions, /我喜欢喝茶/);
    assert.deepEqual(sessionRequest.extension.dialog.dialog_context.map((item: any) => item.text), ['以前的提问', '以前的回答']);
    const extra = new WebSocket(`ws://127.0.0.1:${port}/api/v1/speech/realtime`); const denied = recorder(extra);
    assert.equal((await denied.wait('error')).code, 'busy');
    client.send(Buffer.alloc(640));
    assert.equal((await received.wait('transcript.final')).text, '请记住 我喜欢热茶');
    assert.equal((await received.wait('assistant.text.done')).text, '好，我记住了。');
    assert.deepEqual((await received.wait('binary')).data, Buffer.from([1, 0, 2, 0]));
    const call = await received.wait('tool.call'); assert.equal(call.items[0].callId, 'call-1');
    client.send(JSON.stringify({ type: 'tool.result', callId: 'call-1', output: { board: '.........' } }));
    await received.wait('response.canceled');
    for (let i = 0; i < 50 && (!toolResult || !(await db.message.findFirst({ where: { text: '好，我记住了。' } }))); i++) await delay(20);
    assert.equal(audioFrames, 1); assert.equal(cancelCount, 1);
    assert.equal(toolResult.items[0].role, 'tool'); assert.equal(toolResult.items[0].call_id, 'call-1');
    assert.equal(await db.message.count({ where: { text: '请记住 我喜欢热茶' } }), 1);
    assert.equal(await db.message.count({ where: { text: '好，我记住了。' } }), 1);
    assert.equal(await db.memory.count({ where: { text: '我喜欢热茶' } }), 1);
    const snapshot: any = await (await fetch(`${base}/snapshot`)).json();
    assert.equal(snapshot.companion.speech, '好，我记住了。'); assert.equal(snapshot.companion.growth, 19);
    assert.ok(!JSON.stringify(received.events.filter(e => e.type !== 'binary')).includes('test-realtime-key'));
    for(let i=0;i<100;i++)client.send(Buffer.alloc(640));
    await delay(100);
    assert.equal(client.readyState,WebSocket.OPEN);
    assert.ok(audioFrames>1&&audioFrames<100);
    const afterBurst=audioFrames;
    client.send(Buffer.alloc(640));
    for(let i=0;i<50&&audioFrames===afterBurst;i++)await delay(10);
    assert.equal(audioFrames,afterBurst+1);
    client.send(JSON.stringify({ type: 'session.close' })); await received.wait('session.closed'); await once(client, 'close');
    assert.equal(closeCount, 1);
    client = new WebSocket(`ws://127.0.0.1:${port}/api/v1/speech/realtime`); const disconnected = recorder(client);
    await once(client, 'open'); client.send(JSON.stringify({ type: 'session.start' })); await disconnected.wait('session.ready'); client.terminate();
    for (let i = 0; i < 50 && closeCount < 2; i++) await delay(20);
    assert.equal(closeCount, 2, 'browser disconnect must request provider session.close');
    await stop(); await start(false);
    assert.equal((await (await fetch(`${base}/health`)).json() as any).speech.realtimeConfigured, false);
    client = new WebSocket(`ws://127.0.0.1:${port}/api/v1/speech/realtime`); const missing = recorder(client);
    await once(client, 'open'); client.send(JSON.stringify({ type: 'session.start' }));
    assert.equal((await missing.wait('error')).code, 'not-configured');
    const restored: any = await (await fetch(`${base}/snapshot`)).json();
    assert.equal(restored.messages.filter((message: any) => message.text === '好，我记住了。').length, 1);
  } finally {
    client?.terminate(); await stop(); await db.$disconnect(); mock.clients.forEach(socket => socket.terminate()); mock.close();
    await new Promise<void>(done => provider.close(() => done())); await rm(dir, { recursive: true, force: true });
  }
});
