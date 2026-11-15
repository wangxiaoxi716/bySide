import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRealtimeVoiceSession } from '../original-ui/realtime-voice.js';

// Stalling page timers reproduces a hidden tab. Audio-thread messages must
// still reach the real session's websocket sender without a timer callback.
test('audio frames continue when page timers stall in a hidden tab', async t => {
  const saved = new Map<string, PropertyDescriptor | undefined>();
  function replace(name: string, value: any) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  t.after(() => { for (const [name, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete (globalThis as any)[name]; } });
  const nodes: any[] = [], sent: ArrayBuffer[] = [];
  let socket: any, loaded = '', portClosed = false;
  class Context {
    sampleRate = 16000; currentTime = 1; destination = {};
    audioWorklet = { addModule: async (url: string) => { loaded = url; } };
    resume() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createScriptProcessor() { return { connect() {}, disconnect() {}, onaudioprocess: null }; }
    createGain() { return { connect() {}, disconnect() {}, gain: { value: 0 } }; }
  }
  class WorkletNode {
    port = { onmessage: null as any, close() { portClosed = true; } };
    constructor() { nodes.push(this); }
    connect() {}
    disconnect() {}
  }
  class Socket {
    static OPEN = 1; static CLOSING = 2;
    readyState = 1; bufferedAmount = 0;
    onmessage: any;
    constructor() { socket = this; }
    send(value: any) { if (value instanceof ArrayBuffer) sent.push(value); }
    close() { this.readyState = 3; }
  }
  replace('setInterval', () => 0); // The hidden page receives no timer ticks.
  replace('AudioContext', Context);
  replace('AudioWorkletNode', WorkletNode);
  replace('WebSocket', Socket);
  replace('location', { protocol: 'http:', host: '127.0.0.1:4173' });
  replace('navigator', { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [], getAudioTracks: () => [] }) } });
  replace('fetch', async () => ({ ok: true, json: async () => ({ speech: { realtimeConfigured: true } }) }));
  const session = createRealtimeVoiceSession();
  t.after(() => { socket?.onmessage?.({ data: JSON.stringify({ type: 'session.closed' }) }); return session.stop(); });
  assert.equal(await session.start(), true);
  assert.equal(nodes.length, 1, 'the browser must use the audio-thread capture node');
  assert.ok(loaded.endsWith('voice-capture-worklet.mjs'));
  const emit = nodes[0].port.onmessage;
  emit({ data: new Int16Array(320).fill(1000).buffer });
  assert.equal(sent.length, 0, 'capture before provider readiness is discarded');
  socket.onmessage({ data: JSON.stringify({ type: 'session.ready' }) });
  for (let i = 0; i < 50; i++) emit({ data: new Int16Array(320).fill(1000).buffer });
  assert.equal(sent.length, 50, 'one second of audio is sent even when page timers never fire');
  assert.equal(new DataView(sent[0]).getInt16(0, true), 1000);
  socket.onmessage({ data: JSON.stringify({ type: 'audio.started' }) });
  emit({ data: new Int16Array(320).fill(1000).buffer });
  assert.ok(new Uint8Array(sent.at(-1)!).every(value => value === 0), 'half duplex still suppresses speaker echo');
  socket.onmessage({ data: JSON.stringify({ type: 'session.closed' }) });
  assert.equal(portClosed, true);
  const stoppedCount = sent.length;
  emit({ data: new Int16Array(320).fill(1000).buffer });
  assert.equal(sent.length, stoppedCount, 'late worklet messages are ignored after stop');
});
