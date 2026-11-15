import {validQuad} from './plane-geometry.mjs';

function order(points){
 const center=points.reduce((a,p)=>({x:a.x+p.x/4,y:a.y+p.y/4}),{x:0,y:0});
 const sorted=[...points].sort((a,b)=>Math.atan2(a.y-center.y,a.x-center.x)-Math.atan2(b.y-center.y,b.x-center.x));
 let first=0;for(let i=1;i<4;i++)if(sorted[i].x+sorted[i].y<sorted[first].x+sorted[first].y)first=i;
 return Array.from({length:4},(_,i)=>sorted[(first+i)%4]);
}
export function alignPaperCorners(points,reference){
 if(!reference)return points;
 let best=points,score=Infinity;
 for(let shift=0;shift<4;shift++){
  const candidate=Array.from({length:4},(_,i)=>points[(i+shift)%4]);
  const distance=candidate.reduce((s,p,i)=>s+Math.hypot(p.x-reference[i].x,p.y-reference[i].y),0);
  if(distance<score){score=distance;best=candidate;}
 }
 return best;
}
export function detectWhitePaper(cv,frame,reference=null){
 let rgba=null,gray=null,blur=null,binary=null,kernel=null,contours=null,hierarchy=null;
 try{
  rgba=new cv.Mat(frame.height,frame.width,cv.CV_8UC4);rgba.data.set(frame.data);gray=new cv.Mat();blur=new cv.Mat();binary=new cv.Mat();contours=new cv.MatVector();hierarchy=new cv.Mat();kernel=cv.Mat.ones(3,3,cv.CV_8U);
  cv.cvtColor(rgba,gray,cv.COLOR_RGBA2GRAY);cv.GaussianBlur(gray,blur,new cv.Size(5,5),0);
  let best=null,bestScore=-Infinity;const full=frame.width*frame.height;
  const areaOf=q=>Math.abs(q.reduce((s,p,i)=>{const n=q[(i+1)%4];return s+p.x*n.y-n.x*p.y;},0))/2;
  for(const threshold of [170,145,195,125,215]){
   cv.threshold(blur,binary,threshold,255,cv.THRESH_BINARY);cv.morphologyEx(binary,binary,cv.MORPH_CLOSE,kernel);cv.findContours(binary,contours,hierarchy,cv.RETR_EXTERNAL,cv.CHAIN_APPROX_SIMPLE);
   for(let i=0;i<contours.size();i++){
    const c=contours.get(i),poly=new cv.Mat();
    try{const area=Math.abs(cv.contourArea(c));if(area<full*.015||area>full*.80)continue;const perimeter=cv.arcLength(c,true);cv.approxPolyDP(c,poly,perimeter*.025,true);if(poly.rows!==4||!cv.isContourConvex(poly))continue;const p=alignPaperCorners(order(Array.from({length:4},(_,j)=>({x:poly.data32S[j*2],y:poly.data32S[j*2+1]}))),reference);if(!validQuad(p,full*.015)||p.some(v=>v.x<2||v.y<2||v.x>frame.width-3||v.y>frame.height-3))continue;
     const avgDistance=reference?p.reduce((s,v,j)=>s+Math.hypot(v.x-reference[j].x,v.y-reference[j].y),0)/4:0;
     if(reference&&(avgDistance>Math.max(frame.width,frame.height)*.18||area/areaOf(reference)<.55||area/areaOf(reference)>1.8))continue;
     const score=area/full-avgDistance/Math.max(frame.width,frame.height)*2-Math.abs(threshold-170)*.0005;if(score>bestScore){best=p;bestScore=score;}
    }finally{c.delete();poly.delete();}
   }
  }
  return best;
 }finally{for(const obj of [rgba,gray,blur,binary,kernel,contours,hierarchy])obj?.delete();}
}
export function smoothCorners(previous,next){
 const delta=next.reduce((s,p,i)=>s+Math.hypot(p.x-previous[i].x,p.y-previous[i].y),0)/next.length;
 const alpha=delta<2?0.18:delta<8?0.35:0.7;
 return next.map((p,i)=>({x:previous[i].x+(p.x-previous[i].x)*alpha,y:previous[i].y+(p.y-previous[i].y)*alpha}));
}
