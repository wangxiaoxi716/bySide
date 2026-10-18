import {mountLiveUI} from './live-ui.js';
import {discoverLocalAI} from './live.js';
import { getState, subscribe } from './state.js';
import { characterArt, miniStats } from './stage.js';
import { startModeSync } from './mode-sync.js';

const root = document.querySelector('#projection-root');
const SCENE_WIDTH = 510;
const SCENE_HEIGHT = 300;
let previous = '';

function render(s) {
  const key = JSON.stringify([s.character, s.customImage, s.mood, s.motion, s.growthStage, s.flowerCount, s.flowerStyle]);
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
  root.style.left = `${Math.max(0, Math.min(offsetX, width - SCENE_WIDTH * scale))}px`;
  root.style.top = `${Math.max(0, Math.min(offsetY, height - SCENE_HEIGHT * scale))}px`;
  root.style.transform = `scale(${scale})`;

  if (!root.firstElementChild) {
    root.innerHTML = '<div class="projection-scene"><div class="projection-rug"></div><div class="projection-character"></div><div class="projection-bubble" aria-live="polite"></div><div class="projection-stats"></div><div id="projection-live-status" aria-live="polite"></div></div>';
  }
  if (key !== previous) {
    root.querySelector('.projection-character').innerHTML = characterArt(s);
    previous = key;
  }
  root.querySelector('.projection-bubble').textContent = s.speech;
  const stats = root.querySelector('.projection-stats');
  stats.innerHTML = miniStats(s);
  stats.hidden = !p.showStats;
}

render(getState());
subscribe(render);
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
document.querySelector('#projection-live').onclick=()=>liveUI.open();
discoverLocalAI();

// Hardware mode sync: switch this projection window to the chess scene.
startModeSync((mode) => {
  if (mode === 'chess') location.replace('./chess-projection.html');
});
