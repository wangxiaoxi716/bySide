import { createChessSession } from './chess-session.js';

const $ = selector => document.querySelector(selector);
const params = new URLSearchParams(location.search);
const roomId = params.get('room'), projection = params.get('view') === 'projection';
const coordinate = index => `第 ${Math.floor(index / 3) + 1} 行第 ${index % 3 + 1} 列`;
let state = null, connected = false, selected = null, pending = false, focusIndex = 4, session = null;
if (projection) {
  document.body.classList.add('project');
  $('#view-title').textContent = '一盘棋，陪在你身边。';
  $('#view-description').textContent = '棋盘跟随主棋室同步；保持主棋室打开。';
  $('#view-board').setAttribute('aria-label', '同步的井字棋棋盘');
  $('#view-fullscreen').hidden = false;
}
const cells = Array.from({ length: 9 }, (_, index) => {
  const cell = document.createElement('button');
  cell.type = 'button';
  cell.addEventListener('click', () => {
    if (!canPlay() || state.game.board[index]) return;
    selected = index; focusIndex = index; render();
  });
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
  $('#view-board').append(cell); return cell;
});
function canPlay() {
  return !projection && connected && !pending && state?.kind === 'tic-tac-toe'
    && state.mode === 'family' && state.familyControl === 'manual'
    && state.game.turn === 2 && !state.game.winner && !state.game.draw;
}
function render() {
  const game = state?.kind === 'tic-tac-toe' ? state.game : null, available = canPlay();
  $('#connection').textContent = connected && game ? '已连接主棋室 · 同一浏览器' : roomId ? '主棋室未连接或已离开' : '请从主棋室打开此窗口';
  let turn = '等待主棋室';
  if (game && connected) {
    if (game.winner) turn = game.winner === 1 ? 'X 连成三个啦' : 'O 连成三个啦';
    else if (game.draw) turn = '这一盘，平分秋色';
    else if (!projection && (state.mode !== 'family' || state.familyControl !== 'manual')) turn = '请在主棋室切换到家人双窗口模式';
    else turn = game.turn === 1 ? '轮到 X 落子' : projection ? '轮到 O 落子' : '轮到你画 O';
  }
  $('#view-turn').textContent = turn;
  $('#view-count').textContent = game ? `已下 ${game.moves.length} 手` : '';
  cells.forEach((cell, index) => {
    const value = game?.board[index] ?? 0, last = game?.moves.at(-1)?.index === index;
    cell.className = `ttt-cell${last ? ' is-latest' : ''}${game?.winningLine.includes(index) ? ' is-winning' : ''}${selected === index ? ' is-selected' : ''}`;
    cell.dataset.value = value;
    cell.disabled = !available;
    cell.setAttribute('aria-disabled', String(!available || Boolean(value)));
    cell.setAttribute('aria-label', `${coordinate(index)}，${value === 1 ? 'X' : value === 2 ? 'O' : '空位'}`);
    cell.tabIndex = index === focusIndex ? 0 : -1;
    cell.innerHTML = value ? `<span aria-hidden="true">${value === 1 ? 'X' : 'O'}</span>` : '';
  });
  $('#view-selection').textContent = projection ? (game ? state.speech : '等待棋室') : selected === null ? '选择一个空格' : `已选择${coordinate(selected)}`;
  $('#view-confirm').disabled = !available || selected === null;
  $('#view-chat-input').disabled = !connected || !game || state.mode !== 'family' || state.familyControl !== 'manual';
  $('#view-chat').querySelector('button').disabled = $('#view-chat-input').disabled;
  const list = $('#view-messages');
  list.replaceChildren();
  for (const message of state?.messages ?? []) {
    const item = document.createElement('li');
    item.textContent = `${message.role === 'user' ? '主棋室' : message.role === 'family' ? '家人端' : '芽团'}：${message.text}`;
    list.append(item);
  }
}
$('#view-confirm').addEventListener('click', () => {
  if (!canPlay() || selected === null) return;
  const sent = session?.send({ type: 'move', gameId: state.gameId, index: selected });
  if (sent) { pending = true; selected = null; render(); }
});
$('#view-chat').addEventListener('submit', event => {
  event.preventDefault();
  const input = $('#view-chat-input'), text = input.value.trim().slice(0, 140);
  if (!text || input.disabled) return;
  if (session?.send({ type: 'chat', gameId: state.gameId, text })) input.value = '';
});
$('#view-fullscreen').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.();
});
document.addEventListener('fullscreenchange', () => { $('#view-fullscreen').textContent = document.fullscreenElement ? '退出全屏' : '进入全屏'; });
if (roomId) {
  session = createChessSession({ roomId, onState: (next, meta) => {
    if (next?.gameId !== state?.gameId || next?.game?.moves?.length !== state?.game?.moves?.length || !meta.connected) selected = null;
    state = next; connected = meta.connected; pending = false; render();
  } });
}
addEventListener('pagehide', () => session?.close());
render();
