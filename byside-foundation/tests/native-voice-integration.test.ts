import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, execFileSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import WebSocket, { WebSocketServer } from 'ws';

const root = resolve(__dirname, '..');
const delay = (ms: number) => new Promise(resolveDelay => setTimeout(resolveDelay, ms));
async function until(check: () => boolean | Promise<boolean>, message: string) {
  for (let i = 0; i < 150; i++) { if (await check()) return; await delay(50); }
  throw new Error(`timed out: ${message}`);
}

test('platform-neutral device adapter works through the foundation without a browser', { timeout: 30000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'byside-device-'));
  const database = join(dir, 'test.db'), dbUrl = `file:${database}`;
  const sql = execFileSync(join(root, 'node_modules/.bin/prisma'), ['migrate', 'diff', '--from-empty', '--to-schema-datamodel', join(root, 'server/prisma/schema.prisma'), '--script']);
  const init = spawnSync('sqlite3', [database], { input: sql }); assert.equal(init.status, 0, String(init.stderr));
  const db = new PrismaClient({ datasourceUrl: dbUrl });
  const http = createServer(); const mock = new WebSocketServer({ server: http, path: '/duplex' });
  let audioFrames = 0, providerClosed = 0;
  mock.on('connection', socket => {
    let answered = false;
    const send = (event: object) => socket.send(JSON.stringify(event));
    socket.on('message', raw => {
      const event = JSON.parse(raw.toString());
      if (event.type === 'session.create') send({ type: 'session.created' });
      else if (event.type === 'input_audio_buffer.append') {
        const pcm = Buffer.from(event.audio, 'base64');
        assert.equal(pcm.length, 640); audioFrames++;
        if (!answered && pcm.some(byte => byte !== 0)) {
          answered = true;
          send({ type: 'conversation.item.input_audio_transcription.started' });
          send({ type: 'conversation.item.input_audio_transcription.delta', text: '请记住' });
          send({ type: 'conversation.item.input_audio_transcription.completed', text: '请记住 我喜欢热茶' });
          send({ type: 'response.output_text.done', text: '好，我记住了。' });
          send({ type: 'response.output_audio.started' });
          send({ type: 'response.output_audio.delta', delta: Buffer.from([1, 0, 2, 0]).toString('base64') });
          send({ type: 'response.output_audio.done' }); send({ type: 'response.done' });
        }
      } else if (event.type === 'session.close') { providerClosed++; send({ type: 'session.closed' }); }
    });
  });
  await new Promise<void>(done => http.listen(0, '127.0.0.1', done));
  const providerPort = (http.address() as any).port;
  const probe = createServer(); await new Promise<void>(done => probe.listen(0, '127.0.0.1', done));
  const port = (probe.address() as any).port; await new Promise<void>(done => probe.close(() => done()));
  const base = `http://127.0.0.1:${port}`;
  let server: ChildProcess | undefined, device: ChildProcess | undefined, extra: WebSocket | undefined, output = '';
  const abortEvents = new AbortController();
  try {
    server = spawn(process.execPath, ['server/dist/main.js'], { cwd: root, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', BYSIDE_DATABASE_URL: dbUrl, YATUAN_AI_KEY: '', YATUAN_TTS_KEY: '', VOLC_SPEECH_API_KEY: '', VOLC_API_KEY: '', VOLC_REALTIME_API_KEY: 'test-key', VOLC_REALTIME_ENDPOINT: `ws://127.0.0.1:${providerPort}/duplex` }, stdio: ['ignore', 'pipe', 'pipe'] });
    server.stderr?.on('data', chunk => { output += chunk; });
    await until(async () => { try { return (await fetch(`${base}/api/v1/health`)).ok; } catch { return false; } }, `foundation start ${output}`);
    const eventResponsePromise = fetch(`${base}/api/v1/events?after=0`, { signal: abortEvents.signal });
    device = spawn(process.execPath, ['server/dist/native-voice-cli.js', '--audio-adapter', join(root, 'tests/fixtures/native-audio-fake.cjs'), '--show-transcript'], { cwd: root, env: { ...process.env, BYSIDE_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
    device.stdout?.on('data', chunk => { output += chunk; }); device.stderr?.on('data', chunk => { output += chunk; });
    const eventResponse = await eventResponsePromise;
    assert.equal(eventResponse.status, 200);
    const reader = eventResponse.body!.getReader(); let streamText = '';
    const readEvents = (async () => { try { while (true) { const next = await reader.read(); if (next.done) break; streamText += Buffer.from(next.value).toString('utf8'); } } catch {} })();
    await until(() => output.includes('芽团：好，我记住了。'), 'voice response through device process');
    await until(async () => !!(await db.message.findFirst({ where: { text: '好，我记住了。' } })), 'database persistence');
    await until(() => streamText.includes('好，我记住了。'), 'SSE update for display');
    await until(() => streamText.includes('voice.presentation') && streamText.includes('"motion":"speaking"'), 'live playback presentation for display');
    assert.equal(await db.event.count({ where: { type: 'voice.presentation' } }), 0, 'transient captions must not enter persisted event history');
    abortEvents.abort(); await readEvents;
    const before = audioFrames; await delay(150);
    assert.equal(device.exitCode, null, 'closing the display event stream must not stop the device');
    assert.ok(audioFrames > before, 'device continues sending audio after display closes');
    const snapshot: any = await (await fetch(`${base}/api/v1/snapshot`)).json();
    assert.equal(snapshot.companion.speech, '好，我记住了。');
    assert.equal(await db.memory.count({ where: { text: '我喜欢热茶' } }), 1);
    assert.equal(await db.growthEvent.count({ where: { source: 'voice' } }), 1);
    const html = await (await fetch(`${base}/`)).text(); assert.ok(html.includes('芽团'));
    extra = new WebSocket(`ws://127.0.0.1:${port}/api/v1/speech/realtime`);
    const [raw] = await once(extra, 'message'); assert.equal(JSON.parse(raw.toString()).code, 'busy');
    const latestEvent = await db.event.findFirst({ orderBy: { id: 'desc' } });
    const previewAbort = new AbortController();
    const previewResponse = await fetch(`${base}/api/v1/events?after=${latestEvent?.id || 0}`, { signal: previewAbort.signal });
    const previewReader = previewResponse.body!.getReader(); let previewText = '';
    const readPreview = (async () => { try { while (true) { const next = await previewReader.read(); if (next.done) break; previewText += Buffer.from(next.value).toString('utf8'); } } catch {} })();
    await until(() => previewText.includes('voice.presentation'), 'new preview receives current device presentation');
    assert.match(previewText, new RegExp(`id: ${latestEvent?.id || 0}\\n`), 'transient state must preserve persisted replay cursor');
    const exit = once(device, 'exit'); device.kill('SIGINT');
    assert.equal((await exit)[0], 0); device = undefined;
    await until(() => providerClosed === 1, 'cloud session closes');
    await until(() => previewText.includes('"state":null'), 'preview clears after device stops');
    previewAbort.abort(); await readPreview;
  } finally {
    abortEvents.abort(); extra?.terminate();
    if (device?.exitCode === null) { device.kill('SIGKILL'); await once(device, 'exit'); }
    if (server?.exitCode === null) { server.kill('SIGTERM'); await once(server, 'exit'); }
    await db.$disconnect(); mock.clients.forEach(socket => socket.terminate()); mock.close();
    await new Promise<void>(done => http.close(() => done())); await rm(dir, { recursive: true, force: true });
  }
});
