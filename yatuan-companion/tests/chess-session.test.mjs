import test from 'node:test';
import assert from 'node:assert/strict';
import { createChessSession } from '../dist/chess-session.js';

function harness() {
  let clock = 0;
  let serial = 0;
  const channels = new Set();
  const timers = new Map();
  const queue = [];
  const packets = [];
  class Channel {
    constructor(name) { this.name = name; this.closed = false; channels.add(this); }
    postMessage(data) {
      packets.push(structuredClone(data));
      for (const target of channels) {
        if (target !== this && target.name === this.name && !target.closed) queue.push(() => target.onmessage?.({ data: structuredClone(data) }));
      }
    }
    close() { this.closed = true; channels.delete(this); }
  }
  const dependencies = {
    BroadcastChannel: Channel,
    randomId: () => `session-${++serial}`,
    setTimeout: (fn, delay) => { const timer = ++serial; timers.set(timer, { fn, at: clock + delay }); return timer; },
    clearTimeout: timer => timers.delete(timer),
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  function flush() {
    for (let loops = 0; queue.length; loops++) {
      assert.ok(loops < 1_000, 'transport must not echo messages forever');
      queue.shift()();
    }
  }
  function advance(amount) {
    const target = clock + amount;
    while (true) {
      const next = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      clock = next[1].at;
      timers.delete(next[0]);
      next[1].fn();
      flush();
    }
    clock = target;
  }
  const sessions = [];
  const create = options => {
    const session = createChessSession({ roomId: 'room', ...options }, dependencies);
    sessions.push(session);
    return session;
  };
  const inject = data => { for (const channel of channels) channel.onmessage?.({ data }); };
  return { create, flush, advance, inject, timers, packets, channels, dependencies, close: () => sessions.forEach(session => session.close()) };
}

test('late peer handshake receives the latest isolated snapshot', () => {
  const h = harness();
  const owner = h.create({ owner: true });
  const board = { moves: [{ row: 7, col: 7 }] };
  owner.publish(board);
  board.moves[0].row = 1;
  const seen = [];
  h.create({ onState: (state, meta) => seen.push({ state, meta }) });
  h.flush();
  assert.deepEqual(seen[0], { state: null, meta: { connected: false } });
  assert.deepEqual(seen.at(-1), { state: { moves: [{ row: 7, col: 7 }] }, meta: { connected: true } });
  seen.at(-1).state.moves[0].row = 2;
  h.advance(3_000);
  assert.equal(seen.at(-1).state.moves[0].row, 7, 'peer mutation cannot change the owner snapshot');
  assert.equal([...h.channels][0].name, 'yatuan:chess:room');
  h.close();
});

test('only owner accepts commands; peers do not echo them and duplicates are ignored', () => {
  const h = harness();
  const commands = [];
  let peerCommands = 0;
  let ownerStates = 0;
  const owner = h.create({ owner: true, onCommand: command => commands.push(command), onState: () => ownerStates++ });
  const peer = h.create({ onCommand: () => peerCommands++ });
  assert.equal(peer.send({ move: 1 }), false, 'disconnected peers cannot submit commands');
  h.flush();
  const before = h.packets.length;
  const move = { move: { row: 3, col: 4 } };
  assert.equal(peer.send(move), true);
  move.move.row = 0;
  h.flush();
  const commandPacket = h.packets.at(-1);
  h.inject(commandPacket);
  h.inject({ ...commandPacket, ownerId: 'another-owner' });
  assert.deepEqual(commands, [{ move: { row: 3, col: 4 } }]);
  assert.equal(peerCommands, 0);
  assert.equal(ownerStates, 0);
  assert.equal(h.packets.length, before + 1);
  assert.equal(owner.send({ move: 1 }), false);
  assert.equal(peer.publish({ moves: [] }), false);
  h.close();
});

test('owner close disconnects peer while retaining board and cleans resources', () => {
  const h = harness();
  const seen = [];
  const owner = h.create({ owner: true });
  owner.publish({ turn: 4 });
  const peer = h.create({ onState: (state, meta) => seen.push({ state, meta }) });
  h.flush();
  owner.close();
  h.flush();
  assert.deepEqual(seen.at(-1), { state: { turn: 4 }, meta: { connected: false } });
  assert.equal(peer.send({ move: 1 }), false);
  owner.close();
  peer.close();
  assert.equal(h.timers.size, 0);
  assert.equal(h.channels.size, 0);
  assert.equal(owner.publish({ turn: 5 }), false);
});

test('out-of-order packets do not roll back; a new owner can restart sequence', () => {
  const h = harness();
  const seen = [];
  h.create({ onState: (state, meta) => seen.push({ state, meta }) });
  const state = (ownerId, seq, turn) => ({ protocol: 1, type: 'state', sender: ownerId, ownerId, seq, state: { turn } });
  h.inject(state('owner-a', 9, 9));
  h.inject(state('owner-a', 8, 8));
  h.inject(state('owner-a', 9, 99));
  assert.equal(seen.at(-1).state.turn, 9);
  h.inject(state('owner-b', 1, 1));
  h.inject(state('owner-a', 10, 10));
  assert.equal(seen.at(-1).state.turn, 1);
  h.inject({ protocol: 1, type: 'closed', sender: 'owner-b', ownerId: 'owner-b', seq: 0 });
  assert.equal(seen.at(-1).meta.connected, true, 'stale close cannot disconnect a later snapshot');
  h.close();
});

test('heartbeat keeps connection alive; missing updates time out and later state reconnects', () => {
  const h = harness();
  const seen = [];
  const owner = h.create({ owner: true });
  const peer = h.create({ onState: (state, meta) => seen.push({ state, meta }) });
  owner.publish({ turn: 3 });
  h.flush();
  h.advance(30_000);
  assert.equal(seen.at(-1).meta.connected, true);
  // Simulate a terminated tab: no explicit closed message reaches its peers.
  h.timers.clear();
  h.inject({ protocol: 1, type: 'state', ownerId: owner.id, sender: owner.id, seq: 100, state: { turn: 3 } });
  h.advance(9_999);
  assert.equal(seen.at(-1).meta.connected, true);
  h.advance(1);
  assert.deepEqual(seen.at(-1), { state: { turn: 3 }, meta: { connected: false } });
  assert.equal(peer.send({ move: 1 }), false);
  h.inject({ protocol: 1, type: 'state', ownerId: owner.id, sender: owner.id, seq: 101, state: { turn: 4 } });
  assert.deepEqual(seen.at(-1), { state: { turn: 4 }, meta: { connected: true } });
  h.close();
});

test('closed owner cannot resurrect from delayed packets but replacement owner reconnects', () => {
  const h = harness();
  const seen = [];
  const owner = h.create({ owner: true });
  h.create({ onState: (state, meta) => seen.push({ state, meta }) });
  owner.publish({ turn: 1 });
  h.flush();
  owner.close(); h.flush();
  h.inject({ protocol: 1, type: 'state', ownerId: owner.id, sender: owner.id, seq: 50, state: { turn: 50 } });
  assert.equal(seen.at(-1).meta.connected, false);
  const replacement = h.create({ owner: true });
  replacement.publish({ turn: 2 }); h.flush();
  assert.deepEqual(seen.at(-1), { state: { turn: 2 }, meta: { connected: true } });
  h.close();
});

test('rooms remain isolated and missing BroadcastChannel reports unsupported transport', () => {
  const h = harness();
  const seen = [];
  const owner = h.create({ roomId: 'other', owner: true });
  h.create({ onState: (state, meta) => seen.push({ state, meta }) });
  owner.publish({ secret: 'other room' });
  h.flush();
  assert.deepEqual(seen, [{ state: null, meta: { connected: false } }]);
  const unsupported = [];
  const session = createChessSession({ onState: (state, meta) => unsupported.push({ state, meta }) }, { ...h.dependencies, BroadcastChannel: null });
  assert.deepEqual(unsupported, [{ state: null, meta: { connected: false } }]);
  assert.equal(session.send({ move: 1 }), false);
  assert.equal(session.publish({}), false);
  session.close();
  h.close();
});

test('pagehide sends a close and removes the lifecycle listener', () => {
  const h = harness();
  const listeners = new Map();
  const owner = createChessSession({ roomId: 'room', owner: true }, {
    ...h.dependencies,
    addEventListener: (type, handler) => listeners.set(type, handler),
    removeEventListener: type => listeners.delete(type),
  });
  const seen = [];
  h.create({ onState: (state, meta) => seen.push({ state, meta }) });
  owner.publish({ turn: 1 }); h.flush();
  listeners.get('pagehide')(); h.flush();
  assert.equal(seen.at(-1).meta.connected, false);
  assert.equal(listeners.size, 0);
  h.close();
});

test('command deduplication has a bounded window and preserves recent entries', () => {
  const h = harness();
  let received = 0;
  const owner = h.create({ owner: true, onCommand: () => received++ });
  const packet = index => ({ protocol: 1, type: 'command', sender: 'peer', ownerId: owner.id, commandId: `move-${index}`, command: { move: index } });
  for (let index = 0; index < 513; index++) h.inject(packet(index));
  h.inject(packet(512));
  assert.equal(received, 513, 'a recent duplicate is rejected');
  h.inject(packet(0));
  assert.equal(received, 514, 'the bounded window does not retain every command forever');
  h.close();
});

test('default timer wrappers retain the Window receiver in browsers', () => {
  const h = harness();
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const { setTimeout: fakeSetTimeout, clearTimeout: fakeClearTimeout, ...dependencies } = h.dependencies;
  let calls = 0;
  globalThis.setTimeout = function (...args) {
    assert.equal(this, globalThis, 'browser timer receiver must be the global object');
    calls++;
    return fakeSetTimeout(...args);
  };
  globalThis.clearTimeout = function (...args) {
    assert.equal(this, globalThis, 'browser timer receiver must be the global object');
    return fakeClearTimeout(...args);
  };
  try {
    const session = createChessSession({ owner: true }, dependencies);
    assert.equal(calls, 1);
    h.advance(3_000);
    assert.equal(calls, 2);
    session.close();
    assert.equal(h.timers.size, 0);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    h.close();
  }
});
