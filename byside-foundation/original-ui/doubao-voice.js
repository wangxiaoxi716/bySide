// Microphone audio is sent only to the local bridge after the user starts listening.
// The bridge authenticates with Doubao; provider keys are never exposed here.
export function createDoubaoVoiceSession({ onText, onInterim, onState, onError, onEnd } = {}) {
  let started = false, paused = false, generation = 0, resources = null;
  const supported = Boolean(navigator.mediaDevices?.getUserMedia && (globalThis.AudioContext || globalThis.webkitAudioContext) && globalThis.WebSocket);
  const state = value => onState?.(value);
  const closeResources = () => {
    const current = resources; resources = null;
    if (!current) return;
    current.processor && (current.processor.onaudioprocess = null);
    try { current.source?.disconnect(); current.processor?.disconnect(); } catch {}
    current.stream?.getTracks().forEach(track => track.stop());
    current.context?.close().catch(() => {});
    if (current.socket && current.socket.readyState < WebSocket.CLOSING) current.socket.close();
  };
  const fail = (message, code = 'speech-error') => {
    if (!started) return;
    started = false; paused = false; generation++;
    closeResources(); state('error'); onInterim?.(''); onError?.(message, { code, fatal: true }); onEnd?.();
  };
  async function launch() {
    if (!started || paused) return;
    const token = ++generation;
    state('starting');
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
      if (!started || paused || token !== generation) { stream.getTracks().forEach(track => track.stop()); return; }
      const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
      const context = new Context();
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/v1/speech/asr/stream`);
      socket.binaryType = 'arraybuffer';
      const current = { stream, context, source, processor, socket, ready: false, finishing: false, finishTimer: null };
      resources = current;
      let phase = 0, sum = 0, count = 0, samples = [];
      const flush = () => {
        if (!samples.length || socket.readyState !== WebSocket.OPEN) return;
        const bytes = new ArrayBuffer(samples.length * 2), view = new DataView(bytes);
        samples.forEach((sample, index) => view.setInt16(index * 2, sample, true));
        socket.send(bytes); samples = [];
      };
      current.flush = flush;
      processor.onaudioprocess = event => {
        if (resources !== current || !current.ready || current.finishing || socket.readyState !== WebSocket.OPEN) return;
        const input = event.inputBuffer.getChannelData(0);
        for (let i = 0; i < input.length; i++) {
          sum += input[i]; count++; phase += 16000;
          if (phase >= context.sampleRate) {
            phase -= context.sampleRate;
            const value = Math.max(-1, Math.min(1, sum / count));
            samples.push(value < 0 ? Math.round(value * 32768) : Math.round(value * 32767));
            sum = 0; count = 0;
            if (samples.length === 3200) {
              if (socket.bufferedAmount > 256000) { fail('语音发送速度不足，请检查网络'); return; }
              flush();
            }
          }
        }
      };
      source.connect(processor); processor.connect(context.destination);
      socket.onmessage = event => {
        if (resources !== current || token !== generation) return;
        let message; try { message = JSON.parse(event.data); } catch { fail('语音服务返回了无效数据'); return; }
        if (message.type === 'ready') { current.ready = true; state('listening'); }
        else if (message.type === 'partial') onInterim?.(message.text || '');
        else if (message.type === 'final' && message.text) { onInterim?.(''); onText?.(message.text); }
        else if (message.type === 'error') fail(message.message || '语音识别失败', message.code);
        else if (message.type === 'ended') { started = false; generation++; clearTimeout(current.finishTimer); closeResources(); state('idle'); onEnd?.(); }
      };
      socket.onerror = () => { if (resources === current) fail('语音识别连接失败，请检查本机服务和网络'); };
      socket.onclose = () => { if (resources === current && started) fail('语音识别连接已断开'); };
      stream.getAudioTracks().forEach(track => track.addEventListener('ended', () => { if (resources === current) fail('麦克风已断开'); }, { once: true }));
      await context.resume();
    } catch (error) {
      if (stream && !resources) stream.getTracks().forEach(track => track.stop());
      if (token !== generation || !started) return;
      fail(error?.name === 'NotAllowedError' ? '麦克风权限被拒绝，请在浏览器中允许使用麦克风。' : '无法启动麦克风，请检查设备权限。', error?.name);
    }
  }
  return {
    isSupported: supported,
    start() { if (!supported) { onError?.('当前浏览器不支持麦克风语音输入'); return false; } if (started && !paused) return true; started = true; paused = false; void launch(); return true; },
    pause() { if (!started) return; paused = true; generation++; closeResources(); onInterim?.(''); state('paused'); },
    resume() { if (!started || !paused) return false; paused = false; void launch(); return true; },
    finish() { const current = resources; if (!started || !current?.ready || current.socket.readyState !== WebSocket.OPEN) { this.stop(); onEnd?.(); return; } current.finishing = true; current.flush(); current.stream.getTracks().forEach(track => track.stop()); current.socket.send(JSON.stringify({ type: 'finish' })); current.finishTimer = setTimeout(() => { if (resources === current) { this.stop(); onEnd?.(); } }, 6000); },
    stop() { started = false; paused = false; generation++; if (resources?.finishTimer) clearTimeout(resources.finishTimer); closeResources(); onInterim?.(''); state('idle'); },
  };
}
