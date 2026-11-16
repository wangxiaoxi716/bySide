import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import WebSocket, { WebSocketServer } from 'ws';
import { analyzeDesktop, desktopInstructions, desktopObservationFailure, DesktopVisionSession } from '../server/src/desktop-vision';
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

test('desktop failure messages distinguish missing camera frames from model errors', () => {
  assert.equal(desktopObservationFailure(new Error('暂时没有可用的桌面画面，请连接摄像头')).reason, 'camera');
  assert.equal(desktopObservationFailure(new Error('桌面观察已暂停，请先开启摄像头观察')).reason, 'paused');
  const model = desktopObservationFailure(new Error('模型服务请求失败（500）'));
  assert.equal(model.reason, 'analysis');
  assert.match(model.message, /视觉模型/);
  assert.doesNotMatch(model.message, /检查摄像头/);
});

test('package references require a clear specific match and retain their per-100g basis', async () => {
  async function inspect(description: string, name: string, certain = true, foodPresent = true) {
    return analyzeDesktop(async () => JSON.stringify({ description, foodPresent, foods: [{ name, group: '', certain }] }), image, '盘子里有什么？', new AbortController().signal);
  }
  const cake = await inspect('包装清楚写着优乐麦干烙蛋糕，恋奶味。', '干烙蛋糕');
  assert.equal(cake.foodReferences?.[0].basis, 'per-100g');
  assert.equal(cake.foodReferences?.[0].nutrients.sugarG, 33.9);
  assert.equal(cake.foodReferences?.[0].nutrients.energyKj, 2196);
  assert.deepEqual(cake.foodReferences?.[0].allergens, ['含麸质的谷物', '蛋', '乳']);

  const sausage = await inspect('包装上写着泡面拍档香肠。', '香肠');
  assert.equal(sausage.foodReferences?.[0].nutrients.sodiumMg, 950);
  assert.equal(sausage.foodReferences?.[0].allergens, undefined, 'a separate photo is not assumed to be the same product');
  assert.equal((await inspect('一块蛋糕，品牌与口味看不清。', '蛋糕')).foodReferences, undefined);
  assert.equal((await inspect('优乐麦干烙蛋糕，原味。', '干烙蛋糕')).foodReferences, undefined);
  assert.equal((await inspect('可能是优乐麦干烙蛋糕恋奶味。', '蛋糕', false)).foodReferences, undefined);
  assert.equal((await inspect('优乐麦干烙蛋糕恋奶味。', '蛋糕', true, false)).foodReferences, undefined);
});

test('explicit biscuit and sausage demo references are limited to observed foods', async () => {
  const previous = process.env.YATUAN_FOOD_DEMO;
  const inspect = (foods: object[]) => analyzeDesktop(async () => JSON.stringify({ description: '盘中食物已拆包装，品牌无法辨认。', foodPresent: foods.length > 0, foods }), image, '盘子里有什么？', new AbortController().signal);
  try {
    const foods = [{ name: '饼干', group: '主食', certain: true }, { name: '火腿肠', group: '蛋白质', certain: true }];
    delete process.env.YATUAN_FOOD_DEMO;
    assert.equal((await inspect(foods)).foodReferences, undefined, 'unwrapped food never matches labels by default');
    process.env.YATUAN_FOOD_DEMO = 'biscuit-sausage';
    const result = await inspect(foods);
    assert.deepEqual(result.foodReferences?.map(ref => ref.matchBasis), ['user-specified-test', 'user-specified-test']);
    assert.deepEqual(result.foodReferences?.map(ref => ref.visualCertainty), ['confirmed', 'confirmed']);
    assert.equal(result.foodReferences?.[0].nutrients.sugarG, 33.9);
    assert.equal(result.foodReferences?.[1].nutrients.sodiumMg, 950);
    assert.equal((await inspect([{ name: '苹果', group: '水果', certain: true }])).foodReferences, undefined);
    assert.equal((await inspect([{ name: '饼干', group: '', certain: false }])).foodReferences?.[0].visualCertainty, 'uncertain');
    const colors = await inspect([{ name: '浅黄色长条食物', colorTone: 'light', group: '', certain: false }, { name: '深色块状食物', colorTone: 'dark', group: '', certain: false }]);
    assert.deepEqual(colors.foods.map(food => food.name), ['饼干', '火腿肠'], 'color takes precedence over shape');
    assert.ok(colors.foods.every(food => food.classificationBasis === 'user-specified-test' && food.visualCertain === false));
    assert.deepEqual(colors.foodReferences?.map(ref => ref.visualCertainty), ['uncertain', 'uncertain']);
    const biscuitOnly = await inspect([{ name: '浅黄色长条食物', group: '', certain: false }]);
    assert.deepEqual(biscuitOnly.foods.map(food => food.name), ['饼干']);
    assert.deepEqual(biscuitOnly.foodReferences?.map(ref => ref.product), ['优乐麦干烙蛋糕（恋奶味）']);
    const sausageOnly = await inspect([{ name: '黑色包装的条状食物', group: '', certain: false }]);
    assert.deepEqual(sausageOnly.foods.map(food => food.name), ['火腿肠']);
    assert.deepEqual(sausageOnly.foodReferences?.map(ref => ref.product), ['泡面拍档香肠']);
    assert.deepEqual((await inspect([{ name: '浅色火腿肠', colorTone: 'light', group: '', certain: false }])).foods.map(food => food.name), ['饼干']);
    assert.deepEqual((await inspect([{ name: '深色饼干', colorTone: 'dark', group: '', certain: false }])).foods.map(food => food.name), ['火腿肠']);
    assert.equal((await inspect([{ name: '长条食物', colorTone: 'unknown', group: '', certain: false }])).foodReferences, undefined, 'shape alone cannot imply a food');
    assert.equal((await inspect([{ name: '棕色食物', group: '', certain: false }])).foodReferences, undefined);
    assert.equal((await inspect([])).foodReferences, undefined);
    const empty = await analyzeDesktop(async () => JSON.stringify({ description: '空盘', foodPresent: false, foods: [{ name: '浅色饼干', colorTone: 'light' }] }), image, '盘里有什么？', new AbortController().signal);
    assert.deepEqual(empty.foods, [], 'an empty plate never gains an assumed food');
    assert.equal(empty.foodReferences, undefined);
    assert.match(desktopInstructions(), /不要在对话中提分类规则/);
    assert.match(desktopInstructions(), /一两句自然简短/);
  } finally {
    if (previous === undefined) delete process.env.YATUAN_FOOD_DEMO; else process.env.YATUAN_FOOD_DEMO = previous;
  }
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

test('a failed background analysis can recover without exposing raw camera images', async () => {
  const events: any[] = [];
  let failing = true;
  const session = new DesktopVisionSession({
    analyze: async () => { if (failing) throw new Error('视觉模型暂时不可用'); return observation; },
    emit: event => events.push(event), onObservation() {},
  });
  session.accept(image, 'retry-image');
  await until(() => events.some(event => event.type === 'vision.error'), 'nonfatal visual error');
  failing = false;
  assert.equal((await session.observe('重试看看')).foodPresent, true);
  assert.ok(!JSON.stringify(events).includes('data:image'), 'only structured observations leave the session image buffer');
  session.close();
});

test('real voice bridge handles desktop tools and typed replies while audio continues', { timeout: 15000 }, async t => {
  const http = createServer(), provider = new WebSocketServer({ noServer: true });
  let upstream: WebSocket | undefined, frames = 0, analyses = 0, releaseVision!: () => void, aborted = false, failVision = false;
  const upstreamEvents: any[] = [], clientEvents: any[] = [], stored: any[] = [], persisted: any[] = [];
  const db: any = {
    state: async () => ({ personality: 'gentle' }), memory: { findMany: async () => [] }, snapshot: async () => ({ messages: stored }),
    voiceUser: async (id: string, text: string) => { stored.push({ id, role: 'user', text }); },
    voiceReply: async (id: string, text: string) => { stored.push({ id, role: 'assistant', text }); },
    emit: async (type: string, data: unknown) => { persisted.push({ type, data }); }, update: async () => {}, setRealtimePresentation() {},
  };
  const bridge = createRealtimeServer(db, { visionConfigured: () => true,
    visionChat: async (messages, signal) => {
      assert.ok(Array.isArray(messages[1]?.content), 'images are sent to the visual model');
      if (failVision) throw new Error('模型服务请求失败（500）');
      analyses++; signal.addEventListener('abort', () => { aborted = true; releaseVision?.(); });
      if (analyses === 1 || analyses === 3) await new Promise<void>(done => { releaseVision = done; });
      if (analyses === 2) return JSON.stringify({ description: '包装写着优乐麦干烙蛋糕恋奶味。', foodPresent: true, foods: [{ name: '干烙蛋糕', group: '', certain: true }] });
      return JSON.stringify(observation);
    },
    chat: async messages => {
      assert.match(String(messages[0].content), /优乐麦/);
      assert.match(String(messages[0].content), /per-100g/);
      return '看起来是蛋糕，具体营养信息请参考包装。';
    },
  });
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
  const toolResult = JSON.parse(result.items[0].content[0].text);
  assert.equal(result.items[0].role, 'tool'); assert.equal(toolResult.foods[0].name, '干烙蛋糕');
  assert.equal(toolResult.foodReferences[0].basis, 'per-100g'); assert.equal(toolResult.foodReferences[0].nutrients.sugarG, 33.9);
  providerSend({ type: 'response.function_call_arguments.done', items: [{ call_id: 'desktop-call', name: 'observe_desktop', arguments: '{}' }] });
  await delay(20); assert.equal(upstreamEvents.filter(event => event.items?.[0]?.call_id === 'desktop-call').length, 1);
  send({ type: 'input.text', text: '桌上有什么？' });
  await until(() => clientEvents.some(event => event.type === 'binary'), 'typed reply is spoken');
  await until(() => stored.some(message => message.role === 'assistant'), 'typed reply persisted');
  assert.equal(stored.filter(message => message.role === 'assistant').length, 1, 'synthesis completion cannot persist the typed reply twice');
  failVision = true;
  providerSend({ type: 'response.function_call_arguments.done', items: [{ call_id: 'failed-model', name: 'observe_desktop', arguments: '{"question":"再看看"}' }] });
  await until(() => upstreamEvents.some(event => event.items?.[0]?.call_id === 'failed-model'), 'model failure result');
  const failedModel = JSON.parse(upstreamEvents.find(event => event.items?.[0]?.call_id === 'failed-model').items[0].content[0].text);
  assert.equal(failedModel.reason, 'analysis');
  assert.ok(clientEvents.some(event => event.type === 'vision.error' && /视觉模型/.test(event.message)));
  failVision = false;
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
