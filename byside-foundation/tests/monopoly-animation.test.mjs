import test from 'node:test';
import assert from 'node:assert/strict';
import { BOARD, createGame, rollDice } from '../original-ui/monopoly-core.js';
import { buildRollFrames, stepOrigin, validRollPresentation } from '../original-ui/monopoly-animation.js';

test('each possible die result rolls first, shows the result, and walks one tile at a time', () => {
  for (let dice = 1; dice <= 6; dice++) {
    const before = createGame('local');
    before.turn = 1;
    before.players[0].position = 4;
    before.players[1].position = 5;
    const saved = structuredClone(before);
    const resolved = rollDice(before, () => (dice - 0.5) / 6);
    const frames = buildRollFrames(before, resolved);
    const rolling = frames.filter(frame => frame.phase === 'rolling');
    const showing = frames.find(frame => frame.phase === 'showing');
    const movement = frames.filter(frame => frame.phase === 'moving');

    assert.ok(rolling.length > 1, 'the die has a visible rolling sequence');
    assert.deepEqual(showing.positions, [4, 5], 'the piece waits until the die settles');
    assert.equal(showing.dice, dice);
    assert.deepEqual(movement.map(frame => frame.positions[1]), Array.from({ length: dice }, (_, step) => 6 + step));
    assert.ok(movement.every(frame => frame.positions[0] === 4 && frame.dice === dice));
    assert.equal(movement.at(-1).positions[1], resolved.players[1].position);
    assert.ok(frames.every(frame => validRollPresentation(frame, before)));
    assert.deepEqual(before, saved, 'presentation does not change the live game');
  }
});

test('movement goes around the start and leaves monetary settlement to the resolved game', () => {
  const before = createGame();
  before.players[0].position = BOARD.length - 1;
  const balance = before.players[0].money;
  const resolved = rollDice(before, () => 0.4); // three tiles
  const movement = buildRollFrames(before, resolved).filter(frame => frame.phase === 'moving');
  assert.deepEqual(movement.map(frame => frame.positions[0]), [0, 1, 2]);
  assert.equal(before.players[0].money, balance);
  assert.ok(resolved.players[0].money > balance, 'the pass bonus is in the final state');
  assert.deepEqual(stepOrigin(15, 0), { x: 0, y: -1 });
  assert.deepEqual(stepOrigin(0, 1), { x: -1, y: 0 });
});

test('reduced motion still walks tile by tile and invalid snapshots are ignored', () => {
  const before = createGame();
  const resolved = rollDice(before, () => 0.9);
  const frames = buildRollFrames(before, resolved, { reducedMotion: true });
  assert.equal(frames.filter(frame => frame.phase === 'rolling').length, 1);
  assert.equal(frames.filter(frame => frame.phase === 'moving').length, 6);
  assert.ok(frames.every(frame => frame.duration <= 150));
  assert.deepEqual(buildRollFrames(before, { ...resolved, dice: 7 }), []);
  assert.equal(validRollPresentation({ phase: 'moving', dice: 3, positions: [1, 0], step: 1, previousPosition: '<script>' }, before), false);
  assert.equal(validRollPresentation({ phase: 'moving', dice: 3, positions: [2, 0], step: 1, previousPosition: 0 }, before), false);
});
