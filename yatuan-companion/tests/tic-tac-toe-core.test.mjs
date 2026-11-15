import test from 'node:test';
import assert from 'node:assert/strict';
import { BOARD_SIZE, createGame, playMove, detectWin, undoRound, chooseMove } from '../dist/tic-tac-toe-core.js';

const play = indices => indices.reduce((game, index) => playMove(game, index), createGame());
const freeze = game => {
  Object.freeze(game.board);
  game.moves.forEach(Object.freeze);
  Object.freeze(game.moves);
  Object.freeze(game.winningLine);
  return Object.freeze(game);
};

test('new games are independent and X starts', () => {
  const a = createGame(), b = createGame();
  assert.equal(BOARD_SIZE, 3);
  assert.deepEqual(a.board, Array(9).fill(0));
  assert.equal(a.turn, 1);
  a.board[0] = 1;
  assert.equal(b.board[0], 0);
});

test('valid moves alternate without mutating previous states', () => {
  const original = freeze(createGame());
  const first = freeze(playMove(original, 4));
  const second = playMove(first, 0);
  assert.deepEqual(original.board, Array(9).fill(0));
  assert.deepEqual(second.moves, [{ index: 4, player: 1 }, { index: 0, player: 2 }]);
  assert.equal(second.turn, 1);
});

test('out of range, non-integer, occupied and terminal moves are no-ops', () => {
  const game = freeze(play([4]));
  for (const index of [-1, 9, 1.5, NaN, Infinity, '0', null, undefined, 4]) assert.equal(playMove(game, index), game);
  const finished = freeze(play([0, 3, 1, 4, 2]));
  assert.equal(playMove(finished, 5), finished);
  assert.equal(chooseMove(finished), null);
});

for (const [name, line] of [
  ['first row', [0, 1, 2]], ['second row', [3, 4, 5]], ['third row', [6, 7, 8]],
  ['first column', [0, 3, 6]], ['second column', [1, 4, 7]], ['third column', [2, 5, 8]],
  ['main diagonal', [0, 4, 8]], ['other diagonal', [2, 4, 6]],
]) {
  test(`${name} is a win for each player`, () => {
    for (const side of [1, 2]) {
      const board = Array(9).fill(0);
      line.forEach(index => { board[index] = side; });
      assert.deepEqual(detectWin(board, line[1]), line);
    }
  });
}

test('a winning ninth move takes precedence over a draw', () => {
  const game = play([0, 1, 2, 4, 3, 5, 7, 8, 6]);
  assert.equal(game.moves.length, 9);
  assert.equal(game.winner, 1);
  assert.equal(game.draw, false);
  assert.deepEqual(game.winningLine, [0, 3, 6]);
});

test('a full nonwinning board is a draw', () => {
  const draw = play([0, 1, 2, 4, 3, 5, 7, 6, 8]);
  assert.equal(draw.draw, true);
  assert.equal(draw.winner, 0);
  assert.equal(playMove(draw, 0), draw);
  assert.equal(chooseMove(draw), null);
});

test('undo returns to before the last human move even after a win or a pending reply', () => {
  const before = play([0, 4]);
  assert.deepEqual(undoRound(freeze(play([0, 4, 1]))), before);
  assert.deepEqual(undoRound(freeze(play([0, 4, 1, 8]))), before);
  assert.deepEqual(undoRound(freeze(play([0, 3, 1, 4, 2]))), play([0, 3, 1, 4]));
  const empty = createGame();
  assert.equal(undoRound(empty), empty);
  assert.deepEqual(undoRound(play([4, 0]), 2), play([4]));
});

test('both difficulty levels win immediately or block an immediate threat', () => {
  for (const level of ['gentle', 'balanced']) {
    assert.equal(chooseMove(freeze(play([0, 3, 1, 4, 8])), { level }), 5);
    assert.equal(chooseMove(freeze(play([0, 3, 1])), { level }), 2);
  }
});

test('balanced opponent never loses to any possible sequence of human moves', () => {
  let terminals = 0;
  function explore(game) {
    if (game.winner || game.draw) {
      terminals++;
      assert.notEqual(game.winner, 1, `human win: ${JSON.stringify(game.moves)}`);
      return;
    }
    if (game.turn === 2) {
      const move = chooseMove(freeze(game), { level: 'balanced' });
      assert.equal(game.board[move], 0);
      explore(playMove(game, move));
      return;
    }
    game.board.forEach((cell, index) => { if (!cell) explore(playMove(game, index)); });
  }
  explore(createGame());
  assert.ok(terminals > 0);
});
