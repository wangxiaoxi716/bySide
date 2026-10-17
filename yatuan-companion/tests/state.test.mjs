import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../dist/state.js', import.meta.url), 'utf8');
let moduleIndex = 0;
class CustomEventMock extends Event {
  constructor(type, options = {}) { super(type); this.detail = options.detail; }
}
function environment({ initialStorage, unavailable = false } = {}) {
  const values = new Map(initialStorage ?? []);
  const peers = [];
  let sends = 0;
  const localStorage = {
    getItem(key) { if (unavailable) throw new Error('blocked'); return values.get(key) ?? null; },
    setItem(key, value) { if (unavailable) throw new Error('quota'); values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
  class BroadcastChannelMock {
    constructor(name) { this.name = name; this.listeners = []; peers.push(this); }
    addEventListener(type, listener) { if (type === 'message') this.listeners.push(listener); }
    postMessage(data) {
      sends++;
      for (const peer of peers) if (peer !== this && peer.name === this.name) {
        for (const listener of peer.listeners) listener({ data: structuredClone(data) });
      }
    }
    close() { this.listeners = []; }
  }
  function createWindow() {
    const target = new EventTarget();
    target.localStorage = localStorage;
    target.BroadcastChannel = BroadcastChannelMock;
    target.CustomEvent = CustomEventMock;
    return target;
  }
  return { values, createWindow, get sends() { return sends; } };
}
async function load(browser) {
  globalThis.window = browser;
  const uniqueSource = `${source}\n// isolated test module ${++moduleIndex}`;
  return import(`data:text/javascript;base64,${Buffer.from(uniqueSource).toString('base64')}`);
}
const storageKey = 'yatuan-companion:state:v1';

test('preferences are explicit, can be recalled, and do not mutate through snapshots', async () => {
  const env = environment();
  const api = await load(env.createWindow());
  assert.equal(api.getState().energy, 86);
  assert.match(api.sendChat('我喜欢热乎乎的晚饭'), /记在这台设备/);
  api.sendChat('我不喜欢香菜');
  api.sendChat('请记住：我每天晚上七点吃晚饭');
  const recalled = api.sendChat('你记得我喜欢什么吗？');
  assert.match(recalled, /热乎乎的晚饭/);
  assert.match(recalled, /不喜欢香菜/);
  assert.equal(api.getState().memories.length, 3);
  const snapshot = api.getState();
  snapshot.memories.push({ text: 'external mutation' });
  assert.equal(api.getState().memories.length, 3);
  const id = api.getState().memories[0].id;
  api.deleteMemory(id);
  assert.equal(api.getState().memories.length, 2);
});

test('stored state restores and nested projection patches retain unrelated fields', async () => {
  const env = environment();
  const first = await load(env.createWindow());
  first.setCharacter('human');
  first.updateState({ projection: { x: 77, scale: 1.5 } });
  first.updateState({ projection: { showStats: false } });
  first.addMemory('喜欢安静的早晨');
  const second = await load(env.createWindow());
  assert.equal(second.getState().character, 'human');
  assert.deepEqual(second.getState().projection, { x: 77, y: 32, scale: 1.5, showStats: false });
  assert.equal(second.getState().memories[0].text, '喜欢安静的早晨');
});

test('broadcasts update subscribers once without echo, and reset reaches other tabs', async () => {
  const env = environment();
  const first = await load(env.createWindow());
  const second = await load(env.createWindow());
  let firstUpdates = 0;
  let secondUpdates = 0;
  first.subscribe(() => firstUpdates++);
  const stop = second.subscribe(() => secondUpdates++);
  first.sendChat('我喜欢苹果');
  assert.equal(env.sends, 1);
  assert.equal(firstUpdates, 1);
  assert.equal(secondUpdates, 1);
  assert.equal(second.getState().memories[0].text, '我喜欢苹果');
  second.resetData();
  assert.equal(env.sends, 2);
  assert.equal(first.getState().memories.length, 0);
  assert.equal(first.getState().chat.length, 1);
  assert.equal(first.getState().intimacy, 12);
  const persisted = JSON.parse(env.values.get(storageKey));
  assert.equal(persisted.state.memories.length, 0);
  stop();
  first.setMood('sleepy');
  assert.equal(secondUpdates, 2);
});

test('storage events ignore stale values and do not broadcast received updates', async () => {
  const env = environment();
  const browser = env.createWindow();
  const api = await load(browser);
  api.updateState({ energy: 90 });
  const previous = JSON.parse(env.values.get(storageKey));
  const newer = { ...previous, clock: previous.clock + 2, writer: 'external-tab', state: { ...previous.state, energy: 67 } };
  const dispatch = envelope => {
    const event = new Event('storage');
    event.key = storageKey;
    event.newValue = JSON.stringify(envelope);
    browser.dispatchEvent(event);
  };
  dispatch(newer);
  assert.equal(api.getState().energy, 67);
  assert.equal(env.sends, 1);
  dispatch(previous);
  assert.equal(api.getState().energy, 67);
  api.updateState({ energy: 68 });
  assert.equal(JSON.parse(env.values.get(storageKey)).clock, newer.clock + 1);
});

test('storage failure stays usable and emits a warning', async () => {
  const env = environment({ unavailable: true });
  const browser = env.createWindow();
  let warnings = 0;
  browser.addEventListener('storage-warning', () => warnings++);
  const api = await load(browser);
  api.sendChat('我喜欢草莓');
  await new Promise(resolve => queueMicrotask(resolve));
  assert.equal(api.getState().memories.length, 1);
  assert.ok(warnings >= 1);
});

test('meal records use confirmed groups and do not claim image recognition', async () => {
  const env = environment();
  const api = await load(env.createWindow());
  assert.equal(api.saveMeal({ description: '' }), null);
  const meal = api.saveMeal({ description: '米饭、青菜、豆腐', groups: ['主食', '蔬菜', '蛋白质'], source: '手动确认' });
  assert.match(meal.advice, /你确认的记录/);
  assert.equal(api.getState().mood, 'eating');
  assert.equal(api.getState().meals.length, 1);
  assert.match(api.sendChat('你看到盘子里有什么了吗'), /尚未连接图像识别/);
});

test('inputs, growth and projection values are bounded', async () => {
  const env = environment();
  const api = await load(env.createWindow());
  api.updateState({ energy: Infinity, intimacy: 500, growth: -1, growthStage: 90, flowerCount: 10,
    projection: { x: -200, scale: 50 }, customImage: 'javascript:alert(1)', character: 'custom' });
  const state = api.getState();
  assert.equal(state.energy, 86);
  assert.equal(state.intimacy, 100);
  assert.equal(state.growth, 0);
  assert.equal(state.growthStage, 3);
  assert.equal(state.flowerCount, 3);
  assert.equal(state.projection.x, 0);
  assert.equal(state.projection.scale, 2);
  assert.equal(state.character, 'yatuan');
  assert.equal(state.customImage, null);
  api.sendChat('a'.repeat(3000));
  assert.equal(api.getState().chat.at(-2).text.length, 2000);
});
