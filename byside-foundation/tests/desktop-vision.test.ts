import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import WebSocket, { WebSocketServer } from 'ws';
import { analyzeDesktop, DesktopVisionSession } from '../server/src/desktop-vision';
import { createRealtimeServer } from '../server/src/realtime';

const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const observation = { description: '桌上有一杯茶和一个苹果。', foodPresent: true, foods: [{ name: '苹果', group: '水果', certain: true }], observedAt: new Date().toISOString() };
const delay = (ms: number) => new Promise(done => setTimeout(done, ms));
async function until(check: () => boolean, message: string) {
  for (let attempt = 0; attempt < 200; attempt++) { if (check()) return; await delay(10); }
  throw new Error(`timed out waiting for ${message}`);
}

test('desktop observations preserve real food results and validate image and model output', async () => {
  let messages: any[] = [];
  const result = await analyzeDesktop(async input => { messages = input; return `\x60\x60\x60json\n${JSON.stringify(observation)}\n\x60\x60\x60`; }, image, '桌上有什么？', new AbortController().signal);
  assert.equal(result.foodPresent, true);
  assert.deepEqual(result.foods, observation.foods);
  assert.equal(messages[1].content[1].image_url.url, image);
  await assert.rejects(analyzeDesktop(async () => '不是 JSON', image, '', new AbortController().signal), /有效/);
  await assert.rejects(analyzeDesktop(async () => JSON.stringify({ description: '苹果', foods: [] }), image, '', new AbortController().signal), /格式/);
  await assert.rejects(analyzeDesktop(async () => '', 'data:image/jpeg;base64,aGVsbG8=', '', new AbortController().signal), /格式/);
});

test('desktop capture refresh, periodic throttling, and pause cancellation', async () => {
  const events: any[] = [], results: any[] = [];
  let calls = 0;
  const session = new DesktopVisionSession({ analyze: async () => { calls++; return observation; }, emit: event => events.push(event), onObservation: result => results.push(result) });
  const requested = session.observe('盘子里有什么？');
  const capture = events.find(event => event.type === 'vision.capture');
  assert.ok(capture?.captureId);
  session.accept(image, 'fresh', capture.captureId);
  assert.equal((await requested).foodPresent, true);
  session.accept(image, 'periodic-1'); session.accept(image, 'periodic-2');
  await delay(10);
  assert.equal(calls, 1, 'periodic sampling is throttled while the tool observation is fresh');
  await session.observe('盘子里有什么？');
  assert.equal(calls, 2, 'a different frame receives a new observation');
  session.pause();
  await assert.rejects(session.observe('现在呢？'), /暂停/);
  const before = events.length; session.accept(image, 'paused'); assert.equal(events.length, before);
  session.resume();
  const waiting = session.observe('恢复后呢？'); session.close();
  await assert.rejects(waiting, /画面|结束/);
  assert.equal(results.length, 2);

  let aborted = false, release!: () => void;
  const slowResults: any[] = [];
  const slow = new DesktopVisionSession({
    analyze: async (_image, _question, signal) => { signal.addEventListener('abort', () => { aborted = true; }); await new Promise<void>(done => { release = done; }); return observation; },
    emit() {}, onObservation: result => slowResults.push(result),
  });
  slow.accept(image, 'slow'); slow.pause(); release(); await delay(10);
  assert.equal(aborted, true); assert.equal(slowResults.length, 0, 'late analyses cannot update a paused session'); slow.close();
});

test('real voice bridge handles desktop tools and typed replies while audio continues', { timeout: 15000 }, async t => {
  const http = createServer(), provider = new WebSocketServer({ noServer: true });
  let upstream: WebSocket | undefined, frames = 0, analyses = 0, releaseVision!: () => void, aborted = false;
  const upstreamEvents: any[] = [], clientEvents: any[] = [], stored: any[] = [], persisted: any[] = [];
  const db: any = {
    state: async () => ({ personality: 'gentle' }), memory: { findMany: async () => [] }, snapshot: async () => ({ messages: stored }),
    voiceUser: async (id: string, text: string) => { stored.push({ id, role: 'user', text }); },
    voiceReply: async (id: string, text: string) => { stored.push({ id, role: 'assistant', text }); },
    emit: async (type: string, data: unknown) => { persisted.push({ type, data }); }, update: async () => {}, setRealtimePresentation() {},
  };
  const bridge = createRealtimeServer(db, { visionConfigured: () => true, chat: async (messages, signal) => {
    if (Array.isArray(messages[1]?.content)) {
      analyses++; signal.addEventListener('abort', () => { aborted = true; releaseVision?.(); });
      if (analyses === 1 || analyses === 3) await new Promise<void>(done => { releaseVision = done; });
      return JSON.stringify(observation);
    }
    assert.match(String(messages[0].content), /苹果/);
    return '桌上有苹果和茶。';
  } });
  http.on('upgrade', (request, socket, head) => { const target = request.url === '/provider' ? provider : bridge; target.handleUpgrade(request, socket, head, ws => target.emit('connection', ws, request)); });
  const previousKey = process.env.VOLC_REALTIME_API_KEY, previousEndpoint = process.env.VOLC_REALTIME_ENDPOINT;
  await new Promise<void>(done => http.listen(0, '127.0.0.1', done));
  const address = `ws://127.0.0.1:${(http.address() as any).port}`;
  process.env.VOLC_REALTIME_API_KEY = 'test-only'; process.env.VOLC_REALTIME_ENDPOINT = `${address}/provider`;
  provider.on('connection', socket => {
    upstream = socket;
    socket.on('message', raw => {
      const event = JSON.parse(raw.toString()); upstreamEvents.push(event);
      if (event.type === 'session.create') socket.send(JSON.stringify({ type: 'session.created' }));
      if (event.type === 'input_audio_buffer.append') frames++;
      if (event.type === 'speech_text_buffer.commit') {
        socket.send(JSON.stringify({ type: 'response.output_text.done', text: event.text }));
        socket.send(JSON.stringify({ type: 'response.output_audio.started' }));
        socket.send(JSON.stringify({ type: 'response.output_audio.delta', delta: Buffer.from([1, 0]).toString('base64') }));
        socket.send(JSON.stringify({ type: 'response.output_audio.done' }));
        socket.send(JSON.stringify({ type: 'response.done' }));
      }
      if (event.type === 'session.close') socket.send(JSON.stringify({ type: 'session.closed' }));
    });
  });
  const client = new WebSocket(`${address}/realtime`);
  client.on('message', (raw, binary) => clientEvents.push(binary ? { type: 'binary' } : JSON.parse(raw.toString())));
  t.after(async () => {
    releaseVision?.(); client.terminate(); upstream?.terminate(); bridge.clients.forEach(socket => socket.terminate()); provider.clients.forEach(socket => socket.terminate());
    bridge.close(); provider.close(); await new Promise<void>(done => http.close(() => done()));
    if (previousKey === undefined) delete process.env.VOLC_REALTIME_API_KEY; else process.env.VOLC_REALTIME_API_KEY = previousKey;
    if (previousEndpoint === undefined) delete process.env.VOLC_REALTIME_ENDPOINT; else process.env.VOLC_REALTIME_ENDPOINT = previousEndpoint;
  });
  const send = (event: object) => client.send(JSON.stringify(event));
  const providerSend = (event: object) => upstream!.send(JSON.stringify(event));
  await once(client, 'open'); send({ type: 'session.start', desktopVision: true });
  await until(() => clientEvents.some(event => event.type === 'session.ready'), 'ready');
  assert.equal(upstreamEvents[0].session.tools[0].name, 'observe_desktop');
  send({ type: 'vision.frame', frameId: 'bad', image: 'invalid' });
  await until(() => clientEvents.some(event => event.type === 'vision.error'), 'invalid image error');
  send({ type: 'vision.frame', frameId: 'background', image });
  await until(() => analyses === 1, 'vision analysis starts');
  client.send(Buffer.alloc(640)); await until(() => frames === 1, 'audio continues during vision analysis');
  releaseVision(); await until(() => clientEvents.some(event => event.type === 'vision.observation'), 'background observation');
  assert.ok(upstreamEvents.some(event => event.type === 'session.update' && event.session.instructions.includes('苹果')));
  send({ type: 'vision.pause' }); send({ type: 'vision.resume' });
  providerSend({ type: 'response.function_call_arguments.done', items: [{ call_id: 'desktop-call', name: 'observe_desktop', arguments: '{"question":"桌上有什么？"}' }] });
  await until(() => clientEvents.some(event => event.type === 'vision.capture'), 'fresh frame request');
  const captureId = clientEvents.find(event => event.type === 'vision.capture').captureId;
  send({ type: 'vision.frame', frameId: 'tool-fresh', captureId, image });
  await until(() => upstreamEvents.some(event => event.items?.[0]?.call_id === 'desktop-call'), 'tool result');
  const result = upstreamEvents.find(event => event.items?.[0]?.call_id === 'desktop-call');
  assert.equal(result.items[0].role, 'tool'); assert.equal(JSON.parse(result.items[0].content[0].text).foods[0].name, '苹果');
  providerSend({ type: 'response.function_call_arguments.done', items: [{ call_id: 'desktop-call', name: 'observe_desktop', arguments: '{}' }] });
  await delay(20); assert.equal(upstreamEvents.filter(event => event.items?.[0]?.call_id === 'desktop-call').length, 1);
  send({ type: 'input.text', text: '桌上有什么？' });
  await until(() => clientEvents.some(event => event.type === 'binary'), 'typed reply is spoken');
  await until(() => stored.some(message => message.role === 'assistant'), 'typed reply persisted');
  assert.equal(stored.filter(message => message.role === 'assistant').length, 1, 'synthesis completion cannot persist the typed reply twice');
  send({ type: 'vision.pause' });
  providerSend({ type: 'response.function_call_arguments.done', items: [{ call_id: 'paused-call', name: 'observe_desktop', arguments: '{}' }] });
  await until(() => upstreamEvents.some(event => event.items?.[0]?.call_id === 'paused-call'), 'unavailable tool result');
  assert.equal(JSON.parse(upstreamEvents.find(event => event.items?.[0]?.call_id === 'paused-call').items[0].content[0].text).available, false);
  send({ type: 'vision.resume' });
  providerSend({ type: 'response.function_call_arguments.done', items: [{ call_id: 'closing-call', name: 'observe_desktop', arguments: '{}' }] });
  await until(() => clientEvents.filter(event => event.type === 'vision.capture').length === 2, 'closing frame request');
  const closingCapture = clientEvents.filter(event => event.type === 'vision.capture')[1];
  send({ type: 'vision.frame', frameId: 'closing', captureId: closingCapture.captureId, image });
  await until(() => analyses === 3, 'slow analysis for cancellation');
  const count = persisted.length; send({ type: 'session.close' });
  await until(() => clientEvents.some(event => event.type === 'session.closed'), 'close acknowledgement');
  assert.equal(aborted, true); assert.equal(persisted.length, count, 'closing aborts vision before publishing a late observation');
});
