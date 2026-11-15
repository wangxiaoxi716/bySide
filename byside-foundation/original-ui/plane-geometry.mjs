const EPS=1e-9;
export function validQuad(p, minArea=100){
  if(!Array.isArray(p)||p.length!==4||p.some(q=>!Number.isFinite(q?.x)||!Number.isFinite(q?.y))) return false;
  const crosses=p.map((a,i)=>{const b=p[(i+1)%4],c=p[(i+2)%4];return (b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x);});
  if(crosses.some(n=>Math.abs(n)<EPS)||!crosses.every(n=>Math.sign(n)===Math.sign(crosses[0])))return false;
  const area=Math.abs(p.reduce((s,a,i)=>{const b=p[(i+1)%4];return s+a.x*b.y-b.x*a.y;},0))/2;
  return area>=minArea;
}
export function planeTransform(from,to){
  if(!validQuad(from,EPS)||!validQuad(to,EPS))throw new Error('桌面区域无效，请重新选择四角。');
  const rows=[];
  for(let i=0;i<4;i++){const {x:u,y:v}=from[i],{x,y}=to[i];rows.push([u,v,1,0,0,0,-x*u,-x*v,x],[0,0,0,u,v,1,-y*u,-y*v,y]);}
  for(let c=0;c<8;c++){let k=c;for(let i=c+1;i<8;i++)if(Math.abs(rows[i][c])>Math.abs(rows[k][c]))k=i;if(Math.abs(rows[k][c])<EPS)throw new Error('桌面区域无效，请重新选择四角。');[rows[c],rows[k]]=[rows[k],rows[c]];const d=rows[c][c];for(let j=c;j<9;j++)rows[c][j]/=d;for(let i=0;i<8;i++){if(i===c)continue;const v=rows[i][c];for(let j=c;j<9;j++)rows[i][j]-=v*rows[c][j];}}
  return [...rows.map(r=>r[8]),1];
}
export function transformPoint(m,p){const d=m[6]*p.x+m[7]*p.y+m[8];if(!Number.isFinite(d)||Math.abs(d)<EPS)return null;return {x:(m[0]*p.x+m[1]*p.y+m[2])/d,y:(m[3]*p.x+m[4]*p.y+m[5])/d};}
export function cameraRect(boxWidth,boxHeight,videoWidth,videoHeight){const s=Math.min(boxWidth/videoWidth,boxHeight/videoHeight),width=videoWidth*s,height=videoHeight*s;return {x:(boxWidth-width)/2,y:(boxHeight-height)/2,width,height};}
export function cssMatrix(m){return `matrix3d(${[m[0],m[3],0,m[6],m[1],m[4],0,m[7],0,0,1,0,m[2],m[5],0,m[8]].join(',')})`;}
export function projectionRegion(position){
 const scale=Math.min(1,Math.max(.2,position.scale));
 const x=Math.max(0,Math.min(1-scale,position.x)),y=Math.max(0,Math.min(1-scale,position.y));
 return [{x,y},{x:x+scale,y},{x:x+scale,y:y+scale},{x,y:y+scale}];
}
