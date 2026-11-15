// Ephemeral playback and streaming captions. Persistent companion data stays in
// state.js and the foundation. A lease clears a preview if its audio tab crashes.
const LEASE_MS = 15000;
const MOTIONS = ['idle', 'listening', 'thinking', 'speaking'];

export function createPresentationChannel({ channel = null } = {}) {
  const writer = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  const listeners = new Set();
  let clock = 0, latest = { clock: 0, writer: '' }, envelope = null;
  let owner = null, heartbeat = null, expiry = null, closed = false;
  const getState = () => envelope?.state ? { ...envelope.state } : null;
  function notify() {
    for (const listener of listeners) {
      try { listener(getState()); } catch (error) { console.error('Presentation subscriber failed', error); }
    }
  }
  function post(value) {
    try { channel?.postMessage(value); } catch { /* The local scene still updates. */ }
  }
  function apply(next) {
    const previous = JSON.stringify(getState());
    envelope = next;
    clearTimeout(expiry);
    if (next.state) {
      expiry = setTimeout(() => {
        envelope = null;
        notify();
      }, Math.max(0, next.expiresAt - Date.now()));
    }
    if (JSON.stringify(getState()) !== previous) notify();
  }
  function publish(state) {
    latest = { clock: ++clock, writer };
    const next = { type: 'presentation', ...latest, expiresAt: Date.now() + LEASE_MS, state };
    apply(next);
    post(next);
  }
  function receive(event) {
    const next = event.data;
    if (closed) return;
    if (next?.type === 'presentation.request') {
      if (owner && envelope) post(envelope);
      return;
    }
    if (next?.type !== 'presentation' || typeof next.writer !== 'string' || next.writer === writer ||
        !Number.isSafeInteger(next.clock) || next.clock < 1 || !Number.isFinite(next.expiresAt) ||
        next.expiresAt <= Date.now() || next.expiresAt > Date.now() + LEASE_MS + 1000) return;
    if (next.state !== null && (!next.state || !MOTIONS.includes(next.state.motion) ||
        typeof next.state.speech !== 'string' || next.state.speech.length > 3000)) return;
    clock = Math.max(clock, next.clock);
    if (next.clock < latest.clock || (next.clock === latest.clock && next.writer <= latest.writer)) return;
    latest = { clock: next.clock, writer: next.writer };
    owner = null;
    clearInterval(heartbeat);
    apply({ ...next, state: next.state ? { motion: next.state.motion, speech: next.state.speech } : null });
  }
  channel?.addEventListener('message', receive);
  post({ type: 'presentation.request' });
  return {
    getState,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    begin(initial) {
      const token = {};
      if (closed) return { update() {}, end() {} };
      owner = token;
      const update = patch => {
        if (closed || owner !== token) return;
        const current = getState();
        publish({
          motion: MOTIONS.includes(patch.motion) ? patch.motion : current?.motion || 'idle',
          speech: typeof patch.speech === 'string' ? patch.speech.slice(0, 3000) : current?.speech || '',
        });
      };
      clearInterval(heartbeat);
      update(initial);
      heartbeat = setInterval(() => { if (owner === token && envelope?.state) publish(envelope.state); }, 3000);
      return {
        update,
        end() {
          if (closed || owner !== token) return;
          owner = null;
          clearInterval(heartbeat);
          publish(null);
        },
      };
    },
    close() {
      if (closed) return;
      if (owner) publish(null);
      closed = true;
      owner = null;
      clearInterval(heartbeat);
      clearTimeout(expiry);
      channel?.removeEventListener('message', receive);
      channel?.close();
      listeners.clear();
    },
  };
}
