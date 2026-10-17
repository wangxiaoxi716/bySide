import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveController } from '../dist/live.js';
import { normalizeLiveConfig, voiceCommand, parseLiveReply, feedbackPatch, shouldAnnounce } from '../dist/live-core.js';

const flush = async () => { for (let step = 0; step < 15; step += 1) await Promise.resolve(); };
const defer = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const result = (patch = {}) => ({ reply: '看起来有米饭，我们慢慢吃。', mood: 'eating', platePresent: true, foods: [{ name: '米饭', group: '主食', certain: true }], shouldSpeak: true, observation: '盘子里有米饭', ...patch });

function fakeLocks() {
  let held = false;
  return { request(_name, _options, callback) {
    if (held) return Promise.resolve(callback(null));
    held = true;
    return Promise.resolve(callback({ name: 'yatuan-live-devices' })).finally(() => { held = false; });
  } };
}

function makeHarness(t, { configured = true, supported = true, locks = fakeLocks(), request, camera, speech, autoVoiceState = true, voiceStartError = '', defaultTimers = false, controllerOverrides = {} } = {}) {
  let now = 2_000_000, nextTimer = 0, callbacks;
  let state = { personality: 'gentle', memories: [], chat: [], speech: '原来的气泡', energy: 80, intimacy: 20, growth: 18, growthStage: 0, liveProgress: { lastMealAt: 0, lastChatAt: 0 } };
  const timers = new Map();
  const calls = { cameraStarts: 0, cameraStops: 0, captures: 0, requests: [], speech: [], voiceStart: 0, voicePause: 0, voiceResume: 0, voiceStop: 0, stoppedSpeech: 0, stopDemo: 0 };
  const video = { srcObject: null };
  const track = { addEventListener() {} };
  const controller = createLiveController({
    locks, createChannel: () => null,
    config: () => ({ cameraId: 'usb-camera', intervalSeconds: 10, wakePhrase: '芽团芽团' }),
    now: () => now,
    ...(defaultTimers ? {} : {
      setTimeout: (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, at: now + delay }); return id; },
      clearTimeout: id => timers.delete(id),
    }),
    isAIConfigured: () => configured,
    getState: () => structuredClone(state),
    updateState: patch => { state = { ...state, ...structuredClone(patch) }; },
    addMemory: text => { state.memories.push({ text }); },
    stopDemo: () => { calls.stopDemo += 1; },
    startCamera: async (target, options) => {
      calls.cameraStarts += 1;
      assert.equal(options.deviceId, 'usb-camera');
      if (camera) await camera(calls.cameraStarts, target);
      target.srcObject = { getVideoTracks: () => [track] };
    },
    stopCamera: target => { calls.cameraStops += 1; target.srcObject = null; },
    captureFrame: () => { calls.captures += 1; return 'data:image/jpeg;base64,YWJjZA=='; },
    requestAI: async args => { calls.requests.push(args); return request ? request(args, calls.requests.length) : JSON.stringify(result()); },
    speakAsync: async (text, options) => { calls.speech.push({ text, options }); return speech ? speech(text, options) : { status: 'ended' }; },
    stopSpeaking: () => { calls.stoppedSpeech += 1; },
    createVoiceSession: cb => {
      callbacks = cb;
      return {
        isSupported: supported,
        start() {
          calls.voiceStart += 1;
          if (voiceStartError) { cb.onState('error'); cb.onError(voiceStartError); return false; }
          if (autoVoiceState) cb.onState('listening');
        },
        pause() { calls.voicePause += 1; if (autoVoiceState) cb.onState('paused'); },
        resume() { calls.voiceResume += 1; if (autoVoiceState) cb.onState('listening'); },
        stop() { calls.voiceStop += 1; if (autoVoiceState) cb.onState('idle'); },
      };
    },
    ...controllerOverrides,
  });
  const advance = async ms => {
    const end = now + ms;
    for (let iteration = 0; iteration < 1000; iteration += 1) {
      const next = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      now = next[1].at; timers.delete(next[0]);
      next[1].callback();
      await flush();
    }
    now = end; await flush();
  };
  t.after(() => controller.destroy());
  return { controller, calls, video, advance, getState: () => structuredClone(state), voice: () => callbacks };
}

test('unconfigured AI cannot request camera or voice permissions', async t => {
  const h = makeHarness(t, { configured: false });
  await assert.rejects(h.controller.start(h.video), /AI/);
  assert.equal(h.calls.cameraStarts, 0);
  assert.equal(h.calls.voiceStart, 0);
  assert.equal(h.controller.getStatus().active, false);
});

test('a Web Lock prevents two windows from capturing or speaking simultaneously', async t => {
  const locks = fakeLocks();
  const first = makeHarness(t, { locks });
  const second = makeHarness(t, { locks });
  await first.controller.start(first.video);
  await assert.rejects(second.controller.start(second.video), /另一个/);
  assert.equal(second.calls.cameraStarts, 0);
  first.controller.stop(); await flush();
  await second.controller.start(second.video);
  assert.equal(second.controller.getStatus().localOwner, true);
});

test('arming checks camera permission then closes it; only waking uploads a frame', async t => {
  const h = makeHarness(t);
  await h.controller.start(h.video);
  assert.equal(h.calls.cameraStarts, 1);
  assert.equal(h.calls.cameraStops, 1);
  assert.equal(h.video.srcObject, null);
  h.voice().onText('今天吃什么？');
  h.voice().onState('retrying');
  h.voice().onText('我还没有叫醒你');
  await h.advance(30_000);
  assert.equal(h.calls.requests.length, 0);
  assert.equal(h.calls.captures, 0);
  h.voice().onText('芽团芽团，看看我的盘子');
  await flush();
  assert.equal(h.calls.requests.length, 1);
  assert.equal(h.calls.cameraStarts, 2);
  assert.match(h.calls.requests[0].imageDataUrl, /^data:image\/jpeg/);
  assert.equal(h.calls.speech.length, 1);
});

test('manual wake and typed dialogue work without SpeechRecognition', async t => {
  const h = makeHarness(t, { supported: false });
  await h.controller.start(h.video);
  assert.equal(h.controller.getStatus().voiceSupported, false);
  assert.equal(h.calls.voiceStart, 0);
  await h.controller.wake();
  h.controller.handleText('我今天有点累'); await flush();
  assert.equal(h.calls.requests.length, 2);
  assert.equal(h.calls.speech.length, 2);
  assert.ok(h.getState().chat.some(message => message.text === '我今天有点累'));
});

test('voice startup only reports listening after the recognizer confirms it', async t => {
  const h = makeHarness(t, { autoVoiceState: false });
  await h.controller.start(h.video);
  const starting = h.controller.getStatus();
  assert.equal(starting.active, true);
  assert.equal(starting.mode, 'armed');
  assert.equal(starting.voiceState, 'starting');
  assert.match(starting.message, /语音/);
  assert.doesNotMatch(starting.message, /等你说|也在听|正在听|已就绪/);
  assert.equal(h.calls.requests.length, 0);
  h.voice().onState('listening');
  const ready = h.controller.getStatus();
  assert.equal(ready.voiceState, 'listening');
  assert.match(ready.message, /芽团芽团/);
});

for (const timing of ['asynchronous', 'synchronous']) {
  test(`${timing} voice failure keeps manual camera and AI interaction available`, async t => {
    const diagnostic = '语音识别启动超时。请检查麦克风权限和网络后重试。';
    const h = makeHarness(t, { autoVoiceState: false, voiceStartError: timing === 'synchronous' ? diagnostic : '' });
    await h.controller.start(h.video);
    if (timing === 'asynchronous') {
      h.voice().onState('error');
      h.voice().onError(diagnostic);
    }
    const failedVoice = h.controller.getStatus();
    assert.equal(failedVoice.active, true);
    assert.equal(failedVoice.localOwner, true);
    assert.equal(failedVoice.mode, 'armed');
    assert.equal(failedVoice.voiceState, 'unavailable');
    assert.equal(failedVoice.voiceWarning, diagnostic);
    assert.equal(failedVoice.error, '', 'voice warnings must not be confused with camera or AI failures');
    assert.doesNotMatch(failedVoice.message, /等你说|也在听|正在听|说“继续观察”/);

    await h.controller.wake();
    assert.equal(h.calls.cameraStarts, 2);
    assert.equal(h.calls.requests.length, 1);
    assert.match(h.calls.requests[0].imageDataUrl, /^data:image\/jpeg/);
    assert.equal(h.calls.speech.length, 1);
    assert.equal(h.controller.getStatus().mode, 'observing');
    assert.equal(h.controller.getStatus().voiceState, 'unavailable');
    assert.equal(h.controller.getStatus().voiceWarning, diagnostic);
    assert.doesNotMatch(h.controller.getStatus().message, /等你说|也在听|正在听/);

    h.controller.handleText('我今天有点累'); await flush();
    assert.equal(h.calls.requests.length, 2);
    assert.ok(h.getState().chat.some(message => message.text === '我今天有点累'));
    h.controller.pauseObservation();
    assert.equal(h.video.srcObject, null);
    assert.doesNotMatch(h.controller.getStatus().message, /说“继续观察”/);
    h.controller.stop();
    const stopped = h.controller.getStatus();
    assert.equal(stopped.active, false);
    assert.equal(stopped.voiceState, 'idle');
    assert.equal(stopped.voiceWarning, '');
  });
}

test('voice failure during observation pauses capture and discards pending feedback until manual wake', async t => {
  const pending = defer();
  const h = makeHarness(t, { autoVoiceState: false, request: (_args, number) => number === 1 ? pending.promise : JSON.stringify(result()) });
  await h.controller.start(h.video);
  h.voice().onState('listening');
  const waking = h.controller.wake(); await flush();
  const signal = h.calls.requests[0].signal;
  h.voice().onState('error');
  h.voice().onError('语音识别连续连接失败。');
  const paused = h.controller.getStatus();
  assert.equal(paused.active, true);
  assert.equal(paused.mode, 'paused');
  assert.equal(paused.voiceState, 'unavailable');
  assert.equal(signal.aborted, true);
  assert.equal(h.video.srcObject, null);
  pending.resolve(JSON.stringify(result()));
  await waking; await h.advance(30_000);
  assert.equal(h.calls.requests.length, 1);
  assert.equal(h.calls.captures, 1);
  assert.equal(h.calls.speech.length, 0);
  assert.equal(h.getState().growth, 18);
  await h.controller.wake();
  assert.equal(h.calls.requests.length, 2);
  assert.equal(h.calls.speech.length, 1);
  assert.equal(h.controller.getStatus().mode, 'observing');
  assert.equal(h.controller.getStatus().voiceState, 'unavailable');
});

for (const action of ['stop', 'pauseObservation']) {
  test(`${action} aborts the pending request and ignores late AI feedback`, async t => {
    const pending = defer();
    const h = makeHarness(t, { request: () => pending.promise });
    await h.controller.start(h.video);
    const waking = h.controller.wake(); await flush();
    assert.equal(h.calls.requests.length, 1);
    const signal = h.calls.requests[0].signal;
    h.controller[action]();
    assert.equal(signal.aborted, true);
    pending.resolve(JSON.stringify(result()));
    await waking; await h.advance(60_000);
    assert.equal(h.calls.requests.length, 1);
    assert.equal(h.calls.speech.length, 0);
    assert.equal(h.getState().growth, 18);
    assert.equal(h.getState().speech, '原来的气泡');
    assert.equal(h.video.srcObject, null);
    assert.equal(h.controller.getStatus().active, action !== 'stop');
  });
}

test('pause while camera wake is pending prevents capture after permission resolves', async t => {
  const pending = defer();
  const h = makeHarness(t, { camera: count => count === 2 ? pending.promise : undefined });
  await h.controller.start(h.video);
  const waking = h.controller.wake(); await flush();
  h.controller.pauseObservation();
  pending.resolve(); await waking; await h.advance(30_000);
  assert.equal(h.calls.requests.length, 0);
  assert.equal(h.calls.captures, 0);
  assert.equal(h.video.srcObject, null);
});

test('concurrent wake commands open one camera session and start one observation', async t => {
  const pending = defer();
  const h = makeHarness(t, { camera: count => count === 2 ? pending.promise : undefined });
  await h.controller.start(h.video);
  const first = h.controller.wake();
  const second = h.controller.wake();
  await flush();
  assert.equal(h.calls.cameraStarts, 2);
  pending.resolve(); await Promise.all([first, second]); await flush();
  assert.equal(h.calls.requests.length, 1);
});

test('observation waits for AI and playback to finish instead of accumulating timer work', async t => {
  const pending = defer(), playback = defer();
  const h = makeHarness(t, { request: (_args, number) => number === 1 ? pending.promise : JSON.stringify(result()), speech: () => playback.promise });
  await h.controller.start(h.video);
  const waking = h.controller.wake(); await flush();
  await h.advance(60_000);
  assert.equal(h.calls.requests.length, 1);
  assert.equal(h.calls.captures, 1);
  pending.resolve(JSON.stringify(result())); await flush();
  assert.equal(h.calls.speech.length, 1);
  await h.advance(60_000);
  assert.equal(h.calls.requests.length, 1);
  playback.resolve({ status: 'ended' }); await waking;
  await h.advance(9_999); assert.equal(h.calls.requests.length, 1);
  await h.advance(1); assert.equal(h.calls.requests.length, 2);
});

test('speech arriving during a request keeps only the latest pending question', async t => {
  const pending = defer();
  const h = makeHarness(t, { request: (_args, number) => number === 1 ? pending.promise : JSON.stringify(result()) });
  await h.controller.start(h.video);
  const waking = h.controller.wake(); await flush();
  h.controller.handleText('第一句');
  h.controller.handleText('第二句');
  h.controller.handleText('最后一句');
  assert.equal(h.calls.requests.length, 1);
  pending.resolve(JSON.stringify(result())); await waking; await flush();
  assert.equal(h.calls.requests.length, 2);
  assert.equal(h.calls.requests[1].messages.at(-1).content, '最后一句');
  assert.equal(h.getState().chat.some(message => message.text === '第一句' || message.text === '第二句'), false);
});

test('stop aborts playback and a late playback completion cannot resume listening', async t => {
  const pending = defer();
  const h = makeHarness(t, { speech: () => pending.promise });
  await h.controller.start(h.video);
  const waking = h.controller.wake(); await flush();
  assert.equal(h.calls.speech.length, 1);
  const resumeCount = h.calls.voiceResume;
  h.controller.stop();
  assert.equal(h.calls.speech[0].options.signal.aborted, true);
  pending.resolve({ status: 'ended' }); await waking; await flush();
  assert.equal(h.calls.voiceResume, resumeCount);
  assert.equal(h.controller.getStatus().mode, 'idle');
  assert.equal(h.getState().motion, 'idle');
});

test('camera permission failure releases the device lock for another window', async t => {
  const locks = fakeLocks();
  const failing = makeHarness(t, { locks, camera: () => Promise.reject(new Error('camera denied')) });
  await assert.rejects(failing.controller.start(failing.video), /camera denied/);
  assert.equal(failing.controller.getStatus().active, false);
  await flush();
  const next = makeHarness(t, { locks });
  await next.controller.start(next.video);
  assert.equal(next.controller.getStatus().localOwner, true);
});

test('default browser timers preserve their global receiver during startup and cleanup', async t => {
  let scheduled = 0, cleared = 0;
  // Unlike Node timers, Chrome's Window timers reject an arbitrary object receiver.
  t.mock.method(globalThis, 'setTimeout', function () {
    if (this !== globalThis) throw new TypeError('Illegal invocation');
    return ++scheduled;
  });
  t.mock.method(globalThis, 'clearTimeout', function () {
    if (this !== globalThis) throw new TypeError('Illegal invocation');
    cleared += 1;
  });
  const h = makeHarness(t, { defaultTimers: true });
  await h.controller.start(h.video);
  assert.equal(h.controller.getStatus().mode, 'armed');
  assert.equal(h.calls.cameraStarts, 1);
  assert.ok(scheduled > 0, 'startup schedules its heartbeat using the default timer');
  h.controller.stop();
  assert.equal(h.controller.getStatus().active, false);
  assert.ok(cleared > 0, 'cleanup uses the default clearTimeout');
});

test('heartbeat scheduling failure resets startup and releases the lock for retry', async t => {
  const locks = fakeLocks();
  let failHeartbeat = true;
  const h = makeHarness(t, { locks, controllerOverrides: {
    setTimeout: () => {
      if (failHeartbeat) {
        failHeartbeat = false;
        throw new Error('heartbeat scheduler unavailable');
      }
      return 1;
    },
  } });
  await assert.rejects(h.controller.start(h.video), /heartbeat scheduler unavailable/);
  const failed = h.controller.getStatus();
  assert.equal(failed.active, false);
  assert.equal(failed.localOwner, false);
  assert.equal(failed.owner, '');
  assert.equal(failed.mode, 'error');
  assert.match(failed.error, /heartbeat scheduler unavailable/);
  assert.equal(h.calls.cameraStarts, 0);
  assert.equal(h.calls.voiceStart, 0);
  await flush();
  const other = makeHarness(t, { locks });
  await other.controller.start(other.video);
  assert.equal(other.controller.getStatus().localOwner, true);
  other.controller.stop(); await flush();
  await h.controller.start(h.video);
  assert.equal(h.controller.getStatus().mode, 'armed');
  assert.equal(h.controller.getStatus().error, '');
  assert.equal(h.calls.cameraStarts, 1);
});

test('frequent observation of the same meal neither repeats speech nor farms growth', async t => {
  const h = makeHarness(t);
  await h.controller.start(h.video);
  await h.controller.wake();
  const growth = h.getState().growth;
  const intimacy = h.getState().intimacy;
  await h.advance(60_000);
  assert.equal(h.calls.requests.length, 7);
  assert.equal(h.calls.speech.length, 1);
  assert.equal(h.getState().growth, growth);
  assert.equal(h.getState().intimacy, intimacy);
});

test('paused-camera chat sends no image and cannot award imagined food growth', async t => {
  const h = makeHarness(t);
  await h.controller.start(h.video);
  await h.controller.wake();
  h.controller.pauseObservation();
  const growth = h.getState().growth;
  const captures = h.calls.captures;
  h.controller.handleText('请记住，我喜欢热饭'); await flush();
  assert.equal(h.calls.requests.length, 2);
  assert.equal(h.calls.requests[1].imageDataUrl, undefined);
  assert.equal(h.calls.captures, captures);
  assert.equal(h.getState().growth, growth);
  assert.equal(h.getState().activity, '陪伴');
  assert.deepEqual(h.getState().memories, [{ text: '我喜欢热饭' }]);
});

test('three consecutive failures stop automatic camera capture', async t => {
  const h = makeHarness(t, { request: () => Promise.reject(new Error('mock unavailable')) });
  await h.controller.start(h.video);
  await h.controller.wake();
  await h.advance(30_000);
  assert.equal(h.calls.requests.length, 3);
  assert.equal(h.video.srcObject, null);
  assert.match(h.controller.getStatus().error, /连续三次/);
  await h.advance(60_000);
  assert.equal(h.calls.requests.length, 3);
});

test('voice rules recognize wake aliases and explicit stop without matching unrelated sentences', () => {
  assert.deepEqual(voiceCommand('牙团牙团，看看盘子'), { type: 'wake', text: '看看盘子' });
  assert.deepEqual(voiceCommand('暂停观察'), { type: 'pause' });
  assert.deepEqual(voiceCommand('结束陪伴'), { type: 'stop' });
  assert.equal(voiceCommand('我不想结束陪伴').type, 'text');
  assert.equal(voiceCommand('我刚刚在聊芽团芽团的故事').type, 'text');
  assert.deepEqual(normalizeLiveConfig({ intervalSeconds: 1, wakePhrase: '', cameraId: 'USB' }), { intervalSeconds: 10, wakePhrase: '芽团芽团', cameraId: 'USB' });
});

test('untrusted AI JSON is bounded and cannot inject growth or arbitrary character state', () => {
  const parsed = parseLiveReply(JSON.stringify(result({ mood: '<script>', growth: 999999, foods: [{ name: '未知', group: 'arbitrary', certain: 'yes' }] })));
  assert.equal(parsed.mood, 'curious');
  assert.equal('growth' in parsed, false);
  assert.deepEqual(parsed.foods, [{ name: '未知', group: '', certain: false }]);
  assert.throws(() => parseLiveReply('not json'));
  assert.throws(() => parseLiveReply('{"reply":"hello","platePresent":"true"}'));
  const original = { growth: 34, growthStage: 0, energy: 80, intimacy: 20, liveProgress: {} };
  const unchanged = feedbackPatch(original, parsed, { now: 2_000_000 });
  assert.equal(unchanged.growth, 34);
  const gained = feedbackPatch(original, result(), { now: 2_000_000 });
  assert.equal(gained.growth, 37);
  assert.equal(gained.growthStage, 1);
});

test('automatic speech is deduplicated and throttled while direct questions can repeat', () => {
  const previous = { text: '慢慢吃。', at: 100_000 };
  assert.equal(shouldAnnounce(result({ reply: '慢慢吃！' }), previous, { now: 200_000 }), false);
  assert.equal(shouldAnnounce(result({ reply: '出现了青菜' }), previous, { now: 110_000 }), false);
  assert.equal(shouldAnnounce(result({ reply: '出现了青菜' }), previous, { now: 120_000 }), true);
  assert.equal(shouldAnnounce(result({ reply: '慢慢吃。' }), previous, { now: 110_000, force: true }), true);
});
