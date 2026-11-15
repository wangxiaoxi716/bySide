import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRealtimeVoiceSession } from '../original-ui/realtime-voice.js';

test('realtime client serializes game tools, ignores duplicate calls and cancels late results', async t => {
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const replace = (name: string, value: unknown) => {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  t.after(() => { for (const [name, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete (globalThis as any)[name]; } });
  let socket: any;
  const sent: any[] = [], invoked: string[] = [];
  let release!: () => void, releaseLate!: () => void;
  class Context {
    sampleRate = 16000; currentTime = 1; destination = {};
    audioWorklet = { addModule: async () => {} };
    resume() { return Promise.resolve(); } close() { return Promise.resolve(); }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createGain() { return { connect() {}, disconnect() {}, gain: { value: 0 } }; }
  }
  class WorkletNode { port = { onmessage: null, close() {} }; connect() {} disconnect() {} }
  class Socket {
    static OPEN = 1; static CLOSING = 2;
    readyState = 1; bufferedAmount = 0; onmessage: any; onopen: any;
    constructor() { socket = this; }
    send(value: string) { if (typeof value === 'string') sent.push(JSON.parse(value)); }
    close() { this.readyState = 3; }
  }
  replace('AudioContext', Context); replace('AudioWorkletNode', WorkletNode); replace('WebSocket', Socket);
  replace('location', { protocol: 'http:', host: '127.0.0.1:4173' });
  replace('navigator', { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [], getAudioTracks: () => [] }) } });
  replace('fetch', async () => ({ ok: true, json: async () => ({ speech: { realtimeConfigured: true } }) }));
  const tools = [{ type: 'function', name: 'open_tabletop_game', description: '打开游戏', parameters: { type: 'object' } }];
  const session = createRealtimeVoiceSession({ tools, onToolCall: async item => {
    invoked.push(item.callId);
    if (item.callId === 'one') await new Promise<void>(done => { release = done; });
    if (item.callId === 'three') await new Promise<void>(done => { releaseLate = done; });
    return { ok: true, name: item.name };
  } });
  assert.equal(await session.start(), true);
  socket.onopen(); assert.deepEqual(sent[0].tools, tools);
  socket.onmessage({ data: JSON.stringify({ type: 'session.ready' }) });
  socket.onmessage({ data: JSON.stringify({ type: 'tool.call', items: [
    { callId: 'one', name: 'open_tabletop_game', arguments: '{}' },
    { callId: 'one', name: 'open_tabletop_game', arguments: '{}' },
    { callId: 'two', name: 'operate_tabletop_game', arguments: '{}' },
  ] }) });
  await new Promise(done => setImmediate(done));
  assert.deepEqual(invoked, ['one']);
  release(); await new Promise(done => setImmediate(done));
  assert.deepEqual(invoked, ['one', 'two']);
  assert.deepEqual(sent.filter(event => event.type === 'tool.result').map(event => event.callId), ['one', 'two']);
  socket.onmessage({ data: JSON.stringify({ type: 'tool.call', items: [{ callId: 'three', name: 'operate_tabletop_game', arguments: '{}' }] }) });
  await new Promise(done => setImmediate(done));
  const stopped = session.stop();
  releaseLate(); await new Promise(done => setImmediate(done));
  assert.ok(!sent.some(event => event.type === 'tool.result' && event.callId === 'three'));
  socket.onmessage({ data: JSON.stringify({ type: 'session.closed' }) });
  await stopped;
});
