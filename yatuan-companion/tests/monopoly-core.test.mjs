import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { TILE_ART, DICE_ART, PLAYER_AVATARS, monopolyAvatar, monopolyOwnerBadge } from '../dist/monopoly-assets.js';
import {
  BOARD, EVENT_CARDS, MAX_ROUNDS, PASS_BONUS, START_BALANCE,
  createGame, scorePlayers, rollDice, decideProperty, acknowledgeEvent, endTurn, shouldBotBuy,
} from '../dist/monopoly-core.js';

const sequence = (...values) => () => values.shift() ?? 0;
const freeze = state => {
  state.players.forEach(Object.freeze);
  Object.freeze(state.players); Object.freeze(state.owners); Object.freeze(state.history);
  if (state.pending) Object.freeze(state.pending);
  return Object.freeze(state);
};

test('new games have independent boards and the requested opponent mode', () => {
  const solo = createGame(), local = createGame('local');
  assert.equal(BOARD.length, 16);
  assert.equal(solo.players[0].money, START_BALANCE);
  assert.equal(solo.players[1].kind, 'bot');
  assert.equal(local.players[1].kind, 'human');
  assert.equal(solo.phase, 'roll');
  solo.owners[1] = 0;
  assert.equal(local.owners[1], null);
});

test('rolling and buying a property are immutable and prevent duplicate actions', () => {
  const initial = freeze(createGame());
  const landed = freeze(rollDice(initial, () => 0));
  assert.equal(initial.players[0].position, 0);
  assert.equal(landed.players[0].position, 1);
  assert.equal(landed.phase, 'decision');
  assert.equal(rollDice(landed, () => 0), landed);
  const bought = decideProperty(landed, true);
  assert.equal(landed.owners[1], null);
  assert.equal(bought.owners[1], 0);
  assert.equal(bought.players[0].money, START_BALANCE - BOARD[1].price);
  assert.equal(bought.phase, 'turn-end');
  assert.equal(decideProperty(bought, true), bought);
});

test('a player may decline a property, but cannot buy without enough money', () => {
  const base = createGame(); base.players[0].money = BOARD[1].price - 1;
  const landed = rollDice(base, () => 0);
  assert.equal(decideProperty(landed, true), landed);
  const skipped = decideProperty(landed, false);
  assert.equal(skipped.owners[1], null);
  assert.equal(skipped.players[0].money, BOARD[1].price - 1);
  assert.equal(skipped.phase, 'turn-end');
});

test('rent transfers the correct amount to the property owner', () => {
  const base = createGame(); base.owners[1] = 1;
  const result = rollDice(freeze(base), () => 0);
  assert.equal(result.players[0].money, START_BALANCE - BOARD[1].rent);
  assert.equal(result.players[1].money, START_BALANCE + BOARD[1].rent);
  assert.equal(result.phase, 'turn-end');
});

test('an unaffordable rent transfers only available funds and ends in bankruptcy', () => {
  const base = createGame(); base.owners[1] = 1; base.players[0].money = 10;
  const result = rollDice(base, () => 0);
  assert.equal(result.players[0].money, 0);
  assert.equal(result.players[1].money, START_BALANCE + 10);
  assert.equal(result.result.winner, 1);
  assert.equal(result.result.reason, 'bankruptcy');
  assert.equal(result.phase, 'ended');
  assert.equal(rollDice(result, () => 0), result);
});

test('landing on your own property does not transfer money', () => {
  const base = createGame(); base.owners[1] = 0;
  const result = rollDice(base, () => 0);
  assert.equal(result.players[0].money, START_BALANCE);
  assert.equal(result.phase, 'turn-end');
});

test('passing or landing on the start grants exactly one bonus', () => {
  for (const start of [14, 15]) {
    const base = createGame(); base.players[0].position = start;
    const result = rollDice(base, () => .2);
    assert.equal(result.players[0].money, START_BALANCE + PASS_BONUS);
  }
});

test('event cards apply gains, retain their card until acknowledged, and advance normally', () => {
  const result = rollDice(createGame(), sequence(.2, 0));
  assert.equal(result.phase, 'event');
  assert.equal(result.pending.eventIndex, 0);
  assert.equal(result.players[0].money, START_BALANCE + EVENT_CARDS[0].amount);
  assert.equal(endTurn(result), result);
  const acknowledged = acknowledgeEvent(result);
  assert.equal(acknowledged.phase, 'turn-end');
  assert.equal(acknowledged.pending, null);
});

test('an unaffordable event expense shows its card and then ends the game', () => {
  const base = createGame(); base.players[0].money = 10;
  const result = rollDice(base, sequence(.2, .5));
  assert.equal(result.phase, 'event');
  assert.equal(result.players[0].money, 0);
  assert.equal(result.result.reason, 'bankruptcy');
  assert.equal(result.result.winner, 1);
  assert.equal(acknowledgeEvent(result).phase, 'ended');
});

test('celebration expenses can cause bankruptcy without a negative balance', () => {
  const base = createGame(); base.players[0].position = 7; base.players[0].money = 70;
  const result = rollDice(base, () => 0);
  assert.equal(result.players[0].money, 0);
  assert.equal(result.result.winner, 1);
  assert.equal(result.phase, 'ended');
});

test('turns alternate, and the round increments only after both players move', () => {
  const first = decideProperty(rollDice(createGame(), () => 0), false);
  const second = endTurn(first);
  assert.equal(second.turn, 1);
  assert.equal(second.round, 1);
  const third = endTurn(decideProperty(rollDice(second, () => 0), false));
  assert.equal(third.turn, 0);
  assert.equal(third.round, 2);
});

test('after twelve rounds the game compares cash plus property values', () => {
  const base = createGame('local');
  base.round = MAX_ROUNDS; base.turn = 1; base.phase = 'turn-end';
  base.players[0].money = 200; base.players[1].money = 250;
  base.owners[1] = 0;
  assert.deepEqual(scorePlayers(base), [320, 250]);
  const result = endTurn(base);
  assert.equal(result.phase, 'ended');
  assert.equal(result.result.reason, 'round-limit');
  assert.equal(result.result.winner, 0);
  assert.deepEqual(result.result.scores, [320, 250]);
});

test('equal final assets result in a draw', () => {
  const base = createGame();
  base.round = MAX_ROUNDS; base.turn = 1; base.phase = 'turn-end';
  const result = endTurn(base);
  assert.equal(result.result.winner, null);
  assert.deepEqual(result.result.scores, [START_BALANCE, START_BALANCE]);
});

test('bot buys only when it can keep its cash reserve', () => {
  const base = createGame(); base.turn = 1; base.players[1].money = 220;
  const landed = rollDice(base, () => 0);
  assert.equal(shouldBotBuy(landed), true);
  const poor = createGame(); poor.turn = 1; poor.players[1].money = 219;
  assert.equal(shouldBotBuy(rollDice(poor, () => 0)), false);
  const human = rollDice(createGame('local'), () => 0);
  assert.equal(shouldBotBuy(human), false);
});

test('all phases reject inappropriate transitions', () => {
  const game = createGame();
  assert.equal(decideProperty(game, true), game);
  assert.equal(acknowledgeEvent(game), game);
  assert.equal(endTurn(game), game);
  assert.equal(rollDice(null), null);
});

test('every board space and every die face has its own loadable image', async () => {
  assert.equal(TILE_ART.length, BOARD.length);
  assert.equal(new Set(TILE_ART).size, BOARD.length);
  assert.equal(DICE_ART.length, 6);
  assert.equal(new Set(DICE_ART).size, 6);
  for (const path of [...TILE_ART, ...DICE_ART]) {
    const bytes = await readFile(new URL(`../dist/${path}`, import.meta.url));
    assert.ok(bytes.length > 1000, `${path} is empty or incomplete`);
    assert.equal(bytes[0], 0xff, `${path} must be a JPEG`);
    assert.equal(bytes[1], 0xd8, `${path} must be a JPEG`);
  }
});

test('each dice outcome selects the corresponding face image', () => {
  for (let value = 1; value <= 6; value++) {
    const state = rollDice(createGame(), () => (value - 0.5) / 6);
    assert.equal(state.dice, value);
    assert.equal(DICE_ART[state.dice - 1], `assets/monopoly/dice/die-${value}.jpg`);
  }
});

test('player and Yatuan portraits load and preserve the identity of a local human opponent', async () => {
  assert.equal(monopolyAvatar('solo', 0), PLAYER_AVATARS.player);
  assert.equal(monopolyAvatar('solo', 1), PLAYER_AVATARS.yatuan);
  assert.equal(monopolyAvatar('local', 0), PLAYER_AVATARS.player);
  assert.equal(monopolyAvatar('local', 1), PLAYER_AVATARS.partner);
  assert.notEqual(PLAYER_AVATARS.player, PLAYER_AVATARS.partner);
  for (const path of Object.values(PLAYER_AVATARS)) {
    const bytes = await readFile(new URL(`../dist/${path}`, import.meta.url));
    assert.ok(bytes.length > 1000, `${path} is missing or incomplete`);
    assert.deepEqual([...bytes.subarray(0, 2)], [0xff, 0xd8], `${path} must be a JPEG`);
  }
});

test('owner badges use the appropriate portrait and never appear for an unowned space', () => {
  assert.match(monopolyOwnerBadge('local', 0), /mono-owner-badge owner-0.*avatars\/player\.jpg/);
  assert.match(monopolyOwnerBadge('local', 1), /mono-owner-badge owner-1.*avatars\/partner\.jpg/);
  assert.match(monopolyOwnerBadge('solo', 1, true), /gar-owner-badge owner-1.*avatars\/yatuan\.jpg/);
  assert.equal(monopolyOwnerBadge('local', null), '');
  assert.equal(monopolyOwnerBadge('local', undefined), '');
});
