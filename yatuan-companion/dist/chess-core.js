// Independent, deterministic freestyle Gomoku. No network, timers, or storage.
export const BOARD_SIZE = 15;
const CELLS = BOARD_SIZE * BOARD_SIZE;
const DIRECTIONS = [[0, 1], [1, 0], [1, 1], [1, -1]];
const inside = (row, col) => row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
const validIndex = index => Number.isInteger(index) && index >= 0 && index < CELLS;

export function createGame() {
  return { board: Array(CELLS).fill(0), moves: [], turn: 1, winner: 0, draw: false, winningLine: [] };
}

// Return the whole contiguous winning line, including overlines (six or more).
export function detectWin(board, index) {
  if (!validIndex(index) || !board || ![1, 2].includes(board[index])) return [];
  const player = board[index];
  const row = Math.floor(index / BOARD_SIZE), col = index % BOARD_SIZE;
  for (const [dr, dc] of DIRECTIONS) {
    const before = [], after = [];
    for (const sign of [-1, 1]) {
      let r = row + dr * sign, c = col + dc * sign;
      while (inside(r, c) && board[r * BOARD_SIZE + c] === player) {
        (sign < 0 ? before : after).push(r * BOARD_SIZE + c);
        r += dr * sign;
        c += dc * sign;
      }
    }
    const line = [...before.reverse(), index, ...after];
    if (line.length >= 5) return line;
  }
  return [];
}

export function playMove(game, index) {
  if (!game || game.winner || game.draw || !validIndex(index)
    || ![1, 2].includes(game.turn) || game.board[index] !== 0) return game;
  const player = game.turn;
  const board = game.board.slice();
  board[index] = player;
  const winningLine = detectWin(board, index);
  return {
    board,
    moves: [...game.moves, { index, player }],
    turn: 3 - player,
    winner: winningLine.length ? player : 0,
    draw: !winningLine.length && board.every(cell => cell !== 0),
    winningLine,
  };
}

export function undoRound(game, humanPlayer = 1) {
  if (!game || ![1, 2].includes(humanPlayer)) return game;
  let humanMove = game.moves.length - 1;
  while (humanMove >= 0 && game.moves[humanMove].player !== humanPlayer) humanMove--;
  if (humanMove < 0) return game;
  // Replaying avoids stale win/draw flags and preserves the AI opening for white.
  let restored = createGame();
  for (const move of game.moves.slice(0, humanMove)) restored = playMove(restored, move.index);
  return restored;
}

function candidates(board) {
  const occupied = [];
  for (let i = 0; i < CELLS; i++) if (board[i]) occupied.push(i);
  if (!occupied.length) return [Math.floor(CELLS / 2)];
  const nearby = new Set();
  for (const index of occupied) {
    const row = Math.floor(index / BOARD_SIZE), col = index % BOARD_SIZE;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
      const r = row + dr, c = col + dc;
      if (inside(r, c) && board[r * BOARD_SIZE + c] === 0) nearby.add(r * BOARD_SIZE + c);
    }
  }
  return [...nearby].sort((a, b) => a - b);
}

function positionValue(board, index, player) {
  const row = Math.floor(index / BOARD_SIZE), col = index % BOARD_SIZE;
  let score = 0, threats = 0;
  for (const [dr, dc] of DIRECTIONS) {
    let length = 1, openEnds = 0;
    for (const sign of [-1, 1]) {
      let r = row + dr * sign, c = col + dc * sign;
      while (inside(r, c) && board[r * BOARD_SIZE + c] === player) {
        length++;
        r += dr * sign;
        c += dc * sign;
      }
      if (inside(r, c) && board[r * BOARD_SIZE + c] === 0) openEnds++;
    }
    if (length >= 5) score += 1_000_000;
    else if (length === 4 && openEnds) { score += openEnds === 2 ? 30_000 : 4_000; threats++; }
    else if (length === 3 && openEnds) { score += openEnds === 2 ? 1_500 : 150; if (openEnds === 2) threats++; }
    else if (length === 2 && openEnds) score += openEnds === 2 ? 80 : 12;

    // Five-cell windows recognize broken threes/fours as well as straight runs.
    for (let offset = -4; offset <= 0; offset++) {
      let count = 0, blocked = false;
      for (let step = offset; step < offset + 5; step++) {
        const r = row + dr * step, c = col + dc * step;
        if (!inside(r, c)) { blocked = true; break; }
        const cell = step === 0 ? player : board[r * BOARD_SIZE + c];
        if (cell && cell !== player) { blocked = true; break; }
        if (cell === player) count++;
      }
      if (!blocked) score += [0, 1, 8, 70, 700, 50_000][count];
    }
  }
  if (threats >= 2) score += 2_500;
  return score;
}

export function chooseMove(game, { level = 'balanced' } = {}) {
  if (!game || game.winner || game.draw || ![1, 2].includes(game.turn)) return null;
  const available = candidates(game.board);
  if (!available.length) return null;
  const player = game.turn, opponent = 3 - player;
  const scratch = game.board.slice();
  // Always finish our own five first; otherwise block an immediate opponent win.
  for (const side of [player, opponent]) for (const index of available) {
    scratch[index] = side;
    const wins = detectWin(scratch, index).length > 0;
    scratch[index] = 0;
    if (wins) return index;
  }
  let best = available[0], bestScore = -Infinity;
  for (const index of available) {
    const attack = positionValue(game.board, index, player);
    const defense = positionValue(game.board, index, opponent);
    const row = Math.floor(index / BOARD_SIZE), col = index % BOARD_SIZE;
    const centrality = 14 - Math.abs(row - 7) - Math.abs(col - 7);
    // Gentle plays its own shapes; balanced pays more attention to developing threats.
    const score = attack + defense * (level === 'gentle' ? 0.55 : 1.15) + centrality * 0.1;
    if (score > bestScore) { bestScore = score; best = index; }
  }
  return best;
}
