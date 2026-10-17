import test from 'node:test';
import assert from 'node:assert/strict';
import { isTransientStoneMiss } from '../dist/chess-vision-feedback.js';
import { calibrateBoard, createStoneTracker } from '../dist/chess-vision-core.js';
import { createGame } from '../dist/chess-core.js';
const pending = {status:'stabilizing',candidate:{center:{x:250,y:240},spacing:30,matchMethod:'coverage'}};
const empty = {blocked:false,detections:[]};
const edge = {blocked:true,detections:[],diagnostics:{rejections:[{code:'off-grid'}],previewDetections:[{center:{x:251,y:240},coveredIntersections:[]}]}};
test('clean frames establish a baseline instead of being classified as transient misses',()=>{
  const calibration=calibrateBoard([{x:30,y:30},{x:450,y:30},{x:450,y:450},{x:30,y:450}],480,480);
  const tracker=createStoneTracker({calibration});tracker.arm();let previous=null;
  for(const now of [0,350,700]) previous=tracker.update({detections:[],transient:isTransientStoneMiss(empty,previous),game:createGame(),now});
  assert.equal(previous.status,'ready');
  assert.equal(isTransientStoneMiss(empty,{...pending,status:'accepted'}),false);
});
test('an established candidate can survive a short empty frame or coverage edge flicker',()=>{
  assert.equal(isTransientStoneMiss(empty,pending),true);
  assert.equal(isTransientStoneMiss(edge,pending),true);
  assert.equal(isTransientStoneMiss(edge,{...pending,status:'transient'}),true);
});
test('no candidate, changed location, multiple coverage and additional obstructions are not soft misses',()=>{
  assert.equal(isTransientStoneMiss(edge,null),false);
  assert.equal(isTransientStoneMiss(edge,{...pending,candidate:{...pending.candidate,center:{x:260,y:240}}}),false);
  for(const code of ['exposure','low-contrast','ambiguous-shape','multiple-covered','clipped']) {
    assert.equal(isTransientStoneMiss({...edge,diagnostics:{...edge.diagnostics,rejections:[{code}]}},pending),false);
  }
  assert.equal(isTransientStoneMiss({...edge,diagnostics:{...edge.diagnostics,rejections:[{code:'off-grid'},{code:'low-contrast'}]}},pending),false);
  assert.equal(isTransientStoneMiss({...edge,diagnostics:{...edge.diagnostics,previewDetections:[{center:{x:251,y:240},coveredIntersections:[112,113]}]}},pending),false);
});
