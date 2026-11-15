import test from 'node:test';
import assert from 'node:assert/strict';
import { createChessSession } from '../dist/chess-session.js';
import { createGame as createChess, playMove as playChess } from '../dist/chess-core.js';
import { createGame as createTicTacToe, playMove as playTicTacToe } from '../dist/tic-tac-toe-core.js';
import { createGame as createMonopoly, rollDice, decideProperty } from '../dist/monopoly-core.js';
import { createGameProjectionController, validGameSelection, gameProjectionUrl, openGameProjection, GAME_AR_MESSAGE, GAME_AR_WINDOW } from '../dist/game-ar-control.js';
import { renderGameProjection } from '../dist/game-ar-view.js';

function roomHarness() {
  let nextId = 0;
  const channels = new Set(), queue = [], timers = new Map();
  class Channel {
    constructor(name) { this.name = name; channels.add(this); }
    postMessage(data) {
      for (const target of channels) if (target !== this && target.name === this.name) {
        queue.push(() => target.onmessage?.({ data: structuredClone(data) }));
      }
    }
    close() { channels.delete(this); }
  }
  const dependencies = {
    BroadcastChannel: Channel,
    randomId: () => `peer-${++nextId}`,
    setTimeout: (fn, delay) => { const id = ++nextId; timers.set(id, { fn, delay }); return id; },
    clearTimeout: id => timers.delete(id),
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  const sessions = [];
  function create(options) {
    const session = createChessSession(options, dependencies);
    sessions.push(session);
    return session;
  }
  function flush() {
    for (let i = 0; queue.length; i++) {
      assert.ok(i < 500, 'room messages must not echo indefinitely');
      queue.shift()();
    }
  }
  return { create, flush, close: () => sessions.forEach(session => session.close()), channels };
}

test('a single projection follows the selected room, switches games, and retains its last frame on disconnect', t => {
  const h = roomHarness();
  t.after(() => h.close());
  const chess = h.create({ owner: true, roomId: 'chess-room' });
  const ttt = h.create({ owner: true, roomId: 'ttt-room' });
  const monopoly = h.create({ owner: true, roomId: 'monopoly-room' });
  const seen = [];
  const controller = createGameProjectionController({ createSession: h.create, onUpdate: view => seen.push(view) });
  t.after(() => controller.clear());

  const chessState = { game: playChess(createChess(), 112), speech: '黑棋已经落子' };
  const ticState = { kind: 'tic-tac-toe', game: playTicTacToe(createTicTacToe(), 4) };
  const townState = { kind: 'monopoly', game: rollDice(createMonopoly(), () => 0), lastCard: null };
  chess.publish(chessState); ttt.publish(ticState); monopoly.publish(townState);

  assert.equal(controller.select({ game: 'chess', room: 'chess-room' }), true);
  h.flush();
  assert.equal(seen.at(-1).connected, true);
  assert.equal(seen.at(-1).snapshot.game.board[112], 1);

  controller.select({ game: 'tic-tac-toe', room: 'ttt-room' });
  h.flush();
  assert.equal(seen.at(-1).game, 'tic-tac-toe');
  assert.equal(seen.at(-1).snapshot.game.board[4], 1);
  chess.publish({ ...chessState, speech: '旧房间的更新' }); h.flush();
  assert.equal(seen.at(-1).game, 'tic-tac-toe', 'a previous room cannot change the selected game');

  controller.select({ game: 'monopoly', room: 'monopoly-room' }); h.flush();
  assert.equal(seen.at(-1).snapshot.game.players[0].position, 1);
  monopoly.close(); h.flush();
  assert.equal(seen.at(-1).connected, false);
  assert.equal(seen.at(-1).snapshot.game.players[0].position, 1, 'disconnect retains the last board');
  controller.clear();
  assert.equal(seen.at(-1), null);
  assert.equal(controller.isActive(), false);
});

test('projection renders actual board moves, turn information and the town game state', () => {
  const chess = { game: playChess(createChess(), 112), speech: '走到中央' };
  const chessHtml = renderGameProjection({ game: 'chess', snapshot: chess, connected: true });
  assert.match(chessHtml, /五子棋/);
  assert.match(chessHtml, /class="gar-stone black" cx="140" cy="140"/);
  assert.match(chessHtml, /已下 1 手/);
  assert.match(chessHtml, /走到中央/);

  const tic = { kind: 'tic-tac-toe', game: playTicTacToe(createTicTacToe(), 4) };
  const ticHtml = renderGameProjection({ game: 'tic-tac-toe', snapshot: tic, connected: true });
  assert.match(ticHtml, /井字棋/);
  assert.match(ticHtml, /class="x">X<\/span>/);
  assert.match(ticHtml, /轮到 O/);

  const landed = rollDice(createMonopoly(), () => 0);
  const purchased = decideProperty(landed, true);
  const townHtml = renderGameProjection({ game: 'monopoly', snapshot: { kind: 'monopoly', game: purchased, lastCard: { title: '<script>!', description: '购买了地产' } }, connected: true });
  assert.match(townHtml, /芽团大富翁/);
  assert.match(townHtml, /owner-0/);
  assert.match(townHtml, /die-1\.jpg/);
  assert.match(townHtml, /880/);
  assert.match(townHtml, /&lt;script&gt;!/);
  assert.doesNotMatch(townHtml, /<script>/);
  assert.match(townHtml, /gar-token token-0/);
});

test('selection is constrained and an existing projection is switched without navigation', () => {
  assert.equal(validGameSelection({ game: 'chess', room: '../other' }), false);
  assert.equal(validGameSelection({ game: 'other', room: 'room' }), false);
  assert.equal(validGameSelection({ game: 'tic-tac-toe', room: 'ttt-123' }), true);
  assert.throws(() => gameProjectionUrl({ game: 'chess', room: '../x' }, 'http://localhost:4173/chess.html'));

  const sent = [];
  let focused = false, openedName;
  const projection = {
    location: { href: 'http://localhost:4173/projection.html' },
    document: { documentElement: { dataset: { gameArReady: '1' } } },
    postMessage: (data, origin) => sent.push({ data, origin }),
    focus: () => { focused = true; },
  };
  const browser = { location: { href: 'http://localhost:4173/chess.html' }, open: (_url, name) => { openedName = name; return projection; } };
  assert.equal(openGameProjection({ game: 'chess', room: 'abc-123' }, browser), true);
  assert.equal(openedName, GAME_AR_WINDOW);
  assert.equal(projection.location.href, 'http://localhost:4173/projection.html', 'existing camera page is not reloaded');
  assert.deepEqual(sent, [{ data: { type: GAME_AR_MESSAGE, game: 'chess', room: 'abc-123' }, origin: 'http://localhost:4173' }]);
  assert.equal(focused, true);

  delete projection.document.documentElement.dataset.gameArReady;
  assert.equal(openGameProjection({ game: 'tic-tac-toe', room: 'ttt-1' }, browser), true);
  assert.equal(projection.location.href, 'http://localhost:4173/projection.html?game=tic-tac-toe&room=ttt-1', 'an older projection reloads once');

  projection.location.href = 'about:blank';
  assert.equal(openGameProjection({ game: 'monopoly', room: 'mono-1' }, browser), true);
  assert.equal(projection.location.href, 'http://localhost:4173/projection.html?game=monopoly&room=mono-1');
  assert.equal(openGameProjection({ game: 'chess', room: 'ok' }, { ...browser, open: () => null }), false);
});
