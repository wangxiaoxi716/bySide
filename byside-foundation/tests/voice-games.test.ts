import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceGameController, voiceGameTools } from '../original-ui/voice-games.js';
import { renderGameProjection } from '../original-ui/game-ar-view.js';

const call = (controller: ReturnType<typeof createVoiceGameController>, name: string, input: object) => controller.handleTool({ name, arguments: JSON.stringify(input) });
const open = (controller: ReturnType<typeof createVoiceGameController>, game: string) => call(controller, 'open_tabletop_game', { game });
const act = (controller: ReturnType<typeof createVoiceGameController>, input: object) => call(controller, 'operate_tabletop_game', input);

test('game tools define valid schemas for the realtime bridge', () => {
  assert.deepEqual(voiceGameTools.map(tool => tool.name), ['open_tabletop_game', 'operate_tabletop_game']);
  for (const tool of voiceGameTools) {
    assert.ok(tool.description.length <= 500);
    assert.equal(tool.parameters.type, 'object');
  }
});

test('voice gomoku uses actual rules, returns both moves and rejects ambiguous or occupied positions', () => {
  const changes: any[] = [];
  const controller = createVoiceGameController({ onChange: (kind, snapshot) => changes.push({ kind, snapshot }) });
  assert.equal(act(controller, { action: 'place', row: 8, column: 8 }).ok, false);
  const started = open(controller, 'chess');
  assert.equal(started.game, '五子棋'); assert.equal(changes.at(-1).snapshot.voiceControlled, true);
  const invalid = act(controller, { action: 'place', row: 8 });
  assert.equal(invalid.ok, false); assert.equal(controller.snapshot()!.game.moves.length, 0);
  const played = act(controller, { action: 'place', row: 8, column: 8 });
  assert.equal(played.userMove, 'H8'); assert.ok(played.assistantMove);
  assert.equal(played.board[112], 1); assert.equal(played.moveCount, 2);
  assert.equal(changes.at(-1).snapshot.game.moves.length, 2);
  const view = renderGameProjection({ game: 'chess', snapshot: controller.snapshot(), connected: true });
  assert.match(view, /语音对局/); assert.match(view, /gar-voice-caption/);
  assert.match(view, />H<\/text>/); assert.equal((view.match(/class="gar-stone /g) || []).length, 2);
  assert.equal(act(controller, { action: 'place', row: 8, column: 8 }).ok, false);
  assert.equal(open(controller, 'chess').moveCount, 2, 'repeating the same game does not reset it');
  assert.equal(act(controller, { action: 'undo' }).moveCount, 0);
  assert.equal(act(controller, { action: 'end' }).ok, true);
  assert.equal(controller.isActive(), false); assert.equal(changes.at(-1).kind, null);
});

test('voice tic-tac-toe alternates legal moves and supports an explicit restart', () => {
  const controller = createVoiceGameController();
  assert.equal(open(controller, 'tic-tac-toe').game, '井字棋');
  const first = act(controller, { action: 'place', row: 2, column: 2 });
  assert.equal(first.userMove, '第2行第2列'); assert.ok(first.assistantMove);
  assert.equal(first.board.filter((cell: number) => cell === 1).length, 1);
  assert.equal(first.board.filter((cell: number) => cell === 2).length, 1);
  assert.equal(act(controller, { action: 'place', row: 4, column: 1 }).ok, false);
  assert.equal(act(controller, { action: 'restart' }).moveCount, 0);
  assert.equal(controller.snapshot()!.game.moves.length, 0);
});

test('voice monopoly uses actual dice, property choices and automatic bot turns', () => {
  const values = [0, 0.5];
  const controller = createVoiceGameController({ random: () => values.shift() ?? 0 });
  assert.equal(open(controller, 'monopoly').game, '大富翁');
  assert.equal(act(controller, { action: 'buy' }).ok, false);
  const rolled = act(controller, { action: 'roll' });
  assert.equal(rolled.pendingProperty.name, '蘑菇小站');
  assert.equal(rolled.pendingProperty.price, 120);
  assert.equal(rolled.dice, 1);
  assert.deepEqual(rolled.lastRoll, { player: '你', dice: 1 });
  assert.equal(act(controller, { action: 'roll' }).ok, false, 'a pending purchase cannot be bypassed by another roll');
  const bought = act(controller, { action: 'buy' });
  assert.equal(bought.players[0].money, 880);
  assert.equal(bought.players[0].position, '蘑菇小站');
  assert.equal(bought.players[1].position, '歇脚小站');
  assert.deepEqual(bought.lastRoll, { player: '芽团', dice: 4 });
  assert.equal(bought.currentPlayer, '你'); assert.equal(bought.round, 2);
  assert.equal(controller.snapshot()!.game.owners[1], 0);
  const view = renderGameProjection({ game: 'monopoly', snapshot: controller.snapshot(), connected: true });
  assert.match(view, /芽团掷出 4 点/); assert.match(view, /die-4\.jpg/);
});

test('invalid and duplicate tool input cannot change a board', () => {
  const controller = createVoiceGameController();
  assert.equal(controller.handleTool({ name: 'open_tabletop_game', arguments: '{' }).ok, false);
  assert.equal(open(controller, 'unknown').ok, false);
  open(controller, 'tic-tac-toe');
  assert.equal(controller.handleTool({ name: 'unknown', arguments: '{}' }).ok, false);
  assert.equal(act(controller, { action: 'place', row: '2', column: 2 }).ok, false);
  assert.equal(controller.snapshot()!.game.moves.length, 0);
});
