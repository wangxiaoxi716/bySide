import {mountLiveUI} from './live-ui.js';
import {discoverLocalAI} from './live.js';
import { getState, subscribe, subscribePresentation } from './state.js';
import { characterArt, miniStats } from './stage.js';
import { getMotionAsset } from './animations.js';
import { getDemoCharacterState, subscribeDemo } from './demo.js';
import { mountCameraOverlay } from './camera-overlay.mjs';
import { GAME_AR_MESSAGE, GAME_AR_WINDOW, createGameProjectionController, validGameSelection } from './game-ar-control.js';
import { renderGameProjection } from './game-ar-view.js';

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

const liveUI=mountLiveUI();
overlay=mountCameraOverlay({root,liveUI,restoreProjection:()=>render(getState())});
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
companionButton.addEventListener('click', () => gameProjection.clear());
window.addEventListener('message', event => {
  if (event.origin !== location.origin || event.data?.type !== GAME_AR_MESSAGE || !validGameSelection(event.data)) return;
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

