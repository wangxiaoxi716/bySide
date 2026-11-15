import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { findSavedCamera, zoomRange, setTrackZoom } from '../src/camera';

test('restores by exact id or an unambiguous matching label, and never chooses a different camera', () => {
  const cameras = [{deviceId:'new',label:'iPhone'}, {deviceId:'mac',label:'Mac'}];
  assert.equal(findSavedCamera(cameras, {id:'mac',label:'iPhone'})?.deviceId, 'mac');
  assert.equal(findSavedCamera(cameras, {id:'old',label:'iPhone'})?.deviceId, 'new');
  assert.equal(findSavedCamera(cameras, {id:'old',label:'missing'}), null);
  assert.equal(findSavedCamera([...cameras, {deviceId:'other',label:'iPhone'}], {id:'old',label:'iPhone'}), null);
});

test('reports only usable zoom ranges and applies the requested zoom', async () => {
  let applied: unknown;
  const track = {getCapabilities:()=>({zoom:{min:1,max:3,step:0.1}}),getSettings:()=>({zoom:1.5}),applyConstraints:async (value: unknown)=>{applied=value;}} as unknown as MediaStreamTrack;
  assert.deepEqual(zoomRange(track), {min:1,max:3,step:0.1,value:1.5});
  await setTrackZoom(track, 1);
  assert.deepEqual(applied, {advanced:[{zoom:1}]});
  assert.equal(zoomRange({getCapabilities:()=>({})} as unknown as MediaStreamTrack), null);
});
