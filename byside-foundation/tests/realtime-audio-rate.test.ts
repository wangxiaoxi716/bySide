import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAudioFrameBudget } from '../server/src/realtime-audio-rate';

test('normal real-time audio survives a scheduling burst and resumes without reconnecting', () => {
  let now=0;
  const accept=createAudioFrameBudget(()=>now);
  for(let frame=0;frame<100;frame++,now+=20)assert.equal(accept(),true);
  now+=400;
  assert.equal(Array.from({length:30},accept).filter(Boolean).length,10);
  now+=20;
  assert.equal(accept(),true);
  assert.equal(accept(),false);
});
