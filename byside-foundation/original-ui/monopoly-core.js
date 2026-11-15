// A small local board game. State transitions are deterministic with an injected RNG.
export const START_BALANCE = 1000;
export const PASS_BONUS = 180;
export const MAX_ROUNDS = 12;
export const BOARD = Object.freeze([
  { type: 'start', name: '出发', detail: '经过领取 180' },
  { type: 'property', name: '蘑菇小站', price: 120, rent: 24, group: 'forest' },
  { type: 'event', name: '惊喜来信' },
  { type: 'property', name: '小叶面包房', price: 140, rent: 28, group: 'forest' },
  { type: 'rest', name: '歇脚小站', detail: '好好休息' },
  { type: 'property', name: '花园邮局', price: 160, rent: 32, group: 'garden' },
  { type: 'event', name: '惊喜来信' },
  { type: 'property', name: '茶香小屋', price: 180, rent: 36, group: 'garden' },
  { type: 'tax', name: '小镇庆典', amount: 80, detail: '缴纳 80' },
  { type: 'property', name: '云朵书店', price: 200, rent: 40, group: 'sky' },
  { type: 'event', name: '惊喜来信' },
  { type: 'property', name: '山丘旅店', price: 220, rent: 44, group: 'sky' },
  { type: 'rest', name: '草地野餐', detail: '慢慢歇一会' },
  { type: 'property', name: '向日葵农场', price: 240, rent: 48, group: 'sun' },
  { type: 'event', name: '惊喜来信' },
  { type: 'property', name: '暖阳花房', price: 260, rent: 52, group: 'sun' },
].map(tile => Object.freeze(tile)));
export const EVENT_CARDS = Object.freeze([
  { title: '花园的好收成', description: '你分享了新鲜花束，收到一份谢礼。', amount: 120 },
  { title: '捡到幸运四叶草', description: '好运路过，给你留下小小惊喜。', amount: 80 },
  { title: '周末小市集', description: '亲手做的点心卖得很好。', amount: 100 },
  { title: '一封温暖来信', description: '朋友寄来一份心意。', amount: 60 },
  { title: '屋顶需要修补', description: '雨前把屋顶整理好，安心又温暖。', amount: -100 },
  { title: '送出一束花', description: '为朋友准备一束花，花费一些零钱。', amount: -60 },
  { title: '单车小保养', description: '修好了小车，下一段路继续出发。', amount: -80 },
  { title: '一起吃下午茶', description: '请朋友喝茶，收获一段快乐时光。', amount: -40 },
].map(card => Object.freeze(card)));

const randomIndex = (rng, length) => {
  const value = Number(rng());
  return Math.min(length - 1, Math.max(0, Math.floor((Number.isFinite(value) ? value : 0) * length)));
};
const clone = state => ({
  ...state,
  players: state.players.map(player => ({ ...player })),
  owners: state.owners.slice(),
  history: state.history.slice(),
  pending: state.pending ? { ...state.pending } : null,
  result: state.result ? { ...state.result, scores: state.result.scores.slice() } : null,
});
const record = (state, message) => { state.history = [...state.history, message].slice(-35); };

export function createGame(mode = 'solo') {
  const selectedMode = mode === 'local' ? 'local' : 'solo';
  return {
    mode: selectedMode,
    players: [
      { name: '你', kind: 'human', money: START_BALANCE, position: 0 },
      { name: selectedMode === 'solo' ? '芽团' : '伙伴', kind: selectedMode === 'solo' ? 'bot' : 'human', money: START_BALANCE, position: 0 },
    ],
    owners: Array(BOARD.length).fill(null),
    turn: 0, round: 1, phase: 'roll', dice: null, pending: null, result: null,
    history: ['小镇准备好了。你先掷骰子出发吧。'],
  };
}

export function scorePlayers(state) {
  return state.players.map((player, index) => player.money + BOARD.reduce(
    (sum, tile, tileIndex) => sum + (state.owners[tileIndex] === index ? tile.price : 0), 0,
  ));
}

function finish(state, reason, winner) {
  state.result = { reason, winner, scores: scorePlayers(state) };
  state.phase = 'ended';
  if (reason === 'bankruptcy') record(state, `${state.players[1 - winner].name}无法支付费用，${state.players[winner].name}赢得了这场旅行。`);
  else if (winner === null) record(state, '十二轮结束，双方资产相同，平分秋色。');
  else record(state, `十二轮结束，${state.players[winner].name}以更高的资产获胜。`);
}

// The recipient only receives the amount actually paid. An unpaid debt ends the game.
function pay(state, payerIndex, amount, recipientIndex = null) {
  const payer = state.players[payerIndex], paid = Math.min(payer.money, amount);
  payer.money -= paid;
  if (recipientIndex !== null) state.players[recipientIndex].money += paid;
  if (paid < amount) {
    finish(state, 'bankruptcy', 1 - payerIndex);
    return { paid, bankrupt: true };
  }
  return { paid, bankrupt: false };
}

export function rollDice(state, rng = Math.random) {
  if (!state || state.phase !== 'roll' || state.result) return state;
  const next = clone(state), player = next.players[next.turn];
  const dice = randomIndex(rng, 6) + 1;
  const destination = player.position + dice;
  if (destination >= BOARD.length) {
    player.money += PASS_BONUS;
    record(next, `${player.name}经过出发点，获得 ${PASS_BONUS} 小叶币。`);
  }
  player.position = destination % BOARD.length;
  next.dice = dice;
  const tile = BOARD[player.position];
  record(next, `${player.name}掷出 ${dice} 点，来到${tile.name}。`);
  next.phase = 'turn-end';
  if (tile.type === 'property') {
    const owner = next.owners[player.position];
    if (owner === null) {
      next.pending = { type: 'property', tileIndex: player.position };
      next.phase = 'decision';
    } else if (owner === next.turn) {
      record(next, `这里已经是${player.name}的地产。`);
    } else {
      const payment = pay(next, next.turn, tile.rent, owner);
      if (!payment.bankrupt) record(next, `${player.name}向${next.players[owner].name}支付租金 ${payment.paid}。`);
      else record(next, `${player.name}仅能支付租金 ${payment.paid}，仍欠 ${tile.rent - payment.paid}。`);
    }
  } else if (tile.type === 'event') {
    const eventIndex = randomIndex(rng, EVENT_CARDS.length);
    const card = EVENT_CARDS[eventIndex];
    if (card.amount >= 0) {
      player.money += card.amount;
      record(next, `事件「${card.title}」：${player.name}获得 ${card.amount}。`);
    } else {
      const payment = pay(next, next.turn, -card.amount);
      record(next, `事件「${card.title}」：${player.name}支付 ${payment.paid}${payment.bankrupt ? '，余额不足以支付全部费用' : ''}。`);
    }
    next.pending = { type: 'event', eventIndex };
    next.phase = 'event';
  } else if (tile.type === 'tax') {
    const payment = pay(next, next.turn, tile.amount);
    record(next, `${player.name}为小镇庆典支付 ${payment.paid}${payment.bankrupt ? '，余额不足以支付全部费用' : ''}。`);
  } else if (tile.type === 'rest') {
    record(next, `${player.name}在这里歇歇脚，不需要支付费用。`);
  }
  return next;
}

export function decideProperty(state, purchase) {
  if (!state || state.phase !== 'decision' || state.pending?.type !== 'property' || typeof purchase !== 'boolean') return state;
  const tileIndex = state.pending.tileIndex, tile = BOARD[tileIndex], player = state.players[state.turn];
  if (!tile || tile.type !== 'property' || state.owners[tileIndex] !== null || (purchase && player.money < tile.price)) return state;
  const next = clone(state);
  if (purchase) {
    next.players[next.turn].money -= tile.price;
    next.owners[tileIndex] = next.turn;
    record(next, `${player.name}买下${tile.name}，花费 ${tile.price}。`);
  } else record(next, `${player.name}决定暂时不买${tile.name}。`);
  next.pending = null;
  next.phase = 'turn-end';
  return next;
}

export function acknowledgeEvent(state) {
  if (!state || state.phase !== 'event' || state.pending?.type !== 'event') return state;
  const next = clone(state);
  next.pending = null;
  next.phase = next.result ? 'ended' : 'turn-end';
  return next;
}

export function endTurn(state) {
  if (!state || state.phase !== 'turn-end' || state.result) return state;
  const next = clone(state);
  if (next.turn === 1 && next.round >= MAX_ROUNDS) {
    const scores = scorePlayers(next);
    finish(next, 'round-limit', scores[0] === scores[1] ? null : scores[0] > scores[1] ? 0 : 1);
    return next;
  }
  if (next.turn === 1) next.round++;
  next.turn = 1 - next.turn;
  next.phase = 'roll';
  next.dice = null;
  record(next, `轮到${next.players[next.turn].name}出发啦。`);
  return next;
}

export function shouldBotBuy(state) {
  if (!state || state.phase !== 'decision' || state.players[state.turn].kind !== 'bot') return false;
  const tile = BOARD[state.pending?.tileIndex];
  // Keep a modest cash reserve for rent and event costs.
  return Boolean(tile && state.players[state.turn].money >= tile.price + 100);
}
