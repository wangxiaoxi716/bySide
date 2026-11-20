import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PcmFrameEncoder } from '../original-ui/pcm-frames.mjs';

for (const rate of [16000, 44100, 48000]) {
  test(`capture at ${rate} Hz produces fifty 20 ms little-endian frames per second`, () => {
    const frames: ArrayBuffer[] = [];
    const encoder = new PcmFrameEncoder(rate, (frame: ArrayBuffer) => frames.push(frame));
    for (let offset = 0; offset < rate; offset += 128) encoder.push(new Float32Array(Math.min(128, rate - offset)).fill(0.5));
    assert.equal(frames.length, 50);
    assert.ok(frames.every(frame => frame.byteLength === 640));
    assert.equal(new DataView(frames[0]).getInt16(0, true), 16384);
    assert.equal(new DataView(frames[49]).getInt16(638, true), 16384);
  });
}

test('the actual worklet emits frames and continues through muted input', async t => {
  const saved = new Map<string, PropertyDescriptor | undefined>();
  function replace(name: string, value: any) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  t.after(() => { for (const [name, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete (globalThis as any)[name]; } });
  const frames: {frame:ArrayBuffer;capturedAt:number}[] = [];
  let Processor: any;
  replace('sampleRate', 48000);
  replace('currentTime', 1.25);
  replace('AudioWorkletProcessor', class { port = { postMessage: (frame: typeof frames[number]) => frames.push(frame) }; });
  replace('registerProcessor', (_name: string, constructor: any) => { Processor = constructor; });
  await import('../original-ui/voice-capture-worklet.mjs');
  const processor = new Processor();
  for (let i = 0; i < 375; i++) assert.equal(processor.process([[new Float32Array(128).fill(-1)]], [[new Float32Array(128)]]), true);
  assert.equal(frames.length, 50);
  assert.equal(frames[0].capturedAt,1.25);
  assert.equal(new DataView(frames[0].frame).getInt16(0, true), -32768);
  for (let i = 0; i < 375; i++) processor.process([], [[new Float32Array(128)]]);
  assert.equal(frames.length, 100);
  assert.ok(new Uint8Array(frames[99].frame).every(value => value === 0));
});
