import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {planeTransform, transformPoint, validQuad, cameraRect} from '../dist/plane-geometry.mjs';
import {createPlaneTracker, detectWhitePaper, smoothCorners} from '../dist/plane-tracker.mjs';
const require = createRequire(import.meta.url);
const cv = require('../dist/vendor/opencv.js');
if (!cv.Mat) await new Promise(resolve => {cv.onRuntimeInitialized=resolve;});
const rect = [{x:40,y:35},{x:280,y:35},{x:280,y:200},{x:40,y:200}];

test('geometry maps four corners and rejects crossed or tiny selections',()=>{
  const target=[{x:80,y:70},{x:300,y:40},{x:290,y:205},{x:65,y:220}];
  assert.equal(validQuad(target),true); assert.equal(validQuad([target[0],target[2],target[1],target[3]]),false);
  assert.equal(validQuad([{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]),false);
  const matrix=planeTransform(rect,target);
  rect.forEach((p,i)=>{const result=transformPoint(matrix,p);assert.ok(Math.hypot(result.x-target[i].x,result.y-target[i].y)<1e-5)});
  assert.deepEqual(cameraRect(800,600,640,360),{x:0,y:75,width:800,height:450});
});
function frame(dx=0,dy=0, blank=false){
  const width=320,height=240,data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const xx=x-dx, yy=y-dy;
    const value=blank?128:(((Math.floor(xx/9)*71+Math.floor(yy/9)*103+(Math.floor(xx/9)*Math.floor(yy/9)*13))%200+200)%200+25);
    let i=(y*width+x)*4;data[i]=data[i+1]=data[i+2]=value;data[i+3]=255;
  }
  return {width,height,data};
}
test('tracks a translated tabletop and rejects feature loss',()=>{
  const tracker=createPlaneTracker(cv);const initial=tracker.start(frame(),rect);assert.equal(initial.ok,true, initial.reason);
  let moved=tracker.update(frame(5,4)); for(let i=0;i<8&&moved.ok;i++)moved=tracker.update(frame(5,4)); assert.equal(moved.ok,true,moved.reason);
  moved.corners.forEach((p,i)=>{assert.ok(Math.hypot(p.x-rect[i].x-5,p.y-rect[i].y-4)<3,JSON.stringify(moved));});
  const lost=tracker.update(frame(0,0,true));assert.equal(lost.ok,false);tracker.destroy();
});

test('tracks a modest perspective change',()=>{
  const source=frame(); const target=[{x:47,y:39},{x:276,y:31},{x:283,y:195},{x:36,y:203}];
  const m=planeTransform(rect,target),input=new cv.Mat(source.height,source.width,cv.CV_8UC4),out=new cv.Mat(),h=cv.matFromArray(3,3,cv.CV_64F,m);
  input.data.set(source.data);cv.warpPerspective(input,out,h,new cv.Size(source.width,source.height));
  const warped={width:source.width,height:source.height,data:new Uint8ClampedArray(out.data)};
  const tracker=createPlaneTracker(cv);assert.equal(tracker.start(source,rect).ok,true);let result=tracker.update(warped);for(let i=0;i<8&&result.ok;i++)result=tracker.update(warped);assert.equal(result.ok,true,result.reason);
  result.corners.forEach((p,i)=>assert.ok(Math.hypot(p.x-target[i].x,p.y-target[i].y)<5,JSON.stringify(result)));
  tracker.destroy();input.delete();out.delete();h.delete();
});

function paperFrame(dx=0,dy=0,noise=0,blank=false){
 const width=320,height=240,data=new Uint8ClampedArray(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const inside=x>=70+dx&&x<250+dx&&y>=55+dy&&y<185+dy;let v=blank?238:(inside?230:65);v=Math.max(0,Math.min(255,v+(noise?((x*17+y*13)%7)-3:0)));let i=(y*width+x)*4;data[i]=v;data[i+1]=v;data[i+2]=v;data[i+3]=255;}return {width,height,data};
}
test('finds blank white paper, rejects blank frame, and follows translation',()=>{
 const paper=detectWhitePaper(cv,paperFrame());assert.ok(paper);assert.ok(Math.abs(paper[0].x-70)<4);assert.ok(Math.abs(paper[0].y-55)<4);assert.equal(detectWhitePaper(cv,paperFrame(0,0,0,true)),null);
 const tracker=createPlaneTracker(cv);assert.equal(tracker.start(paperFrame(),paper,{paper:true}).ok,true);let result=tracker.update(paperFrame(8,5));assert.equal(result.ok,true,result.reason);assert.ok(result.corners[0].x>paper[0].x+3);tracker.destroy();
});
test('filters stationary jitter but follows deliberate motion',()=>{
 const base=[{x:20,y:20},{x:200,y:20},{x:200,y:150},{x:20,y:150}];const jitter=base.map(p=>({x:p.x+1,y:p.y-1}));const smooth=smoothCorners(base,jitter);assert.ok(Math.abs(smooth[0].x-base[0].x)<0.5);const moved=base.map(p=>({x:p.x+30,y:p.y}));assert.ok(smoothCorners(base,moved)[0].x>base[0].x+12);
});

test('paper tracking keeps corner identities when image orientation changes', async()=>{
 const {alignPaperCorners}=await import('../dist/paper.mjs');
 const ref=[{x:10,y:20},{x:100,y:10},{x:110,y:90},{x:20,y:100}];
 const rotated=[ref[1],ref[2],ref[3],ref[0]];
 assert.deepEqual(alignPaperCorners(rotated,ref),ref);
});

test('projection boundary occupies all four selected corners at full scale', async()=>{
 const {projectionRegion}=await import('../dist/plane-geometry.mjs');
 assert.deepEqual(projectionRegion({x:0,y:0,scale:1}),[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]);
 assert.deepEqual(projectionRegion({x:.1,y:.2,scale:.5}),[{x:.1,y:.2},{x:.6,y:.2},{x:.6,y:.7},{x:.1,y:.7}]);
});

test('manual boundary is retained when paper provides the tracking anchor',()=>{
 const paper=detectWhitePaper(cv,paperFrame());const manual=paper.map(p=>({x:p.x+5,y:p.y+3}));
 const tracker=createPlaneTracker(cv);const initial=tracker.start(paperFrame(),manual,{paper:true,paperCorners:paper});assert.deepEqual(initial.corners,manual);
 let result;for(let i=0;i<9;i++)result=tracker.update(paperFrame(8,5));assert.ok(result.ok);assert.ok(Math.abs(result.corners[0].x-manual[0].x-8)<2);tracker.destroy();
});

test('paper tracking hides while occluded and restores previous boundary',()=>{
 const paper=detectWhitePaper(cv,paperFrame());const tracker=createPlaneTracker(cv);assert.ok(tracker.start(paperFrame(),paper,{paper:true}).ok);
 for(let i=0;i<15;i++){const lost=tracker.update(paperFrame(0,0,0,true));assert.equal(lost.ok,true);assert.equal(lost.uncertain,true);}
 const recovered=tracker.update(paperFrame(8,5));assert.equal(recovered.ok,true);assert.equal(recovered.uncertain,false);tracker.destroy();
});

test('white paper detection handles lower exposure while rejecting full-frame white',()=>{
 const f=paperFrame();for(let i=0;i<f.data.length;i+=4){if(f.data[i]>200)f.data[i]=f.data[i+1]=f.data[i+2]=145;}
 assert.ok(detectWhitePaper(cv,f));assert.equal(detectWhitePaper(cv,paperFrame(0,0,0,true)),null);
});

test('does not reacquire a distant unrelated paper',()=>{
 const paper=detectWhitePaper(cv,paperFrame());const tracker=createPlaneTracker(cv);tracker.start(paperFrame(),paper,{paper:true});
 const lost=tracker.update(paperFrame(75,0));assert.ok(lost.ok);assert.equal(lost.uncertain,true);tracker.destroy();
});

test('white paper can anchor a manually selected region away from the paper',()=>{
 const paper=detectWhitePaper(cv,paperFrame());const manual=[{x:18,y:20},{x:150,y:20},{x:150,y:100},{x:18,y:100}];
 const tracker=createPlaneTracker(cv);assert.deepEqual(tracker.start(paperFrame(),manual,{paper:true,paperCorners:paper}).corners,manual);
 let result;for(let i=0;i<12;i++)result=tracker.update(paperFrame(8,5));assert.ok(result.ok);assert.ok(Math.abs(result.corners[0].x-manual[0].x-8)<2);tracker.destroy();
});
