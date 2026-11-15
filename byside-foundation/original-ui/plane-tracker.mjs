import {validQuad, transformPoint, planeTransform} from './plane-geometry.mjs';
import {detectWhitePaper,smoothCorners} from './paper.mjs';
export {detectWhitePaper,smoothCorners} from './paper.mjs';

// Local planar tracking; frames are never sent to the server.
export function createPlaneTracker(cv){
  let previous=null, points=null, corners=null, frameSize=null, paperMode=false, visible=null, missed=0, anchor=null, localBoundary=null;
  const clear=()=>{previous?.delete();points?.delete();previous=points=null;corners=null;frameSize=null;paperMode=false;visible=null;missed=0;anchor=null;localBoundary=null;};
  function grayFrame(frame){const rgba=new cv.Mat(frame.height,frame.width,cv.CV_8UC4),gray=new cv.Mat();rgba.data.set(frame.data);try{cv.cvtColor(rgba,gray,cv.COLOR_RGBA2GRAY);return gray;}catch(e){gray.delete();throw e;}finally{rgba.delete();}}
  function detect(gray,quad){
    const mask=cv.Mat.zeros(gray.rows,gray.cols,cv.CV_8UC1), polygon=cv.matFromArray(quad.length,1,cv.CV_32SC2,quad.flatMap(p=>[Math.round(p.x),Math.round(p.y)])), out=new cv.Mat();
    try{cv.fillConvexPoly(mask,polygon,new cv.Scalar(255));cv.goodFeaturesToTrack(gray,out,180,0.01,6,mask,3,false,0.04);return out;}catch(e){out.delete();throw e;}finally{mask.delete();polygon.delete();}
  }
  function start(frame,quad,options={}){
    clear();if(!validQuad(quad,500))return {ok:false,reason:'桌面范围太小或四角顺序不正确，请重新圈定。'};
    if(options.paper){paperMode=true;anchor=(options.paperCorners||quad).map(p=>({...p}));const unit=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}];const inverse=planeTransform(anchor,unit);localBoundary=quad.map(p=>transformPoint(inverse,p));corners=quad.map(p=>({...p}));visible=corners.map(p=>({...p}));frameSize=[frame.width,frame.height];return {ok:true,corners:visible};}
    const gray=grayFrame(frame);let features;
    try{features=detect(gray,quad);if(features.rows<12){gray.delete();features.delete();return {ok:false,reason:'桌面纹理不足，请选择纹理更丰富的区域。'};}previous=gray;points=features;corners=quad.map(p=>({...p}));visible=corners.map(p=>({...p}));frameSize=[frame.width,frame.height];return {ok:true,corners:visible};}catch(e){gray.delete();features?.delete();throw e;}
  }
  function update(frame){
    if(paperMode){if(frame.width!==frameSize[0]||frame.height!==frameSize[1]){clear();return {ok:false,reason:'画面尺寸发生变化，请重新识别白纸。'};}const candidate=detectWhitePaper(cv,frame,anchor);if(!candidate){missed++;return {ok:true,corners:visible,uncertain:true};}missed=0;anchor=candidate;const unit=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}];const matrix=planeTransform(unit,anchor);corners=localBoundary.map(p=>transformPoint(matrix,p));if(!validQuad(corners,500))return {ok:false,reason:"投影边界不可用，请重新圈定。"};visible=smoothCorners(visible,corners);return {ok:true,corners:visible,uncertain:false};}
    if(!previous||!points)return {ok:false,reason:'请先圈定桌面。'};
    if(frame.width!==frameSize[0]||frame.height!==frameSize[1]){clear();return {ok:false,reason:'画面尺寸发生变化，请重新圈定桌面。'};}
    const gray=grayFrame(frame), next=new cv.Mat(), status=new cv.Mat(), errors=new cv.Mat(), back=new cv.Mat(), backStatus=new cv.Mat(), backErrors=new cv.Mat();let src=null,dst=null,H=null,mask=null,features=null,keepGray=false;
    try{
      const size=new cv.Size(21,21),criteria=new cv.TermCriteria(cv.TERM_CRITERIA_EPS|cv.TERM_CRITERIA_COUNT,30,0.01);
      cv.calcOpticalFlowPyrLK(previous,gray,points,next,status,errors,size,3,criteria);
      cv.calcOpticalFlowPyrLK(gray,previous,next,back,backStatus,backErrors,size,3,criteria);
      const a=[],b=[];for(let i=0;i<points.rows;i++){const x=points.data32F[2*i],y=points.data32F[2*i+1],nx=next.data32F[2*i],ny=next.data32F[2*i+1];if(status.data[i]&&backStatus.data[i]&&Number.isFinite(nx)&&Number.isFinite(ny)&&Math.hypot(back.data32F[2*i]-x,back.data32F[2*i+1]-y)<1.5){a.push(x,y);b.push(nx,ny);}}
      if(a.length<20)return {ok:false,reason:'桌面追踪丢失，请重新圈定。'};
      src=cv.matFromArray(a.length/2,1,cv.CV_32FC2,a);dst=cv.matFromArray(b.length/2,1,cv.CV_32FC2,b);mask=new cv.Mat();H=cv.findHomography(src,dst,cv.RANSAC,3,mask);
      if(!H||H.empty()||mask.data.reduce((s,v)=>s+(v?1:0),0)<Math.max(8,Math.ceil(a.length/2*0.55)))return {ok:false,reason:'桌面追踪不稳定，请重新圈定。'};
      const matrix=Array.from(H.data64F), nextCorners=corners.map(p=>transformPoint(matrix,p));
      if(!validQuad(nextCorners,500)||nextCorners.some((p,i)=>Math.hypot(p.x-corners[i].x,p.y-corners[i].y)>Math.max(frame.width,frame.height)*0.3))return {ok:false,reason:'桌面移动过快或离开画面，请重新圈定。'};
      features=detect(gray,nextCorners);
      if(features.rows<10)return {ok:false,reason:'桌面纹理不足或被遮挡，请重新圈定。'};
      previous.delete();points.delete();previous=gray;points=features;features=null;keepGray=true;corners=nextCorners;
      visible=smoothCorners(visible,corners);return {ok:true,corners:visible};
    }finally{if(!keepGray)gray.delete();for(const m of [next,status,errors,back,backStatus,backErrors,src,dst,H,mask,features])m?.delete();}
  }
  return {start,update,destroy:clear};
}
