import { BOARD } from './monopoly-core.js';

// Grid coordinates follow the route in BOARD, including the return to start.
export const BOARD_POSITIONS = [[5,1],[5,2],[5,3],[5,4],[5,5],[4,5],[3,5],[2,5],[1,5],[1,4],[1,3],[1,2],[1,1],[2,1],[3,1],[4,1]];
const validPosition = value => Number.isInteger(value) && value >= 0 && value < BOARD.length;
const validDie = value => Number.isInteger(value) && value >= 1 && value <= 6;

// These are presentation frames only: neither the original nor resolved game
// is mutated, and the resolved state is applied only after the last frame.
export function buildRollFrames(before, resolved, { reducedMotion = false } = {}) {
  const turn = before?.turn, dice = resolved?.dice;
  if (before?.phase !== 'roll' || !Array.isArray(before.players) || before.players.length !== 2 ||
      !Number.isInteger(turn) || turn < 0 || turn >= before.players.length ||
      !before.players.every(player => validPosition(player.position)) || !validDie(dice) ||
      resolved?.turn !== turn || !Array.isArray(resolved.players) ||
      resolved.players[turn]?.position !== (before.players[turn].position + dice) % BOARD.length) return [];

  const positions = before.players.map(player => player.position);
  const rollFaces = reducedMotion ? [dice] : [1, 5, 2, 6, 3, 4, 2, 5];
  const frames = rollFaces.map(face => ({ phase: 'rolling', dice: face, positions: positions.slice(), step: 0, duration: reducedMotion ? 150 : 110 }));
  frames.push({ phase: 'showing', dice, positions: positions.slice(), step: 0, duration: reducedMotion ? 100 : 260 });
  for (let step = 1; step <= dice; step++) {
    const current = positions.slice();
    current[turn] = (positions[turn] + step) % BOARD.length;
    frames.push({ phase: 'moving', dice, positions: current, step, previousPosition: (positions[turn] + step - 1) % BOARD.length, duration: reducedMotion ? 100 : 340 });
  }
  return frames;
}

// Projection data is optional and is treated as untrusted input.
export function validRollPresentation(presentation, game) {
  if (!presentation || !['rolling', 'showing', 'moving'].includes(presentation.phase) ||
      !validDie(presentation.dice) || !Array.isArray(presentation.positions) ||
      presentation.positions.length !== 2 || !presentation.positions.every(validPosition) ||
      !Number.isInteger(game?.turn) || game.turn < 0 || game.turn > 1) return false;
  if (presentation.phase !== 'moving') return presentation.step === 0;
  return Number.isInteger(presentation.step) && presentation.step >= 1 && presentation.step <= presentation.dice &&
    validPosition(presentation.previousPosition) &&
    (presentation.previousPosition + 1) % BOARD.length === presentation.positions[game.turn];
}

// Relative origin for a one-tile CSS animation, expressed in grid steps.
export function stepOrigin(previous, current) {
  if (!validPosition(previous) || !validPosition(current)) return { x: 0, y: 0 };
  const [oldRow, oldColumn] = BOARD_POSITIONS[previous], [row, column] = BOARD_POSITIONS[current];
  return { x: oldColumn - column, y: oldRow - row };
}
