// A user-started continuous recognition session. Pausing drains the current recognizer
// before resuming, so the companion never listens while its own reply is being spoken.
let activeSession = null;
let recognitionOwner = null;
let waitingSession = null;
let recognitionBlocked = false;

function invoke(callback, ...args) {
  try { callback?.(...args); } catch (error) { console.warn('语音回调未完成：', error); }
}

const messages = {
  'not-allowed': '麦克风权限被拒绝。请在浏览器地址栏允许麦克风，再点击开启语音。',
  'service-not-allowed': '当前浏览器不允许使用语音识别，请使用 Chrome 或改为文字交流。',
  'audio-capture': '没有找到可用的麦克风，请检查电脑或 USB 麦克风连接。',
  'language-not-supported': '当前浏览器的语音服务不支持中文，请更换浏览器或使用文字交流。',
  network: '语音识别连续连接失败。请检查网络后重新开启语音，也可以直接输入文字。',
};
const fatalErrors = new Set(['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported']);

export function createVoiceSession({ onText, onInterim, onState, onError } = {}) {
  const Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
  let started = false;
  let paused = false;
  let holder = null;
  let restartTimer = null;
  let state = 'idle';
  let failures = 0;
  let networkFailures = 0;
  let silentEnds = 0;

  const notifyState = (next) => {
    if (state === next) return;
    state = next;
    invoke(onState, next);
  };
  const clearRestart = () => {
    clearTimeout(restartTimer);
    restartTimer = null;
  };
  const desired = () => started && !paused && !recognitionBlocked;
  const valid = (entry) => holder === entry && !entry.draining && desired();

  function fail(code, message) {
    started = false;
    paused = false;
    clearRestart();
    if (waitingSession?.api === api) waitingSession = null;
    drain();
    if (activeSession === api) activeSession = null;
    notifyState('error');
    invoke(onInterim, '');
    invoke(onError, message || messages[code] || '语音识别暂时不可用，请重新开启语音或改为文字交流。', { code, fatal: true });
  }

  function drain() {
    if (!holder || holder.draining) return;
    const entry = holder;
    entry.draining = true;
    clearTimeout(entry.startTimer);
    // Results and error events from a paused/aborted recognizer cannot reach the application.
    entry.recognition.onresult = null;
    entry.recognition.onstart = null;
    entry.recognition.onerror = null;
    entry.drainTimer = setTimeout(() => {
      if (holder !== entry) return;
      // Do not overlap recognizers if a broken browser never confirms that abort completed.
      recognitionBlocked = true;
      entry.recognition.onend = null;
      holder = null;
      const waiting = waitingSession;
      waitingSession = null;
      waiting?.fail();
      if (started) fail('abort-timeout', '浏览器未能关闭上一段语音，请刷新页面后再开启语音。');
    }, 2000);
    try { entry.recognition.abort(); } catch {
      // An inactive instance may throw instead of emitting end; it can be released safely.
      release(entry);
    }
  }

  function release(entry) {
    clearTimeout(entry.startTimer);
    clearTimeout(entry.drainTimer);
    entry.recognition.onstart = null;
    entry.recognition.onresult = null;
    entry.recognition.onerror = null;
    entry.recognition.onend = null;
    if (holder !== entry) return;
    holder = null;
    if (recognitionOwner === api) recognitionOwner = null;
    const waiting = waitingSession;
    waitingSession = null;
    waiting?.launch();
    if (!desired()) return;
    const delay = entry.retryDelay ?? (entry.draining ? 150 : Math.min(8000, 350 * 2 ** Math.min(5, silentEnds)));
    schedule(delay);
  }

  function schedule(delay = 150) {
    clearRestart();
    if (!desired() || holder) return;
    notifyState('retrying');
    restartTimer = setTimeout(() => {
      restartTimer = null;
      launch();
    }, delay);
  }

  function launch() {
    if (!desired() || holder) return;
    if (recognitionOwner && recognitionOwner !== api) {
      waitingSession = { api, launch, fail: () => fail('abort-timeout', '浏览器未能关闭上一段语音，请刷新页面后再开启语音。') };
      notifyState('retrying');
      return;
    }
    let recognition;
    try { recognition = new Recognition(); } catch { fail('construct'); return; }
    const entry = { recognition, draining: false, startTimer: null, drainTimer: null, finals: new Set() };
    holder = entry;
    recognitionOwner = api;
    recognition.lang = 'zh-CN';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => {
      if (!valid(entry)) return;
      clearTimeout(entry.startTimer);
      notifyState('listening');
    };
    recognition.onresult = (event) => {
      if (!valid(entry)) return;
      const final = [];
      const interim = [];
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index];
        const text = result[0]?.transcript?.trim() || '';
        if (result.isFinal && index >= (event.resultIndex || 0) && !entry.finals.has(index)) {
          entry.finals.add(index);
          if (text) final.push(text);
        } else if (!result.isFinal && text) interim.push(text);
      }
      invoke(onInterim, interim.join(''));
      if (final.length && valid(entry)) {
        failures = 0;
        networkFailures = 0;
        silentEnds = 0;
        invoke(onText, final.join(''));
      }
    };
    recognition.onerror = (event) => {
      if (!valid(entry)) return;
      const code = event.error || 'unknown';
      if (fatalErrors.has(code)) { fail(code); return; }
      if (code === 'network') networkFailures += 1;
      if (code !== 'no-speech' && code !== 'aborted') failures += 1;
      silentEnds += 1;
      if (networkFailures >= 3 || failures >= 4) { fail(code); return; }
      invoke(onInterim, '');
      notifyState('retrying');
      entry.retryDelay = Math.min(8000, 500 * 2 ** Math.min(4, silentEnds));
      // An error normally ends recognition. Abort explicitly and await end before retrying.
      drain();
    };
    recognition.onend = () => {
      if (holder !== entry) return;
      if (!entry.draining) silentEnds += 1;
      release(entry);
    };
    notifyState('starting');
    entry.startTimer = setTimeout(() => {
      if (valid(entry)) fail('start-timeout', '语音识别启动超时。请检查麦克风权限和网络后重试。');
    }, 30_000);
    try { recognition.start(); } catch (error) {
      clearTimeout(entry.startTimer);
      holder = null;
      if (recognitionOwner === api) recognitionOwner = null;
      recognition.onend = null;
      fail(error?.name === 'NotAllowedError' ? 'not-allowed' : 'start');
    }
  }

  const api = {
    isSupported: Boolean(Recognition),
    start() {
      if (!Recognition) { fail('unsupported', '当前浏览器不支持语音识别。请使用 Chrome，或直接输入文字。'); return false; }
      if (recognitionBlocked) { fail('abort-timeout', '浏览器未能关闭上一段语音，请刷新页面后再开启语音。'); return false; }
      if (started && !paused) return true;
      if (activeSession && activeSession !== api) activeSession.stop();
      activeSession = api;
      started = true;
      paused = false;
      failures = networkFailures = silentEnds = 0;
      clearRestart();
      if (!holder) launch();
      else notifyState('starting');
      return started;
    },
    pause() {
      if (!started) return;
      paused = true;
      clearRestart();
      drain();
      invoke(onInterim, '');
      notifyState('paused');
    },
    resume() {
      // Calling resume on a never-started/stopped session must not prompt for permission.
      if (!started || !paused || recognitionBlocked) return false;
      paused = false;
      if (!holder) launch();
      else notifyState('starting');
      return true;
    },
    stop() {
      started = false;
      paused = false;
      clearRestart();
      if (waitingSession?.api === api) waitingSession = null;
      drain();
      if (activeSession === api) activeSession = null;
      invoke(onInterim, '');
      notifyState('idle');
    },
  };
  return api;
}

if (typeof window !== 'undefined') window.addEventListener('pagehide', () => activeSession?.stop());
