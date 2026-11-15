import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
import { findSavedCamera, zoomRange, setTrackZoom, type CameraPreference, type ZoomRange } from './camera';
import { createDoubaoVoiceSession } from '../../original-ui/doubao-voice.js';

type Companion = { character:string; customImage:string|null; personality:string; mood:string; motion:string; speech:string; energy:number; intimacy:number; growth:number; growthStage:number; flowerStyle:string; flowerCount:number; projectionX:number; projectionY:number; projectionScale:number; showStats:boolean };
type Message = { id:string; role:string; text:string };
type Memory = { id:string; text:string };
type Snapshot = { companion:Companion; messages:Message[]; memories:Memory[] };
const api = async (path:string, options:RequestInit = {}) => { const response = await fetch(`/api/v1${path}`, { ...options, headers: { 'Content-Type':'application/json', ...options.headers } }); const value = await response.json(); if (!response.ok) throw new Error(Array.isArray(value.message) ? value.message.join('，') : value.message || '请求失败'); return value; };
const post = (path:string, value:unknown) => api(path, {method:'POST',body:JSON.stringify(value)});
const patch = (path:string, value:unknown) => api(path, {method:'PATCH',body:JSON.stringify(value)});
const stages = ['初见 · 双叶','相伴 · 舒叶','积累 · 花苞','绽放 · 初花'];
const petPath = 'M77 370C61 304 125 266 213 262C223 221 270 180 355 197C333 225 313 239 284 247C311 242 340 253 356 271C327 288 293 282 272 277C331 279 368 317 377 352C389 331 415 338 425 360C432 383 412 400 391 407C381 460 350 491 303 502C323 519 281 532 253 523C235 530 212 522 210 515C201 529 159 530 148 517C111 508 85 491 71 468C43 474 27 455 39 426C38 406 53 381 77 370Z';
const humanPath = 'M676 693C680 672 712 664 735 681C759 694 768 718 762 743C766 765 758 778 749 786L758 811C764 835 755 853 747 862L745 890C746 912 749 933 752 950C770 953 785 962 781 974C775 987 748 989 730 977L719 965C709 976 698 983 683 978L679 987C660 997 632 989 632 976L630 966L583 969L581 899C572 891 571 880 578 872C587 862 606 860 628 861L633 845C627 831 634 802 647 787L655 761C643 744 651 707 676 693Z';
function Character({state, preview}:{state:Companion;preview?:number}) { const human=state.character==='human'; const id=React.useId().replaceAll(':',''); const stage=preview ?? state.growthStage; return <div className={`character mood-${state.mood}`}>{state.character==='custom' && state.customImage ? <img src={state.customImage}/> : <svg viewBox={human?'555 650 245 360':'15 175 420 365'} role="img" aria-label={human?'小予':'芽团'}><defs><clipPath id={id}><path d={human?humanPath:petPath}/></clipPath></defs><image href={`/assets/${human?'human-reference':'yatuan-reference'}.png`} width="1536" height="1024" clipPath={`url(#${id})`}/></svg>}{!human && stage>1 && <div className="flowers">{stage===2?'🌱':Array.from({length:state.flowerCount},(_,i)=><span key={i}>🌼</span>)}</div>}</div>; }
function App(){
 const [snap,setSnap]=useState<Snapshot|null>(null), [view,setView]=useState('home'), [input,setInput]=useState(''), [error,setError]=useState(''), [busy,setBusy]=useState(false), [mode,setMode]=useState(''), [memory,setMemory]=useState(''), [preview,setPreview]=useState<number|null>(null), [sound,setSound]=useState(true), [camera,setCamera]=useState(false), [devices,setDevices]=useState<MediaDeviceInfo[]>([]), [device,setDevice]=useState(''), [observe,setObserve]=useState(false), [interval,setIntervalValue]=useState(10), [observation,setObservation]=useState(''), [listening,setListening]=useState(false), [demo,setDemo]=useState<number|null>(null), [cameraStatus,setCameraStatus]=useState('摄像头尚未连接。'), [zoom,setZoom]=useState<ZoomRange|null>(null), [zoomStatus,setZoomStatus]=useState('连接摄像头后可检查缩放能力。');
 const video=useRef<HTMLVideoElement>(null), stream=useRef<MediaStream|null>(null), recognition=useRef<any>(null), request=useRef<string|null>(null), captureBusy=useRef(false), observationAbort=useRef<AbortController|null>(null), audio=useRef<HTMLAudioElement|null>(null), deviceId=useRef(crypto.randomUUID()), cameraGeneration=useRef(0), cameraStarting=useRef(false), preferredCamera=useRef<CameraPreference|null>(null), selectionTouched=useRef(false);
 const microphoneGeneration=useRef(0), microphoneLeaseTimer=useRef<number|null>(null);
 const projection=location.pathname==='/projection.html';
 useEffect(()=>{if(demo===null)return;const timer=window.setTimeout(()=>setDemo(demo>=5?null:demo+1),3000);return()=>clearTimeout(timer);},[demo]);
 const refresh=useCallback(async()=>{ try{setSnap(await api('/snapshot'));}catch(e){setError((e as Error).message);} },[]);
 useEffect(()=>{refresh();api('/health').then(v=>setMode(v.mode)).catch(()=>{}); const es=new EventSource('/api/v1/events'); es.addEventListener('companion.updated',refresh); es.addEventListener('message.created',refresh); es.addEventListener('memory.changed',refresh); es.addEventListener('memory.deleted',refresh); return ()=>es.close();},[refresh]);
 const registerDevice=useCallback(()=>post('/devices',{id:deviceId.current,name:'桌面浏览器',capabilities:['camera','microphone','speaker','projection']}),[]);
 const refreshCameras=useCallback(async()=>{
   try {
     const cameras=(await navigator.mediaDevices.enumerateDevices()).filter(item=>item.kind==='videoinput');
     setDevices(cameras);
     if (!selectionTouched.current && preferredCamera.current) {
       const match=findSavedCamera(cameras, preferredCamera.current);
       setDevice(match?.deviceId || preferredCamera.current.id);
     }
   } catch { setCameraStatus('无法读取摄像头列表，请检查浏览器权限后重试。'); }
 },[]);
 useEffect(()=>{
   try { const saved=JSON.parse(localStorage.getItem('byside.foundation.camera') || 'null'); if(saved && typeof saved.id==='string' && typeof saved.label==='string') preferredCamera.current=saved; } catch { /* Invalid saved settings can be ignored. */ }
   refreshCameras();
   navigator.mediaDevices?.addEventListener('devicechange',refreshCameras);
   return ()=>navigator.mediaDevices?.removeEventListener('devicechange',refreshCameras);
 },[refreshCameras]);
 useEffect(()=>{const release=()=>{for(const capability of ['camera','microphone']) fetch(`/api/v1/devices/${deviceId.current}/lease/${capability}`,{method:'DELETE',keepalive:true}).catch(()=>{});}; window.addEventListener('pagehide',release);return()=>window.removeEventListener('pagehide',release);},[]);
 const stop=useCallback(()=>{cameraGeneration.current++;microphoneGeneration.current++;if(microphoneLeaseTimer.current!==null)clearInterval(microphoneLeaseTimer.current);microphoneLeaseTimer.current=null;setCameraStatus('摄像头已关闭。');setZoom(null);setZoomStatus('连接摄像头后可检查缩放能力。');setObserve(false);setCamera(false);setListening(false);observationAbort.current?.abort();recognition.current?.stop();recognition.current=null;stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;if(video.current)video.current.srcObject=null;if(request.current)post(`/chat/${request.current}/cancel`,{}).catch(()=>{});audio.current?.pause();audio.current=null;speechSynthesis.cancel();api(`/devices/${deviceId.current}/lease/camera`,{method:'DELETE'}).catch(()=>{});api(`/devices/${deviceId.current}/lease/microphone`,{method:'DELETE'}).catch(()=>{});},[]);
 useEffect(()=>()=>stop(),[stop]);
 async function say(value:string){if(!sound)return; try {const data=await post('/speech',{text:value});const player=new Audio(`data:${data.mime};base64,${data.audio}`);audio.current=player;await player.play();} catch {const utter=new SpeechSynthesisUtterance(value);utter.lang='zh-CN';speechSynthesis.speak(utter);} }
 async function send(e?:React.FormEvent){e?.preventDefault();const value=input.trim();if(!value||busy)return;setInput('');setBusy(true);setError('');const id=crypto.randomUUID();request.current=id;try{const response=await post('/chat',{text:value,requestId:id});await say(response.message.text);}catch(err){setError((err as Error).message);}finally{request.current=null;setBusy(false);refresh();}}
 async function startCamera() {
   if (cameraStarting.current) return;
   cameraStarting.current = true;
   const generation = ++cameraGeneration.current;
   setError('');
   setCameraStatus('正在连接所选摄像头…');
   setObserve(false);
   observationAbort.current?.abort();
   stream.current?.getTracks().forEach(track => track.stop());
   stream.current = null;
   if (video.current) video.current.srcObject = null;
   setCamera(false);
   setZoom(null);
   setZoomStatus('正在检查摄像头缩放能力…');
   let next: MediaStream | null = null;
   try {
     await registerDevice();
     if (generation !== cameraGeneration.current) return;
     await post(`/devices/${deviceId.current}/lease`, { capability: 'camera' });
     if (generation !== cameraGeneration.current) return;
     setCameraStatus('正在等待浏览器和摄像头响应…');
     let timedOut = false;
     let timeout: number | undefined;
     const pending = navigator.mediaDevices.getUserMedia({ video: device ? { deviceId: { exact: device } } : true, audio: false });
     pending.then(late => {
       if (timedOut || generation !== cameraGeneration.current) late.getTracks().forEach(track => track.stop());
     }).catch(() => {});
     try {
       next = await Promise.race([pending, new Promise<never>((_, reject) => {
         timeout = window.setTimeout(() => { timedOut = true; reject(new Error('摄像头连接超时，请检查 iPhone 连续互通状态后重试。')); }, 15000);
       })]);
     } finally { window.clearTimeout(timeout); }
     if (generation !== cameraGeneration.current || !video.current) {
       next.getTracks().forEach(track => track.stop());
       return;
     }
     stream.current = next;
     video.current.srcObject = next;
     setCameraStatus('摄像头已连接，正在等待预览画面…');
     let playbackTimeout: number | undefined;
     try {
       await Promise.race([video.current.play(), new Promise<never>((_, reject) => {
         playbackTimeout = window.setTimeout(() => reject(new Error('预览画面加载超时，请重新连接摄像头。')), 15000);
       })]);
     } finally { window.clearTimeout(playbackTimeout); }
     if (generation !== cameraGeneration.current) {
       next.getTracks().forEach(track => track.stop());
       return;
     }
     setCamera(true);
     setCameraStatus('摄像头已连接。');
     const track = next.getVideoTracks()[0];
     track.addEventListener('ended', () => {
       if (stream.current === next) {
         stream.current = null; if (video.current) video.current.srcObject = null;
         observationAbort.current?.abort(); setCamera(false); setObserve(false); setZoom(null);
         setCameraStatus('摄像头连接已断开，请检查手机后重新连接。');
         setZoomStatus('摄像头已断开。');
         api(`/devices/${deviceId.current}/lease/camera`, {method:'DELETE'}).catch(()=>{});
       }
     }, { once: true });
     try {
       const cameras=(await navigator.mediaDevices.enumerateDevices()).filter(item=>item.kind==='videoinput');
       if (generation !== cameraGeneration.current) return;
       setDevices(cameras);
       const selected=cameras.find(item=>item.deviceId===track.getSettings().deviceId) || cameras.find(item=>item.deviceId===device);
       if (selected?.deviceId) {
         preferredCamera.current={id:selected.deviceId,label:selected.label};
         try { localStorage.setItem('byside.foundation.camera',JSON.stringify(preferredCamera.current)); } catch { /* Preview still works without storage. */ }
         setDevice(selected.deviceId);
       }
     } catch { /* A running preview remains usable if enumeration fails. */ }
     if (generation !== cameraGeneration.current || stream.current !== next) return;
     try {
       const range=zoomRange(track);
       if (range) {
         try { await setTrackZoom(track,range.min); } catch { /* Preserve the camera's current zoom if rejected. */ }
         if (generation !== cameraGeneration.current || stream.current !== next) return;
         setZoom(zoomRange(track) || range);
         setZoomStatus('滑到最左侧可获得浏览器提供的最广视角。');
       } else setZoomStatus('此摄像头未向浏览器提供缩放控制；可在 Mac 视频菜单尝试选择超广角。');
     } catch { setZoomStatus('无法读取摄像头缩放能力；可在 Mac 视频菜单尝试选择超广角。'); }
   } catch (err) {
     next?.getTracks().forEach(track => track.stop());
     if (generation === cameraGeneration.current) {
       stream.current = null;
       if (video.current) video.current.srcObject = null;
       setCameraStatus('摄像头未连接。');
       setZoomStatus('连接摄像头后可检查缩放能力。');
       setError(`摄像头无法启动：${(err as Error).message}`);
       api(`/devices/${deviceId.current}/lease/camera`, { method: 'DELETE' }).catch(() => {});
     }
   } finally {
     cameraStarting.current = false;
     if (generation !== cameraGeneration.current && !stream.current) {
       api(`/devices/${deviceId.current}/lease/camera`, { method: 'DELETE' }).catch(() => {});
     }
   }
 }
 useEffect(()=>{if(camera&&video.current&&stream.current){video.current.srcObject=stream.current;video.current.play().catch(()=>{});}},[camera,view]);
 async function inspect(){if(captureBusy.current||!video.current||!video.current.videoWidth)return;captureBusy.current=true;const c=document.createElement('canvas');c.width=768;c.height=Math.round(768*video.current.videoHeight/video.current.videoWidth);c.getContext('2d')?.drawImage(video.current,0,0,c.width,c.height);const controller=new AbortController();observationAbort.current=controller;try{const response=await api('/vision',{method:'POST',body:JSON.stringify({image:c.toDataURL('image/jpeg',0.7)}),signal:controller.signal});setObservation(response.description);}catch(err){if((err as Error).name!=='AbortError')setError((err as Error).message);}finally{captureBusy.current=false;observationAbort.current=null;}}
 useEffect(()=>{if(!observe)return;let cancelled=false;let timer:number;const loop=async()=>{await inspect();if(!cancelled)timer=window.setTimeout(loop,interval*1000);};loop();return()=>{cancelled=true;clearTimeout(timer);observationAbort.current?.abort();};},[observe,interval]);
 useEffect(()=>{if(!camera)return;const timer=window.setInterval(()=>post(`/devices/${deviceId.current}/lease`,{capability:'camera'}).catch(err=>{setError((err as Error).message);stop();}),15000);return()=>clearInterval(timer);},[camera,stop]);
 async function listen(){
   if(listening){microphoneGeneration.current++;recognition.current?.stop();recognition.current=null;if(microphoneLeaseTimer.current!==null)clearInterval(microphoneLeaseTimer.current);microphoneLeaseTimer.current=null;setListening(false);api(`/devices/${deviceId.current}/lease/microphone`,{method:'DELETE'}).catch(()=>{});return;}
   const generation=++microphoneGeneration.current;setListening(true);setError('');
   const finish=()=>{if(generation!==microphoneGeneration.current)return;microphoneGeneration.current++;if(microphoneLeaseTimer.current!==null)clearInterval(microphoneLeaseTimer.current);microphoneLeaseTimer.current=null;recognition.current=null;setListening(false);api(`/devices/${deviceId.current}/lease/microphone`,{method:'DELETE'}).catch(()=>{});};
   try{
     const health=await api('/health');await registerDevice();await post(`/devices/${deviceId.current}/lease`,{capability:'microphone'});
     if(generation!==microphoneGeneration.current){api(`/devices/${deviceId.current}/lease/microphone`,{method:'DELETE'}).catch(()=>{});return;}
     if(health.speech?.asrConfigured){
       const voice=createDoubaoVoiceSession({onText:(value:string)=>{if(generation!==microphoneGeneration.current)return;voice.stop();setInput(value);finish();},onInterim:(value:string)=>{if(generation===microphoneGeneration.current)setInput(value);},onError:(message:string)=>{if(generation===microphoneGeneration.current)setError(message);finish();},onEnd:finish});
       recognition.current=voice;if(!voice.start()){finish();return;}
     }else{
       const Constructor=(window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;if(!Constructor)throw new Error('当前浏览器不支持语音识别');
       const r=new Constructor();recognition.current=r;r.lang='zh-CN';r.onresult=(e:any)=>{if(generation===microphoneGeneration.current)setInput(e.results[0][0].transcript);};r.onend=finish;r.onerror=(e:any)=>{if(generation===microphoneGeneration.current)setError(`语音识别失败：${e.error}`);try{r.abort();}catch{}finish();};r.start();
     }
     microphoneLeaseTimer.current=window.setInterval(()=>post(`/devices/${deviceId.current}/lease`,{capability:'microphone'}).catch((err:Error)=>{recognition.current?.stop();setError(err.message);finish();}),15000);
   }catch(err){if(generation===microphoneGeneration.current)setError((err as Error).message);finish();}
 }
 async function upload(e:React.ChangeEvent<HTMLInputElement>){const file=e.target.files?.[0];if(!file)return;const reader=new FileReader();reader.onload=async()=>{try{await post('/characters/image',{image:reader.result});await refresh();}catch(err){setError((err as Error).message);}};reader.readAsDataURL(file);}
 if(!snap)return <div className="loading">正在连接芽团… {error}</div>; const s=snap.companion;
 if(projection)return <div className="projection"><div className="projection-scene" style={{left:s.projectionX,top:s.projectionY,transform:`scale(${s.projectionScale})`}}><Character state={s}/><div className="bubble">{s.speech}</div>{s.showStats&&<small>活力 {s.energy}　亲密 {s.intimacy}　成长 {s.growth}</small>}</div><button className="full" onClick={()=>document.documentElement.requestFullscreen()}>全屏</button></div>;
 return <div className="layout"><aside className="sidebar"><div className="brand"><span>✿</span><div>芽团<small>桌边的陪伴</small></div></div><p className="caption">一起过日子</p>{[['home','⌂','陪伴小屋'],['growth','♧','成长花园'],['memories','♡','我们的回忆'],['devices','◉','设备与观察'],['settings','⚙','偏好与设置']].map(([id,icon,label])=><button key={id} className={`nav ${view===id?'selected':''}`} onClick={()=>setView(id)}><b>{icon}</b>{label}</button>)}<div className="side-note">把一起度过的日子，<br/>慢慢长出来。<small>YOUR LITTLE EVERYDAY</small></div></aside><div className="workspace"><header><span>我的陪伴空间 <b>/ {view==='home'?'陪伴小屋':view==='growth'?'成长花园':view==='memories'?'我们的回忆':view==='devices'?'设备与观察':'偏好与设置'}</b></span><div><span className="mode">● {mode==='demo'?'本地演示':'AI 已连接'}</span><button className="dark" onClick={()=>window.open('/projection.html?session=default','projection')}>投影预览 ↗</button></div></header><main>{error&&<div className="error" onClick={()=>setError('')}>{error} ×</div>}
 {view==='home'&&<><div className="heading"><div><small>✳ 小小日常，正在发生</small><h1>今天，也一起慢慢长大。</h1><p>不用赶路的时候，就在这里坐一会儿。</p></div><button className="day" onClick={()=>setView('growth')}>🌱　{stages[s.growthStage]}</button></div><div className="home-grid"><div><section className="scene"><div className="scene-top">⌂ 森林里的小家 <button onClick={()=>setSound(!sound)}>{sound?'♫':'♪'}</button></div><p className="scene-hello">{s.character==='human'?'小予':'芽团'}在这里<small>今天也，很高兴见到你。</small></p><div className="scene-bubble">{demo===null?s.speech:['【演示】你好呀，我来桌边陪你啦。','【演示】今天也一起度过。','【演示】我们慢慢认识彼此。','【演示】谢谢你陪我说话。','【演示】看，一颗小花苞！','【演示】一起度过的日子开花啦。'][demo]}</div><Character state={s} preview={demo===null?undefined:demo<3?0:demo===3?1:demo===4?2:3}/><div className="ground"/><button className="switch" onClick={()=>setView('settings')}>切换形象 ↗</button></section><section className="story"><b>✿　陪伴，慢慢发生</b><p>一起聊聊天，看看眼前的世界，也记录我们共同成长的日子。</p><button onClick={()=>setDemo(demo===null?0:null)}>{demo===null?"播放 18 秒成长演示":"结束演示"}</button></section></div><div><section className="card"><h3>小小的成长 <button className="link" onClick={()=>setView('growth')}>去花园 ↗</button></h3>{[['今日活力',s.energy],['亲密度',s.intimacy],['成长进度',s.growth]].map(([n,v])=><div className="stat" key={n}><div>{n}<strong>{v}<small> /100</small></strong></div><div className="bar"><i style={{width:`${v}%`}}/></div></div>)}<p className="muted">每一份陪伴，都被好好留下。</p></section><section className="card chat"><h3>聊一会儿 <small>{mode==='demo'?'本地演示对话':'AI 陪伴'}</small></h3><div className="messages">{snap.messages.slice(-12).map(m=><div key={m.id} className={`message ${m.role}`}>{m.text}</div>)}{busy&&<div className="message assistant">正在想一想…</div>}</div><div className="suggestions"><button onClick={()=>setInput('今天有点累')}>今天有点累</button><button onClick={()=>setInput('请记住，我喜欢热乎乎的晚饭')}>记住我的偏好</button></div><form onSubmit={send}><input value={input} onChange={e=>setInput(e.target.value)} placeholder="和伙伴说点什么…"/><button type="button" onClick={listen}>{listening?'听着':'🎙'}</button><button className="send" disabled={busy}>➜</button></form></section></div></div></>}
 {view==='growth'&&<><div className="heading"><div><small>✳ 成长花园</small><h1>把日子，慢慢长成花。</h1><p>每一朵花，都有一个属于我们的来处。</p></div></div><div className="two"><section className="card garden"><small>{stages[preview??s.growthStage]}</small><Character state={s} preview={preview??undefined}/><p>每一份认真生活，都在悄悄发芽。</p></section><section className="card"><h3>属于你的绽放</h3><p className="muted">成长阶段预览</p><div className="options">{stages.map((t,i)=><button className={preview===i?'active':''} key={t} onClick={()=>setPreview(i)}>{['🌱','🌿','🌷','🌼'][i]}<br/>{t}</button>)}</div><button onClick={()=>setPreview(null)}>恢复当前成长</button><p className="muted">花朵颜色</p>{['cream','pink','blue'].map((c,i)=><button key={c} onClick={()=>patch('/companion',{flowerStyle:c})}>{['奶油黄','晨曦粉','晴空蓝'][i]}</button>)}<p className="muted">花朵数量</p>{[1,2,3].map(n=><button key={n} onClick={()=>patch('/companion',{flowerCount:n})}>{n} 朵</button>)}</section></div></>}
 {view==='memories'&&<><div className="heading"><div><small>✳ 我们的回忆</small><h1>小事，也被好好记住。</h1><p>你喜欢的口味、想留下的片刻，都可以慢慢告诉我。</p></div></div><section className="card"><form onSubmit={async e=>{e.preventDefault();if(memory.trim()){await post('/memories',{text:memory});setMemory('');refresh();}}}><input value={memory} onChange={e=>setMemory(e.target.value)} placeholder="留下一段回忆…"/><button className="dark">保存</button></form><div className="memory-grid">{snap.memories.map(m=><article key={m.id}><p>{m.text}</p><button onClick={async()=>{const value=window.prompt('编辑记忆',m.text);if(value?.trim()){await patch(`/memories/${m.id}`,{text:value});refresh();}}}>编辑</button><button onClick={async()=>{await api(`/memories/${m.id}`,{method:'DELETE'});refresh();}}>删除</button></article>)}</div></section></>}
 {view==='settings'&&<><div className="heading"><div><small>✳ 偏好与设置</small><h1>按你的习惯，慢慢相处。</h1><p>切换伙伴，调整陪伴的样子。</p></div></div><section className="card"><h3>选择伙伴</h3><div className="options">{[['yatuan','芽团'],['human','小予'],['custom','我的伙伴']].map(([id,name])=><button className={s.character===id?'active':''} key={id} onClick={()=>patch('/companion',{character:id})}>{name}</button>)}<label className="upload">上传形象<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={upload}/></label></div><h3>聊天风格</h3>{[['gentle','温柔倾听'],['lively','活泼元气'],['witty','轻松幽默']].map(([id,name])=><button className={s.personality===id?'active':''} key={id} onClick={()=>patch('/companion',{personality:id})}>{name}</button>)}<h3>投影设置</h3><label>大小 <input type="range" min="0.5" max="2" step="0.05" value={s.projectionScale} onChange={e=>patch('/companion',{projectionScale:Number(e.target.value)})}/></label><label>左边距 <input type="number" value={s.projectionX} onChange={e=>patch('/companion',{projectionX:Number(e.target.value)})}/></label><label>上边距 <input type="number" value={s.projectionY} onChange={e=>patch('/companion',{projectionY:Number(e.target.value)})}/></label><label><input type="checkbox" checked={s.showStats} onChange={e=>patch('/companion',{showStats:e.target.checked})}/> 显示状态条</label></section></>}
 {view==='devices'&&<><div className="heading"><div><small>✳ 桌边观察</small><h1>一起看看眼前的世界。</h1><p>由你开启摄像头和麦克风，随时结束陪伴。</p></div></div><section className="card device"><div><select aria-label="选择摄像头" value={device} onChange={e=>{selectionTouched.current=true;setDevice(e.target.value);}}><option value="">系统默认摄像头</option>{device&&!devices.some(d=>d.deviceId===device)&&<option value={device}>上次选择的摄像头（待连接）</option>}{devices.map(d=><option value={d.deviceId} key={d.deviceId}>{d.label||'摄像头'}</option>)}</select><button onClick={refreshCameras}>刷新设备列表</button><button onClick={startCamera}>连接所选摄像头</button><button onClick={stop}>结束陪伴</button></div><video ref={video} autoPlay muted playsInline/><p role="status">{cameraStatus}</p><p>{zoomStatus}</p>{zoom&&<div><label>画面缩放（左侧视角更广） <input aria-label="画面缩放" type="range" min={zoom.min} max={zoom.max} step={zoom.step} value={zoom.value} onChange={e=>setZoom({...zoom,value:Number(e.target.value)})}/></label><button onClick={async()=>{const track=stream.current?.getVideoTracks()[0];if(!track)return;try{await setTrackZoom(track,zoom.value);setZoom(zoomRange(track));setZoomStatus('已应用摄像头缩放。');}catch{setZoom(zoomRange(track));setZoomStatus('缩放调整失败，请使用 Mac 视频菜单调整。');}}}>应用缩放</button></div>}<div><button onClick={inspect} disabled={!camera}>拍照观察</button><select value={interval} onChange={e=>setIntervalValue(Number(e.target.value))}>{[5,10,15].map(n=><option key={n} value={n}>{n} 秒</option>)}</select><button disabled={!camera} onClick={()=>setObserve(!observe)}>{observe?'暂停观察':'开始定时观察'}</button></div><p>{observation||'观察结果会显示在这里。'}</p></section></>}
 </main><footer>一张桌子，两份陪伴。</footer></div></div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
