import { BOARD, EVENT_CARDS, MAX_ROUNDS, PASS_BONUS, START_BALANCE, createGame, scorePlayers, rollDice, decideProperty, acknowledgeEvent, endTurn, shouldBotBuy } from './monopoly-core.js';
import { icon, esc } from './stage.js';

const $ = selector => document.querySelector(selector);
const diceFaces = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const positions = [[5,1],[5,2],[5,3],[5,4],[5,5],[4,5],[3,5],[2,5],[1,5],[1,4],[1,3],[1,2],[1,1],[2,1],[3,1],[4,1]];
const art = { property: 'assets/monopoly/property-card.png', event: 'assets/monopoly/event-card.png' };
const tileArt = [
  '00-start', '01-mushroom', '02-mail', '03-bakery',
  '04-rest', '05-post', '06-gift', '07-tea',
  '08-festival', '09-bookshop', '10-clover', '11-inn',
  '12-picnic', '13-farm', '14-treasure', '15-greenhouse',
].map(name => `assets/monopoly/tiles/${name}.jpg`);
let game = createGame(), botTimer = null, epoch = 0, lastCard = null, resultShown = false, infoAction = null;

document.querySelectorAll('[data-icon]').forEach(element => { element.innerHTML = icon(element.dataset.icon, 20); });
const tileElements = BOARD.map((tile, index) => {
  const element = document.createElement('div');
  element.className = 'mono-tile';
  element.dataset.kind = tile.type;
  if (tile.group) element.dataset.group = tile.group;
  element.style.gridRow = positions[index][0];
  element.style.gridColumn = positions[index][1];
  element.setAttribute('role', 'listitem');
  $('#monopoly-board').append(element);
  return element;
});

function humanTurn() { return game.players[game.turn].kind === 'human'; }
function cancelBot() { epoch++; clearTimeout(botTimer); botTimer = null; }
function isNewGame() { return game.round === 1 && game.turn === 0 && game.dice === null && game.owners.every(owner => owner === null); }
function currency(value) { return Number(value).toLocaleString('zh-CN'); }

function renderBoard() {
  tileElements.forEach((element, index) => {
    const tile = BOARD[index], owner = game.owners[index];
    const playersHere = game.players.map((player, playerIndex) => player.position === index ? playerIndex : null).filter(value => value !== null);
    const ownerText = owner === null ? '' : `${game.players[owner].name}的地产`;
    const detail = tile.type === 'property' ? `${tile.price} · 租 ${tile.rent}` : tile.detail || (tile.type === 'event' ? '抽取事件卡' : '');
    const playersText = playersHere.map(playerIndex => game.players[playerIndex].name).join('、');
    element.setAttribute('aria-label', `${tile.name}，${detail}${ownerText ? `，${ownerText}` : ''}${playersText ? `，${playersText}在这里` : ''}`);
    element.innerHTML = `<img class="mono-tile-image" src="${tileArt[index]}" alt="" width="360" height="360"><div class="mono-tile-info"><strong>${esc(tile.name)}</strong><small>${esc(detail)}</small>${owner === null ? '' : `<span class="mono-owner owner-${owner}">${esc(game.players[owner].name)}的地产</span>`}</div><div class="mono-tokens" aria-hidden="true">${playersHere.map(playerIndex => `<span class="mono-token token-${playerIndex}">${playerIndex === 0 ? '我' : game.mode === 'solo' ? '芽' : '友'}</span>`).join('')}</div>`;
  });
}

function renderPlayers() {
  const scores = scorePlayers(game);
  $('#player-list').innerHTML = game.players.map((player, index) => {
    const count = game.owners.filter(owner => owner === index).length;
    return `<div class="mono-player${game.turn === index && game.phase !== 'ended' ? ' is-active' : ''}"><span class="mono-player-avatar">${index === 0 ? '我' : game.mode === 'solo' ? '芽' : '友'}</span><div><strong>${esc(player.name)}${game.turn === index && game.phase !== 'ended' ? ' · 当前回合' : ''}</strong><small>地产 ${count} 处 · 总资产 ${currency(scores[index])}</small></div><div class="mono-player-money">${currency(player.money)}<small>小叶币</small></div></div>`;
  }).join('');
}

function renderPreview() {
  const preview = $('#card-preview');
  if (!lastCard) {
    preview.style.backgroundImage = `url("${art.event}")`;
    preview.querySelector('strong').textContent = '下一张，会遇见什么？';
    $('#preview-caption').textContent = '购买地产和触发事件时，卡片会在这里出现。';
    return;
  }
  preview.style.backgroundImage = `url("${art[lastCard.type]}"), url("${art.event}")`;
  preview.querySelector('strong').textContent = lastCard.title;
  $('#preview-caption').textContent = lastCard.description;
}

function render() {
  const player = game.players[game.turn], isHuman = humanTurn(), ended = game.phase === 'ended';
  $('#round-label').textContent = `第 ${game.round} / ${MAX_ROUNDS} 轮`;
  document.querySelectorAll('[data-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === game.mode)));
  $('#turn-title').textContent = ended ? '小镇旅行结束啦' : `轮到${player.name}出发`;
  const description = ended ? '谢谢一起走过这座小镇。' : game.phase === 'roll'
    ? isHuman ? '准备好了吗？掷骰子，看看下一站。' : '芽团正在想一想，准备出发。'
    : game.phase === 'decision' ? isHuman ? '遇到一处新地产，看看要不要买。' : '芽团正在考虑这处地产。'
      : game.phase === 'event' ? isHuman ? '打开来信，看看发生了什么。' : '芽团收到了一封小镇来信。'
        : isHuman ? '这一步完成啦，可以结束回合。' : '芽团这一步走完啦。';
  $('#turn-detail').textContent = description;
  $('#dice-display').textContent = game.dice ? diceFaces[game.dice - 1] : '✦';
  $('#dice-display').setAttribute('aria-label', game.dice ? `掷出 ${game.dice} 点` : '还未掷骰子');
  $('#roll-button').hidden = game.phase !== 'roll' || !isHuman;
  $('#next-button').hidden = game.phase !== 'turn-end' || !isHuman;
  $('#board-status').textContent = ended ? (game.result.winner === null ? '平分秋色，刚刚好。' : `${game.players[game.result.winner].name}赢得了这场旅行。`)
    : !isHuman ? '芽团正在行动…' : game.phase === 'decision' || game.phase === 'event' ? '请先查看卡片。' : '';
  renderBoard(); renderPlayers(); renderPreview();
  $('#game-log').innerHTML = [...game.history].reverse().slice(0, 8).map(message => `<li>${esc(message)}</li>`).join('');
}

function cardFromPending(state) {
  if (!state.pending) return null;
  if (state.pending.type === 'property') {
    const tile = BOARD[state.pending.tileIndex];
    return { type: 'property', title: tile.name, description: `地产价格 ${tile.price}，租金 ${tile.rent} 小叶币。` };
  }
  const card = EVENT_CARDS[state.pending.eventIndex];
  return { type: 'event', title: card.title, description: `${card.description} ${card.amount > 0 ? '+' : ''}${card.amount} 小叶币。` };
}

function showPendingCard() {
  if (!humanTurn() || !game.pending || $('#card-dialog').open) return;
  const player = game.players[game.turn], primary = $('#card-primary'), secondary = $('#card-secondary');
  const isProperty = game.pending.type === 'property';
  $('#card-art').style.backgroundImage = `url("${art[game.pending.type]}"), url("${art.event}")`;
  $('#card-kicker').textContent = isProperty ? 'PLACE CARD / 地产卡' : 'CHANCE CARD / 事件卡';
  if (isProperty) {
    const tile = BOARD[game.pending.tileIndex];
    $('#card-title').textContent = tile.name;
    $('#card-description').textContent = '一处还没有主人的小地方，要把它收进你的旅程吗？';
    $('#card-numbers').innerHTML = `<span>购买 ${currency(tile.price)} 小叶币</span><span>租金 ${currency(tile.rent)} 小叶币</span>`;
    $('#card-note').textContent = player.money < tile.price ? '你的现金不足，可以选择暂不购买。' : `你现在有 ${currency(player.money)} 小叶币。`;
    primary.textContent = '购买地产'; primary.disabled = player.money < tile.price;
    secondary.hidden = false; secondary.textContent = '暂不购买';
  } else {
    const card = EVENT_CARDS[game.pending.eventIndex];
    $('#card-title').textContent = card.title; $('#card-description').textContent = card.description;
    $('#card-numbers').innerHTML = `<span>${card.amount > 0 ? '+' : ''}${currency(card.amount)} 小叶币</span>`;
    $('#card-note').textContent = game.result ? '现金不足以支付全部费用，本局将在确认后结束。' : `当前现金：${currency(player.money)} 小叶币。`;
    primary.textContent = game.result ? '查看结果' : '收下这封信'; primary.disabled = false;
    secondary.hidden = true;
  }
  $('#card-dialog').showModal();
}

function showResult() {
  if (resultShown || game.phase !== 'ended' || !game.result) return;
  resultShown = true;
  const { winner, scores, reason } = game.result;
  const title = winner === null ? '平分秋色，刚刚好。' : `${game.players[winner].name}赢得了旅行！`;
  const reasonText = reason === 'bankruptcy' ? '有一位旅伴无法支付费用，本局提前结束。' : `${MAX_ROUNDS} 轮结束，按照现金和地产原价结算。`;
  openInfo('旅程结束', title, `<p>${esc(reasonText)}</p><p>${esc(game.players[0].name)}：${currency(scores[0])} 小叶币　·　${esc(game.players[1].name)}：${currency(scores[1])} 小叶币</p><p>谢谢一起走过这座小镇。</p>`, '再来一局', () => reset(game.mode), true);
}

function apply(next) {
  if (next === game) return;
  game = next;
  const card = cardFromPending(game);
  if (card) lastCard = card;
  render();
  if (game.pending && humanTurn()) showPendingCard();
  if (game.phase === 'ended') showResult();
  scheduleBot();
}

function scheduleBot() {
  if (botTimer || game.phase === 'ended' || humanTurn()) return;
  const currentEpoch = epoch;
  botTimer = setTimeout(() => {
    botTimer = null;
    if (currentEpoch !== epoch || humanTurn()) return;
    if (game.phase === 'roll') apply(rollDice(game));
    else if (game.phase === 'decision') apply(decideProperty(game, shouldBotBuy(game)));
    else if (game.phase === 'event') apply(acknowledgeEvent(game));
    else if (game.phase === 'turn-end') apply(endTurn(game));
  }, game.phase === 'roll' ? 800 : game.phase === 'event' ? 1400 : 700);
}

function reset(mode) {
  cancelBot(); game = createGame(mode); lastCard = null; resultShown = false;
  if ($('#card-dialog').open) $('#card-dialog').close();
  render();
}

function openInfo(kicker, title, body, confirmLabel, action = null, showCancel = false) {
  if ($('#info-dialog').open) $('#info-dialog').close();
  $('#info-kicker').textContent = kicker; $('#info-title').textContent = title;
  $('#info-content').innerHTML = body;
  $('#info-confirm').textContent = confirmLabel; $('#info-cancel').hidden = !showCancel;
  $('#info-cancel').textContent = action && game.phase === 'ended' ? '稍后' : '取消';
  infoAction = action;
  $('#info-dialog').showModal();
}

function askReset(mode) {
  if (isNewGame()) { reset(mode); return; }
  openInfo('新的一局', '重新出发吗？', '<p>当前棋局会结束，地产和小叶币都会重新开始。</p>', '开始新的一局', () => reset(mode), true);
}

$('#roll-button').addEventListener('click', () => { if (humanTurn()) apply(rollDice(game)); });
$('#next-button').addEventListener('click', () => { if (humanTurn()) apply(endTurn(game)); });
$('#card-primary').addEventListener('click', () => {
  if (!humanTurn() || !game.pending) return;
  const next = game.pending.type === 'property' ? decideProperty(game, true) : acknowledgeEvent(game);
  if (next === game) return;
  $('#card-dialog').close(); apply(next);
});
$('#card-secondary').addEventListener('click', () => {
  if (!humanTurn() || game.pending?.type !== 'property') return;
  const next = decideProperty(game, false);
  $('#card-dialog').close(); apply(next);
});
$('#card-dialog').addEventListener('cancel', event => event.preventDefault());
$('#restart-button').addEventListener('click', () => askReset(game.mode));
document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => {
  if (button.dataset.mode !== game.mode) askReset(button.dataset.mode);
}));
$('#rules-open').addEventListener('click', () => openInfo('游戏规则', '在小镇，慢慢玩。', `<p>两位旅伴各有 ${START_BALANCE} 小叶币，你先掷骰子。每回合按点数前进，经过或停在出发点获得 ${PASS_BONUS}。</p><ul><li>到无主地产时，可以选择购买或跳过；到对方地产时支付标注的租金。</li><li>惊喜来信会带来收入或支出；小镇庆典要支付 80 小叶币。</li><li>现金不足以支付费用时破产，对手获胜。没有房屋、升级或抵押。</li><li>完成 ${MAX_ROUNDS} 轮后，按现金加已购地产原价比较总资产；相同则平局。</li></ul><p>「和芽团对战」由本地程序自动落子；「两人同屏」轮流操作。游戏不使用真实货币，也不会保存进度。</p>`, '知道啦'));
$('#info-cancel').addEventListener('click', () => { infoAction = null; $('#info-dialog').close(); });
$('#info-confirm').addEventListener('click', () => { const action = infoAction; infoAction = null; $('#info-dialog').close(); action?.(); });
$('#info-dialog').addEventListener('cancel', () => { infoAction = null; });
addEventListener('pagehide', () => cancelBot());
render();
