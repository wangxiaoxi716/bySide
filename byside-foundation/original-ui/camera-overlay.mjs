import {chooseAutoCamera,availableAutoCamera} from './camera-start.mjs';
import {createPlaneTracker,detectWhitePaper} from './plane-tracker.mjs';
import {validQuad,planeTransform,transformPoint,cameraRect,cssMatrix,projectionRegion} from './plane-geometry.mjs';
import {publishDesktopCamera} from './desktop-camera.js';

const PREF='yatuan:ar-camera:v1', FOUNDATION_PREF='byside.foundation.camera';
const PLACEMENT='yatuan:ar-placement:v1';
const $=selector=>document.querySelector(selector);
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
function read(key){try{return JSON.parse(localStorage.getItem(key)||'null');}catch{return null;}}
function save(key,value){try{localStorage.setItem(key,JSON.stringify(value));}catch{}}
function loadCv(){
  return new Promise((resolve,reject)=>{
    let timer;const finish=()=>{clearTimeout(timer);resolve();};
    const initialized=()=>{if(window.cv?.Mat){finish();return;}if(window.cv)window.cv.onRuntimeInitialized=finish;else reject(new Error('视觉组件未加载。'));};
    if(window.cv){initialized();return;}
    const script=document.createElement('script');script.src='./vendor/opencv.js';script.onload=initialized;script.onerror=()=>reject(new Error('视觉组件加载失败，请检查本地文件。'));document.head.append(script);
    timer=setTimeout(()=>reject(new Error('视觉组件启动超时，请刷新页面重试。')),20000);
  });
}
export function mountCameraOverlay({root, liveUI, restoreProjection}){
  const panel=$('#ar-panel'),bg=$('#projection-camera'),drawing=$('#ar-canvas'),status=$('#ar-status'),select=$('#ar-device'),begin=$('#ar-start'),sizing=$('#ar-scale');
  const ctx=drawing.getContext('2d'),sample=document.createElement('canvas'),sampleCtx=sample.getContext('2d',{willReadFrequently:true});
  let active=false,stream=null,tracker=null,tracking=false,selecting=false,points=[],quad=null,frameId=0,lastFrame=0,lastEffect=0,gen=0,releaseLock=null,drag=null,starting=false,searching=false,autoWaiting=false,rechecking=false;
  let stopSharingCamera = null;
  let preferred=read(PREF)||read(FOUNDATION_PREF), position=read(PLACEMENT)||{x:0.15,y:0.2,scale:0.6};
  if(!Number.isFinite(position.x)||!Number.isFinite(position.y)||!Number.isFinite(position.scale))position={x:.15,y:.2,scale:.6};
  position={x:clamp(position.x,0,.95),y:clamp(position.y,0,.95),scale:clamp(position.scale,.2,1)};sizing.value=position.scale;
  const message=text=>{status.textContent=text;};
  const savePosition=()=>save(PLACEMENT,position);
  const localRect=()=>cameraRect(innerWidth,innerHeight,bg.videoWidth||1,bg.videoHeight||1);
  const toScreen=p=>{const r=localRect();return{x:r.x+p.x/sample.width*r.width,y:r.y+p.y/sample.height*r.height};};
  const toVideo=p=>{const r=localRect();return{x:(p.x-r.x)/r.width*sample.width,y:(p.y-r.y)/r.height*sample.height};};
  function layout(){
    drawing.width=innerWidth*devicePixelRatio;drawing.height=innerHeight*devicePixelRatio;drawing.style.width=innerWidth+'px';drawing.style.height=innerHeight+'px';ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);
    drawGuides();render();
  }
  function drawGuides(){
    ctx.clearRect(0,0,innerWidth,innerHeight);if(!selecting)return;
    const ps=points.map(toScreen);ctx.strokeStyle='#d9f09f';ctx.fillStyle='#d9f09f';ctx.lineWidth=3;ctx.font='bold 16px sans-serif';
    ps.forEach((p,i)=>{ctx.beginPath();ctx.arc(p.x,p.y,7,0,Math.PI*2);ctx.fill();ctx.fillText(String(i+1),p.x+10,p.y-10);});
    if(ps.length){ctx.beginPath();ctx.moveTo(ps[0].x,ps[0].y);ps.slice(1).forEach(p=>ctx.lineTo(p.x,p.y));if(ps.length===4)ctx.closePath();ctx.stroke();}
  }
  function sampleFrame(){sampleCtx.drawImage(bg,0,0,sample.width,sample.height);return sampleCtx.getImageData(0,0,sample.width,sample.height);}
  function render(){
    if(!active)return false;
    if(!tracking||!quad||searching){root.hidden=true;return true;}
    const camera=quad.map(toScreen), base=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}];
    try{
      const plane=planeTransform(base,camera);
      const projected=projectionRegion(position).map(p=>transformPoint(plane,p));
      const source=[{x:0,y:0},{x:510,y:0},{x:510,y:300},{x:0,y:300}];
      const matrix=planeTransform(source,projected);
      root.hidden=false;root.style.left='0px';root.style.top='0px';root.style.transform=cssMatrix(matrix);
    }catch{root.hidden=true;}
    return true;
  }
  function stopTracking(){cancelAnimationFrame(frameId);frameId=0;tracker?.destroy();tracker=null;tracking=false;selecting=false;searching=false;points=[];quad=null;drawing.style.pointerEvents='none';drawGuides();root.hidden=true;}
  function release(){releaseLock?.();releaseLock=null;}
  function stopCamera(){autoWaiting=false;gen++;stopSharingCamera?.();stopSharingCamera=null;stopTracking();const old=stream;stream=null;old?.getTracks().forEach(t=>t.stop());bg.srcObject=null;release();begin.disabled=false;$('#ar-calibrate').disabled=true;$('#ar-paper').disabled=true;message('摄像头已关闭。');}
  async function lock(){
    if(!navigator.locks?.request)return true;
    return new Promise(resolve=>{navigator.locks.request('yatuan-live-devices',{ifAvailable:true},held=>{if(!held){resolve(false);return;}return new Promise(done=>{releaseLock=done;resolve(true);});}).catch(()=>resolve(false));});
  }
  async function devices(){
    try{const list=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput'&&d.deviceId);const old=select.value||preferred?.id||'';select.replaceChildren(new Option('选择摄像头',''));
      for(const [i,d] of list.entries())select.add(new Option(d.label||`摄像头 ${i+1}`,d.deviceId));
      let match=list.find(d=>d.deviceId===old);if(!match&&preferred?.label){const matches=list.filter(d=>d.label===preferred.label);if(matches.length===1)match=matches[0];}
      const wanted=match?.deviceId||old;if(wanted&&!list.some(d=>d.deviceId===wanted))select.add(new Option('上次选择的摄像头（待连接）',wanted));select.value=wanted;
    }catch{message('无法读取摄像头列表，请检查浏览器权限。');}
  }
  async function start(fromAuto=false){
    if(starting)return;if(!select.value){message('请先选择摄像头；如未显示名称，可刷新设备列表。');return;}
    stopCamera();starting=true;begin.disabled=true;const token=++gen;message('正在连接摄像头…');
    let next=null,timeout,expired=false;
    try{
      if(!await lock())throw new Error('摄像头正由桌边陪伴使用，请先结束陪伴。');
      if(token!==gen){release();return;}
      const pending=navigator.mediaDevices.getUserMedia({video:{deviceId:{exact:select.value},width:{ideal:1280},height:{ideal:720}},audio:false});
      pending.then(s=>{if(expired||token!==gen)s.getTracks().forEach(t=>t.stop());}).catch(()=>{});
      next=await Promise.race([pending,new Promise((_,reject)=>{timeout=setTimeout(()=>{expired=true;reject(new Error('连接摄像头超时，请检查 iPhone 后重试。'));},15000);})]);clearTimeout(timeout);
      if(token!==gen){next.getTracks().forEach(t=>t.stop());return;}
      stream=next;bg.srcObject=next;await Promise.race([bg.play(),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('预览加载超时，请重新连接摄像头。')),15000);})]);clearTimeout(timeout);if(token!==gen)return;
      stopSharingCamera = publishDesktopCamera(bg, 'AR 摄像头');
      const track=next.getVideoTracks()[0];track.addEventListener('mute',()=>{if(stream===next){stopTracking();message('摄像头画面暂停，请检查 iPhone 锁屏和连接状态。');}});track.addEventListener('unmute',()=>{if(stream===next&&!tracking){message('摄像头画面已恢复，请重新圈定桌面。');}});track.addEventListener('ended',()=>{if(stream===next){stopCamera();message('摄像头已断开，请检查 iPhone 并重新连接。');}}, {once:true});
      const actual=track.getSettings().deviceId||select.value;const list=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput');const matched=list.find(d=>d.deviceId===actual);preferred={id:actual,label:matched?.label||track.label||''};save(PREF,preferred);await devices();
      message('摄像头已连接，正在加载桌面追踪组件…');await loadCv();if(token!==gen)return;
      const width=640;sample.width=width;sample.height=Math.max(1,Math.round(width*bg.videoHeight/bg.videoWidth));$('#ar-calibrate').disabled=false;$('#ar-paper').disabled=false;message('点击“自动识别白纸”，或手动圈定投影区域。');layout();
    }catch(err){clearTimeout(timeout);if(token===gen){stopCamera();const e=err;message(e?.name==='NotAllowedError'?'摄像头权限被拒绝，请在浏览器允许后重试。':e?.name==='NotFoundError'||e?.name==='OverconstrainedError'?'所选摄像头不在线，请接好 iPhone 后刷新设备列表。':e?.name==='NotReadableError'?'摄像头不可用，可能正被其他页面或应用占用。':(e?.message||'摄像头连接失败。'));if(fromAuto&&(e?.name==='NotFoundError'||e?.name==='OverconstrainedError')){autoWaiting=true;message('正在等待手机摄像头上线；请将 iPhone 锁屏并放在 Mac 附近。');}}}
    finally{starting=false;if(token===gen)begin.disabled=false;}
  }
  function drawOriginalEffect(){
    const video=document.querySelector('.projection-bg-video'),canvas=root.querySelector('.ar-original-effects');
    if(!video||!canvas||video.readyState<2)return;
    const effect=canvas.getContext('2d',{willReadFrequently:true});
    try{effect.drawImage(video,0,0,canvas.width,canvas.height);const frame=effect.getImageData(0,0,canvas.width,canvas.height),data=frame.data;for(let i=0;i<data.length;i+=4){const light=Math.max(data[i],data[i+1],data[i+2]);data[i+3]=Math.min(255,Math.max(0,(light-8)*2.1));}effect.putImageData(frame,0,0);}catch{/* An unavailable decoration must not interrupt tracking. */}
  }
  function loop(now){
    if(!tracking||!stream)return;
    if(now-lastEffect>=80){lastEffect=now;drawOriginalEffect();}
    if(now-lastFrame>=90){lastFrame=now;try{const result=tracker.update(sampleFrame());if(!result.ok){stopTracking();message(result.reason);return;}if(result.uncertain){root.hidden=true;if(!searching){searching=true;message('暂时看不清白纸，正在原位置附近寻找；如无法恢复，请重新圈定。');}}else{quad=result.corners;if(searching){searching=false;message('白纸已重新找到，正在追踪。');}render();}}catch{stopTracking();message('桌面追踪中断，请重新圈定。');return;}}
    frameId=requestAnimationFrame(loop);
  }
  function beginTracking(quadInput,paper=false,paperCorners=null){
    position={x:0,y:0,scale:1};sizing.value=position.scale;savePosition();
    tracker=createPlaneTracker(window.cv);const result=tracker.start(sampleFrame(),quadInput,{paper,paperCorners});
    if(!result.ok){tracker.destroy();tracker=null;message(result.reason);return;}
    quad=result.corners;tracking=true;lastFrame=lastEffect=0;points=[];drawGuides();message(paper?'以白纸为参照追踪投影边界。请保持白纸固定在桌面上。':'正在追踪桌面。拖动芽团或调整大小。');render();frameId=requestAnimationFrame(loop);
  }
  $('#ar-paper').onclick=()=>{
    if(!stream||!window.cv?.Mat)return;stopTracking();
    try{const found=detectWhitePaper(window.cv,sampleFrame());if(!found){message('未找到清晰的白纸，请让整张纸出现在画面中，或手动圈定。');return;}beginTracking(found,true);}
    catch{message('识别白纸失败，请调整光线或手动圈定。');}
  };
  function calibrate(){if(!stream||!window.cv?.Mat)return;stopTracking();selecting=true;drawing.style.pointerEvents='auto';message('按左上→右上→右下→左下点四角，四角即完整投影画面的边界。');}
  drawing.addEventListener('pointerdown',e=>{
    if(!selecting)return;const p=toVideo({x:e.clientX,y:e.clientY});if(p.x<0||p.y<0||p.x>sample.width||p.y>sample.height)return;
    points.push(p);drawGuides();if(points.length<4)return;
    drawing.style.pointerEvents='none';selecting=false;
    if(!validQuad(points,500)){points=[];message('四角无效，请重新圈定，按顺时针选择且不要交叉。');drawGuides();return;}
    try{const found=detectWhitePaper(window.cv,sampleFrame());beginTracking(points,Boolean(found),found);points=[];drawGuides();}catch{tracker?.destroy();tracker=null;message('无法开始追踪，请重新圈定桌面。');}
  });
  root.addEventListener('pointerdown',e=>{if(!tracking||!quad)return;try{const inv=planeTransform(quad.map(toScreen),[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]);const p=transformPoint(inv,{x:e.clientX,y:e.clientY});drag={dx:p.x-position.x,dy:p.y-position.y};root.setPointerCapture(e.pointerId);e.preventDefault();}catch{}});
  root.addEventListener('pointermove',e=>{if(!drag||!quad)return;try{const inv=planeTransform(quad.map(toScreen),[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]);const p=transformPoint(inv,{x:e.clientX,y:e.clientY});position.x=clamp(p.x-drag.dx,0,1-position.scale);position.y=clamp(p.y-drag.dy,0,1-position.scale);render();}catch{}});
  root.addEventListener('pointerup',()=>{if(drag){drag=null;savePosition();}});root.addEventListener('pointercancel',()=>{drag=null;savePosition();});
  sizing.addEventListener('input',()=>{position.scale=Number(sizing.value);position.x=clamp(position.x,0,1-position.scale);position.y=clamp(position.y,0,1-position.scale);savePosition();render();});
  $('#ar-reset').onclick=()=>{position={x:0,y:0,scale:1};sizing.value=position.scale;savePosition();render();};
  $('#ar-refresh').onclick=devices;
  $('#ar-authorize').onclick=async()=>{
    if(stream||starting||liveUI.controller.getStatus().active){message('请先结束当前摄像头或桌边陪伴，再识别设备。');return;}
    let temporary=null;
    try{message('正在请求摄像头权限以识别设备…');temporary=await navigator.mediaDevices.getUserMedia({video:true,audio:false});temporary.getTracks().forEach(t=>t.stop());temporary=null;await devices();message('设备已刷新，请选择 iPhone 后连接。');}
    catch(e){message(e?.name==='NotAllowedError'?'摄像头权限被拒绝，请在浏览器允许后重试。':'暂时无法识别摄像头，请检查设备连接。');}
    finally{temporary?.getTracks().forEach(t=>t.stop());}
  };
  begin.onclick=()=>start(false);select.addEventListener('change',()=>{autoWaiting=false;});$('#ar-calibrate').onclick=calibrate;$('#ar-stop').onclick=stopCamera;
  function showBlack(){stopCamera();active=false;panel.hidden=true;document.body.classList.remove('ar-active');bg.hidden=true;root.hidden=false;$('#projection-ar').setAttribute('aria-pressed','false');$('#projection-black').setAttribute('aria-pressed','true');restoreProjection();}
  $('#ar-close').onclick=showBlack;
  $('#projection-black').onclick=showBlack;
  async function openOverlay(autoConnect=false){
    if(active && (stream || starting))return;
    active=true;panel.hidden=false;$('#projection-ar').setAttribute('aria-pressed','true');$('#projection-black').setAttribute('aria-pressed','false');document.body.classList.add('ar-active');bg.hidden=false;root.hidden=true;
    await devices();
    if(!active)return;
    if(!autoConnect){message('选择摄像头后点击连接；视频仅在本机处理。');return;}
    let list=[];try{list=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput');}catch{}
    if(!active)return;
    const selected=chooseAutoCamera(list,preferred);
    if(!selected){message('未找到已记住的手机摄像头，请选择 iPhone 后连接。');return;}
    if(!Array.from(select.options).some(option=>option.value===selected.id))select.add(new Option('上次选择的摄像头（待连接）',selected.id));
    select.value=selected.id;
    await start(true);
  }
  $('#projection-ar').onclick=()=>openOverlay(true);
  async function handleDeviceChange(){
    await devices();
    if(!active||!autoWaiting||rechecking||starting)return;
    rechecking=true;
    try{const list=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput');
      if(!active||!autoWaiting)return;
      const selected=availableAutoCamera(list,preferred);
      if(selected){select.value=selected.id;autoWaiting=false;await start(true);}
    }catch{}finally{rechecking=false;}
  }
  navigator.mediaDevices?.addEventListener('devicechange',handleDeviceChange);addEventListener('resize',layout);addEventListener('pagehide',()=>{stopCamera();navigator.mediaDevices?.removeEventListener('devicechange',handleDeviceChange);});
  return {render,isActive:()=>active,open:openOverlay};
}
