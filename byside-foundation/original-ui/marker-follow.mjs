import { planeTransform, transformPoint, validQuad } from './plane-geometry.mjs';

const STORAGE = 'yatuan:projector-marker:v1';
const GRID = [{x:0,y:0},{x:6,y:0},{x:6,y:6},{x:0,y:6}];
const TARGETS = [{x:.16,y:.16},{x:.84,y:.16},{x:.84,y:.84},{x:.16,y:.84}];
const MARKER = '1011010100110010';

export function markerMatches(bits) {
  for (let turn=0;turn<4;turn++) {
    if (bits.join('')===MARKER) return true;
    bits=Array.from({length:16},(_,index)=>bits[(3-index%4)*4+Math.floor(index/4)]);
  }
  return false;
}

export function findMarker(cv,frame) {
  const rgba=cv.matFromImageData(frame), gray=new cv.Mat(), binary=new cv.Mat(), contours=new cv.MatVector(), hierarchy=new cv.Mat();
  try {
    cv.cvtColor(rgba,gray,cv.COLOR_RGBA2GRAY);
    cv.threshold(gray,binary,0,255,cv.THRESH_BINARY_INV|cv.THRESH_OTSU);
    cv.findContours(binary,contours,hierarchy,cv.RETR_LIST,cv.CHAIN_APPROX_SIMPLE);
    for(let index=0;index<contours.size();index++) {
      const contour=contours.get(index), polygon=new cv.Mat();
      try {
        const area=Math.abs(cv.contourArea(contour));
        if(area<220||area>frame.width*frame.height*.15)continue;
        cv.approxPolyDP(contour,polygon,cv.arcLength(contour,true)*.035,true);
        if(polygon.rows!==4||!cv.isContourConvex(polygon))continue;
        const corners=Array.from({length:4},(_,i)=>({x:polygon.data32S[i*2],y:polygon.data32S[i*2+1]}));
        if(!validQuad(corners,220))continue;
        if((corners[1].x-corners[0].x)*(corners[2].y-corners[1].y)-(corners[1].y-corners[0].y)*(corners[2].x-corners[1].x)<0)corners.reverse();
        const map=planeTransform(GRID,corners), cells=[];
        for(let row=0;row<6;row++) for(let col=0;col<6;col++) {
          let sum=0;
          for(const dx of [.35,.5,.65]) for(const dy of [.35,.5,.65]){
            const point=transformPoint(map,{x:col+dx,y:row+dy});
            sum+=gray.data[Math.round(point.y)*frame.width+Math.round(point.x)];
          }
          cells.push(sum/9);
        }
        const min=Math.min(...cells), max=Math.max(...cells);
        if(max-min<55)continue;
        const bits=cells.map(value=>Number(value>(min+max)/2));
        if(bits.some((bit,i)=>bit&&(i<6||i>=30||i%6===0||i%6===5)))continue;
        if(markerMatches(bits.filter((_,i)=>i>=6&&i<30&&i%6!==0&&i%6!==5)))return transformPoint(map,{x:3,y:3});
      } finally { contour.delete();polygon.delete(); }
    }
    return null;
  } finally { for(const mat of [rgba,gray,binary,contours,hierarchy])mat.delete(); }
}

export function mountMarkerFollow({root,video,controls,loadCv,device}) {
  const canvas=document.createElement('canvas'), context=canvas.getContext('2d',{willReadFrequently:true});
  const button=document.createElement('button'), status=document.createElement('span'), dot=document.createElement('div');
  button.type='button';button.textContent='校准角色跟随';status.setAttribute('role','status');
  dot.className='marker-calibration';dot.hidden=true;document.body.append(dot);
  controls.append(button,status);
  let frame=0, generation=0, enabled=false, calibrating=false, loading=false, lastScan=0, lastSeen=0, position;
  let calibration;
  try { calibration=JSON.parse(localStorage.getItem(STORAGE)); } catch {}
  const geometry=()=>[device(),video.videoWidth,video.videoHeight,innerWidth,innerHeight,devicePixelRatio,screenX,screenY,Boolean(document.fullscreenElement)];
  const character=()=>root.querySelector('.projection-character');
  const reset=()=>{const actor=character();if(actor){actor.style.translate='';actor.style.opacity='';}position=undefined;lastSeen=0;};
  const applicable=()=>calibration&&JSON.stringify(geometry())===JSON.stringify(calibration.geometry);
  function sample(){
    if(video.readyState<2||!video.videoWidth||!device())throw new Error('摄像头未就绪');
    const width=Math.min(640,video.videoWidth), height=Math.round(width*video.videoHeight/video.videoWidth);
    if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
    context.drawImage(video,0,0,width,height);
    return context.getImageData(0,0,width,height);
  }
  function scan(now){
    frame=0;
    if(!enabled||calibrating)return;
    frame=requestAnimationFrame(scan);
    if(now-lastScan<75)return;
    lastScan=now;
    if(!applicable()){reset();status.textContent='跟随需按当前全屏尺寸校准';cancelAnimationFrame(frame);frame=0;return;}
    const actor=character();
    if(!actor||actor.closest('[hidden]'))return;
    let point;
    try {
      const image=sample(), found=findMarker(window.cv,image);
      if(found)point=transformPoint(calibration.matrix,{x:found.x/image.width,y:found.y/image.height});
    } catch {}
    if(!point||point.x<0||point.y<0||point.x>1||point.y>1){
      if(!lastSeen||now-lastSeen>500)actor.style.opacity='0';
      status.textContent='等待标志物';
      return;
    }
    lastSeen=now;
    const next={x:point.x*innerWidth,y:point.y*innerHeight};
    position=position?{x:position.x*.55+next.x*.45,y:position.y*.55+next.y*.45}:next;
    const box=root.getBoundingClientRect(), scale=box.width/root.offsetWidth;
    if(!scale)return;
    actor.style.translate=`${(position.x-box.left)/scale-actor.offsetLeft-actor.offsetWidth/2}px ${(position.y-box.top)/scale-actor.offsetTop-actor.offsetHeight-24/scale}px`;
    actor.style.opacity='1';status.textContent='角色跟随中';
  }
  async function resume(){
    enabled=true;
    if(!applicable()){status.textContent='跟随需按当前全屏尺寸校准';return;}
    if(frame||calibrating||loading)return;
    loading=true;
    try{await loadCv();if(enabled&&!frame&&!calibrating)frame=requestAnimationFrame(scan);}
    catch{status.textContent='追踪组件未加载';}
    finally{loading=false;}
  }
  function stop(){enabled=false;generation++;cancelAnimationFrame(frame);frame=0;dot.hidden=true;status.textContent='';reset();}
  document.addEventListener('fullscreenchange',()=>{if(enabled)void resume();});
  const settle=()=>new Promise(resolve=>setTimeout(resolve,450));
  function locateLight(before,after){
    let count=0,x=0,y=0,left=after.width,right=0,top=after.height,bottom=0;
    for(let i=0;i<after.data.length;i+=4){
      if(after.data[i]+after.data[i+1]+after.data[i+2]-before.data[i]-before.data[i+1]-before.data[i+2]<180)continue;
      const col=(i/4)%after.width,row=Math.floor(i/4/after.width);
      count++;x+=col;y+=row;left=Math.min(left,col);right=Math.max(right,col);top=Math.min(top,row);bottom=Math.max(bottom,row);
    }
    if(count<8||right-left>after.width*.12||bottom-top>after.height*.12)throw new Error('未找到清晰校准点，请保持桌面静止并调暗环境光');
    return {x:x/count/after.width,y:y/count/after.height};
  }
  button.onclick=async()=>{
    if(calibrating)return;
    if(!enabled){status.textContent='请先连接摄像头';return;}
    calibrating=true;button.disabled=true;
    const token=++generation, initial=geometry();
    const check=()=>{if(token!==generation||!enabled||JSON.stringify(initial)!==JSON.stringify(geometry()))throw new Error('校准中断，请保持设备和窗口尺寸不变');};
    try{
      if(!document.fullscreenElement)throw new Error('请先在投影仪上进入全屏，再校准');
      const points=[];
      for(const target of TARGETS){
        status.textContent=`正在校准 ${points.length+1}/4，请勿移动桌面物品`;
        dot.hidden=true;await settle();check();const before=sample();
        dot.style.left=`${target.x*100}%`;dot.style.top=`${target.y*100}%`;dot.hidden=false;
        await settle();check();points.push(locateLight(before,sample()));
      }
      const matrix=planeTransform(points,TARGETS);
      calibration={geometry:initial,matrix};
      try{localStorage.setItem(STORAGE,JSON.stringify(calibration));}catch{}
      reset();status.textContent='校准完成，请放入标签';
    }catch(error){if(token===generation)status.textContent=error.message;}
    finally{dot.hidden=true;button.disabled=false;calibrating=false;if(enabled&&applicable())void resume();}
  };
  return {resume,stop};
}
