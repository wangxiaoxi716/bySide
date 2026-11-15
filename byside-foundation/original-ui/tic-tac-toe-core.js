// Local, deterministic tic-tac-toe rules. No DOM, timers, network, or storage.
export const BOARD_SIZE = 3;
const WINNING_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];
const MOVE_ORDER = [4, 0, 2, 6, 8, 1, 3, 5, 7];
const validIndex = index => Number.isInteger(index) && index >= 0 && index < 9;

export function createGame() {
  return { board: Array(9).fill(0), moves: [], turn: 1, winner: 0, draw: false, winningLine: [] };
}

export function detectWin(board, index) {
  if (!Array.isArray(board) || !validIndex(index) || ![1, 2].includes(board[index])) return [];
  return WINNING_LINES.find(line => line.includes(index) && line.every(cell => board[cell] === board[index]))?.slice() ?? [];
}

export function playMove(game, index) {
  if (!game || game.winner || game.draw || !validIndex(index)
    || ![1, 2].includes(game.turn) || game.board[index] !== 0) return game;
  const player = game.turn, board = game.board.slice();
  board[index] = player;
  const winningLine = detectWin(board, index);
  return {
    board,
    moves: [...game.moves, { index, player }],
    turn: 3 - player,
    winner: winningLine.length ? player : 0,
    draw: !winningLine.length && board.every(Boolean),
    winningLine,
  };
}

// Undo the last human move and any following opponent move, as in Gomoku.
export function undoRound(game, humanPlayer = 1) {
  if (!game || ![1, 2].includes(humanPlayer)) return game;
  let lastHumanMove = game.moves.length - 1;
  while (lastHumanMove >= 0 && game.moves[lastHumanMove].player !== humanPlayer) lastHumanMove--;
  if (lastHumanMove < 0) return game;
  return game.moves.slice(0, lastHumanMove).reduce((restored, move) => playMove(restored, move.index), createGame());
}

function scorePosition(board, turn, ai, depth, lastMove) {
  if (detectWin(board, lastMove).length) return (3 - turn === ai ? 10 - depth : depth - 10);
  if (board.every(Boolean)) return 0;
  let best = turn === ai ? -Infinity : Infinity;
  for (const index of MOVE_ORDER) {
    if (board[index]) continue;
    board[index] = turn;
    const score = scorePosition(board, 3 - turn, ai, depth + 1, index);
    board[index] = 0;
    best = turn === ai ? Math.max(best, score) : Math.min(best, score);
  }
  return best;
}

export function chooseMove(game, { level = 'balanced' } = {}) {
  if (!game || game.winner || game.draw || ![1, 2].includes(game.turn)) return null;
  const options = MOVE_ORDER.filter(index => game.board[index] === 0);
  if (!options.length) return null;
  const board = game.board.slice(), player = game.turn;

  // Even the relaxed player finishes an immediate win and blocks an immediate loss.
  for (const side of [player, 3 - player]) {
    for (const index of options) {
      board[index] = side;
      const wins = detectWin(board, index).length;
      board[index] = 0;
      if (wins) return index;
    }
  }
  if (level === 'gentle') return options[0];

  let best = options[0], bestScore = -Infinity;
  for (const index of options) {
    board[index] = player;
    const score = scorePosition(board, 3 - player, player, 1, index);
    board[index] = 0;
    if (score > bestScore) { bestScore = score; best = index; }
  }
  return best;
}
