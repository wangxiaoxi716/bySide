export function projectionUrl(base, chessUrl){
 if(chessUrl)return chessUrl;
 const url=new URL('projection.html',base);url.searchParams.set('ar','1');return url.href;
}
export function chooseAutoCamera(devices,saved){
 const mac=name=>/macbook|facetime|built.in|内建|内置/i.test(name||'');
 if(saved?.id && !mac(saved.label)){
  const exact=devices.find(d=>d.deviceId===saved.id);
  if(exact)return {id:exact.deviceId,label:exact.label||saved.label||''};
  const labels=saved.label?devices.filter(d=>d.label===saved.label):[];
  if(labels.length===1)return {id:labels[0].deviceId,label:labels[0].label};
  return {id:saved.id,label:saved.label||''};
 }
 const phones=devices.filter(d=>d.deviceId&&/iphone|phone|手机/i.test(d.label)&&!mac(d.label));
 return phones.length===1?{id:phones[0].deviceId,label:phones[0].label}:null;
}
export function availableAutoCamera(devices,saved){
 const selected=chooseAutoCamera(devices,saved);
 return selected&&devices.some(device=>device.deviceId===selected.id)?selected:null;
}
