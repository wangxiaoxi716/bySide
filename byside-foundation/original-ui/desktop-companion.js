import { createRealtimeVoiceSession } from './realtime-voice.js';
import { createDesktopCamera } from './desktop-camera.js';
import { getLiveConfig } from './live.js';
import { voiceCommand } from './live-core.js';
import { stopDemo } from './demo.js';

export function createDesktopCompanion(overrides = {}) {
  const io = { createVoice: createRealtimeVoiceSession, createCamera: createDesktopCamera, config: getLiveConfig, stopDemo, ...overrides };
  const listeners = new Set();
  const initial = () => ({ active: false, localOwner: false, mode: 'idle', voiceState: 'idle', voiceWarning: '', error: '', message: '开始后，可以一边说话，一边让芽团看看桌面。', frameCount: 0, requestCount: 0, lastFrameAt: 0, observation: '', foods: [], previewImage: '', sourceLabel: '', shared: false, observing: false });
  let status = initial(), voice, camera, video, timer, ready = false, generation = 0, captureTask, stopping = Promise.resolve();
  const snapshot = () => ({ ...status, foods: status.foods.map(food => ({ ...food })) });
  function emit(patch) {
    status = { ...status, ...patch };
    for (const listener of listeners) listener(snapshot());
  }
  function listeningMessage() {
    return status.observing ? '正在听你说话，也在观察桌面。可以问“桌上有什么食物？”' : '仍在听你说话。点击“继续观察”可以恢复摄像头。';
  }
  function clearCamera() {
    clearTimeout(timer); timer = undefined;
    camera?.stop(); camera = undefined;
    emit({ observing: false, previewImage: '', shared: false, sourceLabel: '' });
  }
  function sessionClosed() {
    generation++; ready = false; voice = undefined; clearCamera();
    emit({ active: false, localOwner: false, voiceState: 'idle', mode: status.error ? 'error' : 'idle', message: status.error || '陪伴已结束。' });
  }
  function schedule() {
    clearTimeout(timer);
    if (status.active && status.observing && ready) timer = setTimeout(() => { void sendFrame().finally(schedule); }, io.config().intervalSeconds * 1000);
  }
  async function sendFrame(captureId, initialFrame) {
    if (!ready || !status.active || !status.observing) return;
    // Tool requests can wait for an in-flight capture without losing call IDs.
    if (captureTask) await captureTask;
    if (!ready || !status.active || !status.observing) return;
    const token = generation, currentCamera = camera;
    const task = (async () => {
      try {
        const frame = initialFrame || await currentCamera.capture();
        if (token !== generation || camera !== currentCamera || !status.observing) return;
        const sent = voice?.send({ type: 'vision.frame', frameId: crypto.randomUUID(), image: frame.image, ...(captureId ? { captureId } : {}) });
        if (sent) emit({ previewImage: frame.shared ? frame.image : '', shared: frame.shared, sourceLabel: frame.label, voiceWarning: '' });
      } catch (error) {
        if (token !== generation || camera !== currentCamera) return;
        voice?.send({ type: 'vision.pause' }); clearCamera();
        emit({ voiceWarning: error.message, message: '语音仍可使用。检查摄像头后点击“继续观察”。' });
      }
    })();
    captureTask = task;
    try { await task; } finally { if (captureTask === task) captureTask = undefined; }
  }
  async function openCamera() {
    const token = generation, currentCamera = io.createCamera(); camera = currentCamera;
    try {
      const frame = await currentCamera.start(video, io.config().cameraId);
      if (token !== generation || camera !== currentCamera) { currentCamera.stop(); return; }
      emit({ observing: true, shared: frame.shared, previewImage: frame.shared ? frame.image : '', sourceLabel: frame.label, voiceWarning: '' });
      return frame;
    } catch (error) {
      currentCamera.stop();
      if (token === generation && camera === currentCamera) {
        camera = undefined;
        emit({ observing: false, voiceWarning: error.message, message: '检查摄像头后点击“继续观察”。语音可继续连接。' });
      }
    }
  }
  async function start(element, { fullDuplex = false } = {}) {
    if (status.active) return true;
    const token = ++generation; video = element; io.stopDemo();
    emit({ ...initial(), active: true, localOwner: true, mode: 'starting', message: '正在连接桌面摄像头和豆包实时语音…' });
    await stopping;
    if (token !== generation) return false;
    const firstFrame = await openCamera();
    if (token !== generation) return false;
    voice = io.createVoice({
      desktopVision: true, fullDuplex,
      onReady() {
        if (token !== generation) return;
        ready = true;
        if (status.observing) void sendFrame(undefined, firstFrame).finally(schedule);
        else voice?.send({ type: 'vision.pause' });
        emit({ mode: status.observing ? 'observing' : 'paused', message: listeningMessage() });
      },
      onState(value) {
        if (token !== generation) return;
        const mode = value === 'listening' ? (status.observing ? 'observing' : 'paused') : value;
        emit({ voiceState: value, mode, ...(value === 'listening' ? { message: listeningMessage() } : {}) });
      },
      onTranscript(text, final) {
        if (token !== generation || !text) return;
        emit({ message: `${final ? '你' : '正在听'}：${text}` });
        if (final) void command(text, false);
      },
      onReply(text, final) { if (token === generation && final && text) emit({ message: text, error: '' }); },
      onVision(event) {
        if (token !== generation) return;
        if (event.type === 'vision.capture') void sendFrame(event.captureId);
        else if (event.type === 'vision.frame.accepted') emit({ frameCount: status.frameCount + 1, lastFrameAt: Date.now() });
        else if (event.type === 'vision.analyzing') emit({ requestCount: status.requestCount + 1 });
        else if (event.type === 'vision.observation') emit({ observation: event.description, foods: event.foods || [], voiceWarning: '' });
        else if (event.type === 'vision.error') emit({ voiceWarning: event.message });
      },
      onError(message) { if (token === generation) emit({ error: message }); },
      onClose() { if (token === generation) sessionClosed(); },
    });
    const connected = await voice.start();
    if (!connected && token === generation && status.active) sessionClosed();
    return connected;
  }
  function pauseObservation() {
    if (!status.active) return;
    voice?.send({ type: 'vision.pause' }); clearCamera();
    emit({ mode: 'paused', message: listeningMessage() });
  }
  async function wake(text = '') {
    if (!status.active || !ready) return;
    if (!status.observing) {
      const frame = await openCamera();
      if (!frame || !status.active || !ready) return;
      voice?.send({ type: 'vision.resume' });
      await sendFrame(undefined, frame); schedule();
      emit({ mode: 'observing', message: listeningMessage() });
    }
    if (text) handleText(text);
  }
  async function command(text, typed) {
    const action = voiceCommand(text, io.config().wakePhrase);
    if (action.type === 'stop') { await stop(); return; }
    if (action.type === 'pause') { pauseObservation(); return; }
    if (action.type === 'wake' && !status.observing) await wake();
    if (typed && !voice?.send({ type: 'input.text', text })) emit({ error: '语音会话尚未连接，请稍后重试。' });
  }
  function handleText(text) { return command(text, true); }
  async function stop() {
    const current = voice; generation++; ready = false; voice = undefined; clearCamera();
    emit({ active: false, localOwner: false, mode: 'idle', voiceState: 'idle', error: '', voiceWarning: '', message: '陪伴已结束，麦克风和桌面观察已关闭。' });
    if (current) stopping = Promise.resolve(current.stop());
    await stopping;
  }
  return { start, stop, destroy: stop, wake, pauseObservation, handleText, getStatus: snapshot,
    subscribe(listener) { listeners.add(listener); listener(snapshot()); return () => listeners.delete(listener); },
  };
}
