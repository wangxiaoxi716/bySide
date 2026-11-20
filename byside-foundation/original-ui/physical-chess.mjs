export function projectedCell(point, layout) {
  if(!layout)return null;
  if(layout.kind==='tic-tac-toe'){
    const index=layout.cells.findIndex(rect=>{
      const padX=(rect.right-rect.left)*.12,padY=(rect.bottom-rect.top)*.12;
      return point.x>=rect.left+padX&&point.x<=rect.right-padX&&point.y>=rect.top+padY&&point.y<=rect.bottom-padY;
    });
    return index<0?null:index;
  }
  if(layout.kind!=='chess')return null;
  const {left,right,top,bottom}=layout.rect;
  if(right<=left||bottom<=top)return null;
  const column=((point.x-left)*280/(right-left)-14)/18;
  const row=((point.y-top)*280/(bottom-top)-14)/18;
  const colIndex=Math.round(column),rowIndex=Math.round(row);
  if(colIndex<0||colIndex>14||rowIndex<0||rowIndex>14||Math.hypot(column-colIndex,row-rowIndex)>.42)return null;
  return rowIndex*15+colIndex;
}

export function findDarkPieces(cv,{width,height,data}){
  const gray=new cv.Mat(height,width,cv.CV_8UC1), local=new cv.Mat(),mask=new cv.Mat(height,width,cv.CV_8UC1);
  const kernel=cv.Mat.ones(3,3,cv.CV_8U),contours=new cv.MatVector(),hierarchy=new cv.Mat();
  try{
    for(let i=0;i<gray.data.length;i++)gray.data[i]=(data[i*4]*3+data[i*4+1]*6+data[i*4+2])/10;
    const size=2*Math.round(width*.036)+1;
    cv.blur(gray,local,new cv.Size(size,size));
    for(let i=0;i<mask.data.length;i++)mask.data[i]=gray.data[i]<145&&local.data[i]-gray.data[i]>=Math.max(15,local.data[i]*.19)?255:0;
    cv.morphologyEx(mask,mask,cv.MORPH_OPEN,kernel);
    cv.findContours(mask,contours,hierarchy,cv.RETR_EXTERNAL,cv.CHAIN_APPROX_SIMPLE);
    const pieces=[];
    for(let i=0;i<contours.size();i++){
      const contour=contours.get(i);
      try{
        const box=cv.boundingRect(contour),major=Math.max(box.width,box.height),area=cv.contourArea(contour),perimeter=cv.arcLength(contour,true);
        if(major<width*.010||major>width*.065||Math.min(box.width,box.height)<major*.68||area/(box.width*box.height)<.58||
          4*Math.PI*area/(perimeter*perimeter)<.64)continue;
        pieces.push({x:box.x+box.width/2,y:box.y+box.height/2});
      }finally{contour.delete();}
    }
    return pieces;
  }finally{for(const mat of [gray,local,mask,kernel,contours,hierarchy])mat.delete();}
}

export function createPlacementGate({dwell=550,clear=300}={}){
  let emptySince, candidate, since, lastFrame, armed=false;
  return {
    reset({armed:initiallyArmed=false}={}){emptySince=candidate=since=lastFrame=undefined;armed=initiallyArmed;},
    update(cells,now){
      if(lastFrame!==undefined&&now-lastFrame>200){candidate=since=emptySince=undefined;}
      lastFrame=now;
      if(cells.length!==1){
        candidate=since=undefined;
        if(cells.length===0){
          emptySince??=now;
          if(now-emptySince>=clear)armed=true;
        }else emptySince=undefined;
        return null;
      }
      emptySince=undefined;
      if(!armed)return null;
      if(candidate!==cells[0]){candidate=cells[0];since=now;return null;}
      if(now-since<dwell)return null;
      armed=false;
      return candidate;
    },
  };
}

export function readProjectedBoard(root){
  const bounds=element=>{const {left,right,top,bottom}=element.getBoundingClientRect();return {left,right,top,bottom};};
  const gomoku=root.querySelector('.gar-gomoku svg');
  if(gomoku&&!gomoku.closest('[hidden]'))return {kind:'chess',rect:bounds(gomoku)};
  const cells=[...root.querySelectorAll('.gar-ttt-cell')];
  if(cells.length===9&&!cells[0].closest('[hidden]'))return {kind:'tic-tac-toe',cells:cells.map(bounds)};
  return null;
}
