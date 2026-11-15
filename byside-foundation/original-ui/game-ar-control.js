import { createChessSession } from './chess-session.js';

export const GAME_AR_WINDOW = 'yatuan-projection';
export const GAME_AR_MESSAGE = 'yatuan:game-ar:select';
export const GAME_AR_KINDS = Object.freeze(['chess', 'tic-tac-toe', 'monopoly']);

export function validGameSelection(value) {
  return Boolean(value && GAME_AR_KINDS.includes(value.game)
    && typeof value.room === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value.room));
}

export function gameProjectionUrl(selection, base) {
  if (!validGameSelection(selection)) throw new TypeError('Invalid game or room');
  const url = new URL('projection.html', base);
  url.searchParams.set('game', selection.game);
  url.searchParams.set('room', selection.room);
  return url.href;
}

// A named projection window keeps its camera and calibration when another game
// is chosen. If it does not exist yet, its URL carries the initial selection.
export function openGameProjection(selection, browser = globalThis.window) {
  if (!browser || !validGameSelection(selection)) return false;
  const targetUrl = gameProjectionUrl(selection, browser.location.href);
  const expected = new URL(targetUrl);
  const projection = browser.open('', GAME_AR_WINDOW);
  if (!projection) return false;
  try {
    const current = new URL(projection.location.href, browser.location.href);
    if (current.origin === expected.origin && current.pathname === expected.pathname
      && projection.document?.documentElement?.dataset?.gameArReady === '1') {
      projection.postMessage({ type: GAME_AR_MESSAGE, ...selection }, expected.origin);
    } else {
      // A projection opened before this feature was installed must reload once
      // so it can receive selections and join the requested room.
      projection.location.href = targetUrl;
    }
  } catch {
    // A stale named window may be on another origin; navigating to our own
    // projection URL is safer than sending a selection to that page.
    projection.location.href = targetUrl;
  }
  try { projection.focus(); } catch { /* Focusing a window is optional. */ }
  return true;
}

// The active game is always read-only. Each switch closes the previous room;
// generation guards reject any callbacks that were already queued for it.
export function createGameProjectionController({ onUpdate, createSession = createChessSession }) {
  let selection = null, session = null, snapshot = null, connected = false, generation = 0;
  const notify = () => onUpdate(selection ? { ...selection, snapshot, connected } : null);

  function select(next) {
    if (!validGameSelection(next)) return false;
    if (selection?.game === next.game && selection.room === next.room) return true;
    const token = ++generation;
    session?.close();
    session = null;
    selection = { game: next.game, room: next.room };
    snapshot = null;
    connected = false;
    notify();
    session = createSession({ roomId: next.room, onState(state, meta = {}) {
      if (token !== generation) return;
      snapshot = state;
      connected = meta.connected === true;
      notify();
    } });
    return true;
  }

  function clear() {
    generation++;
    session?.close();
    session = null;
    selection = null;
    snapshot = null;
    connected = false;
    notify();
  }

  return { select, clear, isActive: () => selection !== null };
}

export function installGameProjectionLink(link, selection, browser = globalThis.window) {
  link.href = gameProjectionUrl(selection, browser.location.href);
  link.target = GAME_AR_WINDOW;
  link.addEventListener('click', event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (openGameProjection(selection, browser)) event.preventDefault();
  });
}
