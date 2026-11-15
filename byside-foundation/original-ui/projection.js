import {mountLiveUI} from './live-ui.js';
import {discoverLocalAI} from './live.js';
import { getState, subscribe, subscribePresentation } from './state.js';
import { characterArt, miniStats } from './stage.js';
import { getMotionAsset } from './animations.js';
import { getDemoCharacterState, subscribeDemo } from './demo.js';
import { mountCameraOverlay } from './camera-overlay.mjs';
import { GAME_AR_MESSAGE, GAME_AR_WINDOW, createGameProjectionController, validGameSelection } from './game-ar-control.js';
import { renderGameProjection } from './game-ar-view.js';
import { createVoiceGameController, voiceGameTools } from './voice-games.js';

const root = document.querySelector('#projection-root');
const SCENE_WIDTH = 510;
const SCENE_HEIGHT = 300;
let previous = '';
let overlay = null;

function render(s) {
  s = getDemoCharacterState(s);
  const key = JSON.stringify([s.character, s.customImage, s.mood, s.motion, s.growthStage, s.flowerCount, s.flowerStyle, s.demoStep, getMotionAsset(s)]);
  const p = s.projection;
  const viewport = window.visualViewport;
  const width = Math.max(1, Math.min(innerWidth || 1, viewport?.width || innerWidth || 1));
  const height = Math.max(1, Math.min(innerHeight || 1, viewport?.height || innerHeight || 1));
  const requestedScale = Number.isFinite(p.scale) && p.scale > 0 ? p.scale : 1;
  const scale = Math.min(requestedScale, width / SCENE_WIDTH, height / SCENE_HEIGHT);
  const offsetX = Number.isFinite(p.x) ? p.x : 0;
  const offsetY = Number.isFinite(p.y) ? p.y : 0;
  // Bounds must use the complete transformed scene, including its speech bubble.
  // On narrow/short screens, shrink first and then clamp the requested offsets.
  if (!overlay?.isActive()) {
  root.style.left = `${Math.max(0, Math.min(offsetX, width - SCENE_WIDTH * scale))}px`;
  root.style.top = `${Math.max(0, Math.min(offsetY, height - SCENE_HEIGHT * scale))}px`;
  root.style.transform = `scale(${scale})`;
  }

  if (!root.firstElementChild) {
    root.innerHTML = '<div class="projection-scene"><canvas class="ar-original-effects" width="510" height="300" aria-hidden="true"></canvas><div class="projection-rug"></div><div class="projection-character"></div><div class="projection-bubble" aria-live="polite"></div><div class="projection-stats"></div><div id="projection-live-status" aria-live="polite"></div></div>';
  }
  if (key !== previous) {
    root.querySelector('.projection-character').innerHTML = characterArt(s);
    previous = key;
  }
  const bubble = root.querySelector('.projection-bubble');
  if (bubble.textContent !== s.speech) {
    bubble.textContent = s.speech;
    bubble.scrollTop = bubble.scrollHeight;
  }
  const stats = root.querySelector('.projection-stats');
  stats.innerHTML = miniStats(s);
  stats.hidden = !p.showStats;
  const gameCaption = root.querySelector('.gar-voice-caption');
  if (gameCaption && gameCaption.textContent !== s.speech) gameCaption.textContent = s.speech;
  overlay?.render();
}

render(getState());
subscribe(render);
subscribePresentation(() => render(getState()));
subscribeDemo(() => render(getState()));
addEventListener('resize', () => render(getState()));
window.visualViewport?.addEventListener('resize', () => render(getState()));
document.querySelector('#projection-fullscreen').onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    document.querySelector('.projection-tools span').textContent = '请使用浏览器的全屏功能';
  }
};

let voiceGame;
const liveUI=mountLiveUI({
  realtimeTools: voiceGameTools,
  onRealtimeToolCall: item => {
    if (!voiceGame) return { ok: false, message: '游戏正在准备，请稍后再试。' };
    if (!voiceGame.isActive() && gameProjection.isActive() && item.name === 'operate_tabletop_game') {
      return { ok: false, message: '当前棋盘由其他窗口控制。请先说开始一局语音对局。' };
    }
    const result = voiceGame.handleTool(item);
    if (item.name === 'open_tabletop_game' && result.ok && root.hidden) {
      return { ...result, message: `${result.message} 若要看到 AR 棋盘，请连接摄像头并识别白纸或手动圈定桌面。` };
    }
    return result;
  },
});
overlay=mountCameraOverlay({root,liveUI,restoreProjection:()=>render(getState())});
const voiceButton = document.querySelector('#projection-voice');
const voiceStatus = document.querySelector('#projection-voice-status');
let voiceStarting = false, voiceStopping = false, voiceOperation = 0, voiceNotice = '', waitingForCamera = false;

function resumeArObservation(status) {
  const camera = document.querySelector('#projection-camera').srcObject;
  if (!waitingForCamera || !status.active || !status.visionEnabled || status.observing || status.voiceState !== 'listening' || !camera?.getVideoTracks().some(track => track.readyState === 'live')) return;
  waitingForCamera = false;
  queueMicrotask(() => { void liveUI.controller.wake(); });
}
function renderVoiceControl(status = liveUI.controller.getStatus()) {
  const active = voiceStarting || status.active;
  voiceButton.disabled = voiceStopping;
  voiceButton.textContent = voiceStopping ? '正在结束…' : active ? '结束实时语音' : '开始实时语音';
  voiceButton.setAttribute('aria-pressed', String(active));
  const messages = { starting: '正在连接…', listening: status.observing ? '正在听你说话 · 桌面观察已开启' : '正在听你说话', thinking: '正在思考…', speaking: '芽团正在回应…', stopping: '正在结束…' };
  if (voiceStopping) voiceStatus.textContent = '正在结束…';
  else if (voiceStarting && !status.active) voiceStatus.textContent = '正在连接…';
  else if (status.active) {
    const connected = ['listening', 'thinking', 'speaking'].includes(status.voiceState);
    if (status.error) voiceStatus.textContent = status.error;
    else if (status.voiceWarning) voiceStatus.textContent = connected ? `语音已连接。${status.voiceWarning}` : status.voiceWarning;
    else voiceStatus.textContent = messages[status.voiceState] || '正在连接…';
  }
  else voiceStatus.textContent = voiceNotice || status.error || '可结合桌面画面';
  if (status.observing || (!status.active && !voiceStarting)) waitingForCamera = false;
  resumeArObservation(status);
}
liveUI.controller.subscribe(renderVoiceControl);
window.addEventListener('yatuan:ar-camera-ready', () => resumeArObservation(liveUI.controller.getStatus()));
voiceButton.addEventListener('click', async () => {
  if (voiceStopping) return;
  if (voiceStarting || liveUI.controller.getStatus().active) {
    voiceOperation++; voiceStarting = false; voiceStopping = true; waitingForCamera = false; voiceNotice = '';
    renderVoiceControl();
    try { await liveUI.stopDirect(); }
    finally { voiceStopping = false; renderVoiceControl(); }
    return;
  }
  const operation = ++voiceOperation;
  voiceStarting = true; waitingForCamera = true; voiceNotice = '';
  renderVoiceControl();
  try { await liveUI.startDirect(); }
  catch (error) { if (operation === voiceOperation && error.name !== 'AbortError') voiceNotice = error.message || '实时语音暂时不可用。'; }
  finally {
    if (operation === voiceOperation) { voiceStarting = false; renderVoiceControl(); }
  }
});
window.name = GAME_AR_WINDOW;
const gameHost = document.createElement('div');
gameHost.className = 'gar-root';
gameHost.hidden = true;
root.append(gameHost);
const companionButton = document.querySelector('#projection-companion');
let gameRenderKey = '';
const gameProjection = createGameProjectionController({ onUpdate(view) {
  root.querySelector('.projection-scene').hidden = Boolean(view);
  gameHost.hidden = !view;
  companionButton.hidden = !view;
  if (view) {
    const key = JSON.stringify(view);
    if (key !== gameRenderKey) gameHost.innerHTML = renderGameProjection(view);
    gameRenderKey = key;
  } else {
    gameHost.replaceChildren();
    gameRenderKey = '';
  }
  overlay.render();
} });
voiceGame = createVoiceGameController({ onChange(kind, snapshot) {
  if (!kind) {
    root.querySelector('.projection-scene').hidden = false;
    gameHost.hidden = true; companionButton.hidden = true; gameHost.replaceChildren();
  } else {
    if (gameProjection.isActive()) gameProjection.clear();
    root.querySelector('.projection-scene').hidden = true;
    gameHost.hidden = false; companionButton.hidden = false;
    gameHost.innerHTML = renderGameProjection({ game: kind, snapshot, connected: true });
    const caption = gameHost.querySelector('.gar-voice-caption');
    if (caption) caption.textContent = getState().speech;
    if (!overlay.isActive()) void overlay.open(false);
  }
  overlay.render();
} });
companionButton.addEventListener('click', () => {
  if (voiceGame.isActive()) voiceGame.clear();
  else gameProjection.clear();
});
window.addEventListener('message', event => {
  if (event.origin !== location.origin || event.data?.type !== GAME_AR_MESSAGE || !validGameSelection(event.data)) return;
  voiceGame.discard();
  gameProjection.select(event.data);
  if (!overlay.isActive()) overlay.open(false);
});
document.documentElement.dataset.gameArReady = '1';
window.addEventListener('pagehide', () => gameProjection.clear(), { once: true });
const launchUrl=new URL(location.href);
const autoConnect=launchUrl.searchParams.get('ar')==='1';
const initialGame = { game: launchUrl.searchParams.get('game'), room: launchUrl.searchParams.get('room') };
if (validGameSelection(initialGame)) gameProjection.select(initialGame);
if(autoConnect){launchUrl.searchParams.delete('ar');history.replaceState(history.state,'',launchUrl.href);}
overlay.open(autoConnect);
document.querySelector('#projection-live').onclick=()=>liveUI.open();
discoverLocalAI();

