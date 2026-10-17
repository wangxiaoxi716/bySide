import { BOARD_SIZE, createGame, playMove, undoRound, chooseMove } from './chess-core.js';
import { createChessSession } from './chess-session.js';
import { mountChessVision } from './chess-vision-ui.js';
import { updateProjectionBinding } from './chess-projection-geometry.js';
import { characterArt, icon, esc } from './stage.js';

// This optional room owns only its chess session. It never changes the original
// companion's chat, growth, memories, camera, microphone, or stored preferences.
const $ = selector => document.querySelector(selector);
const uid = () => crypto.randomUUID();
// Each control page is an independent room. Reopening a copied link must never
// replace the owner of an existing game in another tab.
const roomId = uid();
if (location.search) history.replaceState(null, '', location.pathname);
const coordinates = index => `${String.fromCharCode(65 + index % BOARD_SIZE)}${Math.floor(index / BOARD_SIZE) + 1}`;
const petBase = { character: 'yatuan', growthStage: 0, flowerCount: 1, flowerStyle: 'cream', mood: 'happy', motion: 'idle' };
const hello = '小棋盘准备好啦。你先来，我陪你慢慢想。';
const firstMessage = mode => ({ id: uid(), role: mode === 'family' ? 'elder' : 'pet', text: mode === 'family' ? '小板凳搬来啦。今天陪我下一盘？' : '先从喜欢的位置开始吧。需要时，就叫我给一点提示。' });
function initial(mode = 'pet') {
  return { roomId, gameId: uid(), mode, familyControl: 'auto', game: createGame(), phase: 'playing', speech: mode === 'family' ? '我来摆好棋盘，陪你和奶奶一起慢慢下。' : hello, elderSpeech: '小板凳搬来啦，今天陪我下一盘？', pet: { ...petBase }, messages: [firstMessage(mode)], updatedAt: Date.now(), demo: false, vision: { active: false, status: 'idle' }, projectionGeometry: null, activeProjectionId: null };
}
let state = initial();
let epoch = 0, botTimer = null, toastTimer = null, selected = null, hint = null, focusIndex = 112;
let confirmAction = null, lastArt = '', lastMessages = '', demoStep = 0;
const timers = new Set();
let level = 'gentle';
let visionController = null;
let projectionBinding = { initialized: false, activeProjectionId: null, geometry: null };
const session = createChessSession({ roomId, owner: true, onCommand: handlePeerCommand });

document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon, 20); });
$('#projection-open').href = `chess-projection.html?room=${encodeURIComponent(roomId)}`;
$('#family-open').href = `chess-family.html?room=${encodeURIComponent(roomId)}`;
$('#confirm-move').checked = matchMedia('(max-width: 640px)').matches;
$('#elder-avatar').innerHTML = elderAvatar();

function elderAvatar() {
  return '<svg viewBox="0 0 64 64" aria-label="模拟奶奶头像" role="img"><circle cx="32" cy="32" r="31" fill="#e9ddc6"/><path d="M11 64Q11 41 32 42Q54 41 54 64" fill="#94a180"/><circle cx="32" cy="29" r="18" fill="#ecebe3"/><circle cx="32" cy="34" r="15" fill="#f3d4b3"/><path d="M18 28Q20 12 34 17Q45 18 48 29Q35 29 31 23Q27 29 18 28" fill="#f8f7ef"/><g fill="none" stroke="#8d8b73" stroke-width="1.2"><circle cx="25" cy="33" r="5"/><circle cx="39" cy="33" r="5"/><path d="M30 33h4M27 43q5 4 10 0"/></g><circle cx="25" cy="33" r="1.2" fill="#665b45"/><circle cx="39" cy="33" r="1.2" fill="#665b45"/><path d="M26 50l6 7 7-7" fill="none" stroke="#dce0ca" stroke-width="2"/></svg>';
}
function later(fn, delay) {
  const token = epoch;
  const timer = setTimeout(() => { timers.delete(timer); if (token === epoch) fn(); }, delay);
  timers.add(timer);
  return timer;
}
function cancelPending() {
  epoch++;
  for (const timer of timers) clearTimeout(timer);
  timers.clear(); botTimer = null;
}
function toast(message) {
  clearTimeout(toastTimer);
  $('#chess-toast').textContent = message;
  $('#chess-toast').hidden = false;
  toastTimer = setTimeout(() => { $('#chess-toast').hidden = true; }, 4000);
}
function addMessage(role, text) {
  state.messages = [...state.messages, { id: uid(), role, text: text.slice(0, 240) }].slice(-35);
}
function publish() {
  state.updatedAt = Date.now();
  render();
  visionController?.update(state);
  session.publish(state);
}
function canPlay() { return !state.demo && state.game.turn === 1 && !state.game.winner && !state.game.draw; }
function opponent() { return state.mode === 'pet' ? '芽团' : '奶奶'; }
function setSpeech(text, mood = 'happy', motion = 'idle') {
  state.speech = text;
  state.pet = { ...petBase, mood, motion };
}

// Keep the board DOM stable so keyboard focus and touch selection survive updates.
const grid = $('#chess-grid');
const cells = Array.from({ length: BOARD_SIZE ** 2 }, (_, index) => {
  const cell = document.createElement('button');
  cell.type = 'button'; cell.className = 'chess-cell'; cell.dataset.index = String(index);
  cell.tabIndex = index === focusIndex ? 0 : -1;
  cell.addEventListener('click', () => selectCell(index));
  cell.addEventListener('keydown', event => {
    const row = Math.floor(index / 15), col = index % 15;
    const targets = { ArrowLeft: row * 15 + Math.max(0, col - 1), ArrowRight: row * 15 + Math.min(14, col + 1), ArrowUp: Math.max(0, row - 1) * 15 + col, ArrowDown: Math.min(14, row + 1) * 15 + col, Home: row * 15, End: row * 15 + 14 };
    if (!(event.key in targets)) return;
    event.preventDefault();
    focusIndex = targets[event.key];
    cells.forEach((item, i) => { item.tabIndex = i === focusIndex ? 0 : -1; });
    cells[focusIndex].focus();
  });
  grid.append(cell); return cell;
});
$('#top-axes').innerHTML = Array.from({ length: 15 }, (_, i) => `<span>${String.fromCharCode(65 + i)}</span>`).join('');
$('#side-axes').innerHTML = Array.from({ length: 15 }, (_, i) => `<span>${i + 1}</span>`).join('');
$('#board-lines').innerHTML = `<g stroke="#b7af8e" stroke-width=".85">${Array.from({ length: 15 }, (_, i) => `<path d="M20 ${20 + i * 40}H580M${20 + i * 40} 20V580"/>`).join('')}</g><g fill="#a7a07e">${[48,56,112,168,176].map(index => `<circle cx="${20 + index % 15 * 40}" cy="${20 + Math.floor(index / 15) * 40}" r="3"/>`).join('')}</g>`;

function selectCell(index) {
  if (!canPlay() || state.game.board[index] !== 0) return;
  focusIndex = index;
  if ($('#confirm-move').checked) { selected = index; hint = null; renderBoard(); }
  else makeMove(index, 1);
}
function renderBoard() {
  const g = state.game, last = g.moves.at(-1);
  const available = canPlay();
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i], value = g.board[i];
    cell.disabled = !available;
    cell.setAttribute('aria-disabled', String(!available || Boolean(value)));
    cell.setAttribute('aria-label', `${coordinates(i)}，${value === 1 ? '黑棋' : value === 2 ? '白棋' : '空位'}${last?.index === i ? '，上一手' : ''}`);
    cell.className = `chess-cell${last?.index === i ? ' latest' : ''}${g.winningLine.includes(i) ? ' winning' : ''}${selected === i ? ' selected-cell' : ''}${hint === i ? ' hinted' : ''}`;
    const nextPiece = value ? `<span class="piece ${value === 1 ? 'black' : 'white'}"></span>` : '';
    if (cell.innerHTML !== nextPiece) cell.innerHTML = nextPiece;
    cell.tabIndex = i === focusIndex ? 0 : -1;
  }
  $('#placement-bar').hidden = !available || !$('#confirm-move').checked || selected === null;
  $('#placement-label').textContent = selected === null ? '选择一个位置' : `想好了，就落在 ${coordinates(selected)}。`;
  $('#undo-button').disabled = state.demo || !g.moves.length;
  $('#hint-button').disabled = !available;
  if (g.winningLine.length) {
    const first = g.winningLine[0], lastIndex = g.winningLine.at(-1);
    $('#win-overlay').innerHTML = `<path d="M${20 + first % 15 * 40} ${20 + Math.floor(first / 15) * 40}L${20 + lastIndex % 15 * 40} ${20 + Math.floor(lastIndex / 15) * 40}" stroke="#d3ad58" stroke-width="4" stroke-linecap="round" opacity=".78"/>`;
  } else $('#win-overlay').innerHTML = '';
}
function render() {
  const g = state.game, family = state.mode === 'family';
  document.body.classList.toggle('family-mode', family);
  document.querySelectorAll('[data-mode]').forEach(button => {
    const active = button.dataset.mode === state.mode;
    button.classList.toggle('selected', active); button.setAttribute('aria-pressed', String(active));
  });
  $('#chess-vision-section').hidden = family;
  $('#family-banner').hidden = !family; $('#family-card').hidden = !family;
  $('#chess-level').disabled = family || state.demo;
  $('#family-auto').checked = state.familyControl === 'auto'; $('#family-auto').disabled = state.demo;
  $('#family-status').textContent = state.familyControl === 'auto' ? '模拟对手 · 自动落子' : '双窗口演示 · 长辈端落子';
  $('#elder-speech').textContent = state.elderSpeech;
  $('#opponent-name').innerHTML = `${opponent()}<span class="stone-dot white-dot"></span>`;
  $('#opponent-subtitle').textContent = family ? '执白 · 本机模拟' : `执白 · ${level === 'gentle' ? '轻松陪练' : '认真对弈'}`;
  const avatarKey = family ? 'family' : 'pet';
  if ($('#opponent-avatar').dataset.kind !== avatarKey) {
    $('#opponent-avatar').innerHTML = family ? elderAvatar() : '<img src="icon.svg" alt="">';
    $('#opponent-avatar').dataset.kind = avatarKey;
  }
  $('#buddy-title').textContent = family ? '芽团 · 陪在棋盘旁' : '芽团的小棋桌';
  let label = g.turn === 1 ? '轮到你落子' : family && state.familyControl === 'manual' ? '等待长辈端落子' : `${opponent()}在想下一步…`;
  if (g.winner) label = g.winner === 1 ? '你连成了五子！' : `${opponent()}连成了五子`;
  else if (g.draw) label = '这一盘，我们平分秋色';
  else if (state.demo) label = '小剧场 · 示例棋局';
  $('#turn-label').textContent = label;
  $('#move-count').textContent = g.winner || g.draw ? `共 ${g.moves.length} 手 · 谢谢一起下棋` : `第 ${g.moves.length + 1} 手 · ${g.moves.length ? '慢慢想，不着急' : '从这里开始'}`;
  $('#last-move').textContent = g.moves.length ? `上一手 ${g.moves.at(-1).player === 1 ? '你' : opponent()} · ${coordinates(g.moves.at(-1).index)}` : '第一颗棋子，放在哪里都好。';
  $('#pet-speech').textContent = state.speech;
  const artKey = JSON.stringify(state.pet);
  if (artKey !== lastArt) { $('#chess-pet').innerHTML = characterArt(state.pet); lastArt = artKey; }
  const messageKey = JSON.stringify(state.messages);
  if (messageKey !== lastMessages) {
    $('#chess-messages').innerHTML = state.messages.map(message => `<div class="chess-message ${message.role === 'user' ? 'user' : ''}"><small>${message.role === 'user' ? '你' : message.role === 'elder' ? '奶奶 · 本机模拟' : '芽团'}</small>${esc(message.text)}</div>`).join('');
    $('#chess-messages').scrollTop = $('#chess-messages').scrollHeight;
    lastMessages = messageKey;
  }
  const quick = family ? ['奶奶，慢慢下', '今天吃得好吗？', '这步真厉害'] : ['给我一点提示', '夸夸这一步', '讲讲规则'];
  if ($('#chess-quick').dataset.mode !== state.mode) {
    $('#chess-quick').innerHTML = quick.map(text => `<button type="button" data-quick="${text}">${text}</button>`).join('');
    $('#chess-quick').dataset.mode = state.mode;
  }
  $('#chat-title').textContent = family ? '和奶奶说说话' : '棋盘旁，说说话';
  $('#chat-fine').textContent = family ? state.familyControl === 'auto' ? '本机模拟：长辈的回应为演示台词。' : '消息同步到同一浏览器的长辈端预览，未连接真实家人。' : '芽团会根据棋局回应你的提示与鼓励请求。';
  $('#chess-chat-input').placeholder = family ? '奶奶，今天过得怎么样？' : '慢慢下，也慢慢聊…';
  $('#demo-button').innerHTML = `${icon(state.demo ? 'pause' : 'play', 20)}<p><strong>${state.demo ? '结束小演示' : '先看一盘小演示'}</strong><small>${state.demo ? `示例棋局 · ${g.moves.length} / 9 手，不是真实对局` : '约 18 秒，看落子、回应和五连绽放'}</small></p>${icon('arrow', 18)}`;
  $('#result-banner').hidden = !g.winner && !g.draw;
  $('#result-banner').innerHTML = g.winner || g.draw ? `<strong>${g.winner === 1 ? '✧ 这一步，开花啦。' : g.winner === 2 ? '一盘结束，陪伴继续。' : '平分秋色，刚刚好。'}</strong>${g.winner === 1 ? '五子连线！把这份小小的成就感收好。' : '输赢之外，又多了一段一起度过的时间。'}` : '';
  renderBoard();
}
function finishMove(player, index) {
  selected = hint = null;
  const g = state.game, count = g.moves.length;
  if (g.winner || g.draw) {
    cancelPending(); state.phase = 'ended';
    setSpeech(g.winner === 1 ? '哇，五颗连在一起了！这朵小花，送给认真想棋的你。' : g.winner === 2 ? '这局我先连成五子啦。谢谢你陪我，再下一盘好吗？' : '棋盘满满的，今天的陪伴也是。我们平分秋色。');
    state.pet.growthStage = 3;
    if (state.mode === 'family') {
      state.elderSpeech = g.winner === 1 ? '哎哟，这步下得好！你赢啦，再陪我下一盘。' : '下一盘还和你一起下，真好。';
      setSpeech(g.winner === 1 ? '你和奶奶下完一盘啦。这朵花，纪念一起度过的时间。' : '一盘棋落定，陪伴还在。我把这段时间开成一朵花。');
      state.pet.growthStage = 3;
    }
    addMessage(state.mode === 'family' ? 'elder' : 'pet', state.mode === 'family' ? state.elderSpeech : state.speech);
  } else if (player === 1) {
    state.phase = 'thinking';
    setSpeech(state.mode === 'family' ? `你的棋子落在 ${coordinates(index)}，接下来轮到奶奶。` : count === 1 ? '从这一颗开始。让我看看，怎么和你一起把棋盘铺开。' : `我看到你落在 ${coordinates(index)} 啦，等我想一小会儿。`, 'curious', 'thinking');
    if (state.mode === 'family' && state.familyControl === 'manual') state.phase = 'playing';
  } else {
    state.phase = 'playing';
    const lines = ['我下好啦。想一想，你的棋子还可以往哪边连？', '这一小片棋盘，慢慢热闹起来了。轮到你啦。', '不用急着落子，也看看我这边的小心思。', '你认真想棋的样子，我也在好好看着。'];
    setSpeech(state.mode === 'family' ? `奶奶落在 ${coordinates(index)}，我帮你把上一手圈出来了。` : lines[Math.floor(count / 2 - 1) % lines.length]);
    if (state.mode === 'family' && state.familyControl === 'auto') {
      const lines = ['我下这儿。你慢慢看，不着急。', '和你下一盘，比一个人看电视有意思。', '哎，我这步可想了好一会儿。', '茶还是热的，再陪我下几步。'];
      state.elderSpeech = lines[Math.floor(count / 2 - 1) % lines.length];
      if (count % 4 === 2) addMessage('elder', state.elderSpeech);
    }
  }
}
function makeMove(index, player) {
  if (state.demo || state.game.turn !== player) return false;
  const next = playMove(state.game, index);
  if (next === state.game) return false;
  state.game = next;
  finishMove(player, index);
  publish(); scheduleOpponent(); return true;
}
function scheduleOpponent() {
  if (botTimer || state.demo || state.game.turn !== 2 || state.game.winner || state.game.draw || (state.mode === 'family' && state.familyControl === 'manual')) return;
  botTimer = later(() => {
    botTimer = null;
    const index = chooseMove(state.game, { level: state.mode === 'family' ? 'gentle' : level });
    if (index !== null) makeMove(index, 2);
  }, state.mode === 'family' ? 1500 : 950);
}
function reset(mode = state.mode) {
  cancelPending(); selected = hint = null; focusIndex = 112;
  const { familyControl, projectionGeometry, activeProjectionId } = state;
  state = initial(mode);
  state.familyControl = familyControl;
  // A new game clears moves, not the physical projector's placement.
  state.projectionGeometry = projectionGeometry;
  state.activeProjectionId = activeProjectionId;
  publish();
}
function askReset(action, title = '再摆一盘新的棋？', description = '当前棋局会结束，棋盘重新从第一颗开始。') {
  if (!state.game.moves.length && !state.demo) { action(); return; }
  $('#dialog-content').innerHTML = `<h2>${esc(title)}</h2><p>${esc(description)}</p>`;
  $('#dialog-cancel').hidden = false; $('#dialog-confirm').textContent = '开始新的一局';
  confirmAction = action; $('#chess-dialog').showModal();
}
function offerHint(chat = false) {
  if (!canPlay()) { toast('等轮到你时，再一起看看下一步。'); return; }
  hint = chooseMove(state.game, { level: 'balanced' }); selected = null;
  const text = state.game.moves.length ? `可以看看 ${coordinates(hint)}，那里能帮你延伸棋形，或挡住对方的路线。试着再想一想？` : '可以从棋盘中央的 H8 开始，往各个方向都有展开的空间。';
  setSpeech(text, 'curious');
  if (chat) addMessage('pet', text);
  publish();
}
function undo() {
  if (state.demo) return;
  const next = undoRound(state.game);
  if (next === state.game) return;
  cancelPending(); state.game = next; state.phase = 'playing'; selected = hint = null;
  setSpeech('没关系，我们退回这一步。慢慢试，也是一种进步。');
  addMessage('pet', '棋盘回到你上一次落子前。再想一个喜欢的位置吧。');
  publish();
}
function sendChat(raw) {
  const text = String(raw).replace(/[\u0000-\u001f]/g, '').trim().slice(0, 140);
  if (!text) return;
  addMessage('user', text);
  if (state.mode === 'pet') {
    if (/提示|怎么下|下哪/.test(text) && canPlay()) { offerHint(true); return; }
    let reply;
    if (/规则|怎么玩/.test(text)) reply = '我们轮流放棋子。横着、竖着、斜着，先连成五颗就赢；黑棋先下，没有禁手，也不用倒计时。';
    else if (/夸|厉害/.test(text)) reply = state.game.moves.length ? `你已经认真走了 ${Math.ceil(state.game.moves.length / 2)} 步。我喜欢你愿意停下来想一想的样子。` : '愿意坐下来一起玩，就是今天很好的开始。第一颗棋子等你啦。';
    else if (/累|休息|慢/.test(text)) reply = '那就慢一点。棋盘会等你，没有倒计时，我也不催你。';
    else if (/输|赢/.test(text)) reply = '想赢的时候我们一起认真；想放松的时候，一盘棋也可以只是陪伴。';
    else reply = '嗯，我在棋盘旁陪你。想看看下一步，可以叫我“给一点提示”；也可以歇一会儿再下。';
    setSpeech(reply); addMessage('pet', reply); publish();
  } else {
    publish();
    if (state.familyControl !== 'auto') return;
    later(() => {
      const reply = /吃|饭/.test(text) ? '吃过啦，今天煮了热乎乎的饭。你也记得好好吃，我等你落子。' : /慢|急/.test(text) ? '好，我慢慢想。你陪着我，就很开心啦。' : /厉害|好/.test(text) ? '哈哈，你小时候也是这样夸我的。轮到你啦。' : '好呀，听见啦。先把这盘下完，咱们再接着聊。';
      state.elderSpeech = reply; addMessage('elder', reply); publish();
    }, 850);
  }
}
function handlePeerCommand(command) {
  if (!command || typeof command !== 'object') return;
  // A bound window may close just as the owner starts a new game. Releasing its
  // unique projection identity is safe even if it has not seen the new gameId.
  if (command.gameId !== state.gameId && command.type !== 'projection-release') return;
  if (['projection-geometry', 'projection-claim', 'projection-release'].includes(command.type)) {
    const next = updateProjectionBinding(projectionBinding, command);
    if (next !== projectionBinding) {
      projectionBinding = next;
      state.projectionGeometry = next.geometry;
      state.activeProjectionId = next.activeProjectionId;
      publish();
    }
    return;
  }
  if (state.mode !== 'family' || state.demo) return;
  if (command.type === 'move' && state.familyControl === 'manual' && Number.isInteger(command.index) && state.game.turn === 2) {
    if (makeMove(command.index, 2) && !state.game.winner && !state.game.draw) {
      state.elderSpeech = `我落在 ${coordinates(command.index)} 啦。轮到你，慢慢看。`;
      publish();
    }
  } else if (command.type === 'chat' && typeof command.text === 'string') {
    const text = command.text.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 140);
    if (!text) return;
    state.elderSpeech = text; addMessage('elder', text); publish();
  }
}

const demoMoves = [112,96,113,97,114,98,115,99,116];
function startDemo() {
  reset(); state.demo = true; state.familyControl = 'auto'; demoStep = 0;
  setSpeech('这是提前编排的小棋局。一起看看，五颗棋子怎样开成一朵花。');
  addMessage('pet', '演示开始：这是一盘提前编排的示例棋局。'); publish();
  const tick = () => {
    const index = demoMoves[demoStep++], player = state.game.turn;
    state.game = playMove(state.game, index);
    finishMove(player, index);
    if (demoStep === demoMoves.length) {
      state.demo = false;
      setSpeech('示例里的五颗棋子连起来啦。准备好了，就开一盘真正属于你的棋。');
      state.pet.growthStage = 3;
      publish(); toast('演示结束。点击“新的一局”开始自己下棋。');
    } else { state.phase = 'thinking'; publish(); later(tick, 1800); }
  };
  later(tick, 1800);
}

document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => {
  if (button.dataset.mode === state.mode) return;
  askReset(() => reset(button.dataset.mode), '换一位棋盘小搭子？', '切换陪伴方式后会开始一盘新棋。');
}));
$('#chess-level').addEventListener('change', event => { level = event.target.value === 'balanced' ? 'balanced' : 'gentle'; publish(); });
$('#place-button').onclick = () => { if (selected !== null) makeMove(selected, 1); };
$('#confirm-move').onchange = () => { selected = null; renderBoard(); };
$('#undo-button').onclick = undo;
$('#hint-button').onclick = () => offerHint();
$('#restart-button').onclick = () => askReset(() => reset());
$('#demo-button').onclick = () => state.demo ? reset() : askReset(startDemo, '看一盘小小的示例棋局？', '当前棋局会结束。演示约 18 秒，途中可随时结束。');
$('#family-auto').onchange = event => {
  cancelPending(); state.familyControl = event.target.checked ? 'auto' : 'manual';
  state.phase = state.game.winner || state.game.draw ? 'ended' : 'playing';
  setSpeech(event.target.checked ? '奶奶的模拟对手会自动落子，你继续执黑就好。' : '白棋交给长辈端窗口。我们一人一手，慢慢来。');
  publish(); scheduleOpponent();
};
$('#family-open').onclick = event => {
  if (state.demo) { event.preventDefault(); toast('先结束小演示，再打开长辈端一起下棋。'); return; }
  cancelPending(); state.familyControl = 'manual';
  state.phase = state.game.winner || state.game.draw ? 'ended' : 'playing';
  setSpeech('长辈端用白棋，你在这里用黑棋。两个窗口一起演示一盘棋。'); publish();
};
$('#chess-chat').onsubmit = event => { event.preventDefault(); const input = $('#chess-chat-input'); sendChat(input.value); input.value = ''; };
$('#chess-quick').onclick = event => { const button = event.target.closest('[data-quick]'); if (button) sendChat(button.dataset.quick); };
$('#rules-open').onclick = () => {
  $('#dialog-content').innerHTML = '<h2>一盘不着急的五子棋</h2><p>你执黑先下，伙伴执白。轮流在空交叉点落子，横、竖、斜任意方向连成五颗或更多，即可获胜。采用自由五子棋，没有禁手。</p><p>“悔一步”会退回你上一手之前；“给点提示”会圈出一个可考虑的位置。手机上默认先选位置、再确认落子。方向键也能移动，回车选点。</p><p>“和家人一起”是本机模拟，可打开长辈端演示双方操作；目前没有跨设备连线或视频通话。小花只属于这一盘棋，不修改原来的成长记录。</p>';
  $('#dialog-cancel').hidden = true; $('#dialog-confirm').textContent = '知道啦，开始下棋'; confirmAction = null;
  $('#chess-dialog').showModal();
};
$('#dialog-cancel').onclick = () => { confirmAction = null; $('#chess-dialog').close(); };
$('#dialog-confirm').onclick = () => { const action = confirmAction; confirmAction = null; $('#chess-dialog').close(); action?.(); };
$('#chess-dialog').addEventListener('cancel', () => { confirmAction = null; });
visionController = mountChessVision({
  host: $('#chess-vision-root'),
  getState: () => state,
  onMove: index => state.mode === 'pet' && canPlay() && makeMove(index, 1),
  onStatus: status => {
    if (!status || typeof status !== 'object' || JSON.stringify(state.vision) === JSON.stringify(status)) return;
    state.vision = status;
    publish();
  },
});
addEventListener('pagehide', () => { visionController?.destroy(); cancelPending(); clearTimeout(toastTimer); session.close(); });
publish();
