import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chooseAutoCamera, projectionUrl} from '../original-ui/camera-start.mjs';

test('remembers the selected phone without silently switching to Mac',()=>{
 const devices=[{deviceId:'mac',label:'MacBook Air相机'},{deviceId:'phone',label:'babaophone的相机'}];
 assert.equal(chooseAutoCamera(devices,{id:'phone',label:'babaophone的相机'}).id,'phone');
 assert.equal(chooseAutoCamera(devices,{id:'old',label:'babaophone的相机'}).id,'phone');
 assert.equal(chooseAutoCamera([devices[0]],{id:'phone',label:'babaophone的相机'}).id,'phone');
 assert.equal(chooseAutoCamera(devices,{id:'mac',label:'MacBook Air相机'}).id,'phone');
 assert.equal(chooseAutoCamera([{deviceId:'mac',label:'MacBook Air相机'}],null),null);
 assert.equal(chooseAutoCamera([{deviceId:'p1',label:'iPhone'},{deviceId:'p2',label:'iPhone'}],null),null);
});

test('only normal projection opens in automatic AR mode',()=>{
 assert.equal(projectionUrl('http://127.0.0.1:4173/',null),'http://127.0.0.1:4173/projection.html?ar=1');
 assert.equal(projectionUrl('http://127.0.0.1:4173/','http://127.0.0.1:4173/chess-projection.html'),'http://127.0.0.1:4173/chess-projection.html');
});

test('automatic retry requires the saved device to actually appear', async()=>{
 const {availableAutoCamera}=await import('../original-ui/camera-start.mjs');
 const saved={id:'phone-old',label:'babaophone的相机'};
 assert.equal(availableAutoCamera([{deviceId:'mac',label:'MacBook Air相机'}],saved),null);
 assert.equal(availableAutoCamera([{deviceId:'new',label:'babaophone的相机'}],saved).id,'new');
 assert.equal(availableAutoCamera([{deviceId:'x',label:'babaophone的相机'},{deviceId:'y',label:'babaophone的相机'}],saved),null);
});
