import { createGame, playMove, undoRound, chooseMove } from './tic-tac-toe-core.js';
import { createChessSession } from './chess-session.js';
import { characterArt, icon, esc } from './stage.js';
import { installGameProjectionLink } from './game-ar-control.js';

const $ = selector => document.querySelector(selector);
const id = () => crypto.randomUUID();
const roomId = `ttt-${id()}`;
const petBase = { character: 'yatuan', growthStage: 0, flowerCount: 1, flowerStyle: 'cream', mood: 'happy', motion: 'idle' };
const coordinate = index => `第 ${Math.floor(index / 3) + 1} 行第 ${index % 3 + 1} 列`;
const initial = (mode = 'pet', familyControl = 'auto') => ({
  kind: 'tic-tac-toe', gameId: id(), mode, familyControl, game: createGame(),
  speech: '棋盘准备好啦。你先来，我陪你慢慢想。',
  messages: [{ role: 'pet', text: '先从喜欢的格子开始吧。需要时，可以让我给一点提示。' }],
});
let state = initial(), level = 'gentle', selected = null, hint = null, focusIndex = 4;
let botTimer = null, generation = 0, toastTimer = null, confirmAction = null, lastPetStage = -1;
const session = createChessSession({ roomId, owner: true, onCommand: handlePeerCommand });

document.querySelectorAll('[data-icon]').forEach(element => { element.innerHTML = icon(element.dataset.icon, 20); });
$('#projection-open').href = `tic-tac-toe-view.html?view=projection&room=${encodeURIComponent(roomId)}`;
installGameProjectionLink($('#game-ar-open'), { game: 'tic-tac-toe', room: roomId });
$('#family-open').href = `tic-tac-toe-view.html?view=family&room=${encodeURIComponent(roomId)}`;
$('#confirm-move').checked = matchMedia('(max-width: 640px)').matches;

const cells = Array.from({ length: 9 }, (_, index) => {
  const cell = document.createElement('button');
  cell.type = 'button';
  cell.addEventListener('click', () => selectCell(index));
  cell.addEventListener('keydown', event => {
    const row = Math.floor(index / 3), col = index % 3;
    const targets = {
      ArrowLeft: row * 3 + Math.max(0, col - 1), ArrowRight: row * 3 + Math.min(2, col + 1),
      ArrowUp: Math.max(0, row - 1) * 3 + col, ArrowDown: Math.min(2, row + 1) * 3 + col,
      Home: row * 3, End: row * 3 + 2,
    };
    if (!(event.key in targets)) return;
    event.preventDefault(); focusIndex = targets[event.key];
    cells.forEach((item, i) => { item.tabIndex = i === focusIndex ? 0 : -1; });
    cells[focusIndex].focus();
  });
  $('#ttt-board').append(cell);
  return cell;
});
function cancelPending() {
  generation++;
  clearTimeout(botTimer);
  botTimer = null;
}
function canPlay() {
  return state.game.turn === 1 && !state.game.winner && !state.game.draw;
}
function addMessage(role, text) {
  state.messages = [...state.messages, { role, text: String(text).slice(0, 140) }].slice(-35);
}
function toast(text) {
  clearTimeout(toastTimer);
  $('#chess-toast').textContent = text;
  $('#chess-toast').hidden = false;
  toastTimer = setTimeout(() => { $('#chess-toast').hidden = true; }, 3500);
}
function publish() {
  render();
  session.publish(state);
}
function render() {
  const game = state.game, family = state.mode === 'family', available = canPlay();
  const opponent = family ? '家人' : '芽团', last = game.moves.at(-1);
  document.querySelectorAll('[data-mode]').forEach(button => {
    const active = button.dataset.mode === state.mode;
    button.classList.toggle('selected', active);
    button.setAttribute('aria-pressed', String(active));
  });
  $('#family-banner').hidden = !family;
  $('#family-card').hidden = !family;
  $('#family-auto').checked = state.familyControl === 'auto';
  $('#family-status').textContent = game.winner || game.draw ? '本局已结束' : state.familyControl === 'auto' ? '模拟对手 · 自动落子' : '双窗口演示 · 家人端执 O';
  $('#ttt-level').disabled = family;
  $('#opponent-name').textContent = `${opponent} · O`;
  $('#opponent-subtitle').textContent = family ? '后手 · 本机演示' : `后手 · ${level === 'gentle' ? '轻松陪练' : '认真对弈'}`;
  const label = game.winner ? (game.winner === 1 ? '你连成三个啦！' : `${opponent}连成三个啦`)
    : game.draw ? '这一盘，平分秋色' : game.turn === 1 ? '轮到你落子'
      : family && state.familyControl === 'manual' ? '等待家人端落子' : `${opponent}在想下一步…`;
  $('#turn-label').textContent = label;
  $('#move-count').textContent = game.winner || game.draw ? `共 ${game.moves.length} 手 · 谢谢一起下棋` : `第 ${game.moves.length + 1} 手 · 慢慢想，不着急`;
  $('#last-move').textContent = last ? `上一手 ${last.player === 1 ? '你' : opponent} · ${coordinate(last.index)}` : '第一步，放在哪里都好。';
  $('#pet-speech').textContent = state.speech;
  const petStage = game.winner || game.draw ? 3 : 0;
  if (lastPetStage !== petStage) {
    $('#chess-pet').innerHTML = characterArt({ ...petBase, growthStage: petStage });
    lastPetStage = petStage;
  }
  $('#chat-fine').textContent = family && state.familyControl === 'manual'
    ? '消息只在同一浏览器的两个窗口同步，未连接真实异地家人。'
    : family ? '家人回应与落子为本机模拟。' : '芽团根据棋局给出本地预设回应，不调用 AI 服务。';
  const messages = $('#chess-messages');
  const messageKey = JSON.stringify(state.messages);
  if (messages.dataset.rendered !== messageKey) {
    messages.innerHTML = state.messages.map(message => `<div class="chess-message ${message.role === 'user' ? 'user' : ''}"><small>${message.role === 'user' ? '你' : message.role === 'family' ? '家人 · 本机演示' : '芽团'}</small>${esc(message.text)}</div>`).join('');
    messages.dataset.rendered = messageKey;
    messages.scrollTop = messages.scrollHeight;
  }
  cells.forEach((cell, index) => {
    const value = game.board[index], lastMove = last?.index === index;
    cell.className = `ttt-cell${lastMove ? ' is-latest' : ''}${game.winningLine.includes(index) ? ' is-winning' : ''}${hint === index ? ' is-hinted' : ''}${selected === index ? ' is-selected' : ''}`;
    cell.dataset.value = value;
    cell.disabled = !available;
    cell.setAttribute('aria-disabled', String(!available || Boolean(value)));
    cell.setAttribute('aria-label', `${coordinate(index)}，${value === 1 ? 'X' : value === 2 ? 'O' : '空位'}${lastMove ? '，上一手' : ''}`);
    cell.tabIndex = index === focusIndex ? 0 : -1;
    const mark = value ? `<span aria-hidden="true">${value === 1 ? 'X' : 'O'}</span>` : '';
    if (cell.innerHTML !== mark) cell.innerHTML = mark;
  });
  $('#placement-bar').hidden = !available || !$('#confirm-move').checked || selected === null;
  $('#placement-label').textContent = selected === null ? '' : `想好了，就落在${coordinate(selected)}。`;
  $('#undo-button').disabled = !game.moves.some(move => move.player === 1);
  $('#hint-button').disabled = !available;
  $('#result-banner').hidden = !game.winner && !game.draw;
  $('#result-banner').innerHTML = game.winner || game.draw
    ? `<strong>${game.winner === 1 ? '✧ 这一步，开花啦。' : game.winner === 2 ? '一盘结束，陪伴继续。' : '平分秋色，刚刚好。'}</strong>输赢之外，又多了一段一起度过的时间。` : '';
}
function selectCell(index) {
  if (!canPlay() || state.game.board[index] !== 0) return;
  focusIndex = index;
  if ($('#confirm-move').checked) { selected = index; hint = null; render(); }
  else makeMove(index, 1);
}
function makeMove(index, player) {
  if (state.game.turn !== player) return false;
  const next = playMove(state.game, index);
  if (next === state.game) return false;
  state.game = next; selected = hint = null;
  if (next.winner || next.draw) {
    cancelPending();
    state.speech = next.winner === 1 ? '三个连在一起啦！这朵小花，送给认真想棋的你。'
      : next.winner === 2 ? (state.mode === 'family' ? '家人先连成三个啦。再一起下一盘好吗？' : '这局我先连成三个啦。再一起下一盘好吗？')
        : '棋盘满满的，我们平分秋色。';
    addMessage('pet', state.speech);
  } else if (player === 1) {
    state.speech = state.mode === 'family' && state.familyControl === 'manual' ? '轮到家人端画 O 啦。' : '我看到你的 X 啦，等我想一小会儿。';
  } else state.speech = '我下好啦。轮到你，慢慢想。';
  publish();
  scheduleOpponent();
  return true;
}
function scheduleOpponent() {
  if (botTimer || state.game.turn !== 2 || state.game.winner || state.game.draw
    || (state.mode === 'family' && state.familyControl === 'manual')) return;
  const token = generation;
  botTimer = setTimeout(() => {
    botTimer = null;
    if (token !== generation) return;
    const move = chooseMove(state.game, { level: state.mode === 'family' ? 'gentle' : level });
    if (move !== null) makeMove(move, 2);
  }, 650);
}
function reset(mode = state.mode) {
  cancelPending(); selected = hint = null; focusIndex = 4;
  state = initial(mode, mode === state.mode ? state.familyControl : 'auto');
  publish();
}
function askReset(action, title, text) {
  if (!state.game.moves.length) { action(); return; }
  $('#dialog-content').innerHTML = `<h2>${esc(title)}</h2><p>${esc(text)}</p>`;
  $('#dialog-cancel').hidden = false;
  $('#dialog-confirm').textContent = '开始新的一局';
  confirmAction = action;
  $('#chess-dialog').showModal();
}
function offerHint(inChat = false) {
  if (!canPlay()) { toast('等轮到你时，再一起看看下一步。'); return; }
  hint = chooseMove(state.game, { level: 'balanced' }); selected = null;
  state.speech = `可以看看${coordinate(hint)}，试着连成三个，或者挡住对方。`;
  if (inChat) addMessage('pet', state.speech);
  publish();
}
function sendChat(raw, role = 'user') {
  const text = String(raw).replace(/[\u0000-\u001f]/g, '').trim().slice(0, 140);
  if (!text) return;
  addMessage(role, text);
  if (state.mode === 'family' && state.familyControl === 'manual') { publish(); return; }
  if (/提示|怎么下|下哪/.test(text) && canPlay()) { offerHint(true); return; }
  const reply = /规则|怎么玩/.test(text) ? '我们轮流画 X 和 O，横、竖或斜着先连成三个就赢；格子满了还没有三连，就是平局。'
    : state.mode === 'family' ? '慢慢来，我们一起下。' : '这一步很认真呀，继续看看还有哪里可以连起来。';
  state.speech = reply; addMessage(state.mode === 'family' ? 'family' : 'pet', reply); publish();
}
function handlePeerCommand(command) {
  if (!command || state.mode !== 'family' || state.familyControl !== 'manual') return;
  if (command.type === 'move' && command.gameId === state.gameId && state.game.turn === 2) makeMove(command.index, 2);
  if (command.type === 'chat' && command.gameId === state.gameId && typeof command.text === 'string') sendChat(command.text, 'family');
}

document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => {
  const mode = button.dataset.mode;
  if (mode !== state.mode) askReset(() => reset(mode), '换一种陪伴方式？', '当前棋局会结束，再从第一步开始。');
}));
$('#ttt-level').addEventListener('change', event => { level = event.target.value === 'balanced' ? 'balanced' : 'gentle'; publish(); });
$('#family-auto').addEventListener('change', event => {
  cancelPending();
  state.familyControl = event.target.checked ? 'auto' : 'manual';
  state.speech = event.target.checked ? '家人模拟对手会自动落子。' : 'O 交给家人端窗口，我们一人一手。';
  publish(); scheduleOpponent();
});
$('#family-open').addEventListener('click', () => {
  cancelPending(); state.familyControl = 'manual'; state.speech = '家人端使用 O，你在这里使用 X。'; publish();
});
$('#confirm-move').addEventListener('change', () => { selected = null; render(); });
$('#place-button').addEventListener('click', () => { if (selected !== null && canPlay()) makeMove(selected, 1); });
$('#undo-button').addEventListener('click', () => {
  const previous = undoRound(state.game);
  if (previous === state.game) return;
  cancelPending(); state.game = previous; selected = hint = null;
  state.speech = '没关系，我们退回你上一次落子前，再想一想。'; publish();
});
$('#hint-button').addEventListener('click', () => offerHint());
$('#restart-button').addEventListener('click', () => askReset(() => reset(), '再来一盘新的棋？', '当前棋局会结束，棋盘重新从第一步开始。'));
$('#chess-chat').addEventListener('submit', event => { event.preventDefault(); const input = $('#chess-chat-input'); sendChat(input.value); input.value = ''; });
$('.chess-quick').addEventListener('click', event => { const button = event.target.closest('[data-quick]'); if (button) sendChat(button.dataset.quick); });
$('#rules-open').addEventListener('click', () => {
  $('#dialog-content').innerHTML = '<h2>一盘不着急的井字棋</h2><p>你执 X 先下，伙伴执 O。轮流在空格里落子，横、竖或斜着先连成三个就赢；九格填满仍无人获胜就是平局。</p><p>“悔一步”会退回你上一手之前；“给点提示”会圈出一个位置。手机默认先选位置，再确认落子。</p><p>家人双窗口仅在同一浏览器、同一网址下同步，不是异地联网。对局不修改原来的成长和记忆。</p>';
  $('#dialog-cancel').hidden = true; $('#dialog-confirm').textContent = '知道啦'; confirmAction = null; $('#chess-dialog').showModal();
});
$('#dialog-cancel').addEventListener('click', () => { confirmAction = null; $('#chess-dialog').close(); });
$('#dialog-confirm').addEventListener('click', () => { const action = confirmAction; confirmAction = null; $('#chess-dialog').close(); action?.(); });
$('#chess-dialog').addEventListener('cancel', () => { confirmAction = null; });
addEventListener('pagehide', () => { cancelPending(); clearTimeout(toastTimer); session.close(); });
publish();
