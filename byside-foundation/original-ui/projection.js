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
import { createFollowerMotion } from './marker-follow.mjs';

const root = document.querySelector('#projection-root');
const SCENE_WIDTH = 510;
const SCENE_HEIGHT = 300;
let previous = '';
let overlay = null;
const outputOnly=new URL(location.href).searchParams.get('display')==='1';
document.documentElement.toggleAttribute('data-projection-output',outputOnly);

function render(s) {
  s = getDemoCharacterState(s);
  const key = JSON.stringify([s.character, s.customImage, s.mood, s.motion, s.growthStage, s.flowerCount, s.flowerStyle, s.demoStep, getMotionAsset(s)]);
  const p = s.projection;
  const viewport = window.visualViewport;
  const width = Math.max(1, Math.min(innerWidth || 1, viewport?.width || innerWidth || 1));
  const height = Math.max(1, Math.min(innerHeight || 1, viewport?.height || innerHeight || 1));
  const requestedScale = Number.isFinite(p.scale) && p.scale > 0 ? p.scale : 1;
  const scale = Math.min(width * 0.82 / SCENE_WIDTH, height * 0.78 / SCENE_HEIGHT) * Math.min(requestedScale, 1);
  const offsetX = (width - SCENE_WIDTH * scale) / 2;
  const offsetY = (height - SCENE_HEIGHT * scale) / 2;
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
    root.querySelector('.projection-character').innerHTML = characterArt(s, { decorateAnimation: false });
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
  const mascot=root.querySelector('.gar-mascot');
  if(mascot&&mascot.dataset.motionKey!==key){
    mascot.innerHTML=characterArt({...s,character:'yatuan'},{decorateAnimation:false});
    mascot.dataset.motionKey=key;
  }
  overlay?.render();
}

render(getState());
subscribe(render);
subscribePresentation(() => render(getState()));
subscribeDemo(() => render(getState()));
addEventListener('resize', () => render(getState()));
window.visualViewport?.addEventListener('resize', () => render(getState()));
if(outputOnly) mountOutput();
else mountControls();

function mountOutput(){
  const controller=window.opener;
  const send=message=>controller?.postMessage({projectionOutput:true,...message},location.origin);
  const host=document.createElement('div'), dot=document.createElement('div'), intro=document.createElement('video');
  host.className='gar-root';host.hidden=true;root.append(host);
  dot.className='marker-calibration';dot.hidden=true;document.body.append(dot);
  intro.className='projection-output-intro';intro.hidden=true;intro.muted=true;intro.playsInline=true;
  document.body.prepend(intro);
  document.querySelector('.projection-bg-video').remove();
  const stopIntro=()=>{intro.pause();intro.hidden=true;};
  intro.addEventListener('ended',stopIntro);
  let calibrationTimer,reportFrame=0,gameView=null,lastReport=0;
  function reportBounds(){
      const rects=[...root.querySelectorAll('.projection-character,.projection-bubble,.gar-root')]
        .filter(element=>!element.closest('[hidden]')&&Number(getComputedStyle(element).opacity)>.1)
        .map(element=>{const {left,right,top,bottom}=element.getBoundingClientRect();return {left,right,top,bottom};});
      const fullscreen=Boolean(document.fullscreenElement)||(Math.abs(innerWidth-screen.width)<=2&&Math.abs(innerHeight-screen.height)<=2);
      send({type:'bounds',geometry:[innerWidth,innerHeight,devicePixelRatio,screenX,screenY,fullscreen],rects});
      lastReport=performance.now();
  }
  function report(){
    if(reportFrame||performance.now()-lastReport<60)return;
    reportFrame=requestAnimationFrame(()=>{reportFrame=0;reportBounds();});
  }
  function setCalibration(active,target){
    clearTimeout(calibrationTimer);
    document.body.classList.toggle('marker-calibrating',active);
    dot.hidden=!active||!target;
    if(!dot.hidden){dot.style.left=`${target.x*100}%`;dot.style.top=`${target.y*100}%`;}
    if(active)calibrationTimer=setTimeout(()=>setCalibration(false),2500);
  }
  const motion=createFollowerMotion(root,report);
  const redraw=()=>motion.redraw();
  window.addEventListener('message',event=>{
    if(event.origin!==location.origin||event.source!==controller||!event.data?.projectionControl)return;
    const message=event.data;
    if(message.type==='report-bounds')reportBounds();
    else if(message.type==='follow')motion.update(message.point,message.stoneMode);
    else if(message.type==='calibration')setCalibration(message.calibrating,message.target);
    else if(message.type==='game'){
      gameView=message.view;
      host.hidden=!gameView;root.querySelector('.projection-scene').hidden=Boolean(gameView);
      if(gameView)host.innerHTML=renderGameProjection(gameView);
      else host.replaceChildren();
      render(getState());redraw();
    }else if(message.type==='intro'){
      if(!intro.src)intro.src='./开场视频.mp4';
      intro.currentTime=0;intro.hidden=false;void intro.play().catch(stopIntro);
    }else if(message.type==='stop-intro')stopIntro();
  });
  const full=()=>{if(!document.fullscreenElement)void document.documentElement.requestFullscreen().catch(()=>{});};
  document.addEventListener('dblclick',full);
  document.addEventListener('keydown',event=>{if(event.key.toLowerCase()==='f')full();});
  document.addEventListener('fullscreenchange',()=>{redraw();reportBounds();});
  window.addEventListener('resize',redraw);
  const heartbeat=setInterval(reportBounds,1000);
  window.addEventListener('pagehide',()=>{clearInterval(heartbeat);send({type:'closed'});});
  subscribe(redraw);subscribePresentation(redraw);
  send({type:'ready'});reportBounds();
}

function mountControls(){
let displayWindow,displayGeometry,displayRects,presentedGame=null;
const output={
  connected:()=>Boolean(displayWindow&&!displayWindow.closed),
  geometry:()=>displayWindow&&!displayWindow.closed?displayGeometry:undefined,
  rects:()=>output.geometry()?displayRects:undefined,
  send:message=>{if(displayWindow&&!displayWindow.closed)displayWindow.postMessage({projectionControl:true,...message},location.origin);},
};
window.addEventListener('message',event=>{
  if(event.origin!==location.origin||!event.source||!event.data?.projectionOutput)return;
  if(event.source!==displayWindow){
    if(output.connected()||event.data.type==='closed')return;
    try{
      const sender=new URL(event.source.location.href);
      if(event.source.opener!==window||sender.origin!==location.origin||sender.pathname!==location.pathname||sender.searchParams.get('display')!=='1')return;
    }catch{return;}
    displayWindow=event.source;displayGeometry=undefined;displayRects=undefined;
    output.send({type:'game',view:presentedGame});
  }
  const message=event.data;
  if(message.type==='ready'){output.send({type:'game',view:presentedGame});output.send({type:'report-bounds'});}
  if(message.type==='bounds'){
    const changed=JSON.stringify(displayGeometry)!==JSON.stringify(message.geometry);
    displayGeometry=message.geometry;displayRects=message.rects;
    if(changed)overlay?.refreshOutput();
  }
  if(message.type==='closed'){displayGeometry=undefined;displayRects=undefined;overlay?.refreshOutput();}
});
const openDisplay=document.createElement('button');
openDisplay.type='button';openDisplay.textContent='打开纯投影输出';
document.querySelector('#projection-black').after(openDisplay);
openDisplay.onclick=()=>{
  if(output.connected()){output.send({type:'report-bounds'});displayWindow.focus();return;}
  const url=new URL('projection.html',location.href);url.searchParams.set('display','1');
  displayGeometry=undefined;displayRects=undefined;
  displayWindow=window.open(url,'yatuan-clean-output','popup,width=1000,height=650');
  if(displayWindow)document.querySelector('#projection-black').click();
  else document.querySelector('.projection-tools span').textContent='请允许弹出投影窗口';
};
const sendGame=view=>{presentedGame=view;output.send({type:'game',view});};
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
overlay=mountCameraOverlay({root,liveUI,output,restoreProjection:()=>render(getState())});
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
  else voiceStatus.textContent = voiceNotice || status.error || (overlay.isActive() ? '可结合桌面画面' : '');
  if (status.observing || (!status.active && !voiceStarting)) waitingForCamera = false;
  resumeArObservation(status);
}
liveUI.controller.subscribe(renderVoiceControl);
window.addEventListener('yatuan:ar-camera-ready', () => resumeArObservation(liveUI.controller.getStatus()));
voiceButton.addEventListener('click', async () => {
  if (voiceStopping) return;
  if (voiceStarting || liveUI.controller.getStatus().active) {
    overlay.stopIntro();
    output.send({type:'stop-intro'});
    voiceOperation++; voiceStarting = false; voiceStopping = true; waitingForCamera = false; voiceNotice = '';
    renderVoiceControl();
    try { await liveUI.stopDirect(); }
    finally { voiceStopping = false; renderVoiceControl(); }
    return;
  }
  const operation = ++voiceOperation;
  overlay.playIntro();
  output.send({type:'intro'});
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
  sendGame(view);
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
  render(getState());
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
  }
  sendGame(kind?{game:kind,snapshot,connected:true}:null);
  render(getState());
} });
companionButton.addEventListener('click', () => {
  if (voiceGame.isActive()) voiceGame.clear();
  else gameProjection.clear();
});
window.addEventListener('message', event => {
  if (event.origin !== location.origin || event.data?.type !== GAME_AR_MESSAGE || !validGameSelection(event.data)) return;
  voiceGame.discard();
  gameProjection.select(event.data);
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
}

