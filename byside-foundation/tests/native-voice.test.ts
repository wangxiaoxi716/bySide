import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { resolve } from 'node:path';
import { NativeVoiceRunner } from '../server/src/native-voice';
import { NativeAudioBridge } from '../server/src/native-audio';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check: () => boolean, description: string) {
  for (let i = 0; i < 100; i++) { if (check()) return; await delay(10); }
  throw new Error(`timed out: ${description}`);
}

class FakeAudio extends EventEmitter {
  started = false; stops = 0; flushed = 0; playing: { pcm: Buffer; id: number }[] = [];
  async start() { this.started = true; }
  async stop() { this.stops++; }
  play(pcm: Buffer, id: number) { this.playing.push({ pcm, id }); }
  flush() { this.flushed++; }
}
class FakeSocket extends EventEmitter {
  readyState = 0; bufferedAmount = 0; sent: (string | Buffer)[] = [];
  send(data: string | Buffer) { this.sent.push(data); }
  open() { this.readyState = 1; this.emit('open'); }
  server(event: object) { this.emit('message', Buffer.from(JSON.stringify(event)), false); }
  audio(pcm: Buffer) { this.emit('message', pcm, true); }
  close() { this.readyState = 3; this.emit('close'); }
  terminate() { this.close(); }
}
function setup(fullDuplex = false) {
  const audio = new FakeAudio(), socket = new FakeSocket();
  const runner = new NativeVoiceRunner({ audio, connect: () => socket, fullDuplex });
  const errors: string[] = []; runner.on('failure', (message: string) => errors.push(message));
  return { audio, socket, runner, errors };
}
async function ready(env: ReturnType<typeof setup>) {
  const ended = env.runner.run();
  await until(() => env.audio.started, 'audio starts');
  env.socket.open();
  env.socket.server({ type: 'session.ready' });
  return { ended };
}
const frames = (socket: FakeSocket) => socket.sent.filter(Buffer.isBuffer) as Buffer[];
const presentations = (socket: FakeSocket) => socket.sent.filter((item): item is string => typeof item === 'string').map(item => JSON.parse(item)).filter(item => item.type === 'presentation.update').map(item => item.state);

test('keeps microphone silent until the speaker finishes, then cleans up on stop', async () => {
  const env = setup(); const { ended } = await ready(env);
  assert.deepEqual(JSON.parse(env.socket.sent[0] as string), { type: 'session.start', fullDuplex: false, presentation: 'device' });
  const input = Buffer.alloc(640, 7);
  env.audio.emit('capture', input);
  await until(() => frames(env.socket).some(frame => frame.equals(input)), 'microphone frame');
  env.socket.server({ type: 'audio.started' });
  env.socket.audio(Buffer.from([1, 0, 2, 0]));
  env.socket.server({ type: 'audio.done' });
  await until(() => presentations(env.socket).some(state => state.motion === 'speaking'), 'speaking presentation');
  const mark = frames(env.socket).length;
  env.audio.emit('capture', input); await delay(80);
  assert.ok(frames(env.socket).length > mark);
  assert.ok(frames(env.socket).slice(mark).every(frame => frame.length === 640 && frame.every(byte => byte === 0)), 'audio.done does not mean speaker finished');
  assert.deepEqual(env.audio.playing[0].pcm, Buffer.from([1, 0, 2, 0]));
  env.audio.emit('played', env.audio.playing[0].id);
  await delay(200); env.audio.emit('capture', input);
  await until(() => presentations(env.socket).at(-1)?.motion === 'listening', 'presentation follows completed playback');
  await until(() => frames(env.socket).slice(mark).some(frame => frame.equals(input)), 'microphone resumes');
  const stopped = env.runner.stop();
  await until(() => env.audio.stops === 1, 'microphone released');
  await until(() => env.socket.sent.some(value => typeof value === 'string' && JSON.parse(value).type === 'session.close'), 'session close sent');
  assert.ok(env.socket.sent.some(value => typeof value === 'string' && JSON.parse(value).type === 'session.close'));
  env.socket.server({ type: 'session.closed' });
  await stopped; assert.equal(await ended, 0); assert.equal(env.audio.stops, 1);
});

test('live captions are forwarded as ephemeral display state', async t => {
  const env = setup(); const { ended } = await ready(env);
  t.after(() => { env.socket.close(); return env.runner.stop(); });
  env.socket.server({ type: 'transcript.partial', text: '早上好' });
  await until(() => presentations(env.socket).some(state => state.speech === '你：早上好'), 'interim caption');
  env.socket.server({ type: 'assistant.text.delta', text: '早上' });
  env.socket.server({ type: 'assistant.text.delta', text: '好呀。' });
  await until(() => presentations(env.socket).some(state => state.speech === '早上好呀。'), 'assistant caption');
  const stopped = env.runner.stop(); env.socket.server({ type: 'session.closed' }); await stopped; await ended;
});

test('reports a busy session and releases audio without affecting the other owner', async () => {
  const env = setup(); const ended = env.runner.run();
  await until(() => env.audio.started, 'audio starts'); env.socket.open();
  env.socket.server({ type: 'error', code: 'busy', message: '已有实时语音会话，请先结束它' });
  assert.equal(await ended, 1); assert.equal(env.audio.stops, 1);
  assert.match(env.errors.join(' '), /已有实时语音会话/);
});

test('full duplex forwards input while playing and flushes interrupted audio', async () => {
  const env = setup(true); const { ended } = await ready(env);
  env.socket.server({ type: 'audio.started' }); env.socket.audio(Buffer.from([3, 0]));
  const input = Buffer.alloc(640, 9); env.audio.emit('capture', input);
  await until(() => frames(env.socket).some(frame => frame.equals(input)), 'full-duplex microphone');
  env.socket.server({ type: 'audio.flush' }); assert.equal(env.audio.flushed, 1);
  const stopped = env.runner.stop(); env.socket.server({ type: 'session.closed' }); await stopped;
  assert.equal(await ended, 0); assert.equal(env.audio.stops, 1);
});

test('disconnect stops the audio device and fails clearly', async () => {
  const env = setup(); const { ended } = await ready(env); env.socket.close();
  assert.equal(await ended, 1); assert.equal(env.audio.stops, 1);
  assert.match(env.errors.join(' '), /断开/);
});

test('device bridge exchanges real child-process audio messages and exits cleanly', async () => {
  const audio = new NativeAudioBridge(process.execPath, [resolve(__dirname, 'fixtures/native-audio-fake.cjs')]);
  const captures: Buffer[] = [], completed: number[] = [];
  audio.on('capture', (pcm: Buffer) => captures.push(pcm)); audio.on('played', (id: number) => completed.push(id));
  await audio.start();
  audio.play(Buffer.from([1, 0]), 17);
  await until(() => captures.length > 0 && completed.includes(17), 'capture and playback completion');
  assert.deepEqual(captures[0], Buffer.alloc(640, 4));
  await audio.stop(); assert.equal(audio.isRunning(), false);
});

test('device permission failure is reported and leaves no audio process', async () => {
  const audio = new NativeAudioBridge(process.execPath, [resolve(__dirname, 'fixtures/native-audio-fake.cjs'), '--fail']);
  await assert.rejects(audio.start(), /麦克风权限被拒绝/);
  await audio.stop(); assert.equal(audio.isRunning(), false);
});

test('adapter with an incompatible protocol is rejected before opening a cloud session', async () => {
  const audio = new NativeAudioBridge(process.execPath, [resolve(__dirname, 'fixtures/native-audio-fake.cjs'), '--wrong-version']);
  try { await assert.rejects(audio.start(), /协议版本或音频格式不兼容/); }
  finally { await audio.stop(); }
  assert.equal(audio.isRunning(), false);
});
