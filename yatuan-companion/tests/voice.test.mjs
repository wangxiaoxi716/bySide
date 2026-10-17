import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const voiceSource = await readFile(new URL('../dist/voice-session.js', import.meta.url), 'utf8');
const mediaSource = await readFile(new URL('../dist/media.js', import.meta.url), 'utf8');
let imports = 0;
const fresh = source => import(`data:text/javascript;base64,${Buffer.from(`${source}\n// test ${++imports}`).toString('base64')}`);

async function harness(run) {
  const names = ['SpeechRecognition', 'webkitSpeechRecognition', 'speechSynthesis', 'SpeechSynthesisUtterance', 'navigator', 'setTimeout', 'clearTimeout'];
  const originals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  let now = 0, timerId = 0;
  const timers = new Map();
  const instances = [];
  class Recognition {
    constructor() { instances.push(this); this.aborted = false; }
    start() { this.onstart?.(); }
    abort() { this.aborted = true; }
    end() { this.onend?.(); }
    error(error) { this.onerror?.({ error }); }
    result(parts, resultIndex = 0) {
      this.onresult?.({ resultIndex, results: parts.map(([transcript, isFinal = true]) => Object.assign([{ transcript }], { isFinal })) });
    }
  }
  const utterances = [];
  let cancelCount = 0;
  globalThis.SpeechRecognition = Recognition;
  globalThis.webkitSpeechRecognition = undefined;
  globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  globalThis.speechSynthesis = {
    getVoices: () => [{ name: 'test', lang: 'zh-CN' }],
    speak: utterance => { utterances.push(utterance); utterance.onstart?.(); },
    cancel: () => { cancelCount += 1; },
  };
  globalThis.setTimeout = (callback, delay = 0) => { const id = ++timerId; timers.set(id, { callback, at: now + delay }); return id; };
  globalThis.clearTimeout = id => timers.delete(id);
  const advance = milliseconds => {
    const target = now + milliseconds;
    for (let pass = 0; pass < 200; pass += 1) {
      const next = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) { now = target; return; }
      const [id, timer] = next;
      now = timer.at;
      timers.delete(id);
      timer.callback();
    }
    throw new Error('Runaway timer');
  };
  try {
    const voice = await fresh(voiceSource);
    const media = await fresh(mediaSource);
    await run({ voice, media, instances, utterances, advance, timers, get cancelCount() { return cancelCount; } });
    media.stopSpeaking();
  } finally {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
}

test('recognition waits for explicit start and delivers each final phrase only once', async () => {
  await harness(({ voice, instances }) => {
    const text = [], interim = [], states = [];
    const session = voice.createVoiceSession({ onText: value => text.push(value), onInterim: value => interim.push(value), onState: value => states.push(value) });
    assert.equal(instances.length, 0);
    assert.equal(session.resume(), false);
    assert.equal(session.start(), true);
    assert.equal(instances[0].continuous, true);
    assert.equal(instances[0].lang, 'zh-CN');
    instances[0].result([['你好芽团', true], ['看看', false]]);
    instances[0].result([['你好芽团', true], ['看看我的餐盘', true]], 1);
    instances[0].result([['你好芽团', true], ['看看我的餐盘', true]], 1);
    assert.deepEqual(text, ['你好芽团', '看看我的餐盘']);
    assert.ok(interim.includes('看看'));
    assert.deepEqual(states.slice(0, 2), ['starting', 'listening']);
    session.stop(); instances[0].end();
  });
});

test('pause discards stale speech and resume waits for previous recognizer to end', async () => {
  await harness(({ voice, instances, advance }) => {
    const text = [];
    const session = voice.createVoiceSession({ onText: value => text.push(value) });
    session.start();
    const stale = instances[0].onresult;
    session.pause();
    session.resume();
    assert.equal(instances.length, 1, 'no recognizer overlaps an abort in progress');
    stale({ results: [Object.assign([{ transcript: '芽团自己的声音' }], { isFinal: true })] });
    assert.deepEqual(text, []);
    instances[0].end(); advance(150);
    assert.equal(instances.length, 2);
    instances[1].result([['用户的新问题']]);
    assert.deepEqual(text, ['用户的新问题']);
    session.stop(); instances[1].end();
  });
});

test('one continuous session finishes draining before another starts', async () => {
  await harness(({ voice, instances }) => {
    const first = voice.createVoiceSession();
    const second = voice.createVoiceSession();
    first.start(); second.start();
    assert.equal(instances.length, 1);
    assert.equal(instances[0].aborted, true);
    instances[0].end();
    assert.equal(instances.length, 2);
    second.stop(); instances[1].end();
  });
});

test('normal end automatically restarts, but stop cancels a pending restart', async () => {
  await harness(({ voice, instances, advance }) => {
    const session = voice.createVoiceSession();
    session.start(); instances[0].end(); advance(700);
    assert.equal(instances.length, 2);
    instances[1].end(); session.stop(); advance(10_000);
    assert.equal(instances.length, 2);
    assert.equal(session.resume(), false);
  });
});

test('permission refusal is fatal and does not produce an automatic permission loop', async () => {
  await harness(({ voice, instances, advance }) => {
    const errors = [], states = [];
    const session = voice.createVoiceSession({ onError: value => errors.push(value), onState: value => states.push(value) });
    session.start(); instances[0].error('not-allowed'); instances[0].end(); advance(60_000);
    assert.equal(instances.length, 1);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /权限/);
    assert.equal(states.at(-1), 'error');
  });
});

test('recurrent network errors stop after bounded retries with increasing delay', async () => {
  await harness(({ voice, instances, advance }) => {
    const errors = [];
    const session = voice.createVoiceSession({ onError: value => errors.push(value) });
    session.start(); instances[0].error('network'); instances[0].end();
    advance(999); assert.equal(instances.length, 1);
    advance(1); assert.equal(instances.length, 2);
    instances[1].error('network'); instances[1].end();
    advance(1999); assert.equal(instances.length, 2);
    advance(1); assert.equal(instances.length, 3);
    instances[2].error('network'); instances[2].end(); advance(60_000);
    assert.equal(instances.length, 3);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /连接失败/);
  });
});

test('failed abort never starts a second overlapping recognizer', async () => {
  await harness(({ voice, instances, advance }) => {
    const errors = [];
    const session = voice.createVoiceSession({ onError: value => errors.push(value) });
    session.start(); session.pause(); session.resume(); advance(2000);
    assert.equal(instances.length, 1);
    assert.match(errors[0], /刷新/);
    assert.equal(session.start(), false);
    advance(10_000); assert.equal(instances.length, 1);
  });
});

test('speech resolves after end and stopSpeaking resolves cancelled even without browser events', async () => {
  await harness(async ({ media, utterances }) => {
    let starts = 0;
    const finished = media.speakAsync('你好，芽团。', { onStart: () => { starts += 1; } });
    utterances[0].onend();
    assert.deepEqual(await finished, { status: 'ended' });
    assert.equal(starts, 1);
    const cancelled = media.speakAsync('这句话会被取消。');
    media.stopSpeaking();
    assert.deepEqual(await cancelled, { status: 'cancelled' });
  });
});

test('speech abort, replacement, failure and missing end event all settle', async () => {
  await harness(async ({ media, utterances, advance }) => {
    const controller = new AbortController();
    const aborted = media.speakAsync('中断', { signal: controller.signal });
    controller.abort(); assert.deepEqual(await aborted, { status: 'cancelled' });
    const replaced = media.speakAsync('旧回复');
    const replacement = media.speakAsync('新回复');
    assert.deepEqual(await replaced, { status: 'cancelled' });
    utterances.at(-1).onerror(); assert.deepEqual(await replacement, { status: 'error' });
    const hanging = media.speakAsync('等待');
    advance(10_000); assert.deepEqual(await hanging, { status: 'timeout' });
    assert.equal(media.speak('朗读'), true);
    media.stopSpeaking();
  });
});

test('USB device selection uses exact constraints and stale camera permission releases tracks', async () => {
  await harness(async ({ media }) => {
    const tracks = [{ readyState: 'live', stopped: 0, stop() { this.stopped += 1; this.readyState = 'ended'; } }];
    const stream = { getTracks: () => tracks, getVideoTracks: () => tracks };
    let constraints, resolveStream, permissions = 0;
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: {
      enumerateDevices: async () => [{ kind: 'audioinput', deviceId: 'mic' }, { kind: 'videoinput', deviceId: 'usb', label: 'USB Camera', groupId: 'g' }],
      getUserMedia: value => { permissions += 1; constraints = value; return new Promise(resolve => { resolveStream = resolve; }); },
    } } });
    assert.deepEqual(await media.listCameras(), [{ deviceId: 'usb', label: 'USB Camera', groupId: 'g' }]);
    assert.equal(permissions, 0, 'enumeration never opens hardware');
    const video = { tagName: 'VIDEO', srcObject: null, play: async () => {}, pause() {} };
    const pending = media.startCamera(video, { deviceId: 'usb' });
    assert.deepEqual(constraints.video.deviceId, { exact: 'usb' });
    assert.equal(constraints.audio, false);
    media.stopCamera(video);
    resolveStream(stream);
    await assert.rejects(pending, { name: 'AbortError' });
    assert.ok(tracks[0].stopped > 0);
    assert.equal(video.srcObject, null);
  });
});
