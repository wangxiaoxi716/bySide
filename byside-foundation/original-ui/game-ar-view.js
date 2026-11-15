import { esc } from './stage.js';
import { BOARD, MAX_ROUNDS, createGame as createMonopolyGame } from './monopoly-core.js';
import { TILE_ART, DICE_ART, monopolyAvatar } from './monopoly-assets.js';
import { BOARD_POSITIONS, validRollPresentation, stepOrigin } from './monopoly-animation.js';

const titles = { chess: '五子棋', 'tic-tac-toe': '井字棋', monopoly: '芽团大富翁' };
const money = value => Number.isFinite(value) ? value.toLocaleString('zh-CN') : '—';

function safeChess(snapshot, kind) {
  const game = snapshot?.game;
  const size = kind === 'chess' ? 225 : 9;
  if (!game || !Array.isArray(game.board) || game.board.length !== size) return null;
  if (kind === 'tic-tac-toe' && snapshot.kind !== 'tic-tac-toe') return null;
  return game;
}

function chessStatus(game, kind, snapshot) {
  if (!game) return '等待棋局';
  if (game.winner) {
    if (kind === 'tic-tac-toe') return `${game.winner === 1 ? 'X' : 'O'} 获胜`;
    return `${game.winner === 1 ? '黑棋' : '白棋'}获胜`;
  }
  if (game.draw) return '这一盘平局';
  if (kind === 'tic-tac-toe') return `轮到 ${game.turn === 1 ? 'X' : 'O'}`;
  return game.turn === 1 ? '轮到黑棋' : snapshot?.mode === 'family' ? '轮到家人' : '轮到芽团';
}

function gomokuBoard(game) {
  const board = game?.board || Array(225).fill(0);
  const winning = new Set(Array.isArray(game?.winningLine) ? game.winningLine : []);
  const last = game?.moves?.at(-1)?.index;
  const lines = Array.from({ length: 15 }, (_, index) => {
    const p = 14 + index * 18;
    return `<path d="M14 ${p}H266M${p} 14V266"/>`;
  }).join('');
  const stars = [[3,3],[3,11],[7,7],[11,3],[11,11]].map(([x,y]) => `<circle cx="${14 + x * 18}" cy="${14 + y * 18}" r="2.2"/>`).join('');
  const labels = Array.from({ length: 15 }, (_, index) => `<text x="${14 + index * 18}" y="9" text-anchor="middle">${String.fromCharCode(65 + index)}</text><text x="2" y="${17 + index * 18}">${index + 1}</text>`).join('');
  const stones = board.map((value, index) => {
    if (value !== 1 && value !== 2) return '';
    const x = 14 + index % 15 * 18, y = 14 + Math.floor(index / 15) * 18;
    return `<circle class="gar-stone ${value === 1 ? 'black' : 'white'}${winning.has(index) ? ' winning' : ''}" cx="${x}" cy="${y}" r="8"/>${last === index ? `<circle class="gar-latest" cx="${x}" cy="${y}" r="2"/>` : ''}`;
  }).join('');
  return `<div class="gar-gomoku" role="img" aria-label="同步的五子棋棋盘"><svg viewBox="0 0 280 280" aria-hidden="true"><g fill="#665b43" font-size="7" font-family="sans-serif">${labels}</g><g class="gar-lines">${lines}</g><g class="gar-stars">${stars}</g>${stones}</svg></div>`;
}

function ticTacToeBoard(game) {
  const board = game?.board || Array(9).fill(0);
  const winning = new Set(Array.isArray(game?.winningLine) ? game.winningLine : []);
  const last = game?.moves?.at(-1)?.index;
  return `<div class="gar-ttt" role="img" aria-label="同步的井字棋棋盘">${board.map((value, index) => `<div class="gar-ttt-cell${winning.has(index) ? ' winning' : ''}${last === index ? ' latest' : ''}"><small class="gar-cell-coord">${Math.floor(index / 3) + 1},${index % 3 + 1}</small><span class="${value === 2 ? 'o' : 'x'}">${value === 1 ? 'X' : value === 2 ? 'O' : ''}</span></div>`).join('')}</div>`;
}

function monopolyBoard(game, presentation, lastRoll) {
  const places = BOARD.map((tile, index) => {
    const owner = game.owners[index];
    const stepping = presentation?.phase === 'moving' && presentation.positions[game.turn] === index;
    const origin = stepping ? stepOrigin(presentation.previousPosition, index) : null;
    const occupants = game.players.map((player, number) => {
      if ((presentation?.positions[number] ?? player.position) !== index) return '';
      const avatar = monopolyAvatar(game.mode, number);
      return `<b class="gar-token token-${number}${stepping && number === game.turn ? ' is-stepping' : ''}"${stepping && number === game.turn ? ` style="--step-from-x:${origin.x};--step-from-y:${origin.y}"` : ''}>${avatar ? `<img src="${avatar}" alt="">` : '2'}</b>`;
    }).join('');
    const [row, column] = BOARD_POSITIONS[index];
    return `<div class="gar-town-tile${owner === 0 || owner === 1 ? ` owner-${owner}` : ''}${stepping ? ' is-travelling' : ''}" data-position="${index}" style="grid-row:${row};grid-column:${column}"><img src="${TILE_ART[index]}" alt=""><span>${esc(tile.name)}</span><div class="gar-tokens">${occupants}</div></div>`;
  }).join('');
  const face = presentation?.dice ?? game.dice ?? lastRoll?.dice;
  const dice = Number.isInteger(face) && face >= 1 && face <= 6 ? `<img src="${DICE_ART[face - 1]}" alt="${face} 点">` : '<span>✦</span>';
  const lastRollLabel = lastRoll && Number.isInteger(face) && face >= 1 && face <= 6 ? `<span>${esc(lastRoll.player)}掷出 ${face} 点</span>` : '';
  return `<div class="gar-town" role="img" aria-label="同步的大富翁棋盘"><div class="gar-town-center"><small>THE LITTLE TOWN</small><strong>芽团大富翁</strong><div class="gar-die${presentation?.phase === 'rolling' ? ' is-rolling' : ''}">${dice}</div>${lastRollLabel}<span>第 ${esc(game.round)} / ${MAX_ROUNDS} 轮</span></div>${places}</div>`;
}

function chessView(kind, snapshot) {
  const game = safeChess(snapshot, kind);
  const board = kind === 'chess' ? gomokuBoard(game) : ticTacToeBoard(game);
  const count = Array.isArray(game?.moves) ? game.moves.length : 0;
  const speech = typeof snapshot?.speech === 'string' ? snapshot.speech.slice(0, 90) : '在棋室开始一盘游戏吧。';
  return { board, status: chessStatus(game, kind, snapshot), meta: `已下 ${count} 手`, detail: speech };
}

function monopolyView(snapshot) {
  const candidate = snapshot?.kind === 'monopoly' ? snapshot.game : null;
  const game = candidate && Array.isArray(candidate.players) && candidate.players.length === 2 && Array.isArray(candidate.owners) && candidate.owners.length === BOARD.length ? candidate : createMonopolyGame();
  const presentation = validRollPresentation(snapshot?.presentation, game) ? snapshot.presentation : null;
  const player = game.players[game.turn] || game.players[0];
  const status = presentation?.phase === 'rolling' ? `${player.name}正在掷骰子`
    : presentation?.phase === 'showing' ? `掷出了 ${presentation.dice} 点`
      : presentation?.phase === 'moving' ? `${player.name}正在前进`
        : game.phase === 'ended' && game.result ? game.result.winner === null ? '平分秋色' : `${game.players[game.result.winner]?.name || '伙伴'}获胜` : `轮到${player.name}`;
  const players = game.players.map((p, index) => {
    const avatar = monopolyAvatar(game.mode, index);
    return `<div class="gar-player player-${index}${game.turn === index && game.phase !== 'ended' ? ' current' : ''}"><span aria-hidden="true">${avatar ? `<img src="${avatar}" alt="">` : '2'}</span><strong>${esc(p.name)}</strong><b>${money(p.money)}</b></div>`;
  }).join('');
  const card = snapshot?.lastCard;
  const detail = presentation?.phase === 'moving' ? `第 ${presentation.step} / ${presentation.dice} 步`
    : presentation ? '骰子和棋盘正在同步。'
      : card?.title ? `${card.title} · ${card.description || ''}` : game.history?.at(-1) || '掷骰子，开始小镇旅行。';
  return { board: monopolyBoard(game, presentation, snapshot?.voiceControlled ? snapshot.lastRoll : null), status, meta: players, detail: String(detail).slice(0, 100), players: true };
}

/** Render a read-only snapshot. Room state is never interpreted as HTML. */
export function renderGameProjection({ game, snapshot, connected }) {
  if (!titles[game]) return '';
  const view = game === 'monopoly' ? monopolyView(snapshot) : chessView(game, snapshot);
  const connection = snapshot?.voiceControlled ? '语音对局' : connected ? '已同步棋室' : snapshot ? '棋室已离线 · 保留最后画面' : '等待棋室连接';
  const instruction = snapshot?.voiceControlled ? '说出位置或操作，和芽团一起玩' : '在游戏页面操作 · 投影同步显示';
  const caption = snapshot?.voiceControlled ? '<p class="gar-voice-caption" aria-live="polite"></p>' : '';
  return `<div class="gar-layout" data-game="${game}">${view.board}<aside class="gar-info"><div class="gar-brand"><img src="icon.svg" alt=""><div><small>芽团 · 桌面游戏</small><strong>${titles[game]}</strong></div></div><div class="gar-status"><small>${esc(connection)}</small><strong>${esc(view.status)}</strong></div>${view.players ? `<div class="gar-players">${view.meta}</div>` : `<div class="gar-meta">${esc(view.meta)}</div>`}<p class="gar-detail">${esc(view.detail)}</p>${caption}<div class="gar-footer">${instruction}</div></aside></div>`;
}
