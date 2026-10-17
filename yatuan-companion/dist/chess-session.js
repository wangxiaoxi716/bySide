// Same-browser room transport for the local chess demo. This is deliberately
// independent of the companion's chat, memories, and persistence.
const HEARTBEAT_MS = 3_000;
const DISCONNECT_MS = 10_000;
const MAX_SEEN_COMMANDS = 512;
const MAX_RETIRED_OWNERS = 64;

function randomId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * One owner publishes the authoritative board; peers display snapshots and
 * submit commands. The optional dependencies argument is only for unit tests.
 * This transport does not connect different computers or browser profiles.
 */
export function createChessSession({ roomId = 'default', owner = false, onState = () => {}, onCommand = () => {} } = {}, dependencies = {}) {
  const io = {
    BroadcastChannel: globalThis.BroadcastChannel,
    clone: value => globalThis.structuredClone(value),
    randomId,
    setTimeout: (...args) => globalThis.setTimeout(...args),
    clearTimeout: (...args) => globalThis.clearTimeout(...args),
    addEventListener: (...args) => globalThis.addEventListener?.(...args),
    removeEventListener: (...args) => globalThis.removeEventListener?.(...args),
    ...dependencies,
  };
  const id = io.randomId();
  let channel = null;
  let closed = false;
  let timer = null;
  let sequence = 0;
  let commandSequence = 0;
  let currentOwner = null;
  let lastSequence = -1;
  let lastState = null;
  let connected = false;
  const seenCommands = new Set();
  const retiredOwners = new Set();

  function remember(set, value, limit) {
    set.add(value);
    if (set.size > limit) set.delete(set.values().next().value);
  }

  function notify() {
    onState(io.clone(lastState), { connected });
  }

  function post(message) {
    if (closed || !channel) return false;
    try {
      channel.postMessage({ protocol: 1, sender: id, ...message });
      return true;
    } catch {
      return false;
    }
  }

  function broadcast(target) {
    return post({ type: 'state', ownerId: id, seq: ++sequence, state: io.clone(lastState), ...(target ? { target } : {}) });
  }

  function heartbeat() {
    if (closed) return;
    broadcast();
    timer = io.setTimeout(heartbeat, HEARTBEAT_MS);
  }

  function watchConnection() {
    io.clearTimeout(timer);
    timer = io.setTimeout(() => {
      timer = null;
      if (closed || !connected) return;
      connected = false;
      notify();
    }, DISCONNECT_MS);
  }

  function receive({ data }) {
    if (closed || !data || data.protocol !== 1 || typeof data.sender !== 'string' || data.sender === id) return;
    if (data.target && data.target !== id) return;
    if (owner) {
      if (data.type === 'hello') {
        broadcast(data.sender);
      } else if (data.type === 'command' && data.ownerId === id && typeof data.commandId === 'string' && data.commandId.length <= 200) {
        const key = `${data.sender}:${data.commandId}`;
        if (seenCommands.has(key)) return;
        remember(seenCommands, key, MAX_SEEN_COMMANDS);
        onCommand(io.clone(data.command));
      }
      return;
    }
    if (typeof data.ownerId !== 'string' || data.ownerId !== data.sender || !Number.isSafeInteger(data.seq) || data.seq < 0) return;
    if (data.type === 'closed' && data.ownerId === currentOwner && data.seq > lastSequence) {
      lastSequence = data.seq;
      remember(retiredOwners, currentOwner, MAX_RETIRED_OWNERS);
      io.clearTimeout(timer);
      timer = null;
      connected = false;
      notify();
      return;
    }
    if (data.type !== 'state' || retiredOwners.has(data.ownerId)) return;
    if (data.ownerId === currentOwner && data.seq <= lastSequence) return;
    if (currentOwner && data.ownerId !== currentOwner) remember(retiredOwners, currentOwner, MAX_RETIRED_OWNERS);
    currentOwner = data.ownerId;
    lastSequence = data.seq;
    lastState = io.clone(data.state);
    connected = true;
    watchConnection();
    notify();
  }

  function publish(state) {
    if (closed || !owner || !channel) return false;
    lastState = io.clone(state);
    return broadcast();
  }

  function send(command) {
    if (closed || owner || !connected || !currentOwner) return false;
    return post({ type: 'command', ownerId: currentOwner, commandId: `${id}:${++commandSequence}`, command: io.clone(command) });
  }

  function close() {
    if (closed) return;
    if (owner) post({ type: 'closed', ownerId: id, seq: ++sequence });
    closed = true;
    connected = false;
    io.clearTimeout(timer);
    timer = null;
    io.removeEventListener('pagehide', close);
    if (channel) {
      channel.onmessage = null;
      channel.close();
      channel = null;
    }
  }

  try {
    if (!io.BroadcastChannel) throw new Error('BroadcastChannel unavailable');
    channel = new io.BroadcastChannel(`yatuan:chess:${roomId}`);
    channel.onmessage = receive;
    io.addEventListener('pagehide', close);
    if (owner) timer = io.setTimeout(heartbeat, HEARTBEAT_MS);
    else {
      notify();
      post({ type: 'hello' });
    }
  } catch {
    close();
    onState(null, { connected: false });
  }

  return { publish, send, close, id };
}
