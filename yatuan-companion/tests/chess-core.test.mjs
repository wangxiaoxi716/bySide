import test from 'node:test';
import assert from 'node:assert/strict';
import { BOARD_SIZE, createGame, playMove, detectWin, undoRound, chooseMove } from '../dist/chess-core.js';

const at = (row, col) => row * BOARD_SIZE + col;
const play = indices => indices.reduce(playMove, createGame());
const freeze = game => {
  Object.freeze(game.board);
  game.moves.forEach(Object.freeze);
  Object.freeze(game.moves);
  Object.freeze(game.winningLine);
  return Object.freeze(game);
};

test('new games have independent empty boards and black starts', () => {
  const first = createGame(), second = createGame();
  assert.equal(BOARD_SIZE, 15);
  assert.equal(first.board.length, 225);
  assert.ok(first.board.every(cell => cell === 0));
  assert.equal(first.turn, 1);
  first.board[0] = 1;
  assert.equal(second.board[0], 0);
});

test('legal moves alternate and retain an immutable history', () => {
  const empty = freeze(createGame());
  const black = freeze(playMove(empty, 112));
  const white = playMove(black, 113);
  assert.equal(empty.board[112], 0);
  assert.deepEqual(empty.moves, []);
  assert.equal(black.board[113], 0);
  assert.equal(black.turn, 2);
  assert.deepEqual(white.moves, [{ index: 112, player: 1 }, { index: 113, player: 2 }]);
  assert.equal(white.turn, 1);
});

test('invalid bounds, occupied cells, and noninteger positions are no-ops', () => {
  const game = freeze(playMove(createGame(), 112));
  for (const index of [-1, 225, 1.2, NaN, Infinity, '3', null, undefined, 112]) {
    assert.equal(playMove(game, index), game);
  }
});

for (const [name, dr, dc] of [['horizontal', 0, 1], ['vertical', 1, 0], ['diagonal', 1, 1], ['anti-diagonal', 1, -1]]) {
  test(`${name} five is detected including a stone placed in the middle`, () => {
    const board = createGame().board;
    const line = Array.from({ length: 5 }, (_, n) => at(5 + n * dr, 8 + n * dc));
    for (const index of line) board[index] = 2;
    assert.deepEqual(detectWin(board, line[2]), line);
  });
}

test('horizontal and diagonal runs never wrap across board edges', () => {
  const board = createGame().board;
  for (const index of [13, 14, 15, 16, 17]) board[index] = 1;
  assert.deepEqual(detectWin(board, 15), []);
  const diagonal = createGame().board;
  for (const index of [13, 29, 45, 61, 77]) diagonal[index] = 1;
  assert.deepEqual(detectWin(diagonal, 45), []);
  assert.deepEqual(detectWin(board, -1), []);
  assert.deepEqual(detectWin(board, 0), []);
});

test('freestyle overlines win and moves are blocked after a win', () => {
  const board = createGame().board;
  for (const col of [2, 3, 4, 6, 7]) board[at(7, col)] = 1;
  const finished = playMove({ ...createGame(), board }, at(7, 5));
  assert.equal(finished.winner, 1);
  assert.equal(finished.winningLine.length, 6);
  assert.equal(finished.draw, false);
  assert.equal(playMove(finished, 0), finished);
  assert.equal(chooseMove(finished), null);
});

test('a full nonwinning board becomes a draw and cannot accept more moves', () => {
  const board = Array.from({ length: 225 }, (_, i) => (Math.floor(i / 15) + 2 * (i % 15)) % 4 < 2 ? 1 : 2);
  for (let index = 0; index < 225; index++) assert.deepEqual(detectWin(board, index), []);
  const turn = board[224];
  board[224] = 0;
  const finished = playMove({ ...createGame(), board, turn }, 224);
  assert.equal(finished.draw, true);
  assert.equal(finished.winner, 0);
  assert.equal(playMove(finished, 0), finished);
  assert.equal(chooseMove(finished), null);
});

test('undo cancels a pending human move or an entire completed round', () => {
  const empty = createGame();
  assert.equal(undoRound(empty), empty);
  assert.deepEqual(undoRound(play([112])), empty);
  assert.deepEqual(undoRound(play([112, 113])), empty);
  const game = freeze(play([112, 113, 127, 128]));
  assert.deepEqual(undoRound(game), play([112, 113]));
  assert.equal(game.moves.length, 4);
  assert.equal(undoRound(game).turn, 1);
});

test('undo as white preserves black opening and restores white turn', () => {
  const opening = play([112]);
  assert.equal(undoRound(opening, 2), opening);
  assert.deepEqual(undoRound(play([112, 113]), 2), opening);
  assert.deepEqual(undoRound(play([112, 113, 127]), 2), opening);
});

test('undo after a win clears the result and returns to the human turn', () => {
  const game = play([0, 30, 1, 31, 2, 32, 3, 33, 4]);
  assert.equal(game.winner, 1);
  const undone = undoRound(freeze(game));
  assert.equal(undone.winner, 0);
  assert.equal(undone.draw, false);
  assert.deepEqual(undone.winningLine, []);
  assert.equal(undone.moves.length, 8);
  assert.equal(undone.turn, 1);
});

test('undo after the computer wins removes both the human and computer move', () => {
  const game = play([0, 30, 2, 31, 4, 32, 6, 33, 8, 34]);
  assert.equal(game.winner, 2);
  const undone = undoRound(freeze(game));
  assert.equal(undone.winner, 0);
  assert.equal(undone.moves.length, 8);
  assert.equal(undone.board[8], 0);
  assert.equal(undone.board[34], 0);
  assert.equal(undone.turn, 1);
});

test('both levels take their immediate win before blocking an opponent', () => {
  const game = play([at(5, 2), at(8, 2), at(5, 3), at(8, 3), at(5, 4), at(8, 4), at(5, 5), at(8, 5)]);
  freeze(game);
  for (const level of ['gentle', 'balanced']) {
    const move = chooseMove(game, { level });
    assert.equal(playMove(game, move).winner, 1);
  }
});

test('both levels block an opponent immediate win, including a broken four', () => {
  for (const cols of [[0, 1, 2, 3], [0, 1, 3, 4]]) {
    const board = createGame().board;
    for (const col of cols) board[at(6, col)] = 2;
    board[at(10, 8)] = 1;
    const game = freeze({ ...createGame(), board });
    for (const level of ['gentle', 'balanced']) {
      assert.equal(chooseMove(game, { level }), at(6, cols.includes(2) ? 4 : 2));
    }
  }
});

test('the white computer takes a win and blocks black using its own turn', () => {
  const winning = play([0, 30, 2, 31, 4, 32, 6, 33, 8]);
  assert.equal(winning.turn, 2);
  assert.equal(playMove(winning, chooseMove(winning)).winner, 2);
  const defensive = play([0, 30, 1, 32, 2, 34, 3]);
  assert.equal(defensive.turn, 2);
  assert.equal(chooseMove(defensive), 4);
});

test('choosing a move is deterministic, legal, and does not mutate state', () => {
  assert.equal(chooseMove(createGame()), 112);
  const game = freeze(play([112, 113, 97, 128]));
  const before = JSON.stringify(game);
  for (const level of ['gentle', 'balanced']) {
    const first = chooseMove(game, { level });
    assert.equal(game.board[first], 0);
    assert.equal(chooseMove(game, { level }), first);
  }
  assert.equal(JSON.stringify(game), before);
});
