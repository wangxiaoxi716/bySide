import { createChessSession } from './chess-session.js';
import { projectionGeometry } from './chess-projection-geometry.js';
import { characterArt } from './stage.js';

const view = document.body.dataset.chessView;
const isFamily = view === 'family';
const room = new URLSearchParams(location.search).get('room') || '';
const roomId = /^[a-zA-Z0-9_-]{1,80}$/.test(room) ? room : '';
const $ = (id) => document.getElementById(id);
const letters = 'ABCDEFGHIJKLMNO';
let state = null;
let connected = false;
let selected = 112;
let lastMessageKey = '';
let lastPetKey = '';
let session;
let geometryFrame = 0, lastGeometryKey = null, projectionObserver = null;
const emptyGame = { board: Array(225).fill(0), moves: [], turn: 1, winner: 0, draw: false, winningLine: [] };
const coordinate = (index) => `${letters[index % 15]}${Math.floor(index / 15) + 1}`;
const game = () => state?.game || emptyGame;
const canMove = () => connected && !state?.demo && state?.mode === 'family' && state?.familyControl === 'manual' && game().turn === 2 && !game().winner && !game().draw;
const canChat = () => connected && !state?.demo && state?.mode === 'family';

function gridSvg(projection = false) {
  const lines = Array.from({ length: 15 }, (_, n) => {
    const value = 16 + n * 32;
    return `<path d="M16 ${value}H464M${value} 16V464"/>`;
  }).join('');
  const stars = [[3, 3], [3, 11], [7, 7], [11, 3], [11, 11]].map(([r, c]) => `<circle cx="${16 + c * 32}" cy="${16 + r * 32}" r="3"/>`).join('');
  return `<svg class="cv-board-lines" viewBox="0 0 480 480" aria-hidden="true"><g fill="none" stroke="${projection ? '#62714c' : '#af986d'}" stroke-width="1.1" opacity=".7">${lines}</g><g fill="${projection ? '#7e925e' : '#9e8457'}">${stars}</g></svg>`;
}

function statusText() {
  if (!roomId) return '请从棋室打开';
  if (!connected) return '主页面已离线';
  if (state?.demo) return '预设棋局演示中';
  const current = game();
  if (state?.mode !== 'family') return '家人正在和芽团下棋';
  if (current.winner) return current.winner === 1 ? '家人赢了，下一盘继续' : '奶奶赢了，真厉害！';
  if (current.draw) return '这一盘和棋啦';
  if (state?.familyControl !== 'manual') return '正在自动演示奶奶落子';
  return current.turn === 2 ? '轮到您了，慢慢想' : '家人正在想下一步';
}

function initializeFamily() {
  document.querySelector('.cv-coordinates-top').innerHTML = [...letters].map((c) => `<span>${c}</span>`).join('');
  document.querySelector('.cv-coordinates-side').innerHTML = Array.from({ length: 15 }, (_, i) => `<span>${i + 1}</span>`).join('');
  $('family-board').innerHTML = `${gridSvg()}<div class="cv-board-hit-grid">${Array.from({ length: 225 }, (_, index) => `<button type="button" class="cv-board-cell" role="gridcell" data-index="${index}" data-stone="0" tabindex="${index === selected ? 0 : -1}" aria-label="${coordinate(index)}，空位" aria-selected="false"></button>`).join('')}</div>`;
  $('family-board').addEventListener('click', (event) => {
    const cell = event.target.closest('[data-index]');
    if (!cell) return;
    selectCell(Number(cell.dataset.index));
  });
  $('family-board').addEventListener('keydown', (event) => {
    const cell = event.target.closest('[data-index]');
    if (!cell) return;
    const current = Number(cell.dataset.index);
    let next = current;
    const row = Math.floor(current / 15), col = current % 15;
    if (event.key === 'ArrowLeft') next = row * 15 + Math.max(0, col - 1);
    else if (event.key === 'ArrowRight') next = row * 15 + Math.min(14, col + 1);
    else if (event.key === 'ArrowUp') next = Math.max(0, row - 1) * 15 + col;
    else if (event.key === 'ArrowDown') next = Math.min(14, row + 1) * 15 + col;
    else if (event.key === 'Home') next = row * 15;
    else if (event.key === 'End') next = row * 15 + 14;
    else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectCell(current); commitMove(); return; }
    else return;
    event.preventDefault();
    selectCell(next);
    $('family-board').querySelector(`[data-index="${next}"]`).focus();
  });
  $('family-confirm').addEventListener('click', commitMove);
  document.querySelectorAll('[data-chat]').forEach((button) => button.addEventListener('click', () => sendChat(button.dataset.chat)));
  $('family-chat-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const input = $('family-chat-input');
    if (sendChat(input.value)) input.value = '';
  });
  if (!roomId) {
    $('view-no-room').hidden = false;
    $('view-content').hidden = true;
  }
}

function selectCell(index) {
  selected = index;
  renderFamilyBoard();
}

function commitMove() {
  if (!canMove()) { $('family-feedback').textContent = !connected ? '主页面已离线，请先回到棋室。' : state?.demo ? '预设棋局演示中，暂时不能落子。' : '请等轮到您，再确认落子。'; return; }
  if (game().board[selected]) { $('family-feedback').textContent = '这里已经有棋子啦，换一个空位吧。'; return; }
  const sent = session.send({ type: 'move', index: selected, gameId: state.gameId });
  $('family-feedback').textContent = sent ? `已发送 ${coordinate(selected)}，等待棋室确认。` : '暂时没有连接棋室，请等连接恢复。';
}

function sendChat(value) {
  const text = String(value || '').trim().slice(0, 160);
  if (!text || !canChat()) return false;
  const sent = session.send({ type: 'chat', text, gameId: state.gameId });
  $('family-feedback').textContent = sent ? '模拟消息已发送到主棋室。' : '暂时没有连接棋室，请等连接恢复。';
  return sent;
}

function renderFamilyBoard() {
  const current = game();
  const last = current.moves?.at(-1)?.index;
  const winning = new Set(current.winningLine || []);
  const moveAllowed = canMove();
  $('family-board').querySelectorAll('[data-index]').forEach((button, index) => {
    const stone = current.board[index] || 0;
    button.dataset.stone = stone;
    button.classList.toggle('is-last', last === index);
    button.classList.toggle('is-winning', winning.has(index));
    button.classList.toggle('is-selected', moveAllowed && index === selected);
    button.tabIndex = index === selected ? 0 : -1;
    button.setAttribute('aria-selected', String(index === selected));
    button.setAttribute('aria-disabled', String(!moveAllowed || !!stone));
    button.setAttribute('aria-label', `${coordinate(index)}，${stone === 1 ? '家人的黑子' : stone === 2 ? '奶奶的白子' : '空位'}${last === index ? '，上一手' : ''}`);
  });
  $('family-confirm').disabled = !moveAllowed || !!current.board[selected];
  $('family-confirm').textContent = moveAllowed ? current.board[selected] ? '这里有棋子了，请选空位' : `确认落子 · ${coordinate(selected)}` : current.winner || current.draw ? '这盘结束了，等家人再开一局' : '等待轮到您';
  $('family-move-count').textContent = `第 ${current.moves?.length || 0} 手`;
}

function renderMessages() {
  const messages = (state?.messages || []).slice(-35);
  const key = JSON.stringify(messages);
  if (key === lastMessageKey) return;
  lastMessageKey = key;
  const log = $('family-messages');
  log.replaceChildren();
  if (!messages.length) {
    const empty = document.createElement('p'); empty.className = 'cv-message-empty'; empty.textContent = '落下一颗棋，也留下一句话。'; log.append(empty);
  }
  messages.forEach((message) => {
    const row = document.createElement('div');
    row.className = `cv-message ${message.role === 'elder' ? 'is-elder' : message.role === 'pet' ? 'is-pet' : ''}`;
    const name = document.createElement('small'); name.textContent = message.role === 'elder' ? '奶奶 · 模拟' : message.role === 'pet' ? '芽团' : '家人';
    const text = document.createElement('p'); text.textContent = String(message.text || '');
    row.append(name, text); log.append(row);
  });
  log.scrollTop = log.scrollHeight;
}

function renderFamily() {
  const connection = $('view-connection');
  connection.classList.toggle('is-connected', connected);
  connection.classList.toggle('is-offline', !connected && !!roomId);
  connection.querySelector('span').textContent = !roomId ? '还没有进入棋室' : connected ? '已同步本机棋室' : '主页面已离线';
  $('family-turn').textContent = statusText();
  $('family-turn-detail').textContent = !connected ? '保持主棋室打开，棋局会自动同步。' : state?.demo ? '演示期间暂时不能落子或发送消息。' : state?.mode !== 'family' ? '主棋室切换「和家人一起」即可。' : state?.familyControl !== 'manual' ? '主棋室取消勾选「模拟长辈自动落子」，就能替奶奶下棋。' : canMove() ? '点一个空位，再按下面的确认按钮。' : '您可以先和家人聊聊天。';
  $('family-elder-speech').textContent = state?.elderSpeech || '坐好啦，等你一起下棋。';
  document.querySelectorAll('[data-chat], .cv-chat-form button, .cv-chat-form input').forEach((control) => { control.disabled = !canChat(); });
  renderFamilyBoard();
  renderMessages();
}

function currentProjectionGeometry() {
  const svg = $('projection-chess-board').querySelector('.cv-board-lines');
  return !$('projection-chess-board-area').hidden && svg ? projectionGeometry(svg.getBoundingClientRect(), innerWidth, innerHeight) : null;
}

function renderProjectionBinding() {
  const button = $('projection-claim-camera');
  const bound = connected && Boolean(session?.id) && state?.activeProjectionId === session.id;
  button.disabled = !connected || $('projection-chess-board-area').hidden;
  button.textContent = bound ? '实物识别已绑定' : '用于实物识别';
  button.setAttribute('aria-pressed', String(bound));
  button.title = $('projection-chess-board-area').hidden ? '先显示棋盘，再绑定摄像头标定' : bound ? '摄像头标定使用此投影窗口，其他投影仅同步显示' : '把摄像头标定绑定到这个投影窗口';
}

function scheduleProjectionGeometry() {
  if (isFamily || geometryFrame) return;
  geometryFrame = requestAnimationFrame(() => {
    geometryFrame = 0;
    if (!connected || !state?.gameId || !session) { lastGeometryKey = null; return; }
    const geometry = currentProjectionGeometry();
    const key = `${state.gameId}:${geometry?.signature || 'hidden'}`;
    if (key === lastGeometryKey) return;
    if (session.send({ type: 'projection-geometry', gameId: state.gameId, projectionId: session.id, geometry })) lastGeometryKey = key;
    if (geometry) {
      const rect = $('projection-chess-board-area').getBoundingClientRect();
      document.querySelectorAll('[data-corner]').forEach(marker => {
        const point = geometry.corners.find(corner => corner.label === marker.dataset.corner);
        marker.style.left = `${point.x - rect.left}px`;
        marker.style.top = `${point.y - rect.top}px`;
      });
    }
  });
}

function initializeProjection() {
  const claim = document.createElement('button');
  claim.id = 'projection-claim-camera'; claim.type = 'button'; claim.textContent = '用于实物识别'; claim.setAttribute('aria-pressed', 'false');
  $('projection-toggle-calibration').before(claim);
  claim.addEventListener('click', () => {
    const geometry = currentProjectionGeometry();
    if (connected && state?.gameId && geometry) session?.send({ type: 'projection-claim', gameId: state.gameId, projectionId: session.id, geometry });
  });
  $('projection-toggle-board').addEventListener('click', () => {
    const area = $('projection-chess-board-area');
    area.hidden = !area.hidden;
    $('projection-toggle-board').textContent = area.hidden ? '显示棋盘' : '隐藏棋盘';
    $('projection-toggle-board').setAttribute('aria-pressed', String(!area.hidden));
    renderProjectionBinding(); scheduleProjectionGeometry();
  });
  $('projection-toggle-calibration').addEventListener('click', () => {
    const markers = $('projection-calibration-markers');
    markers.hidden = !markers.hidden;
    $('projection-toggle-calibration').textContent = markers.hidden ? '显示标定角标' : '隐藏标定角标';
    $('projection-toggle-calibration').setAttribute('aria-pressed', String(!markers.hidden));
    scheduleProjectionGeometry();
  });
  $('projection-fullscreen').addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      else $('projection-fullscreen').textContent = '请用浏览器全屏';
    } catch { $('projection-fullscreen').textContent = '请用浏览器全屏'; }
  });
  document.addEventListener('fullscreenchange', () => { $('projection-fullscreen').textContent = document.fullscreenElement ? '退出全屏' : '进入全屏'; scheduleProjectionGeometry(); });
  window.addEventListener('resize', scheduleProjectionGeometry);
  if (globalThis.ResizeObserver) {
    projectionObserver = new ResizeObserver(scheduleProjectionGeometry);
    projectionObserver.observe($('projection-chess-board'));
  }
  window.addEventListener('pagehide', () => {
    if (connected && state?.gameId) session?.send({ type: 'projection-release', gameId: state.gameId, projectionId: session.id });
    projectionObserver?.disconnect(); cancelAnimationFrame(geometryFrame); window.removeEventListener('resize', scheduleProjectionGeometry);
  }, { once: true });
}

function renderProjection() {
  const pet = { character: 'yatuan', mood: 'happy', motion: 'idle', growthStage: 0, flowerCount: 1, flowerStyle: 'cream', ...state?.pet };
  const petKey = JSON.stringify(pet);
  if (petKey !== lastPetKey) { $('projection-chess-pet').innerHTML = characterArt(pet); lastPetKey = petKey; }
  $('projection-chess-speech').textContent = !roomId ? '请从棋室打开投影，我就在这里陪你下棋。' : !connected ? '棋室暂时离开了，等它回来再继续。' : state?.speech || '别着急，我们慢慢下一盘。';
  const current = game();
  const status = $('projection-chess-status');
  status.textContent = !roomId ? '没有棋室 · 请从主页面打开' : !connected ? '主页面已离线' : state?.mode === 'family' ? '和家人下棋 · 本机模拟' : '和芽团下棋 · 实时同步';
  if (connected && state?.mode === 'pet' && state?.vision) {
    const vision = state.vision;
    const fallback = vision.status === 'paused' ? '实物识别已暂停' : vision.active ? '正在观察实物黑子' : '';
    const detail = typeof vision.message === 'string' ? vision.message.slice(0, 80) : fallback;
    if (detail) status.textContent += ` · ${detail}`;
  }
  status.classList.toggle('is-offline', !connected);
  const last = current.moves?.at(-1)?.index;
  const winning = new Set(current.winningLine || []);
  $('projection-chess-board').innerHTML = gridSvg(true) + current.board.map((stone, index) => stone ? `<span class="cv-mini-stone ${index === last ? 'is-last' : ''} ${winning.has(index) ? 'is-winning' : ''}" data-stone="${stone === 1 ? 1 : 2}" style="left:${(index % 15 + .5) / 15 * 100}%;top:${(Math.floor(index / 15) + .5) / 15 * 100}%"></span>` : '').join('');
  $('projection-chess-moves').textContent = `第 ${current.moves?.length || 0} 手`;
  $('projection-chess-turn').textContent = !connected ? '等待棋室' : current.winner ? `${current.winner === 1 ? '你' : state?.mode === 'family' ? '奶奶' : '芽团'}赢啦` : current.draw ? '这局和棋啦' : current.turn === 1 ? '轮到你落子' : state?.mode === 'family' ? '奶奶正在想下一步' : '芽团在认真想棋';
  $('projection-chess-board').setAttribute('aria-label', `同步五子棋棋盘，第 ${current.moves?.length || 0} 手，${$('projection-chess-turn').textContent}`);
  renderProjectionBinding(); scheduleProjectionGeometry();
}

if (isFamily) initializeFamily(); else initializeProjection();
const render = isFamily ? renderFamily : renderProjection;
render();
if (roomId) {
  session = createChessSession({ roomId, owner: false, onState(next, meta = {}) {
    state = next;
    connected = meta.connected === true;
    render();
  } });
  window.addEventListener('pagehide', () => session.close(), { once: true });
}
