import { beginPresentation } from './state.js';
import { PcmFrameEncoder } from './pcm-frames.mjs';

// Browser-side audio only. The local foundation owns the Doubao connection and key.
export function createRealtimeVoiceSession({ fullDuplex = false, desktopVision = false, tools = [], onToolCall, onReady, onVision, onClose, onState, onTranscript, onReply, onError, onMicWarning } = {}) {
  let active = false, generation = 0, resources = null, releaseLock = null, finishResolve = null, stopped = Promise.resolve();
  let lastState = null;
  const notify = value => {
    if (lastState === value) return;
    lastState = value;
    if (value === 'stopping' || value === 'idle') resources?.presentation?.end();
    else resources?.presentation?.update({ motion: value === 'starting' ? 'thinking' : value });
    onState?.(value);
  };
  const supported = Boolean(globalThis.navigator?.mediaDevices?.getUserMedia && (globalThis.AudioContext || globalThis.webkitAudioContext) && globalThis.WebSocket);
  const release = () => { releaseLock?.(); releaseLock = null; };
  const closeMedia = current => {
    if (!current) return;
    current.presentation?.end();
    current.ready = false;
    clearInterval(current.micWatchdog);
    if (current.processor) {
      current.processor.onaudioprocess = null;
      current.processor.onprocessorerror = null;
      if (current.processor.port) {
        current.processor.port.onmessage = null;
        current.processor.port.close();
      }
    }
    try { current.source?.disconnect(); current.processor?.disconnect(); current.sink?.disconnect(); } catch {}
    current.stream?.getTracks().forEach(track => track.stop());
    current.stream = null;
    for (const source of current.playing) { source.onended = null; try { source.stop(); } catch {} }
    current.playing.clear();
    current.micContext?.close().catch(() => {}); current.micContext = null;
    current.playContext?.close().catch(() => {}); current.playContext = null;
  };
  const finish = current => {
    if (current && resources !== current) return;
    const hadResources = Boolean(resources);
    if (current?.closeTimer) clearTimeout(current.closeTimer);
    closeMedia(current); resources = null; active = false; release(); notify('idle');
    finishResolve?.(); finishResolve = null;
    if (hadResources) onClose?.();
  };
  const fail = (message, current = resources) => {
    if (!active && !current) return;
    active = false; generation++;
    onError?.(message);
    if (current?.socket && current.socket.readyState < WebSocket.CLOSING) current.socket.close();
    finish(current);
  };
  const flush = current => {
    for (const source of current.playing) { source.onended = null; try { source.stop(); } catch {} }
    current.playing.clear(); current.playNext = 0; current.speaking = false;
    current.replyText = '';
    current.presentation?.update({ speech: '正在听你说话…' });
    notify('listening');
  };
  async function acquire() {
    if (!navigator.locks?.request) return true;
    return new Promise((resolve, reject) => {
      navigator.locks.request('yatuan-microphone', { ifAvailable: true }, async lock => {
        if (!lock) { resolve(false); return; }
        await new Promise(done => { releaseLock = done; resolve(true); });
      }).catch(reject);
    });
  }
  async function start() {
    if (active) return true;
    if (!supported) { onError?.('当前浏览器不支持实时语音，请使用桌面 Chrome。'); notify('idle'); return false; }
    active = true; const token = ++generation;
    const current = { socket: null, stream: null, source: null, processor: null, sink: null, micContext: null, playContext: null, playing: new Set(), playNext: 0, speaking: false, ready: false, closeTimer: null, replyText: '', presentation: null, toolQueue: Promise.resolve(), toolCalls: new Set() };
    resources = current;
    notify('starting');
    try {
      const health = await fetch('/api/v1/health', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
      if (!health.ok || !(await health.json()).speech?.realtimeConfigured) throw new Error('请先在基座配置豆包实时语音 API Key 并重启服务。');
      if (!active || token !== generation) return false;
      if (!await acquire()) throw new Error('另一个窗口正在使用麦克风，请先结束该语音会话。');
      if (!active || token !== generation) { release(); return false; }
      current.presentation = beginPresentation({ motion: 'thinking', speech: '正在连接实时语音…' });
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
      if (!active || token !== generation) { stream.getTracks().forEach(track => track.stop()); return false; }
      current.stream = stream;
      const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
      current.micContext = new Context({ sampleRate: 16000 });
      current.playContext = new Context({ sampleRate: 24000 });
      if (current.micContext.sampleRate < 16000) throw new Error('麦克风采样率不支持实时语音。');
      await Promise.all([current.micContext.resume(), current.playContext.resume()]);
      if (!active || token !== generation) return false;
      const sendFrame = (frame, capturedAt) => {
        if (!active || resources !== current || token !== generation || !current.ready || current.socket?.readyState !== WebSocket.OPEN) return;
        if (Number.isFinite(capturedAt) && current.micContext.currentTime - capturedAt > .20) return;
        if (current.socket.bufferedAmount > 12800) return;
        const silence = !fullDuplex && (current.speaking || current.playContext.currentTime < current.playNext + 0.15);
        current.socket.send(silence ? new ArrayBuffer(640) : frame);
        current.lastAudioSend = Date.now();
        if (!silence) {
          const samples=new Int16Array(frame);
          for(let i=0;i<samples.length;i+=8)if(Math.abs(samples[i])>=180){current.lastMicSignal=current.lastAudioSend;break;}
        }
      };
      current.source = current.micContext.createMediaStreamSource(stream);
      current.sink = current.micContext.createGain(); current.sink.gain.value = 0;
      if (current.micContext.audioWorklet && globalThis.AudioWorkletNode) {
        await current.micContext.audioWorklet.addModule('./voice-capture-worklet.mjs');
        if (!active || token !== generation) return false;
        current.processor = new AudioWorkletNode(current.micContext, 'yatuan-pcm-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
        current.processor.port.onmessage = ({data}) => sendFrame(data?.frame ?? data, data?.capturedAt);
        current.processor.onprocessorerror = () => { if (active && resources === current) fail('麦克风音频处理已中断，请重新开始实时语音。', current); };
      } else {
        // Older webviews also send from capture callbacks instead of page timers.
        const encoder = new PcmFrameEncoder(current.micContext.sampleRate, sendFrame);
        current.processor = current.micContext.createScriptProcessor(2048, 1, 1);
        current.processor.onaudioprocess = event => encoder.push(event.inputBuffer.getChannelData(0));
      }
      current.source.connect(current.processor); current.processor.connect(current.sink); current.sink.connect(current.micContext.destination);
      current.socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/v1/speech/realtime`);
      current.socket.binaryType = 'arraybuffer';
      current.socket.onopen = () => { if (active && token === generation) current.socket.send(JSON.stringify({ type: 'session.start', fullDuplex, ...(desktopVision ? { desktopVision: true } : {}), ...(tools.length ? { tools } : {}) })); };
      current.socket.onmessage = event => {
        if (resources !== current || token !== generation) return;
        if (typeof event.data !== 'string') {
          if (!(event.data instanceof ArrayBuffer) || event.data.byteLength % 2 || !current.playContext) { fail('实时语音音频格式无效', current); return; }
          const view = new DataView(event.data), count = view.byteLength / 2;
          const audio = current.playContext.createBuffer(1, count, 24000), channel = audio.getChannelData(0);
          for (let i = 0; i < count; i++) channel[i] = view.getInt16(i * 2, true) / 32768;
          const source = current.playContext.createBufferSource(); source.buffer = audio; source.connect(current.playContext.destination);
          const at = Math.max(current.playContext.currentTime + 0.06, current.playNext); source.start(at); current.playNext = at + audio.duration;
          current.playing.add(source);
          notify('speaking');
          source.onended = () => {
            current.playing.delete(source);
            if (active && resources === current && token === generation && !current.speaking && current.playing.size === 0) notify('listening');
          };
          return;
        }
        let message; try { message = JSON.parse(event.data); } catch { fail('实时语音返回了无效数据', current); return; }
        if (!message || typeof message.type !== 'string') { fail('实时语音返回了无效数据', current); return; }
        if (message.type === 'session.ready') {
          if (current.ready) return;
          current.ready = true;
          current.lastAudioSend=current.lastMicSignal=Date.now();
          current.micWatchdog=setInterval(()=>{
            if(!current.ready||resources!==current||!active)return;
            const now=Date.now();
            const warning=now-current.lastAudioSend>2200?'麦克风音频未送达；请检查输入设备，或重新开始实时语音。'
              :lastState==='listening'&&now-current.lastMicSignal>6000?'未检测到明显的麦克风声音；若你正在说话，请检查系统输入设备和音量。':'';
            if(warning!==current.micWarning){current.micWarning=warning;onMicWarning?.(warning);}
          },1000);
          current.presentation.update({ speech: '正在听你说话…' });
          notify('listening');
          onReady?.(message);
        } else if (message.type === 'transcript.started') {
          current.replyText = '';
          current.presentation.update({ speech: '正在听你说话…' });
          if (current.playing.size === 0) notify('listening');
          onTranscript?.('', false);
        } else if (message.type === 'transcript.ended') {
          if(current.playing.size===0)notify('thinking');
          current.presentation.update({speech:'听到了，正在识别…'});
        } else if (message.type === 'transcript.partial' || message.type === 'transcript.final') {
          current.replyText = '';
          current.presentation.update({ speech: message.text ? `你：${message.text}` : '正在听你说话…' });
          if (current.playing.size === 0) notify(message.type === 'transcript.final' ? 'thinking' : 'listening');
          onTranscript?.(message.text || '', message.type === 'transcript.final');
        } else if (message.type === 'assistant.text.delta' || message.type === 'assistant.text.done') {
          const final = message.type === 'assistant.text.done';
          current.replyText = final ? message.text || current.replyText : current.replyText + (message.text || '');
          current.presentation.update({ speech: current.replyText });
          onReply?.(final ? current.replyText : message.text || '', final);
        } else if (message.type === 'audio.started') { current.speaking = true; }
        else if (message.type === 'audio.done' || message.type === 'response.done' || message.type === 'response.canceled') { current.speaking = false; if (current.playing.size === 0) notify('listening'); }
        else if (message.type === 'audio.flush') flush(current);
        else if (message.type === 'error') fail(message.message || '实时语音服务不可用。', current);
        else if (message.type === 'transcript.error') { if(current.playing.size===0)notify('listening'); onError?.(message.message || '没有听清，请再说一次。'); }
        else if (message.type === 'input.error') onError?.(message.message || '文字发送失败，请重试。');
        else if (message.type.startsWith('vision.')) onVision?.(message);
        else if (message.type === 'tool.call' && Array.isArray(message.items)) {
          for (const item of message.items) {
            if (typeof item?.callId !== 'string' || current.toolCalls.has(item.callId)) continue;
            current.toolCalls.add(item.callId);
            current.toolQueue = current.toolQueue.then(async () => {
              if (!active || resources !== current || token !== generation) return;
              let output;
              try { output = onToolCall ? await onToolCall(item) : { ok: false, message: '该能力暂不可用。' }; }
              catch { output = { ok: false, message: '操作没有完成，请重试。' }; }
              if (active && resources === current && token === generation && current.socket?.readyState === WebSocket.OPEN) {
                current.socket.send(JSON.stringify({ type: 'tool.result', callId: item.callId, output }));
              }
            });
          }
        }
        else if (message.type === 'session.closed') finish(current);
      };
      current.socket.onerror = () => { if (active && resources === current) fail('无法连接本机实时语音服务。', current); };
      current.socket.onclose = () => { if (resources === current) { if (active) onError?.('实时语音连接已断开。'); finish(current); } };
      stream.getAudioTracks().forEach(track => track.addEventListener('ended', () => { if (active && resources === current) fail('麦克风已断开。', current); }, { once: true }));
      return true;
    } catch (error) {
      if (token !== generation) return false;
      fail(error?.name === 'NotAllowedError' ? '麦克风权限被拒绝，请在浏览器中允许使用麦克风。' : error?.message || '无法启动实时语音。', current);
      return false;
    }
  }
  function stop() {
    if (!resources) { active = false; generation++; release(); return stopped; }
    const current = resources; active = false; generation++;
    notify('stopping'); closeMedia(current);
    stopped = new Promise(resolve => { finishResolve = resolve; });
    if (current.socket?.readyState === WebSocket.OPEN) {
      // Allow the provider's session.closed acknowledgement before closing the socket.
      current.socket.onmessage = event => { if (typeof event.data !== 'string') return; try { if (JSON.parse(event.data).type === 'session.closed') { current.socket.close(); finish(current); } } catch {} };
      current.socket.send(JSON.stringify({ type: 'session.close' }));
      current.closeTimer = setTimeout(() => { current.socket?.close(); finish(current); }, 4000);
    } else { if (current.socket && current.socket.readyState < WebSocket.CLOSING) current.socket.close(); finish(current); }
    return stopped;
  }
  function send(command) {
    const current = resources;
    if (!active || !current?.ready || current.socket?.readyState !== WebSocket.OPEN) return false;
    current.socket.send(JSON.stringify(command));
    return true;
  }
  return { isSupported: supported, start, stop, send };
}

