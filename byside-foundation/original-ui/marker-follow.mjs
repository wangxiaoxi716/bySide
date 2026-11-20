import { planeTransform, transformPoint, validQuad } from './plane-geometry.mjs';
import { createPlacementGate, findDarkPieces, projectedCell, readProjectedBoard } from './physical-chess.mjs';

const STORAGE = 'yatuan:projector-marker:v1';
const GRID = [{x:0,y:0},{x:6,y:0},{x:6,y:6},{x:0,y:6}];
const TARGETS = [{x:.24,y:.24},{x:.76,y:.24},{x:.76,y:.76},{x:.24,y:.76}];
const MARKER = '1011010100110010';

export function markerMatches(bits) {
  const mirrored=Array.from({length:16},(_,index)=>bits[(3-Math.floor(index/4))*4+index%4]);
  for(let orientation of [bits,mirrored]){
    for(let turn=0;turn<4;turn++){
      if(orientation.join('')===MARKER)return true;
      orientation=Array.from({length:16},(_,index)=>orientation[(3-index%4)*4+Math.floor(index/4)]);
    }
  }
  return false;
}

export function findMarker(cv,frame) {
  const rgba=cv.matFromImageData(frame), gray=new cv.Mat(), binary=new cv.Mat(), contours=new cv.MatVector(), hierarchy=new cv.Mat();
  try {
    cv.cvtColor(rgba,gray,cv.COLOR_RGBA2GRAY);
    for(const local of [false,true]){
    if(local)cv.adaptiveThreshold(gray,binary,255,cv.ADAPTIVE_THRESH_MEAN_C,cv.THRESH_BINARY_INV,31,6);
    else cv.threshold(gray,binary,0,255,cv.THRESH_BINARY_INV|cv.THRESH_OTSU);
    cv.findContours(binary,contours,hierarchy,cv.RETR_LIST,cv.CHAIN_APPROX_SIMPLE);
    for(let index=0;index<contours.size();index++) {
      const contour=contours.get(index), polygon=new cv.Mat();
      try {
        const area=Math.abs(cv.contourArea(contour));
        if(area<100||area>frame.width*frame.height*.15)continue;
        cv.approxPolyDP(contour,polygon,cv.arcLength(contour,true)*.035,true);
        if(polygon.rows!==4||!cv.isContourConvex(polygon))continue;
        const corners=Array.from({length:4},(_,i)=>({x:polygon.data32S[i*2],y:polygon.data32S[i*2+1]}));
        if(!validQuad(corners,100))continue;
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
        if(max-min<38)continue;
        const bits=cells.map(value=>Number(value>(min+max)/2));
        if(bits.some((bit,i)=>bit&&(i<6||i>=30||i%6===0||i%6===5)))continue;
        if(markerMatches(bits.filter((_,i)=>i>=6&&i<30&&i%6!==0&&i%6!==5)))return transformPoint(map,{x:3,y:3});
      } finally { contour.delete();polygon.delete(); }
    }
    }
    return null;
  } finally { for(const mat of [rgba,gray,binary,contours,hierarchy])mat.delete(); }
}

export function findBlueTag(cv,{width,height,data},accept=()=>true) {
  const mask=new cv.Mat(height,width,cv.CV_8UC1), contours=new cv.MatVector(), hierarchy=new cv.Mat(), kernel=cv.Mat.ones(3,3,cv.CV_8U);
  try {
    for(let i=0;i<mask.data.length;i++){
      const red=data[4*i],green=data[4*i+1],blue=data[4*i+2];
      mask.data[i]=blue-red>=34&&blue-green>=18&&blue>=102?255:0;
    }
    cv.morphologyEx(mask,mask,cv.MORPH_CLOSE,kernel);
    cv.findContours(mask,contours,hierarchy,cv.RETR_EXTERNAL,cv.CHAIN_APPROX_SIMPLE);
    const candidates=[];
    for(let i=0;i<contours.size();i++){
      const contour=contours.get(i), polygon=new cv.Mat();
      try{
        const box=cv.boundingRect(contour), span=Math.max(box.width,box.height);
        if(span<width*.010||span>width*.046||Math.min(box.width,box.height)<span*.73||
          cv.contourArea(contour)<box.width*box.height*.62)continue;
        cv.approxPolyDP(contour,polygon,cv.arcLength(contour,true)*.045,true);
        if(polygon.rows!==4||!cv.isContourConvex(polygon))continue;
        const point={x:box.x+box.width/2,y:box.y+box.height/2};
        if(accept(point))candidates.push(point);
      }finally{contour.delete();polygon.delete();}
    }
    return candidates.length===1?candidates[0]:null;
  }finally{for(const mat of [mask,contours,hierarchy,kernel])mat.delete();}
}

export function findWhiteStone(cv, image, accept = () => true, previous) {
  const {width,height,data}=image;
  const mask=new cv.Mat(height,width,cv.CV_8UC1), contours=new cv.MatVector(), hierarchy=new cv.Mat();
  const kernel=cv.Mat.ones(3,3,cv.CV_8U);
  let blueChannel, localBlue;
  function collect(){
+    cv.morphologyEx(mask,mask,cv.MORPH_OPEN,kernel);
    cv.morphologyEx(mask,mask,cv.MORPH_CLOSE,kernel);
    cv.findContours(mask,contours,hierarchy,cv.RETR_EXTERNAL,cv.CHAIN_APPROX_SIMPLE);
    const candidates=[];
    for(let i=0;i<contours.size();i++){
      const contour=contours.get(i);
      try {
        const box=cv.boundingRect(contour), area=cv.contourArea(contour), perimeter=cv.arcLength(contour,true);
        const diameter=Math.max(box.width,box.height);
        if(diameter<width*.014||diameter>width*.064||box.x<=1||box.y<=1||box.x+box.width>=width-1||box.y+box.height>=height-1)continue;
        const aspect=Math.min(box.width,box.height)/diameter, fill=area/(box.width*box.height);
        if(aspect<.68||fill<.62||fill>.88||4*Math.PI*area/(perimeter*perimeter)<.66)continue;
        const center={x:box.x+box.width/2,y:box.y+box.height/2};
        if(accept(center))candidates.push(center);
      } finally {contour.delete();}
    }
    return candidates;
  }
  try {
    for(let i=0;i<mask.data.length;i++){
      const red=data[4*i], green=data[4*i+1], blue=data[4*i+2];
      const light=Math.min(red,green,blue), spread=Math.max(red,green,blue)-light;
      mask.data[i]=(light>=165&&spread<=30 || blue>=105&&green>=75&&blue-red>=15&&blue-green>=7&&spread<=85)?255:0;
    }
    const strict=collect();
    const selected=chooseStoneCandidate(strict,previous,width);
    const near=point=>Math.hypot(point.x-previous.x,point.y-previous.y)<=width*.065;
    if(selected&&(!previous||near(selected)))return selected;
    if(strict.length&&!previous)return null;
    blueChannel=new cv.Mat(height,width,cv.CV_8UC1);localBlue=new cv.Mat();
    for(let i=0;i<mask.data.length;i++)blueChannel.data[i]=data[4*i+2];
    const windowSize=2*Math.round(width*.043)+1;
    cv.blur(blueChannel,localBlue,new cv.Size(windowSize,windowSize));
    for(let i=0;i<mask.data.length;i++){
      const red=data[4*i],green=data[4*i+1],blue=data[4*i+2];
      const neutral=Math.max(red,green,blue)-Math.min(red,green,blue)<=27;
      const cool=blue-red>=9&&blue-green>=3&&blue-red<=75;
      mask.data[i]=(blue>=60&&(neutral||cool)&&blue-localBlue.data[i]>=14)?255:0;
    }
    const candidates=collect();
    if(previous)return chooseStoneCandidate(candidates.filter(near),previous,width)||selected;
    return chooseStoneCandidate(candidates,undefined,width);
  } finally {for(const mat of [mask,contours,hierarchy,kernel,blueChannel,localBlue])mat?.delete();}
}

export function chooseStoneCandidate(candidates, previous, width) {
  if(candidates.length<=1)return candidates[0]??null;
  if(!previous)return null;
  const ranked=candidates.map(point=>({point,distance:Math.hypot(point.x-previous.x,point.y-previous.y)}))
    .sort((a,b)=>a.distance-b.distance);
  return ranked[0].distance<=width*.065&&ranked[1].distance-ranked[0].distance>=width*.022?ranked[0].point:null;
}

export function outsideProjectionRects(point, rects, padding = 12) {
  return !rects.some(rect => point.x>=rect.left-padding && point.x<=rect.right+padding &&
    point.y>=rect.top-padding && point.y<=rect.bottom+padding);
}

export function locateCalibrationDot(cv, before, after) {
  const {width,height}=after;
  if(before.width!==width||before.height!==height)return null;
  const count=width*height, delta=new Int16Array(count), histogram=new Uint32Array(511);
  for(let i=0;i<count;i++){
    const p=i*4, a=after.data, b=before.data;
    delta[i]=Math.round((a[p]+a[p+1]+a[p+2]-b[p]-b[p+1]-b[p+2])/3);
    histogram[delta[i]+255]++;
  }
  let background=-255, seen=0;
  for(const bucket of histogram){seen+=bucket;if(seen>=count/2)break;background++;}
  const mask=new cv.Mat(height,width,cv.CV_8UC1), kernel=cv.Mat.ones(3,3,cv.CV_8U);
  const contours=new cv.MatVector(), hierarchy=new cv.Mat();
  try{
    for(const threshold of [38,25,15]){
      for(let i=0;i<count;i++)mask.data[i]=delta[i]-background>=threshold?255:0;
      cv.morphologyEx(mask,mask,cv.MORPH_OPEN,kernel);
      cv.findContours(mask,contours,hierarchy,cv.RETR_EXTERNAL,cv.CHAIN_APPROX_SIMPLE);
      const candidates=[];
      for(let i=0;i<contours.size();i++){
        const contour=contours.get(i);
        try{
          const box=cv.boundingRect(contour), area=cv.contourArea(contour);
          if(area<6||box.width>width*.12||box.height>height*.12||
            Math.min(box.width,box.height)/Math.max(box.width,box.height)<.35||
            area/(box.width*box.height)<.30)continue;
          const center=cv.moments(contour);
          if(center.m00)candidates.push({x:center.m10/center.m00/width,y:center.m01/center.m00/height});
        }finally{contour.delete();}
      }
      if(candidates.length===1)return candidates[0];
      if(candidates.length>1)return null;
    }
    return null;
  }finally{for(const mat of [mask,kernel,contours,hierarchy])mat.delete();}
}

export function positionFollower(root, position, stoneMode) {
  const actor=root.querySelector('.projection-character'), speech=root.querySelector('.projection-bubble');
  if(!actor)return;
  const visible=position===null?'0':position?'1':'';
  for(const element of [actor,speech])if(element){
    element.classList.toggle('stone-follow-motion',Boolean(stoneMode&&position!==undefined));
    element.style.opacity=visible;
    if(position===undefined)element.style.translate='';
  }
  if(!position)return;
  const box=root.getBoundingClientRect(), scale=box.width/root.offsetWidth;
  if(!scale)return;
  const actorX=position.x*innerWidth-actor.offsetWidth*scale/2;
  const actorY=position.y*innerHeight-actor.offsetHeight*scale-24;
  actor.style.translate=`${(actorX-box.left)/scale-actor.offsetLeft}px ${(actorY-box.top)/scale-actor.offsetTop}px`;
  if(speech){
    const width=speech.offsetWidth*scale,height=speech.offsetHeight*scale;
    const right=actorX+actor.offsetWidth*scale+12;
    const preferred=right+width<=innerWidth-8?right:actorX-width-12;
    const left=Math.max(8,Math.min(preferred,innerWidth-width-8));
    const top=Math.max(8,Math.min(actorY,innerHeight-height-8));
    speech.style.translate=`${(left-box.left)/scale-speech.offsetLeft}px ${(top-box.top)/scale-speech.offsetTop}px`;
  }
}

export function easeFollower(current, target, elapsed, width, height) {
  const distance=Math.hypot((target.x-current.x)*width,(target.y-current.y)*height);
  if(distance<0.35)return target;
  const timeConstant=Math.max(34,70-distance*.30);
  const blend=1-Math.exp(-Math.min(elapsed,75)/timeConstant);
  return {x:current.x+(target.x-current.x)*blend,y:current.y+(target.y-current.y)*blend};
}

export function createFollowerMotion(root, onDraw=()=>{}) {
  let current, target, stoneMode=false, frame=0, previousTime=0;
  function draw(){positionFollower(root,current,stoneMode);onDraw();}
  function animate(now){
    frame=0;
    if(!current||!target)return;
    current=easeFollower(current,target,previousTime?now-previousTime:16,innerWidth,innerHeight);
    draw();
    if(current!==target){previousTime=now;frame=requestAnimationFrame(animate);}
    else previousTime=0;
  }
  return {
    update(next,isStone){
      stoneMode=isStone;
      if(!next||!current||!stoneMode){
        cancelAnimationFrame(frame);frame=0;previousTime=0;
        current=target=next;draw();return;
      }
      if(target?.x===next.x&&target?.y===next.y)return;
      target=next;
      if(!frame)frame=requestAnimationFrame(animate);
    },
    redraw:draw,
  };
}

export function mountMarkerFollow({root,video,controls,loadCv,device,output,localPreview=()=>true,physical}) {
  const canvas=document.createElement('canvas'), context=canvas.getContext('2d',{willReadFrequently:true});
  const button=document.createElement('button'), status=document.createElement('span'), dot=document.createElement('div');
  button.type='button';button.textContent='校准角色跟随';status.setAttribute('role','status');
  dot.className='marker-calibration';dot.hidden=true;document.body.append(dot);
  const mode=document.createElement('select');
  mode.setAttribute('aria-label','角色跟随目标');
  mode.append(new Option('ArUco 标签','marker'),new Option('蓝白小标签（20 mm）','blue-tag'),new Option('白棋子','stone'));
  controls.append(mode,button,status);
  const physicalStatus=document.createElement('span');
  physicalStatus.setAttribute('role','status');
  controls.append(physicalStatus);
  const placement=createPlacementGate();
  let lastPhysicalFrame=-1,lastPhysicalScan=-Infinity,physicalKind,physicalMoveCount=0,physicalPending=false;
  function resetPlacement(){
    placement.reset();lastPhysicalFrame=-1;physicalKind=undefined;physicalMoveCount=0;
  }
  function scanPhysical(now){
    if(physicalPending||now-lastPhysicalScan<100)return;
    lastPhysicalScan=now;
    const game=physical?.game();
    if(!game||!['chess','tic-tac-toe'].includes(game.kind)){
      resetPlacement();physicalStatus.textContent='';return;
    }
    const board=output?.connected()?output.board():localPreview()?readProjectedBoard(root):null;
    if(!board||board.kind!==game.kind){physicalStatus.textContent='等待投影棋盘就绪';return;}
    if(game.game.winner||game.game.draw){physicalStatus.textContent='本局已结束';return;}
    if(game.game.turn!==1){physicalStatus.textContent='等芽团下完';return;}
    if(physicalKind!==game.kind||game.game.moves.length<physicalMoveCount){
      resetPlacement();
      placement.reset({armed:game.game.moves.length===0});
    }
    physicalKind=game.kind;physicalMoveCount=game.game.moves.length;
    if(video.currentTime===lastPhysicalFrame)return;
    lastPhysicalFrame=video.currentTime;
    const [width,height]=screenGeometry();
    try{
      const image=sample(800);
      const mappedCells=findDarkPieces(window.cv,image).map(point=>{
        const mapped=transformPoint(calibration.matrix,{x:point.x/image.width,y:point.y/image.height});
        return mapped?projectedCell({x:mapped.x*width,y:mapped.y*height},board):null;
      }).filter(index=>index!==null);
      const cells=mappedCells.filter(index=>game.game.board[index]===0);
      const index=placement.update(cells,now);
      if(index!==null){
        const size=game.kind==='chess'?15:3;
        const captured=canvas.toDataURL('image/jpeg',.68);
        physicalPending=true;
        physicalStatus.textContent='已确认落子，芽团正在看棋盘';
        void physical.play(Math.floor(index/size)+1,index%size+1,captured).then(result=>{
          if(enabled)physicalStatus.textContent=result.message;
        }).catch(()=>{if(enabled)physicalStatus.textContent='本次落子未完成，请拿开棋子后重试';})
          .finally(()=>{physicalPending=false;});
      }else if(cells.length>1)physicalStatus.textContent='检测到多个候选，请只放一颗黑棋子';
      else if(cells.length===1)physicalStatus.textContent='检测到空位上的黑棋子，请停稳';
      else if(mappedCells.length)physicalStatus.textContent='没有检测到空位落子，请把黑棋子放到空位中央';
      else physicalStatus.textContent='等待黑棋子，请放在空位中央';
    }catch{resetPlacement();physicalStatus.textContent='暂时无法读取棋盘摄像头画面';}
  }
  let frame=0, generation=0, enabled=false, calibrating=false, loading=false, lastScan=0, lastSeen=0, position, pendingStone, previousStone;
  let calibration;
  let lastVideoTime=-1;
  const motion=createFollowerMotion(root);
  try { calibration=JSON.parse(localStorage.getItem(STORAGE)); } catch {}
  const screenGeometry=()=>output?.geometry()||[innerWidth,innerHeight,devicePixelRatio,screenX,screenY,Boolean(document.fullscreenElement)];
  const geometry=()=>[device(),video.videoWidth,video.videoHeight,...screenGeometry()];
  const character=()=>root.querySelector('.projection-character');
  const showPosition=(point,stoneMode)=>{motion.update(localPreview()?point:undefined,stoneMode);output?.send({type:'follow',point,stoneMode});};
  const setVisible=()=>showPosition(null,mode.value==='stone');
  const reset=()=>{showPosition(undefined,false);position=undefined;pendingStone=undefined;previousStone=undefined;lastSeen=0;lastVideoTime=-1;};
  const setDot=(calibrating, target)=>{
    if(output?.geometry())output.send({type:'calibration',calibrating,target});
    else document.body.classList.toggle('marker-calibrating',calibrating);
    dot.hidden=!target||Boolean(output?.geometry());
    if(target){dot.style.left=`${target.x*100}%`;dot.style.top=`${target.y*100}%`;}
  };
  mode.onchange=()=>{reset();if(enabled)void resume();};
  const targetLabel=()=>mode.value==='stone'?'白棋子':mode.value==='blue-tag'?'蓝白小标签':'标志物';
  const applicable=()=>calibration&&JSON.stringify(geometry())===JSON.stringify(calibration.geometry);
  function sample(maxWidth=640){
    if(video.readyState<2||!video.videoWidth||!device())throw new Error('摄像头未就绪');
    const width=Math.min(maxWidth,video.videoWidth), height=Math.round(width*video.videoHeight/video.videoWidth);
    if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
    context.drawImage(video,0,0,width,height);
    return context.getImageData(0,0,width,height);
  }
  function scan(now){
    frame=0;
    if(!enabled||calibrating)return;
    frame=requestAnimationFrame(scan);
    if(now-lastScan<(mode.value==='marker'?75:mode.value==='blue-tag'?45:30))return;
    lastScan=now;
    if(!applicable()){reset();resetPlacement();status.textContent='请按当前投影窗口尺寸校准';cancelAnimationFrame(frame);frame=0;return;}
    if(root.querySelector('.projection-scene')?.hidden){scanPhysical(now);return;}
    if(physicalKind)resetPlacement();
    if(physicalStatus.textContent)physicalStatus.textContent='';
    const actor=character();
    if(!actor||root.querySelector('.projection-scene')?.hidden||(!output?.geometry()&&actor.closest('[hidden]')))return;
    let point, stone;
    const stoneMode=mode.value!=='marker', hold=stoneMode?1200:500;
    if(stoneMode&&video.currentTime===lastVideoTime&&now-lastSeen<hold)return;
    lastVideoTime=video.currentTime;
    const [width,height]=screenGeometry();
    try {
      const image=sample(mode.value==='stone'?640:1280);
      const project=found=>transformPoint(calibration.matrix,{x:found.x/image.width,y:found.y/image.height});
      const inProjection=p=>p&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1;
      const rects=stoneMode?(output?.rects()||[...document.querySelectorAll('.ar-panel,.projection-tools,.projection-character,.projection-bubble,.projection-stats,.gar-root')]
        .filter(element=>!element.closest('[hidden]')&&getComputedStyle(element).visibility==='visible'&&Number(getComputedStyle(element).opacity)>.1)
        .map(element=>element.getBoundingClientRect()).filter(rect=>rect.width&&rect.height)):[];
      const accept=candidate=>{
        const projected=project(candidate);
        return inProjection(projected)&&outsideProjectionRects({x:projected.x*width,y:projected.y*height},rects);
      };
      const found=mode.value==='stone'?findWhiteStone(window.cv,image,accept,previousStone)
        :mode.value==='blue-tag'?findBlueTag(window.cv,image,accept):findMarker(window.cv,image);
      if(found)point=project(found);
      if(stoneMode)stone=found;
    } catch {}
    if(!point||point.x<0||point.y<0||point.x>1||point.y>1){
      if(!lastSeen||now-lastSeen>hold){setVisible();position=undefined;previousStone=undefined;}
      pendingStone=undefined;
      status.textContent=position&&stoneMode?'短暂漏检，保持位置':`等待唯一的${targetLabel()}`;
      return;
    }
    const next={x:point.x*width,y:point.y*height};
    if(stoneMode&&(!position||Math.hypot(next.x-position.x,next.y-position.y)>Math.max(width,height)*.12)){
      if(!pendingStone||Math.hypot(next.x-pendingStone.x,next.y-pendingStone.y)>Math.max(width,height)*.04){
        pendingStone=next;
        if(!lastSeen||now-lastSeen>hold)setVisible();
        return;
      }
      if(!stoneMode||now-lastSeen>hold)position=undefined;
    }
    pendingStone=undefined;
    previousStone=stone;
    lastSeen=now;
    if(!position)position=next;
    else{
      const distance=Math.hypot(next.x-position.x,next.y-position.y);
      const blend=stoneMode?(distance<2?0:1):.45;
      position={x:position.x+(next.x-position.x)*blend,y:position.y+(next.y-position.y)*blend};
    }
    showPosition({x:position.x/width,y:position.y/height},stoneMode);status.textContent='角色跟随中';
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
  function stop(){enabled=false;generation++;cancelAnimationFrame(frame);frame=0;setDot(false);status.textContent='';physicalStatus.textContent='';resetPlacement();reset();}
  document.addEventListener('fullscreenchange',()=>{if(enabled)void resume();});
  const settle=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
  button.onclick=async()=>{
    if(calibrating)return;
    if(!enabled){status.textContent='请先连接摄像头';return;}
    calibrating=true;button.disabled=true;
    resetPlacement();
    const token=++generation, initial=geometry();
    const check=()=>{if(token!==generation||!enabled||JSON.stringify(initial)!==JSON.stringify(geometry()))throw new Error('校准中断，请保持设备和窗口尺寸不变');};
    try{
      if(output?.connected()&&!output.geometry())throw new Error('正在同步纯投影窗口，请稍后再点校准');
      if(!output?.geometry()&&!screenGeometry()[5])throw new Error('未连接纯投影窗口；请从本页点「打开纯投影输出」，或在本页进入全屏');
      await loadCv();check();
      setDot(true);
      const points=[];
      for(const target of TARGETS){
        status.textContent=`正在校准 ${points.length+1}/4，请勿移动桌面物品`;
        setDot(true);await settle(650);check();const before=sample();
        setDot(true,target);
        let point;
        for(const wait of [320,240,240]){
          await settle(wait);check();
          point=locateCalibrationDot(window.cv,before,sample());
          if(point)break;
        }
        if(!point)throw new Error(`未识别第 ${points.length+1} 个光点：请确认光点落在摄像头画面内，避开反光并重试`);
        points.push(point);
      }
      const matrix=planeTransform(points,TARGETS);
      calibration={geometry:initial,matrix};
      try{localStorage.setItem(STORAGE,JSON.stringify(calibration));}catch{}
      reset();status.textContent=`校准完成，请放入${targetLabel()}`;
    }catch(error){if(token===generation)status.textContent=error.message;}
    finally{setDot(false);button.disabled=false;calibrating=false;if(enabled&&applicable())void resume();}
  };
  return {resume,stop};
}
