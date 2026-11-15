import { startCamera, stopCamera } from './media.js';

const CHANNEL = 'yatuan:desktop-camera:v1';
const sources = new Map();
const pending = new Map();
let channel;

export function captureDesktopVideo(video) {
  if (!video || video.readyState < 2 || !video.videoWidth || !video.srcObject?.getVideoTracks().some(track => track.readyState !== 'ended')) throw new Error('摄像头画面尚未准备好');
  const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.65);
}
function closeUnusedChannel() {
  if (!sources.size && !pending.size) { channel?.close(); channel = undefined; }
}
function openChannel() {
  if (channel || !globalThis.BroadcastChannel) return;
  channel = new BroadcastChannel(CHANNEL);
  channel.addEventListener('message', event => {
    const message = event.data;
    if (message?.type === 'capture' && typeof message.id === 'string') {
      const frame = localFrame(message.cameraId);
      if (frame) channel?.postMessage({ type: 'frame', id: message.id, ...frame });
    } else if (message?.type === 'frame' && typeof message.image === 'string' && message.image.length <= 700000 && message.image.startsWith('data:image/jpeg;base64,')) {
      pending.get(message.id)?.({ image: message.image, label: String(message.label || 'AR 摄像头').slice(0, 120), shared: true });
    }
  });
}
function localFrame(cameraId) {
  for (const { video, label } of sources.values()) {
    const track = video.srcObject?.getVideoTracks()[0];
    if (!track || track.readyState === 'ended' || (cameraId && track.getSettings().deviceId !== cameraId)) continue;
    try { return { image: captureDesktopVideo(video), label, shared: true }; } catch {}
  }
  return null;
}

/** AR remains the camera owner. A frame is shared only after an explicit request. */
export function publishDesktopCamera(video, label = 'AR 摄像头') {
  const id = crypto.randomUUID(); sources.set(id, { video, label }); openChannel();
  return () => { sources.delete(id); closeUnusedChannel(); };
}
export function requestSharedDesktopFrame(cameraId = '', signal) {
  if (signal?.aborted) return Promise.resolve(null);
  const local = localFrame(cameraId); if (local) return Promise.resolve(local);
  openChannel(); if (!channel) return Promise.resolve(null);
  return new Promise(resolve => {
    const id = crypto.randomUUID();
    const finish = frame => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); pending.delete(id); closeUnusedChannel(); resolve(frame); };
    const cancel = () => finish(null);
    const timer = setTimeout(() => finish(null), 650);
    pending.set(id, finish); signal?.addEventListener('abort', cancel, { once: true });
    channel.postMessage({ type: 'capture', id, cameraId });
  });
}

export function createDesktopCamera(overrides = {}) {
  const io = { sharedFrame: requestSharedDesktopFrame, startCamera, stopCamera, captureVideo: captureDesktopVideo, locks: globalThis.navigator?.locks, ...overrides };
  let video, cameraId = '', shared = false, releaseLock, generation = 0, abort;
  function stop() {
    generation++; abort?.abort(); abort = undefined;
    if (video && !shared) io.stopCamera(video);
    video = undefined; shared = false; releaseLock?.(); releaseLock = undefined;
  }
  return {
    async start(element, selectedId = '') {
      stop(); const token = generation; video = element; cameraId = selectedId;
      abort = new AbortController();
      const frame = await io.sharedFrame(cameraId, abort.signal);
      if (token !== generation) throw new Error('摄像头连接已取消');
      if (frame) { shared = true; return frame; }
      if (io.locks?.request) {
        const acquired = await new Promise((resolve, reject) => {
          io.locks.request('yatuan-live-devices', { ifAvailable: true }, async lock => {
            if (!lock || token !== generation) { resolve(false); return; }
            await new Promise(done => { releaseLock = done; resolve(true); });
          }).catch(reject);
        });
        if (!acquired) throw new Error('摄像头正在其他窗口使用。若使用 AR 预览，请刷新投影页后再试。');
      }
      try {
        if (token !== generation) throw new Error('摄像头连接已取消');
        await io.startCamera(element, { deviceId: cameraId });
        if (token !== generation) { io.stopCamera(element); throw new Error('摄像头连接已取消'); }
        return { image: io.captureVideo(element), label: '本机摄像头', shared: false };
      } catch (error) { if (token === generation) stop(); throw error; }
    },
    async capture() {
      if (!video) throw new Error('请先开启桌面观察');
      if (!shared) return { image: io.captureVideo(video), label: '本机摄像头', shared: false };
      const frame = await io.sharedFrame(cameraId, abort?.signal);
      if (!frame) throw new Error('AR 摄像头画面不可用，请检查投影窗口的摄像头');
      return frame;
    },
    stop,
  };
}
