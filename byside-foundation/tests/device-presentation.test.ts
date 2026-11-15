import { test } from 'node:test';
import assert from 'node:assert/strict';

test('device captions overlay and clear without altering persisted or browser-local state', async t => {
  const names = ['window', 'EventSource', 'fetch'] as const;
  const saved = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  const pageHandlers = new Map<string, Function>();
  class Channel { addEventListener() {} removeEventListener() {} postMessage() {} close() {} }
  class FakeStream {
    static current: FakeStream;
    handlers = new Map<string, Function>();
    constructor(_url: string) { FakeStream.current = this; }
    addEventListener(type: string, handler: Function) { this.handlers.set(type, handler); }
    emit(type: string, value: unknown) { this.handlers.get(type)?.({ data: JSON.stringify(value) }); }
    close() {}
  }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: { getItem() { return null; } }, BroadcastChannel: Channel, addEventListener: (name: string, cb: Function) => pageHandlers.set(name, cb), dispatchEvent() {} } });
  Object.defineProperty(globalThis, 'EventSource', { configurable: true, value: FakeStream });
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async () => ({ ok: true, json: async () => ({ companion: { character: 'yatuan', mood: 'happy', motion: 'idle', speech: '持久消息', createdAt: new Date().toISOString(), projectionX: 32, projectionY: 32, projectionScale: 1, showStats: true }, messages: [], memories: [] }) }) });
  t.after(() => {
    pageHandlers.get('pagehide')?.({ persisted: false });
    names.forEach((name, i) => saved[i] ? Object.defineProperty(globalThis, name, saved[i]!) : Reflect.deleteProperty(globalThis, name));
  });
  const state = await import('../original-ui/state.js');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(state.getState().speech, '持久消息');
  FakeStream.current.emit('voice.presentation', { state: { motion: 'speaking', speech: '设备正在说话' } });
  assert.equal(state.getState().motion, 'speaking'); assert.equal(state.getState().speech, '设备正在说话');
  const local = state.beginPresentation({ motion: 'thinking', speech: '浏览器状态' });
  assert.equal(state.getState().speech, '浏览器状态');
  local.end(); assert.equal(state.getState().speech, '设备正在说话');
  FakeStream.current.emit('voice.presentation', { state: null });
  assert.equal(state.getState().speech, '持久消息'); assert.equal(state.getState().motion, 'idle');
  FakeStream.current.emit('voice.presentation', { state: { motion: 'speaking', speech: '测试' } });
  FakeStream.current.emit('error', {}); assert.equal(state.getState().speech, '持久消息');
});
