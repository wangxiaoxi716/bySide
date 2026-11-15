import { randomUUID } from 'crypto';
import type { Server, IncomingMessage } from 'http';
import { gzipSync, gunzipSync } from 'zlib';
import WebSocket, { WebSocketServer, RawData } from 'ws';

// Doubao SAUC v3 binary framing. Only compressed payloads are transmitted;
// the browser never receives the provider credential or saves microphone audio.
export function encodeAsrFrame(type: 'start' | 'audio' | 'finish', input: Buffer): Buffer {
  const body = gzipSync(input);
  const header = Buffer.from([0x11, type === 'start' ? 0x10 : type === 'finish' ? 0x22 : 0x20, type === 'start' ? 0x11 : 0x01, 0]);
  const size = Buffer.alloc(4); size.writeUInt32BE(body.length);
  return Buffer.concat([header, size, body]);
}

export function decodeAsrFrame(data: Buffer): { last: boolean; payload?: any; errorCode?: number } {
  if (data.length < 8 || data[0] >> 4 !== 1) throw new Error('invalid ASR frame');
  const type = data[1] >> 4, flags = data[1] & 0xf, compression = data[2] & 0xf;
  let offset = (data[0] & 0xf) * 4;
  if (offset < 4 || offset + 4 > data.length) throw new Error('invalid ASR header');
  let errorCode: number | undefined;
  if (type === 0xf) { errorCode = data.readUInt32BE(offset); offset += 4; }
  else if (flags & 1) { offset += 4; }
  if (offset + 4 > data.length) throw new Error('missing ASR payload');
  const size = data.readUInt32BE(offset); offset += 4;
  if (offset + size !== data.length || size > 1024 * 1024) throw new Error('invalid ASR payload length');
  const input = data.subarray(offset);
  const body = compression === 1 ? gunzipSync(input, { maxOutputLength: 1024 * 1024 }) : input;
  return { last: !!(flags & 2), errorCode, payload: body.length ? JSON.parse(body.toString('utf8')) : undefined };
}

const dataBuffer = (data: RawData) => Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);

function localUpgrade(req: IncomingMessage): boolean {
  const host = req.headers.host || '';
  return /^(localhost|127\.0\.0\.1):\d+$/.test(host) && (!req.headers.origin || req.headers.origin === `http://${host}`);
}

export function attachSpeechSocket(server: Server, realtime?: WebSocketServer) {
  const bridge = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    const path = req.url?.split('?')[0];
    const target = path === '/api/v1/speech/asr/stream' ? bridge : path === '/api/v1/speech/realtime' ? realtime : undefined;
    if (!target || !localUpgrade(req)) { socket.destroy(); return; }
    target.handleUpgrade(req, socket, head, browser => target.emit('connection', browser, req));
  });
  bridge.on('connection', browser => {
    let upstream: WebSocket | undefined, finished = false, timer: NodeJS.Timeout | undefined;
    const seen = new Set<string>();
    const send = (message: object) => { if (browser.readyState === WebSocket.OPEN) browser.send(JSON.stringify(message)); };
    const stop = () => { if (timer) clearTimeout(timer); if (upstream && upstream.readyState !== WebSocket.CLOSED) upstream.terminate(); };
    const fail = (code: string, message: string) => { send({ type: 'error', code, message }); if (browser.readyState === WebSocket.OPEN) browser.close(1011); stop(); };
    browser.on('error', stop);
    browser.on('close', stop);
    const key = process.env.VOLC_SPEECH_API_KEY;
    if (!key) { fail('not-configured', '未配置豆包语音 API Key'); return; }
    const url = process.env.VOLC_ASR_ENDPOINT || 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async';
    let parsed: URL;
    try { parsed = new URL(url); } catch { fail('configuration', '语音识别地址无效'); return; }
    if (parsed.protocol !== 'wss:' && !(parsed.protocol === 'ws:' && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname))) { fail('configuration', '语音识别地址必须使用安全连接'); return; }
    upstream = new WebSocket(url, { headers: { 'X-Api-Key': key, 'X-Api-Resource-Id': process.env.VOLC_ASR_RESOURCE_ID || 'volc.seedasr.sauc.duration', 'X-Api-Request-Id': randomUUID() }, handshakeTimeout: 15000, maxPayload: 1024 * 1024 });
    upstream.on('open', () => {
      upstream?.send(encodeAsrFrame('start', Buffer.from(JSON.stringify({ user: { uid: 'byside-local' }, audio: { format: 'pcm', codec: 'raw', rate: 16000, bits: 16, channel: 1 }, request: { model_name: 'bigmodel', enable_itn: true, enable_punc: true, enable_nonstream: true, show_utterances: true } }))));
      send({ type: 'ready', provider: 'doubao', format: 'pcm_s16le', sampleRate: 16000 });
      timer = setTimeout(() => fail('timeout', '本次语音连接时间已到，请重新开始'), 5 * 60 * 1000);
    });
    upstream.on('message', raw => {
      try {
        const frame = decodeAsrFrame(dataBuffer(raw));
        if (frame.errorCode !== undefined) { fail('provider-error', `豆包语音识别失败（${frame.errorCode}），请检查服务开通与资源 ID`); return; }
        const payload = frame.payload || {};
        if (typeof payload.code === 'number' && payload.code !== 0 && payload.code !== 1000) { fail('provider-error', `豆包语音识别失败（${payload.code}）`); return; }
        const results = Array.isArray(payload.result) ? payload.result : [payload.result];
        for (const result of results) {
          if (!result) continue;
          const utterances = Array.isArray(result.utterances) ? result.utterances : [];
          for (const item of utterances) {
            if (item.definite && typeof item.text === 'string' && item.text.trim()) {
              const identity = `${item.start_time}:${item.end_time}`;
              if (!seen.has(identity)) { seen.add(identity); send({ type: 'final', text: item.text.trim() }); }
            }
          }
          const interim = utterances.filter((item: any) => !item.definite).map((item: any) => item.text || '').join('');
          if (interim) send({ type: 'partial', text: interim });
          else if (!utterances.length && typeof result.text === 'string' && result.text.trim()) send({ type: frame.last ? 'final' : 'partial', text: result.text.trim() });
        }
        if (frame.last) { send({ type: 'ended' }); browser.close(1000); stop(); }
      } catch { fail('protocol-error', '语音识别返回了无法解析的数据'); }
    });
    upstream.on('error', () => fail('provider-unavailable', '无法连接豆包语音识别，请检查网络和服务授权'));
    upstream.on('close', () => { if (browser.readyState === WebSocket.OPEN) { if (finished) { send({ type: 'ended' }); browser.close(1000); } else fail('provider-closed', '豆包语音识别连接已断开'); } });
    browser.on('message', (data, binary) => {
      if (!upstream || upstream.readyState !== WebSocket.OPEN || finished) return;
      if (binary) {
        const pcm = dataBuffer(data);
        if (!pcm.length || pcm.length > 16000 || pcm.length % 2 || upstream.bufferedAmount > 512000) { fail('invalid-audio', '音频格式或发送速度无效'); return; }
        upstream.send(encodeAsrFrame('audio', pcm));
      } else {
        try {
          const command = JSON.parse(dataBuffer(data).toString());
          if (command.type === 'finish') { finished = true; upstream.send(encodeAsrFrame('finish', Buffer.alloc(0))); if (timer) clearTimeout(timer); timer = setTimeout(() => { send({ type: 'ended' }); browser.close(1000); stop(); }, 5000); }
          else if (command.type === 'cancel') { browser.close(1000); stop(); }
          else fail('invalid-command', '无效的语音命令');
        } catch { fail('invalid-command', '无效的语音命令'); }
      }
    });
  });
}
