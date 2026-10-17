import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../dist/demo.js', import.meta.url), 'utf8');
let moduleIndex = 0;
const initial = {
  character: 'human', customImage: null, mood: 'sleepy', activity: '陪伴',
  speech: '真实对话仍然保留', energy: 55, intimacy: 45, growth: 36, growthStage: 1,
  flowerCount: 2, flowerStyle: 'pink', chat: [{ id: 'a', text: '用户真实对话' }],
  memories: [{ id: 'b', text: '喜欢苹果' }], meals: [{ id: 'c', description: '真实晚饭' }],
};
function dataUrl(text) { return `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`; }
async function harness(run) {
  const originalNow = Date.now;
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  let now = 1_000_000;
  let timerIndex = 0;
  const timers = new Map();
  Date.now = () => now;
  globalThis.setInterval = fn => { const id = ++timerIndex; timers.set(id, fn); return id; };
  globalThis.clearInterval = id => timers.delete(id);
  const unique = ++moduleIndex;
  const stubSource = `
    let state = ${JSON.stringify(initial)};
    export let writes = 0;
    export function getState() { return structuredClone(state); }
    export function updateState(partial) { writes++; state = {...state, ...structuredClone(partial)}; return getState(); }
    // unique ${unique}
  `;
  const stubUrl = dataUrl(stubSource);
  const store = await import(stubUrl);
  const api = await import(dataUrl(source.replace("'./state.js'", JSON.stringify(stubUrl)) + `\n// test ${unique}`));
  const advance = milliseconds => {
    now += milliseconds;
    for (const callback of [...timers.values()]) callback();
  };
  try { await run({ api, store, advance, timers }); }
  finally {
    api.disposeDemo();
    Date.now = originalNow;
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
}

test('36-second demonstration advances through six steps without saving user records', async () => {
  await harness(({ api, store, advance, timers }) => {
    assert.equal(api.DEMO_STEPS.length, 6);
    assert.ok(api.DEMO_STEPS.every(step => step.duration === 6000));
    api.startDemo();
    assert.equal(store.getState().growthStage, 0);
    for (let index = 1; index < 6; index++) {
      advance(6000);
      assert.equal(api.getDemoState().index, index);
      assert.match(store.getState().speech, /演示/);
    }
    assert.equal(store.getState().growthStage, 3);
    assert.equal(store.getState().flowerCount, 3);
    advance(6000);
    assert.deepEqual(api.getDemoState(), { running: false, paused: false, index: 5, progress: 1, done: true });
    assert.equal(timers.size, 0);
    assert.equal(store.getState().character, 'human');
    assert.deepEqual(store.getState().chat, initial.chat);
    assert.deepEqual(store.getState().meals, initial.meals);
    assert.deepEqual(store.getState().memories, initial.memories);
    assert.equal(store.writes, 6, 'only writes when changing steps, never per timer tick');
    assert.equal(store.getState().flowerCount, 3, 'completion holds final preview');
  });
});

test('pause and resume preserve elapsed time', async () => {
  await harness(({ api, advance, timers }) => {
    api.startDemo();
    advance(2500);
    api.pauseDemo();
    const paused = api.getDemoState();
    assert.equal(paused.running, true);
    assert.equal(paused.paused, true);
    assert.equal(timers.size, 0);
    advance(10000);
    assert.deepEqual(api.getDemoState(), paused);
    api.resumeDemo();
    advance(3499);
    assert.equal(api.getDemoState().index, 0);
    advance(1);
    assert.equal(api.getDemoState().index, 1);
    assert.equal(api.getDemoState().progress, 1 / 6);
  });
});

test('stop restores preview fields and preserves changes to genuine records and character', async () => {
  await harness(({ api, store, advance }) => {
    api.startDemo();
    advance(24000);
    store.updateState({ character: 'custom', customImage: 'data:test',
      chat: [...initial.chat, { id: 'new', text: '演示期间的新对话' }],
      memories: [...initial.memories, { id: 'new-memory', text: '新的偏好' }] });
    api.stopDemo();
    const restored = store.getState();
    for (const key of ['mood', 'activity', 'speech', 'energy', 'intimacy', 'growth', 'growthStage', 'flowerCount']) {
      assert.deepEqual(restored[key], initial[key]);
    }
    assert.equal(restored.character, 'custom');
    assert.equal(restored.customImage, 'data:test');
    assert.equal(restored.chat.length, 2);
    assert.equal(restored.memories.length, 2);
    assert.deepEqual(api.getDemoState(), { running: false, paused: false, index: 0, progress: 0, done: false });
  });
});

test('manual steps can start paused, clamp boundaries, and resume to completion', async () => {
  await harness(({ api, store, advance, timers }) => {
    api.goToStep(4);
    assert.equal(api.getDemoState().paused, true);
    assert.equal(store.getState().growthStage, 2);
    assert.equal(timers.size, 0);
    api.goToStep(999);
    assert.equal(api.getDemoState().index, 5);
    api.resumeDemo();
    advance(6000);
    assert.equal(api.getDemoState().done, true);
    api.goToStep(-1);
    assert.equal(api.getDemoState().index, 0);
    assert.equal(api.getDemoState().paused, true);
    api.stopDemo();
    assert.equal(store.getState().growth, initial.growth);
  });
});

test('restarting does not replace the original snapshot and subscribers unsubscribe', async () => {
  await harness(({ api, store, advance }) => {
    let updates = 0;
    const unsubscribe = api.subscribeDemo(state => {
      updates++;
      state.index = 100;
    });
    api.startDemo();
    advance(24000);
    api.startDemo();
    assert.equal(api.getDemoState().index, 0);
    api.stopDemo();
    assert.equal(store.getState().growth, initial.growth);
    const previousUpdates = updates;
    unsubscribe();
    api.startDemo();
    assert.equal(updates, previousUpdates);
    api.disposeDemo();
    assert.equal(store.getState().growth, initial.growth);
  });
});

async function multiTabHarness(run) {
  const previousWindow = globalThis.window;
  const previousNow = Date.now;
  const previousSetInterval = globalThis.setInterval;
  const previousClearInterval = globalThis.clearInterval;
  let now = 1_000_000;
  let timerId = 0;
  const timers = new Map(), peers = [], queue = [], apis = [];
  Date.now = () => now;
  globalThis.setInterval = fn => { const id = ++timerId; timers.set(id, fn); return id; };
  globalThis.clearInterval = id => timers.delete(id);
  class BroadcastMock {
    constructor(name) { this.name = name; this.handlers = []; this.closed = false; peers.push(this); }
    addEventListener(type, callback) { if (type === 'message') this.handlers.push(callback); }
    postMessage(data) {
      for (const peer of peers) if (peer !== this && !peer.closed && peer.name === this.name) {
        const copied = structuredClone(data);
        queue.push(() => { if (!peer.closed) for (const callback of peer.handlers) callback({ data: copied }); });
      }
    }
    close() { this.closed = true; }
  }
  const stubUrl = dataUrl(`
    let state = ${JSON.stringify(initial)};
    export let writes = 0;
    export function getState() { return structuredClone(state); }
    export function updateState(partial) { writes++; state = {...state, ...structuredClone(partial)}; return getState(); }
    // multi-tab ${++moduleIndex}
  `);
  const store = await import(stubUrl);
  const flush = () => {
    let delivered = 0;
    while (queue.length) {
      if (++delivered > 200) throw new Error('Broadcast echo loop');
      queue.shift()();
    }
  };
  const load = async () => {
    globalThis.window = { BroadcastChannel: BroadcastMock };
    const api = await import(dataUrl(source.replace("'./state.js'", JSON.stringify(stubUrl)) + `\n// mirror ${++moduleIndex}`));
    apis.push(api);
    return api;
  };
  const advance = milliseconds => {
    now += milliseconds;
    for (const callback of [...timers.values()]) callback();
    flush();
  };
  try { await run({ load, store, flush, advance, timers }); }
  finally {
    for (const api of apis) api.disposeDemo();
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    Date.now = previousNow;
    globalThis.setInterval = previousSetInterval;
    globalThis.clearInterval = previousClearInterval;
  }
}

test('new control pages handshake with the owner and forward pause, resume, step and stop', async () => {
  await multiTabHarness(async ({ load, store, flush, advance, timers }) => {
    const owner = await load();
    owner.startDemo();
    advance(12000);
    const mirror = await load();
    flush();
    assert.deepEqual(mirror.getDemoState(), owner.getDemoState());
    assert.equal(mirror.getDemoState().index, 2);
    assert.equal(owner.isDemoOwner(), true);
    assert.equal(mirror.isDemoOwner(), false);
    assert.equal(timers.size, 1);
    mirror.pauseDemo();
    flush();
    assert.equal(owner.getDemoState().paused, true);
    assert.equal(mirror.getDemoState().paused, true);
    assert.equal(timers.size, 0);
    mirror.resumeDemo();
    flush();
    assert.equal(timers.size, 1);
    mirror.goToStep(4);
    flush();
    assert.equal(owner.getDemoState().index, 4);
    assert.equal(mirror.getDemoState().index, 4);
    assert.equal(store.getState().growthStage, 2);
    mirror.stopDemo();
    assert.equal(store.getState().growth, initial.growth, 'mirror stop restores synchronously');
    flush();
    assert.equal(owner.getDemoState().running, false);
    assert.deepEqual(mirror.getDemoState(), owner.getDemoState());
    assert.equal(timers.size, 0);
  });
});

test('closing mirrors preserves owner playback and finished demos can restart remotely', async () => {
  await multiTabHarness(async ({ load, flush, advance, timers }) => {
    const owner = await load();
    owner.startDemo();
    const firstMirror = await load();
    flush();
    firstMirror.disposeDemo();
    flush();
    assert.equal(owner.getDemoState().running, true);
    assert.equal(timers.size, 1);
    advance(36000);
    assert.equal(owner.getDemoState().done, true);
    const nextMirror = await load();
    flush();
    assert.equal(nextMirror.getDemoState().done, true);
    assert.equal(nextMirror.getDemoState().progress, 1);
    nextMirror.startDemo();
    flush();
    assert.equal(owner.getDemoState().running, true);
    assert.equal(owner.getDemoState().index, 0);
    assert.equal(nextMirror.getDemoState().index, 0);
    assert.equal(timers.size, 1);
    owner.disposeDemo();
    flush();
    assert.equal(nextMirror.getDemoState().running, false);
    assert.equal(timers.size, 0);
  });
});

test('a remote reset following stop is not overwritten by delayed owner acknowledgement', async () => {
  await multiTabHarness(async ({ load, store, flush, advance }) => {
    const owner = await load();
    owner.startDemo();
    advance(24000);
    const mirror = await load();
    flush();
    mirror.stopDemo();
    store.updateState({ growth: 0, intimacy: 0, speech: '已清除' });
    flush();
    assert.equal(store.getState().growth, 0);
    assert.equal(store.getState().speech, '已清除');
    assert.equal(owner.getDemoState().running, false);
  });
});

test('simultaneous start commands settle on one timer without broadcast loops', async () => {
  await multiTabHarness(async ({ load, flush, advance, timers }) => {
    const first = await load();
    const second = await load();
    flush();
    first.startDemo();
    second.startDemo();
    flush();
    assert.equal(Number(first.isDemoOwner()) + Number(second.isDemoOwner()), 1);
    assert.equal(timers.size, 1);
    advance(6000);
    assert.deepEqual(first.getDemoState(), second.getDemoState());
    assert.equal(first.getDemoState().index, 1);
  });
});
