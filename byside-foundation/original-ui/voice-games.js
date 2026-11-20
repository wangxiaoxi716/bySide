import * as gomoku from './chess-core.js';
import * as ticTacToe from './tic-tac-toe-core.js';
import * as monopoly from './monopoly-core.js';

export const voiceGameTools = [
  {
    type: 'function', name: 'open_tabletop_game',
    description: '当用户要求和芽团玩五子棋、井字棋或大富翁时，调用此工具打开 AR 棋盘并开始实际游戏。不要仅口头答应。游戏进行中重复选择同一种游戏会保留当前棋局。',
    parameters: { type: 'object', properties: { game: { type: 'string', enum: ['chess', 'tic-tac-toe', 'monopoly'], description: 'chess 是五子棋，tic-tac-toe 是井字棋，monopoly 是大富翁' } }, required: ['game'] },
  },
  {
    type: 'function', name: 'operate_tabletop_game',
    description: '对当前 AR 棋局执行用户明确要求的操作或查询。五子棋和井字棋落子用 place，行列从 1 开始、自上向下和从左向右。五子棋 A 到 O 列对应 1 到 15，中心 H8 是第 8 行第 8 列。井字棋中心是第 2 行第 2 列。位置不明确时先询问，禁止猜测。大富翁使用 roll 掷骰、buy 购买、skip 不买，continue 继续。查询棋局用 status，用户明确要求重来才用 restart，结束棋局用 end。依据工具返回结果说话。',
    parameters: { type: 'object', properties: {
      action: { type: 'string', enum: ['place', 'roll', 'buy', 'skip', 'continue', 'undo', 'restart', 'status', 'end'] },
      row: { type: 'integer', description: '落子行号，从上向下，从 1 开始' },
      column: { type: 'integer', description: '落子列号，从左向右，从 1 开始' },
    }, required: ['action'] },
  },
];

const gameNames = { chess: '五子棋', 'tic-tac-toe': '井字棋', monopoly: '大富翁' };
const positionName = (kind, index) => kind === 'chess'
  ? `${String.fromCharCode(65 + index % 15)}${Math.floor(index / 15) + 1}`
  : `第${Math.floor(index / 3) + 1}行第${index % 3 + 1}列`;

/** Voice-controlled games use the same rule functions as the existing game pages. */
export function createVoiceGameController({ onChange = () => {}, random = Math.random } = {}) {
  let kind = null, game = null, lastCard = null, lastRoll = null, speech = '';
  let revision = 0;

  function snapshot() {
    if (!kind || !game) return null;
    return { kind, game: structuredClone(game), mode: kind === 'monopoly' ? 'solo' : 'pet', speech, lastCard, lastRoll, voiceControlled: true };
  }
  function publish() { revision++; onChange(kind, snapshot()); }
  function clear() {
    kind = null; game = null; lastCard = null; lastRoll = null; speech = '';
    publish();
  }
  function discard() { revision++; kind = null; game = null; lastCard = null; lastRoll = null; speech = ''; }

  function status() {
    if (!game) return { ok: false, message: '还没有开始游戏，请先选择五子棋、井字棋或大富翁。' };
    if (kind === 'monopoly') {
      const pendingTile = game.pending?.type === 'property' ? monopoly.BOARD[game.pending.tileIndex] : null;
      return {
        ok: true, game: gameNames[kind], round: game.round, phase: game.phase,
        currentPlayer: game.players[game.turn].name, players: game.players.map(player => ({ name: player.name, money: player.money, position: monopoly.BOARD[player.position].name })),
        dice: game.dice, pendingProperty: pendingTile ? { name: pendingTile.name, price: pendingTile.price, rent: pendingTile.rent } : null,
        lastCard, lastRoll, recentEvents: game.history.slice(-8), result: game.result,
        nextAction: game.phase === 'decision' ? '询问用户购买还是跳过' : game.phase === 'ended' ? '本局结束，可以重新开始' : '轮到用户掷骰子',
      };
    }
    return {
      ok: true, game: gameNames[kind], size: kind === 'chess' ? 15 : 3,
      board: game.board, moveCount: game.moves.length, moves: game.moves.slice(-20).map(move => ({ player: move.player === 1 ? '你' : '芽团', position: positionName(kind, move.index) })),
      winner: game.winner === 1 ? '你' : game.winner === 2 ? '芽团' : null,
      draw: game.draw, currentPlayer: game.winner || game.draw ? null : game.turn === 1 ? '你' : '芽团',
      coordinates: kind === 'chess' ? '列 A 至 O 从左向右，行 1 至 15 从上向下，中心是 H8' : '行和列均从 1 至 3，自上而下、从左到右',
    };
  }

  function start(nextKind) {
    if (!Object.hasOwn(gameNames, nextKind)) return { ok: false, message: '请明确选择五子棋、井字棋或大富翁。' };
    if (kind === nextKind && game) return { ...status(), message: '这盘游戏正在进行。若要重新开始，请明确说重新开始。' };
    kind = nextKind; lastCard = null; lastRoll = null;
    game = kind === 'chess' ? gomoku.createGame() : kind === 'tic-tac-toe' ? ticTacToe.createGame() : monopoly.createGame('solo');
    speech = kind === 'monopoly' ? '棋盘准备好了，你先掷骰子。' : kind === 'chess' ? '你执黑棋先下，请说列字母和行号，例如 H8。' : '你先下 X，请说第几行第几列。';
    publish();
    return { ...status(), message: speech };
  }

  function place(row, column, suggestion) {
    const rules = kind === 'chess' ? gomoku : ticTacToe;
    const size = kind === 'chess' ? 15 : 3;
    if (!Number.isInteger(row) || !Number.isInteger(column) || row < 1 || column < 1 || row > size || column > size) {
      return { ...status(), ok: false, message: `请说清楚 1 到 ${size} 范围内的行和列。` };
    }
    if (game.winner || game.draw) return { ...status(), ok: false, message: '这盘已经结束，可以说重新开始。' };
    if (game.turn !== 1) return { ...status(), ok: false, message: '现在还没有轮到你。' };
    const index = (row - 1) * size + column - 1;
    const moved = rules.playMove(game, index);
    if (moved === game) return { ...status(), ok: false, message: `${positionName(kind, index)}已经有棋子，请换一个位置。` };
    game = moved;
    const userPosition = positionName(kind, index);
    let assistantPosition = null;
    if (!game.winner && !game.draw) {
      const suggested = Number.isInteger(suggestion?.index) && suggestion.index>=0 && suggestion.index<game.board.length
        && game.board[suggestion.index]===0 ? suggestion.index : null;
      let reply=suggested, next=reply===null?game:rules.playMove(game,reply);
      if(next===game){reply=rules.chooseMove(game,{level:'gentle'});if(Number.isInteger(reply))next=rules.playMove(game,reply);}
      if(next!==game){game=next;assistantPosition=positionName(kind,reply);}
    }
    speech = game.winner ? (game.winner === 1 ? '你赢啦！' : '这次我连成了，谢谢一起下棋。') : game.draw ? '这一盘平局啦。' : `你下在${userPosition}，我下在${assistantPosition}。轮到你了。`;
    if(typeof suggestion?.feedback==='string'&&suggestion.feedback.trim())speech=`${suggestion.feedback.trim().slice(0,60)} ${speech}`;
    publish();
    return { ...status(), userMove: userPosition, assistantMove: assistantPosition, message: speech };
  }

  function rememberCard() {
    if (game.pending?.type === 'property') {
      const tile = monopoly.BOARD[game.pending.tileIndex];
      lastCard = { type: 'property', title: tile.name, description: `售价 ${tile.price}，租金 ${tile.rent} 小叶币。` };
    } else if (game.pending?.type === 'event') {
      const card = monopoly.EVENT_CARDS[game.pending.eventIndex];
      lastCard = { type: 'event', title: card.title, description: `${card.description} ${card.amount > 0 ? '+' : ''}${card.amount} 小叶币。` };
    }
  }
  function rollCurrentPlayer() {
    const player = game.players[game.turn].name;
    game = monopoly.rollDice(game, random);
    lastRoll = { player, dice: game.dice };
    rememberCard();
  }
  function finishMonopolyTurn() {
    if (game.phase === 'event') game = monopoly.acknowledgeEvent(game);
    if (game.phase === 'turn-end') game = monopoly.endTurn(game);
    while (game.phase !== 'ended' && game.players[game.turn].kind === 'bot') {
      if (game.phase === 'roll') rollCurrentPlayer();
      else if (game.phase === 'decision') game = monopoly.decideProperty(game, monopoly.shouldBotBuy(game));
      else if (game.phase === 'event') game = monopoly.acknowledgeEvent(game);
      else if (game.phase === 'turn-end') game = monopoly.endTurn(game);
      else break;
    }
  }
  function monopolyAction(action) {
    if (game.phase === 'ended') return { ...status(), ok: false, message: '这局已经结束，可以说重新开始。' };
    if (game.players[game.turn].kind !== 'human') return { ...status(), ok: false, message: '芽团正在行动，请稍等。' };
    if (action === 'roll' && game.phase === 'roll') {
      rollCurrentPlayer();
      if (game.phase !== 'decision') finishMonopolyTurn();
    } else if (['buy', 'skip'].includes(action) && game.phase === 'decision') {
      const next = monopoly.decideProperty(game, action === 'buy');
      if (next === game) return { ...status(), ok: false, message: '当前无法购买这处地产，可以选择跳过。' };
      game = next; finishMonopolyTurn();
    } else if (action === 'continue' && ['event', 'turn-end'].includes(game.phase)) finishMonopolyTurn();
    else return { ...status(), ok: false, message: game.phase === 'decision' ? '请先决定购买或跳过这处地产。' : '请先掷骰子。' };
    speech = game.phase === 'decision' ? `来到${monopoly.BOARD[game.pending.tileIndex].name}，要购买吗？` : game.phase === 'ended' ? '这局旅行结束啦。' : '轮到你继续掷骰子。';
    publish();
    return { ...status(), message: speech };
  }

  function action(input) {
    if (!game) return status();
    if (input.action === 'status') return status();
    if (input.action === 'end') { const name = gameNames[kind]; clear(); return { ok: true, message: `已结束${name}，回到陪伴画面。` }; }
    if (input.action === 'restart') { const nextKind = kind; discard(); return start(nextKind); }
    if (kind === 'monopoly') return monopolyAction(input.action);
    if (input.action === 'place') return place(input.row, input.column);
    if (input.action === 'undo') {
      const previous = (kind === 'chess' ? gomoku : ticTacToe).undoRound(game);
      if (previous === game) return { ...status(), ok: false, message: '当前没有可以撤销的落子。' };
      game = previous; speech = '已经退回你上一手之前，轮到你重新落子。'; publish();
      return { ...status(), message: speech };
    }
    return { ...status(), ok: false, message: '请说出要下的位置，也可以查询棋局、悔棋或重新开始。' };
  }

  function handleTool(item) {
    let input;
    try { input = JSON.parse(item.arguments); } catch { return { ok: false, message: '操作参数不完整，请再说一次。' }; }
    if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, message: '操作参数无效，请再说一次。' };
    if (item.name === 'open_tabletop_game') return start(input.game);
    if (item.name === 'operate_tabletop_game') return action(input);
    return { ok: false, message: '这个游戏操作暂不可用。' };
  }
  return { handleTool, snapshot, clear, discard, isActive: () => Boolean(game), revision:()=>revision,
    placePhysical(row,column,suggestion){return kind==='chess'||kind==='tic-tac-toe'?place(row,column,suggestion):status();} };
}
