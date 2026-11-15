import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getState } from '../original-ui/state.js';
import { speakAsync, stopSpeaking } from '../original-ui/media.js';
import { createRealtimeVoiceSession } from '../original-ui/realtime-voice.js';

// Browser audio and microphone boundaries are controlled here. The session and
// presentation code run unchanged, including their real state transitions.
test('voice animation follows queued playback through provider completion and interruption', async t => {
  const saved = new Map<string, PropertyDescriptor | undefined>();
  function replace(name: string, value: any) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  t.after(() => { for (const [name, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete (globalThis as any)[name]; } });
  const sources: any[] = [];
  class Context {
    currentTime = 0;
    sampleRate: number;
    destination = {};
    constructor(options: any) { this.sampleRate = options.sampleRate; }
    resume() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createScriptProcessor() { return { connect() {}, disconnect() {}, onaudioprocess: null }; }
    createGain() { return { connect() {}, disconnect() {}, gain: { value: 0 } }; }
    createBuffer(_channels: number, count: number, rate: number) { return { duration: count / rate, getChannelData: () => new Float32Array(count) }; }
    createBufferSource() {
      const source = { buffer: null, connect() {}, start() {}, stop() {}, onended: null as any };
      sources.push(source); return source;
    }
  }
  let socket: any;
  class Socket {
    static OPEN = 1; static CLOSING = 2;
    readyState = 1; bufferedAmount = 0;
    onmessage: any; onclose: any;
    constructor() { socket = this; }
    send() {}
    close() { this.readyState = 3; }
  }
  const held = new Set(['yatuan-live-devices']); // The AR window owns the camera.
  replace('navigator', { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [], getAudioTracks: () => [] }) }, locks: {
    request: async (name: string, _options: any, callback: any) => {
      if (held.has(name)) return callback(null);
      held.add(name);
      try { return await callback({ name }); } finally { held.delete(name); }
    },
  } });
  replace('AudioContext', Context);
  replace('WebSocket', Socket);
  replace('location', { protocol: 'http:', host: '127.0.0.1:4173' });
  replace('fetch', async () => ({ ok: true, json: async () => ({ speech: { realtimeConfigured: true } }) }));
  const states: string[] = [];
  const session = createRealtimeVoiceSession({ onState: value => states.push(value) });
  t.after(() => session.stop());
  assert.equal(await session.start(), true, 'AR camera capture must coexist with the microphone');
  const message = (value: any) => socket.onmessage({ data: JSON.stringify(value) });
  message({ type: 'session.ready' });
  message({ type: 'transcript.partial', text: '你好' });
  assert.equal(getState().speech, '你：你好');
  message({ type: 'transcript.final', text: '你好' });
  assert.equal(getState().motion, 'thinking');
  message({ type: 'assistant.text.delta', text: '我在' });
  message({ type: 'assistant.text.delta', text: '这里。' });
  assert.equal(getState().speech, '我在这里。');
  message({ type: 'audio.started' });
  assert.notEqual(states.at(-1), 'speaking', 'provider readiness is earlier than local playback');
  socket.onmessage({ data: new ArrayBuffer(4800) });
  assert.equal(getState().motion, 'speaking');
  message({ type: 'audio.done' });
  message({ type: 'response.done' });
  assert.equal(getState().motion, 'speaking', 'queued audio must finish before the animation stops');
  sources[0].onended();
  assert.equal(getState().motion, 'listening');
  message({ type: 'audio.started' });
  socket.onmessage({ data: new ArrayBuffer(4800) });
  message({ type: 'audio.flush' });
  assert.equal(getState().motion, 'listening');
  message({ type: 'session.closed' });
  assert.equal(states.at(-1), 'idle');
  assert.notEqual(getState().motion, 'speaking');
});


test('TTS speech bubbles and animation clear when playback is canceled', async t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Audio');
  let current: any;
  class Audio {
    onended: any;
    onerror: any;
    constructor(_url: string) { current = this; }
    play() { return Promise.resolve(); }
    pause() {}
  }
  Object.defineProperty(globalThis, 'Audio', { configurable: true, value: Audio });
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ audio: 'AQID', mime: 'audio/mpeg' }) }));
  t.after(() => { stopSpeaking(); if (descriptor) Object.defineProperty(globalThis, 'Audio', descriptor); else delete (globalThis as any).Audio; });
  let started: () => void;
  const playing = new Promise<void>(resolve => { started = resolve; });
  const result = speakAsync('一起慢慢说。', { onStart: () => started() });
  await playing;
  assert.equal(getState().motion, 'speaking');
  assert.equal(getState().speech, '一起慢慢说。');
  stopSpeaking();
  assert.equal((await result).status, 'cancelled');
  assert.notEqual(getState().motion, 'speaking');
  // A late ended event from the canceled audio cannot revive presentation.
  current.onended();
  assert.notEqual(getState().motion, 'speaking');
});
