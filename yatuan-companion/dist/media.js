// Browser-only media helpers. Hardware is requested only by an explicit call.
const cameraSessions = new WeakMap();
const activeVideos = new Set();
let listeningSession = null;
let speakingSession = null;

function stopTracks(stream) {
  stream?.getTracks?.().forEach((track) => track.stop());
}

function cameraError(error) {
  if (error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError') {
    return new Error('摄像头权限尚未开启。请在浏览器的地址栏中允许使用摄像头，再试一次。');
  }
  if (error?.name === 'NotFoundError' || error?.name === 'DevicesNotFoundError') {
    return new Error('暂时没有找到摄像头，可以先上传一张餐食照片。');
  }
  if (error?.name === 'NotReadableError' || error?.name === 'TrackStartError') {
    return new Error('摄像头暂时无法使用，可能正在被其他应用占用。关闭其他相机应用后再试试。');
  }
  if (error?.name === 'OverconstrainedError') {
    return new Error('这台摄像头暂不支持当前拍摄方式，可以先上传照片。');
  }
  return new Error('摄像头未能启动，请检查浏览器权限，或改为上传照片。');
}

export async function listCameras() {
  const devices = globalThis.navigator?.mediaDevices;
  if (!devices?.enumerateDevices) return [];
  let allDevices = await devices.enumerateDevices();
  let cameras = allDevices.filter((d) => d.kind === 'videoinput');
  if (cameras.length > 0 && cameras.every((d) => !d.label)) {
    try {
      const stream = await devices.getUserMedia({ video: true, audio: false });
      stream.getTracks().forEach((t) => t.stop());
      allDevices = await devices.enumerateDevices();
      cameras = allDevices.filter((d) => d.kind === 'videoinput');
    } catch (e) {}
  }
  return cameras.map((device, index) => ({
    deviceId: device.deviceId,
    groupId: device.groupId,
    label: device.label || `摄像头 ${index + 1}`,
  }));
}

export async function startCamera(videoEl, { deviceId } = {}) {
  if (!videoEl || videoEl.tagName !== 'VIDEO') {
    throw new Error('摄像头预览尚未准备好，请重新打开拍照窗口。');
  }
  if (!globalThis.navigator?.mediaDevices?.getUserMedia) {
    throw new Error('当前浏览器无法调用摄像头。请使用 HTTPS 或 localhost 打开页面，也可以上传照片。');
  }

  stopCamera(videoEl);
  const session = { stream: null, cancelled: false };
  cameraSessions.set(videoEl, session);
  activeVideos.add(videoEl);
  const isCurrent = () => !session.cancelled && cameraSessions.get(videoEl) === session;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } }),
        width: { ideal: 1280 }, height: { ideal: 720 },
      },
    });
    session.stream = stream;
    if (!isCurrent()) {
      stopTracks(stream);
      const error = new Error('本次拍摄已取消。');
      error.name = 'AbortError';
      throw error;
    }
    videoEl.muted = true;
    videoEl.playsInline = true;
    videoEl.srcObject = stream;
    await videoEl.play();
    if (!isCurrent()) {
      stopTracks(stream);
      const error = new Error('本次拍摄已取消。');
      error.name = 'AbortError';
      throw error;
    }
    return stream;
  } catch (error) {
    stopTracks(session.stream);
    if (cameraSessions.get(videoEl) === session) {
      if (videoEl.srcObject === session.stream) videoEl.srcObject = null;
      cameraSessions.delete(videoEl);
      activeVideos.delete(videoEl);
    }
    if (session.cancelled || error?.name === 'AbortError') {
      const cancelled = new Error('本次拍摄已取消。');
      cancelled.name = 'AbortError';
      throw cancelled;
    }
    throw cameraError(error);
  }
}

export function stopCamera(videoEl) {
  if (!videoEl) return;
  const session = cameraSessions.get(videoEl);
  if (session) {
    session.cancelled = true;
    stopTracks(session.stream);
    cameraSessions.delete(videoEl);
  }
  // Invalidate pending permission requests as well as an already-running camera.
  stopTracks(videoEl.srcObject);
  videoEl.pause?.();
  videoEl.srcObject = null;
  activeVideos.delete(videoEl);
}

export function captureFrame(videoEl, { maxSize = 960, quality = 0.82 } = {}) {
  if (!videoEl || videoEl.readyState < 2 || !videoEl.videoWidth || !videoEl.videoHeight) {
    throw new Error('摄像头画面还在准备中，请稍等片刻再拍照。');
  }
  if (!videoEl.srcObject?.getVideoTracks?.().some((track) => track.readyState === 'live')) {
    throw new Error('摄像头已关闭，请重新打开后再拍照。');
  }
  const limit = Number.isFinite(Number(maxSize)) ? Math.max(64, Math.min(1920, Math.round(Number(maxSize)))) : 960;
  const jpegQuality = Number.isFinite(Number(quality)) ? Math.max(0.4, Math.min(0.95, Number(quality))) : 0.82;
  const scale = Math.min(1, limit / Math.max(videoEl.videoWidth, videoEl.videoHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(videoEl.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(videoEl.videoHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前浏览器无法保存相机画面，请改为上传照片。');
  try {
    context.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', jpegQuality);
  } catch {
    throw new Error('这次没有拍到清晰的画面，请重新拍摄。');
  }
}

function detectImageType(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((n, i) => bytes[i] === n)) return 'image/png';
  const header = String.fromCharCode(...bytes);
  if (header.startsWith('GIF87a') || header.startsWith('GIF89a')) return 'image/gif';
  if (header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export async function readImageFile(file, { maxSize = 960, quality = 0.82 } = {}) {
  if (!file || typeof file.slice !== 'function' || !file.size) {
    throw new Error('请选择一张有效的图片。');
  }
  if (file.size > 12 * 1024 * 1024) {
    throw new Error('这张图片超过 12 MB，请选择一张小一点的图片。');
  }
  const acceptedTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
  if (file.type && !acceptedTypes.includes(file.type.toLowerCase())) {
    throw new Error('请选择 PNG、JPG、WebP 或 GIF 图片，暂不支持 SVG 和 HEIC。');
  }
  const signature = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (!detectImageType(signature)) {
    throw new Error('图片格式无法识别，请选择真实的 PNG、JPG、WebP 或 GIF 图片。');
  }
  const limit = Number.isFinite(Number(maxSize)) ? Math.max(64, Math.min(1920, Math.round(Number(maxSize)))) : 960;
  let jpegQuality = Number.isFinite(Number(quality)) ? Math.max(0.4, Math.min(0.95, Number(quality))) : 0.82;
  let image;
  const objectUrl = URL.createObjectURL(file);
  try {
    image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('图片无法打开，可能已经损坏。请换一张试试。'));
      img.src = objectUrl;
    });
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 60_000_000) {
      throw new Error('图片尺寸过大或不完整，请先缩小图片后再上传。');
    }
    const scale = Math.min(1, limit / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('当前浏览器无法处理这张图片，请更换浏览器后再试。');
    const draw = () => {
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', jpegQuality);
    };
    let dataUrl = draw();
    // Limit the encoded string as well as image dimensions to protect local storage.
    for (let attempt = 0; dataUrl.length > 700 * 1024 && attempt < 12; attempt += 1) {
      if (jpegQuality > 0.48) jpegQuality = Math.max(0.45, jpegQuality - 0.1);
      else {
        canvas.width = Math.max(1, Math.round(canvas.width * 0.8));
        canvas.height = Math.max(1, Math.round(canvas.height * 0.8));
      }
      dataUrl = draw();
    }
    if (dataUrl.length > 700 * 1024) throw new Error('这张图片暂时无法压缩，请选择另一张图片。');
    return dataUrl;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function speechConstructor() {
  return globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
}

export function supportsSpeechRecognition() {
  return Boolean(speechConstructor());
}

export function cancelListening() {
  listeningSession?.cancel();
}

function call(callback, value) {
  if (typeof callback !== 'function') return;
  try { callback(value); } catch (error) { console.warn('媒体回调未完成：', error); }
}

function recognitionError(code) {
  return ({
    'not-allowed': '麦克风权限尚未开启。请允许使用麦克风，或直接输入文字。',
    'service-not-allowed': '当前浏览器不允许使用语音识别，请改用文字输入。',
    'audio-capture': '没有找到可用的麦克风，请检查设备连接。',
    'no-speech': '暂时没有听清，再说一次吧，也可以输入文字。',
    network: '语音识别服务暂时无法连接，请检查网络后重试，或使用文字输入。',
    'language-not-supported': '当前浏览器暂不支持中文语音识别，请使用文字输入。',
  })[code] || '语音识别暂时不可用，请重试或使用文字输入。';
}

export function startListening({ onResult, onInterim, onEnd, onError } = {}) {
  listeningSession?.cancel();
  stopSpeaking();
  const Recognition = speechConstructor();
  if (!Recognition) {
    call(onError, '当前浏览器不支持语音识别，可以使用 Chrome，或直接输入文字。');
    call(onEnd);
    return () => {};
  }
  let recognition;
  try { recognition = new Recognition(); } catch {
    call(onError, '语音识别无法启动，请直接输入文字。');
    call(onEnd);
    return () => {};
  }
  const session = { ended: false, failed: false, delivered: false, cancelled: false, timer: null, stopTimer: null, cancel: null };
  const finish = () => {
    if (session.ended) return;
    session.ended = true;
    clearTimeout(session.timer);
    clearTimeout(session.stopTimer);
    if (listeningSession === session) listeningSession = null;
    call(onEnd);
  };
  session.cancel = () => {
    if (session.ended) return;
    session.cancelled = true;
    try { recognition.abort(); } catch { /* Already inactive. */ }
    finish();
  };
  const stop = () => {
    if (session.ended || session.stopTimer) return;
    clearTimeout(session.timer);
    try { recognition.stop(); } catch { finish(); return; }
    session.stopTimer = setTimeout(() => session.cancel(), 1800);
  };
  listeningSession = session;
  recognition.lang = 'zh-CN';
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  recognition.onresult = (event) => {
    if (session.ended || session.failed || session.cancelled || session.delivered) return;
    let finalText = '';
    let interimText = '';
    for (let i = 0; i < event.results.length; i += 1) {
      const result = event.results[i];
      if (result.isFinal) finalText += result[0]?.transcript || '';
      else interimText += result[0]?.transcript || '';
    }
    if (finalText.trim()) {
      session.delivered = true;
      call(onInterim, '');
      call(onResult, finalText.trim());
      stop();
    } else call(onInterim, interimText.trim());
  };
  recognition.onerror = (event) => {
    if (session.ended || session.cancelled) return;
    session.failed = true;
    call(onInterim, '');
    if (event.error !== 'aborted') call(onError, recognitionError(event.error));
    try { recognition.abort(); } catch { /* Some browsers already aborted. */ }
    finish();
  };
  recognition.onend = finish;
  try {
    recognition.start();
    session.timer = setTimeout(stop, 30_000);
  } catch {
    session.failed = true;
    call(onError, '麦克风未能启动，请检查权限，或直接输入文字。');
    finish();
  }
  return stop;
}

function beginSpeech(text, { signal, onStart } = {}) {
  const synth = globalThis.speechSynthesis;
  const Utterance = globalThis.SpeechSynthesisUtterance;
  if (signal?.aborted) return { started: false, promise: Promise.resolve({ status: 'cancelled' }) };
  if (!synth || !Utterance || typeof text !== 'string' || !text.trim()) {
    return { started: false, promise: Promise.resolve({ status: 'unavailable' }) };
  }
  stopSpeaking();
  let resolveSpeech;
  const promise = new Promise((resolve) => { resolveSpeech = resolve; });
  const session = { utterance: null, timer: null, ended: false, finish: null };
  const abort = () => {
    if (speakingSession === session) stopSpeaking();
    else session.finish('cancelled');
  };
  session.finish = (status) => {
    if (session.ended) return;
    session.ended = true;
    clearTimeout(session.timer);
    signal?.removeEventListener('abort', abort);
    if (session.utterance) {
      session.utterance.onstart = null;
      session.utterance.onend = null;
      session.utterance.onerror = null;
    }
    if (speakingSession === session) speakingSession = null;
    resolveSpeech({ status });
  };
  speakingSession = session;
  try {
    const utterance = new Utterance(text.trim().slice(0, 1600));
    session.utterance = utterance;
    utterance.lang = 'zh-CN';
    utterance.rate = 0.96;
    utterance.pitch = 1.04;
    const voices = synth.getVoices?.() || [];
    const voice = voices.find((item) => /^zh[-_]CN$/i.test(item.lang)) || voices.find((item) => /^zh/i.test(item.lang));
    if (voice) utterance.voice = voice;
    utterance.onstart = () => { if (!session.ended) call(onStart); };
    utterance.onend = () => session.finish('ended');
    utterance.onerror = () => session.finish('error');
    signal?.addEventListener('abort', abort, { once: true });
    // Some platforms never emit end/error when speech is interrupted. Always settle the caller.
    session.timer = setTimeout(() => {
      if (session.ended) return;
      const current = speakingSession === session;
      session.finish('timeout');
      if (current) { try { synth.cancel(); } catch { /* Already stopped. */ } }
    }, Math.min(120_000, Math.max(10_000, utterance.text.length * 300 + 5000)));
    synth.speak(utterance);
    return { started: true, promise };
  } catch {
    session.finish('error');
    return { started: false, promise };
  }
}

let ttsAudio = null;
let ttsAbort = null;

async function beginTTS(text, { signal, onStart, onFallback } = {}) {
  if (typeof text !== 'string' || !text.trim()) return { status: 'unavailable' };
  if (signal?.aborted) return { status: 'cancelled' };
  stopSpeaking();
  const abort = new AbortController();
  ttsAbort = abort;
  const onSignalAbort = () => abort.abort();
  signal?.addEventListener('abort', onSignalAbort, { once: true });
  try {
    const response = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.trim().slice(0, 1600) }),
      signal: abort.signal,
    });
    if (!response.ok) {
      if (ttsAbort === abort) ttsAbort = null;
      signal?.removeEventListener('abort', onSignalAbort);
      call(onFallback);
      return beginSpeech(text, { signal, onStart }).promise;
    }
    const blob = await response.blob();
    if (abort.signal.aborted) {
      if (ttsAbort === abort) ttsAbort = null;
      signal?.removeEventListener('abort', onSignalAbort);
      return { status: 'cancelled' };
    }
    const objectUrl = URL.createObjectURL(blob);
    const audio = new Audio(objectUrl);
    ttsAudio = audio;
    return new Promise((resolve) => {
      const done = (status) => {
        URL.revokeObjectURL(objectUrl);
        if (ttsAudio === audio) ttsAudio = null;
        if (ttsAbort === abort) ttsAbort = null;
        signal?.removeEventListener('abort', onSignalAbort);
        resolve({ status });
      };
      audio.onended = () => done('ended');
      audio.onerror = () => done('error');
      abort.signal.addEventListener('abort', () => { audio.pause(); done('cancelled'); }, { once: true });
      audio.play().then(() => { if (!abort.signal.aborted) call(onStart); }).catch(() => done('error'));
    });
  } catch (error) {
    if (ttsAbort === abort) ttsAbort = null;
    signal?.removeEventListener('abort', onSignalAbort);
    if (error.name === 'AbortError' || abort.signal.aborted) return { status: 'cancelled' };
    call(onFallback);
    return beginSpeech(text, { signal, onStart }).promise;
  }
}

export function speak(text) {
  beginTTS(text).catch(() => {});
  return true;
}

export function speakAsync(text, options = {}) {
  return beginTTS(text, options);
}

export function stopSpeaking() {
  ttsAbort?.abort();
  ttsAbort = null;
  if (ttsAudio) {
    ttsAudio.pause();
    ttsAudio = null;
  }
  speakingSession?.finish('cancelled');
  try { globalThis.speechSynthesis?.cancel(); } catch { /* Speech service already closed. */ }
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    [...activeVideos].forEach(stopCamera);
    listeningSession?.cancel();
    stopSpeaking();
  });
}
